"""Scheduled automation triggers (PRD §24.2 — time-based events).

Fires ``task_overdue`` and ``task_due_soon`` once per task per day, deduped via
``AutomationLog``. Wired into ``notifications.run_all_scans``.
"""
from __future__ import annotations

from datetime import timedelta

from celery import shared_task
from django.utils import timezone


@shared_task
def scan_automation() -> dict:
    from apps.tasks.models import Task
    from apps.tasks.statuses import is_done

    from .engine import run_event
    from .models import AutomationLog, SCHEDULED_TRIGGERS, TriggerType

    if not SCHEDULED_TRIGGERS:  # pragma: no cover
        return {"overdue": 0, "due_soon": 0}

    today = timezone.now().date()
    soon = today + timedelta(days=3)
    fired = {"overdue": 0, "due_soon": 0}

    def _already(task, trigger) -> bool:
        return AutomationLog.objects.filter(task=task, trigger=trigger, created_at__date=today).exists()

    open_tasks = Task.objects.filter(due_date__isnull=False).select_related("project")

    for task in open_tasks.filter(due_date__lt=today):
        if is_done(task.status) or _already(task, TriggerType.TASK_OVERDUE):
            continue
        if run_event(TriggerType.TASK_OVERDUE, task=task):
            fired["overdue"] += 1

    for task in open_tasks.filter(due_date__gte=today, due_date__lte=soon):
        if is_done(task.status) or _already(task, TriggerType.TASK_DUE_SOON):
            continue
        if run_event(TriggerType.TASK_DUE_SOON, task=task):
            fired["due_soon"] += 1

    return fired
