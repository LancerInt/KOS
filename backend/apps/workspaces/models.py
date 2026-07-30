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
from django.utils import timezone


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
        return {"status": "none"}
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
    Amazon USA). Deleting it removes its sections and records."""

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

    class Meta:
        ordering = ("-created_at",)
        constraints = [
            models.UniqueConstraint(fields=["workspace", "name"], name="uniq_workspace_project"),
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


class WorkspaceRecord(models.Model):
    project = models.ForeignKey(
        WorkspaceProject, null=True, blank=True,
        on_delete=models.CASCADE, related_name="records",
    )
    workspace = models.CharField(max_length=64)   # e.g. "amazon-usa" (mirrors project.workspace)
    category = models.CharField(max_length=80)     # e.g. "Product"
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


class WorkspaceSection(models.Model):
    """A user-created section within a project, added on top of the built-in
    ones defined on the frontend. Each behaves like a category with a single
    Description field."""

    project = models.ForeignKey(
        WorkspaceProject, null=True, blank=True,
        on_delete=models.CASCADE, related_name="sections",
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
    # off this project's grid (custom sections are hard-deleted instead).
    hidden = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="workspace_sections",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("created_at",)
        constraints = [
            models.UniqueConstraint(fields=["project", "name"], name="uniq_project_section"),
        ]

    def __str__(self) -> str:
        return f"{self.workspace}/{self.name}"
