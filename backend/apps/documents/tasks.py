"""Scheduled scans for document expiry & SOP review cycles (PRD §18.4, §19).

Run by Celery beat, or synchronously via ``manage.py notify_scan`` (they are
wired into ``notifications.tasks.run_all_scans``).
"""
from __future__ import annotations

from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from apps.notifications.models import NotificationEvent
from apps.notifications.services import notify

from .models import Document, DocumentStatus, SOP, SOPStage


def _doc_url(doc: Document) -> str:
    return f"/projects/{doc.project_id}/documents" if doc.project_id else "/documents"


@shared_task
def scan_document_expiry() -> int:
    """Remind owners of documents nearing (or past) their expiry date.

    Fires once per document; the reminder timestamp is cleared whenever the
    expiry date changes, re-arming the reminder for the new date.
    """
    today = timezone.now().date()
    count = 0
    for doc in Document.objects.filter(
        expiry_date__isnull=False, owner__isnull=False
    ).exclude(status=DocumentStatus.ARCHIVED).select_related("owner", "project"):
        if doc.expiry_reminded_at is not None:
            continue
        days = (doc.expiry_date - today).days
        if days > doc.reminder_lead_days:
            continue
        when = "has expired" if days < 0 else f"expires in {days} day(s)"
        notify(
            doc.owner, NotificationEvent.DOC_EXPIRING,
            f"Document {when}: {doc.title}",
            body="Renew or supersede this document to stay compliant.",
            project=doc.project, url=_doc_url(doc), requires_ack=days < 0,
        )
        doc.expiry_reminded_at = timezone.now()
        doc.save(update_fields=["expiry_reminded_at"])
        count += 1
    return count


@shared_task
def scan_sop_reviews() -> int:
    """Remind owners of published SOPs whose periodic review is due within 30 days."""
    horizon = timezone.now().date() + timedelta(days=30)
    count = 0
    for sop in SOP.objects.filter(
        stage=SOPStage.PUBLISHED, next_review_date__isnull=False, owner__isnull=False
    ).select_related("owner"):
        if sop.review_reminded_at is not None or sop.next_review_date > horizon:
            continue
        notify(
            sop.owner, NotificationEvent.SOP_REVIEW_DUE,
            f"SOP review due: {sop.code} — {sop.title}",
            body="Start a periodic review to keep this SOP current.",
            url="/sops",
        )
        sop.review_reminded_at = timezone.now()
        sop.save(update_fields=["review_reminded_at"])
        count += 1
    return count
