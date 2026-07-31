"""Resolve a user's effective per-workspace access.

Access is **need-to-know**, resolved in two tiers:

* **Supervisors** — superusers, anyone with the ``administer`` capability (IT
  Team) and the Management team — see and edit *every* workspace. Represented by
  ``effective_access() is None``.
* **Everyone else** (Researchers / Executives) — see a workspace only if they
  hold a ``WorkspaceMember`` row for it. A member always has full ``edit``.

The old per-*role* ``WorkspacePermission`` grid is no longer consulted for
visibility; membership replaces it (rows are kept for reference / backfill).
"""
from __future__ import annotations

from .models import WorkspaceMember

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
    """{workspace: 'view'|'edit'} for this user, or None meaning 'all workspaces, edit'."""
    if is_supervisor(user):
        return None
    if not user or not user.is_authenticated:
        return {}
    out: dict[str, str] = {}
    for m in WorkspaceMember.objects.filter(user=user).values("workspace", "access"):
        if _RANK[m["access"]] > _RANK.get(out.get(m["workspace"]), 0):
            out[m["workspace"]] = m["access"]
    return out


def can_view(user, workspace: str) -> bool:
    acc = effective_access(user)
    return acc is None or acc.get(workspace) in ("view", "edit")


def can_edit(user, workspace: str) -> bool:
    acc = effective_access(user)
    return acc is None or acc.get(workspace) == "edit"
