"""Inbound event handlers (PRD §27.3).

The ERP can push updates to KOS. Handlers are deliberately narrow and validated —
an inbound message can only do the specific, safe things registered here.
"""
from __future__ import annotations


def _ping(payload: dict) -> tuple[str, str]:
    return ("processed", "pong")


def _project_status(payload: dict) -> tuple[str, str]:
    """Set a project's status from the ERP (e.g. finance marks it Completed)."""
    from apps.projects.models import Project, ProjectStatus

    code = payload.get("project_code") or payload.get("code")
    status = payload.get("status")
    if not code:
        return ("failed", "project_code is required")
    project = Project.objects.filter(code=code).first()
    if project is None:
        return ("failed", f"Unknown project '{code}'")
    if status and status in ProjectStatus.values:
        project.status = status
        project.save(update_fields=["status"])
        return ("processed", f"{code} status set to {status}")
    return ("ignored", "no recognised fields to apply")


INBOUND_HANDLERS = {
    "ping": _ping,
    "project.status": _project_status,
}


def handle_inbound(event_type: str, payload: dict) -> tuple[str, str]:
    handler = INBOUND_HANDLERS.get(event_type)
    if handler is None:
        return ("ignored", f"No handler registered for '{event_type}'")
    try:
        return handler(payload or {})
    except Exception as exc:  # noqa: BLE001
        return ("failed", str(exc)[:280])
