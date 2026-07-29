"""Documents & SOPs (PRD §18, §19).

Two capabilities in one module, both versioned and both audited:

* **Documents** — upload with metadata, an immutable version history with
  rollback, a single-approver approval status, expiry / renewal reminders
  (critical for CIBRC & EPA registrations, §18.4) and a download audit trail
  (§18.5). A document with no project belongs to the organisation-wide library.
* **SOPs** — Standard Operating Procedures moving through a fixed lifecycle
  (Research → Draft → Review → Approved → Published, with periodic review), each
  publish snapshotted as a version, with review-cycle reminders (§19).

The approval and review gates reuse the single-approver rules from the approval
engine (§13): exactly one holder of the Approve capability acts, and nobody may
approve their own document (§6.3).
"""
from __future__ import annotations

import calendar
from datetime import date

from django.conf import settings
from django.db import models
from django.utils import timezone

from apps.core.models import TimeStampedModel


def add_months(d: date, months: int) -> date:
    """Add whole months to a date, clamping the day to the target month's length."""
    m = d.month - 1 + months
    year = d.year + m // 12
    month = m % 12 + 1
    day = min(d.day, calendar.monthrange(year, month)[1])
    return d.replace(year=year, month=month, day=day)


def document_upload_path(instance: "DocumentVersion", filename: str) -> str:
    return f"documents/{instance.document_id}/v{instance.version_number}_{filename}"


# --------------------------------------------------------------------------- #
# Documents (PRD §18)
# --------------------------------------------------------------------------- #
class DocumentCategory(models.TextChoices):
    GENERAL = "general", "General"
    REGULATORY = "regulatory", "Regulatory / Compliance"
    CONTRACT = "contract", "Contract / Agreement"
    REPORT = "report", "Report"
    SPECIFICATION = "specification", "Specification"
    LICENSE = "license", "Licence / Certificate"
    OTHER = "other", "Other"


class DocumentStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    PENDING = "pending_approval", "Pending approval"
    APPROVED = "approved", "Approved"
    ARCHIVED = "archived", "Archived"


class Document(TimeStampedModel):
    """A logical document; its file content lives in immutable versions."""

    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, null=True, blank=True,
        related_name="documents",
        help_text="Owning project, or blank for the organisation-wide library.",
    )
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=20, choices=DocumentCategory.choices, default=DocumentCategory.GENERAL)
    tags = models.CharField(max_length=300, blank=True, help_text="Comma-separated.")
    status = models.CharField(max_length=20, choices=DocumentStatus.choices, default=DocumentStatus.DRAFT)

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="owned_documents"
    )
    current_version = models.ForeignKey(
        "documents.DocumentVersion", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    # Approval — single approver (§13).
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="approved_documents"
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    # Expiry / renewal (§18.4) — regulatory registrations, licences, certificates.
    expiry_date = models.DateField(null=True, blank=True)
    reminder_lead_days = models.PositiveIntegerField(default=30)
    expiry_reminded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return self.title

    @property
    def version_number(self) -> int:
        return self.current_version.version_number if self.current_version_id else 0

    @property
    def is_expired(self) -> bool:
        return self.expiry_date is not None and self.expiry_date < timezone.now().date()

    @property
    def expires_in_days(self) -> int | None:
        if self.expiry_date is None:
            return None
        return (self.expiry_date - timezone.now().date()).days

    def next_version_number(self) -> int:
        latest = self.versions.aggregate(m=models.Max("version_number"))["m"] or 0
        return latest + 1


class DocumentVersion(TimeStampedModel):
    """An immutable uploaded revision of a document (§18.2)."""

    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="versions")
    version_number = models.PositiveIntegerField()
    file = models.FileField(upload_to=document_upload_path)
    original_filename = models.CharField(max_length=255, blank=True)
    size_bytes = models.PositiveBigIntegerField(default=0)
    content_type = models.CharField(max_length=120, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="uploaded_versions"
    )
    notes = models.CharField(max_length=300, blank=True, help_text="What changed in this version.")

    class Meta:
        ordering = ("-version_number",)
        unique_together = ("document", "version_number")

    def __str__(self) -> str:
        return f"{self.document.title} v{self.version_number}"


class DocumentDownload(models.Model):
    """One row per download — the download audit trail (§18.5)."""

    version = models.ForeignKey(DocumentVersion, on_delete=models.CASCADE, related_name="downloads")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="document_downloads"
    )
    downloaded_at = models.DateTimeField(auto_now_add=True, db_index=True)
    source_ip = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ("-downloaded_at",)

    def __str__(self) -> str:
        return f"{self.version} ← {self.user_id}"


# --------------------------------------------------------------------------- #
# SOPs (PRD §19)
# --------------------------------------------------------------------------- #
class SOPStage(models.TextChoices):
    RESEARCH = "research", "Research"
    DRAFT = "draft", "Draft"
    REVIEW = "review", "In review"
    APPROVED = "approved", "Approved"
    PUBLISHED = "published", "Published"
    RETIRED = "retired", "Retired"


# Allowed stage transitions, server-enforced (§19.2). Publishing loops back to
# Review for the periodic-review cycle.
SOP_TRANSITIONS: dict[str, list[str]] = {
    SOPStage.RESEARCH: [SOPStage.DRAFT],
    SOPStage.DRAFT: [SOPStage.REVIEW],
    SOPStage.REVIEW: [SOPStage.APPROVED, SOPStage.DRAFT],
    SOPStage.APPROVED: [SOPStage.PUBLISHED, SOPStage.REVIEW],
    SOPStage.PUBLISHED: [SOPStage.REVIEW, SOPStage.RETIRED],
    SOPStage.RETIRED: [],
}


class SOP(TimeStampedModel):
    code = models.CharField(max_length=40, unique=True, help_text="e.g. SOP-QA-001.")
    title = models.CharField(max_length=200)
    department = models.ForeignKey(
        "accounts.Department", on_delete=models.SET_NULL, null=True, blank=True, related_name="sops"
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="owned_sops"
    )

    stage = models.CharField(max_length=20, choices=SOPStage.choices, default=SOPStage.RESEARCH)
    purpose = models.TextField(blank=True)
    scope = models.TextField(blank=True)
    content = models.TextField(blank=True, help_text="The working SOP body (Markdown).")
    version_number = models.PositiveIntegerField(default=0)

    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="approved_sops"
    )
    approved_at = models.DateTimeField(null=True, blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    effective_date = models.DateField(null=True, blank=True)

    review_interval_months = models.PositiveIntegerField(default=12)
    next_review_date = models.DateField(null=True, blank=True)
    review_reminded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("code",)

    def __str__(self) -> str:
        return f"{self.code} · {self.title}"

    def can_transition_to(self, stage: str) -> bool:
        return stage in SOP_TRANSITIONS.get(self.stage, [])

    @property
    def review_overdue(self) -> bool:
        return (
            self.stage == SOPStage.PUBLISHED
            and self.next_review_date is not None
            and self.next_review_date < timezone.now().date()
        )


class SOPVersion(TimeStampedModel):
    """A published snapshot of an SOP's content (§19.3)."""

    sop = models.ForeignKey(SOP, on_delete=models.CASCADE, related_name="versions")
    version_number = models.PositiveIntegerField()
    content = models.TextField(blank=True)
    change_summary = models.CharField(max_length=300, blank=True)
    published_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="published_sop_versions"
    )

    class Meta:
        ordering = ("-version_number",)
        unique_together = ("sop", "version_number")

    def __str__(self) -> str:
        return f"{self.sop.code} v{self.version_number}"
