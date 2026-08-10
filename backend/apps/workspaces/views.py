"""API for workspace projects, their sections and category records, plus the
per-role workspace permission table.

Projects are filtered by ``?workspace=``; sections and records by ``?project=``
(records also by ``?category=``). Reads are scoped to workspaces the user may
view; creating/deleting requires ``edit`` access to that workspace.
"""
from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from django.utils.text import slugify
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import Role
from apps.accounts.permissions import IsAdministrator
from apps.accounts.rbac import Capability
from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.notifications.models import NotificationEvent
from apps.notifications.services import notify, notify_many

from .access import (
    SUPERVISOR_ROLE_NAMES, base_access, can_edit, can_open_project, can_view,
    effective_access, is_supervisor, project_scope_q,
)
from .export import build_workbook, project_rows
from .models import (
    ARCHIVE_TTL_DAYS, Workspace, WorkspaceMember, WorkspacePermission, WorkspaceProject,
    WorkspaceProjectMember, WorkspaceRecord, WorkspaceRecordAttachment, WorkspaceSection,
    WorkspaceUserAccess,
)
from .serializers import (
    WorkspaceMemberSerializer, WorkspacePermissionSerializer, WorkspaceProjectMemberSerializer,
    WorkspaceProjectSerializer, WorkspaceRecordSerializer, WorkspaceSectionSerializer,
    WorkspaceSerializer,
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


def _scope_to_open_projects(qs, user, path: str = ""):
    """:func:`_scope_to_viewable` plus the per-project member gate.

    Use this wherever project content is read — projects, their sections and
    their records — so a project narrowed to a roster stays out of every list,
    not just the one the roster is edited from. ``path`` is the lookup prefix
    reaching the project (``""`` on projects themselves).
    """
    qs = _scope_to_viewable(qs, user)
    gate = project_scope_q(user, path)
    # distinct(): the gate joins the member table, which can repeat a row.
    return qs if gate is None else qs.filter(gate).distinct()


def _unique_workspace_key(label: str) -> str:
    base = slugify(label)[:56] or "workspace"
    taken = set(Workspace.objects.values_list("key", flat=True)) | set(BUILTIN_WORKSPACE_KEYS)
    key, i = base, 2
    while key in taken:
        key, i = f"{base}-{i}", i + 1
    return key


def purge_expired_workspaces() -> int:
    """Hard-delete archived workspaces (and all their content) past the TTL.

    Built-in workspaces are exempt: they live in the frontend config and can't be
    truly deleted, so an archived built-in is a *tombstone* that hides it
    indefinitely (restorable anytime) — never auto-purged, and its content kept."""
    cutoff = timezone.now() - timedelta(days=Workspace.ARCHIVE_TTL_DAYS)
    n = 0
    for ws in (
        Workspace.objects.filter(archived_at__isnull=False, archived_at__lt=cutoff)
        .exclude(key__in=BUILTIN_WORKSPACE_KEYS)
    ):
        ws.purge_contents()
        ws.delete()
        n += 1
    return n


def purge_expired_deleted_items() -> int:
    """Permanently remove soft-deleted projects/sections/records past the TTL.
    Purging a project cascades its sections/records; purging a section takes its
    whole subtree, and every record under it, via the database cascade."""
    cutoff = timezone.now() - timedelta(days=ARCHIVE_TTL_DAYS)
    n = 0
    expired = list(WorkspaceSection.objects.filter(deleted_at__isnull=False, deleted_at__lt=cutoff))
    expired_ids = {s.pk for s in expired}
    # Only purge subtree roots: a child section, its records and their
    # attachments all ride down on the parent's cascade.
    for sec in [s for s in expired if s.parent_id not in expired_ids]:
        subtree = sec.descendants(include_self=True)
        # Records still linked only by name — written against a built-in section
        # that had no row when they were created.
        WorkspaceRecord.objects.filter(
            project=sec.project, section__isnull=True,
            category__in=[s.name for s in subtree],
        ).delete()
        sec.delete()          # cascades child sections + their records + attachments
        n += len(subtree)
    n += WorkspaceRecord.objects.filter(deleted_at__isnull=False, deleted_at__lt=cutoff).delete()[0]
    n += WorkspaceProject.objects.filter(deleted_at__isnull=False, deleted_at__lt=cutoff).delete()[0]
    return n


def _editable_workspace_keys(user):
    """Workspace keys the user may edit, or None if they may edit everything
    (a supervisor)."""
    acc = effective_access(user)
    if acc is None:
        return None
    return {k for k, v in acc.items() if v == "edit"}


def _restore_name(model, row) -> str:
    """A name that won't collide with a live sibling when restoring ``row``."""
    base = row.name
    clash = model.objects.filter(workspace=row.workspace, name=base, deleted_at__isnull=True)
    if model is WorkspaceSection:
        # Sibling-scoped, matching the uniqueness constraints: a name only
        # clashes with sections sharing this one's parent.
        clash = model.objects.filter(project=row.project, name=base, deleted_at__isnull=True)
        clash = (clash.filter(parent__isnull=True) if row.parent_id is None
                 else clash.filter(parent_id=row.parent_id))
    if clash.exclude(pk=row.pk).exists():
        return f"{base} (restored)"[:model._meta.get_field("name").max_length]
    return base


def approver_users():
    """Everyone who may approve a submitted project — IT Team, Management and
    superusers. Used to notify the pool when something is submitted."""
    return list(
        User.objects.filter(
            Q(is_superuser=True) | Q(roles__name__in=SUPERVISOR_ROLE_NAMES), is_active=True
        ).distinct()
    )


def _require_edit(user, workspace):
    if not can_edit(user, workspace):
        raise PermissionDenied("You don't have edit access to this workspace.")


def _require_project_edit(user, project, workspace=""):
    """Edit rights on the workspace *and* a way into this particular project.
    Writes to a project's own content all go through here. ``workspace`` is the
    fallback for content that hangs off no project (legacy records)."""
    _require_edit(user, project.workspace if project is not None else workspace)
    if project is not None and not can_open_project(user, project):
        raise PermissionDenied("This project is limited to its members.")


# ---- Audit value builders -------------------------------------------------
# Each carries the workspace key + a human name (+ parent context) so the audit
# trail reads "which project / section / record, in which workspace".

def _proj_val(project) -> dict:
    return {"workspace": project.workspace, "name": project.name, "kind": "project"}


def _sec_val(section) -> dict:
    # Context carries the whole trail, so a nested section reads as
    # "Project › Parent › Sub" rather than just its project.
    trail = " › ".join(a.name for a in reversed(section.ancestors()))
    context = section.project.name if section.project_id else ""
    if trail:
        context = f"{context} › {trail}" if context else trail
    return {"workspace": section.workspace, "name": section.name, "kind": "section",
            "context": context}


def _rec_val(rec) -> dict:
    headline = ""
    if isinstance(rec.data, dict):
        headline = next((str(v) for v in rec.data.values() if v), "")
    trail = rec.section.path_label() if rec.section_id else rec.category
    context = f"{rec.project.name} › {trail}" if rec.project_id else trail
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


def _ensure_workspace_member(user, workspace, actor):
    """Let ``user`` into ``workspace`` if nothing already does.

    Joining a project has to carry workspace access with it, or the person would
    hold a key to a room they can't walk to. Someone who *can* already see the
    workspace is left exactly as they are — a view-only role grant stays
    view-only, since joining one project is no reason to widen their rights over
    everything else in there. Supervisors need no row at all."""
    if user is None or is_supervisor(user) or can_view(user, workspace):
        return
    WorkspaceMember.objects.get_or_create(
        user=user, workspace=workspace,
        defaults={"access": WorkspaceMember.EDIT, "added_by": actor})


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
        # Renamed built-ins live here as is_builtin rows (the client folds them
        # into config as label overrides); archived built-in tombstones are kept
        # out by the archived_at filter, so nothing doubles in the sidebar.
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

    def update(self, request, *args, **kwargs):
        """Editing a built-in workspace creates its row on the way through.

        The eleven built-ins are frontend config and have no row until something
        needs one — renaming is the first thing that does. The client sends the
        identity it ships with (icon, accent, blurb) alongside the new label, so
        the row stands in for the built-in completely from here on.
        """
        key = kwargs.get(self.lookup_field) or ""
        if key and not Workspace.objects.filter(key=key).exists():
            self._require_admin()
            data = request.data
            Workspace.objects.create(
                key=key,
                label=(data.get("label") or key).strip(),
                blurb=(data.get("blurb") or "").strip(),
                icon=data.get("icon") or "folder",
                accent=data.get("accent") or "",
                domain=BUILTIN_WORKSPACE_DOMAIN.get(key, ""),
                is_builtin=True,
                created_by=request.user,
            )
        return super().update(request, *args, **kwargs)

    def perform_update(self, serializer):
        self._require_admin()
        was_label = serializer.instance.label
        ws = serializer.save()
        if ws.label != was_label:
            record(action=AuditAction.UPDATE, obj=ws,
                   old_value={"workspace": ws.key, "name": was_label, "kind": "workspace"},
                   new_value={"workspace": ws.key, "name": ws.label, "kind": "workspace"},
                   request=self.request)

    def destroy(self, request, *args, **kwargs):
        # Deleting a workspace archives it (recoverable from the Archive). A
        # built-in is config, so archiving one flags a tombstone row for its key;
        # the client drops any archived built-in from the sidebar, so it truly
        # disappears (rather than silently reverting to its config name). Dynamic
        # workspaces take the standard path below.
        self._require_admin()
        key = kwargs.get(self.lookup_field) or ""
        if key in BUILTIN_WORKSPACE_KEYS:
            ws = Workspace.objects.filter(key=key).first()
            if ws is None:
                # Never renamed → a pure tombstone. Blank label so a later restore
                # reverts cleanly to the config name (a rename would set one).
                ws = Workspace.objects.create(
                    key=key, label="", is_builtin=True,
                    domain=BUILTIN_WORKSPACE_DOMAIN.get(key, ""), created_by=request.user,
                )
            ws.archived_at = timezone.now()
            ws.save(update_fields=["archived_at"])
            record(action=AuditAction.DELETE, obj=ws,
                   old_value={"workspace": key, "name": ws.label or key, "kind": "workspace", "builtin": True},
                   request=request)
            return Response(status=204)
        return super().destroy(request, *args, **kwargs)

    def perform_destroy(self, instance):
        # Dynamic workspace: delete = archive; the hard purge happens after the
        # TTL. (Built-in keys are handled in destroy() above.)
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
        # A built-in that only ever held a tombstone (no custom label) returns to
        # pure config — drop the row. One that also carried a rename keeps it.
        if ws.is_builtin and not ws.label:
            record(action=AuditAction.UPDATE, obj=ws,
                   new_value={"workspace": key, "name": key, "kind": "workspace",
                              "restored": True, "builtin": True},
                   request=request)
            ws.delete()
            return Response({"restored": True, "key": key})
        ws.archived_at = None
        ws.save(update_fields=["archived_at"])
        record(action=AuditAction.UPDATE, obj=ws,
               new_value={"workspace": ws.key, "name": ws.label, "kind": "workspace", "restored": True},
               request=request)
        return Response(WorkspaceSerializer(ws).data)

    @action(detail=False, methods=["get"], url_path="hidden-builtins")
    def hidden_builtins(self, request):
        """Built-in workspace keys an admin has archived. Every authenticated user
        needs these to drop the hidden built-ins from their own sidebar."""
        keys = list(
            Workspace.objects.filter(archived_at__isnull=False, key__in=BUILTIN_WORKSPACE_KEYS)
            .values_list("key", flat=True)
        )
        return Response({"keys": keys})


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


class WorkspaceUserAccessView(APIView):
    """Per-**user** workspace access — the "who sees what" grid, by person.

    Administrators only. Sits on top of role + team-membership grants:

    * ``GET ?user=<id>`` → ``{"user", "is_supervisor", "access": {ws: level}}``
      where ``access`` is the person's effective, post-override access (anything
      absent is hidden).
    * ``POST {user, permissions:[{workspace, access}]}`` with access in
      ``view | edit | hidden``. An override row is stored only where the choice
      differs from what the person already gets from their role/membership — so
      ``hidden`` genuinely denies, and redundant rows are never created.
    """

    permission_classes = [IsAdministrator]

    def _target(self, request):
        uid = request.query_params.get("user") or request.data.get("user")
        user = User.objects.filter(pk=uid).first()
        if user is None:
            raise NotFound("User not found.")
        return user

    def get(self, request):
        user = self._target(request)
        acc = effective_access(user)
        return Response({
            "user": user.id,
            "is_supervisor": acc is None,
            "access": {} if acc is None else acc,
        })

    def post(self, request):
        user = self._target(request)
        base = base_access(user) or {}
        valid = {WorkspaceUserAccess.HIDDEN, WorkspaceUserAccess.VIEW, WorkspaceUserAccess.EDIT}
        saved = 0
        for p in request.data.get("permissions", []):
            ws = p.get("workspace")
            desired = p.get("access")
            if not ws or desired not in valid:
                continue
            if desired == base.get(ws, WorkspaceUserAccess.HIDDEN):
                # Matches what role/membership already grants → no override needed.
                WorkspaceUserAccess.objects.filter(user=user, workspace=ws).delete()
            else:
                WorkspaceUserAccess.objects.update_or_create(
                    user=user, workspace=ws,
                    defaults={"access": desired, "updated_by": request.user},
                )
            saved += 1
        record(action=AuditAction.PERMISSION_CHANGE, obj=user,
               new_value={"kind": "workspace_user_access", "changed": saved}, request=request)
        return Response({"saved": saved, "access": effective_access(user)})


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


class WorkspaceProjectExportView(APIView):
    """The dashboard's project list as a formatted Excel workbook.

    Administrators only — this is the whole portfolio in one file, which is a
    different thing from the per-workspace access the rest of the app grants.
    Still routed through the ordinary scoping rule rather than reading the table
    raw, so the export can never be the one door that ignores it.
    """

    permission_classes = [IsAuthenticated, IsAdministrator]

    def get(self, request):
        projects = (
            _scope_to_open_projects(
                WorkspaceProject.objects.filter(deleted_at__isnull=True), request.user)
            .select_related("created_by")
            .prefetch_related("members__user", "members__added_by")
            .order_by("workspace", "name")
        )
        rows = project_rows(projects)
        record(action=AuditAction.EXPORT, object_type="WorkspaceProject",
               new_value={"kind": "dashboard_xlsx", "rows": len(rows)}, request=request)

        stamp = timezone.localtime(timezone.now()).strftime("%Y-%m-%d")
        response = HttpResponse(
            build_workbook(rows),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = f'attachment; filename="kos-projects-{stamp}.xlsx"'
        return response


class WorkspaceProjectMemberViewSet(viewsets.ModelViewSet):
    """Per-user membership of a single **project** (need-to-know, one tier below
    :class:`WorkspaceMemberViewSet`).

    A project with no members is open to its whole workspace; listing anyone
    closes it to that list. Members are drawn from the workspace's domain team,
    and joining a project also joins its workspace, so a member can actually
    reach what they've been given. Anyone who can edit the workspace *and* open
    the project may manage its roster; supervisors always can."""

    serializer_class = WorkspaceProjectMemberSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        qs = WorkspaceProjectMember.objects.select_related("user", "added_by", "project")
        project = self.request.query_params.get("project")
        if project:
            qs = qs.filter(project=project)
        # Scoped through the project so the roster of a project you can't open
        # isn't readable either.
        return qs.filter(project__in=_scope_to_open_projects(
            WorkspaceProject.objects.filter(deleted_at__isnull=True), self.request.user))

    def _project(self, pk):
        project = WorkspaceProject.objects.filter(pk=pk, deleted_at__isnull=True).first() if pk else None
        if project is None:
            raise NotFound("Project not found.")
        return project

    def _require_manage(self, project):
        if project.deleted_at is not None:
            # It's in the Archive; restore it before handing out keys to it.
            raise NotFound("Project not found.")
        _require_project_edit(self.request.user, project)

    def _seed_roster(self, project, skip_user_id=None):
        """Adding the first member closes a project that was open to the whole
        workspace. Seed the roster with the two people who most obviously belong
        on it — whoever created the project and whoever is doing the adding — so
        closing it never silently locks out either of them. Supervisors are
        skipped: they see every project without a row. Either can be removed
        afterwards if that really was the intent."""
        if project.members.exists():
            return
        for user in (project.created_by, self.request.user):
            if user is None or user.pk == skip_user_id or is_supervisor(user):
                continue
            WorkspaceProjectMember.objects.get_or_create(
                project=project, user=user, defaults={"added_by": self.request.user})
            _ensure_workspace_member(user, project.workspace, self.request.user)

    def perform_create(self, serializer):
        project = serializer.validated_data["project"]
        target = serializer.validated_data["user"]
        self._require_manage(project)
        if WorkspaceProjectMember.objects.filter(project=project, user=target).exists():
            raise ValidationError({"user": "This person is already on this project."})
        allowed = _addable_role_names(workspace_domain(project.workspace))
        if not target.roles.filter(name__in=allowed).exists():
            raise ValidationError({"user": "This person isn't on the team for this workspace."})
        self._seed_roster(project, skip_user_id=target.pk)
        member = serializer.save(added_by=self.request.user)
        # A project member who can't open the workspace couldn't reach the
        # project either, so joining one joins the other.
        _ensure_workspace_member(target, project.workspace, self.request.user)
        record(action=AuditAction.CREATE, obj=member,
               new_value={"workspace": project.workspace, "kind": "project_member",
                          "context": project.name,
                          "name": member.user.get_full_name() or member.user.username},
               request=self.request)

    def perform_destroy(self, instance):
        self._require_manage(instance.project)
        name = instance.user.get_full_name() or instance.user.username
        project, oid = instance.project, str(instance.pk)
        instance.delete()
        record(action=AuditAction.DELETE, object_type="WorkspaceProjectMember", object_id=oid,
               old_value={"workspace": project.workspace, "name": name,
                          "kind": "project_member", "context": project.name},
               request=self.request)

    @action(detail=False, methods=["get"])
    def addable(self, request):
        """Users who may be added to ``?project=`` — the workspace's domain team,
        minus those already on it. Same shape as the workspace endpoint:
        ``{domain, users:[{id,name,email,role}]}``."""
        project = self._project(request.query_params.get("project"))
        self._require_manage(project)
        domain = workspace_domain(project.workspace)
        member_ids = set(
            WorkspaceProjectMember.objects.filter(project=project).values_list("user_id", flat=True))
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
        qs = WorkspaceProject.objects.select_related("created_by").filter(deleted_at__isnull=True)
        workspace = self.request.query_params.get("workspace")
        if workspace:
            qs = qs.filter(workspace=workspace)
        return _scope_to_open_projects(qs, self.request.user)

    def perform_create(self, serializer):
        _require_edit(self.request.user, serializer.validated_data.get("workspace"))
        project = serializer.save(created_by=self.request.user)
        record(action=AuditAction.CREATE, obj=project, new_value=_proj_val(project), request=self.request)

    def perform_update(self, serializer):
        _require_project_edit(self.request.user, serializer.instance)
        project = serializer.save()
        record(action=AuditAction.UPDATE, obj=project, new_value=_proj_val(project), request=self.request)

    def perform_destroy(self, instance):
        # Soft-delete: the project (with its sections/records) stays recoverable
        # from the Archive for the TTL, then is purged.
        _require_project_edit(self.request.user, instance)
        instance.deleted_at = timezone.now()
        instance.deleted_by = self.request.user
        instance.save(update_fields=["deleted_at", "deleted_by"])
        record(action=AuditAction.DELETE, obj=instance, old_value=_proj_val(instance), request=self.request)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """Toggle a project's completed state (closes the duration loop)."""
        project = self.get_object()
        _require_project_edit(request.user, project)
        if project.completed_at:
            project.completed_at = None
            project.duration_notified_at = None
            project.reminders_sent = []          # reopened → reminders may fire again
        else:
            project.completed_at = timezone.now()
            project.review_state = WorkspaceProject.REVIEW_NONE   # done → no pending review
            project.review_reason = ""
        project.save(update_fields=["completed_at", "duration_notified_at", "reminders_sent", "review_state", "review_reason"])
        record(action=AuditAction.STATUS_CHANGE, obj=project,
               new_value={**_proj_val(project), "completed": bool(project.completed_at)}, request=request)
        return Response(self.get_serializer(project).data)

    # ---- Approval workflow: submit → approve / send back ------------------- #
    def _require_approver(self, user):
        if not is_supervisor(user):
            raise PermissionDenied("Only IT Team or Management can approve or send back a project.")

    def _project_url(self, project) -> str:
        return f"/workspaces/{project.workspace}/projects/{project.id}"

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        """Owner/editor submits a project for approval → notifies the approvers."""
        project = self.get_object()
        _require_project_edit(request.user, project)
        if project.completed_at:
            raise ValidationError({"detail": "This project is already completed."})
        project.review_state = WorkspaceProject.REVIEW_DECISION   # awaiting a decision
        project.submitted_at = timezone.now()
        project.submitted_by = request.user
        project.review_reason = ""
        project.reviewed_at = None
        project.reviewed_by = None
        project.save(update_fields=[
            "review_state", "submitted_at", "submitted_by", "review_reason", "reviewed_at", "reviewed_by"])
        who = request.user.get_full_name() or request.user.username
        notify_many(approver_users(), exclude=[request.user],
                    event=NotificationEvent.REVIEW_REQUESTED,
                    title=f"Approval needed: {project.name}",
                    body=f"{who} submitted “{project.name}” for approval.",
                    url=self._project_url(project))
        record(action=AuditAction.STATUS_CHANGE, obj=project,
               new_value={**_proj_val(project), "submitted": True}, request=request)
        return Response(self.get_serializer(project).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        """Approver signs off → the project is marked completed; owner notified."""
        project = self.get_object()
        self._require_approver(request.user)
        project.completed_at = timezone.now()
        project.review_state = WorkspaceProject.REVIEW_NONE
        project.review_reason = ""
        project.reviewed_at = timezone.now()
        project.reviewed_by = request.user
        project.save(update_fields=[
            "completed_at", "review_state", "review_reason", "reviewed_at", "reviewed_by"])
        who = request.user.get_full_name() or request.user.username
        recipient = project.submitted_by or project.created_by
        notify(recipient, event=NotificationEvent.REVIEW_DECISION,
               title=f"Approved: {project.name}",
               body=f"{who} approved “{project.name}”. It's now complete.",
               url=self._project_url(project))
        record(action=AuditAction.STATUS_CHANGE, obj=project,
               new_value={**_proj_val(project), "approved": True}, request=request)
        return Response(self.get_serializer(project).data)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        """Approver sends the project back with a reason → owner notified."""
        project = self.get_object()
        self._require_approver(request.user)
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            raise ValidationError({"reason": "Please describe what needs to change."})
        project.review_state = WorkspaceProject.REVIEW_BLOCKED
        project.review_reason = reason[:500]
        project.reviewed_at = timezone.now()
        project.reviewed_by = request.user
        project.completed_at = None          # sent back — not completed
        project.save(update_fields=[
            "review_state", "review_reason", "reviewed_at", "reviewed_by", "completed_at"])
        who = request.user.get_full_name() or request.user.username
        recipient = project.submitted_by or project.created_by
        notify(recipient, event=NotificationEvent.REVIEW_DECISION,
               title=f"Sent back: {project.name}",
               body=f"{who} sent “{project.name}” back: {project.review_reason}",
               url=self._project_url(project))
        record(action=AuditAction.STATUS_CHANGE, obj=project,
               new_value={**_proj_val(project), "rejected": True, "reason": project.review_reason},
               request=request)
        return Response(self.get_serializer(project).data)


class WorkspaceRecordViewSet(viewsets.ModelViewSet):
    serializer_class = WorkspaceRecordSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None  # small volumes; return the full list for counts + drawer

    def get_queryset(self):
        qs = (
            WorkspaceRecord.objects.select_related("created_by", "section")
            .prefetch_related("attachments")
            .filter(deleted_at__isnull=True)
            .exclude(project__deleted_at__isnull=False)   # ride along with a deleted project
        )
        params = self.request.query_params
        project = params.get("project")
        category = params.get("category")
        section = params.get("section")
        if project:
            qs = qs.filter(project=project)
        if section:
            qs = qs.filter(section=section)
        if category:
            # Legacy filter — ambiguous once sections nest, since two in
            # different branches may share a name. New clients send ?section=.
            qs = qs.filter(category=category)
        return _scope_to_open_projects(qs, self.request.user, "project")

    def perform_create(self, serializer):
        project = serializer.validated_data.get("project")
        ws = project.workspace if project else ""
        _require_project_edit(self.request.user, project, ws)
        rec = serializer.save(created_by=self.request.user, workspace=ws)
        # Multiple files arrive under the "attachments" key of the multipart body.
        for f in self.request.FILES.getlist("attachments"):
            WorkspaceRecordAttachment.objects.create(record=rec, file=f)
        record(action=AuditAction.CREATE, obj=rec, new_value=_rec_val(rec), request=self.request)

    def perform_destroy(self, instance):
        # Soft-delete → recoverable from the Archive for the TTL.
        _require_project_edit(self.request.user, instance.project, instance.workspace)
        instance.deleted_at = timezone.now()
        instance.deleted_by = self.request.user
        instance.save(update_fields=["deleted_at", "deleted_by"])
        record(action=AuditAction.DELETE, obj=instance, old_value=_rec_val(instance), request=self.request)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        """Toggle a record's completed state (closes / reopens its duration)."""
        rec = self.get_object()
        _require_project_edit(request.user, rec.project, rec.workspace)
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
        # Keep hidden/deleted sections in the list (the project page shows them as
        # restore chips); only drop those under a deleted project.
        qs = (
            WorkspaceSection.objects.select_related("created_by", "parent")
            .exclude(project__deleted_at__isnull=False)
        )
        project = self.request.query_params.get("project")
        if project:
            qs = qs.filter(project=project)
        return _scope_to_open_projects(qs, self.request.user, "project")

    def _mark_deleted(self, section):
        # `hidden` is persisted here too. It used to be set in memory by
        # perform_destroy and then dropped by this update_fields list, so a
        # DELETEd section stayed hidden=False in the database and kept
        # rendering on the project grid.
        section.hidden = True
        section.deleted_at = timezone.now()
        section.deleted_by = self.request.user
        section.save(update_fields=["hidden", "deleted_at", "deleted_by"])

    def perform_create(self, serializer):
        project = serializer.validated_data.get("project")
        ws = project.workspace if project else ""
        _require_project_edit(self.request.user, project, ws)
        section = serializer.save(created_by=self.request.user, workspace=ws)
        # Adoption backfill. A built-in section only becomes a row the first time
        # someone customises or deletes it, so records written before that carry
        # its name with no FK behind them. Claim them now — from here on this row
        # owns them, and a later rename can no longer strand them.
        if project is not None and section.parent_id is None:
            WorkspaceRecord.objects.filter(
                project=project, section__isnull=True, category__iexact=section.name,
            ).update(section=section, category=section.name)
        # A section created already-hidden is a built-in being removed (deleted).
        if section.hidden:
            self._mark_deleted(section)
            record(action=AuditAction.DELETE, obj=section, old_value=_sec_val(section), request=self.request)
        else:
            record(action=AuditAction.CREATE, obj=section, new_value=_sec_val(section), request=self.request)

    def perform_update(self, serializer):
        # Hiding a section removes it from the grid AND files it in the Archive
        # (deleted_at); its records are kept so a restore brings it back intact.
        # Descendants are deliberately left alone — a sub-section is effectively
        # hidden whenever an ancestor is, so a restore returns the subtree exactly
        # as the user left it (a child they deleted separately stays deleted).
        _require_project_edit(
            self.request.user, serializer.instance.project, serializer.instance.workspace)
        was_hidden = serializer.instance.hidden
        was_name = serializer.instance.name
        section = serializer.save()
        if section.name != was_name:
            # Keep the denormalised mirror true. Before records carried a FK, a
            # plain rename orphaned every record under the section.
            section.records.update(category=section.name)
        if section.hidden and not was_hidden:
            self._mark_deleted(section)
            record(action=AuditAction.DELETE, obj=section, old_value=_sec_val(section), request=self.request)
        elif was_hidden and not section.hidden:
            section.deleted_at = None
            section.deleted_by = None
            section.save(update_fields=["deleted_at", "deleted_by"])
            record(action=AuditAction.UPDATE, obj=section,
                   new_value={**_sec_val(section), "restored": True}, request=self.request)
        else:
            record(action=AuditAction.UPDATE, obj=section, new_value=_sec_val(section), request=self.request)

    def perform_destroy(self, instance):
        # Soft-delete: hide it and file it in the Archive, keeping its records so
        # a restore is intact. Purged (with those records) after the TTL.
        _require_project_edit(self.request.user, instance.project, instance.workspace)
        instance.hidden = True
        self._mark_deleted(instance)
        record(action=AuditAction.DELETE, obj=instance, old_value=_sec_val(instance), request=self.request)


RESTORE_MODELS = {
    "project": WorkspaceProject,
    "section": WorkspaceSection,
    "record": WorkspaceRecord,
}


class WorkspaceDeletedItemsView(APIView):
    """The Archive of deleted workspace content — projects, sections and records.

    Everything deleted is recoverable here for 30 days, then purged. A member
    sees (and can restore) deletions in the workspaces they can edit, plus
    anything they deleted themselves; supervisors (IT Team / Management / admin)
    see everything, with **who** deleted it and **when**. POST ``{kind, id}``
    restores an item; the same TTL/purge model as archived workspaces."""

    permission_classes = [IsAuthenticated]

    def _visible(self, user):
        """Soft-deleted rows the user may see. Sections/records whose project is
        itself deleted are left out — they restore together with the project, and
        so does a sub-section under a deleted parent."""
        purge_expired_deleted_items()            # self-maintain whenever viewed
        projects = WorkspaceProject.objects.filter(deleted_at__isnull=False).select_related("deleted_by")
        sections = (WorkspaceSection.objects.filter(deleted_at__isnull=False)
                    .exclude(project__deleted_at__isnull=False)
                    .exclude(parent__deleted_at__isnull=False)
                    .select_related("deleted_by", "project", "parent"))
        records = (WorkspaceRecord.objects.filter(deleted_at__isnull=False)
                   .exclude(project__deleted_at__isnull=False).select_related("deleted_by", "project"))
        keys = _editable_workspace_keys(user)
        if keys is not None:                     # a member: their editable workspaces + their own deletions
            scope = lambda qs: qs.filter(Q(workspace__in=keys) | Q(deleted_by=user))
            projects, sections, records = scope(projects), scope(sections), scope(records)
            # ...and never a project (or its content) whose roster excludes them:
            # what the project page hides shouldn't reappear in the Archive.
            projects = projects.filter(project_scope_q(user)).distinct()
            gate = project_scope_q(user, "project")
            sections, records = sections.filter(gate).distinct(), records.filter(gate).distinct()
        return projects, sections, records

    def _row(self, kind, row, name, context):
        left = ARCHIVE_TTL_DAYS - (timezone.now() - row.deleted_at).days
        actor = (row.deleted_by.get_full_name() or row.deleted_by.username) if row.deleted_by_id else "System"
        return {
            "id": row.id, "kind": kind, "name": name or "(untitled)",
            "workspace": row.workspace, "context": context, "actor": actor,
            "at": row.deleted_at, "days_left": max(0, left),
        }

    def get(self, request):
        projects, sections, records = self._visible(request.user)
        items = [self._row("project", p, p.name, "") for p in projects]
        items += [self._row("section", s, s.name, _sec_val(s)["context"]) for s in sections]
        for rec in records:
            headline = next((str(v) for v in rec.data.values() if v), "") if isinstance(rec.data, dict) else ""
            trail = rec.section.path_label() if rec.section_id else rec.category
            context = f"{rec.project.name} › {trail}" if rec.project_id else trail
            items.append(self._row("record", rec, headline or rec.category, context))
        items.sort(key=lambda x: x["at"], reverse=True)
        return Response({"is_supervisor": is_supervisor(request.user), "items": items})

    def post(self, request):
        """Restore a soft-deleted item back into its workspace: ``{kind, id}``."""
        model = RESTORE_MODELS.get(request.data.get("kind"))
        oid = request.data.get("id")
        if not model or not oid:
            raise ValidationError("Provide a valid kind and id.")
        row = model.objects.filter(pk=oid, deleted_at__isnull=False).first()
        if not row:
            raise NotFound("That item isn't in the Archive.")
        if not (is_supervisor(request.user) or can_edit(request.user, row.workspace)):
            raise PermissionDenied("You don't have edit access to restore this item.")
        # A section/record belonging to a project you can't open isn't yours to
        # restore either. (A deleted project carries its own roster, so the same
        # check reads straight off it.)
        gated = row if model is WorkspaceProject else row.project
        if gated is not None and not can_open_project(request.user, gated):
            raise PermissionDenied("This project is limited to its members.")
        if model is WorkspaceSection and row.parent_id and row.parent.deleted_at is not None:
            # Restoring into a deleted parent would put it somewhere invisible.
            raise ValidationError("Restore the parent section first.")
        fields = ["deleted_at", "deleted_by"]
        row.deleted_at = None
        row.deleted_by = None
        if model in (WorkspaceProject, WorkspaceSection):
            restored_name = _restore_name(model, row)
            if restored_name != row.name:
                row.name = restored_name
                fields.append("name")
        if model is WorkspaceSection:
            row.hidden = False
            fields.append("hidden")
        row.save(update_fields=fields)
        if model is WorkspaceSection:
            # A collision may have renamed it. The records hold a FK so they
            # survive that, but their `category` mirror has to follow.
            row.records.update(category=row.name)
        record(action=AuditAction.UPDATE, obj=row,
               new_value={"workspace": row.workspace, "name": getattr(row, "name", ""),
                          "kind": request.data.get("kind"), "restored": True}, request=request)
        return Response({"restored": True, "kind": request.data.get("kind"), "id": row.id})
