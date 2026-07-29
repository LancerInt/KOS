"""Turn ERP records into compact prompt context.

Grounding quality is what separates a useful analysis from a plausible-sounding
one, so these builders favour hard facts — dates relative to today, counts,
owners, blockers — over prose. They are also deliberately terse: prompt tokens
are the recurring cost of every scheduled scan.

Everything here is read-only and side-effect free.
"""
from __future__ import annotations

from datetime import date, timedelta

from django.utils import timezone


def _name(user) -> str:
    if user is None:
        return ""
    full = (getattr(user, "get_full_name", lambda: "")() or "").strip()
    return full or getattr(user, "username", "") or ""


def _people(users) -> str:
    names = [n for n in (_name(u) for u in users) if n]
    # Stable order keeps prompts cache-friendly and diffs readable.
    return ", ".join(sorted(set(names)))


def _days(target: date | None, today: date | None = None) -> str:
    """Render a date as a human-relative phrase — models reason far better
    about 'overdue by 3 days' than about a raw ISO date."""
    if not target:
        return "no date"
    today = today or timezone.localdate()
    delta = (target - today).days
    if delta == 0:
        return f"{target.isoformat()} (today)"
    if delta < 0:
        return f"{target.isoformat()} (overdue by {abs(delta)} day{'s' if abs(delta) > 1 else ''})"
    return f"{target.isoformat()} (in {delta} day{'s' if delta > 1 else ''})"


def _clip(text: str, limit: int) -> str:
    text = (text or "").strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def has_open_blocker(task) -> bool:
    """Whether a task is blocked, reading prefetched blockers.

    Deliberately not ``task.blockers.filter(...).exists()``: that issues a query
    per task and so defeats ``prefetch_related``, turning a metrics roll-up over
    a few hundred tasks into a few hundred round trips.
    """
    return any(blocker.resolved_at is None for blocker in task.blockers.all())


def is_closed(status: str) -> bool:
    """Whether a task needs no further work — the test the automations must use.

    ``is_done()`` alone is not enough: a *cancelled* task is not "done", so
    ``is_done("cancelled")`` is False. Using that directly would march cancelled
    work up the escalation ladder and email leadership about it, and would count
    it as open in every metric.
    """
    from apps.tasks.statuses import StatusCategory, category_for, is_done

    return is_done(status) or category_for(status) == StatusCategory.CANCELLED


# --------------------------------------------------------------------------- #
# Tasks
# --------------------------------------------------------------------------- #
def task_line(task, *, with_id: bool = True) -> str:
    """One task as a single dense line."""
    bits = []
    if with_id:
        bits.append(f"id={task.id}")
    bits.append(f'title="{_clip(task.title, 120)}"')
    bits.append(f"status={task.status}")
    bits.append(f"priority={task.priority}")
    bits.append(f"type={task.task_type}")
    bits.append(f"due={_days(task.due_date)}")

    owners = _people(task.owners.all())
    bits.append(f"owners={owners or 'UNASSIGNED'}")
    if task.primary_owner_id:
        bits.append(f"primary_owner={_name(task.primary_owner)}")

    blocker = next((b for b in task.blockers.all() if b.resolved_at is None), None)
    if blocker:
        bits.append(f'blocked="{_clip(blocker.description, 100)}" (severity={blocker.severity})')
    if task.project_id:
        bits.append(f"project={task.project.code}")
    return " | ".join(bits)


def task_detail(task) -> str:
    """A single task in full, for rewriting / estimating / subtask generation."""
    lines = [
        f"Title: {task.title}",
        f"Project: {task.project.name} ({task.project.code})" if task.project_id else "",
        f"Type: {task.get_task_type_display()}",
        f"Status: {task.status}",
        f"Priority: {task.priority}",
        f"Start: {task.start_date or 'not set'}",
        f"Due: {_days(task.due_date)}",
        f"Owners: {_people(task.owners.all()) or 'unassigned'}",
        f"Description: {_clip(task.description, 2000) or '(none)'}",
        f"Deliverable: {_clip(task.deliverable, 600) or '(none)'}",
        f"Definition of done: {_clip(task.definition_of_done, 600) or '(none)'}",
    ]

    subtasks = list(task.subtasks.all()[:20])
    if subtasks:
        done = sum(1 for s in subtasks if s.is_done)
        lines.append(f"Existing subtasks ({done}/{len(subtasks)} done):")
        lines += [f"  - [{'x' if s.is_done else ' '}] {s.title}" for s in subtasks]

    checklist = list(task.checklist_items.all()[:20])
    if checklist:
        lines.append("Checklist:")
        lines += [
            f"  - [{'x' if c.is_done else ' '}] {c.title}{' (required)' if c.is_required else ''}"
            for c in checklist
        ]

    reasons = task.blocking_reasons()
    if reasons:
        lines.append("Cannot complete because: " + "; ".join(reasons))

    return "\n".join(line for line in lines if line)


def tasks_context(tasks, *, limit: int = 60) -> str:
    tasks = list(tasks)[:limit]
    if not tasks:
        return "(no tasks)"
    return "\n".join(task_line(t) for t in tasks)


# --------------------------------------------------------------------------- #
# Projects
# --------------------------------------------------------------------------- #
def project_metrics(project) -> dict:
    """The hard numbers behind a project analysis — also stored on reports so
    a reader can check the AI's narrative against the figures."""
    today = timezone.localdate()
    tasks = list(project.tasks.exclude(status="archived").prefetch_related("owners", "blockers"))
    open_tasks = [t for t in tasks if not is_closed(t.status)]

    overdue = [t for t in open_tasks if t.due_date and t.due_date < today]
    week_end = today + timedelta(days=7)
    due_this_week = [t for t in open_tasks if t.due_date and today <= t.due_date <= week_end]
    blocked = [t for t in open_tasks if has_open_blocker(t)]
    unassigned = [t for t in open_tasks if not t.owners.all()]

    milestones = list(project.milestones.all())
    missed = [m for m in milestones if m.due_date and m.due_date < today and m.status != "reached"]

    return {
        "total_tasks": len(tasks),
        "open_tasks": len(open_tasks),
        "completed_tasks": len(tasks) - len(open_tasks),
        "overdue_tasks": len(overdue),
        "due_this_week": len(due_this_week),
        "blocked_tasks": len(blocked),
        "unassigned_tasks": len(unassigned),
        "critical_tasks": sum(1 for t in open_tasks if t.priority == "critical"),
        "high_priority_tasks": sum(1 for t in open_tasks if t.priority == "high"),
        "milestones_total": len(milestones),
        "milestones_reached": sum(1 for m in milestones if m.status == "reached"),
        "milestones_missed": len(missed),
        "open_risks": project.risks.filter(status="open").count(),
        "open_issues": project.issues.filter(status="open").count(),
        "completion_percent": (
            round((len(tasks) - len(open_tasks)) * 100 / len(tasks)) if tasks else 0
        ),
        "days_to_target": (project.target_date - today).days if project.target_date else None,
    }


def project_context(project, *, task_limit: int = 40) -> str:
    """Everything the AI needs to judge one project."""
    metrics = project_metrics(project)
    today = timezone.localdate()

    lines = [
        f"Project: {project.name} ({project.code})",
        f"Type: {project.get_project_type_display()} | Status: {project.status} | "
        f"Recorded health: {project.health} | Priority: {project.priority}",
        f"Owner: {_name(project.owner) or 'unassigned'} | Manager: {_name(project.manager) or 'unassigned'}",
        f"Start: {project.start_date or 'not set'} | Target: {_days(project.target_date)}",
        f"Today is {today.isoformat()}.",
        f"Objective: {_clip(project.business_objective, 600) or '(not recorded)'}",
        f"Description: {_clip(project.description, 800) or '(none)'}",
        f"Success criteria: {_clip(project.success_criteria, 600) or '(none)'}",
        "",
        "Metrics: " + ", ".join(f"{k}={v}" for k, v in metrics.items() if v is not None),
    ]

    members = [m.user for m in project.memberships.select_related("user")]
    if members:
        lines.append(f"Team: {_people(members)}")

    open_tasks = [t for t in project.tasks.prefetch_related("owners", "blockers") if not is_closed(t.status)]
    # Most-at-risk first: overdue, then soonest due, so the clipped tail is the
    # least interesting work rather than an arbitrary slice.
    open_tasks.sort(key=lambda t: (t.due_date is None, t.due_date or today))
    if open_tasks:
        lines += ["", f"Open tasks (showing {min(len(open_tasks), task_limit)} of {len(open_tasks)}):"]
        lines += [f"  {task_line(t)}" for t in open_tasks[:task_limit]]

    milestones = list(project.milestones.all()[:15])
    if milestones:
        lines += ["", "Milestones:"]
        lines += [f"  - {m.title}: {m.status}, due {_days(m.due_date)}" for m in milestones]

    risks = list(project.risks.filter(status="open")[:10])
    if risks:
        lines += ["", "Open risks on the register:"]
        lines += [
            f"  - {_clip(r.statement, 160)} (probability={r.probability}, impact={r.impact})" for r in risks
        ]

    issues = list(project.issues.filter(status="open")[:10])
    if issues:
        lines += ["", "Open issues:"]
        lines += [f"  - {_clip(i.description, 160)} (severity={i.severity})" for i in issues]

    return "\n".join(lines)


def people_context(project) -> str:
    """The only names the AI is allowed to suggest as assignees."""
    members = [m.user for m in project.memberships.select_related("user")]
    names = _people(members)
    return f"People available on this project: {names}" if names else ""


# --------------------------------------------------------------------------- #
# People & workload
# --------------------------------------------------------------------------- #
def user_workload_context(user, *, limit: int = 40) -> str:
    from apps.tasks.models import Task

    today = timezone.localdate()
    tasks = [
        t
        for t in Task.objects.filter(owners=user).exclude(status="archived").select_related("project").prefetch_related("owners", "blockers").distinct()
        if not is_closed(t.status)
    ]
    tasks.sort(key=lambda t: (t.due_date is None, t.due_date or today))

    overdue = [t for t in tasks if t.due_date and t.due_date < today]
    due_today = [t for t in tasks if t.due_date == today]

    lines = [
        f"Person: {_name(user)}",
        f"Today is {today.isoformat()}.",
        f"Open tasks: {len(tasks)} | Overdue: {len(overdue)} | Due today: {len(due_today)}",
        "",
        "Tasks:",
    ]
    lines += [f"  {task_line(t)}" for t in tasks[:limit]]
    return "\n".join(lines)


def team_workload_context(users, *, limit_per_user: int = 15) -> str:
    return "\n\n".join(user_workload_context(u, limit=limit_per_user) for u in users)


# --------------------------------------------------------------------------- #
# CRM
# --------------------------------------------------------------------------- #
def customer_context(customer) -> str:
    lines = [
        f"Customer: {customer.name}",
        f"Type: {customer.get_customer_type_display()} | Status: {customer.status}",
        f"Industry: {customer.industry or 'unknown'} | Region: {customer.region or 'unknown'}",
        f"Account owner: {_name(customer.owner) or 'unassigned'}",
        f"Notes: {_clip(customer.notes, 1200) or '(none)'}",
    ]

    contacts = list(customer.contacts.all()[:10])
    if contacts:
        lines += ["", "Contacts:"]
        lines += [
            f"  - {c.name}{f', {c.title}' if c.title else ''}"
            f"{' (primary)' if c.is_primary else ''}{f' <{c.email}>' if c.email else ''}"
            for c in contacts
        ]

    opportunities = list(customer.opportunities.all()[:15])
    if opportunities:
        lines += ["", "Opportunities:"]
        lines += [
            f"  - {o.title}: stage={o.stage}, amount={o.amount} {o.currency}, "
            f"probability={o.probability}%, expected close {_days(o.expected_close_date)}"
            + (f", lost because: {o.lost_reason}" if o.lost_reason else "")
            for o in opportunities
        ]
        open_value = sum(float(o.amount) for o in opportunities if o.is_open)
        lines.append(f"Total open pipeline value: {open_value:.2f}")

    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# Events (for the notification generator)
# --------------------------------------------------------------------------- #
def overdue_event_context(task, *, stage_label: str, hours_overdue: float) -> str:
    """One overdue task framed for notification copywriting."""
    return "\n".join(
        [
            f"reference: task-{task.id}",
            f"event: task overdue by approximately {hours_overdue:.0f} hours",
            f"escalation stage: {stage_label}",
            f"task: {task.title}",
            f"project: {task.project.name} ({task.project.code})" if task.project_id else "",
            f"status: {task.status} | priority: {task.priority}",
            f"due: {_days(task.due_date)}",
            f"owners: {_people(task.owners.all()) or 'unassigned'}",
            f"primary owner: {_name(task.primary_owner) or 'none'}",
            f"deliverable: {_clip(task.deliverable, 300) or '(not recorded)'}",
        ]
    )


def events_context(entries: list[str]) -> str:
    return "\n\n---\n\n".join(e for e in entries if e)


# --------------------------------------------------------------------------- #
# Dashboards & reports
# --------------------------------------------------------------------------- #
def metrics_context(metrics: dict, *, heading: str = "Figures") -> str:
    lines = [f"{heading}:"]
    for key, value in metrics.items():
        if isinstance(value, (list, tuple)):
            value = ", ".join(str(v) for v in value) or "(none)"
        lines.append(f"  {key}: {value}")
    return "\n".join(lines)
