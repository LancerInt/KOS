"""Alerting the moment a task reaches a critical stage.

The scheduled scans in :mod:`apps.ai.tasks` are the safety net: they sweep every
few minutes and catch work that has *drifted* into trouble. This module is the
tripwire — it fires on the save itself, so raising a task to critical priority
emails its owners in seconds rather than at the next sweep.

Three rules shape everything below.

**Transitions, not states.** A task that is already critical and gets edited has
not "reached a critical stage" again. Every check compares the new value against
the value before the save, so only the crossing fires. Without this, saving a
critical task ten times would send ten emails.

**Throttled per task.** Even a genuine transition is suppressed if the same task
alerted within the cooldown window — a task flipped critical → high → critical
while someone is triaging it is one situation, not three.

**Never breaks the save.** A task update is ERP data; an alert about it is a
courtesy. Every failure path here logs and returns, so a bad address or a dead
SMTP host can never roll back the change a user just made.
"""
from __future__ import annotations

import logging

from django.utils import timezone

from . import context as ctx
from . import service
from .models import AIAutomationLog, AISettings, AutomationEvent, OutboundEmail
from .outbound import EmailRejected, parse_addresses, prepare, send
from .service import AIUnavailable

logger = logging.getLogger(__name__)

#: Statuses that mean the work has stopped moving. Critical on its own is a
#: priority; critical *and stalled* is the thing worth waking someone for.
STALLED_STATUSES = {"blocked", "waiting_dependency", "on_hold"}

CRITICAL = "critical"
HIGH = "high"


def detect_transition(task, *, old_priority=None, old_status=None, old_risk=None) -> str | None:
    """Why this save counts as reaching a critical stage, or ``None``.

    The return value is a human sentence rather than a flag because it goes
    straight into the alert as the reason line — the recipient's first question
    is always "critical *why*", and answering it in the subject saves a click.
    """
    if ctx.is_closed(task.status):
        return None

    priority = (task.priority or "").lower()
    status = (task.status or "").lower()
    risk = (task.risk_level or "").lower()

    # 1. Raised to critical priority.
    if priority == CRITICAL and (old_priority or "").lower() != CRITICAL:
        return "was raised to critical priority"

    # 2. Flagged as a critical risk.
    if risk == CRITICAL and (old_risk or "").lower() != CRITICAL:
        return "was flagged as a critical risk"

    # 3. Important work that has just stopped moving. High priority counts here
    #    even though it does not on its own: blocked high-priority work becomes
    #    critical work within a day, which is late to start telling people.
    if status in STALLED_STATUSES and (old_status or "").lower() not in STALLED_STATUSES:
        if priority in (CRITICAL, HIGH):
            label = "blocked" if status == "blocked" else status.replace("_", " ")
            return f"is {priority} priority and is now {label}"

    # 4. A critical task that has passed its deadline. The overdue ladder will
    #    reach it too, but its first rung is a gentle nudge to the owner — a
    #    critical task going overdue deserves the full audience immediately.
    if priority == CRITICAL and task.due_date and task.due_date < timezone.localdate():
        if (old_priority or "").lower() != CRITICAL or (old_status or "").lower() != status:
            return "is critical priority and has passed its due date"

    return None


def _recently_alerted(task, config: AISettings) -> bool:
    from datetime import timedelta

    since = timezone.now() - timedelta(hours=config.critical_alert_cooldown_hours)
    return AIAutomationLog.objects.filter(
        event=AutomationEvent.CRITICAL_TASK, task=task, created_at__gte=since, ok=True
    ).exists()


def _audience(task, config: AISettings) -> tuple[list[str], list[str], list[str]]:
    """Who is told, split into To / Cc / Bcc.

    Owners are addressed directly because they are the people who must act.
    Management is copied — visible, so the owner knows their manager has seen
    it. The configured watch-list is blind-copied so a shared operations mailbox
    or compliance archive can receive every alert without appearing in the
    team's reply-all.
    """
    from . import delivery

    owners = list(task.owners.all())
    if task.primary_owner and task.primary_owner not in owners:
        owners.insert(0, task.primary_owner)

    to = [u.email for u in owners if getattr(u, "email", "")]
    cc: list[str] = []
    if config.critical_alert_include_managers:
        cc = [u.email for u in delivery.managers_of(task.project) if getattr(u, "email", "")]

    bcc = parse_addresses(config.critical_alert_bcc)

    # Unassigned critical work is the case that most needs an owner, so it goes
    # to management directly rather than being dropped for having nobody to tell.
    if not to:
        to, cc = cc, []
    return to, cc, bcc


def _fallback_copy(task, reason: str) -> dict:
    project = task.project.name if task.project_id else "an unassigned project"
    lines = [
        f'The task "{task.title}" in {project} {reason}.',
        "",
        f"Status: {task.status}",
        f"Priority: {task.priority}",
        f"Due: {task.due_date or 'no due date set'}",
        f"Owners: {', '.join(u.get_full_name() or u.get_username() for u in task.owners.all()) or 'unassigned'}",
        "",
        "Please review it and confirm the recovery plan, or update the task with its current position.",
    ]
    return {
        "subject": f"[KOS] Critical: {task.title}"[:300],
        "body": "\n".join(lines),
    }


def _ai_copy(task, reason: str, config: AISettings) -> tuple[dict, int | None]:
    """Ask the provider for the alert's wording, falling back to a template.

    An outage must downgrade the *prose*, never the alert — plainer language
    arriving on time beats better language that never arrives.
    """
    event = "\n".join([
        f"reference: task-{task.id}",
        f"event: task reached a critical stage — it {reason}",
        "escalation stage: immediate critical alert, firm and factual, addressed to the owners and their managers",
        f"task: {task.title}",
        f"project: {task.project.name} ({task.project.code})" if task.project_id else "",
        f"status: {task.status} | priority: {task.priority} | risk: {task.risk_level or 'not set'}",
        f"due: {task.due_date or 'no due date set'}",
        f"description: {(task.description or '')[:800]}",
    ])
    try:
        outcome = service.generate_notifications(
            ctx.events_context([event]),
            audience="the task owners and their project managers",
            subject=task,
            config=config,
        )
    except AIUnavailable as exc:
        logger.warning("Critical alert copy unavailable for task %s, using template: %s", task.id, exc)
        return _fallback_copy(task, reason), None

    fallback = _fallback_copy(task, reason)
    entries = outcome.get("notifications") or []
    if isinstance(entries, dict):
        entries = list(entries.values())
    entry = next((e for e in entries if isinstance(e, dict)), None) if isinstance(entries, list) else None
    if not entry:
        return fallback, outcome.log_id

    return {
        "subject": (entry.get("email_subject") or fallback["subject"])[:300],
        "body": entry.get("email_body") or entry.get("message") or fallback["body"],
    }, outcome.log_id


def alert(task, reason: str, *, use_ai: bool = True, config: AISettings | None = None) -> dict:
    """Send the critical-stage alert for one task.

    Returns a small result dict for the Celery task and the tests; it never
    raises, because every caller is either a signal receiver or a worker and
    neither has anything useful to do with an exception.
    """
    config = config or AISettings.load()
    if not (config.is_enabled and config.automation_enabled and config.critical_alert_enabled):
        return {"skipped": "disabled"}
    if _recently_alerted(task, config):
        return {"skipped": "cooldown"}

    to, cc, bcc = _audience(task, config)
    if not to:
        # Nothing to send, but log it — "nobody was told" is itself the finding,
        # and silence would look identical to the alert having worked.
        AIAutomationLog.objects.create(
            event=AutomationEvent.CRITICAL_TASK, task=task, project=task.project,
            ok=False, message=f"No email addresses for anyone on this task ({reason}).",
        )
        return {"skipped": "no recipients"}

    copy, log_id = _ai_copy(task, reason, config) if use_ai else (_fallback_copy(task, reason), None)

    link = f"/projects/{task.project_id}" if task.project_id else "/"
    body = f"{copy['body']}\n\nOpen the task: {link}"

    try:
        email = prepare(
            to=to, cc=cc, bcc=bcc,
            subject=copy["subject"], body=body,
            source=OutboundEmail.Source.CRITICAL_ALERT,
            task=task, project=task.project, draft_log_id=log_id,
            config=config,
        )
    except EmailRejected as exc:
        AIAutomationLog.objects.create(
            event=AutomationEvent.CRITICAL_TASK, task=task, project=task.project,
            ok=False, message=str(exc)[:400],
        )
        return {"skipped": str(exc)}

    sent = send(email)

    # In-app as well as by email: someone who has email notifications off still
    # needs to know their task went critical.
    from . import delivery

    actions = [f"email:{email.id}:{'sent' if sent else 'failed'}"]
    try:
        actions += delivery.deliver_many(
            [u for u in list(task.owners.all()) + delivery.managers_of(task.project) if u],
            title=f"Critical: {task.title}"[:240],
            message=f"This task {reason}.",
            event="automation",
            task=task,
            project=task.project,
            url=link,
            send_email=False,  # the email above is the email; this is the bell
            config=config,
        )
    except Exception:
        logger.exception("Critical alert notification failed for task %s", task.id)

    AIAutomationLog.objects.create(
        event=AutomationEvent.CRITICAL_TASK, task=task, project=task.project,
        ai_response=copy, executed_actions=actions,
        ok=sent, message=f"{reason} · {email.recipient_count} recipients"[:400],
        request_log_id=log_id,
    )
    return {"email_id": email.id, "sent": sent, "recipients": email.recipient_count, "reason": reason}
