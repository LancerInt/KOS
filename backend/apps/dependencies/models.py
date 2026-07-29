"""Dependencies & blockers (PRD §14, §15).

Kept in their own app with FKs back into ``tasks`` so the Task DoD can read them
through reverse relations (``task.dependencies`` / ``task.blockers``) without a
tasks↔dependencies import cycle.
"""
from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core.models import TimeStampedModel
from apps.projects.models import MilestoneStatus


class DependencyType(models.TextChoices):
    """PRD §14.1 / Appendix C.8."""

    FINISH_TO_START = "fs", "Finish-to-Start"
    START_TO_START = "ss", "Start-to-Start"
    EXTERNAL = "external", "External"
    MILESTONE = "milestone", "Milestone"


class Severity(models.TextChoices):
    CRITICAL = "critical", "Critical"
    HIGH = "high", "High"
    MEDIUM = "medium", "Medium"
    LOW = "low", "Low"


class Dependency(TimeStampedModel):
    successor = models.ForeignKey(
        "tasks.Task", on_delete=models.CASCADE, related_name="dependencies"
    )
    predecessor_task = models.ForeignKey(
        "tasks.Task", on_delete=models.CASCADE, null=True, blank=True, related_name="dependents"
    )
    predecessor_milestone = models.ForeignKey(
        "projects.Milestone", on_delete=models.CASCADE, null=True, blank=True, related_name="dependents"
    )
    dependency_type = models.CharField(max_length=20, choices=DependencyType.choices)
    is_mandatory = models.BooleanField(default=True, help_text="Hard block vs. advisory warning (§14.1).")
    external_note = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ("successor", "id")
        verbose_name_plural = "dependencies"

    def __str__(self) -> str:
        return f"{self.successor_id} depends on {self.short_label()}"

    def short_label(self) -> str:
        if self.dependency_type == DependencyType.MILESTONE and self.predecessor_milestone_id:
            return f"Milestone · {self.predecessor_milestone.title}"
        if self.dependency_type == DependencyType.EXTERNAL:
            return f"External · {self.external_note[:40]}"
        if self.predecessor_task_id:
            return f"{self.get_dependency_type_display()} · {self.predecessor_task.title}"
        return self.get_dependency_type_display()

    def is_satisfied(self) -> bool:
        """Whether the predecessor condition is met (§14.3)."""
        t = self.dependency_type
        if t == DependencyType.FINISH_TO_START:
            return bool(self.predecessor_task_id and self.predecessor_task.completed_at is not None)
        if t == DependencyType.START_TO_START:
            return bool(self.predecessor_task_id and self.predecessor_task.actual_start_date is not None)
        if t == DependencyType.MILESTONE:
            return bool(self.predecessor_milestone_id and self.predecessor_milestone.status == MilestoneStatus.REACHED)
        # External dependencies can't be auto-verified; they don't gate completion.
        return True


class Blocker(TimeStampedModel):
    """A blocker on a task (PRD §15). No automatic escalation (D5) — age is
    surfaced on dashboards instead."""

    task = models.ForeignKey("tasks.Task", on_delete=models.CASCADE, related_name="blockers")
    description = models.TextField()
    resolver = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="blockers_to_resolve"
    )
    severity = models.CharField(max_length=20, choices=Severity.choices, default=Severity.MEDIUM)
    target_resolution_date = models.DateField(null=True, blank=True)

    raised_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="blockers_raised"
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolution_note = models.TextField(blank=True)
    # Status the task held before it was blocked, so it can be restored (§15.2).
    previous_status = models.CharField(max_length=40, blank=True)

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"Blocker on task {self.task_id}"

    @property
    def is_open(self) -> bool:
        return self.resolved_at is None

    @property
    def age_hours(self) -> int:
        end = self.resolved_at or timezone.now()
        return int((end - self.created_at).total_seconds() // 3600)
