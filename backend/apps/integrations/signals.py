"""Signal receivers that publish outbound ERP events (§27.2).

Connected in ``IntegrationsConfig.ready()``. Mirrors the automation module's
approach: no edits to the tasks / projects / approvals apps.
"""
from __future__ import annotations


def capture_task_status(sender, instance, **kwargs):
    if instance.pk:
        instance._erp_old_status = (
            sender.objects.filter(pk=instance.pk).values_list("status", flat=True).first()
        )
    else:
        instance._erp_old_status = None


def on_task_saved(sender, instance, created, **kwargs):
    from apps.tasks.statuses import is_done

    from .engine import publish
    from .models import EventType

    if created:
        publish(EventType.TASK_CREATED, instance)
        return
    old = getattr(instance, "_erp_old_status", None)
    if old is not None and old != instance.status:
        publish(EventType.TASK_STATUS_CHANGED, instance)
        if is_done(instance.status) and not is_done(old):
            publish(EventType.TASK_COMPLETED, instance)


def on_project_saved(sender, instance, created, **kwargs):
    from .engine import publish
    from .models import EventType

    publish(EventType.PROJECT_CREATED if created else EventType.PROJECT_UPDATED, instance)


def on_approval_saved(sender, instance, created, **kwargs):
    if created or instance.status == "pending":
        return
    from .engine import publish
    from .models import EventType

    publish(EventType.APPROVAL_DECIDED, instance)
