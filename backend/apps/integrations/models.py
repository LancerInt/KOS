"""ERP Integration (PRD §27).

A contract-first integration layer for Kriya's existing ERP:

* **ErpConnection** — a configured endpoint: where to POST, the shared HMAC
  secret, which events it subscribes to, and whether inbound is allowed.
  ``mock_mode`` lets the whole pipeline run end-to-end with no live ERP (events
  are recorded and signed but not actually sent).
* **WebhookDelivery** — one outbound attempt per (event, connection), with
  status, retries and the response — the delivery audit trail (§27.4).
* **InboundEvent** — an ERP-originated message received on the inbound webhook,
  signature-verified and logged before dispatch.
"""
from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel


class EventType(models.TextChoices):
    PROJECT_CREATED = "project.created", "Project created"
    PROJECT_UPDATED = "project.updated", "Project updated"
    TASK_CREATED = "task.created", "Task created"
    TASK_STATUS_CHANGED = "task.status_changed", "Task status changed"
    TASK_COMPLETED = "task.completed", "Task completed"
    APPROVAL_DECIDED = "approval.decided", "Approval decided"
    PING = "ping", "Test ping"


class AuthScheme(models.TextChoices):
    NONE = "none", "None"
    BEARER = "bearer", "Bearer token"
    HEADER = "header", "Custom header"


class ErpConnection(TimeStampedModel):
    name = models.CharField(max_length=120)
    base_url = models.URLField(help_text="Endpoint that receives outbound events.")
    secret = models.CharField(max_length=255, blank=True, help_text="Shared key for HMAC-SHA256 signing.")

    auth_scheme = models.CharField(max_length=10, choices=AuthScheme.choices, default=AuthScheme.NONE)
    auth_token = models.CharField(max_length=255, blank=True, help_text="Bearer token or custom-header value.")
    auth_header_name = models.CharField(max_length=80, blank=True, default="X-API-Key")

    subscribed_events = models.JSONField(default=list, blank=True, help_text="EventType values this ERP wants.")
    is_active = models.BooleanField(default=True)
    inbound_enabled = models.BooleanField(default=False)
    # Contract-first default: simulate delivery so the pipeline works with no ERP.
    mock_mode = models.BooleanField(default=True)
    max_attempts = models.PositiveIntegerField(default=5)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="erp_connections"
    )
    last_delivery_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("name",)

    def __str__(self) -> str:
        return self.name

    @property
    def has_secret(self) -> bool:
        return bool(self.secret)


class DeliveryStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    DELIVERED = "delivered", "Delivered"
    FAILED = "failed", "Failed"
    MOCKED = "mocked", "Mocked (simulated)"


class WebhookDelivery(TimeStampedModel):
    connection = models.ForeignKey(ErpConnection, on_delete=models.CASCADE, related_name="deliveries")
    event_type = models.CharField(max_length=40, choices=EventType.choices)
    object_type = models.CharField(max_length=60, blank=True)
    object_id = models.CharField(max_length=64, blank=True)
    payload = models.JSONField(default=dict, blank=True)

    status = models.CharField(max_length=12, choices=DeliveryStatus.choices, default=DeliveryStatus.PENDING)
    attempts = models.PositiveIntegerField(default=0)
    response_status = models.PositiveIntegerField(null=True, blank=True)
    response_body = models.TextField(blank=True)
    error = models.TextField(blank=True)
    next_retry_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["status", "next_retry_at"])]

    def __str__(self) -> str:
        return f"{self.event_type} → {self.connection_id} [{self.status}]"


class InboundStatus(models.TextChoices):
    RECEIVED = "received", "Received"
    PROCESSED = "processed", "Processed"
    IGNORED = "ignored", "Ignored"
    FAILED = "failed", "Failed"


class InboundEvent(TimeStampedModel):
    connection = models.ForeignKey(
        ErpConnection, on_delete=models.SET_NULL, null=True, blank=True, related_name="inbound_events"
    )
    event_type = models.CharField(max_length=60)
    payload = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=12, choices=InboundStatus.choices, default=InboundStatus.RECEIVED)
    result = models.CharField(max_length=300, blank=True)
    source_ip = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.event_type} [{self.status}]"
