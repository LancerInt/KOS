"""Give every record a real link to its section.

Until now a record found its section by name: ``WorkspaceRecord.category`` held
the section's *name* as a bare string. That worked only while sections were a
flat list — two sub-sections in different branches may share a name, so the name
alone can no longer identify one. ``WorkspaceRecord.section`` is now the link;
``category`` stays as a denormalised mirror for search, notifications and admin.

Two steps, in order:

1. **Adopt.** A built-in section (defined in the frontend config) has no database
   row until someone customises it, so a lot of live records point at a name with
   nothing behind it. Create the missing rows. This is the same "adoption" the UI
   already performs on first edit, and it is invisible: an adopted row with an
   empty ``fields`` list falls back to the config defaults on render.
2. **Link.** Point every record at its row, and normalise ``category`` to the
   row's exact name — repairing historical drift from renames (including the
   "(restored)" rename in ``views._restore_name``, which used to orphan records
   outright) and from case differences the case-sensitive frontend filter drops.

Reversible: ``category`` is preserved throughout, so unlinking is lossless.
"""
from django.db import migrations


def _key(project_id, name: str) -> tuple:
    return (project_id, (name or "").strip().lower())


def forwards(apps, schema_editor):
    Record = apps.get_model("workspaces", "WorkspaceRecord")
    Section = apps.get_model("workspaces", "WorkspaceSection")
    Project = apps.get_model("workspaces", "WorkspaceProject")

    # --- index the sections that already exist -------------------------------
    # At most one *live* row may hold a name within a project; prefer it, and
    # otherwise the most recently deleted one (its records are purged with it,
    # so it is the right owner).
    best: dict[tuple, dict] = {}
    for s in Section.objects.values("id", "project_id", "name", "deleted_at"):
        k = _key(s["project_id"], s["name"])
        cur = best.get(k)
        if cur is None:
            best[k] = s
        elif cur["deleted_at"] is not None and (
            s["deleted_at"] is None or s["deleted_at"] > cur["deleted_at"]
        ):
            best[k] = s

    # --- step 1: adopt the built-ins that records actually refer to ----------
    workspace_of = dict(Project.objects.values_list("id", "workspace"))
    missing: dict[tuple, tuple] = {}          # key -> (project_id, exact name)
    for pid, cat in Record.objects.values_list("project_id", "category").distinct():
        if pid is None or not (cat or "").strip():
            continue                          # nothing to hang a section off
        k = _key(pid, cat)
        if k not in best and k not in missing:
            missing[k] = (pid, cat.strip())

    for k, (pid, name) in missing.items():
        created = Section.objects.create(
            project_id=pid,
            workspace=workspace_of.get(pid, ""),
            name=name,
            blurb="",
            fields=[],                        # empty => the config defaults win
            hidden=False,
        )
        best[k] = {"id": created.id, "project_id": pid, "name": name, "deleted_at": None}

    # --- step 2: link every record, then true up the mirror ------------------
    by_section: dict[int, list[int]] = {}
    rows = Record.objects.filter(section__isnull=True).values_list("id", "project_id", "category")
    for rid, pid, cat in rows.iterator(chunk_size=2000):
        s = best.get(_key(pid, cat))
        if s is not None:
            by_section.setdefault(s["id"], []).append(rid)

    for sid, ids in by_section.items():
        for i in range(0, len(ids), 1000):
            Record.objects.filter(pk__in=ids[i:i + 1000]).update(section_id=sid)

    for sec in Section.objects.values("id", "name"):
        Record.objects.filter(section_id=sec["id"]).exclude(category=sec["name"]).update(
            category=sec["name"]
        )


def backwards(apps, schema_editor):
    # `category` was never dropped, so records stay resolvable by name.
    # The sections adopted above are left in place: they are indistinguishable
    # from ones a user customised, and deleting them would take real records
    # with them once the FK cascade exists.
    apps.get_model("workspaces", "WorkspaceRecord").objects.update(section=None)


class Migration(migrations.Migration):

    dependencies = [
        ("workspaces", "0020_remove_workspacesection_uniq_project_section_active_and_more"),
    ]

    operations = [migrations.RunPython(forwards, backwards)]
