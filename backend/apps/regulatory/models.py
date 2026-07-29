"""Regulatory registrations — the EPA/CIBRC department module (PRD §29, §34).

Another worked example of "configure, don't rebuild": a registration reuses the
**document engine** (attach the dossier & certificates), a small **workflow** for
its lifecycle, and the **reminder engine** for expiry/renewal — the same machinery
that already powers documents and SOPs, pointed at a regulated-product process.
"""
from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core.models import TimeStampedModel


class Authority(models.TextChoices):
    CIBRC = "cibrc", "CIBRC (Central Insecticides Board & Registration Committee)"
    EPA = "epa", "US EPA"
    STATE = "state", "State Agriculture Department"
    OTHER = "other", "Other"


class RegStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    SUBMITTED = "submitted", "Submitted"
    UNDER_REVIEW = "under_review", "Under review"
    QUERY_RAISED = "query_raised", "Query raised"
    APPROVED = "approved", "Approved"
    REJECTED = "rejected", "Rejected"
    RENEWAL_DUE = "renewal_due", "Renewal due"
    EXPIRED = "expired", "Expired"


# Lifecycle graph, server-enforced (§29.2).
REG_TRANSITIONS: dict[str, list[str]] = {
    RegStatus.DRAFT: [RegStatus.SUBMITTED],
    RegStatus.SUBMITTED: [RegStatus.UNDER_REVIEW, RegStatus.REJECTED],
    RegStatus.UNDER_REVIEW: [RegStatus.QUERY_RAISED, RegStatus.APPROVED, RegStatus.REJECTED],
    RegStatus.QUERY_RAISED: [RegStatus.UNDER_REVIEW, RegStatus.REJECTED],
    RegStatus.APPROVED: [RegStatus.RENEWAL_DUE, RegStatus.EXPIRED],
    RegStatus.RENEWAL_DUE: [RegStatus.SUBMITTED, RegStatus.EXPIRED],
    RegStatus.REJECTED: [RegStatus.DRAFT],
    RegStatus.EXPIRED: [RegStatus.DRAFT],
}


class RegulatoryRegistration(TimeStampedModel):
    product_name = models.CharField(max_length=200)
    registration_number = models.CharField(max_length=120, blank=True, help_text="Assigned by the authority on approval.")
    authority = models.CharField(max_length=20, choices=Authority.choices, default=Authority.CIBRC)
    category = models.CharField(max_length=120, blank=True, help_text="e.g. Insecticide, Fungicide, Herbicide.")
    status = models.CharField(max_length=20, choices=RegStatus.choices, default=RegStatus.DRAFT)

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="owned_registrations"
    )
    project = models.ForeignKey(
        "projects.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="registrations"
    )
    documents = models.ManyToManyField("documents.Document", blank=True, related_name="registrations")

    submission_date = models.DateField(null=True, blank=True)
    approval_date = models.DateField(null=True, blank=True)
    expiry_date = models.DateField(null=True, blank=True)
    reminder_lead_days = models.PositiveIntegerField(default=60)
    expiry_reminded_at = models.DateTimeField(null=True, blank=True)

    notes = models.TextField(blank=True)

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return f"{self.product_name} ({self.get_authority_display()})"

    def can_transition_to(self, status: str) -> bool:
        return status in REG_TRANSITIONS.get(self.status, [])

    @property
    def is_expired(self) -> bool:
        return self.expiry_date is not None and self.expiry_date < timezone.now().date()

    @property
    def expires_in_days(self) -> int | None:
        if self.expiry_date is None:
            return None
        return (self.expiry_date - timezone.now().date()).days
