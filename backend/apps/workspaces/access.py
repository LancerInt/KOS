"""Resolve a user's effective per-workspace access.

Access is **need-to-know**, resolved in two tiers:

* **Supervisors** — superusers, anyone with the ``administer`` capability (IT
  Team) and the Management team — see and edit *every* workspace. Represented by
  ``effective_access() is None``.
* **Everyone else** (Researchers / Executives) — see a workspace only if they
  hold a ``WorkspaceMember`` row for it. A member always has full ``edit``.

Access comes from two **additive** sources (highest level wins): a user's own
``WorkspaceMember`` rows (need-to-know, full edit), and the workspaces granted to
any of their roles in the ``WorkspacePermission`` grid (Roles & Access →
Workspace permissions).

One tier further in, an individual **project** may narrow that again — see
:func:`can_open_project`.
"""
from __future__ import annotations

from django.db.models import Q

from .models import WorkspaceMember, WorkspacePermission, WorkspaceUserAccess

_RANK = {"": 0, None: 0, "view": 1, "edit": 2}

# Teams that see every workspace without an explicit membership.
SUPERVISOR_ROLE_NAMES = frozenset({"IT Team", "Management"})


def is_workspace_admin(user) -> bool:
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    try:
        return "administer" in user.effective_capabilities()
    except Exception:
        return False


def is_supervisor(user) -> bool:
    """A see-everything user: admin (superuser / ``administer`` / IT Team) or
    the Management team. Supervisors bypass per-user membership entirely."""
    if is_workspace_admin(user):
        return True
    if not user or not user.is_authenticated:
        return False
    return user.roles.filter(name__in=SUPERVISOR_ROLE_NAMES).exists()


def approver_ids() -> set[int]:
    """IDs of everyone who may approve a submitted project — superusers, IT Team
    and Management. Used both to notify the pool and to decide, in a one-approver
    org, whether self-approval is the only way forward."""
    from django.contrib.auth import get_user_model

    User = get_user_model()
    return set(
        User.objects.filter(
            Q(is_superuser=True) | Q(roles__name__in=SUPERVISOR_ROLE_NAMES), is_active=True
        ).values_list("id", flat=True)
    )


def base_access(user) -> dict[str, str] | None:
    """Role + team-membership grants, *before* per-user admin overrides.

    Two additive sources, highest access wins: the user's own ``WorkspaceMember``
    rows, and the workspaces granted to any of their roles in the
    ``WorkspacePermission`` grid. ``None`` means a supervisor (all workspaces).
    """
    if is_supervisor(user):
        return None
    if not user or not user.is_authenticated:
        return {}
    out: dict[str, str] = {}

    def grant(workspace: str, access: str) -> None:
        if _RANK.get(access, 0) > _RANK.get(out.get(workspace), 0):
            out[workspace] = access

    for m in WorkspaceMember.objects.filter(user=user).values("workspace", "access"):
        grant(m["workspace"], m["access"])
    role_ids = list(user.roles.values_list("id", flat=True))
    if role_ids:
        for p in WorkspacePermission.objects.filter(role_id__in=role_ids).values("workspace", "access"):
            grant(p["workspace"], p["access"])
    return out


def effective_access(user) -> dict[str, str] | None:
    """Final per-workspace access: :func:`base_access` with the per-user
    overrides from :class:`WorkspaceUserAccess` applied on top. An explicit
    override wins over role/membership, and ``hidden`` denies a workspace
    outright. ``None`` still means a supervisor (all workspaces)."""
    base = base_access(user)
    if base is None:
        return None
    for o in WorkspaceUserAccess.objects.filter(user=user).values("workspace", "access"):
        if o["access"] == WorkspaceUserAccess.HIDDEN:
            base.pop(o["workspace"], None)
        else:
            base[o["workspace"]] = o["access"]
    return base


def workspace_members(workspace: str) -> list:
    """Active users with **explicit** view/edit access to ``workspace``.

    The reverse of :func:`effective_access`, scoped to one workspace: members,
    role grants and per-user overrides, with ``hidden`` removing a user. This is
    the workspace's *assigned team* — it deliberately excludes supervisors'
    implicit see-everything access, so an overdue reminder reaches the people the
    workspace belongs to without pinging every admin about every workspace.
    """
    from django.contrib.auth import get_user_model

    User = get_user_model()
    granted: dict[int, str] = {}

    def grant(uid: int, access: str) -> None:
        if _RANK.get(access, 0) > _RANK.get(granted.get(uid), 0):
            granted[uid] = access

    for m in WorkspaceMember.objects.filter(workspace=workspace).values("user_id", "access"):
        grant(m["user_id"], m["access"])
    for rp in WorkspacePermission.objects.filter(workspace=workspace).values("role_id", "access"):
        for uid in User.objects.filter(roles__id=rp["role_id"], is_active=True).values_list("id", flat=True):
            grant(uid, rp["access"])
    for o in WorkspaceUserAccess.objects.filter(workspace=workspace).values("user_id", "access"):
        if o["access"] == WorkspaceUserAccess.HIDDEN:
            granted.pop(o["user_id"], None)
        else:
            grant(o["user_id"], o["access"])

    ids = [uid for uid, level in granted.items() if _RANK.get(level, 0) >= 1]
    return list(User.objects.filter(id__in=ids, is_active=True))


def can_view(user, workspace: str) -> bool:
    acc = effective_access(user)
    return acc is None or acc.get(workspace) in ("view", "edit")


def can_edit(user, workspace: str) -> bool:
    acc = effective_access(user)
    return acc is None or acc.get(workspace) == "edit"


# ---- Per-project membership ------------------------------------------------
# A project may narrow its workspace's access to a named few. The rule is
# "empty means open": no member rows → whoever can open the workspace can open
# the project. Only once someone is listed does the project become members-only.
# That is what keeps every project that predates the feature visible, and it
# makes emptying the roster the way to re-open one.


def can_open_project(user, project) -> bool:
    """Whether ``user`` may open this project, given the workspace already lets
    them in. Supervisors are never gated."""
    if is_supervisor(user):
        return True
    if not user or not user.is_authenticated or project is None:
        return False
    member_ids = set(project.members.values_list("user_id", flat=True))
    return not member_ids or user.id in member_ids


def project_scope_q(user, path: str = "") -> Q | None:
    """A ``Q`` narrowing a queryset to the projects ``user`` may open.

    ``path`` is the lookup prefix reaching the project — ``""`` for a
    ``WorkspaceProject`` queryset, ``"project"`` for its sections, records or
    members. ``None`` means "no restriction" (a supervisor), so callers can skip
    the filter (and the ``distinct()`` its join would need) entirely.
    """
    if is_supervisor(user):
        return None
    if not user or not user.is_authenticated:
        return Q(pk__in=[])
    prefix = f"{path}__" if path else ""
    # Rows hanging off no project at all (records predating the project FK) are
    # governed by their workspace alone — nothing here should hide them.
    q = Q(**{f"{prefix}members__isnull": True}) | Q(**{f"{prefix}members__user": user})
    return (q | Q(**{f"{path}__isnull": True})) if path else q
