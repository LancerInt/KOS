"""Capability-based DRF permissions (PRD §7.7 — the API is the authority)."""
from __future__ import annotations

from rest_framework.permissions import BasePermission

from .rbac import Capability


class HasCapability(BasePermission):
    """Grants access when the user holds ``required_capability`` (set on the view).

    Scope is enforced separately at the queryset level (see
    ``apps.projects.scoping``); this gates the *action*, scoping gates the *rows*.
    """

    def has_permission(self, request, view) -> bool:
        capability = getattr(view, "required_capability", None)
        user = request.user
        if not (user and user.is_authenticated):
            return False
        if user.is_superuser or capability is None:
            return True
        return user.has_capability(capability)


class IsAdministrator(BasePermission):
    """Full system administration (PRD §7.5 — Administer system)."""

    def has_permission(self, request, view) -> bool:
        user = request.user
        return bool(
            user
            and user.is_authenticated
            and (user.is_superuser or user.has_capability(Capability.ADMINISTER))
        )
