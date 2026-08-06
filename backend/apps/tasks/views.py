"""Task Engine endpoints (PRD §11, §12.3).

Rows scoped to visible projects (§7.7). Status transitions go through
`set_status`, which enforces the task-level Definition of Done (§11.5, AC-13).
Owner changes go through `manage_owners`, keeping the Primary Owner valid (A1).
"""
from __future__ import annotations

from django.db.models import Q
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.rbac import Capability
from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.projects.models import Project
from apps.projects.scoping import visible_projects
from apps.notifications.models import NotificationEvent
from apps.notifications.services import notify, notify_many
from apps.workflows.resolver import resolve

from .models import Activity, ChecklistItem, Comment, Subtask, Task, TimeEntry
from .permissions import CommentPermission, TaskChildPermission, TaskPermission
from .serializers import (
    ActivitySerializer,
    ChecklistItemSerializer,
    CommentSerializer,
    SubtaskSerializer,
    TaskDetailSerializer,
    TaskListSerializer,
    TaskWriteSerializer,
    TimeEntrySerializer,
)
from .statuses import (
    COMPLETED_STATUS,
    STATUS_CATEGORY,
    STATUS_LABEL,
    StatusCategory,
    category_for,
)


def _visible_tasks(user):
    visible = visible_projects(user, Project.objects.all())
    return Task.objects.filter(project__in=visible)


def _release_dependents(task, actor):
    """When a task completes, release successors that were waiting only on it
    (§14.3). Uses reverse relations from the dependencies app — no import."""
    for dep in task.dependents.filter(is_mandatory=True).select_related("successor"):
        succ = dep.successor
        if succ.status == "waiting_dependency" and all(
            d.is_satisfied() for d in succ.dependencies.filter(is_mandatory=True)
        ):
            succ.status = "ready"
            succ.save(update_fields=["status"])
            Activity.objects.create(
                task=succ, actor=actor, verb=Activity.Verb.STATUS_CHANGED,
                detail={"to": "Ready", "reason": "dependency met"},
            )


class TaskViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, TaskPermission]
    filterset_fields = ["project", "status", "priority", "task_type", "epic", "milestone", "sprint"]
    search_fields = ["title"]
    ordering_fields = ["due_date", "priority", "created_at", "backlog_rank"]

    def get_queryset(self):
        qs = (
            _visible_tasks(self.request.user)
            .select_related("project", "primary_owner", "reviewer")
            .prefetch_related("owners", "checklist_items")
        )
        # ?unscheduled=true → the backlog (tasks not assigned to a sprint), ranked.
        if self.request.query_params.get("unscheduled") in ("true", "1"):
            qs = qs.filter(sprint__isnull=True).order_by("backlog_rank", "-created_at")
        return qs

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return TaskWriteSerializer
        if self.action == "retrieve":
            return TaskDetailSerializer
        return TaskListSerializer

    def get_serializer_context(self):
        # Per-request cache so category/label resolution doesn't re-query the
        # workflow once per task row (§12).
        ctx = super().get_serializer_context()
        ctx.setdefault("wf_cache", {})
        return ctx

    # --- create / update / delete -------------------------------------- #
    def perform_create(self, serializer):
        project = serializer.validated_data["project"]
        if not visible_projects(self.request.user, Project.objects.filter(pk=project.pk)).exists():
            raise PermissionDenied("You do not have access to that project.")
        task = serializer.save(created_by=self.request.user)
        if not task.owners.exists():
            task.owners.add(self.request.user)
        if not task.primary_owner_id:
            task.primary_owner = task.owners.first()
            task.save(update_fields=["primary_owner"])
        Activity.objects.create(task=task, actor=self.request.user, verb=Activity.Verb.CREATED)
        record(action=AuditAction.CREATE, obj=task, new_value={"title": task.title}, request=self.request)

    def perform_update(self, serializer):
        user = self.request.user
        old_due = serializer.instance.due_date
        vd = serializer.validated_data
        changing_due = "due_date" in vd and vd["due_date"] != old_due
        # Deadline changes require approval (AC-20). Non-approvers must route it
        # through a deadline-change approval request instead.
        if changing_due and not (user.is_superuser or user.has_capability(Capability.APPROVE)):
            raise ValidationError(
                {"due_date": "Deadline changes require approval. Submit a deadline-change request."}
            )
        task = serializer.save()
        task.last_activity_at = timezone.now()
        task.save(update_fields=["last_activity_at"])
        Activity.objects.create(task=task, actor=user, verb=Activity.Verb.UPDATED)
        if changing_due:
            record(action=AuditAction.DEADLINE_CHANGE, obj=task,
                   old_value={"due_date": str(old_due)}, new_value={"due_date": str(task.due_date)},
                   request=self.request)
        else:
            record(action=AuditAction.UPDATE, obj=task, request=self.request)

    def perform_destroy(self, instance):
        record(action=AuditAction.DELETE, obj=instance, old_value={"title": instance.title}, request=self.request)
        instance.delete()

    # --- personal board ------------------------------------------------- #
    @action(detail=False, methods=["get"])
    def mine(self, request):
        """Tasks routed to me — owner, primary owner or reviewer (the My Work board)."""
        qs = (
            _visible_tasks(request.user)
            .filter(Q(owners=request.user) | Q(primary_owner=request.user) | Q(reviewer=request.user))
            .exclude(status="archived")
            .select_related("project", "primary_owner")
            .prefetch_related("owners", "checklist_items")
            .distinct()
            .order_by("due_date")
        )
        return Response(self.get_serializer(qs, many=True).data)

    # --- backlog ranking (§16.2) ---------------------------------------- #
    @action(detail=False, methods=["post"])
    def rank(self, request):
        """Reorder the backlog. Body: {"order": [taskId, ...]}."""
        if not (request.user.is_superuser or request.user.has_capability(Capability.MANAGE_BACKLOG)):
            raise PermissionDenied("You need the 'manage backlog & sprint' capability.")
        order = request.data.get("order") or []
        visible = _visible_tasks(request.user)
        for i, task_id in enumerate(order):
            visible.filter(id=task_id).update(backlog_rank=i)
        return Response({"ranked": len(order)})

    # --- status transition (enforces DoD) ------------------------------ #
    @action(detail=True, methods=["post"], url_path="set_status")
    def set_status(self, request, pk=None):
        task = self.get_object()
        new_status = request.data.get("status")
        rw = resolve(task.project)  # custom workflow or built-in default (§12)

        if new_status not in rw.keys():
            raise ValidationError({"status": "Unknown status for this project's workflow."})

        old_status = task.status
        ctx = self.get_serializer_context()
        if old_status == new_status:
            return Response(TaskDetailSerializer(task, context=ctx).data)

        # Reject transitions outside the configured graph (§12.3, AC-10).
        if not rw.allowed(old_status, new_status):
            raise ValidationError({
                "status": f"Transition '{rw.label_for(old_status)}' → "
                          f"'{rw.label_for(new_status)}' is not allowed by this workflow."
            })

        new_category = rw.category_for(new_status)
        old_category = rw.category_for(old_status)
        entering_done = new_category == StatusCategory.DONE and old_category != StatusCategory.DONE

        # Definition of Done gates entry into a Done-category status (§11.5, AC-13).
        if entering_done and not task.can_complete():
            raise ValidationError({
                "status": "This task cannot be completed yet.",
                "blocking_reasons": task.blocking_reasons(),
            })

        # Stamp actual start on first entry to an Active status (§11.3).
        if new_category == StatusCategory.ACTIVE and not task.actual_start_date:
            task.actual_start_date = timezone.now().date()

        if entering_done:
            task.completed_at = timezone.now()
            task.completed_by = request.user
            verb = Activity.Verb.COMPLETED
        elif old_category == StatusCategory.DONE and new_category != StatusCategory.DONE:
            task.completed_at = None
            task.completed_by = None
            verb = Activity.Verb.REOPENED
        else:
            verb = Activity.Verb.STATUS_CHANGED

        task.status = new_status
        task.last_activity_at = timezone.now()
        task.save()

        Activity.objects.create(
            task=task, actor=request.user, verb=verb,
            detail={"from": rw.label_for(old_status), "to": rw.label_for(new_status)},
        )
        if entering_done:
            _release_dependents(task, request.user)
        record(action=AuditAction.STATUS_CHANGE, obj=task,
               old_value={"status": old_status}, new_value={"status": new_status}, request=request)
        return Response(TaskDetailSerializer(task, context=ctx).data)

    # --- ownership ------------------------------------------------------ #
    @action(detail=True, methods=["post"], url_path="manage_owners")
    def manage_owners(self, request, pk=None):
        task = self.get_object()
        owners = request.data.get("owners")
        primary = request.data.get("primary_owner")

        if owners is not None:
            task.owners.set(owners)
        if primary is not None:
            if not task.owners.filter(pk=primary).exists():
                raise ValidationError({"primary_owner": "The Primary Owner must be one of the owners."})
            task.primary_owner_id = primary
            task.save(update_fields=["primary_owner"])
        elif task.primary_owner_id and not task.owners.filter(pk=task.primary_owner_id).exists():
            # Primary was removed from owners — reassign to keep one primary (A1).
            task.primary_owner = task.owners.first()
            task.save(update_fields=["primary_owner"])

        Activity.objects.create(task=task, actor=request.user, verb=Activity.Verb.ASSIGNED)
        notify_many(task.owners.all(), exclude=[request.user], event=NotificationEvent.TASK_ASSIGNED,
                    title=f"You're an owner of: {task.title}", task=task, project=task.project)
        record(action=AuditAction.OWNERSHIP_CHANGE, obj=task, request=request)
        return Response(TaskDetailSerializer(task, context=self.get_serializer_context()).data)


class _TaskChildViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, TaskChildPermission]

    def get_queryset(self):
        return self.queryset.filter(task__in=_visible_tasks(self.request.user))

    def _check_task_visible(self, task):
        if not visible_projects(self.request.user, Project.objects.filter(pk=task.project_id)).exists():
            raise PermissionDenied("You do not have access to that task.")

    def perform_create(self, serializer):
        self._check_task_visible(serializer.validated_data["task"])
        serializer.save()


class SubtaskViewSet(_TaskChildViewSet):
    queryset = Subtask.objects.select_related("task", "assignee").all()
    serializer_class = SubtaskSerializer


class ChecklistItemViewSet(_TaskChildViewSet):
    queryset = ChecklistItem.objects.select_related("task").all()
    serializer_class = ChecklistItemSerializer


class CommentViewSet(viewsets.ModelViewSet):
    queryset = Comment.objects.select_related("task", "author").prefetch_related("mentions").all()
    serializer_class = CommentSerializer
    permission_classes = [IsAuthenticated, CommentPermission]

    def get_queryset(self):
        return self.queryset.filter(task__in=_visible_tasks(self.request.user))

    def perform_create(self, serializer):
        task = serializer.validated_data["task"]
        if not visible_projects(self.request.user, Project.objects.filter(pk=task.project_id)).exists():
            raise PermissionDenied("You do not have access to that task.")
        comment = serializer.save(author=self.request.user)
        task.last_activity_at = timezone.now()
        task.save(update_fields=["last_activity_at"])
        Activity.objects.create(
            task=task, actor=self.request.user, verb=Activity.Verb.COMMENTED,
            detail={"comment_id": comment.id},
        )
        recipients = list(task.owners.all()) + list(task.watchers.all())
        notify_many(recipients, exclude=[self.request.user], event=NotificationEvent.COMMENT,
                    title=f"New comment on: {task.title}", body=comment.body[:200], task=task, project=task.project)
        for mentioned in comment.mentions.all():
            if mentioned.id != self.request.user.id:
                notify(mentioned, NotificationEvent.MENTION, f"You were mentioned on: {task.title}",
                       body=comment.body[:200], task=task, project=task.project)


class TimeEntryViewSet(viewsets.ModelViewSet):
    """Log and review time against tasks, and roll it up per person (workload)."""

    queryset = TimeEntry.objects.select_related("task", "user").all()
    serializer_class = TimeEntrySerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["task", "user"]

    def get_queryset(self):
        return self.queryset.filter(task__in=_visible_tasks(self.request.user))

    def perform_create(self, serializer):
        task = serializer.validated_data["task"]
        if not visible_projects(self.request.user, Project.objects.filter(pk=task.project_id)).exists():
            raise PermissionDenied("You do not have access to that task.")
        if serializer.validated_data.get("minutes", 0) <= 0:
            raise ValidationError({"minutes": "Log a positive number of minutes."})
        entry = serializer.save(user=self.request.user)
        task.last_activity_at = timezone.now()
        task.save(update_fields=["last_activity_at"])
        record(action=AuditAction.CREATE, obj=entry,
               new_value={"minutes": entry.minutes, "task": task.id}, request=self.request)

    def perform_destroy(self, instance):
        if instance.user_id != self.request.user.id and not self.request.user.is_superuser:
            raise PermissionDenied("You can only remove your own time entries.")
        instance.delete()

    @action(detail=False, methods=["get"])
    def workload(self, request):
        """Per-person load over a date range (default this week): time logged,
        plus open assigned tasks and their planned estimate."""
        from datetime import timedelta

        from django.db.models import Count, Sum
        from django.utils.dateparse import parse_date

        from apps.accounts.models import User

        today = timezone.now().date()
        start = parse_date(request.query_params.get("start", "")) or today - timedelta(days=today.weekday())
        end = parse_date(request.query_params.get("end", "")) or start + timedelta(days=6)

        visible = _visible_tasks(request.user)
        logged = (
            TimeEntry.objects.filter(task__in=visible, spent_on__gte=start, spent_on__lte=end)
            .values("user").annotate(total=Sum("minutes"))
        )
        logged_map = {r["user"]: r["total"] or 0 for r in logged}

        done_like = [s for s, c in STATUS_CATEGORY.items()
                     if c in (StatusCategory.DONE, StatusCategory.CANCELLED)]
        open_per_owner = (
            visible.exclude(status__in=done_like).filter(owners__isnull=False)
            .values("owners").annotate(cnt=Count("id", distinct=True), est=Sum("estimate_minutes"))
        )
        open_map = {r["owners"]: (r["cnt"], r["est"] or 0) for r in open_per_owner}

        rows = []
        for u in User.objects.filter(is_active=True):
            cnt, est = open_map.get(u.id, (0, 0))
            logged_min = logged_map.get(u.id, 0)
            if not (logged_min or cnt):
                continue  # skip people with no load in this window
            rows.append({
                "user_id": u.id,
                "user_name": u.get_full_name() or u.username,
                "logged_minutes": logged_min,
                "open_tasks": cnt,
                "open_estimate_minutes": est,
            })
        rows.sort(key=lambda r: (-r["logged_minutes"], -r["open_tasks"]))
        return Response({"start": start, "end": end, "rows": rows})
