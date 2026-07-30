"""API for workspace projects, their sections and category records, plus the
per-role workspace permission table.

Projects are filtered by ``?workspace=``; sections and records by ``?project=``
(records also by ``?category=``). Reads are scoped to workspaces the user may
view; creating/deleting requires ``edit`` access to that workspace.
"""
from __future__ import annotations

from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import Role
from apps.accounts.permissions import IsAdministrator

from .access import can_edit, effective_access
from .models import (
    WorkspacePermission, WorkspaceProject, WorkspaceRecord, WorkspaceSection,
)
from .serializers import (
    WorkspacePermissionSerializer, WorkspaceProjectSerializer,
    WorkspaceRecordSerializer, WorkspaceSectionSerializer,
)


def _scope_to_viewable(qs, user):
    """Limit a queryset that has a ``workspace`` field to what the user may view."""
    acc = effective_access(user)
    if acc is None:  # admin — sees everything
        return qs
    return qs.filter(workspace__in=list(acc.keys()))


def _require_edit(user, workspace):
    if not can_edit(user, workspace):
        raise PermissionDenied("You don't have edit access to this workspace.")


class WorkspacePermissionViewSet(viewsets.ModelViewSet):
    """The role × workspace access table. Managed by administrators; every user
    can read their own effective access via ``/mine/``."""

    serializer_class = WorkspacePermissionSerializer
    pagination_class = None

    def get_permissions(self):
        if self.action == "mine":
            return [IsAuthenticated()]
        return [IsAdministrator()]

    def get_queryset(self):
        qs = WorkspacePermission.objects.all()
        role = self.request.query_params.get("role")
        if role:
            qs = qs.filter(role=role)
        return qs

    @action(detail=False, methods=["get"])
    def mine(self, request):
        acc = effective_access(request.user)
        return Response({"is_admin": acc is None, "access": acc or {}})

    @action(detail=False, methods=["post"])
    def bulk(self, request):
        """Replace a role's whole permission set: {role, permissions:[{workspace, access}]}."""
        role_id = request.data.get("role")
        perms = request.data.get("permissions", [])
        role = Role.objects.filter(pk=role_id).first()
        if not role:
            raise PermissionDenied("Unknown role.")
        WorkspacePermission.objects.filter(role=role).delete()
        objs = [
            WorkspacePermission(role=role, workspace=p["workspace"], access=p["access"])
            for p in perms if p.get("access") in ("view", "edit") and p.get("workspace")
        ]
        WorkspacePermission.objects.bulk_create(objs)
        return Response({"saved": len(objs)})


class WorkspaceProjectViewSet(viewsets.ModelViewSet):
    serializer_class = WorkspaceProjectSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        qs = WorkspaceProject.objects.select_related("created_by").all()
        workspace = self.request.query_params.get("workspace")
        if workspace:
            qs = qs.filter(workspace=workspace)
        return _scope_to_viewable(qs, self.request.user)

    def perform_create(self, serializer):
        _require_edit(self.request.user, serializer.validated_data.get("workspace"))
        serializer.save(created_by=self.request.user)

    def perform_update(self, serializer):
        _require_edit(self.request.user, serializer.instance.workspace)
        serializer.save()

    def perform_destroy(self, instance):
        _require_edit(self.request.user, instance.workspace)
        instance.delete()

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """Toggle a project's completed state (closes the duration loop)."""
        project = self.get_object()
        _require_edit(request.user, project.workspace)
        if project.completed_at:
            project.completed_at = None
            project.duration_notified_at = None
            project.reminders_sent = []          # reopened → reminders may fire again
        else:
            project.completed_at = timezone.now()
        project.save(update_fields=["completed_at", "duration_notified_at", "reminders_sent"])
        return Response(self.get_serializer(project).data)


class WorkspaceRecordViewSet(viewsets.ModelViewSet):
    serializer_class = WorkspaceRecordSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None  # small volumes; return the full list for counts + drawer

    def get_queryset(self):
        qs = WorkspaceRecord.objects.select_related("created_by").all()
        params = self.request.query_params
        project = params.get("project")
        category = params.get("category")
        if project:
            qs = qs.filter(project=project)
        if category:
            qs = qs.filter(category=category)
        return _scope_to_viewable(qs, self.request.user)

    def perform_create(self, serializer):
        project = serializer.validated_data.get("project")
        ws = project.workspace if project else ""
        _require_edit(self.request.user, ws)
        serializer.save(created_by=self.request.user, workspace=ws)

    def perform_destroy(self, instance):
        _require_edit(self.request.user, instance.workspace)
        instance.delete()

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """Toggle a record's completed state (closes / reopens its duration)."""
        record = self.get_object()
        _require_edit(request.user, record.workspace)
        if record.completed_at:
            record.completed_at = None
            record.duration_notified_at = None
        else:
            record.completed_at = timezone.now()
        record.save(update_fields=["completed_at", "duration_notified_at"])
        return Response(self.get_serializer(record).data)


class WorkspaceSectionViewSet(viewsets.ModelViewSet):
    serializer_class = WorkspaceSectionSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        qs = WorkspaceSection.objects.select_related("created_by").all()
        project = self.request.query_params.get("project")
        if project:
            qs = qs.filter(project=project)
        return _scope_to_viewable(qs, self.request.user)

    def perform_create(self, serializer):
        project = serializer.validated_data.get("project")
        ws = project.workspace if project else ""
        _require_edit(self.request.user, ws)
        serializer.save(created_by=self.request.user, workspace=ws)

    def perform_update(self, serializer):
        _require_edit(self.request.user, serializer.instance.workspace)
        serializer.save()

    def perform_destroy(self, instance):
        # Removing a section also removes any records captured under it.
        _require_edit(self.request.user, instance.workspace)
        WorkspaceRecord.objects.filter(project=instance.project, category=instance.name).delete()
        instance.delete()
