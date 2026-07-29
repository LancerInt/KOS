"""RBAC primitives for KOS (PRD §7).

Roles are **data, not code** (§7.1). A role is a set of capabilities, each held
at a scope. This module defines the fixed vocabulary the Administrator composes
roles from:

* ``Capability`` — the 12 atomic permissions (§7.5, App. C.12)
* ``Scope``      — the breadth a capability applies to (§7.2, App. C.10)
* ``ProjectRole``— the role a member holds *on a project* (§7.4, App. C.11)

Nothing here is hardcoded per job title; these are building blocks.
"""
from __future__ import annotations

from django.db import models


class Capability(models.TextChoices):
    """Atomic permissions (PRD §7.5 / Appendix C.12)."""

    VIEW = "view", "View"
    COMMENT = "comment", "Comment"
    UPDATE_ASSIGNED = "update_assigned", "Update assigned work"
    CREATE_TASKS = "create_tasks", "Create tasks"
    ASSIGN_TASKS = "assign_tasks", "Assign tasks"
    MANAGE_BACKLOG = "manage_backlog", "Manage backlog & sprint"
    APPROVE = "approve", "Approve deliverables"
    MANAGE_PROJECT = "manage_project", "Manage project"
    MANAGE_WORKFLOWS = "manage_workflows", "Manage workflows"
    VIEW_REPORTS = "view_reports", "View reports"
    EXPORT_DATA = "export_data", "Export data"
    ADMINISTER = "administer", "Administer system"


class Scope(models.TextChoices):
    """The breadth a capability applies to (PRD §7.2 / Appendix C.10)."""

    ORGANISATION = "organisation", "Organisation"
    PORTFOLIO = "portfolio", "Portfolio"
    PROJECT = "project", "Project"
    OWN = "own", "Own"


class ProjectRole(models.TextChoices):
    """Role a user holds on a specific project (PRD §7.4 / Appendix C.11)."""

    OWNER = "owner", "Owner"
    MANAGER = "manager", "Manager"
    CONTRIBUTOR = "contributor", "Contributor"
    REVIEWER = "reviewer", "Reviewer"
    VIEWER = "viewer", "Viewer"


# Broadest → narrowest. Index = rank; lower rank means broader reach.
SCOPE_ORDER: list[str] = [
    Scope.ORGANISATION,
    Scope.PORTFOLIO,
    Scope.PROJECT,
    Scope.OWN,
]


def scope_rank(scope: str) -> int:
    """Rank a scope; broader scopes rank lower. Unknown scopes rank last."""
    try:
        return SCOPE_ORDER.index(scope)
    except ValueError:
        return len(SCOPE_ORDER)


def broadest_scope(scopes: list[str]) -> str:
    """Return the broadest scope in ``scopes`` (PRD §7.4 — union of roles)."""
    return min(scopes, key=scope_rank)


def scope_covers(held: str, required: str) -> bool:
    """True if a capability ``held`` at one scope satisfies a ``required`` scope.

    Organisation covers everything; Project does not cover Portfolio/Org, etc.
    """
    return scope_rank(held) <= scope_rank(required)
