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

from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone


def compute_duration_state(start_date, duration_days, completed_at, today=None) -> dict:
    """Shared status summary for a timed item (project or section step)."""
    if not start_date or not duration_days:
        return {"status": "none"}
    if today is None:
        today = timezone.localdate()
    end = start_date + timedelta(days=duration_days)
    total = duration_days
    elapsed = max(0, min((today - start_date).days, total))
    left = (end - today).days
    if completed_at:
        status = "completed"
    elif today >= end:
        status = "due"           # duration elapsed, awaiting results / completion
    elif left <= 3:
        status = "ending_soon"
    else:
        status = "active"
    return {
        "status": status,
        "end_date": end.isoformat(),
        "days_total": total,
        "days_elapsed": elapsed,
        "days_left": left,
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

    # Optional timed duration (used by Entomology trials). end_date is derived.
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
        if self.start_date and self.duration_days:
            return self.start_date + timedelta(days=self.duration_days)
        return None

    def duration_state(self, today=None) -> dict:
        return compute_duration_state(self.start_date, self.duration_days, self.completed_at, today)


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
    # Optional timed duration for this record (Entomology step-by-step).
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
        if self.start_date and self.duration_days:
            return self.start_date + timedelta(days=self.duration_days)
        return None

    def duration_state(self, today=None) -> dict:
        return compute_duration_state(self.start_date, self.duration_days, self.completed_at, today)


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
