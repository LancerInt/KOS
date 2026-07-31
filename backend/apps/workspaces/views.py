"""API for workspace projects, their sections and category records, plus the
per-role workspace permission table.

Projects are filtered by ``?workspace=``; sections and records by ``?project=``
(records also by ``?category=``). Reads are scoped to workspaces the user may
view; creating/deleting requires ``edit`` access to that workspace.
"""
from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.models import Role
from apps.accounts.permissions import IsAdministrator
from apps.accounts.rbac import Capability
from apps.audit.models import AuditAction
from apps.audit.services import record

from .access import can_edit, effective_access, is_supervisor
from .models import (
    Workspace, WorkspaceMember, WorkspacePermission, WorkspaceProject,
    WorkspaceRecord, WorkspaceSection,
)
from .serializers import (
    WorkspaceMemberSerializer, WorkspacePermissionSerializer, WorkspaceProjectSerializer,
    WorkspaceRecordSerializer, WorkspaceSectionSerializer, WorkspaceSerializer,
)

User = get_user_model()

# Keys of the 11 built-in workspaces (defined in the frontend config). A new
# dynamic workspace must not reuse one of these.
BUILTIN_WORKSPACE_KEYS = frozenset({
    "amazon-usa", "cibrc", "epa-reg", "marketing-marathon", "crm", "exhibition-b2c",
    "distribution-us", "social-media", "website-biodesk", "entomology", "finance-statutory",
})

# Domain team of each built-in workspace (mirrors seed_workspace_permissions):
# eight executive, Entomology research. EPA + US distribution have no domain team
# (supervisor-only) and take members from either team.
BUILTIN_WORKSPACE_DOMAIN = {
    "amazon-usa": "executive", "cibrc": "executive", "marketing-marathon": "executive",
    "crm": "executive", "exhibition-b2c": "executive", "social-media": "executive",
    "website-biodesk": "executive", "finance-statutory": "executive",
    "entomology": "research",
}


def _archived_workspace_keys() -> set[str]:
    return set(Workspace.objects.filter(archived_at__isnull=False).values_list("key", flat=True))


def _scope_to_viewable(qs, user):
    """Limit a queryset that has a ``workspace`` field to what the user may view.
    Content of archived workspaces is hidden everywhere (it's restored on undo)."""
    archived = _archived_workspace_keys()
    acc = effective_access(user)
    if acc is None:  # admin — sees everything except archived workspaces
        return qs.exclude(workspace__in=archived) if archived else qs
    keys = set(acc.keys()) - archived
    return qs.filter(workspace__in=keys)


def _unique_workspace_key(label: str) -> str:
    base = slugify(label)[:56] or "workspace"
    taken = set(Workspace.objects.values_list("key", flat=True)) | set(BUILTIN_WORKSPACE_KEYS)
    key, i = base, 2
    while key in taken:
        key, i = f"{base}-{i}", i + 1
    return key


def purge_expired_workspaces() -> int:
    """Hard-delete archived workspaces (and all their content) past the TTL."""
    cutoff = timezone.now() - timedelta(days=Workspace.ARCHIVE_TTL_DAYS)
    n = 0
    for ws in Workspace.objects.filter(archived_at__isnull=False, archived_at__lt=cutoff):
        ws.purge_contents()
        ws.delete()
        n += 1
    return n


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


# --- Team-based workspace access (roles identified by name) ----------------
# IT Team + Management can always use a workspace. A workspace belongs to one
# domain team — Researcher XOR Executive — decided by the creator's own team,
# or, for a neutral creator (IT / Management / admin), by the chosen domain.
TEAM_IT = "IT Team"
TEAM_MANAGEMENT = "Management"
TEAM_RESEARCHER = "Researcher"
TEAM_EXECUTIVE = "Executive"
ALWAYS_ACCESS = (TEAM_IT, TEAM_MANAGEMENT)
DOMAIN_TEAM = {"research": TEAM_RESEARCHER, "executive": TEAM_EXECUTIVE}


def _creator_domain(user):
    """The domain forced by the creator's own team, or None if they may choose."""
    names = set(user.roles.values_list("name", flat=True))
    if TEAM_RESEARCHER in names:
        return "research"
    if TEAM_EXECUTIVE in names:
        return "executive"
    return None  # neutral (IT / Management / admin) → the creator picks


def _resolve_domain(user, chosen):
    # The creator's own team always wins; a neutral creator's choice is honoured.
    return _creator_domain(user) or (chosen if chosen in DOMAIN_TEAM else "research")


def _access_role_names(domain):
    return set(ALWAYS_ACCESS) | {DOMAIN_TEAM.get(domain, TEAM_RESEARCHER)}


def workspace_domain(key):
    """The domain team ('research'/'executive') a workspace belongs to, or None
    for a neutral/supervisor-only one. Built-ins use the static map; a dynamic
    workspace carries it on its row."""
    if key in BUILTIN_WORKSPACE_DOMAIN:
        return BUILTIN_WORKSPACE_DOMAIN[key]
    ws = Workspace.objects.filter(key=key).first()
    return (ws.domain or None) if ws else None


def _addable_role_names(domain):
    """Team(s) a member may be drawn from: a domain workspace draws only that
    team; a neutral one allows either Researcher or Executive."""
    if domain in DOMAIN_TEAM:
        return {DOMAIN_TEAM[domain]}
    return {TEAM_RESEARCHER, TEAM_EXECUTIVE}


class WorkspaceViewSet(viewsets.ModelViewSet):
    """User-added workspaces. Anyone may list the active ones and create one;
    only administrators edit, archive or restore them. Access on create follows
    the team rules above. ``?archived=1`` lists the archive (admin, lazy-purges)."""

    serializer_class = WorkspaceSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None
    lookup_field = "key"

    def _require_admin(self):
        u = self.request.user
        if not (u.is_superuser or u.has_capability(Capability.ADMINISTER)):
            raise PermissionDenied("Only administrators can manage workspaces.")

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return Workspace.objects.none()
        if self.request.query_params.get("archived") in ("1", "true"):
            self._require_admin()
            purge_expired_workspaces()          # self-maintain whenever the archive is viewed
            return Workspace.objects.filter(archived_at__isnull=False)
        return Workspace.objects.filter(archived_at__isnull=True)

    def perform_create(self, serializer):
        # Anyone may create a workspace; archiving/editing stays admin-only.
        label = serializer.validated_data["label"]
        key = _unique_workspace_key(label)
        # The domain (Researcher XOR Executive) is forced by the creator's team,
        # else the chosen domain. It fixes which team members can be added later.
        domain = _resolve_domain(self.request.user, self.request.data.get("domain"))
        ws = serializer.save(key=key, created_by=self.request.user, domain=domain)
        # The creator becomes the first member with full edit — unless they're a
        # supervisor (IT / Management / admin), who already see every workspace.
        if not is_supervisor(self.request.user):
            WorkspaceMember.objects.get_or_create(
                user=self.request.user, workspace=key,
                defaults={"access": WorkspaceMember.EDIT, "added_by": self.request.user})
        record(action=AuditAction.CREATE, obj=ws,
               new_value={"workspace": key, "name": label, "kind": "workspace", "domain": domain},
               request=self.request)

    def perform_update(self, serializer):
        self._require_admin()
        serializer.save()

    def perform_destroy(self, instance):
        # Delete = archive; the hard purge happens after the TTL.
        self._require_admin()
        instance.archived_at = timezone.now()
        instance.save(update_fields=["archived_at"])
        record(action=AuditAction.DELETE, obj=instance,
               old_value={"workspace": instance.key, "name": instance.label, "kind": "workspace"},
               request=self.request)

    @action(detail=True, methods=["post"])
    def restore(self, request, key=None):
        self._require_admin()
        ws = Workspace.objects.filter(key=key).first()
        if not ws:
            raise NotFound("Workspace not found.")
        ws.archived_at = None
        ws.save(update_fields=["archived_at"])
        record(action=AuditAction.UPDATE, obj=ws,
               new_value={"workspace": ws.key, "name": ws.label, "kind": "workspace", "restored": True},
               request=request)
        return Response(WorkspaceSerializer(ws).data)


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


class WorkspaceMemberViewSet(viewsets.ModelViewSet):
    """Per-user workspace membership (need-to-know access).

    A Researcher/Executive sees a workspace only if they hold a row here. Any
    member of a workspace — as well as supervisors (IT/Management/admin) — may
    list, add and remove members. Added members must belong to the workspace's
    domain team and receive full edit. Keyed by the ``workspace`` string so it
    works for both built-in and user-added workspaces."""

    serializer_class = WorkspaceMemberSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        qs = WorkspaceMember.objects.select_related("user", "added_by").all()
        ws = self.request.query_params.get("workspace")
        if ws:
            qs = qs.filter(workspace=ws)
        # You can see the membership of any workspace you can view.
        return _scope_to_viewable(qs, self.request.user)

    def _require_manage(self, workspace):
        if not can_edit(self.request.user, workspace):
            raise PermissionDenied("Only a member of this workspace can manage its people.")

    def perform_create(self, serializer):
        workspace = serializer.validated_data["workspace"]
        target = serializer.validated_data["user"]
        self._require_manage(workspace)
        if WorkspaceMember.objects.filter(user=target, workspace=workspace).exists():
            raise ValidationError({"user": "This person is already a member of this workspace."})
        allowed = _addable_role_names(workspace_domain(workspace))
        if not target.roles.filter(name__in=allowed).exists():
            raise ValidationError({"user": "This person isn't on the team for this workspace."})
        member = serializer.save(access=WorkspaceMember.EDIT, added_by=self.request.user)
        record(action=AuditAction.CREATE, obj=member,
               new_value={"workspace": workspace, "kind": "member",
                          "name": member.user.get_full_name() or member.user.username},
               request=self.request)

    def perform_destroy(self, instance):
        self._require_manage(instance.workspace)
        name = instance.user.get_full_name() or instance.user.username
        ws, oid = instance.workspace, str(instance.pk)
        instance.delete()
        record(action=AuditAction.DELETE, object_type="WorkspaceMember", object_id=oid,
               old_value={"workspace": ws, "name": name, "kind": "member"},
               request=self.request)

    @action(detail=False, methods=["get"])
    def addable(self, request):
        """Users who may be added to ``?workspace=`` — the domain team, minus
        those already members. Returns ``{domain, users:[{id,name,email,role}]}``."""
        workspace = request.query_params.get("workspace")
        if not workspace:
            return Response({"domain": None, "users": []})
        self._require_manage(workspace)
        domain = workspace_domain(workspace)
        member_ids = set(
            WorkspaceMember.objects.filter(workspace=workspace).values_list("user_id", flat=True))
        candidates = (
            User.objects.filter(roles__name__in=_addable_role_names(domain), is_active=True)
            .exclude(id__in=member_ids).distinct().order_by("first_name", "username")
        )
        users = [{
            "id": u.id,
            "name": u.get_full_name() or u.username,
            "email": u.email,
            "role": next(iter(u.roles.values_list("name", flat=True)), ""),
        } for u in candidates]
        return Response({"domain": domain, "users": users})


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
