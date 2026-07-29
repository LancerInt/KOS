"""Outbound delivery engine (PRD §27.2, §27.4).

``publish()`` fans an event out to every subscribed, active connection, creating
one ``WebhookDelivery`` each. Mock connections are delivered inline (instant, no
network) so the pipeline is demonstrable with no live ERP; real connections are
signed (HMAC-SHA256) and enqueued, with exponential-backoff retries. Publishing
never raises — an integration hiccup must not break the user action that caused
the event.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
from datetime import timedelta

from django.utils import timezone

from .payloads import build_payload

logger = logging.getLogger(__name__)


def sign(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def _body_bytes(payload: dict) -> bytes:
    return json.dumps(payload, default=str, separators=(",", ":")).encode()


def _touch(connection) -> None:
    from .models import ErpConnection
    ErpConnection.objects.filter(pk=connection.pk).update(last_delivery_at=timezone.now())


def attempt_delivery(delivery):
    """Send (or simulate) one delivery, updating its status and retry schedule."""
    from .models import DeliveryStatus

    connection = delivery.connection
    delivery.attempts += 1
    body = _body_bytes(delivery.payload)

    if connection.mock_mode:
        delivery.status = DeliveryStatus.MOCKED
        delivery.response_status = 200
        delivery.response_body = "Mock delivery — no live ERP configured."
        delivery.delivered_at = timezone.now()
        delivery.next_retry_at = None
        delivery.error = ""
        delivery.save()
        _touch(connection)
        return delivery

    try:
        import requests
    except ImportError:  # pragma: no cover
        delivery.status = DeliveryStatus.FAILED
        delivery.error = "The 'requests' package is not installed."
        delivery.save()
        return delivery

    headers = {
        "Content-Type": "application/json",
        "X-KOS-Event": delivery.event_type,
        "X-KOS-Connection": str(connection.id),
    }
    if connection.secret:
        headers["X-KOS-Signature"] = sign(connection.secret, body)
    if connection.auth_scheme == "bearer" and connection.auth_token:
        headers["Authorization"] = f"Bearer {connection.auth_token}"
    elif connection.auth_scheme == "header" and connection.auth_token:
        headers[connection.auth_header_name or "X-API-Key"] = connection.auth_token

    try:
        resp = requests.post(connection.base_url, data=body, headers=headers, timeout=10)
        delivery.response_status = resp.status_code
        delivery.response_body = (resp.text or "")[:2000]
        if 200 <= resp.status_code < 300:
            delivery.status = DeliveryStatus.DELIVERED
            delivery.delivered_at = timezone.now()
            delivery.next_retry_at = None
            delivery.error = ""
        else:
            _schedule_retry(delivery, f"HTTP {resp.status_code}")
    except Exception as exc:  # noqa: BLE001
        _schedule_retry(delivery, str(exc)[:500])

    delivery.save()
    _touch(connection)
    return delivery


def _schedule_retry(delivery, error: str) -> None:
    from .models import DeliveryStatus

    delivery.error = error
    if delivery.attempts >= delivery.connection.max_attempts:
        delivery.status = DeliveryStatus.FAILED
        delivery.next_retry_at = None
    else:
        delivery.status = DeliveryStatus.PENDING
        delivery.next_retry_at = timezone.now() + timedelta(minutes=5 * (2 ** (delivery.attempts - 1)))


def _enqueue(delivery) -> None:
    from .tasks import deliver_webhook
    try:
        deliver_webhook.delay(delivery.id)
    except Exception:  # broker unavailable — fall back to inline
        logger.warning("Celery unavailable; delivering webhook %s inline", delivery.id)
        attempt_delivery(delivery)


def _create_delivery(connection, event_type, obj, payload):
    from .models import WebhookDelivery

    return WebhookDelivery.objects.create(
        connection=connection,
        event_type=event_type,
        object_type=obj.__class__.__name__ if obj is not None else "",
        object_id=str(getattr(obj, "pk", "")) if obj is not None else "",
        payload={"event": event_type, "data": payload, "sent_at": timezone.now().isoformat()},
    )


def _dispatch(delivery) -> None:
    if delivery.connection.mock_mode:
        attempt_delivery(delivery)
    else:
        _enqueue(delivery)


def publish(event_type, obj, *, actor=None) -> int:
    """Fan an event out to subscribed connections. Returns deliveries created."""
    try:
        from .models import ErpConnection

        payload = build_payload(str(event_type), obj)
        count = 0
        for connection in ErpConnection.objects.filter(is_active=True):
            if str(event_type) not in (connection.subscribed_events or []):
                continue
            _dispatch(_create_delivery(connection, str(event_type), obj, payload))
            count += 1
        return count
    except Exception:  # noqa: BLE001 — never break the triggering action
        logger.exception("ERP publish failed for %s", event_type)
        return 0


def send_test(connection):
    """Deliver a PING to one connection (the 'Send test event' button)."""
    from .models import EventType

    delivery = _create_delivery(connection, EventType.PING, None, build_payload("ping", None))
    _dispatch(delivery)
    delivery.refresh_from_db()
    return delivery


def retry_due() -> int:
    """Re-attempt pending deliveries whose backoff has elapsed (scheduled)."""
    from .models import DeliveryStatus, WebhookDelivery

    now = timezone.now()
    due = WebhookDelivery.objects.filter(status=DeliveryStatus.PENDING, next_retry_at__lte=now).select_related("connection")
    count = 0
    for delivery in due:
        attempt_delivery(delivery)
        count += 1
    return count


# --------------------------------------------------------------------------- #
# Inbound signature verification (§27.3)
# --------------------------------------------------------------------------- #
def verify_inbound(request):
    """Return the connection whose secret signs this request, else None."""
    from .models import ErpConnection

    signature = request.headers.get("X-KOS-Signature", "")
    connection_id = request.headers.get("X-KOS-Connection")
    connections = ErpConnection.objects.filter(is_active=True, inbound_enabled=True)
    if connection_id:
        connections = connections.filter(pk=connection_id)

    body = request.body
    for connection in connections:
        if not connection.secret:
            # A keyless inbound connection is accepted only when addressed by id.
            if connection_id:
                return connection
            continue
        if signature and hmac.compare_digest(sign(connection.secret, body), signature):
            return connection
    return None
