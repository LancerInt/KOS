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
"""
from __future__ import annotations

from .models import WorkspaceMember, WorkspacePermission

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


def effective_access(user) -> dict[str, str] | None:
    """{workspace: 'view'|'edit'} for this user, or None meaning 'all workspaces, edit'.

    Two additive sources, highest access wins: the user's own ``WorkspaceMember``
    rows, and the workspaces granted to any of their roles in the
    ``WorkspacePermission`` grid.
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
        for p in WorkspacePermission.objects.filter(
            role_id__in=role_ids
        ).values("workspace", "access"):
            grant(p["workspace"], p["access"])
    return out


def can_view(user, workspace: str) -> bool:
    acc = effective_access(user)
    return acc is None or acc.get(workspace) in ("view", "edit")


def can_edit(user, workspace: str) -> bool:
    acc = effective_access(user)
    return acc is None or acc.get(workspace) == "edit"
