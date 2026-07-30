"""Data collection for the AI daily stand-up.

The rule this module exists to enforce: **a stand-up shows one person their own
day, and nothing they could not already open.** Everything here is derived from
records the user owns (their tasks, their notifications) or from projects
``visible_projects`` already lets them read. Nothing widens access, so the
stand-up cannot become a side channel into a confidential project.

Like :mod:`apps.ai.context`, everything is read-only and side-effect free, and
the prompt text favours hard facts — counts, dates relative to today, owners —
over prose.
"""
from __future__ import annotations

from datetime import date, timedelta

from django.utils import timezone

from . import context as ctx

#: How many individual items of each kind reach the prompt. Beyond this the
#: counts still tell the truth; the model just stops seeing every title.
DETAIL_LIMIT = 12


def _iso(value) -> str:
    return value.isoformat() if value else ""


def _task_brief(task, today: date) -> dict:
    """One task, flattened to what a stand-up needs to say about it."""
    overdue_days = (today - task.due_date).days if task.due_date and task.due_date < today else 0
    blocker = next((b for b in task.blockers.all() if b.resolved_at is None), None)
    return {
        "id": task.id,
        "title": task.title,
        "project": task.project.name if task.project_id else "",
        "project_id": task.project_id,
        "status": task.status,
        "priority": task.priority,
        "due_date": _iso(task.due_date),
        "overdue_days": overdue_days,
        "blocked_by": (blocker.description if blocker else ""),
    }


def collect(user, *, today: date | None = None) -> dict:
    """Everything the stand-up prompt is grounded in, for one user.

    Returns a plain dict so it can be stored verbatim on the row as ``metrics``
    — a reader can then check the AI's narrative against the figures it was
    given, months later, without re-running any query.
    """
    from apps.notifications.models import Notification
    from apps.projects.models import Project
    from apps.projects.scoping import visible_projects
    from apps.tasks.models import Task

    today = today or timezone.localdate()
    yesterday = today - timedelta(days=1)
    week_end = today + timedelta(days=7)

    tasks = list(
        Task.objects.filter(owners=user)
        .exclude(status="archived")
        .select_related("project")
        .prefetch_related("owners", "blockers")
        .distinct()
    )
    open_tasks = [t for t in tasks if not ctx.is_closed(t.status)]
    # Most urgent first everywhere, so a clipped list drops the least
    # interesting items rather than an arbitrary slice.
    open_tasks.sort(key=lambda t: (t.due_date is None, t.due_date or today))

    overdue = [t for t in open_tasks if t.due_date and t.due_date < today]
    due_today = [t for t in open_tasks if t.due_date == today]
    upcoming = [t for t in open_tasks if t.due_date and today < t.due_date <= week_end]
    blocked = [t for t in open_tasks if ctx.has_open_blocker(t)]
    high_priority = [t for t in open_tasks if t.priority in ("critical", "high")]
    # "Pending" = assigned but not yet started, and not already overdue.
    pending = [
        t for t in open_tasks
        if t.status in ("backlog", "ready") and not (t.due_date and t.due_date < today)
    ]

    completed_yesterday = [
        t for t in tasks
        if t.completed_at and timezone.localtime(t.completed_at).date() == yesterday
    ]

    # Sprint ceremonies are the only dated, person-facing events KOS models —
    # there is no calendar module — so "meetings today" means a sprint starting
    # or ending today on a project this user can actually see.
    projects = visible_projects(user, Project.objects.all())
    events_today = []
    from apps.agile.models import Sprint

    sprints = Sprint.objects.filter(project__in=projects).exclude(status="completed").select_related("project")
    for sprint in sprints[:60]:
        if sprint.start_date == today:
            events_today.append({"title": f"{sprint.name} starts", "project": sprint.project.name, "kind": "sprint_start"})
        if sprint.end_date == today:
            events_today.append({"title": f"{sprint.name} ends", "project": sprint.project.name, "kind": "sprint_end"})

    notifications = list(
        Notification.objects.filter(recipient=user, is_read=False)
        .order_by("-created_at")[:DETAIL_LIMIT * 2]
    )
    needs_ack = [n for n in notifications if n.needs_acknowledgement]

    return {
        "date": today.isoformat(),
        "person": ctx._name(user),
        "counts": {
            "assigned_open": len(open_tasks),
            "completed_yesterday": len(completed_yesterday),
            "pending": len(pending),
            "overdue": len(overdue),
            "due_today": len(due_today),
            "upcoming_week": len(upcoming),
            "blocked": len(blocked),
            "high_priority": len(high_priority),
            "meetings_today": len(events_today),
            "unread_notifications": len(notifications),
            "needs_acknowledgement": len(needs_ack),
        },
        "completed_yesterday": [_task_brief(t, today) for t in completed_yesterday[:DETAIL_LIMIT]],
        "overdue": [_task_brief(t, today) for t in overdue[:DETAIL_LIMIT]],
        "due_today": [_task_brief(t, today) for t in due_today[:DETAIL_LIMIT]],
        "upcoming": [_task_brief(t, today) for t in upcoming[:DETAIL_LIMIT]],
        "blocked": [_task_brief(t, today) for t in blocked[:DETAIL_LIMIT]],
        "high_priority": [_task_brief(t, today) for t in high_priority[:DETAIL_LIMIT]],
        "pending": [_task_brief(t, today) for t in pending[:DETAIL_LIMIT]],
        "meetings_today": events_today[:DETAIL_LIMIT],
        "notifications": [
            {"title": n.title, "event": n.event, "needs_acknowledgement": n.needs_acknowledgement}
            for n in notifications[:DETAIL_LIMIT]
        ],
    }


def has_anything_to_say(data: dict) -> bool:
    """Whether this person's day is worth a stand-up at all.

    Someone with no open work, nothing completed yesterday and no unread
    notifications gets silence rather than a generated paragraph explaining that
    they have nothing on — which is the kind of message that teaches people to
    ignore the widget.
    """
    counts = data.get("counts") or {}
    return any(
        counts.get(key)
        for key in ("assigned_open", "completed_yesterday", "meetings_today", "needs_acknowledgement")
    )


# --------------------------------------------------------------------------- #
# Prompt context
# --------------------------------------------------------------------------- #
def _lines(label: str, items: list[dict], *, render) -> list[str]:
    if not items:
        return []
    return [f"{label} ({len(items)}):"] + [f"  - {render(i)}" for i in items]


def prompt_context(data: dict) -> str:
    """Render the collected data as the grounding block for the prompt."""
    counts = data.get("counts") or {}
    lines = [
        f"Person: {data.get('person') or 'this user'}",
        f"Today is {data.get('date')}.",
        "",
        "Counts: " + ", ".join(f"{k}={v}" for k, v in counts.items()),
    ]

    def task_text(item: dict) -> str:
        bits = [f'"{item["title"]}"']
        if item.get("project"):
            bits.append(f"project={item['project']}")
        bits.append(f"priority={item['priority']}")
        bits.append(f"status={item['status']}")
        if item.get("due_date"):
            bits.append(f"due={item['due_date']}")
        if item.get("overdue_days"):
            bits.append(f"OVERDUE BY {item['overdue_days']} day(s)")
        if item.get("blocked_by"):
            bits.append(f'blocked by "{item["blocked_by"]}"')
        return " | ".join(bits)

    lines += [""] + _lines("Completed yesterday", data.get("completed_yesterday") or [], render=task_text)
    lines += _lines("Overdue", data.get("overdue") or [], render=task_text)
    lines += _lines("Due today", data.get("due_today") or [], render=task_text)
    lines += _lines("Blocked", data.get("blocked") or [], render=task_text)
    lines += _lines("High priority", data.get("high_priority") or [], render=task_text)
    lines += _lines("Upcoming this week", data.get("upcoming") or [], render=task_text)
    lines += _lines("Not yet started", data.get("pending") or [], render=task_text)
    lines += _lines(
        "Meetings / events today", data.get("meetings_today") or [],
        render=lambda i: f"{i['title']} ({i['project']})",
    )
    lines += _lines(
        "Unread notifications", data.get("notifications") or [],
        render=lambda i: f"{i['title']}" + (" [acknowledgement required]" if i["needs_acknowledgement"] else ""),
    )
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# Deterministic fallback
# --------------------------------------------------------------------------- #
def fallback_content(data: dict) -> dict:
    """The stand-up written without an AI.

    Used whenever the provider is unavailable. A plainer stand-up that still
    arrives at 9am is a far better failure mode than no stand-up, and it matches
    the schema exactly so the frontend renders it identically.
    """
    counts = data.get("counts") or {}
    name = data.get("person") or "there"

    def titles(key: str, limit: int = 5) -> list[str]:
        return [item["title"] for item in (data.get(key) or [])[:limit]]

    attention = []
    for item in (data.get("overdue") or [])[:5]:
        days = item.get("overdue_days") or 0
        plural = "s" if days != 1 else ""
        attention.append(f'"{item["title"]}" is overdue by {days} day{plural}.')
    for item in (data.get("blocked") or [])[:3]:
        because = f" by {item['blocked_by']}" if item.get("blocked_by") else ""
        attention.append(f'"{item["title"]}" is blocked{because}.')

    priorities = titles("due_today") or titles("high_priority") or titles("upcoming")

    return {
        "greeting": f"Good morning, {name}.",
        "yesterday": [f"Completed {t}" for t in titles("completed_yesterday")],
        "today_priorities": priorities,
        "overdue": [f'{item["title"]} — {item["overdue_days"]} day(s) late' for item in (data.get("overdue") or [])[:5]],
        "blockers": [
            f'{item["title"]}: {item.get("blocked_by") or "blocked"}' for item in (data.get("blocked") or [])[:5]
        ],
        "attention": attention,
        "recommendations": [],
        "productivity_insight": (
            f"{counts.get('completed_yesterday', 0)} completed yesterday · "
            f"{counts.get('assigned_open', 0)} open · {counts.get('overdue', 0)} overdue · "
            f"{counts.get('blocked', 0)} blocked."
        ),
        "suggested_order": priorities,
    }
