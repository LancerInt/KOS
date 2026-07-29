"""Resolve a user's effective per-workspace access from their roles.

Access levels: ``edit`` > ``view`` > none. A user's level for a workspace is the
highest granted across all their roles. Superusers and anyone with the
``administer`` capability (e.g. IT Team) bypass the table entirely — full edit
on every workspace, represented by ``effective_access() is None``.
"""
from __future__ import annotations

from .models import WorkspacePermission

_RANK = {"": 0, None: 0, "view": 1, "edit": 2}


def is_workspace_admin(user) -> bool:
    if not user or not user.is_authenticated:
        return False
    if user.is_superuser:
        return True
    try:
        return "administer" in user.effective_capabilities()
    except Exception:
        return False


def effective_access(user) -> dict[str, str] | None:
    """{workspace: 'view'|'edit'} for this user, or None meaning 'all workspaces, edit'."""
    if is_workspace_admin(user):
        return None
    if not user or not user.is_authenticated:
        return {}
    role_ids = list(user.roles.values_list("id", flat=True))
    out: dict[str, str] = {}
    for perm in WorkspacePermission.objects.filter(role_id__in=role_ids):
        if _RANK[perm.access] > _RANK.get(out.get(perm.workspace), 0):
            out[perm.workspace] = perm.access
    return out


def can_view(user, workspace: str) -> bool:
    acc = effective_access(user)
    return acc is None or acc.get(workspace) in ("view", "edit")


def can_edit(user, workspace: str) -> bool:
    acc = effective_access(user)
    return acc is None or acc.get(workspace) == "edit"
