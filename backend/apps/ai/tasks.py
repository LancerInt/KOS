"""Scheduled AI automations (Celery + Celery Beat).

Cadence, as specified:

* every 5 minutes  — overdue detection and the reminder → escalation ladder
* every 15 minutes — blocked work, high-priority attention, SLA violations
* hourly           — project health and critical-status analysis
* daily            — a per-person summary email
* weekly           — team and project reports
* monthly          — KPI / productivity / executive reports

Three rules hold everywhere in this module:

**Idempotency.** A five-minute scan sees the same overdue task 288 times a day.
:class:`TaskEscalation` and a recency check against :class:`AIAutomationLog` are
what stop that becoming 288 emails.

**Batching.** One AI call per scan, not one per record. Events are assembled,
sent together, and matched back by reference id — the difference between a
handful of calls per hour and thousands.

**Graceful degradation.** If the AI is unavailable the automation still runs
using deterministic fallback copy. Reminders going out in plainer language is a
far better failure mode than reminders silently stopping.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta

from celery import shared_task
from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils import timezone

from . import context as ctx
from . import delivery, service
from .models import (
    AIAutomationLog,
    AIReport,
    AISettings,
    AutomationEvent,
    EscalationStage,
    ReportPeriod,
    TaskEscalation,
)
from .service import AIUnavailable

logger = logging.getLogger(__name__)
User = get_user_model()

STAGE_LABELS = {
    EscalationStage.REMINDED: "first reminder — a light, helpful nudge to the owner",
    EscalationStage.REPEATED: "second reminder — the first went unanswered, be a little firmer",
    EscalationStage.MANAGER: "manager notification — factual and neutral, addressed to the manager",
    EscalationStage.ESCALATED: "formal escalation — firm, states the business impact, addressed to leadership",
}


# --------------------------------------------------------------------------- #
# Shared helpers
# --------------------------------------------------------------------------- #
def _log(event, *, task=None, project=None, user=None, ai_response=None,
         actions=None, ok=True, message="", request_log_id=None) -> AIAutomationLog:
    return AIAutomationLog.objects.create(
        event=event, task=task, project=project, user=user,
        ai_response=ai_response or {}, executed_actions=actions or [],
        ok=ok, message=message[:400], request_log_id=request_log_id,
    )


def _recently_logged(event, *, task=None, project=None, user=None, hours: int = 24) -> bool:
    """Has this automation already fired for this subject recently?

    The scans are stateless; this is what keeps a 15-minute cadence from
    becoming 96 notifications a day about the same blocked task.
    """
    since = timezone.now() - timedelta(hours=hours)
    qs = AIAutomationLog.objects.filter(event=event, created_at__gte=since, ok=True)
    if task is not None:
        qs = qs.filter(task=task)
    if project is not None:
        qs = qs.filter(project=project)
    if user is not None:
        qs = qs.filter(user=user)
    return qs.exists()


def _copy_for(reference: str, generated: dict, fallback: dict) -> dict:
    """The AI's copy for one event, falling back to a deterministic template."""
    entry = generated.get(reference)
    if not entry:
        return fallback
    return {
        "title": (entry.get("title") or fallback["title"])[:240],
        "message": entry.get("message") or fallback["message"],
        "email_subject": entry.get("email_subject") or fallback["email_subject"],
        "email_body": entry.get("email_body") or fallback["email_body"],
        "urgency": entry.get("urgency") or fallback.get("urgency", "normal"),
    }


def _generate_copy(events: list[str], *, audience: str, config, subject=None) -> tuple[dict, int | None]:
    """Ask the AI for notification copy for a batch of events.

    Returns ``({reference: entry}, request_log_id)``. An empty mapping means
    every caller falls back to templated copy — by design, not by accident.
    """
    if not events:
        return {}, None
    try:
        outcome = service.generate_notifications(
            ctx.events_context(events), audience=audience, subject=subject, config=config
        )
    except AIUnavailable as exc:
        logger.warning("AI notification copy unavailable, using fallback text: %s", exc)
        return {}, None

    # The model can return anything. A wrong shape must degrade to fallback
    # copy, never raise — raising here would stop every reminder in the batch.
    generated = {}
    entries = outcome.get("notifications") or []
    if isinstance(entries, dict):  # {"task-1": {...}} instead of a list
        entries = list(entries.values())
    if not isinstance(entries, list):
        logger.warning("AI returned %s for notifications; using fallback copy.", type(entries).__name__)
        return {}, outcome.log_id
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        reference = str(entry.get("reference") or "").strip()
        if reference:
            generated[reference] = entry
    return generated, outcome.log_id


def _task_url(task) -> str:
    return f"/projects/{task.project_id}" if task.project_id else "/"


def _hours_overdue(task, now) -> float:
    """Hours since the due date ended. Due dates are date-only, so the clock
    starts at midnight following the due date."""
    if not task.due_date:
        return 0.0
    deadline = timezone.make_aware(datetime.combine(task.due_date + timedelta(days=1), time.min))
    return max((now - deadline).total_seconds() / 3600, 0.0)


# --------------------------------------------------------------------------- #
# Every 5 minutes — overdue detection and escalation ladder
# --------------------------------------------------------------------------- #
def _next_stage(escalation: TaskEscalation, config: AISettings, now) -> EscalationStage | None:
    """Which rung of the ladder this task is due for, if any."""
    stage = escalation.stage
    first = escalation.first_detected_at or now
    last = escalation.last_reminder_at or first

    if stage == EscalationStage.NONE:
        return EscalationStage.REMINDED
    if stage == EscalationStage.REMINDED:
        if now >= last + timedelta(minutes=config.reminder_repeat_minutes):
            return EscalationStage.REPEATED
    elif stage == EscalationStage.REPEATED:
        if now >= first + timedelta(hours=config.manager_notify_hours):
            return EscalationStage.MANAGER
    elif stage == EscalationStage.MANAGER:
        if now >= first + timedelta(hours=config.escalate_hours):
            return EscalationStage.ESCALATED
    # ESCALATED is terminal — leadership has it; further mail adds nothing.
    return None


def _recipients_for_stage(task, stage: EscalationStage) -> list:
    if stage in (EscalationStage.REMINDED, EscalationStage.REPEATED):
        owners = list(task.owners.all())
        if task.primary_owner and task.primary_owner not in owners:
            owners.insert(0, task.primary_owner)
        # Unassigned overdue work is the case that most needs attention, so it
        # goes to the project's managers rather than being dropped for having
        # nobody to nag.
        return owners or delivery.managers_of(task.project)
    if stage == EscalationStage.MANAGER:
        return delivery.managers_of(task.project)
    return delivery.escalation_audience(task.project)


def _overdue_fallback(task, stage: EscalationStage, hours: float) -> dict:
    days = int(hours // 24)
    age = f"{days} day{'s' if days != 1 else ''}" if days else f"{int(hours)} hour{'s' if int(hours) != 1 else ''}"
    project = task.project.name if task.project_id else "an unassigned project"
    labels = {
        EscalationStage.REMINDED: ("Overdue", f'"{task.title}" was due {task.due_date} and is not complete.'),
        EscalationStage.REPEATED: ("Still overdue", f'"{task.title}" is still open {age} past its due date.'),
        EscalationStage.MANAGER: ("Team task overdue", f'"{task.title}" in {project} has been overdue for {age}.'),
        EscalationStage.ESCALATED: ("Escalation", f'"{task.title}" in {project} has been overdue for {age} without resolution.'),
    }
    heading, message = labels[stage]
    return {
        "title": f"{heading}: {task.title}"[:240],
        "message": message,
        "email_subject": f"[KOS] {heading}: {task.title}"[:200],
        "email_body": f"{message}\n\nPlease update the task with its current status or a revised date.",
        "urgency": "critical" if stage == EscalationStage.ESCALATED else "high",
    }


@shared_task
def scan_overdue_tasks() -> dict:
    """Detect overdue work and walk it up the reminder → escalation ladder."""
    from apps.tasks.models import Task

    config = AISettings.load()
    if not (config.is_enabled and config.automation_enabled and config.overdue_scan_enabled):
        return {"skipped": "disabled"}

    now = timezone.now()
    today = timezone.localdate()

    # 1. Release any tracked task that is no longer overdue, so that reopening a
    #    task later starts the ladder from the beginning rather than mid-escalation.
    cleared = 0
    for escalation in TaskEscalation.objects.filter(resolved_at__isnull=True).select_related("task"):
        task = escalation.task
        if ctx.is_closed(task.status) or not task.due_date or task.due_date >= today:
            escalation.reset()
            escalation.resolved_at = now
            escalation.save()
            cleared += 1

    # 2. Work out which overdue tasks are due for their next rung.
    overdue = (
        Task.objects.filter(due_date__lt=today)
        .exclude(status="archived")
        .select_related("project", "primary_owner")
        .prefetch_related("owners", "blockers")
    )

    pending: list[tuple] = []
    for task in overdue[: config.max_items_per_scan * 4]:
        if ctx.is_closed(task.status):
            continue
        escalation, _ = TaskEscalation.objects.get_or_create(task=task)
        if escalation.resolved_at is not None:
            escalation.reset()
            escalation.first_detected_at = now
            escalation.save()
        elif escalation.first_detected_at is None:
            escalation.first_detected_at = now
            escalation.save(update_fields=["first_detected_at", "updated_at"])

        stage = _next_stage(escalation, config, now)
        if stage is None:
            continue
        recipients = _recipients_for_stage(task, stage)
        if not recipients:
            # Nobody to tell at this rung. Record the stage so the ladder still
            # advances and a later rung (which has a wider audience) is reached,
            # instead of retrying this one every five minutes forever.
            escalation.stage = stage
            escalation.last_reminder_at = now
            escalation.save(update_fields=["stage", "last_reminder_at", "updated_at"])
            continue
        pending.append((task, escalation, stage, recipients))
        if len(pending) >= config.max_items_per_scan:
            break

    if not pending:
        return {"cleared": cleared, "processed": 0, "delivered": 0}

    # 3. One AI call for the whole batch.
    events = [
        ctx.overdue_event_context(task, stage_label=STAGE_LABELS[stage], hours_overdue=_hours_overdue(task, now))
        for task, _, stage, _ in pending
    ]
    generated, log_id = _generate_copy(
        events, audience="task owners, their managers and leadership", config=config
    )

    # 4. Deliver and advance each task's stage.
    delivered = 0
    for task, escalation, stage, recipients in pending:
        copy = _copy_for(
            f"task-{task.id}", generated, _overdue_fallback(task, stage, _hours_overdue(task, now))
        )
        try:
            actions = delivery.deliver_many(
                recipients,
                title=copy["title"],
                message=copy["message"],
                email_subject=copy["email_subject"],
                email_body=copy["email_body"],
                event="overdue",
                task=task,
                project=task.project,
                url=_task_url(task),
                # An escalation is exactly the case the acknowledgement flow exists for.
                requires_ack=stage == EscalationStage.ESCALATED,
                config=config,
            )
        except Exception as exc:
            logger.exception("Failed delivering overdue notice for task %s", task.id)
            _log(AutomationEvent.OVERDUE_REMINDER, task=task, project=task.project,
                 ok=False, message=str(exc))
            continue

        escalation.stage = stage
        escalation.last_reminder_at = now
        escalation.reminder_count += 1
        if stage == EscalationStage.MANAGER:
            escalation.manager_notified_at = now
        if stage == EscalationStage.ESCALATED:
            escalation.escalated_at = now
        escalation.save()

        event = {
            EscalationStage.REMINDED: AutomationEvent.OVERDUE_REMINDER,
            EscalationStage.REPEATED: AutomationEvent.OVERDUE_REPEAT,
            EscalationStage.MANAGER: AutomationEvent.MANAGER_NOTIFIED,
            EscalationStage.ESCALATED: AutomationEvent.ESCALATED,
        }[stage]
        _log(event, task=task, project=task.project, ai_response=copy,
             actions=actions, message=f"stage={stage.label}", request_log_id=log_id)
        delivered += 1

    return {"cleared": cleared, "processed": len(pending), "delivered": delivered}


# --------------------------------------------------------------------------- #
# Every 15 minutes — blocked work, high priority, SLA violations
# --------------------------------------------------------------------------- #
@shared_task
def scan_blocked_and_priority() -> dict:
    """Surface blocked work, critical tasks needing attention, and SLA breaches."""
    from apps.tasks.models import Task

    config = AISettings.load()
    if not (config.is_enabled and config.automation_enabled and config.blocked_scan_enabled):
        return {"skipped": "disabled"}

    today = timezone.localdate()
    soon = today + timedelta(days=2)
    limit = config.max_items_per_scan

    candidates: list[tuple] = []
    # A blocked task may also be critical and due soon; it should get one
    # notice, not two, and _recently_logged cannot help mid-run (nothing is
    # logged until the batch completes).
    seen_task_ids: set[int] = set()

    # Blocked tasks — the blocker exists and nobody has been told today.
    blocked = (
        Task.objects.filter(blockers__resolved_at__isnull=True)
        .exclude(status="archived")
        .select_related("project", "primary_owner")
        .prefetch_related("owners", "blockers")
        .distinct()[: limit * 2]
    )
    for task in blocked:
        if ctx.is_closed(task.status):
            continue
        blocker = next((b for b in task.blockers.all() if b.resolved_at is None), None)
        # A blocker past its own target date is an SLA breach, not just a blocker.
        overdue_target = bool(
            blocker and blocker.target_resolution_date and blocker.target_resolution_date < today
        )
        event = AutomationEvent.SLA_VIOLATION if overdue_target else AutomationEvent.BLOCKED_TASK
        # Check the event actually logged below — checking the other one would
        # never match, and the notice would repeat every 15 minutes forever.
        if _recently_logged(event, task=task, hours=24):
            continue
        recipients = [r for r in [blocker.resolver if blocker else None, task.primary_owner] if r]
        recipients += delivery.managers_of(task.project) if overdue_target else []
        if not recipients:
            recipients = list(task.owners.all())
        if not recipients:
            continue
        candidates.append((task, event, recipients, _blocked_event_text(task, blocker, overdue_target)))
        seen_task_ids.add(task.id)
        if len(candidates) >= limit:
            break

    # High-priority and critical work coming due.
    if len(candidates) < limit:
        urgent = (
            Task.objects.filter(priority__in=["critical", "high"])
            .filter(Q(due_date__lte=soon) | Q(due_date__isnull=True, priority="critical"))
            .exclude(status="archived")
            .select_related("project", "primary_owner")
            .prefetch_related("owners", "blockers")[: limit * 2]
        )
        for task in urgent:
            if ctx.is_closed(task.status) or task.id in seen_task_ids:
                continue
            if _recently_logged(AutomationEvent.HIGH_PRIORITY, task=task, hours=24):
                continue
            recipients = list(task.owners.all()) or delivery.managers_of(task.project)
            if not recipients:
                continue
            candidates.append((
                task,
                AutomationEvent.HIGH_PRIORITY,
                recipients,
                "\n".join([
                    f"reference: task-{task.id}",
                    f"event: {task.priority} priority task needs attention before it slips",
                    "escalation stage: proactive heads-up, not yet overdue",
                    f"task: {task.title}",
                    f"due: {task.due_date or 'no due date set'}",
                    f"status: {task.status}",
                    f"project: {task.project.name}" if task.project_id else "",
                ]),
            ))
            seen_task_ids.add(task.id)
            if len(candidates) >= limit:
                break

    if not candidates:
        return {"processed": 0, "delivered": 0}

    generated, log_id = _generate_copy(
        [text for _, _, _, text in candidates],
        audience="task owners, blocker resolvers and project managers",
        config=config,
    )

    delivered = 0
    for task, event, recipients, _ in candidates:
        fallback = {
            AutomationEvent.BLOCKED_TASK: {
                "title": f"Blocked: {task.title}",
                "message": f'"{task.title}" is blocked and cannot progress.',
                "email_subject": f"[KOS] Blocked: {task.title}",
                "email_body": f'"{task.title}" is blocked. Please resolve the blocker or reassign it.',
                "urgency": "high",
            },
            AutomationEvent.SLA_VIOLATION: {
                "title": f"SLA breach: {task.title}",
                "message": f'The blocker on "{task.title}" has passed its target resolution date.',
                "email_subject": f"[KOS] SLA breach: {task.title}",
                "email_body": f'The blocker on "{task.title}" is past its agreed resolution date and needs escalating.',
                "urgency": "critical",
            },
            AutomationEvent.HIGH_PRIORITY: {
                "title": f"{task.priority.title()} priority: {task.title}",
                "message": f'"{task.title}" is {task.priority} priority and due {task.due_date or "soon"}.',
                "email_subject": f"[KOS] {task.priority.title()} priority: {task.title}",
                "email_body": f'"{task.title}" is {task.priority} priority. Confirm it is on track.',
                "urgency": "high",
            },
        }[event]

        copy = _copy_for(f"task-{task.id}", generated, fallback)
        try:
            actions = delivery.deliver_many(
                recipients,
                title=copy["title"], message=copy["message"],
                email_subject=copy["email_subject"], email_body=copy["email_body"],
                event="blocker_raised" if event != AutomationEvent.HIGH_PRIORITY else "automation",
                task=task, project=task.project, url=_task_url(task), config=config,
            )
        except Exception as exc:
            logger.exception("Failed delivering %s notice for task %s", event, task.id)
            _log(event, task=task, project=task.project, ok=False, message=str(exc))
            continue

        _log(event, task=task, project=task.project, ai_response=copy, actions=actions,
             request_log_id=log_id)
        delivered += 1

    return {"processed": len(candidates), "delivered": delivered}


def _blocked_event_text(task, blocker, overdue_target: bool) -> str:
    return "\n".join([
        f"reference: task-{task.id}",
        f"event: task is blocked{' and the blocker has missed its target resolution date' if overdue_target else ''}",
        "escalation stage: " + ("SLA breach — firm, addressed to the resolver and manager"
                                if overdue_target else "blocker notice — helpful, addressed to the resolver"),
        f"task: {task.title}",
        f"blocker: {blocker.description if blocker else 'unspecified'}",
        f"blocker severity: {blocker.severity if blocker else 'unknown'}",
        f"blocker target resolution date: {blocker.target_resolution_date if blocker else 'not set'}",
        f"project: {task.project.name}" if task.project_id else "",
    ])


# --------------------------------------------------------------------------- #
# Hourly — project health and critical status
# --------------------------------------------------------------------------- #
@shared_task
def scan_project_health() -> dict:
    """Analyse active projects and alert on the ones turning critical."""
    from apps.audit.models import AuditAction
    from apps.audit.services import record
    from apps.projects.models import Project, ProjectHealth, ProjectStatus

    config = AISettings.load()
    if not (config.is_enabled and config.automation_enabled and config.health_scan_enabled):
        return {"skipped": "disabled"}

    projects = Project.objects.filter(
        status__in=[ProjectStatus.ACTIVE, ProjectStatus.AT_RISK, ProjectStatus.APPROVED]
    ).select_related("owner", "manager", "portfolio")

    analysed = alerted = 0
    for project in projects[: config.max_items_per_scan]:
        # Hourly cadence overall, but any single project is analysed at most once
        # every 6 hours — a full analysis is the most expensive call we make.
        # Check both events: a critical project logs CRITICAL_STATUS instead of
        # PROJECT_HEALTH, and would otherwise re-run the most expensive call we
        # make every hour rather than every six.
        if _recently_logged(AutomationEvent.PROJECT_HEALTH, project=project, hours=6) or _recently_logged(
            AutomationEvent.CRITICAL_STATUS, project=project, hours=6
        ):
            continue

        try:
            outcome = service.analyse_project(project, config=config)
        except AIUnavailable as exc:
            _log(AutomationEvent.PROJECT_HEALTH, project=project, ok=False, message=str(exc))
            continue

        analysed += 1
        actions: list[str] = []
        label = (outcome.get("health_label") or "").strip()
        score = outcome.get("health_score")

        # Reflect the AI's read back onto the project, but only when it is a real
        # change and a recognised value — and always leave an audit trail.
        if label in {c.value for c in ProjectHealth} and label != project.health:
            previous = project.health
            project.health = label
            project.save(update_fields=["health", "updated_at"])
            actions.append(f"health:{previous}->{label}")
            record(
                action=AuditAction.UPDATE, obj=project,
                old_value={"health": previous}, new_value={"health": label},
                reason="AI hourly project health analysis",
            )

        risk_level = (outcome.get("risk_level") or "").lower()
        is_critical = risk_level == "critical" or label == ProjectHealth.OFF_TRACK

        if is_critical and not _recently_logged(AutomationEvent.CRITICAL_STATUS, project=project, hours=24):
            recipients = delivery.managers_of(project)
            summary = outcome.get("summary") or "This project needs attention."
            risks = outcome.get("risks") or []
            risk_lines = "\n".join(
                f"- {r.get('title', '')}: {r.get('impact', '')}" for r in risks[:5] if isinstance(r, dict)
            )
            actions += delivery.deliver_many(
                recipients,
                title=f"Project needs attention: {project.name}",
                message=summary,
                email_subject=f"[KOS] {project.name} — health score {score}",
                email_body=f"{summary}\n\nKey risks:\n{risk_lines}".strip(),
                event="project_at_risk",
                project=project,
                url=f"/projects/{project.id}",
                config=config,
            )
            _log(AutomationEvent.CRITICAL_STATUS, project=project, ai_response=outcome.data,
                 actions=actions, request_log_id=outcome.log_id)
            alerted += 1
        else:
            _log(AutomationEvent.PROJECT_HEALTH, project=project, ai_response=outcome.data,
                 actions=actions, request_log_id=outcome.log_id)

    return {"analysed": analysed, "alerted": alerted}


@shared_task
def scan_missed_milestones() -> dict:
    """Notify project leadership when a milestone date passes unreached."""
    from apps.projects.models import Milestone, MilestoneStatus

    config = AISettings.load()
    if not (config.is_enabled and config.automation_enabled):
        return {"skipped": "disabled"}

    today = timezone.localdate()
    missed = (
        Milestone.objects.filter(due_date__lt=today)
        .exclude(status__in=[MilestoneStatus.REACHED, MilestoneStatus.MISSED])
        .select_related("project", "project__manager", "project__owner")[: config.max_items_per_scan]
    )

    notified = 0
    for milestone in missed:
        # Always correct the record — the status is ERP data, not a notification.
        milestone.status = MilestoneStatus.MISSED
        milestone.save(update_fields=["status", "updated_at"])

        # Only the *notice* is throttled, so several milestones lapsing together
        # do not produce a burst of near-identical emails.
        if _recently_logged(AutomationEvent.MILESTONE_MISSED, project=milestone.project, hours=24):
            continue

        overdue_days = (today - milestone.due_date).days
        message = (
            f'Milestone "{milestone.title}" in {milestone.project.name} was due '
            f"{milestone.due_date} and has not been reached ({overdue_days} days late)."
        )
        actions = delivery.deliver_many(
            delivery.managers_of(milestone.project),
            title=f"Milestone missed: {milestone.title}",
            message=message,
            email_subject=f"[KOS] Milestone missed: {milestone.title}",
            email_body=f"{message}\n\nPlease review the plan and confirm a revised date.",
            event="automation",
            project=milestone.project,
            url=f"/projects/{milestone.project_id}",
            config=config,
        )
        _log(AutomationEvent.MILESTONE_MISSED, project=milestone.project,
             actions=actions + [f"milestone:{milestone.id}:missed"], message=message)
        notified += 1

    return {"notified": notified}


# --------------------------------------------------------------------------- #
# Daily — per-person summary
# --------------------------------------------------------------------------- #
def _user_daily_metrics(user, today: date) -> dict:
    from apps.tasks.models import Task

    tasks = list(
        Task.objects.filter(owners=user).exclude(status="archived")
        .select_related("project").prefetch_related("owners", "blockers").distinct()
    )
    open_tasks = [t for t in tasks if not ctx.is_closed(t.status)]
    week_ago = today - timedelta(days=1)

    return {
        "open_tasks": len(open_tasks),
        "overdue": len([t for t in open_tasks if t.due_date and t.due_date < today]),
        "due_today": len([t for t in open_tasks if t.due_date == today]),
        "due_this_week": len([t for t in open_tasks if t.due_date and today < t.due_date <= today + timedelta(days=7)]),
        "blocked": len([t for t in open_tasks if ctx.has_open_blocker(t)]),
        "critical": len([t for t in open_tasks if t.priority == "critical"]),
        "completed_yesterday": len([
            t for t in tasks
            if t.completed_at and week_ago <= timezone.localtime(t.completed_at).date() <= today
        ]),
    }


@shared_task
def generate_daily_summaries() -> dict:
    """A personal daily briefing for everyone with open work."""
    from apps.notifications.services import get_prefs

    config = AISettings.load()
    if not (config.is_enabled and config.automation_enabled and config.daily_summary_enabled):
        return {"skipped": "disabled"}

    today = timezone.localdate()
    sent = 0

    # Cap the number of summaries *sent*, not the number of users considered:
    # slicing the user queryset would mean people beyond the cap never receive
    # a summary on any run, rather than simply being deferred.
    for user in User.objects.filter(is_active=True):
        if sent >= config.max_items_per_scan:
            logger.info("Daily summary cap (%s) reached; remaining users deferred.",
                        config.max_items_per_scan)
            break
        if not get_prefs(user).daily_digest:
            continue
        metrics = _user_daily_metrics(user, today)
        if not metrics["open_tasks"]:
            continue
        if _recently_logged(AutomationEvent.DAILY_SUMMARY, user=user, hours=20):
            continue

        try:
            outcome = service.generate_report(
                period_label="daily briefing",
                metrics=metrics,
                body=ctx.user_workload_context(user, limit=25),
                audience=f"{user.get_full_name() or user.username}, about their own work today",
                user=user,
                config=config,
            )
            content, log_id = outcome.data, outcome.log_id
        except AIUnavailable as exc:
            logger.warning("Daily summary fell back to plain figures for %s: %s", user, exc)
            content, log_id = {
                "title": "Your day in KOS",
                "executive_summary": (
                    f"{metrics['open_tasks']} open tasks · {metrics['overdue']} overdue · "
                    f"{metrics['due_today']} due today · {metrics['blocked']} blocked."
                ),
                "sections": [],
            }, None

        report = AIReport.objects.create(
            period=ReportPeriod.DAILY,
            title=content.get("title") or f"Daily summary — {today.isoformat()}",
            user=user, period_start=today, period_end=today,
            content=content, metrics=metrics,
        )
        summary = content.get("executive_summary") or ""
        actions = delivery.deliver(
            user,
            title=f"Your daily summary — {metrics['open_tasks']} open, {metrics['overdue']} overdue",
            message=summary,
            email_subject=f"[KOS] Your daily summary — {today.strftime('%d %b %Y')}",
            email_body=_render_report_email(content, metrics),
            event="digest",
            url="/",
            config=config,
        )
        if actions:
            report.emailed_at = timezone.now()
            report.save(update_fields=["emailed_at", "updated_at"])
        _log(AutomationEvent.DAILY_SUMMARY, user=user, ai_response=content, actions=actions,
             request_log_id=log_id)
        sent += 1

    return {"sent": sent}


def _render_report_email(content: dict, metrics: dict) -> str:
    """Flatten a structured report into readable plain-text email."""
    lines = [content.get("executive_summary") or ""]
    for section in content.get("sections") or []:
        if isinstance(section, dict):
            lines += ["", (section.get("heading") or "").upper(), section.get("content") or ""]
    if content.get("risks"):
        lines += ["", "RISKS"] + [f"- {r}" for r in content["risks"]]
    if content.get("recommendations"):
        lines += ["", "RECOMMENDED ACTIONS"] + [f"- {r}" for r in content["recommendations"]]
    if metrics:
        lines += ["", "FIGURES", ", ".join(f"{k}: {v}" for k, v in metrics.items())]
    return "\n".join(line for line in lines if line is not None).strip()


# --------------------------------------------------------------------------- #
# Weekly & monthly reports
# --------------------------------------------------------------------------- #
def _org_metrics(start: date, end: date) -> dict:
    from apps.projects.models import Project, ProjectStatus
    from apps.tasks.models import Task

    tasks = list(Task.objects.exclude(status="archived").select_related("project").prefetch_related("blockers"))
    open_tasks = [t for t in tasks if not ctx.is_closed(t.status)]
    completed = [
        t for t in tasks
        if t.completed_at and start <= timezone.localtime(t.completed_at).date() <= end
    ]
    created = [t for t in tasks if start <= t.created_at.date() <= end]

    return {
        "period_start": start.isoformat(),
        "period_end": end.isoformat(),
        "active_projects": Project.objects.filter(status=ProjectStatus.ACTIVE).count(),
        "at_risk_projects": Project.objects.filter(status=ProjectStatus.AT_RISK).count(),
        "tasks_completed": len(completed),
        "tasks_created": len(created),
        "open_tasks": len(open_tasks),
        "overdue_tasks": len([t for t in open_tasks if t.due_date and t.due_date < end]),
        "blocked_tasks": len([t for t in open_tasks if ctx.has_open_blocker(t)]),
        "critical_tasks": len([t for t in open_tasks if t.priority == "critical"]),
        "upcoming_deadlines": len([
            t for t in open_tasks if t.due_date and end < t.due_date <= end + timedelta(days=7)
        ]),
        "completion_rate_percent": (
            round(len(completed) * 100 / max(len(created), 1)) if created else 0
        ),
    }


def _leadership() -> list:
    """Who receives organisation-level reports."""
    from apps.projects.models import Project

    people = list(User.objects.filter(is_active=True, is_superuser=True)[:10])
    for project in Project.objects.filter(status="active").select_related("manager", "owner")[:50]:
        people += [p for p in (project.manager, project.owner) if p]
    return people


def _build_org_report(*, period, period_label, start, end, event, config) -> dict:
    metrics = _org_metrics(start, end)
    try:
        outcome = service.generate_report(
            period_label=period_label, metrics=metrics, audience="management", config=config
        )
        content, log_id = outcome.data, outcome.log_id
    except AIUnavailable as exc:
        logger.warning("%s report fell back to plain figures: %s", period_label, exc)
        content, log_id = {
            "title": f"{period_label.title()} report",
            "executive_summary": ", ".join(f"{k}: {v}" for k, v in metrics.items()),
            "sections": [],
        }, None

    report = AIReport.objects.create(
        period=period,
        title=content.get("title") or f"{period_label.title()} — {end.isoformat()}",
        period_start=start, period_end=end, content=content, metrics=metrics,
    )
    actions = delivery.deliver_many(
        _leadership(),
        title=report.title,
        message=content.get("executive_summary") or "",
        email_subject=f"[KOS] {report.title}",
        email_body=_render_report_email(content, metrics),
        event="digest",
        url="/reports",
        config=config,
    )
    if actions:
        report.emailed_at = timezone.now()
        report.save(update_fields=["emailed_at", "updated_at"])
    _log(event, ai_response=content, actions=actions, request_log_id=log_id)
    return {"report_id": report.id, "recipients": len(actions)}


@shared_task
def generate_weekly_reports() -> dict:
    """Team summary: completed work, delayed work, upcoming deadlines."""
    config = AISettings.load()
    if not (config.is_enabled and config.automation_enabled and config.weekly_report_enabled):
        return {"skipped": "disabled"}

    end = timezone.localdate()
    return _build_org_report(
        period=ReportPeriod.WEEKLY, period_label="weekly team report",
        start=end - timedelta(days=7), end=end,
        event=AutomationEvent.WEEKLY_REPORT, config=config,
    )


@shared_task
def generate_monthly_reports() -> dict:
    """KPI, productivity and executive summary for the month just ended."""
    config = AISettings.load()
    if not (config.is_enabled and config.automation_enabled and config.monthly_report_enabled):
        return {"skipped": "disabled"}

    end = timezone.localdate()
    start = (end.replace(day=1) - timedelta(days=1)).replace(day=1)
    return _build_org_report(
        period=ReportPeriod.MONTHLY,
        period_label="monthly KPI, productivity and department report with an executive summary",
        start=start, end=end,
        event=AutomationEvent.MONTHLY_REPORT, config=config,
    )


@shared_task
def run_all_ai_scans() -> dict:
    """Every scan in one call — used by the management command and for testing."""
    return {
        "overdue": scan_overdue_tasks(),
        "blocked": scan_blocked_and_priority(),
        "milestones": scan_missed_milestones(),
        "health": scan_project_health(),
    }
