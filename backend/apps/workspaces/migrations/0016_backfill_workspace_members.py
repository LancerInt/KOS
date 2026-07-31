"""Backfill per-user membership from the old per-role permission grid.

The switch to need-to-know access (``WorkspaceMember``) would otherwise hide
every workspace from existing Researchers/Executives until they were reassigned.
To preserve today's visibility on deploy we:

* turn each Researcher/Executive ``WorkspacePermission`` row into a
  ``WorkspaceMember`` for every user holding that role (IT Team / Management
  rows are ignored — they're now blanket supervisors), and
* stamp the domain on existing user-added workspaces (inferred from their rows).

Administrators then trim each person down to their real workspaces.
"""
from __future__ import annotations

from django.db import migrations

DOMAIN_ROLE = {"Researcher": "research", "Executive": "executive"}


def backfill(apps, schema_editor):
    WorkspacePermission = apps.get_model("workspaces", "WorkspacePermission")
    WorkspaceMember = apps.get_model("workspaces", "WorkspaceMember")
    Workspace = apps.get_model("workspaces", "Workspace")

    # 1) memberships from the domain-team permission rows
    seen: set[tuple[int, str]] = set()
    new_members = []
    for perm in WorkspacePermission.objects.select_related("role").all():
        if perm.role.name not in DOMAIN_ROLE:
            continue
        for user in perm.role.users.all():
            key = (user.id, perm.workspace)
            if key in seen:
                continue
            seen.add(key)
            new_members.append(WorkspaceMember(user=user, workspace=perm.workspace, access="edit"))
    if new_members:
        WorkspaceMember.objects.bulk_create(new_members, ignore_conflicts=True)

    # 2) domain on existing user-added workspaces (inferred from their perms)
    for ws in Workspace.objects.all():
        names = set(
            WorkspacePermission.objects.filter(workspace=ws.key).values_list("role__name", flat=True))
        if "Executive" in names:
            ws.domain = "executive"
        elif "Researcher" in names:
            ws.domain = "research"
        else:
            ws.domain = ""
        ws.save(update_fields=["domain"])


def noop_reverse(apps, schema_editor):
    # Reversing just drops the members table (handled by 0015 unapply); nothing
    # to undo here beyond leaving the inferred domains in place.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("workspaces", "0015_workspace_domain_workspacemember"),
    ]

    operations = [
        migrations.RunPython(backfill, noop_reverse),
    ]
