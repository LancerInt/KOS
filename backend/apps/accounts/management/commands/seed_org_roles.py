"""Rebuild the working role set to the four organisational roles KOS uses:
IT Team, Executive, Management, Researcher.

Idempotent. Renames the older verbose template roles in place (so any members
they already hold are preserved), ensures the four exist with sensible
capabilities, and removes leftover template roles that have no members. New
roles can still be added at runtime from the UI (§7.1). Run with:

    python manage.py seed_org_roles
"""
from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.accounts.models import Role, RoleCapability
from apps.accounts.rbac import Capability as C
from apps.accounts.rbac import Scope as S

# clean name -> (default_scope, description, [(capability, scope_override_or_None), ...])
TARGET: dict[str, tuple[str, str, list[tuple[str, str | None]]]] = {
    "IT Team": (
        S.ORGANISATION,
        "Systems, access and technical operations — full administrative reach.",
        [
            (C.ADMINISTER, None), (C.MANAGE_WORKFLOWS, None), (C.MANAGE_PROJECT, None),
            (C.VIEW, None), (C.VIEW_REPORTS, None), (C.EXPORT_DATA, None), (C.COMMENT, None),
        ],
    ),
    "Executive": (
        S.PROJECT,
        "Team members carrying out day-to-day work.",
        [
            (C.VIEW, None), (C.COMMENT, None), (C.CREATE_TASKS, None),
            (C.UPDATE_ASSIGNED, None), (C.VIEW_REPORTS, S.OWN),
        ],
    ),
    "Management": (
        S.ORGANISATION,
        "Directors and managers overseeing the organisation.",
        [
            (C.VIEW, None), (C.COMMENT, None), (C.CREATE_TASKS, None), (C.ASSIGN_TASKS, None),
            (C.MANAGE_BACKLOG, None), (C.APPROVE, None), (C.MANAGE_PROJECT, None),
            (C.MANAGE_WORKFLOWS, None), (C.VIEW_REPORTS, None), (C.EXPORT_DATA, None),
        ],
    ),
    "Researcher": (
        S.PROJECT,
        "R&D and laboratory research staff.",
        [
            (C.VIEW, None), (C.COMMENT, None), (C.CREATE_TASKS, None),
            (C.UPDATE_ASSIGNED, None), (C.VIEW_REPORTS, S.OWN),
        ],
    ),
}

# older template names -> clean name (rename in place to keep their members)
RENAME = {
    "Executive / Team Member": "Executive",
    "Management (MD / Director)": "Management",
}


class Command(BaseCommand):
    help = "Rebuild the role set down to IT Team, Executive, Management, Researcher."

    def handle(self, *args, **options):
        # 1) Rename legacy variants to the clean names (preserves member assignments).
        for legacy, clean in RENAME.items():
            if not Role.objects.filter(name=clean).exists():
                Role.objects.filter(name=legacy).update(name=clean)

        # 2) Ensure the four target roles exist with clean capabilities.
        for name, (scope, description, caps) in TARGET.items():
            role, _ = Role.objects.get_or_create(
                name=name,
                defaults={"default_scope": scope, "is_system": True, "description": description},
            )
            role.default_scope = scope
            role.is_system = True
            role.description = description
            role.save(update_fields=["default_scope", "is_system", "description"])
            role.role_capabilities.all().delete()
            RoleCapability.objects.bulk_create(
                [RoleCapability(role=role, capability=cap, scope=(sc or "")) for cap, sc in caps]
            )

        # 3) Remove leftover template roles not in the target set — but never one
        #    that still has members assigned.
        removed, kept = [], []
        for role in Role.objects.exclude(name__in=TARGET.keys()):
            if role.users.exists():
                kept.append(role.name)
                continue
            removed.append(role.name)
            role.delete()

        self.stdout.write(self.style.SUCCESS(
            f"Roles rebuilt to {list(TARGET)}. Removed: {removed or 'none'}."
            + (f" Kept (still have members): {kept}." if kept else "")
        ))
