"""Data collection for the AI executive summary.

Organisation-wide by definition, which is why every route into it is gated on
``VIEW_REPORTS`` or ``ADMINISTER`` before this module is ever called — unlike
:mod:`apps.ai.standup`, nothing here is self-scoping.

Two deliberate choices:

**The figures are computed, not generated.** Health score, risk ranking and the
per-team roll-up are ordinary arithmetic over ERP rows. The AI is asked to
*explain and advise*, never to invent a number, so a summary written during a
provider outage still carries the correct metrics.

**Optional sources stay optional.** Revenue, CRM and approval figures appear
only when those modules hold data, so a deployment that does not use CRM gets a
summary about delivery rather than a section full of zeroes.
"""
from __future__ import annotations

from datetime import date, timedelta

from django.db.models import Count, Q
from django.utils import timezone

from . import context as ctx

#: Projects listed individually in the "high risk" block.
RISK_LIST_LIMIT = 10
#: People listed individually in the team roll-up.
TEAM_LIST_LIMIT = 12
#: Risk score at or above which a project is reported as high risk.
HIGH_RISK_THRESHOLD = 50


def _pct(part: int, whole: int) -> int:
    return round(part * 100 / whole) if whole else 0


# --------------------------------------------------------------------------- #
# Per-project risk
# --------------------------------------------------------------------------- #
def _project_risk(project, tasks: list, today: date) -> dict:
    """Score one project's delivery risk from its own figures.

    Deliberately a transparent additive score rather than a model judgement: a
    manager reading "78 — 4 overdue, 2 blocked, target date passed" can check
    every term. The AI gets this score as an input, not as something to guess.
    """
    open_tasks = [t for t in tasks if not ctx.is_closed(t.status)]
    overdue = [t for t in open_tasks if t.due_date and t.due_date < today]
    blocked = [t for t in open_tasks if ctx.has_open_blocker(t)]
    critical = [t for t in open_tasks if t.priority == "critical"]
    unassigned = [t for t in open_tasks if not t.owners.all()]

    days_to_target = (project.target_date - today).days if project.target_date else None

    score = 0
    reasons: list[str] = []
    if open_tasks:
        # The share of open work that is late is the single strongest signal, and
        # is weighted so that a wholly-overdue project reaches the high-risk
        # threshold on this term alone — it does not need a second symptom.
        overdue_share = _pct(len(overdue), len(open_tasks))
        if overdue_share:
            score += min(HIGH_RISK_THRESHOLD, overdue_share)
            reasons.append(f"{len(overdue)} of {len(open_tasks)} open tasks overdue")
    if blocked:
        score += min(20, len(blocked) * 5)
        reasons.append(f"{len(blocked)} blocked")
    if critical:
        score += min(15, len(critical) * 5)
        reasons.append(f"{len(critical)} critical")
    if unassigned:
        score += min(10, len(unassigned) * 2)
        reasons.append(f"{len(unassigned)} unassigned")
    if days_to_target is not None and days_to_target < 0 and open_tasks:
        score += 25
        reasons.append(f"target date passed {abs(days_to_target)} days ago")
    elif days_to_target is not None and 0 <= days_to_target <= 14 and len(open_tasks) > len(tasks) * 0.4:
        score += 15
        reasons.append(f"{days_to_target} days to target with {len(open_tasks)} open")
    if project.health == "off_track":
        score += 20
        reasons.append("recorded health is off track")
    elif project.health == "at_risk":
        score += 10
        reasons.append("recorded health is at risk")

    return {
        "id": project.id,
        "name": project.name,
        "code": project.code,
        "status": project.status,
        "health": project.health,
        "manager": ctx._name(project.manager) or ctx._name(project.owner),
        "risk_score": min(100, score),
        "reasons": reasons,
        "open_tasks": len(open_tasks),
        "overdue_tasks": len(overdue),
        "blocked_tasks": len(blocked),
        "target_date": project.target_date.isoformat() if project.target_date else "",
        "days_to_target": days_to_target,
        "completion_percent": _pct(len(tasks) - len(open_tasks), len(tasks)),
    }


def _health_score(metrics: dict) -> int:
    """Overall business health, 0-100.

    Starts at 100 and deducts for each thing that is actually wrong, so the
    score is explainable term by term and a clean organisation genuinely scores
    100 rather than an arbitrary "typical" number.
    """
    score = 100
    delivery = metrics["delivery"]
    projects = metrics["projects"]

    score -= min(30, _pct(delivery["overdue_tasks"], max(delivery["open_tasks"], 1)))
    score -= min(15, _pct(delivery["blocked_tasks"], max(delivery["open_tasks"], 1)))
    score -= min(20, projects["high_risk"] * 5)
    score -= min(10, projects["delayed"] * 3)
    score -= min(10, _pct(metrics["milestones"]["missed"], max(metrics["milestones"]["total"], 1)) // 2)
    score -= min(10, metrics["quality"]["critical_issues"] * 3)
    score -= min(5, metrics["quality"]["sla_violations"])
    return max(0, min(100, score))


# --------------------------------------------------------------------------- #
# Collection
# --------------------------------------------------------------------------- #
def collect(*, start: date, end: date) -> dict:
    """Organisation-wide figures for one reporting period."""
    from apps.approvals.models import ApprovalRequest, ApprovalStatus
    from apps.projects.models import Milestone, MilestoneStatus, Project, ProjectStatus
    from apps.registers.models import Issue, RegisterStatus
    from apps.tasks.models import Task

    from .models import AIAutomationLog, AutomationEvent

    today = timezone.localdate()

    # --- projects ---------------------------------------------------------- #
    projects = list(
        Project.objects.exclude(status__in=[ProjectStatus.ARCHIVED, ProjectStatus.CANCELLED])
        .select_related("owner", "manager")
    )
    tasks = list(
        Task.objects.exclude(status="archived")
        .select_related("project")
        .prefetch_related("owners", "blockers")
    )
    tasks_by_project: dict[int, list] = {}
    for task in tasks:
        tasks_by_project.setdefault(task.project_id, []).append(task)

    risk_rows = [
        _project_risk(project, tasks_by_project.get(project.id, []), today)
        for project in projects
        if project.status in (ProjectStatus.ACTIVE, ProjectStatus.AT_RISK, ProjectStatus.APPROVED)
    ]
    risk_rows.sort(key=lambda r: (-r["risk_score"], r["name"]))
    high_risk = [r for r in risk_rows if r["risk_score"] >= HIGH_RISK_THRESHOLD]

    completed_projects = [
        p for p in Project.objects.filter(status=ProjectStatus.COMPLETED)
        if p.actual_completion_date and start <= p.actual_completion_date <= end
    ]
    delayed_projects = [
        r for r in risk_rows
        if r["days_to_target"] is not None and r["days_to_target"] < 0 and r["open_tasks"] > 0
    ]

    # --- delivery ----------------------------------------------------------- #
    open_tasks = [t for t in tasks if not ctx.is_closed(t.status)]
    completed_in_period = [
        t for t in tasks
        if t.completed_at and start <= timezone.localtime(t.completed_at).date() <= end
    ]
    created_in_period = [t for t in tasks if start <= t.created_at.date() <= end]
    overdue_tasks = [t for t in open_tasks if t.due_date and t.due_date < today]
    blocked_tasks = [t for t in open_tasks if ctx.has_open_blocker(t)]

    # --- team productivity --------------------------------------------------- #
    # Built from the same in-memory task list rather than a query per person:
    # this is the roll-up over every task in the system, so a per-user query
    # would be one round trip per employee.
    per_person: dict[int, dict] = {}
    for task in tasks:
        for owner in task.owners.all():
            row = per_person.setdefault(
                owner.id,
                {"person": ctx._name(owner), "completed": 0, "open": 0, "overdue": 0, "blocked": 0},
            )
            if task.completed_at and start <= timezone.localtime(task.completed_at).date() <= end:
                row["completed"] += 1
            if not ctx.is_closed(task.status):
                row["open"] += 1
                if task.due_date and task.due_date < today:
                    row["overdue"] += 1
                if ctx.has_open_blocker(task):
                    row["blocked"] += 1

    team = sorted(per_person.values(), key=lambda r: (-r["overdue"], -r["open"]))
    needs_attention = [r for r in team if r["overdue"] >= 3 or (r["open"] >= 10 and r["completed"] == 0)]

    # --- milestones ---------------------------------------------------------- #
    milestones = Milestone.objects.aggregate(
        total=Count("id"),
        reached=Count("id", filter=Q(status=MilestoneStatus.REACHED)),
        missed=Count("id", filter=Q(status=MilestoneStatus.MISSED)),
        due_soon=Count("id", filter=Q(due_date__gte=today, due_date__lte=today + timedelta(days=14))
                       & ~Q(status=MilestoneStatus.REACHED)),
    )

    # --- quality / governance ------------------------------------------------ #
    critical_issues = list(
        Issue.objects.filter(status__in=[RegisterStatus.OPEN, RegisterStatus.IN_PROGRESS], severity="critical")
        .select_related("project")[:RISK_LIST_LIMIT]
    )
    sla_violations = AIAutomationLog.objects.filter(
        event=AutomationEvent.SLA_VIOLATION, ok=True,
        created_at__date__gte=start, created_at__date__lte=end,
    ).count()

    pending_approvals = ApprovalRequest.objects.filter(status=ApprovalStatus.PENDING)
    approvals_ageing = pending_approvals.filter(
        created_at__lt=timezone.now() - timedelta(days=3)
    ).count()

    upcoming_deadlines = [
        t for t in open_tasks if t.due_date and today < t.due_date <= today + timedelta(days=7)
    ]

    metrics = {
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "projects": {
            "active": sum(1 for p in projects if p.status == ProjectStatus.ACTIVE),
            "at_risk": sum(1 for p in projects if p.status == ProjectStatus.AT_RISK),
            "on_hold": sum(1 for p in projects if p.status == ProjectStatus.ON_HOLD),
            "completed_in_period": len(completed_projects),
            "high_risk": len(high_risk),
            "delayed": len(delayed_projects),
            "total_tracked": len(projects),
        },
        "delivery": {
            "open_tasks": len(open_tasks),
            "tasks_completed": len(completed_in_period),
            "tasks_created": len(created_in_period),
            "overdue_tasks": len(overdue_tasks),
            "blocked_tasks": len(blocked_tasks),
            "critical_tasks": sum(1 for t in open_tasks if t.priority == "critical"),
            "unassigned_tasks": sum(1 for t in open_tasks if not t.owners.all()),
            "upcoming_deadlines": len(upcoming_deadlines),
            "throughput_ratio_percent": _pct(len(completed_in_period), max(len(created_in_period), 1)),
        },
        "productivity": {
            "people_with_work": len(team),
            "people_needing_attention": len(needs_attention),
            "completion_rate_percent": _pct(
                len(completed_in_period), max(len(completed_in_period) + len(overdue_tasks), 1)
            ),
            "on_time_percent": _pct(len(open_tasks) - len(overdue_tasks), max(len(open_tasks), 1)),
        },
        "milestones": {
            "total": milestones["total"] or 0,
            "reached": milestones["reached"] or 0,
            "missed": milestones["missed"] or 0,
            "due_soon": milestones["due_soon"] or 0,
            "completion_percent": _pct(milestones["reached"] or 0, milestones["total"] or 0),
        },
        "governance": {
            "pending_approvals": pending_approvals.count(),
            "approvals_ageing_over_3_days": approvals_ageing,
        },
        "quality": {
            "critical_issues": len(critical_issues),
            "sla_violations": sla_violations,
        },
    }
    metrics["commercial"] = _commercial(start, end)
    metrics["health_score"] = _health_score(metrics)

    return {
        "metrics": metrics,
        "high_risk_projects": high_risk[:RISK_LIST_LIMIT],
        "delayed_projects": delayed_projects[:RISK_LIST_LIMIT],
        "all_project_risk": risk_rows[:RISK_LIST_LIMIT * 2],
        "team": team[:TEAM_LIST_LIMIT],
        "team_needing_attention": needs_attention[:TEAM_LIST_LIMIT],
        "critical_issues": [
            {
                "project": issue.project.name if issue.project_id else "",
                "description": issue.description[:200],
                "target_date": issue.target_resolution_date.isoformat() if issue.target_resolution_date else "",
            }
            for issue in critical_issues
        ],
        "upcoming_deadlines": [
            {
                "title": t.title,
                "project": t.project.name if t.project_id else "",
                "due_date": t.due_date.isoformat(),
                "priority": t.priority,
            }
            for t in sorted(upcoming_deadlines, key=lambda t: t.due_date)[:RISK_LIST_LIMIT]
        ],
        "recent_completions": [
            {"title": t.title, "project": t.project.name if t.project_id else ""}
            for t in completed_in_period[:RISK_LIST_LIMIT]
        ],
        "completed_projects": [{"name": p.name, "code": p.code} for p in completed_projects[:RISK_LIST_LIMIT]],
    }


def _commercial(start: date, end: date) -> dict:
    """Revenue, pipeline and customer activity — empty when CRM is unused.

    ``available`` is what the prompt and the UI both key off: a deployment with
    no CRM data should get a summary that says nothing about revenue, rather
    than one confidently reporting zero.
    """
    from apps.crm.models import Customer, Opportunity, OpportunityStage

    opportunities = list(Opportunity.objects.all())
    if not opportunities:
        return {"available": False}

    # CRM records no explicit close date, so the last write to a won/lost
    # opportunity stands in for when it closed. Good enough for a period
    # roll-up; it would not be good enough for finance reporting, which is why
    # this is labelled pipeline movement rather than booked revenue.
    def closed_in_period(opportunity, stage) -> bool:
        return opportunity.stage == stage and start <= timezone.localtime(opportunity.updated_at).date() <= end

    won = [o for o in opportunities if closed_in_period(o, OpportunityStage.WON)]
    lost = [o for o in opportunities if closed_in_period(o, OpportunityStage.LOST)]
    open_opportunities = [o for o in opportunities if o.is_open]
    currency = opportunities[0].currency

    return {
        "available": True,
        "currency": currency,
        "revenue_won_in_period": round(sum(float(o.amount) for o in won), 2),
        "value_lost_in_period": round(sum(float(o.amount) for o in lost), 2),
        "open_pipeline_value": round(sum(float(o.amount) for o in open_opportunities), 2),
        "weighted_pipeline_value": round(sum(o.weighted_amount for o in open_opportunities), 2),
        "deals_won": len(won),
        "deals_lost": len(lost),
        "open_deals": len(open_opportunities),
        "new_customers_in_period": Customer.objects.filter(
            created_at__date__gte=start, created_at__date__lte=end
        ).count(),
        "active_customers": Customer.objects.filter(status="active").count(),
        "closing_next_30_days": len([
            o for o in open_opportunities
            if o.expected_close_date and timezone.localdate() <= o.expected_close_date
            <= timezone.localdate() + timedelta(days=30)
        ]),
    }


# --------------------------------------------------------------------------- #
# Prompt context
# --------------------------------------------------------------------------- #
def prompt_context(data: dict) -> str:
    """Render collected figures as the grounding block for the prompt."""
    metrics = data["metrics"]
    lines = [f"Reporting period: {metrics['period_start']} to {metrics['period_end']}.", ""]

    for heading, block in metrics.items():
        if not isinstance(block, dict):
            lines.append(f"{heading}: {block}")
            continue
        if block.get("available") is False:
            lines.append(f"{heading.title()}: no data recorded in this system — do not comment on it.")
            continue
        lines.append(f"{heading.title()}: " + ", ".join(f"{k}={v}" for k, v in block.items() if k != "available"))

    def block(label: str, items: list, render) -> None:
        if not items:
            return
        lines.extend(["", f"{label}:"])
        lines.extend(f"  - {render(i)}" for i in items)

    block(
        "Highest-risk projects", data.get("high_risk_projects") or [],
        lambda p: (
            f'{p["name"]} ({p["code"]}) risk={p["risk_score"]}, manager={p["manager"] or "unassigned"}, '
            f'{p["overdue_tasks"]} overdue / {p["open_tasks"]} open, {p["completion_percent"]}% complete'
            + (f' — {"; ".join(p["reasons"])}' if p["reasons"] else "")
        ),
    )
    block(
        "Projects past their target date", data.get("delayed_projects") or [],
        lambda p: f'{p["name"]}: target {p["target_date"]}, {abs(p["days_to_target"])} days past, {p["open_tasks"]} still open',
    )
    block(
        "People carrying the most strain", data.get("team_needing_attention") or [],
        lambda r: f'{r["person"]}: {r["open"]} open, {r["overdue"]} overdue, {r["blocked"]} blocked, {r["completed"]} completed this period',
    )
    block(
        "Open critical issues", data.get("critical_issues") or [],
        lambda i: f'{i["project"]}: {i["description"]}' + (f' (target {i["target_date"]})' if i["target_date"] else ""),
    )
    block(
        "Deadlines in the next 7 days", data.get("upcoming_deadlines") or [],
        lambda t: f'{t["due_date"]} — {t["title"]} ({t["project"]}, {t["priority"]})',
    )
    block("Projects completed this period", data.get("completed_projects") or [], lambda p: f'{p["name"]} ({p["code"]})')
    block("Work completed this period", (data.get("recent_completions") or [])[:8], lambda t: f'{t["title"]} ({t["project"]})')

    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# Deterministic fallback
# --------------------------------------------------------------------------- #
def fallback_content(data: dict, *, period_label: str) -> dict:
    """The executive summary written without an AI — figures, no narrative."""
    metrics = data["metrics"]
    projects = metrics["projects"]
    delivery = metrics["delivery"]

    return {
        "title": f"{period_label.title()} executive summary",
        "overall_health": (
            f"Health score {metrics['health_score']}/100. "
            f"{projects['active']} active projects, {projects['high_risk']} high risk, "
            f"{delivery['overdue_tasks']} overdue tasks."
        ),
        "high_risk_projects": [
            f'{p["name"]} (risk {p["risk_score"]}): ' + ("; ".join(p["reasons"]) or "needs review")
            for p in (data.get("high_risk_projects") or [])[:5]
        ],
        "teams_needing_attention": [
            f'{r["person"]}: {r["overdue"]} overdue across {r["open"]} open tasks'
            for r in (data.get("team_needing_attention") or [])[:5]
        ],
        "productivity_overview": (
            f"{delivery['tasks_completed']} tasks completed against {delivery['tasks_created']} created "
            f"({delivery['throughput_ratio_percent']}%). "
            f"{metrics['productivity']['on_time_percent']}% of open work is on time."
        ),
        "upcoming_deadlines": [
            f'{t["due_date"]} — {t["title"]} ({t["project"]})'
            for t in (data.get("upcoming_deadlines") or [])[:5]
        ],
        "critical_issues": [
            f'{i["project"]}: {i["description"]}' for i in (data.get("critical_issues") or [])[:5]
        ],
        "key_achievements": [
            f'Completed {p["name"]}' for p in (data.get("completed_projects") or [])[:5]
        ] or [f"{delivery['tasks_completed']} tasks completed this period."],
        "recommended_actions": [],
        "executive_recommendations": [],
        "strategic_insights": [],
    }
