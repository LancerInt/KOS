"""Scheduled notification scans (PRD §22.3, §22.4 — AC-15, AC-16, AC-18).

Run by Celery beat. Also runnable synchronously via ``manage.py notify_scan``.
"""
from __future__ import annotations

from datetime import timedelta

from celery import shared_task
from django.contrib.auth import get_user_model
from django.utils import timezone

from .models import Notification, NotificationEvent
from .services import notify

User = get_user_model()


@shared_task
def scan_due_soon() -> int:
    """AC-15: remind owners the configured lead time before the due date
    (default 2 days, D8)."""
    from apps.tasks.models import Task
    from apps.tasks.statuses import is_done

    today = timezone.now().date()
    horizon = today + timedelta(days=30)
    count = 0
    for task in Task.objects.filter(due_date__gte=today, due_date__lte=horizon).select_related("project"):
        if is_done(task.status):
            continue
        if (task.due_date - today).days != task.reminder_lead_days:
            continue
        for owner in task.owners.all():
            already = Notification.objects.filter(
                recipient=owner, task=task, event=NotificationEvent.DUE_SOON
            ).exists()
            if not already:
                notify(owner, NotificationEvent.DUE_SOON,
                       f"Due in {task.reminder_lead_days} days: {task.title}",
                       task=task, project=task.project)
                count += 1
    return count


@shared_task
def scan_overdue_acknowledgements() -> int:
    """AC-16: at 48h overdue, notify the Primary Owner and require an
    acknowledgement."""
    from apps.tasks.models import Task
    from apps.tasks.statuses import is_done

    cutoff = timezone.now().date() - timedelta(days=2)
    count = 0
    for task in Task.objects.filter(due_date__lte=cutoff, primary_owner__isnull=False).select_related("project", "primary_owner"):
        if is_done(task.status):
            continue
        already = Notification.objects.filter(task=task, event=NotificationEvent.OVERDUE_ACK).exists()
        if already:
            continue
        notify(task.primary_owner, NotificationEvent.OVERDUE_ACK,
               f"Overdue 48h — please acknowledge: {task.title}",
               body="Reply with expected completion date, reason for delay, and any help needed.",
               task=task, project=task.project, requires_ack=True)
        count += 1
    return count


@shared_task
def run_all_scans() -> dict:
    # Later-module scans — imported lazily to avoid an app-load ordering dependency.
    from apps.automation.tasks import scan_automation
    from apps.documents.tasks import scan_document_expiry, scan_sop_reviews
    from apps.integrations.engine import retry_due
    from apps.regulatory.tasks import scan_registration_renewals
    from apps.workspaces.compliance import scan_compliance
    from apps.workspaces.duration import sync_all_due_durations

    return {
        "due_soon": scan_due_soon(),
        "overdue_ack": scan_overdue_acknowledgements(),
        "doc_expiry": scan_document_expiry(),
        "sop_reviews": scan_sop_reviews(),
        "automation": scan_automation(),
        "webhook_retries": retry_due(),
        "registration_renewals": scan_registration_renewals(),
        "workspace_durations": sync_all_due_durations(),
        "statutory_compliance": scan_compliance(),
    }
