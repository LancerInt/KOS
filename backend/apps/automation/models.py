"""Automation Engine (PRD §24).

Rule-based **trigger → conditions → actions**. A rule listens for one trigger
(a task event or a scheduled time event), checks that every condition holds on
the triggering task, then runs its ordered actions — notify people, change a
field, flag the project, and so on.

Rules are *configuration, not code* (§34): the whole rule is stored as data
(``conditions`` and ``actions`` are JSON), so IT composes new automations with no
deployment. Every execution is written to ``AutomationLog`` for transparency.
"""
from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel


class TriggerType(models.TextChoices):
    TASK_CREATED = "task_created", "When a task is created"
    TASK_STATUS_CHANGED = "task_status_changed", "When a task's status changes"
    TASK_COMPLETED = "task_completed", "When a task is completed"
    TASK_OVERDUE = "task_overdue", "When a task becomes overdue"          # scheduled
    TASK_DUE_SOON = "task_due_soon", "When a task is due soon"            # scheduled
    BLOCKER_RAISED = "blocker_raised", "When a blocker is raised"
    APPROVAL_DECIDED = "approval_decided", "When an approval is decided"


# Scheduled triggers are fired by the daily scan, not by a live event.
SCHEDULED_TRIGGERS = {TriggerType.TASK_OVERDUE, TriggerType.TASK_DUE_SOON}


class ConditionOp(models.TextChoices):
    EQ = "eq", "is"
    NE = "ne", "is not"
    IN = "in", "is one of"
    IS_TRUE = "is_true", "is true"
    IS_FALSE = "is_false", "is false"


class ActionType(models.TextChoices):
    NOTIFY_OWNERS = "notify_owners", "Notify the task's owners"
    NOTIFY_PRIMARY = "notify_primary_owner", "Notify the primary owner"
    NOTIFY_MANAGER = "notify_manager", "Notify the project manager(s)"
    SET_PRIORITY = "set_priority", "Set priority"
    SET_STATUS = "set_status", "Set status"
    ADD_TAG = "add_tag", "Add a tag"
    ADD_COMMENT = "add_comment", "Post a comment"
    FLAG_PROJECT_AT_RISK = "flag_project_at_risk", "Flag the project at risk"


class AutomationRule(TimeStampedModel):
    name = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    # Scope: a project's own rule, or a global rule (project null) run everywhere.
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, null=True, blank=True, related_name="automation_rules"
    )
    trigger = models.CharField(max_length=30, choices=TriggerType.choices)
    conditions = models.JSONField(default=list, blank=True, help_text='[{"field","op","value"}] — all must hold.')
    actions = models.JSONField(default=list, blank=True, help_text='[{"type", ...params}] — run in order.')

    is_active = models.BooleanField(default=True)
    order = models.PositiveIntegerField(default=0)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="automation_rules"
    )

    run_count = models.PositiveIntegerField(default=0)
    last_run_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("project_id", "order", "id")

    def __str__(self) -> str:
        return self.name


class AutomationLog(models.Model):
    """One row per rule execution — the automation audit trail (§24.4)."""

    rule = models.ForeignKey(AutomationRule, on_delete=models.SET_NULL, null=True, related_name="logs")
    rule_name = models.CharField(max_length=160, blank=True)
    trigger = models.CharField(max_length=30, choices=TriggerType.choices)
    task = models.ForeignKey("tasks.Task", on_delete=models.SET_NULL, null=True, blank=True, related_name="automation_logs")
    project = models.ForeignKey("projects.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="automation_logs")
    actions_run = models.JSONField(default=list, blank=True)
    ok = models.BooleanField(default=True)
    message = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.rule_name} · {self.trigger} [{'ok' if self.ok else 'error'}]"
