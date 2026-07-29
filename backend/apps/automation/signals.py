"""Signal receivers that turn live model changes into automation events (§24.2).

Connected in ``AutomationConfig.ready()``. Each handler is thin: it decides which
trigger fired and hands off to the engine. The ``_skip_automation`` flag on an
instance short-circuits re-dispatch when an action itself saved that instance,
preventing loops.
"""
from __future__ import annotations


def capture_old_status(sender, instance, **kwargs):
    """Remember the pre-save status so post_save can detect a real change."""
    if instance.pk:
        instance._old_status = (
            sender.objects.filter(pk=instance.pk).values_list("status", flat=True).first()
        )
    else:
        instance._old_status = None


def on_task_saved(sender, instance, created, **kwargs):
    if getattr(instance, "_skip_automation", False):
        return
    from apps.tasks.statuses import is_done

    from .engine import run_event
    from .models import TriggerType

    if created:
        run_event(TriggerType.TASK_CREATED, task=instance)
        return

    old = getattr(instance, "_old_status", None)
    if old is not None and old != instance.status:
        run_event(TriggerType.TASK_STATUS_CHANGED, task=instance)
        if is_done(instance.status) and not is_done(old):
            run_event(TriggerType.TASK_COMPLETED, task=instance)


def on_blocker_saved(sender, instance, created, **kwargs):
    if not created or instance.resolved_at is not None:
        return
    from .engine import run_event
    from .models import TriggerType

    run_event(TriggerType.BLOCKER_RAISED, task=instance.task)


def on_approval_saved(sender, instance, created, **kwargs):
    # Fire when a pending request reaches a decision.
    if created or instance.status == "pending":
        return
    from .engine import run_event
    from .models import TriggerType

    run_event(TriggerType.APPROVAL_DECIDED, task=instance.task, project=instance.project)
