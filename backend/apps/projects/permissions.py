"""Project-level permissions (PRD §7.6, §7.7)."""
from __future__ import annotations

from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.accounts.rbac import Capability, ProjectRole

from .models import Membership, Project
from .scoping import visible_projects


class CanAccessProject(BasePermission):
    """Object-level visibility check.

    Returns 403 for a project the user may not see. Confidential projects the
    user isn't a member of never reach this check — they are excluded from the
    lookup queryset and 404 instead, so their existence is not revealed (§7.6).
    """

    message = "You do not have access to this project."

    def has_object_permission(self, request, view, obj) -> bool:
        project = obj if isinstance(obj, Project) else getattr(obj, "project", None)
        if project is None:
            return False
        return visible_projects(request.user, Project.objects.filter(pk=project.pk)).exists()


def can_manage_project(user, project) -> bool:
    """True if ``user`` may change ``project`` (edit it, add members/structure).

    Creating a project is open to any authenticated user (they become its owner);
    managing an *existing* one is reserved for people who either hold the org- or
    portfolio-wide ``manage_project`` capability, or who own/manage *this* project
    — its ``owner``/``manager``, or an Owner/Manager member. This lets whoever
    created a project run it without needing a system-wide management role, while
    still keeping other people's projects read-only to them (§7.4, §7.6).
    """
    if project is None or not (user and user.is_authenticated):
        return False
    if user.is_superuser or user.has_capability(Capability.MANAGE_PROJECT):
        return True
    if project.owner_id == user.pk or project.manager_id == user.pk:
        return True
    return Membership.objects.filter(
        project=project, user=user,
        project_role__in=(ProjectRole.OWNER, ProjectRole.MANAGER),
    ).exists()


class CanManageProject(BasePermission):
    """Object-level write gate for a project and its children (epics, members…).

    Reads pass through (visibility is handled by ``CanAccessProject``); writes on
    an existing object require :func:`can_manage_project`. Creation is not gated
    here — it has no object yet — so each viewset checks the *target* project in
    ``perform_create``.
    """

    message = "Only the project's owner or a manager can change this project."

    def has_object_permission(self, request, view, obj) -> bool:
        if request.method in SAFE_METHODS:
            return True
        project = obj if isinstance(obj, Project) else getattr(obj, "project", None)
        return can_manage_project(request.user, project)
