"""Generating, storing and delivering the two AI briefings.

The engine behind both the Celery jobs and the "Generate" buttons — one code
path, so a manually triggered stand-up is byte-for-byte the same thing the 9am
job would have produced, and the audit trail cannot disagree with the UI.

Four rules hold throughout, mirroring :mod:`apps.ai.tasks`:

**The stored row is the cache.** ``(user, date)`` and ``(period, period_end)``
are unique. A generator asked for a briefing that already exists returns it
without touching the provider; only an explicit regeneration spends a call.

**Graceful degradation.** A provider outage produces the deterministic briefing
from :mod:`apps.ai.standup` / :mod:`apps.ai.executive` instead of nothing, and
``ai_ok=False`` records that it happened.

**Every key is always present.** AI output is merged over the deterministic
fallback, so a model that omits half the contract still yields a complete
document and the frontend never renders a hole.

**Delivery is separate from generation.** A user who has switched off digests
still gets their stand-up in the widget; they simply are not emailed about it.
"""
from __future__ import annotations

import logging
import time
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from . import delivery, executive, service, standup
from .models import (
    AIAutomationLog,
    AISettings,
    AutomationEvent,
    DailyStandup,
    ExecutiveSummary,
    GenerationTrigger,
    ReportPeriod,
)
from .service import AIUnavailable

logger = logging.getLogger(__name__)
User = get_user_model()

#: Spans used when a period is generated on demand. Weekly is the 7 days ending
#: today; monthly is the calendar month just ended, matching the Beat jobs.
PERIOD_LABELS = {
    ReportPeriod.DAILY: "daily",
    ReportPeriod.WEEKLY: "weekly",
    ReportPeriod.MONTHLY: "monthly",
}


# --------------------------------------------------------------------------- #
# Shared helpers
# --------------------------------------------------------------------------- #
def _log(event, *, user=None, ai_response=None, actions=None, ok=True, message="",
         request_log_id=None) -> AIAutomationLog:
    """Write the automation audit row.

    Deliberately not imported from :mod:`apps.ai.tasks`: that module imports
    this one, and a private helper is not worth a circular import.
    """
    return AIAutomationLog.objects.create(
        event=event, user=user, ai_response=ai_response or {}, executed_actions=actions or [],
        ok=ok, message=message[:400], request_log_id=request_log_id,
    )


def _merge_over_fallback(outcome, fallback: dict) -> dict:
    """AI values where the model supplied them, deterministic copy everywhere else.

    Models drop keys, return a bare string, or answer with an empty list. Any of
    those must still produce a complete document, so the fallback is the floor
    and the AI only ever overwrites it with something non-empty.
    """
    merged = dict(fallback)
    if outcome is None:
        return merged

    data = outcome.data if isinstance(outcome.data, dict) else {}
    if not outcome.structured or not data:
        # The model ignored the JSON contract. Keep whatever prose it did write
        # rather than discarding a perfectly readable answer.
        if outcome.text:
            merged["narrative"] = outcome.text
        return merged

    for key, value in data.items():
        if value not in (None, "", [], {}):
            merged[key] = value
    return merged


def period_span(period: str, *, end: date | None = None) -> tuple[date, date]:
    """The dates a period covers, ending today unless told otherwise."""
    end = end or timezone.localdate()
    if period == ReportPeriod.WEEKLY:
        return end - timedelta(days=7), end
    if period == ReportPeriod.MONTHLY:
        start = (end.replace(day=1) - timedelta(days=1)).replace(day=1)
        return start, end
    return end, end


# --------------------------------------------------------------------------- #
# Daily stand-up
# --------------------------------------------------------------------------- #
def render_standup_email(content: dict, metrics: dict) -> str:
    """Flatten a stand-up into readable plain-text email."""
    counts = (metrics or {}).get("counts") or {}
    lines = [content.get("greeting") or "Here is your stand-up."]

    def block(heading: str, items) -> None:
        items = [i for i in (items or []) if isinstance(i, str) and i.strip()]
        if items:
            lines.extend(["", heading] + [f"  - {i}" for i in items])

    block("YESTERDAY", content.get("yesterday"))
    block("TODAY'S PRIORITIES", content.get("today_priorities"))
    block("OVERDUE", content.get("overdue"))
    block("BLOCKERS", content.get("blockers"))
    block("NEEDS ATTENTION", content.get("attention"))
    block("RECOMMENDATIONS", content.get("recommendations"))
    block("SUGGESTED ORDER", content.get("suggested_order"))

    if content.get("productivity_insight"):
        lines.extend(["", content["productivity_insight"]])
    if content.get("narrative"):
        lines.extend(["", content["narrative"]])
    if counts:
        lines.extend(["", "FIGURES", ", ".join(f"{k}: {v}" for k, v in counts.items())])
    return "\n".join(lines).strip()


def _standup_headline(content: dict, metrics: dict) -> str:
    counts = (metrics or {}).get("counts") or {}
    parts = [f"{counts.get('assigned_open', 0)} open"]
    if counts.get("overdue"):
        parts.append(f"{counts['overdue']} overdue")
    if counts.get("due_today"):
        parts.append(f"{counts['due_today']} due today")
    if counts.get("blocked"):
        parts.append(f"{counts['blocked']} blocked")
    return "Your stand-up — " + " · ".join(parts)


def deliver_standup(record: DailyStandup, *, config: AISettings) -> list[str]:
    """Notify and email the person their stand-up, honouring every preference.

    Generation already happened; this only decides whether to interrupt them
    about it. Someone who has switched off the daily digest keeps the widget and
    loses the email, which is what "based on user preferences" has to mean if
    the widget is to stay useful.
    """
    from apps.notifications.services import get_prefs

    user = record.user
    if not get_prefs(user).daily_digest:
        return ["skipped:digest_off"]

    title = _standup_headline(record.content, record.metrics)
    message = record.content.get("greeting") or ""
    summary = record.content.get("productivity_insight") or ""
    if summary:
        message = f"{message} {summary}".strip()

    email_subject = f"[KOS] Your stand-up — {record.standup_date.strftime('%d %b %Y')}"
    email_body = render_standup_email(record.content, record.metrics)

    actions: list[str] = []
    if config.standup_notify_enabled:
        actions += delivery.deliver(
            user,
            title=title, message=message,
            email_subject=email_subject, email_body=email_body,
            event="digest", url="/",
            send_email=config.standup_email_enabled,
            config=config,
        )
    elif config.standup_email_enabled:
        # Email without an in-app notification — the administrator turned the
        # bell off but left mail on.
        if delivery.send_ai_email(user, subject=email_subject, body=email_body, url="/", config=config):
            actions.append(f"emailed:{user.id}")

    now = timezone.now()
    fields = []
    if any(a.startswith("notified:") for a in actions):
        record.notified_at = now
        fields.append("notified_at")
    if any(a.startswith("emailed:") for a in actions):
        record.emailed_at = now
        fields.append("emailed_at")
    if fields:
        record.save(update_fields=fields + ["updated_at"])
    return actions


def generate_standup(
    user,
    *,
    today: date | None = None,
    config: AISettings | None = None,
    trigger: str = GenerationTrigger.SCHEDULED,
    actor=None,
    force: bool = False,
    deliver_it: bool = True,
) -> tuple[DailyStandup | None, bool]:
    """Produce one person's stand-up for one day.

    Returns ``(record, generated)``. ``generated`` is False when an existing
    stand-up was reused — the caller can then tell "here is today's stand-up"
    apart from "I just spent a provider call".
    """
    today = today or timezone.localdate()
    config = config or AISettings.load()

    existing = DailyStandup.objects.filter(user=user, standup_date=today).first()
    if existing is not None and not force:
        return existing, False

    started = time.monotonic()
    data = standup.collect(user, today=today)

    # Nothing on their plate: no row, no notification, no provider call.
    # ``force`` overrides so a user who presses Refresh on a quiet day still
    # gets an answer rather than an unexplained blank panel.
    if not standup.has_anything_to_say(data) and not force:
        return None, False

    fallback = standup.fallback_content(data)
    outcome, ai_ok, error = None, True, ""
    try:
        outcome = service.daily_standup(
            standup.prompt_context(data), person=data["person"], user=user, config=config
        )
    except AIUnavailable as exc:
        ai_ok, error = False, str(exc)
        logger.warning("Stand-up for %s fell back to deterministic copy: %s", user, exc)

    content = _merge_over_fallback(outcome, fallback)
    duration_ms = int((time.monotonic() - started) * 1000)

    with transaction.atomic():
        record, created = DailyStandup.objects.update_or_create(
            user=user,
            standup_date=today,
            defaults={
                "content": content,
                "metrics": data,
                "trigger": trigger,
                "generated_by": actor,
                "ai_ok": ai_ok,
                "error": error[:400],
                "duration_ms": duration_ms,
                "request_log": _request_log(outcome.log_id) if outcome else None,
            },
        )
        if not created:
            record.generation_count = (existing.generation_count if existing else 0) + 1
            record.save(update_fields=["generation_count", "updated_at"])

    actions = [f"schedule:{trigger}", f"duration_ms:{duration_ms}", f"ai:{'ok' if ai_ok else 'fallback'}"]
    if deliver_it:
        try:
            actions += deliver_standup(record, config=config)
        except Exception as exc:  # a broken mail host must not lose the stand-up
            logger.exception("Failed delivering stand-up for %s", user)
            actions.append(f"delivery_failed:{type(exc).__name__}")

    _log(
        AutomationEvent.DAILY_STANDUP,
        user=user,
        ai_response=content,
        actions=actions,
        ok=ai_ok,
        message=error or f"stand-up for {today.isoformat()} ({trigger})",
        request_log_id=outcome.log_id if outcome else None,
    )
    return record, True


def _request_log(log_id: int | None):
    """Resolve a request-log id to the instance, tolerating a purged row."""
    if not log_id:
        return None
    from .models import AIRequestLog

    return AIRequestLog.objects.filter(pk=log_id).first()


# --------------------------------------------------------------------------- #
# Executive summary
# --------------------------------------------------------------------------- #
def render_executive_email(content: dict, metrics: dict) -> str:
    """Flatten an executive summary into readable plain-text email."""
    lines = [content.get("title") or "Executive summary"]
    if metrics.get("health_score") is not None:
        lines.append(f"Overall health: {metrics['health_score']}/100")
    if content.get("overall_health"):
        lines.extend(["", content["overall_health"]])

    def entries(heading: str, items, render) -> None:
        items = [i for i in (items or []) if i]
        if items:
            lines.extend(["", heading] + [f"  - {render(i)}" for i in items])

    def named(item) -> str:
        if isinstance(item, dict):
            head = item.get("name") or item.get("team") or ""
            detail = item.get("reason") or ""
            action = item.get("action") or ""
            return " — ".join(p for p in (head, detail, action) if p)
        return str(item)

    entries("HIGH-RISK PROJECTS", content.get("high_risk_projects"), named)
    entries("TEAMS NEEDING ATTENTION", content.get("teams_needing_attention"), named)
    if content.get("productivity_overview"):
        lines.extend(["", "PRODUCTIVITY", content["productivity_overview"]])
    entries("CRITICAL ISSUES", content.get("critical_issues"), str)
    entries("UPCOMING DEADLINES", content.get("upcoming_deadlines"), str)
    entries("KEY ACHIEVEMENTS", content.get("key_achievements"), str)
    entries("RECOMMENDED ACTIONS", content.get("recommended_actions"), str)
    entries("EXECUTIVE RECOMMENDATIONS", content.get("executive_recommendations"), str)
    entries("STRATEGIC INSIGHTS", content.get("strategic_insights"), str)
    if content.get("narrative"):
        lines.extend(["", content["narrative"]])

    for heading, block in (metrics or {}).items():
        if isinstance(block, dict) and block.get("available") is not False:
            lines.extend(["", heading.upper(), ", ".join(f"{k}: {v}" for k, v in block.items())])
    return "\n".join(lines).strip()


def executive_audience() -> list:
    """Who an organisation-wide summary is addressed to.

    Capability-derived rather than a hardcoded list of job titles: anyone the
    Administrator has granted report or administration rights receives it, which
    is the same test the API uses to decide who may read the page.
    """
    from apps.accounts.rbac import Capability

    people = []
    seen: set[int] = set()
    for user in User.objects.filter(is_active=True).prefetch_related("roles__capabilities"):
        if user.is_superuser or user.has_capability(Capability.VIEW_REPORTS) or user.has_capability(
            Capability.ADMINISTER
        ):
            if user.id not in seen:
                seen.add(user.id)
                people.append(user)
    return people


def generate_executive_summary(
    period: str = ReportPeriod.DAILY,
    *,
    end: date | None = None,
    config: AISettings | None = None,
    trigger: str = GenerationTrigger.SCHEDULED,
    actor=None,
    force: bool = False,
    deliver_it: bool = True,
) -> tuple[ExecutiveSummary, bool]:
    """Produce the organisation-wide executive summary for one period.

    Returns ``(record, generated)`` on the same contract as
    :func:`generate_standup`.
    """
    config = config or AISettings.load()
    start, period_end = period_span(period, end=end)

    existing = ExecutiveSummary.objects.filter(period=period, period_end=period_end).first()
    if existing is not None and not force:
        return existing, False

    started = time.monotonic()
    data = executive.collect(start=start, end=period_end)
    metrics = data["metrics"]
    period_label = PERIOD_LABELS.get(period, "daily")

    fallback = executive.fallback_content(data, period_label=period_label)
    outcome, ai_ok, error = None, True, ""
    try:
        outcome = service.executive_summary(
            executive.prompt_context(data), period_label=period_label, user=actor, config=config
        )
    except AIUnavailable as exc:
        ai_ok, error = False, str(exc)
        logger.warning("%s executive summary fell back to deterministic copy: %s", period_label, exc)

    content = _merge_over_fallback(outcome, fallback)
    duration_ms = int((time.monotonic() - started) * 1000)

    # The supporting detail travels with the summary so the page can draw charts
    # and risk cards without recomputing anything the AI was shown.
    stored_metrics = dict(metrics)
    stored_metrics["detail"] = {
        key: data.get(key)
        for key in (
            "high_risk_projects", "delayed_projects", "all_project_risk", "team",
            "team_needing_attention", "critical_issues", "upcoming_deadlines",
            "completed_projects", "recent_completions",
        )
    }

    with transaction.atomic():
        record, created = ExecutiveSummary.objects.update_or_create(
            period=period,
            period_end=period_end,
            defaults={
                "period_start": start,
                "title": str(content.get("title") or f"{period_label.title()} executive summary")[:240],
                "content": content,
                "metrics": stored_metrics,
                "health_score": int(metrics.get("health_score") or 0),
                "risk_count": len(data.get("high_risk_projects") or []),
                "trigger": trigger,
                "generated_by": actor,
                "ai_ok": ai_ok,
                "error": error[:400],
                "duration_ms": duration_ms,
                "request_log": _request_log(outcome.log_id) if outcome else None,
            },
        )
        if not created:
            record.generation_count = (existing.generation_count if existing else 0) + 1
            record.save(update_fields=["generation_count", "updated_at"])

    actions = [f"schedule:{trigger}", f"period:{period}", f"duration_ms:{duration_ms}",
               f"ai:{'ok' if ai_ok else 'fallback'}", f"health:{record.health_score}"]
    if deliver_it and config.executive_email_enabled:
        try:
            actions += email_executive_summary(record, config=config)
        except Exception as exc:
            logger.exception("Failed delivering %s executive summary", period_label)
            actions.append(f"delivery_failed:{type(exc).__name__}")

    _log(
        AutomationEvent.EXECUTIVE_SUMMARY,
        ai_response=content,
        actions=actions,
        ok=ai_ok,
        message=error or f"{period_label} executive summary for {period_end.isoformat()} ({trigger})",
        request_log_id=outcome.log_id if outcome else None,
    )
    return record, True


def email_executive_summary(record: ExecutiveSummary, *, config: AISettings | None = None,
                            recipients: list | None = None) -> list[str]:
    """Send an executive summary to leadership. Returns executed-action labels."""
    config = config or AISettings.load()
    audience = recipients if recipients is not None else executive_audience()

    actions = delivery.deliver_many(
        audience,
        title=record.title,
        message=record.content.get("overall_health") or "",
        email_subject=f"[KOS] {record.title} — health {record.health_score}/100",
        email_body=render_executive_email(record.content, record.metrics),
        event="digest",
        url="/executive-summary",
        config=config,
    )
    if any(a.startswith("emailed:") for a in actions):
        record.emailed_at = timezone.now()
        record.save(update_fields=["emailed_at", "updated_at"])
    if any(a.startswith("notified:") for a in actions):
        record.notified_at = timezone.now()
        record.save(update_fields=["notified_at", "updated_at"])
    return actions


# --------------------------------------------------------------------------- #
# CSV export
# --------------------------------------------------------------------------- #
def executive_summary_csv_rows(record: ExecutiveSummary) -> list[list[str]]:
    """The executive summary as flat rows, for the CSV export.

    A spreadsheet wants the figures and the findings, not the prose, so this
    emits ``section, item, value`` triples rather than trying to lay narrative
    text out in columns.
    """
    rows: list[list[str]] = [["Section", "Item", "Value"]]
    rows.append(["Summary", "Title", record.title])
    rows.append(["Summary", "Period", f"{record.period_start} to {record.period_end}"])
    rows.append(["Summary", "Health score", str(record.health_score)])
    rows.append(["Summary", "Overall health", str(record.content.get("overall_health") or "")])

    for heading, block in (record.metrics or {}).items():
        if heading == "detail" or not isinstance(block, dict):
            continue
        if block.get("available") is False:
            continue
        for key, value in block.items():
            rows.append([heading.replace("_", " ").title(), key.replace("_", " "), str(value)])

    def flat(item) -> str:
        if isinstance(item, dict):
            return " — ".join(
                str(item[k]) for k in ("name", "team", "reason", "action") if item.get(k)
            )
        return str(item)

    for key, label in (
        ("high_risk_projects", "High-risk projects"),
        ("teams_needing_attention", "Teams needing attention"),
        ("critical_issues", "Critical issues"),
        ("upcoming_deadlines", "Upcoming deadlines"),
        ("key_achievements", "Key achievements"),
        ("recommended_actions", "Recommended actions"),
        ("executive_recommendations", "Executive recommendations"),
        ("strategic_insights", "Strategic insights"),
    ):
        for index, item in enumerate(record.content.get(key) or [], start=1):
            rows.append([label, str(index), flat(item)])
    return rows
