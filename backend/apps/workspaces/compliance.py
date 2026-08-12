"""Statutory-compliance reminders for a workspace (seeded for Finance &
Statutory).

Each :class:`ComplianceObligation` is a recurring filing (GSTR-1 monthly, TDS
quarterly, GSTR-9 annual …). From its cadence we generate dated
:class:`ComplianceDeadline` rows and, a few days before each due date, remind the
workspace team plus IT/Management — again once it goes overdue — until it's
marked filed.

Runs daily via ``manage.py compliance_scan`` (or Celery), and lazily when
someone opens the workspace or their notifications, so it works with or without a
scheduler.
"""
from __future__ import annotations

import calendar
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.notifications.models import Notification, NotificationEvent
from apps.notifications.services import notify

from .models import ComplianceDeadline, ComplianceObligation

User = get_user_model()

# How far ahead deadlines are pre-created, and how far back overdue ones are kept
# on the radar. A monthly filing lands well inside the forward window.
HORIZON_DAYS = 120
LOOKBACK_DAYS = 60

# Indian financial-year quarters (Apr–Mar) → the month each quarter *ends* in.
_QUARTERS = [(6, "Q1 Apr–Jun"), (9, "Q2 Jul–Sep"), (12, "Q3 Oct–Dec"), (3, "Q4 Jan–Mar")]


def _clamp(year: int, month: int, day: int) -> date:
    """A real date for ``day`` in ``month`` — clamped to the month's length so a
    "31st" due day lands on the 30th/28th where needed."""
    last = calendar.monthrange(year, month)[1]
    return date(year, month, min(day, last))


def _add_months(year: int, month: int, n: int) -> tuple[int, int]:
    idx = (month - 1) + n
    return year + idx // 12, idx % 12 + 1


def iter_due_dates(ob: ComplianceObligation, start: date, end: date):
    """Yield ``(period_label, due_date)`` for every occurrence due in
    ``[start, end]``. The period label is the *tax period* being filed, not the
    month the return is due in."""
    out = []
    if ob.cadence == ComplianceObligation.ANNUAL:
        for year in range(start.year - 1, end.year + 2):
            due = _clamp(year, ob.due_month or 12, ob.due_day)
            if start <= due <= end:
                out.append((f"FY {due.year - 1}-{str(due.year)[2:]}", due))
    elif ob.cadence == ComplianceObligation.QUARTERLY:
        for year in range(start.year - 1, end.year + 2):
            for end_month, label in _QUARTERS:
                dy, dm = _add_months(year, end_month, ob.month_offset)
                due = _clamp(dy, dm, ob.due_day)
                if start <= due <= end:
                    out.append((f"{label} {year}", due))
    else:  # monthly
        for year in range(start.year - 1, end.year + 2):
            for month in range(1, 13):
                dy, dm = _add_months(year, month, ob.month_offset)
                due = _clamp(dy, dm, ob.due_day)
                if start <= due <= end:
                    out.append((date(year, month, 1).strftime("%b %Y"), due))
    return sorted(set(out), key=lambda t: t[1])


def ensure_upcoming_deadlines(ob: ComplianceObligation, today: date | None = None) -> int:
    """Create any missing deadline rows in the active window. Idempotent."""
    today = today or timezone.localdate()
    made = 0
    for label, due in iter_due_dates(ob, today - timedelta(days=LOOKBACK_DAYS), today + timedelta(days=HORIZON_DAYS)):
        _, created = ComplianceDeadline.objects.get_or_create(
            obligation=ob, due_date=due, defaults={"period_label": label})
        made += int(created)
    return made


def _recipients(workspace: str):
    """The workspace team plus IT/Management — the people who should see a filing
    coming up. Deliberately includes supervisors here (unlike overdue-project
    reminders): statutory dates are the finance/management team's business."""
    from .access import approver_ids, workspace_members

    people = {u.id: u for u in workspace_members(workspace)}
    for u in User.objects.filter(id__in=approver_ids()):
        people[u.id] = u
    return list(people.values())


def _fmt(d: date) -> str:
    return d.strftime("%d %b %Y")


def _stage_and_message(ob: ComplianceObligation, dl: ComplianceDeadline, days: int):
    """(stage_key, title, body) for where this deadline sits, or None if it's not
    yet within the reminder window."""
    due = _fmt(dl.due_date)
    where = f"in Finance & Statutory (the {ob.name} filing for {dl.period_label})"
    if days < 0:
        return ("overdue",
                f"Overdue filing: {ob.name} — {dl.period_label}",
                f"“{ob.name}” for {dl.period_label} was due {due} and isn't marked filed yet. "
                f"Please file it and mark it done {where}.")
    if days <= min(2, ob.lead_days):
        when = "today" if days == 0 else ("tomorrow" if days == 1 else f"in {days} days")
        return ("final",
                f"Filing due {when}: {ob.name} — {dl.period_label}",
                f"“{ob.name}” for {dl.period_label} is due {due} ({when}). Please file it and mark it done {where}.")
    if days <= ob.lead_days:
        return ("lead",
                f"Filing due in {days} days: {ob.name} — {dl.period_label}",
                f"“{ob.name}” for {dl.period_label} is due {due}. A heads-up so it's filed on time — mark it done {where}.")
    return None


def _maybe_notify(dl: ComplianceDeadline, today: date) -> int:
    ob = dl.obligation
    days = (dl.due_date - today).days
    result = _stage_and_message(ob, dl, days)
    if result is None:
        return 0
    stage, title, body = result
    sent = set(dl.reminders_sent or [])
    if stage in sent:
        return 0
    url = f"/workspaces/{ob.workspace}"
    fired = 0
    for user in _recipients(ob.workspace):
        if Notification.objects.filter(recipient=user, url=url, title=title).exists():
            continue
        notify(user, event=NotificationEvent.COMPLIANCE_DUE, title=title, body=body, url=url)
        fired += 1
    dl.reminders_sent = sorted(sent | {stage})
    dl.save(update_fields=["reminders_sent"])
    return fired


def scan_compliance(today: date | None = None, workspace: str | None = None) -> int:
    """Top up upcoming deadlines and send any due reminders. Returns how many
    notifications were sent. Pass ``workspace`` to scope the lazy on-open path."""
    today = today or timezone.localdate()
    obligations = ComplianceObligation.objects.filter(active=True)
    if workspace:
        obligations = obligations.filter(workspace=workspace)
    obligations = list(obligations)
    for ob in obligations:
        ensure_upcoming_deadlines(ob, today)
    fired = 0
    pending = ComplianceDeadline.objects.filter(
        status=ComplianceDeadline.PENDING, obligation__in=obligations,
    ).select_related("obligation")
    for dl in pending:
        fired += _maybe_notify(dl, today)
    return fired
