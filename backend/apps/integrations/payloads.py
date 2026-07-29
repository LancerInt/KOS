"""Outbound payload builders (PRD §27.2).

Small, stable dictionaries — the integration contract. Kept deliberately flat so
the ERP mapping is obvious and version-tolerant.
"""
from __future__ import annotations


def _user(user) -> dict | None:
    if user is None:
        return None
    return {"id": user.id, "name": user.get_full_name() or user.username, "email": user.email}


def _date(value) -> str | None:
    return value.isoformat() if value else None


def project_payload(project) -> dict:
    return {
        "id": project.id,
        "code": project.code,
        "name": project.name,
        "status": project.status,
        "health": project.health,
        "project_type": project.project_type,
        "owner": _user(project.owner),
        "start_date": _date(project.start_date),
        "target_date": _date(project.target_date),
    }


def task_payload(task) -> dict:
    return {
        "id": task.id,
        "title": task.title,
        "project_code": task.project.code,
        "status": task.status,
        "category": task.category,
        "priority": task.priority,
        "primary_owner": _user(task.primary_owner),
        "due_date": _date(task.due_date),
    }


def approval_payload(approval) -> dict:
    return {
        "id": approval.id,
        "kind": approval.kind,
        "status": approval.status,
        "target": approval.target_label,
        "task": approval.task_id,
        "project": approval.project_id,
        "approver": _user(approval.approver),
    }


def build_payload(event_type: str, obj) -> dict:
    if event_type == "ping":
        return {"message": "KOS integration test"}
    if obj is None:
        return {}
    if event_type.startswith("project"):
        return project_payload(obj)
    if event_type.startswith("task"):
        return task_payload(obj)
    if event_type.startswith("approval"):
        return approval_payload(obj)
    return {}
