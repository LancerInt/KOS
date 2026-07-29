"""Helpers for writing audit records (PRD §26)."""
from __future__ import annotations

from typing import Any

from rest_framework.request import Request

from .models import AuditLog


def client_ip(request: Request | None) -> str | None:
    if request is None:
        return None
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def record(
    *,
    action: str,
    actor: Any = None,
    obj: Any = None,
    object_type: str = "",
    object_id: str = "",
    old_value: Any = None,
    new_value: Any = None,
    reason: str = "",
    request: Request | None = None,
) -> AuditLog:
    """Write one immutable audit record.

    Pass either ``obj`` (a model instance) or explicit ``object_type``/``object_id``.
    ``actor`` defaults to ``request.user`` when a request is supplied.
    """
    if obj is not None:
        object_type = object_type or obj.__class__.__name__
        object_id = object_id or str(getattr(obj, "pk", ""))

    if actor is None and request is not None:
        user = getattr(request, "user", None)
        if user is not None and getattr(user, "is_authenticated", False):
            actor = user

    return AuditLog.objects.create(
        actor=actor if getattr(actor, "pk", None) else None,
        action=action,
        object_type=object_type,
        object_id=object_id,
        old_value=old_value,
        new_value=new_value,
        reason=reason,
        source_ip=client_ip(request),
    )
