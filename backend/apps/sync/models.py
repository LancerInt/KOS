"""Offline sync bookkeeping (PRD §25, §31.4).

Each queued client operation carries a client-generated ``op_id``. Recording
applied op_ids makes replay **idempotent** — a retried sync (common on flaky
connections) never double-applies, so a queued comment can't post twice.
"""
from __future__ import annotations

from django.conf import settings
from django.db import models


class SyncedOperation(models.Model):
    op_id = models.CharField(max_length=64, unique=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="synced_operations"
    )
    kind = models.CharField(max_length=40)
    result = models.JSONField(default=dict, blank=True)
    applied_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ("-applied_at",)

    def __str__(self) -> str:
        return f"{self.kind} {self.op_id}"
