"""Task Engine models (PRD §10.2, §11).

The Task carries the full object from §11: multiple owners with exactly one
**Primary Owner** (A1), subtasks, checklists, task types, priority, dates, a
deliverable and a task-level Definition of Done (§11.5). Comments, and a
per-task activity timeline complete the picture. Status uses the default
workflow (statuses.py) until Module 4 makes it team-authored.
"""
from __future__ import annotations

from datetime import date

from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel
from apps.projects.models import Epic, Milestone, Priority, Project

from .statuses import (
    DEFAULT_STATUS_CHOICES,
    INITIAL_STATUS,
    STATUS_CATEGORY,
    StatusCategory,
    category_for,
    is_done,
)


class TaskType(models.TextChoices):
    """PRD §11.4 / Appendix C.7."""

    STANDARD = "standard", "Standard"
    APPROVAL = "approval", "Approval"
    DECISION = "decision", "Decision Required"
    EXPERIMENT = "experiment", "Experiment / Trial"
    DOCUMENT = "document", "Document Preparation"
    MEETING = "meeting", "Meeting / Action Item"
    EXTERNAL = "external", "External Follow-up"
    COMPLIANCE = "compliance", "Compliance Requirement"
    ISSUE = "issue", "Issue / Problem"
    RECURRING = "recurring", "Recurring"


class Task(TimeStampedModel):
    title = models.CharField(max_length=300)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="tasks")
    # Epic & milestone are optional (recommended #2 — small work isn't boxed in).
    epic = models.ForeignKey(Epic, on_delete=models.SET_NULL, null=True, blank=True, related_name="tasks")
    milestone = models.ForeignKey(Milestone, on_delete=models.SET_NULL, null=True, blank=True, related_name="tasks")

    description = models.TextField(blank=True)
    task_type = models.CharField(max_length=20, choices=TaskType.choices, default=TaskType.STANDARD)

    # Ownership (A1): many owners, exactly one flagged primary for routing.
    owners = models.ManyToManyField(settings.AUTH_USER_MODEL, related_name="owned_tasks", blank=True)
    primary_owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="primary_tasks"
    )
    collaborators = models.ManyToManyField(settings.AUTH_USER_MODEL, related_name="collaborating_tasks", blank=True)
    reviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="reviewing_tasks"
    )
    watchers = models.ManyToManyField(settings.AUTH_USER_MODEL, related_name="watched_tasks", blank=True)

    status = models.CharField(max_length=40, choices=DEFAULT_STATUS_CHOICES, default=INITIAL_STATUS)
    priority = models.CharField(max_length=20, choices=Priority.choices, default=Priority.MEDIUM)
    risk_level = models.CharField(max_length=20, choices=Priority.choices, blank=True)

    # Sprint is a cross-cutting timebox, not a hierarchy level (A3). String ref
    # avoids a tasks↔agile import cycle.
    sprint = models.ForeignKey(
        "agile.Sprint", on_delete=models.SET_NULL, null=True, blank=True, related_name="tasks"
    )
    backlog_rank = models.PositiveIntegerField(default=0, db_index=True)

    start_date = models.DateField(null=True, blank=True)
    due_date = models.DateField(null=True, blank=True)

    deliverable = models.TextField(blank=True, help_text="What 'done' produces (§11.1).")
    definition_of_done = models.TextField(blank=True, help_text="Task-level completion criteria.")

    tags = models.JSONField(default=list, blank=True)
    reminder_lead_days = models.PositiveIntegerField(default=2, help_text="Days before due to remind (D8).")

    # System-derived (§11.3)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="created_tasks"
    )
    actual_start_date = models.DateField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="completed_tasks"
    )
    last_activity_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["project", "status"]),
            models.Index(fields=["due_date"]),
        ]

    def __str__(self) -> str:
        return self.title

    # --- derived -------------------------------------------------------- #
    @property
    def category(self) -> str:
        return category_for(self.status)

    @property
    def is_overdue(self) -> bool:
        due = self.due_date
        if not due or is_done(self.status):
            return False
        # A freshly-created/assigned instance can hold the date as a string
        # (Django only coerces on DB read), which would crash the comparison.
        if isinstance(due, str):
            due = date.fromisoformat(due)
        return due < date.today()

    @property
    def checklist_done(self) -> int:
        return self.checklist_items.filter(is_done=True).count()

    @property
    def checklist_total(self) -> int:
        return self.checklist_items.count()

    @property
    def open_blocker(self):
        """The current unresolved blocker, if any (§15). Reverse relation from
        the dependencies app — no import needed."""
        return self.blockers.filter(resolved_at__isnull=True).first()

    def blocking_reasons(self) -> list[str]:
        """Why this task cannot be marked Completed yet (§11.5, AC-13)."""
        reasons: list[str] = []
        if not (self.deliverable or "").strip():
            reasons.append("A deliverable or expected result is required.")
        if self.checklist_items.filter(is_required=True, is_done=False).exists():
            reasons.append("All required checklist items must be complete.")
        # A blocked task can never move directly to Completed (§15.2).
        if self.blockers.filter(resolved_at__isnull=True).exists():
            reasons.append("An open blocker must be resolved first.")
        # All mandatory predecessor dependencies must be complete (§11.5).
        for dep in self.dependencies.filter(is_mandatory=True):
            if not dep.is_satisfied():
                reasons.append(f"Mandatory dependency not met: {dep.short_label()}")
        return reasons

    def can_complete(self) -> bool:
        return not self.blocking_reasons()


class Subtask(TimeStampedModel):
    """A smaller action needed to complete a task (§9.3). Lightweight — no
    separate workflow."""

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="subtasks")
    title = models.CharField(max_length=300)
    is_done = models.BooleanField(default=False)
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="subtasks"
    )
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ("task", "order", "id")

    def __str__(self) -> str:
        return self.title


class ChecklistItem(TimeStampedModel):
    """A simple completion item needing no separate ownership (§9.3).
    Required items gate task completion (§11.5)."""

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="checklist_items")
    title = models.CharField(max_length=300)
    is_done = models.BooleanField(default=False)
    is_required = models.BooleanField(default=False)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ("task", "order", "id")

    def __str__(self) -> str:
        return self.title


class Comment(TimeStampedModel):
    """A comment on a task, with @mentions (§10.2)."""

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="task_comments"
    )
    body = models.TextField()
    mentions = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="mentioned_in")

    class Meta:
        ordering = ("created_at",)

    def __str__(self) -> str:
        return f"Comment by {self.author} on {self.task_id}"


class Activity(models.Model):
    """A single event on a task's timeline (§10.2 — activity history)."""

    class Verb(models.TextChoices):
        CREATED = "created", "created the task"
        STATUS_CHANGED = "status_changed", "changed status"
        ASSIGNED = "assigned", "changed owners"
        COMMENTED = "commented", "commented"
        COMPLETED = "completed", "completed the task"
        REOPENED = "reopened", "reopened the task"
        UPDATED = "updated", "updated the task"

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="activities")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="task_activities"
    )
    verb = models.CharField(max_length=30, choices=Verb.choices)
    detail = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ("-created_at",)
        verbose_name_plural = "activities"

    def __str__(self) -> str:
        return f"{self.actor} {self.verb} {self.task_id}"
