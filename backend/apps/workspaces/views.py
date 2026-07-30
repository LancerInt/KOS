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
from apps.audit.models import AuditAction
from apps.audit.services import record

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


# ---- Audit value builders -------------------------------------------------
# Each carries the workspace key + a human name (+ parent context) so the audit
# trail reads "which project / section / record, in which workspace".

def _proj_val(project) -> dict:
    return {"workspace": project.workspace, "name": project.name, "kind": "project"}


def _sec_val(section) -> dict:
    return {"workspace": section.workspace, "name": section.name, "kind": "section",
            "context": section.project.name if section.project_id else ""}


def _rec_val(rec) -> dict:
    headline = ""
    if isinstance(rec.data, dict):
        headline = next((str(v) for v in rec.data.values() if v), "")
    context = f"{rec.project.name} › {rec.category}" if rec.project_id else rec.category
    return {"workspace": rec.workspace, "name": headline or rec.category, "kind": "record", "context": context}


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
        project = serializer.save(created_by=self.request.user)
        record(action=AuditAction.CREATE, obj=project, new_value=_proj_val(project), request=self.request)

    def perform_update(self, serializer):
        _require_edit(self.request.user, serializer.instance.workspace)
        project = serializer.save()
        record(action=AuditAction.UPDATE, obj=project, new_value=_proj_val(project), request=self.request)

    def perform_destroy(self, instance):
        _require_edit(self.request.user, instance.workspace)
        val, oid = _proj_val(instance), str(instance.pk)
        instance.delete()
        record(action=AuditAction.DELETE, object_type="WorkspaceProject", object_id=oid,
               old_value=val, request=self.request)

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
        record(action=AuditAction.STATUS_CHANGE, obj=project,
               new_value={**_proj_val(project), "completed": bool(project.completed_at)}, request=request)
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
        rec = serializer.save(created_by=self.request.user, workspace=ws)
        record(action=AuditAction.CREATE, obj=rec, new_value=_rec_val(rec), request=self.request)

    def perform_destroy(self, instance):
        _require_edit(self.request.user, instance.workspace)
        val, oid = _rec_val(instance), str(instance.pk)
        instance.delete()
        record(action=AuditAction.DELETE, object_type="WorkspaceRecord", object_id=oid,
               old_value=val, request=self.request)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """Toggle a record's completed state (closes / reopens its duration)."""
        rec = self.get_object()
        _require_edit(request.user, rec.workspace)
        if rec.completed_at:
            rec.completed_at = None
            rec.duration_notified_at = None
        else:
            rec.completed_at = timezone.now()
        rec.save(update_fields=["completed_at", "duration_notified_at"])
        record(action=AuditAction.STATUS_CHANGE, obj=rec,
               new_value={**_rec_val(rec), "completed": bool(rec.completed_at)}, request=request)
        return Response(self.get_serializer(rec).data)


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
        section = serializer.save(created_by=self.request.user, workspace=ws)
        # A section created already-hidden is a built-in being removed (deleted).
        if section.hidden:
            record(action=AuditAction.DELETE, obj=section, old_value=_sec_val(section), request=self.request)
        else:
            record(action=AuditAction.CREATE, obj=section, new_value=_sec_val(section), request=self.request)

    def perform_update(self, serializer):
        # Hiding a section only removes it from this project's grid; its records
        # are kept so a delete can be undone / the section restored intact.
        _require_edit(self.request.user, serializer.instance.workspace)
        was_hidden = serializer.instance.hidden
        section = serializer.save()
        if section.hidden and not was_hidden:
            record(action=AuditAction.DELETE, obj=section, old_value=_sec_val(section), request=self.request)
        elif was_hidden and not section.hidden:
            record(action=AuditAction.UPDATE, obj=section,
                   new_value={**_sec_val(section), "restored": True}, request=self.request)
        else:
            record(action=AuditAction.UPDATE, obj=section, new_value=_sec_val(section), request=self.request)

    def perform_destroy(self, instance):
        # Removing a section also removes any records captured under it.
        _require_edit(self.request.user, instance.workspace)
        val, oid = _sec_val(instance), str(instance.pk)
        WorkspaceRecord.objects.filter(project=instance.project, category=instance.name).delete()
        instance.delete()
        record(action=AuditAction.DELETE, object_type="WorkspaceSection", object_id=oid,
               old_value=val, request=self.request)
