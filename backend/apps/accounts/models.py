"""Accounts & RBAC models (PRD §6, §7, §10.5).

* Department / Team      — organisational structure
* Role / RoleCapability  — dynamic roles = Capability × Scope (§7.1, §7.5)
* User                   — custom user; roles are dynamic, not Django groups

A user's **effective permission** is the union of capabilities across their
roles, each held at the broadest scope any role grants (§7.4). Project-level
membership then *further constrains* this — see ``apps.projects.scoping``.
"""
from __future__ import annotations

from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models

from apps.core.models import TimeStampedModel

from .rbac import Capability, Scope, broadest_scope


class Department(TimeStampedModel):
    name = models.CharField(max_length=120, unique=True)
    code = models.CharField(max_length=20, unique=True)

    class Meta:
        ordering = ("name",)

    def __str__(self) -> str:
        return self.name


class Team(TimeStampedModel):
    name = models.CharField(max_length=120)
    department = models.ForeignKey(
        Department, on_delete=models.CASCADE, related_name="teams"
    )

    class Meta:
        ordering = ("name",)
        unique_together = ("name", "department")

    def __str__(self) -> str:
        return f"{self.name} ({self.department.code})"


class Role(TimeStampedModel):
    """A dynamic role (PRD §7.1: 'roles are data, not code').

    Created, renamed, edited and deleted at runtime by an Administrator with no
    deployment. Capabilities are held through ``RoleCapability``; ``default_scope``
    applies to any capability that does not override it.
    """

    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    is_system = models.BooleanField(
        default=False,
        help_text="Seeded default template role. Still fully editable (§6.2).",
    )
    default_scope = models.CharField(
        max_length=20, choices=Scope.choices, default=Scope.PROJECT
    )

    class Meta:
        ordering = ("name",)

    def __str__(self) -> str:
        return self.name

    def capability_scopes(self) -> dict[str, str]:
        """Map capability -> effective scope for this role."""
        return {
            rc.capability: (rc.scope or self.default_scope)
            for rc in self.role_capabilities.all()
        }


class RoleCapability(models.Model):
    """One capability granted to a role, optionally at an overriding scope."""

    role = models.ForeignKey(
        Role, on_delete=models.CASCADE, related_name="role_capabilities"
    )
    capability = models.CharField(max_length=40, choices=Capability.choices)
    scope = models.CharField(
        max_length=20,
        choices=Scope.choices,
        blank=True,
        help_text="Overrides the role default scope when set.",
    )

    class Meta:
        unique_together = ("role", "capability")
        ordering = ("capability",)

    def __str__(self) -> str:
        return f"{self.role.name}:{self.capability}@{self.scope or self.role.default_scope}"


class User(AbstractUser):
    """Custom user. Login is by username; email is unique and required."""

    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=30, blank=True)
    avatar = models.ImageField(upload_to="avatars/", blank=True, null=True)

    department = models.ForeignKey(
        Department,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="members",
    )
    teams = models.ManyToManyField(Team, blank=True, related_name="members")
    roles = models.ManyToManyField(Role, blank=True, related_name="users")

    # MFA (PRD §32) — required for privileged users.
    mfa_enabled = models.BooleanField(default=False)
    mfa_secret = models.CharField(max_length=64, blank=True)

    class Meta:
        ordering = ("username",)

    def __str__(self) -> str:
        return self.get_full_name() or self.username

    # --- RBAC helpers ------------------------------------------------------ #
    @property
    def is_privileged(self) -> bool:
        """True if any role requires MFA (PRD §32)."""
        privileged = set(getattr(settings, "PRIVILEGED_ROLE_NAMES", []))
        return self.roles.filter(name__in=privileged).exists()

    def effective_capabilities(self) -> dict[str, str]:
        """Union of capabilities across roles, each at its broadest scope (§7.4).

        Superusers implicitly hold every capability at Organisation scope.
        """
        if self.is_superuser:
            return {c.value: Scope.ORGANISATION.value for c in Capability}

        merged: dict[str, list[str]] = {}
        for role in self.roles.all():
            for cap, scope in role.capability_scopes().items():
                merged.setdefault(cap, []).append(scope)
        return {cap: broadest_scope(scopes) for cap, scopes in merged.items()}

    def scope_for(self, capability: str) -> str | None:
        """Broadest scope at which the user holds ``capability``, else None."""
        return self.effective_capabilities().get(capability)

    def has_capability(self, capability: str) -> bool:
        return capability in self.effective_capabilities()
