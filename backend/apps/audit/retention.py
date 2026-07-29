"""Retention & purge (PRD §26.4, recommended change #1).

The purge routine is intentionally conservative: it only deletes record types
that are **explicitly listed here as purge-safe**. Business data (tasks,
projects, documents) and the audit trail itself are never touched by purge, no
matter what policy rows exist — so a mis-configured "delete everything after a
year" policy (the D14 risk) cannot destroy regulated records.
"""
from __future__ import annotations

from datetime import timedelta

from django.apps import apps as django_apps
from django.utils import timezone

# record_type -> (app_label, model_name). Only these are ever purged.
PURGE_SAFE: dict[str, tuple[str, str]] = {
    "notification": ("notifications", "Notification"),
    "automation_log": ("automation", "AutomationLog"),
}

# Seeded policy defaults. Exempt types appear in the UI as governed-but-never-purged.
DEFAULT_POLICIES = [
    {"record_type": "audit_log", "label": "Audit trail", "is_exempt": True,
     "description": "Immutable compliance record — never purged (§26.3)."},
    {"record_type": "regulatory_document", "label": "Regulatory documents", "is_exempt": True,
     "description": "CIBRC / EPA registrations, licences & certificates — retained indefinitely."},
    {"record_type": "document", "label": "Documents (general)", "retention_days": None,
     "description": "Kept until superseded or manually archived."},
    {"record_type": "notification", "label": "Notifications", "retention_days": 365,
     "description": "In-app / email notifications older than a year are purged."},
    {"record_type": "automation_log", "label": "Automation run log", "retention_days": 180,
     "description": "Automation execution history older than six months is purged."},
]


def preview_purge() -> list[dict]:
    """What a purge would remove right now, without deleting anything."""
    from .models import RetentionPolicy

    now = timezone.now()
    out = []
    for record_type, (app_label, model_name) in PURGE_SAFE.items():
        policy = RetentionPolicy.objects.filter(record_type=record_type).first()
        exempt = bool(policy and policy.is_exempt)
        days = policy.retention_days if policy else None
        count = 0
        if not exempt and days:
            model = django_apps.get_model(app_label, model_name)
            count = model.objects.filter(created_at__lt=now - timedelta(days=days)).count()
        out.append({
            "record_type": record_type,
            "label": policy.label if policy else record_type,
            "retention_days": days, "exempt": exempt, "eligible": count,
        })
    return out


def run_purge() -> dict[str, int]:
    """Delete expired purge-safe records. Returns per-type deleted counts."""
    from .models import RetentionPolicy

    now = timezone.now()
    results: dict[str, int] = {}
    for record_type, (app_label, model_name) in PURGE_SAFE.items():
        policy = RetentionPolicy.objects.filter(record_type=record_type).first()
        if not policy or policy.is_exempt or not policy.retention_days:
            results[record_type] = 0
            continue
        model = django_apps.get_model(app_label, model_name)
        deleted, _ = model.objects.filter(created_at__lt=now - timedelta(days=policy.retention_days)).delete()
        results[record_type] = deleted
    return results
