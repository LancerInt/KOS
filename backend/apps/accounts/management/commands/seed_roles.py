"""Seed the 8 default template roles (PRD §6.2, Appendix D).

These are **starting templates only** — under dynamic RBAC (§7) the Administrator
may rename, edit, delete or add roles at runtime. Idempotent: re-running updates
capabilities in place. Run with:  python manage.py seed_roles
"""
from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.accounts.models import Role, RoleCapability
from apps.accounts.rbac import Capability as C
from apps.accounts.rbac import Scope as S

# name -> (default_scope, [(capability, scope_override_or_None), ...])
DEFAULT_ROLES: dict[str, tuple[str, list[tuple[str, str | None]]]] = {
    "Administrator": (S.ORGANISATION, [(c, S.ORGANISATION) for c in C.values]),
    "IT Team": (
        S.ORGANISATION,
        [
            (C.ADMINISTER, None), (C.MANAGE_WORKFLOWS, None), (C.MANAGE_PROJECT, None),
            (C.VIEW, None), (C.VIEW_REPORTS, None), (C.EXPORT_DATA, None), (C.COMMENT, None),
        ],
    ),
    "Management (MD / Director)": (
        S.ORGANISATION,
        [
            (C.VIEW, None), (C.COMMENT, None), (C.CREATE_TASKS, None), (C.ASSIGN_TASKS, None),
            (C.MANAGE_BACKLOG, None), (C.APPROVE, None), (C.MANAGE_PROJECT, None),
            (C.MANAGE_WORKFLOWS, None), (C.VIEW_REPORTS, None), (C.EXPORT_DATA, None),
        ],
    ),
    "Manager / Agile Lead": (
        S.PROJECT,
        [
            (C.VIEW, None), (C.COMMENT, None), (C.CREATE_TASKS, None), (C.ASSIGN_TASKS, None),
            (C.UPDATE_ASSIGNED, None), (C.MANAGE_BACKLOG, None), (C.APPROVE, None),
            (C.MANAGE_PROJECT, None), (C.MANAGE_WORKFLOWS, None), (C.VIEW_REPORTS, None),
            (C.EXPORT_DATA, None),
        ],
    ),
    "Portfolio Owner": (
        S.PORTFOLIO,
        [
            (C.VIEW, None), (C.COMMENT, None), (C.CREATE_TASKS, None), (C.ASSIGN_TASKS, None),
            (C.MANAGE_BACKLOG, None), (C.APPROVE, None), (C.MANAGE_PROJECT, None),
            (C.VIEW_REPORTS, None), (C.EXPORT_DATA, None),
        ],
    ),
    "Project Owner": (
        S.PROJECT,
        [
            (C.VIEW, None), (C.COMMENT, None), (C.CREATE_TASKS, None), (C.ASSIGN_TASKS, None),
            (C.MANAGE_BACKLOG, None), (C.APPROVE, None), (C.MANAGE_PROJECT, None),
            (C.MANAGE_WORKFLOWS, None), (C.VIEW_REPORTS, None), (C.EXPORT_DATA, None),
        ],
    ),
    "Executive / Team Member": (
        S.PROJECT,
        [
            (C.VIEW, None), (C.COMMENT, None), (C.CREATE_TASKS, None),
            (C.UPDATE_ASSIGNED, None), (C.VIEW_REPORTS, S.OWN),
        ],
    ),
    "Researcher": (
        S.PROJECT,
        [
            (C.VIEW, None), (C.COMMENT, None), (C.CREATE_TASKS, None),
            (C.UPDATE_ASSIGNED, None), (C.VIEW_REPORTS, S.OWN),
        ],
    ),
}


class Command(BaseCommand):
    help = "Seed the 8 default template roles (PRD §6.2)."

    def handle(self, *args, **options):
        created, updated = 0, 0
        for name, (default_scope, caps) in DEFAULT_ROLES.items():
            role, was_created = Role.objects.get_or_create(
                name=name, defaults={"default_scope": default_scope, "is_system": True}
            )
            if not was_created:
                role.default_scope = default_scope
                role.is_system = True
                role.save(update_fields=["default_scope", "is_system"])
                updated += 1
            else:
                created += 1

            role.role_capabilities.all().delete()
            RoleCapability.objects.bulk_create(
                [
                    RoleCapability(role=role, capability=cap, scope=(scope or ""))
                    for cap, scope in caps
                ]
            )

        self.stdout.write(
            self.style.SUCCESS(f"Roles seeded — {created} created, {updated} updated.")
        )
