"""Background delivery & retry (PRD §27.4)."""
from __future__ import annotations

from celery import shared_task


@shared_task
def deliver_webhook(delivery_id: int) -> str:
    from .engine import attempt_delivery
    from .models import WebhookDelivery

    delivery = WebhookDelivery.objects.filter(pk=delivery_id).select_related("connection").first()
    if delivery is None:
        return "missing"
    attempt_delivery(delivery)
    return delivery.status


@shared_task
def retry_pending_deliveries() -> int:
    from .engine import retry_due

    return retry_due()
