"""Notifications & escalation (PRD §22).

In-app + email (D1). The 48-hour overdue notification requires a written
acknowledgement (D5); if unacknowledged after 24h it surfaces on the Management
dashboard. No automatic blocked-based escalation (D5).
"""
from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone


class NotificationEvent(models.TextChoices):
    TASK_ASSIGNED = "task_assigned", "Task assigned"
    DUE_SOON = "due_soon", "Due date approaching"
    OVERDUE = "overdue", "Task overdue"
    OVERDUE_ACK = "overdue_ack", "Overdue — acknowledgement required"
    DEPENDENCY_DONE = "dependency_done", "Dependency completed"
    REVIEW_REQUESTED = "review_requested", "Review requested"
    REVIEW_DECISION = "review_decision", "Review decision"
    MENTION = "mention", "Mention"
    COMMENT = "comment", "Comment"
    BLOCKER_RAISED = "blocker_raised", "Blocker raised"
    DECISION_REQUESTED = "decision_requested", "Decision requested"
    PROJECT_AT_RISK = "project_at_risk", "Project at risk"
    SPRINT_EVENT = "sprint_event", "Sprint event"
    APPROVAL_GRANTED = "approval_granted", "Approval granted"
    DEADLINE_CHANGE = "deadline_change", "Deadline change requested"
    DOC_EXPIRING = "doc_expiring", "Document expiring"
    SOP_REVIEW_DUE = "sop_review_due", "SOP review due"
    REGISTRATION_DUE = "registration_due", "Registration renewal due"
    AUTOMATION = "automation", "Automation"
    DIGEST = "digest", "Daily digest"


class Notification(models.Model):
    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications"
    )
    event = models.CharField(max_length=30, choices=NotificationEvent.choices)
    title = models.CharField(max_length=240)
    body = models.TextField(blank=True)
    url = models.CharField(max_length=300, blank=True)

    task = models.ForeignKey("tasks.Task", on_delete=models.SET_NULL, null=True, blank=True, related_name="notifications")
    project = models.ForeignKey("projects.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="notifications")

    is_read = models.BooleanField(default=False)

    # 48-hour acknowledgement flow (§22.4).
    requires_acknowledgement = models.BooleanField(default=False)
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    acknowledgement_message = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["recipient", "is_read"])]

    def __str__(self) -> str:
        return f"{self.event} → {self.recipient_id}"

    @property
    def needs_acknowledgement(self) -> bool:
        return self.requires_acknowledgement and self.acknowledged_at is None

    @property
    def is_unacknowledged_escalated(self) -> bool:
        """Unacknowledged 24h+ after being raised → shown to management (§22.4)."""
        return self.needs_acknowledgement and self.created_at < timezone.now() - timedelta(hours=24)


class NotificationPreference(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notification_pref")
    inapp_enabled = models.BooleanField(default=True)
    email_enabled = models.BooleanField(default=True)
    daily_digest = models.BooleanField(default=True)  # on by default (v0.1 §21 Q20)

    def __str__(self) -> str:
        return f"Prefs for {self.user_id}"
