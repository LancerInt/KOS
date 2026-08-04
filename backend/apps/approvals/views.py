"""Approval endpoints (PRD §13).

`POST /approvals/`               create a request (submit deliverable, request a
                                deadline change, or request a deletion)
`POST /approvals/<id>/decide/`  a single authorised approver acts (AC-11, AC-12)
`GET  /approvals/?status=pending` the approvals queue
"""
from __future__ import annotations

from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.rbac import Capability
from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.projects.models import Membership, Project
from apps.projects.scoping import visible_projects
from apps.notifications.models import NotificationEvent
from apps.notifications.services import notify, notify_many
from apps.tasks.models import Activity, Task

from .models import ApprovalKind, ApprovalRequest, ApprovalStatus
from .serializers import ApprovalRequestSerializer, CreateApprovalSerializer

DECISION_ACTION = {
    "approve": AuditAction.APPROVE,
    "reject": AuditAction.REJECT,
    "request_changes": AuditAction.REQUEST_CHANGES,
}
DECISION_STATUS = {
    "approve": ApprovalStatus.APPROVED,
    "reject": ApprovalStatus.REJECTED,
    "request_changes": ApprovalStatus.CHANGES_REQUESTED,
}


def _project_visible(user, project) -> bool:
    return project is not None and visible_projects(user, Project.objects.filter(pk=project.pk)).exists()


class ApprovalRequestViewSet(viewsets.ModelViewSet):
    queryset = ApprovalRequest.objects.select_related("task", "project", "requested_by", "approver").all()
    serializer_class = ApprovalRequestSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["status", "kind", "task", "project"]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        visible = visible_projects(self.request.user, Project.objects.all())
        return self.queryset.filter(
            models_q(visible)
        )

    def create(self, request, *args, **kwargs):
        data = CreateApprovalSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        v = data.validated_data
        task: Task | None = v.get("task")
        project: Project | None = v.get("project")
        target_project = (task.project if task else project)

        if not _project_visible(request.user, target_project):
            raise PermissionDenied("You do not have access to that project.")

        label = task.title if task else (project.code if project else "")
        ar = ApprovalRequest.objects.create(
            kind=v["kind"], task=task, project=project, target_label=label,
            requested_by=request.user, payload=v.get("payload") or {},
        )

        # Submitting a deliverable moves the task into review (§12.3).
        if ar.kind == ApprovalKind.DELIVERABLE and task:
            task.status = "review"
            task.last_activity_at = timezone.now()
            task.save(update_fields=["status", "last_activity_at"])
            Activity.objects.create(task=task, actor=request.user, verb=Activity.Verb.STATUS_CHANGED, detail={"to": "Review"})

        # Notify the approver pool: project members holding the Approve capability.
        pool = [
            m.user for m in Membership.objects.filter(project=target_project).select_related("user")
            if m.user and m.user.has_capability(Capability.APPROVE)
        ]
        event = NotificationEvent.REVIEW_REQUESTED if ar.kind == ApprovalKind.DELIVERABLE else NotificationEvent.DECISION_REQUESTED
        notify_many(pool, exclude=[request.user], event=event,
                    title=f"Approval needed: {label}", task=task, project=target_project)

        record(action=AuditAction.CREATE, obj=ar, new_value={"kind": ar.kind, "target": label}, request=request)
        return Response(ApprovalRequestSerializer(ar).data, status=201)

    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        ar = self.get_object()
        if ar.status != ApprovalStatus.PENDING:
            raise ValidationError("This request has already been decided.")

        user = request.user
        # Single approver: any one holder of the Approve capability (§13.1)...
        if not (user.is_superuser or user.has_capability(Capability.APPROVE)):
            raise PermissionDenied("You are not an authorised approver.")
        # ...but not for your own request (§6.3, §13.2).
        if ar.requested_by_id == user.id and not user.is_superuser:
            raise PermissionDenied("You cannot approve your own request.")

        decision = request.data.get("decision")
        if decision not in DECISION_STATUS:
            raise ValidationError({"decision": "Must be approve, reject or request_changes."})
        reason = (request.data.get("reason") or "").strip()
        if decision in ("reject", "request_changes") and not reason:
            raise ValidationError({"reason": "A reason is required to reject or request changes."})

        self._apply_effects(ar, decision, reason, request)

        ar.status = DECISION_STATUS[decision]
        ar.approver = user
        ar.acted_at = timezone.now()
        ar.decision_reason = reason
        ar.save(update_fields=["status", "approver", "acted_at", "decision_reason"])
        if ar.requested_by:
            notify(ar.requested_by, NotificationEvent.REVIEW_DECISION,
                   f"Your request was {ar.get_status_display().lower()}: {ar.target_label}",
                   body=reason, task=ar.task, project=ar.target_project())
        record(action=DECISION_ACTION[decision], obj=ar, new_value={"decision": decision, "reason": reason}, request=request)
        return Response(ApprovalRequestSerializer(ar).data)

    def _apply_effects(self, ar, decision, reason, request):
        task = ar.task

        if ar.kind == ApprovalKind.DELIVERABLE and task:
            new_status = {"approve": "approved", "request_changes": "in_progress", "reject": "rework"}[decision]
            task.status = new_status
            task.last_activity_at = timezone.now()
            task.save(update_fields=["status", "last_activity_at"])
            Activity.objects.create(task=task, actor=request.user, verb=Activity.Verb.STATUS_CHANGED, detail={"to": new_status, "reason": reason})

        elif ar.kind == ApprovalKind.DEADLINE_CHANGE and decision == "approve" and task:
            new_due = ar.payload.get("new_due_date")
            old = task.due_date
            # payload comes from JSON, so new_due is a string — parse it to a real
            # date. Assigning the raw string leaves the in-memory task holding a
            # str, which then crashes any date comparison (e.g. is_overdue in the
            # automation signal that fires on save).
            task.due_date = parse_date(new_due) if isinstance(new_due, str) else new_due
            task.save(update_fields=["due_date"])
            record(action=AuditAction.DEADLINE_CHANGE, obj=task,
                   old_value={"due_date": str(old)}, new_value={"due_date": new_due}, request=request)

        elif ar.kind == ApprovalKind.DELETION and decision == "approve":
            target = task or ar.project
            if target is not None:
                record(action=AuditAction.DELETE, obj=target, old_value={"label": ar.target_label}, request=request)
                target.delete()  # FK is SET_NULL, so the request row survives


def models_q(visible_projects_qs):
    """Requests whose target (task's project or project) is visible."""
    from django.db.models import Q
    return Q(task__project__in=visible_projects_qs) | Q(project__in=visible_projects_qs)
