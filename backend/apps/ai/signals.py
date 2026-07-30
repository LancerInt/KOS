"""Signal receivers that watch tasks cross into a critical stage.

Connected in :class:`apps.ai.apps.AIConfig`. The pair is the standard
before/after trick: ``pre_save`` stashes the values as they are in the database,
``post_save`` compares them with what was just written. Only a genuine crossing
fires an alert.

The work happens in :func:`django.db.transaction.on_commit`, never inline. Two
reasons: the alert must not be sent for a save that a later exception rolls
back, and a user pressing "Save" should not wait on an SMTP handshake.
"""
from __future__ import annotations

import logging

from django.db import transaction

logger = logging.getLogger(__name__)

#: Fields whose change can constitute a critical transition. A save that touches
#: none of them — a description edit, a rank shuffle — is skipped before any
#: query runs, which matters because bulk operations save tasks in loops.
WATCHED_FIELDS = {"priority", "status", "risk_level", "due_date"}


def capture_critical_state(sender, instance, **kwargs):
    """Stash the stored values so post_save can spot a real change.

    A separate attribute from ``automation``'s ``_old_status``: two apps reading
    one another's private attributes on a shared model is exactly the coupling
    that breaks the day one of them stops setting it.
    """
    if not instance.pk:
        instance._ai_previous = None
        return
    instance._ai_previous = (
        sender.objects.filter(pk=instance.pk)
        .values("priority", "status", "risk_level")
        .first()
    )


def on_task_saved(sender, instance, created, **kwargs):
    if getattr(instance, "_skip_ai_alert", False):
        return

    update_fields = kwargs.get("update_fields")
    if update_fields is not None and not WATCHED_FIELDS & set(update_fields):
        return

    previous = getattr(instance, "_ai_previous", None)
    if created:
        # A task can be born critical — imported, or raised straight from an
        # incident. There is no previous state, so every check sees a crossing.
        previous = {}
    elif previous is None:
        return

    from .critical import detect_transition

    try:
        reason = detect_transition(
            instance,
            old_priority=previous.get("priority"),
            old_status=previous.get("status"),
            old_risk=previous.get("risk_level"),
        )
    except Exception:
        logger.exception("Critical-stage detection failed for task %s", instance.pk)
        return

    if not reason:
        return

    transaction.on_commit(lambda: _dispatch(instance.pk, reason))


def _dispatch(task_id: int, reason: str) -> None:
    """Hand the alert to a worker, or send it here if no broker is reachable.

    The inline path deliberately skips the AI copywriting call and uses the
    deterministic template instead. Running inline means running inside the
    request that saved the task, and a provider round-trip there would make
    every critical task update feel broken — a plainer email sent immediately is
    the better trade.
    """
    from .tasks import alert_critical_task

    try:
        alert_critical_task.apply_async(args=[task_id], kwargs={"reason": reason}, retry=False)
    except Exception as exc:
        logger.info("Celery unavailable (%s); sending critical alert inline.", exc)
        try:
            alert_critical_task(task_id, reason=reason, use_ai=False)
        except Exception:
            logger.exception("Inline critical alert failed for task %s", task_id)
