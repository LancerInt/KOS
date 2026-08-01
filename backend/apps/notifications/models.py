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
    DURATION_COMPLETE = "duration_complete", "Workspace project duration complete"
    ACK_RECEIVED = "ack_received", "Acknowledgement received"
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


class EmailAccount(models.Model):
    """A user's own outbound email account, managed in-app (Integrations → Email).

    Per-user: each person connects their own address + app password, and KOS uses
    that account to send *them* their reminders and to send mail they compose.
    There is no shared organisation account — someone who hasn't connected one
    simply gets in-app notifications only (no email)."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.CASCADE, related_name="email_account",
    )
    host = models.CharField(max_length=200, default="smtp.gmail.com")
    port = models.PositiveIntegerField(default=587)
    use_tls = models.BooleanField(default=True)
    username = models.CharField(max_length=200, blank=True)     # sender / SMTP login (e.g. a Gmail address)
    from_email = models.CharField(max_length=200, blank=True)   # From address; defaults to username
    password_encrypted = models.TextField(blank=True)           # app password, encrypted at rest
    is_enabled = models.BooleanField(default=False)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="+",
    )
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"EmailAccount({self.username or 'unset'})"

    @classmethod
    def for_user(cls, user) -> "EmailAccount":
        """The account belonging to ``user``, created empty on first access."""
        obj, _ = cls.objects.get_or_create(user=user)
        return obj

    @classmethod
    def load(cls) -> "EmailAccount":
        """Legacy singleton row (pk=1, no user) — retained only for migrations."""
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def set_password(self, raw: str) -> None:
        from .crypto import encrypt
        self.password_encrypted = encrypt(raw)

    def get_password(self) -> str:
        from .crypto import decrypt
        return decrypt(self.password_encrypted)

    @property
    def has_password(self) -> bool:
        return bool(self.password_encrypted)

    @property
    def is_ready(self) -> bool:
        return bool(self.is_enabled and self.username and self.password_encrypted)
