"""Renewal reminders for approved registrations (PRD §29.3).

Reuses the shared reminder engine — notify the owner when an approved
registration nears expiry. Wired into ``notifications.run_all_scans``.
"""
from __future__ import annotations

from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from apps.notifications.models import NotificationEvent
from apps.notifications.services import notify

from .models import RegStatus, RegulatoryRegistration


@shared_task
def scan_registration_renewals() -> int:
    today = timezone.now().date()
    count = 0
    for reg in RegulatoryRegistration.objects.filter(
        status=RegStatus.APPROVED, expiry_date__isnull=False, owner__isnull=False
    ).select_related("owner", "project"):
        if reg.expiry_reminded_at is not None:
            continue
        days = (reg.expiry_date - today).days
        if days > reg.reminder_lead_days:
            continue
        when = "has expired" if days < 0 else f"expires in {days} day(s)"
        notify(
            reg.owner, NotificationEvent.REGISTRATION_DUE,
            f"Registration {when}: {reg.product_name}",
            body="Begin the renewal process to keep this product registered.",
            project=reg.project, url="/regulatory", requires_ack=days < 0,
        )
        reg.expiry_reminded_at = timezone.now()
        reg.save(update_fields=["expiry_reminded_at"])
        count += 1
    return count
