"""Dependency & blocker endpoints (PRD §14, §15)."""
from __future__ import annotations

from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.rbac import Capability
from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.projects.models import Project
from apps.projects.scoping import visible_projects
from apps.notifications.models import NotificationEvent
from apps.notifications.services import notify_many
from apps.tasks.models import Activity, Task

from .models import Blocker, Dependency
from .serializers import BlockerSerializer, DependencySerializer


def _visible_tasks(user):
    return Task.objects.filter(project__in=visible_projects(user, Project.objects.all()))


def _can_edit_task(user, task) -> None:
    if not visible_projects(user, Project.objects.filter(pk=task.project_id)).exists():
        raise PermissionDenied("You do not have access to that task.")
    if user.is_superuser:
        return
    is_owner = task.primary_owner_id == user.pk or task.owners.filter(pk=user.pk).exists()
    if is_owner and user.has_capability(Capability.UPDATE_ASSIGNED):
        return
    if user.has_capability(Capability.ASSIGN_TASKS) or user.has_capability(Capability.MANAGE_PROJECT):
        return
    raise PermissionDenied("You cannot change this task's dependencies.")


class DependencyViewSet(viewsets.ModelViewSet):
    queryset = Dependency.objects.select_related(
        "successor", "predecessor_task", "predecessor_milestone"
    ).all()
    serializer_class = DependencySerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["successor", "predecessor_task", "dependency_type"]

    def get_queryset(self):
        return self.queryset.filter(successor__in=_visible_tasks(self.request.user))

    def perform_create(self, serializer):
        successor = serializer.validated_data["successor"]
        _can_edit_task(self.request.user, successor)
        dep = serializer.save()
        # Move an unstarted successor into Waiting Dependency (§14.3).
        if dep.is_mandatory and not dep.is_satisfied() and successor.status in ("backlog", "ready"):
            successor.status = "waiting_dependency"
            successor.save(update_fields=["status"])
        record(action=AuditAction.UPDATE, obj=successor,
               new_value={"dependency_added": dep.short_label()}, request=self.request)

    def perform_destroy(self, instance):
        _can_edit_task(self.request.user, instance.successor)
        record(action=AuditAction.UPDATE, obj=instance.successor,
               old_value={"dependency_removed": instance.short_label()}, request=self.request)
        instance.delete()


class BlockerViewSet(viewsets.ModelViewSet):
    queryset = Blocker.objects.select_related("task", "resolver", "raised_by").all()
    serializer_class = BlockerSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["task", "severity"]

    def get_queryset(self):
        return self.queryset.filter(task__in=_visible_tasks(self.request.user))

    def perform_create(self, serializer):
        task = serializer.validated_data["task"]
        # Any project member may raise a blocker (§15.2).
        if not visible_projects(self.request.user, Project.objects.filter(pk=task.project_id)).exists():
            raise PermissionDenied("You do not have access to that task.")
        blocker = serializer.save(raised_by=self.request.user, previous_status=task.status)

        if task.status != "blocked":
            task.status = "blocked"
            task.last_activity_at = timezone.now()
            task.save(update_fields=["status", "last_activity_at"])
            Activity.objects.create(
                task=task, actor=self.request.user, verb=Activity.Verb.STATUS_CHANGED,
                detail={"to": "Blocked"},
            )
        # Raising a blocker notifies the Manager / Agile Lead and Project Owner (§15.2).
        notify_many([task.project.owner, task.project.manager], exclude=[self.request.user],
                    event=NotificationEvent.BLOCKER_RAISED, title=f"Blocker raised on: {task.title}",
                    body=blocker.description[:200], task=task, project=task.project)
        record(action=AuditAction.STATUS_CHANGE, obj=task,
               new_value={"blocked": True, "reason": blocker.description[:120]}, request=self.request)

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        blocker = self.get_object()
        _can_edit_task(request.user, blocker.task)
        if blocker.resolved_at is not None:
            return Response(BlockerSerializer(blocker).data)

        blocker.resolved_at = timezone.now()
        blocker.resolution_note = request.data.get("resolution_note", "")
        blocker.save(update_fields=["resolved_at", "resolution_note"])

        # Return the task to the status it held before it was blocked (§15.2).
        task = blocker.task
        if task.status == "blocked" and blocker.previous_status:
            task.status = blocker.previous_status
            task.last_activity_at = timezone.now()
            task.save(update_fields=["status", "last_activity_at"])
            Activity.objects.create(
                task=task, actor=request.user, verb=Activity.Verb.STATUS_CHANGED,
                detail={"to": "Unblocked", "resumed": blocker.previous_status},
            )
        record(action=AuditAction.STATUS_CHANGE, obj=task, new_value={"unblocked": True}, request=request)
        return Response(BlockerSerializer(blocker).data)
