"""Canonical status categories and the default task workflow (PRD §12.1, §12.2).

The **six canonical categories are fixed forever** (§12.1) — reporting,
dashboards and automation operate on categories, never raw status names. In
Module 3 every project uses the default 14-status workflow below. Module 4 (the
Workflow Engine) makes the status set team-authored per project, but each custom
status still maps to one of these six categories (A2).
"""
from __future__ import annotations

from django.db import models


class StatusCategory(models.TextChoices):
    """PRD §12.1 / Appendix C.1 — the fixed six."""

    NOT_STARTED = "not_started", "Not Started"
    ACTIVE = "active", "Active"
    WAITING = "waiting", "Waiting"
    IN_REVIEW = "in_review", "In Review"
    DONE = "done", "Done"
    CANCELLED = "cancelled", "Cancelled"


# key, label, category  (PRD §12.2 / Appendix C.2)
DEFAULT_STATUSES: list[tuple[str, str, str]] = [
    ("backlog", "Backlog", StatusCategory.NOT_STARTED),
    ("ready", "Ready", StatusCategory.NOT_STARTED),
    ("in_progress", "In Progress", StatusCategory.ACTIVE),
    ("blocked", "Blocked", StatusCategory.WAITING),
    ("waiting_dependency", "Waiting Dependency", StatusCategory.WAITING),
    ("on_hold", "On Hold", StatusCategory.WAITING),
    ("review", "Review", StatusCategory.IN_REVIEW),
    ("qa", "QA", StatusCategory.IN_REVIEW),
    ("rework", "Rework", StatusCategory.ACTIVE),
    ("approved", "Approved", StatusCategory.IN_REVIEW),
    ("completed", "Completed", StatusCategory.DONE),
    ("archived", "Archived", StatusCategory.DONE),
    ("cancelled", "Cancelled", StatusCategory.CANCELLED),
    ("reopened", "Reopened", StatusCategory.ACTIVE),
]

STATUS_CATEGORY: dict[str, str] = {key: cat for key, _label, cat in DEFAULT_STATUSES}
STATUS_LABEL: dict[str, str] = {key: label for key, label, _cat in DEFAULT_STATUSES}
DEFAULT_STATUS_CHOICES = [(key, label) for key, label, _cat in DEFAULT_STATUSES]

INITIAL_STATUS = "backlog"
COMPLETED_STATUS = "completed"

# Sensible default transition graph (PRD §12.2, flowchart A.4). Used as the
# starting graph when a team clones the default into a custom workflow. The
# built-in default itself stays permissive so it never surprises existing tasks.
DEFAULT_TRANSITIONS: list[tuple[str, str]] = [
    ("backlog", "ready"),
    ("backlog", "cancelled"),
    ("ready", "in_progress"),
    ("ready", "cancelled"),
    ("in_progress", "blocked"),
    ("in_progress", "waiting_dependency"),
    ("in_progress", "on_hold"),
    ("in_progress", "review"),
    ("in_progress", "qa"),
    ("in_progress", "cancelled"),
    ("blocked", "in_progress"),
    ("waiting_dependency", "in_progress"),
    ("on_hold", "in_progress"),
    ("review", "approved"),
    ("review", "in_progress"),  # request changes
    ("review", "rework"),       # reject
    ("qa", "approved"),
    ("qa", "rework"),
    ("rework", "review"),
    ("approved", "completed"),
    ("completed", "archived"),
    ("completed", "reopened"),
    ("reopened", "in_progress"),
]


def category_for(status: str) -> str:
    return STATUS_CATEGORY.get(status, StatusCategory.NOT_STARTED)


def is_done(status: str) -> bool:
    return category_for(status) == StatusCategory.DONE
