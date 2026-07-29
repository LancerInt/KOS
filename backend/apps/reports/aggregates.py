"""Shared aggregation helpers for the reporting module (PRD §20, §23).

All reporting works on the **six canonical categories** (§12.1), never on raw
status names, so numbers stay stable across team-authored workflows (A2).
Everything is computed over the caller's *visible* projects — the same
server-side scoping rule used everywhere else (§7.7).
"""
from __future__ import annotations

from datetime import date, timedelta

from django.db.models import Count, Q

from apps.projects.models import Membership, Project
from apps.projects.scoping import visible_projects
from apps.tasks.models import Task
from apps.tasks.statuses import STATUS_CATEGORY, StatusCategory

CANON = [
    StatusCategory.NOT_STARTED.value,
    StatusCategory.ACTIVE.value,
    StatusCategory.WAITING.value,
    StatusCategory.IN_REVIEW.value,
    StatusCategory.DONE.value,
    StatusCategory.CANCELLED.value,
]
CLOSED_CATEGORIES = {StatusCategory.DONE.value, StatusCategory.CANCELLED.value}


def category_map() -> dict[str, str]:
    """status key → canonical category, merging the default workflow with every
    team-authored status (each of which must declare a category, A2)."""
    from apps.workflows.models import WorkflowStatus

    merged = dict(STATUS_CATEGORY)
    for key, category in WorkflowStatus.objects.values_list("key", "category"):
        merged.setdefault(key, category)
    return merged


def closed_statuses(cat_map: dict[str, str]) -> list[str]:
    return [status for status, category in cat_map.items() if category in CLOSED_CATEGORIES]


def empty_categories() -> dict[str, int]:
    return {c: 0 for c in CANON}


def fold_categories(status_rows, cat_map: dict[str, str]) -> dict[str, int]:
    """Fold ``[{"status", "n"}]`` rows into per-category counts."""
    out = empty_categories()
    for row in status_rows:
        category = cat_map.get(row["status"], StatusCategory.NOT_STARTED.value)
        out[category] = out.get(category, 0) + row["n"]
    return out


def project_report_rows(user) -> list[dict]:
    """One rollup row per visible project (§23.2)."""
    today = date.today()
    cat_map = category_map()
    closed = closed_statuses(cat_map)

    projects = list(
        visible_projects(user, Project.objects.all())
        .select_related("owner")
        .prefetch_related("milestones")
    )
    ids = [p.id for p in projects]

    def _by_project(rows) -> dict[int, int]:
        return {r["project_id"]: r["n"] for r in rows}

    status_rows = list(
        Task.objects.filter(project_id__in=ids).values("project_id", "status").annotate(n=Count("id"))
    )
    per_project_status: dict[int, list] = {}
    for r in status_rows:
        per_project_status.setdefault(r["project_id"], []).append(r)

    overdue = _by_project(
        Task.objects.filter(project_id__in=ids, due_date__lt=today).exclude(status__in=closed)
        .values("project_id").annotate(n=Count("id"))
    )
    members = _by_project(
        Membership.objects.filter(project_id__in=ids).values("project_id").annotate(n=Count("id"))
    )

    from apps.registers.models import Issue, RegisterStatus, Risk

    open_reg = [RegisterStatus.OPEN, RegisterStatus.IN_PROGRESS]
    risks = _by_project(
        Risk.objects.filter(project_id__in=ids, status__in=open_reg).values("project_id").annotate(n=Count("id"))
    )
    issues = _by_project(
        Issue.objects.filter(project_id__in=ids, status__in=open_reg).values("project_id").annotate(n=Count("id"))
    )

    rows = []
    for p in projects:
        cats = fold_categories(per_project_status.get(p.id, []), cat_map)
        total = sum(cats.values())
        done = cats[StatusCategory.DONE.value]
        cancelled = cats[StatusCategory.CANCELLED.value]
        rows.append({
            "id": p.id,
            "code": p.code,
            "name": p.name,
            "project_type": p.project_type,
            "status": p.status,
            "health": p.health,
            "progress": p.progress,
            "owner_name": (p.owner.get_full_name() or p.owner.username) if p.owner else "",
            "members": members.get(p.id, 0),
            "tasks_total": total,
            "tasks_open": total - done - cancelled,
            "tasks_done": done,
            "tasks_overdue": overdue.get(p.id, 0),
            "by_category": cats,
            "open_risks": risks.get(p.id, 0),
            "open_issues": issues.get(p.id, 0),
        })
    return rows


def horizon(days: int) -> date:
    return date.today() + timedelta(days=days)
