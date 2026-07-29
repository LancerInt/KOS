"""Approval requests (PRD §13).

Single-approver model (D4): a request needs approval from **exactly one**
authorised approver (Manager / Director / MD — anyone holding the Approve
capability). Whoever acts first completes it. A user may not approve their own
regulated deliverable (§6.3, §13.2).

Kinds handled here: task deliverable review, deadline change, and deletion.
Documents/SOPs reuse the same model once Module 10 lands.
"""
from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel


class ApprovalKind(models.TextChoices):
    DELIVERABLE = "deliverable", "Deliverable review"
    DEADLINE_CHANGE = "deadline_change", "Deadline change"
    DELETION = "deletion", "Deletion"


class ApprovalStatus(models.TextChoices):
    PENDING = "pending", "Pending"
    APPROVED = "approved", "Approved"
    CHANGES_REQUESTED = "changes_requested", "Changes Requested"
    REJECTED = "rejected", "Rejected"


class ApprovalRequest(TimeStampedModel):
    kind = models.CharField(max_length=20, choices=ApprovalKind.choices)
    status = models.CharField(max_length=20, choices=ApprovalStatus.choices, default=ApprovalStatus.PENDING)

    # Targets — SET_NULL so a deletion request survives its target (audit trail).
    task = models.ForeignKey(
        "tasks.Task", on_delete=models.SET_NULL, null=True, blank=True, related_name="approval_requests"
    )
    project = models.ForeignKey(
        "projects.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="approval_requests"
    )
    target_label = models.CharField(max_length=200, blank=True, help_text="Snapshot of the target for the record.")

    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="approval_requests_made"
    )
    approver = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="approvals_acted"
    )
    acted_at = models.DateTimeField(null=True, blank=True)
    decision_reason = models.TextField(blank=True)

    # e.g. {"new_due_date": "2026-09-01"} for a deadline change.
    payload = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.get_kind_display()} · {self.target_label or self.pk} [{self.status}]"

    def target_project(self):
        if self.task_id:
            return self.task.project
        return self.project
