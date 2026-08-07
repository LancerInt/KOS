"""Flexible per-category record storage for the sidebar workspaces.

The hierarchy is: **Workspace → Project → Section → Record**.

A *workspace* (e.g. "amazon-usa") is defined on the frontend. Inside it a user
creates *projects* (e.g. "Neem Oil 2026"). Each project carries the workspace's
built-in sections (defined in ``features/workspaces/workspaces.tsx``) plus any
custom sections the user adds. A *record*'s values are kept in a JSON payload
rather than fixed columns, so any section can hold records without a dedicated
table per category.
"""
from __future__ import annotations

import math
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

# Deleted projects/sections/records (and archived workspaces) are recoverable
# from the Archive for this many days, then permanently purged.
ARCHIVE_TTL_DAYS = 30

# How deep sub-sections may nest (a top-level section is depth 0). Nesting is
# unlimited in spirit; the bound exists so ancestor walks, breadcrumbs and
# cascades stay finite, and so a corrupted parent chain fails fast instead of
# hanging a request.
MAX_SECTION_DEPTH = 10


def _left_label(seconds: float) -> str:
    """A compact "time remaining" string: "2d 5h", "5h 20m", "45m", "Ended"."""
    if seconds <= 0:
        return "Ended"
    d = int(seconds // 86400)
    h = int((seconds % 86400) // 3600)
    m = int((seconds % 3600) // 60)
    if d > 0:
        return f"{d}d {h}h" if h else f"{d}d"
    if h > 0:
        return f"{h}h {m}m" if m else f"{h}h"
    return f"{max(1, m)}m"


def compute_duration_state(start_at, end_at, completed_at, now=None) -> dict:
    """Shared status summary for a timed item (project or record), to the hour.

    Durations are datetimes (start_at → end_at). Returns both hour-precise fields
    (``end_at``, ``end_label``, ``hours_left``, ``pct``, ``left_label``) and
    coarse day counts kept for the existing progress rails.
    """
    if not start_at or not end_at:
        # A start with no end isn't a countable duration (nothing to count down
        # to), but the start is still carried so the UI can show and re-edit it.
        return {"status": "none", **({"start_at": start_at.isoformat()} if start_at else {})}
    if now is None:
        now = timezone.now()
    total = (end_at - start_at).total_seconds() or 1.0
    left = (end_at - now).total_seconds()
    elapsed = max(0.0, min(total, (now - start_at).total_seconds()))
    pct = round(elapsed / total * 100)
    days_total = max(1, round(total / 86400))
    days_left = math.ceil(left / 86400) if left > 0 else 0
    days_elapsed = max(0, min(days_total, days_total - days_left))
    if completed_at:
        status = "completed"
    elif now >= end_at:
        status = "due"               # duration elapsed, awaiting results / completion
    elif left <= 86400:              # within a day
        status = "ending_soon"
    else:
        status = "active"
    local_end = timezone.localtime(end_at)
    return {
        "status": status,
        "start_at": start_at.isoformat(),
        "end_date": local_end.date().isoformat(),
        "end_at": end_at.isoformat(),
        "end_label": local_end.strftime("%d %b, %H:%M"),
        "days_total": days_total,
        "days_elapsed": days_elapsed,
        "days_left": max(0, days_left),
        "hours_left": max(0, math.ceil(left / 3600)) if left > 0 else 0,
        "pct": pct,
        "left_label": _left_label(left),
    }


class WorkspaceProject(models.Model):
    """A user-created project inside a workspace (e.g. "Neem Oil 2026" under
    Amazon USA). Deleting it soft-deletes it (and its sections/records ride
    along); the Archive can restore it for 30 days, then it's purged."""

    workspace = models.CharField(max_length=64)   # e.g. "amazon-usa"
    name = models.CharField(max_length=200)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="workspace_projects",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    # Optional timed duration — start → end, to the hour.
    start_at = models.DateTimeField(null=True, blank=True)
    end_at = models.DateTimeField(null=True, blank=True)
    # Legacy date-only fields (kept as the migration source; no longer written).
    start_date = models.DateField(null=True, blank=True)
    duration_days = models.PositiveIntegerField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    # When the "duration complete" notification was sent — prevents duplicates.
    duration_notified_at = models.DateTimeField(null=True, blank=True)
    # Which staged reminders (due-7 / due-1 / due / overdue) have already fired.
    reminders_sent = models.JSONField(default=list, blank=True)
    # Soft-delete → recoverable from the Archive, auto-purged after the TTL.
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            # Only one *live* project per name per workspace — a soft-deleted one
            # frees the name so a replacement can reuse it.
            models.UniqueConstraint(
                fields=["workspace", "name"], condition=Q(deleted_at__isnull=True),
                name="uniq_workspace_project_active",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.workspace}/{self.name}"

    @property
    def end_date(self):
        return timezone.localtime(self.end_at).date() if self.end_at else None

    def duration_state(self, now=None) -> dict:
        return compute_duration_state(self.start_at, self.end_at, self.completed_at, now)


class WorkspacePermission(models.Model):
    """Per-role access to a workspace. A missing row = no access (hidden).
    ``view`` = can see projects/records but not add or delete them;
    ``edit`` = full control (add/delete projects, sections, records)."""

    VIEW = "view"
    EDIT = "edit"
    ACCESS_CHOICES = [(VIEW, "View"), (EDIT, "Edit")]

    role = models.ForeignKey(
        "accounts.Role", on_delete=models.CASCADE, related_name="workspace_permissions",
    )
    workspace = models.CharField(max_length=64)   # e.g. "amazon-usa"
    access = models.CharField(max_length=8, choices=ACCESS_CHOICES, default=VIEW)

    class Meta:
        ordering = ("workspace",)
        constraints = [
            models.UniqueConstraint(fields=["role", "workspace"], name="uniq_role_workspace_perm"),
        ]

    def __str__(self) -> str:
        return f"{self.role_id}:{self.workspace}={self.access}"


class WorkspaceMember(models.Model):
    """Per-**user** access to a workspace (need-to-know). A Researcher/Executive
    sees a workspace only if they have a row here; IT Team, Management and admins
    see every workspace without one (they're supervisors — see ``access.py``).

    A member holds full ``edit`` (see + add + edit + delete records) and may add
    or remove other members of the same domain team from the workspace."""

    VIEW = "view"
    EDIT = "edit"
    ACCESS_CHOICES = [(VIEW, "View"), (EDIT, "Edit")]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="workspace_memberships",
    )
    workspace = models.CharField(max_length=64)   # e.g. "amazon-usa"
    access = models.CharField(max_length=8, choices=ACCESS_CHOICES, default=EDIT)
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("workspace", "id")
        constraints = [
            models.UniqueConstraint(fields=["user", "workspace"], name="uniq_user_workspace_member"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}@{self.workspace}={self.access}"


class WorkspaceUserAccess(models.Model):
    """Admin per-**user** override of workspace access, layered on top of the
    role and team-membership grants resolved in ``access.py``.

    * ``view`` / ``edit`` — force an exact level for this one person.
    * ``hidden``          — explicitly deny a workspace they would otherwise see
                            (through their role or a team membership).

    Managed from the per-user *Workspace access* screen (administrators only).
    A row is stored only where the admin's choice differs from what the person
    already gets from their role/membership, so this table stays small and a
    ``hidden`` row genuinely means "deny", not merely "no grant"."""

    HIDDEN = "hidden"
    VIEW = "view"
    EDIT = "edit"
    ACCESS_CHOICES = [(HIDDEN, "Hidden"), (VIEW, "View"), (EDIT, "Edit")]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="workspace_overrides",
    )
    workspace = models.CharField(max_length=64)   # e.g. "amazon-usa"
    access = models.CharField(max_length=8, choices=ACCESS_CHOICES)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("user_id", "workspace")
        constraints = [
            models.UniqueConstraint(fields=["user", "workspace"], name="uniq_user_workspace_override"),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}~{self.workspace}={self.access}"


class WorkspaceRecord(models.Model):
    project = models.ForeignKey(
        WorkspaceProject, null=True, blank=True,
        on_delete=models.CASCADE, related_name="records",
    )
    workspace = models.CharField(max_length=64)   # e.g. "amazon-usa" (mirrors project.workspace)
    # The section this record belongs to. ``category`` is a denormalised mirror
    # of ``section.name``, kept for search, notifications and the admin — the FK
    # is the source of truth. Two sections in different branches of the tree may
    # share a name, so the name alone can no longer identify one.
    section = models.ForeignKey(
        "WorkspaceSection", null=True, blank=True,
        on_delete=models.CASCADE, related_name="records",
    )
    category = models.CharField(max_length=120)    # e.g. "Product" (mirrors section.name)
    data = models.JSONField(default=dict)          # {field label: value}
    # Optional attachment (document / poster / PPT), for categories that allow it.
    attachment = models.FileField(upload_to="workspace_records/", null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="workspace_records",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    # Optional timed duration for this record (Entomology step-by-step), to the hour.
    start_at = models.DateTimeField(null=True, blank=True)
    end_at = models.DateTimeField(null=True, blank=True)
    # Legacy date-only fields (migration source; no longer written).
    start_date = models.DateField(null=True, blank=True)
    duration_days = models.PositiveIntegerField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    duration_notified_at = models.DateTimeField(null=True, blank=True)
    # Soft-delete → recoverable from the Archive, auto-purged after the TTL.
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["project", "category"])]

    def __str__(self) -> str:
        return f"{self.workspace}/{self.category} #{self.pk}"

    @property
    def end_date(self):
        return timezone.localtime(self.end_at).date() if self.end_at else None

    def duration_state(self, now=None) -> dict:
        return compute_duration_state(self.start_at, self.end_at, self.completed_at, now)


class WorkspaceRecordAttachment(models.Model):
    """One of possibly many files attached to a workspace record. (The record's
    own ``attachment`` field remains for the single-file records created before
    this table existed.)"""

    record = models.ForeignKey(WorkspaceRecord, on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField(upload_to="workspace_records/")
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("id",)

    @property
    def name(self) -> str:
        return self.file.name.rsplit("/", 1)[-1] if self.file else ""

    def __str__(self) -> str:
        return self.name


class WorkspaceSection(models.Model):
    """A user-created section within a project, added on top of the built-in
    ones defined on the frontend. Each behaves like a category with a single
    Description field.

    Sections nest: a section may hold sub-sections to any depth, and a
    sub-section is a section in every respect — its own field schema, its own
    records, its own delete/restore. A section keeps its own records *and* its
    children at the same time; nesting never displaces what is already there."""

    project = models.ForeignKey(
        WorkspaceProject, null=True, blank=True,
        on_delete=models.CASCADE, related_name="sections",
    )
    # Self-reference builds the tree. CASCADE is deliberate: the only hard
    # delete is the Archive purge, and a purge must take the whole subtree with
    # it. Soft deletes never reach this — see the note on ``hidden`` below.
    parent = models.ForeignKey(
        "self", null=True, blank=True,
        on_delete=models.CASCADE, related_name="children",
    )
    workspace = models.CharField(max_length=64)    # mirrors project.workspace
    name = models.CharField(max_length=120)
    blurb = models.CharField(max_length=300, blank=True)
    # Typed field schema for this section — a list of field definitions
    # ({id, type, label, placeholder, help, required, options}). Empty = use the
    # workspace's built-in default fields. Built-in sections also get a row here
    # once their fields are customised (the row "adopts" the built-in section).
    fields = models.JSONField(default=list, blank=True)
    # Per-project removal of a built-in section: a hidden row keeps that section
    # off this project's grid. A deleted section is also hidden — ``deleted_at``
    # marks it for the Archive (restore within the TTL, else purge). Records are
    # kept until purge so a restore brings the section back intact.
    #
    # Hiding does NOT touch descendants. A sub-section is *effectively* hidden
    # whenever an ancestor is, which is what lets a restore return the subtree
    # exactly as the user left it — a child they had separately deleted stays
    # deleted, and nothing has to remember which rows a cascade touched.
    hidden = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="workspace_sections",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    # Soft-delete → recoverable from the Archive, auto-purged after the TTL.
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )

    class Meta:
        ordering = ("created_at",)
        constraints = [
            # Uniqueness is per *sibling group*, not per project: "Documents"
            # may exist under two different parents. Two partial constraints
            # rather than one on (project, parent, name), because SQL treats
            # NULLs as distinct — a single constraint would never fire for
            # top-level sections, where parent IS NULL. (Postgres 15+ can say
            # NULLS NOT DISTINCT, but SQLite — which development runs on —
            # cannot, and a constraint that exists in only one environment is
            # worse than none.)
            models.UniqueConstraint(
                fields=["project", "name"],
                condition=Q(deleted_at__isnull=True, parent__isnull=True),
                name="uniq_project_root_section_active",
            ),
            models.UniqueConstraint(
                fields=["project", "parent", "name"],
                condition=Q(deleted_at__isnull=True, parent__isnull=False),
                name="uniq_project_child_section_active",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.workspace}/{self.name}"

    def ancestors(self) -> list["WorkspaceSection"]:
        """This section's parents, nearest first. Walks with a visited set so a
        cycle that somehow reached the database cannot hang the process."""
        chain, seen, node = [], {self.pk}, self.parent
        while node is not None and node.pk not in seen:
            chain.append(node)
            seen.add(node.pk)
            node = node.parent
        return chain

    @property
    def depth(self) -> int:
        """0 for a top-level section, 1 for its children, and so on."""
        return len(self.ancestors())

    def path_label(self) -> str:
        """"Product › Variants › EU" — the trail from the root, for audit."""
        return " › ".join([s.name for s in reversed(self.ancestors())] + [self.name])

    def is_effectively_hidden(self) -> bool:
        """True when this section or any ancestor is hidden or deleted."""
        if self.hidden or self.deleted_at:
            return True
        return any(a.hidden or a.deleted_at for a in self.ancestors())

    def descendants(self, include_self: bool = False) -> list["WorkspaceSection"]:
        """The whole subtree, from a single query over the project's sections."""
        kids: dict[int, list] = {}
        for row in WorkspaceSection.objects.filter(project_id=self.project_id):
            kids.setdefault(row.parent_id, []).append(row)
        out = [self] if include_self else []
        stack = list(kids.get(self.pk, []))
        while stack:
            node = stack.pop()
            out.append(node)
            stack.extend(kids.get(node.pk, []))
        return out

    def subtree_height(self) -> int:
        """1 for a leaf — how many levels this section carries with it if moved."""
        by_parent: dict[int, list] = {}
        for row in self.descendants(include_self=True):
            by_parent.setdefault(row.parent_id, []).append(row)
        height, level = 0, [self]
        while level and height <= MAX_SECTION_DEPTH + 1:
            height += 1
            level = [k for n in level for k in by_parent.get(n.pk, [])]
        return height


class Workspace(models.Model):
    """A user-added workspace. The 11 built-in workspaces live in the frontend
    config; these are the ones an admin creates at runtime. A new workspace
    starts empty — projects, sections and records are created inside it exactly
    like any other workspace (everything else keys off the ``workspace`` string).

    Deleting a workspace **archives** it (sets ``archived_at``); archived rows
    are hard-purged (with all their projects/sections/records) after 30 days
    unless restored first."""

    ARCHIVE_TTL_DAYS = ARCHIVE_TTL_DAYS

    key = models.SlugField(max_length=64, unique=True)   # e.g. "field-trials"
    label = models.CharField(max_length=120)
    blurb = models.CharField(max_length=300, blank=True)
    icon = models.CharField(max_length=40, default="folder")   # name → frontend icon registry
    accent = models.CharField(max_length=9, blank=True)         # hex "#RRGGBB"
    # Domain team this workspace belongs to — "research" | "executive" | "" (a
    # neutral/supervisor-only workspace). Decides which team's members may be
    # added to it. Built-in workspaces carry this in ``BUILTIN_WORKSPACE_DOMAIN``.
    domain = models.CharField(max_length=12, blank=True)
    order = models.PositiveIntegerField(default=0)
    archived_at = models.DateTimeField(null=True, blank=True)   # soft-delete → auto-purge after TTL
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="created_workspaces",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("order", "label")

    def __str__(self) -> str:
        return self.key

    @property
    def is_archived(self) -> bool:
        return self.archived_at is not None

    def purge_contents(self) -> None:
        """Delete everything stored under this workspace key (linked by string,
        so it isn't cascaded by the FK)."""
        WorkspaceRecord.objects.filter(workspace=self.key).delete()
        WorkspaceSection.objects.filter(workspace=self.key).delete()
        WorkspaceProject.objects.filter(workspace=self.key).delete()
        WorkspacePermission.objects.filter(workspace=self.key).delete()
        WorkspaceMember.objects.filter(workspace=self.key).delete()
        WorkspaceUserAccess.objects.filter(workspace=self.key).delete()
