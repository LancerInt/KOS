"""The core visibility rule (PRD §7.3, §7.6, §7.7).

> A user can see a project if — and only if — they hold a membership record on
> that project, OR their role carries a scope (Portfolio or Organisation) that
> encompasses it.

Confidential projects override every scope: they are visible to members only,
even to holders of Organisation scope (§7.6).

`visible_projects()` returns the filtered queryset. `ProjectScopedQuerysetMixin`
applies it in `get_queryset()` — i.e. **before pagination** (§7.7). Filtering in
the client is prohibited; this is the single source of truth for who sees what.
"""
from __future__ import annotations

from django.db.models import Q, QuerySet

from apps.accounts.rbac import Capability, Scope

from .models import Confidentiality, Membership, Project


def _member_project_ids(user) -> QuerySet:
    return Membership.objects.filter(user=user).values_list("project_id", flat=True)


def _portfolio_ids(user) -> QuerySet:
    """Portfolios the user owns or belongs to (grants Portfolio-scope reach)."""
    return (
        user.portfolios.all().values_list("id", flat=True)
        .union(user.owned_portfolios.all().values_list("id", flat=True))
    )


def visible_projects(user, base_qs: QuerySet | None = None) -> QuerySet:
    """Projects ``user`` is permitted to see."""
    qs = base_qs if base_qs is not None else Project.objects.all()

    if not user or not user.is_authenticated:
        return qs.none()
    if user.is_superuser:
        return qs

    member_ids = list(_member_project_ids(user))
    member_q = Q(id__in=member_ids)

    scope = user.scope_for(Capability.VIEW)

    # Confidential projects are members-only regardless of scope (§7.6).
    not_confidential_or_member = ~Q(confidentiality=Confidentiality.CONFIDENTIAL) | member_q

    if scope == Scope.ORGANISATION:
        return qs.filter(not_confidential_or_member).distinct()

    if scope == Scope.PORTFOLIO:
        portfolio_ids = list(_portfolio_ids(user))
        reach = member_q | Q(portfolio_id__in=portfolio_ids)
        return qs.filter(reach & not_confidential_or_member).distinct()

    # Project scope, Own scope, or no VIEW capability → membership only (§7.3).
    return qs.filter(member_q).distinct()


def lookup_queryset(user, base_qs: QuerySet | None = None) -> QuerySet:
    """Queryset used for single-object lookup.

    Broader than `visible_projects`: it hides only confidential projects the user
    isn't a member of (which must 404, never revealing their existence — §7.6).
    Non-confidential projects the user simply isn't on remain here so the object
    permission can return a clean 403 (AC-4) rather than a misleading 404.
    """
    qs = base_qs if base_qs is not None else Project.objects.all()
    if not user or not user.is_authenticated:
        return qs.none()
    if user.is_superuser:
        return qs
    member_ids = list(_member_project_ids(user))
    return qs.filter(
        ~Q(confidentiality=Confidentiality.CONFIDENTIAL) | Q(id__in=member_ids)
    )


class ProjectScopedQuerysetMixin:
    """Mixin for viewsets whose queryset is a `Project` queryset.

    Enforces the visibility rule in `get_queryset()` so it runs *before*
    pagination and applies uniformly to list, retrieve, update and delete.
    """

    def get_queryset(self):  # type: ignore[override]
        qs = super().get_queryset()
        return visible_projects(self.request.user, qs)
