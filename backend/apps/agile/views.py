"""Agile & sprint endpoints (PRD §16)."""
from __future__ import annotations

from datetime import timedelta

from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.permissions import HasCapability
from apps.accounts.rbac import Capability
from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.projects.models import Project
from apps.projects.permissions import CanAccessProject
from apps.projects.scoping import visible_projects
from apps.tasks.models import Task
from apps.tasks.serializers import TaskListSerializer
from apps.tasks.statuses import StatusCategory
from apps.workflows.resolver import resolve

from .models import RetrospectiveItem, Sprint
from .serializers import RetrospectiveItemSerializer, SprintDetailSerializer, SprintSerializer

WRITE_ACTIONS = {"create", "update", "partial_update", "destroy", "assign", "baseline"}


def _visible_projects(user):
    return visible_projects(user, Project.objects.all())


class SprintViewSet(viewsets.ModelViewSet):
    queryset = Sprint.objects.select_related("project", "owner").all()
    permission_classes = [IsAuthenticated, HasCapability, CanAccessProject]
    filterset_fields = ["project", "status"]

    def get_serializer_class(self):
        return SprintDetailSerializer if self.action == "retrieve" else SprintSerializer

    def get_permissions(self):
        self.required_capability = Capability.MANAGE_BACKLOG if self.action in WRITE_ACTIONS else None
        return super().get_permissions()

    def get_queryset(self):
        return self.queryset.filter(project__in=_visible_projects(self.request.user))

    def perform_create(self, serializer):
        project = serializer.validated_data["project"]
        if not visible_projects(self.request.user, Project.objects.filter(pk=project.pk)).exists():
            raise PermissionDenied("You do not have access to that project.")
        if not project.sprint_enabled:
            raise ValidationError({"project": "Sprints are not enabled for this project."})
        sprint = serializer.save(owner=serializer.validated_data.get("owner") or self.request.user)
        record(action=AuditAction.CREATE, obj=sprint, new_value={"name": sprint.name}, request=self.request)

    def _tasks_context(self, request):
        return {"request": request, "wf_cache": {}}

    # --- assign tasks to / from the sprint ------------------------------ #
    @action(detail=True, methods=["post"])
    def assign(self, request, pk=None):
        sprint = self.get_object()
        task_ids = request.data.get("task_ids") or []
        op = request.data.get("op", "add")

        tasks = Task.objects.filter(id__in=task_ids, project=sprint.project)
        if op == "remove":
            tasks.update(sprint=None)
        else:
            tasks.update(sprint=sprint)
        record(action=AuditAction.UPDATE, obj=sprint,
               new_value={"op": op, "tasks": list(task_ids)}, request=request)
        return Response(SprintDetailSerializer(sprint, context={"request": request}).data)

    # --- freeze the plan ------------------------------------------------ #
    @action(detail=True, methods=["post"])
    def baseline(self, request, pk=None):
        sprint = self.get_object()
        sprint.is_baselined = True
        sprint.baselined_at = timezone.now()
        if sprint.status == "planning":
            sprint.status = "active"
        sprint.save(update_fields=["is_baselined", "baselined_at", "status"])
        record(action=AuditAction.UPDATE, obj=sprint, new_value={"baselined": True}, request=request)
        return Response(SprintDetailSerializer(sprint, context={"request": request}).data)

    # --- daily stand-up summary (§16.3) --------------------------------- #
    @action(detail=True, methods=["get"])
    def standup(self, request, pk=None):
        sprint = self.get_object()
        rw = resolve(sprint.project)
        tasks = list(
            sprint.tasks.select_related("project", "primary_owner").prefetch_related("owners", "checklist_items")
        )
        stale_before = timezone.now() - timedelta(days=2)

        def cat(t):
            return rw.category_for(t.status)

        buckets = {
            "in_progress": [t for t in tasks if cat(t) == StatusCategory.ACTIVE],
            "blocked": [t for t in tasks if t.status == "blocked"],
            "overdue": [t for t in tasks if t.is_overdue],
            "done": [t for t in tasks if cat(t) == StatusCategory.DONE],
            "no_recent_update": [t for t in tasks if t.last_activity_at < stale_before and cat(t) != StatusCategory.DONE],
            "decisions_required": [t for t in tasks if t.task_type in ("decision", "approval")],
        }
        ctx = self._tasks_context(request)
        return Response({k: TaskListSerializer(v, many=True, context=ctx).data for k, v in buckets.items()})

    # --- sprint review summary (§16.4) ---------------------------------- #
    @action(detail=True, methods=["get"])
    def review(self, request, pk=None):
        sprint = self.get_object()
        rw = resolve(sprint.project)
        tasks = list(sprint.tasks.all())

        def cat(t):
            return rw.category_for(t.status)

        def is_unplanned(t) -> bool:
            # Added after the plan was frozen (§16.4). Falls back to start date.
            if sprint.baselined_at:
                return t.created_at > sprint.baselined_at
            if sprint.start_date:
                return t.created_at.date() > sprint.start_date
            return False

        completed = [t for t in tasks if cat(t) == StatusCategory.DONE]
        carried = [t for t in tasks if cat(t) != StatusCategory.DONE]
        unplanned = [t for t in tasks if is_unplanned(t)]

        return Response({
            "planned": len(tasks),
            "completed": len(completed),
            "carried_forward": len(carried),
            "unplanned_added": len(unplanned),
        })


class RetrospectiveItemViewSet(viewsets.ModelViewSet):
    queryset = RetrospectiveItem.objects.select_related("sprint", "sprint__project", "owner").all()
    serializer_class = RetrospectiveItemSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["sprint", "kind"]

    def get_queryset(self):
        return self.queryset.filter(sprint__project__in=_visible_projects(self.request.user))

    def perform_create(self, serializer):
        sprint = serializer.validated_data["sprint"]
        if not visible_projects(self.request.user, Project.objects.filter(pk=sprint.project_id)).exists():
            raise PermissionDenied("You do not have access to that sprint.")
        serializer.save()
