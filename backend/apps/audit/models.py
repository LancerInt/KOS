"""Audit trail (PRD §26).

Every meaningful state change is recorded here with actor, timestamp, action,
target, old/new value, stated reason and source IP (§26.2). Records are
**immutable** (§26.3) — nothing in the app updates or deletes an ``AuditLog``.

Module 13 expands this (export, search UI, retention). Module 1 uses it now for
role, permission and membership changes (§7.7).
"""
from __future__ import annotations

from django.conf import settings
from django.db import models


class AuditAction(models.TextChoices):
    LOGIN = "login", "Login"
    CREATE = "create", "Create"
    UPDATE = "update", "Update"
    DELETE = "delete", "Delete"
    STATUS_CHANGE = "status_change", "Status Change"
    OWNERSHIP_CHANGE = "ownership_change", "Ownership Change"
    DEADLINE_CHANGE = "deadline_change", "Deadline Change"
    WORKFLOW_CHANGE = "workflow_change", "Workflow Change"
    APPROVE = "approve", "Approve"
    REJECT = "reject", "Reject"
    REQUEST_CHANGES = "request_changes", "Request Changes"
    NOTIFICATION_ACK = "notification_ack", "Notification Acknowledgement"
    EXPORT = "export", "Export Data"
    ROLE_CHANGE = "role_change", "Role Change"
    PERMISSION_CHANGE = "permission_change", "Permission Change"
    MEMBERSHIP_CHANGE = "membership_change", "Membership Change"
    MFA_CHANGE = "mfa_change", "MFA Change"


class AuditLog(models.Model):
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_events",
        help_text="Null when the action was performed by the system.",
    )
    action = models.CharField(max_length=40, choices=AuditAction.choices)
    object_type = models.CharField(max_length=80, blank=True)
    object_id = models.CharField(max_length=64, blank=True)
    old_value = models.JSONField(null=True, blank=True)
    new_value = models.JSONField(null=True, blank=True)
    reason = models.TextField(blank=True)
    source_ip = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["object_type", "object_id"]),
            models.Index(fields=["action"]),
        ]

    def __str__(self) -> str:
        who = self.actor_id or "system"
        return f"[{self.created_at:%Y-%m-%d %H:%M}] {who} {self.action} {self.object_type}#{self.object_id}"


class RetentionPolicy(models.Model):
    """How long a class of records is kept before purge (PRD §26.4, D14).

    Recommended change #1 (flagged in Module 0): retention is **configurable per
    record type**, and audit + regulatory records are ``is_exempt`` — never
    purged, even under a blanket policy. The purge routine only ever touches
    record types it knows are safe (see ``apps.audit.retention``).
    """

    record_type = models.CharField(max_length=60, unique=True, help_text="Stable key, e.g. 'notification'.")
    label = models.CharField(max_length=120)
    retention_days = models.PositiveIntegerField(
        null=True, blank=True, help_text="Delete records older than this. Null = keep indefinitely."
    )
    is_exempt = models.BooleanField(
        default=False, help_text="Never purged — audit trail & regulatory records (§26.4)."
    )
    description = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("label",)
        verbose_name_plural = "retention policies"

    def __str__(self) -> str:
        if self.is_exempt:
            return f"{self.label}: exempt"
        return f"{self.label}: {self.retention_days or '∞'} days"
