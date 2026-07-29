"""Projects, portfolios, hierarchy and templates (PRD §9, §10.1, §10.6).

Module 2 fleshes out the Project Engine: project types, health, dates, epics,
milestones and reusable templates. Membership + the visibility rule live in
``scoping.py`` (built in Module 1) and are unchanged here.

**Model change (recommended #2, applied):** a Milestone's ``epic`` is optional —
a milestone may belong to an epic *or* hang directly off the project. Combined
with Epic being optional on tasks (Module 3), small operational projects are not
forced through every hierarchy level (§9.4 note).
"""
from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.accounts.rbac import ProjectRole
from apps.core.models import TimeStampedModel


class Confidentiality(models.TextChoices):
    """PRD Appendix C.13."""

    OPEN = "open", "Open"
    DEPARTMENT = "department", "Department"
    RESTRICTED = "restricted", "Restricted"
    CONFIDENTIAL = "confidential", "Confidential (invitation-only)"


class ProjectStatus(models.TextChoices):
    """PRD Appendix C.3."""

    DRAFT = "draft", "Draft"
    APPROVED = "approved", "Approved"
    ACTIVE = "active", "Active"
    AT_RISK = "at_risk", "At Risk"
    ON_HOLD = "on_hold", "On Hold"
    COMPLETED = "completed", "Completed"
    ARCHIVED = "archived", "Archived"
    CANCELLED = "cancelled", "Cancelled"


class ProjectType(models.TextChoices):
    """PRD Appendix C.5 — Hybrid is Kriya's default (§9.5)."""

    HYBRID = "hybrid", "Hybrid"
    AGILE = "agile", "Agile"
    MILESTONE = "milestone", "Milestone"
    RECURRING = "recurring", "Recurring Operational"


class Priority(models.TextChoices):
    """PRD Appendix C.6."""

    CRITICAL = "critical", "Critical"
    HIGH = "high", "High"
    MEDIUM = "medium", "Medium"
    LOW = "low", "Low"


class ProjectHealth(models.TextChoices):
    """PRD Appendix C.4."""

    ON_TRACK = "on_track", "On Track"
    AT_RISK = "at_risk", "At Risk"
    OFF_TRACK = "off_track", "Off Track"
    ON_HOLD = "on_hold", "On Hold"


class MilestoneStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    IN_PROGRESS = "in_progress", "In Progress"
    REACHED = "reached", "Reached"
    MISSED = "missed", "Missed"


class Portfolio(TimeStampedModel):
    """A collection of related projects (PRD §9.3). Portfolio scope grants
    visibility of every project within (§7.2)."""

    name = models.CharField(max_length=160, unique=True)
    code = models.CharField(max_length=20, unique=True)
    description = models.TextField(blank=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="owned_portfolios",
    )
    members = models.ManyToManyField(
        settings.AUTH_USER_MODEL, blank=True, related_name="portfolios"
    )

    class Meta:
        ordering = ("name",)

    def __str__(self) -> str:
        return self.name


class Project(TimeStampedModel):
    name = models.CharField(max_length=200)
    code = models.CharField(max_length=30, unique=True)
    description = models.TextField(blank=True)
    business_objective = models.TextField(blank=True)

    portfolio = models.ForeignKey(
        Portfolio, on_delete=models.SET_NULL, null=True, blank=True, related_name="projects"
    )
    department = models.ForeignKey(
        "accounts.Department", on_delete=models.SET_NULL, null=True, blank=True, related_name="projects"
    )

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="owned_projects"
    )
    manager = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="managed_projects",
        help_text="Project Manager / Agile Lead.",
    )

    project_type = models.CharField(max_length=20, choices=ProjectType.choices, default=ProjectType.HYBRID)
    confidentiality = models.CharField(max_length=20, choices=Confidentiality.choices, default=Confidentiality.OPEN)
    status = models.CharField(max_length=20, choices=ProjectStatus.choices, default=ProjectStatus.DRAFT)
    priority = models.CharField(max_length=20, choices=Priority.choices, default=Priority.MEDIUM)
    health = models.CharField(max_length=20, choices=ProjectHealth.choices, default=ProjectHealth.ON_TRACK)

    start_date = models.DateField(null=True, blank=True)
    target_date = models.DateField(null=True, blank=True)
    actual_completion_date = models.DateField(null=True, blank=True)

    success_criteria = models.TextField(blank=True)
    working_rules = models.TextField(blank=True, help_text="Project instructions / working rules.")

    # Sprints run only on selected projects (v0.1 §21 Q5).
    sprint_enabled = models.BooleanField(default=False)

    class Meta:
        ordering = ("name",)

    def __str__(self) -> str:
        return f"{self.code} · {self.name}"

    @property
    def is_confidential(self) -> bool:
        return self.confidentiality == Confidentiality.CONFIDENTIAL

    @property
    def progress(self) -> int:
        """Percent complete. Rolls up from milestones for now; becomes
        task-driven once the Task Engine lands (Module 3, §9.4)."""
        milestones = list(self.milestones.all())
        if not milestones:
            return 0
        reached = sum(1 for m in milestones if m.status == MilestoneStatus.REACHED)
        return round(reached * 100 / len(milestones))


class Epic(TimeStampedModel):
    """A substantial area of work inside a project (PRD §9.3). Optional level."""

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="epics")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="owned_epics"
    )
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ("project", "order", "id")

    def __str__(self) -> str:
        return self.title


class Milestone(TimeStampedModel):
    """A dated checkpoint (PRD §9.3). ``epic`` is optional (recommended #2)."""

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="milestones")
    epic = models.ForeignKey(
        Epic, on_delete=models.SET_NULL, null=True, blank=True, related_name="milestones"
    )
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=MilestoneStatus.choices, default=MilestoneStatus.PENDING)
    reached_at = models.DateField(null=True, blank=True)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ("project", "order", "due_date", "id")

    def __str__(self) -> str:
        return self.title

    @property
    def is_reached(self) -> bool:
        return self.status == MilestoneStatus.REACHED


class ProjectTemplate(models.Model):
    """A reusable project blueprint (PRD §10.6). Seeds a hierarchy of epics and
    milestones when a project is created from it (AC-6). ``structure`` holds the
    default epics/milestones as JSON so templates are data, not code."""

    key = models.SlugField(max_length=60, unique=True)
    name = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    project_type = models.CharField(max_length=20, choices=ProjectType.choices, default=ProjectType.HYBRID)
    default_confidentiality = models.CharField(
        max_length=20, choices=Confidentiality.choices, default=Confidentiality.OPEN
    )
    # {"epics": [{"title", "milestones": [{"title", "offset_days"}]}],
    #  "milestones": [{"title", "offset_days"}]}   (project-level milestones)
    structure = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("name",)

    def __str__(self) -> str:
        return self.name


class Membership(TimeStampedModel):
    """An explicit user↔project link (PRD §7.4). Presence of this record — not
    job title — is what grants project-scoped access (§7.3)."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships"
    )
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="memberships")
    project_role = models.CharField(
        max_length=20, choices=ProjectRole.choices, default=ProjectRole.CONTRIBUTOR
    )
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="memberships_added",
    )

    class Meta:
        unique_together = ("user", "project")
        ordering = ("project", "user")

    def __str__(self) -> str:
        return f"{self.user} @ {self.project.code} ({self.project_role})"
