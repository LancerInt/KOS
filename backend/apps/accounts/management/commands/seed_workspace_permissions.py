"""Seed sensible default workspace access for the four core roles.

- IT Team, Management  -> edit on every workspace (oversight / admin).
- Executive            -> edit on the eight business workspaces; the rest hidden.
- Researcher           -> edit on Entomology only; the rest hidden.

Idempotent — replaces each role's rows. Administrators can retune everything on
the Roles & Access -> Permissions page. Run with:

    python manage.py seed_workspace_permissions
"""
from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.accounts.models import Role
from apps.workspaces.models import WorkspacePermission

# The 11 workspace keys (mirror features/workspaces/workspaces.tsx).
ALL_WORKSPACES = [
    "amazon-usa", "cibrc", "epa-reg", "marketing-marathon", "crm",
    "exhibition-b2c", "distribution-us", "social-media", "website-biodesk",
    "entomology", "finance-statutory",
]

EXECUTIVE_WS = [
    "amazon-usa", "cibrc", "marketing-marathon", "crm",
    "exhibition-b2c", "social-media", "website-biodesk", "finance-statutory",
]
RESEARCHER_WS = ["entomology"]

# role name -> {workspace: access}
DEFAULTS = {
    "IT Team": {ws: "edit" for ws in ALL_WORKSPACES},
    "Management": {ws: "edit" for ws in ALL_WORKSPACES},
    "Executive": {ws: "edit" for ws in EXECUTIVE_WS},
    "Researcher": {ws: "edit" for ws in RESEARCHER_WS},
}


class Command(BaseCommand):
    help = "Seed default per-role workspace access (Executive/Researcher scoped; IT/Management full)."

    def handle(self, *args, **options):
        touched = []
        for name, grants in DEFAULTS.items():
            role = Role.objects.filter(name=name).first()
            if not role:
                self.stdout.write(self.style.WARNING(f"Role {name!r} not found - run seed_org_roles first."))
                continue
            WorkspacePermission.objects.filter(role=role).delete()
            WorkspacePermission.objects.bulk_create(
                [WorkspacePermission(role=role, workspace=ws, access=acc) for ws, acc in grants.items()]
            )
            touched.append(f"{name}:{len(grants)}")
        self.stdout.write(self.style.SUCCESS(f"Workspace permissions seeded - {touched}."))
