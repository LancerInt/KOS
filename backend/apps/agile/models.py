"""Agile & sprint models (PRD §16).

A Sprint is a two-week timebox that tasks are *assigned to* — deliberately not a
hierarchy level (A3), so one sprint can span multiple epics and milestones.
Sprints run only on projects with ``sprint_enabled`` (v0.1 §21 Q5). Capacity is
not modelled (D11).
"""
from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel


class SprintStatus(models.TextChoices):
    PLANNING = "planning", "Planning"
    ACTIVE = "active", "Active"
    COMPLETED = "completed", "Completed"


class Sprint(TimeStampedModel):
    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="sprints")
    name = models.CharField(max_length=160)
    objective = models.TextField(blank=True)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="owned_sprints"
    )
    status = models.CharField(max_length=20, choices=SprintStatus.choices, default=SprintStatus.PLANNING)
    # A frozen/baselined plan (§16.2). Tasks added after baselining are "unplanned".
    is_baselined = models.BooleanField(default=False)
    baselined_at = models.DateTimeField(null=True, blank=True)
    retrospective_notes = models.TextField(blank=True)

    class Meta:
        ordering = ("-start_date", "-created_at")

    def __str__(self) -> str:
        return f"{self.name} ({self.project.code})"


class RetrospectiveItem(TimeStampedModel):
    """A retrospective note or improvement action (§16.5). Actions carry an
    owner and a deadline."""

    class Kind(models.TextChoices):
        WORKED = "worked", "What worked"
        DIDNT = "didnt", "What didn't work"
        CHANGE = "change", "What should change"
        ACTION = "action", "Improvement action"

    sprint = models.ForeignKey(Sprint, on_delete=models.CASCADE, related_name="retro_items")
    kind = models.CharField(max_length=10, choices=Kind.choices)
    text = models.TextField()
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="retro_actions"
    )
    due_date = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ("kind", "created_at")

    def __str__(self) -> str:
        return f"{self.get_kind_display()}: {self.text[:40]}"
