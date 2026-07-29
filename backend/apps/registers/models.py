"""Risk, Issue & Decision registers (PRD §17).

Three separate registers per project, each linkable to one or more tasks and
rolled up to management dashboards (Module 11). All changes are audited.
"""
from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel
from apps.projects.models import Priority


class ProbabilityImpact(models.TextChoices):
    """PRD Appendix C.14."""

    VERY_HIGH = "very_high", "Very High"
    HIGH = "high", "High"
    MEDIUM = "medium", "Medium"
    LOW = "low", "Low"
    VERY_LOW = "very_low", "Very Low"


WEIGHT = {
    ProbabilityImpact.VERY_LOW: 1,
    ProbabilityImpact.LOW: 2,
    ProbabilityImpact.MEDIUM: 3,
    ProbabilityImpact.HIGH: 4,
    ProbabilityImpact.VERY_HIGH: 5,
}


class RegisterStatus(models.TextChoices):
    """PRD Appendix C.15."""

    OPEN = "open", "Open"
    IN_PROGRESS = "in_progress", "In Progress"
    MITIGATED = "mitigated", "Mitigated / Resolved"
    CLOSED = "closed", "Closed"
    ACCEPTED = "accepted", "Accepted"


class Risk(TimeStampedModel):
    """PRD §17.1."""

    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="risks")
    statement = models.TextField()
    probability = models.CharField(max_length=20, choices=ProbabilityImpact.choices, default=ProbabilityImpact.MEDIUM)
    impact = models.CharField(max_length=20, choices=ProbabilityImpact.choices, default=ProbabilityImpact.MEDIUM)
    mitigation = models.TextField(blank=True)
    contingency = models.TextField(blank=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="owned_risks")
    review_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=RegisterStatus.choices, default=RegisterStatus.OPEN)
    related_tasks = models.ManyToManyField("tasks.Task", blank=True, related_name="risks")

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return self.statement[:60]

    @property
    def score(self) -> int:
        return WEIGHT.get(self.probability, 3) * WEIGHT.get(self.impact, 3)


class Issue(TimeStampedModel):
    """PRD §17.2 — an event that has already occurred."""

    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="issues")
    description = models.TextField()
    severity = models.CharField(max_length=20, choices=Priority.choices, default=Priority.MEDIUM)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="owned_issues")
    corrective_action = models.TextField(blank=True)
    target_resolution_date = models.DateField(null=True, blank=True)
    closure_evidence = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=RegisterStatus.choices, default=RegisterStatus.OPEN)
    related_tasks = models.ManyToManyField("tasks.Task", blank=True, related_name="issues")

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return self.description[:60]


class Decision(TimeStampedModel):
    """PRD §17.3 — the decision log."""

    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="decisions")
    decision_required = models.CharField(max_length=300)
    options_considered = models.TextField(blank=True)
    decision_maker = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="decisions_made")
    decision = models.TextField(blank=True)
    decided_on = models.DateField(null=True, blank=True)
    rationale = models.TextField(blank=True)
    supporting_document = models.CharField(max_length=400, blank=True, help_text="Link or reference.")
    status = models.CharField(max_length=20, choices=RegisterStatus.choices, default=RegisterStatus.OPEN)
    related_tasks = models.ManyToManyField("tasks.Task", blank=True, related_name="decisions")

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return self.decision_required[:60]
