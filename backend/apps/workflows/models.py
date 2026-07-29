"""Team-authored workflows (PRD §12.4, D3, A2).

A project may define its own ``Workflow`` — a set of statuses and a transition
graph. Each status **must** map to one of the six canonical categories (A2), so
reporting stays stable no matter what a team names its states. A project without
a custom workflow uses the built-in default (apps.tasks.statuses), which stays
permissive; a custom workflow's transition graph is enforced (§12.3).
"""
from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel
from apps.tasks.statuses import StatusCategory


class Workflow(TimeStampedModel):
    name = models.CharField(max_length=120, default="Workflow")
    # One custom workflow per project. Null = a reusable template (IT-owned).
    project = models.OneToOneField(
        "projects.Project", on_delete=models.CASCADE, null=True, blank=True, related_name="custom_workflow"
    )
    is_template = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="created_workflows"
    )

    def __str__(self) -> str:
        return f"{self.name}" + (f" · {self.project.code}" if self.project_id else " (template)")

    @property
    def initial_status(self) -> "WorkflowStatus | None":
        return self.statuses.filter(is_initial=True).first() or self.statuses.first()


class WorkflowStatus(models.Model):
    workflow = models.ForeignKey(Workflow, on_delete=models.CASCADE, related_name="statuses")
    key = models.SlugField(max_length=50)
    label = models.CharField(max_length=80)
    category = models.CharField(max_length=20, choices=StatusCategory.choices)  # required (A2)
    order = models.PositiveIntegerField(default=0)
    is_initial = models.BooleanField(default=False)

    class Meta:
        unique_together = ("workflow", "key")
        ordering = ("workflow", "order", "id")
        verbose_name_plural = "workflow statuses"

    def __str__(self) -> str:
        return f"{self.label} [{self.category}]"


class WorkflowTransition(models.Model):
    workflow = models.ForeignKey(Workflow, on_delete=models.CASCADE, related_name="transitions")
    from_status = models.ForeignKey(WorkflowStatus, on_delete=models.CASCADE, related_name="transitions_out")
    to_status = models.ForeignKey(WorkflowStatus, on_delete=models.CASCADE, related_name="transitions_in")

    class Meta:
        unique_together = ("workflow", "from_status", "to_status")

    def __str__(self) -> str:
        return f"{self.from_status.key} → {self.to_status.key}"
