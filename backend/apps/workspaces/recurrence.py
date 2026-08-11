"""Repeating projects — a chain of ordinary projects, not one that reopens.

A quarterly return or an annual renewal is the *same job done again*, not the
same job still open: each turn needs its own records, its own dates and its own
approval trail. So completing one creates the next, and the finished one stays
finished and readable.

The cadence is anchored to the **start date**, never to when someone got round
to approving the last one. A quarterly job that starts on the 15th starts on the
15th every quarter; approving it three weeks late moves nothing. That also means
a badly overdue chain can produce a successor whose start is already in the past
— which is correct, and says something true about the backlog. Silently skipping
to the next future slot would hide a missed cycle.
"""
from __future__ import annotations

import calendar
import re
from datetime import datetime

from django.utils import timezone

from .models import WorkspaceProject, WorkspaceProjectMember

#: Spelled out rather than taken from ``strftime("%b")``, which follows the
#: server locale — a project's name shouldn't change language with the host.
MONTH_ABBR = ("Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

#: The period tag this module appends, e.g. " · Apr 2026". Matched so the tag is
#: replaced each turn instead of accumulating down the chain.
_PERIOD_TAG = re.compile(r"\s·\s(?:" + "|".join(MONTH_ABBR) + r")\s\d{4}$")


def add_months(moment: datetime, months: int) -> datetime:
    """``moment`` shifted by whole months, keeping the day where it can.

    The 31st of a month has no counterpart in the next one, so it clamps to that
    month's last day (31 Jan → 28/29 Feb). Clamping is per-hop, from the original
    date each time, so it doesn't erode: the anchor is always the project's own
    start, and a chain never walks itself backwards through February.
    """
    month_index = moment.month - 1 + months
    year = moment.year + month_index // 12
    month = month_index % 12 + 1
    day = min(moment.day, calendar.monthrange(year, month)[1])
    return moment.replace(year=year, month=month, day=day)


def next_start_for(project: WorkspaceProject) -> datetime | None:
    """When ``project``'s successor should begin, or None if it doesn't repeat."""
    months = WorkspaceProject.REPEAT_MONTHS.get(project.repeat_frequency)
    if not months:
        return None
    # Anchored to the start date; only a repeating project with no start at all
    # falls back to its completion, and the serializer stops that being created.
    anchor = project.start_at or project.completed_at or timezone.now()
    return add_months(anchor, months)


def occurrence_name(project: WorkspaceProject, start: datetime) -> str:
    """The successor's name: the base name tagged with the period it covers.

    A workspace allows only one live project per name, so the next turn cannot
    simply reuse it. Tagging with the period is what that constraint asks for
    anyway — "GST return · Apr 2026" says which cycle you are looking at, which
    a chain of identically-named projects never could.

    The tag replaces any tag already on the name rather than stacking, so the
    tenth turn is still "GST return · Jul 2028" and not a trail of dates. If the
    tagged name is somehow taken too, a counter is appended; a project that
    cannot be named is worse than one named awkwardly.
    """
    base = _PERIOD_TAG.sub("", project.name).strip()
    stem = f"{base} · {MONTH_ABBR[start.month - 1]} {start.year}"
    candidate, n = stem, 2
    live = WorkspaceProject.objects.filter(workspace=project.workspace, deleted_at__isnull=True)
    while live.filter(name__iexact=candidate).exists():
        candidate = f"{stem} ({n})"
        n += 1
    return candidate[:200]          # the column's max_length


def spawn_successor(project: WorkspaceProject, *, actor=None) -> WorkspaceProject | None:
    """Create the next turn of a repeating project. Idempotent.

    Returns the new project, or None if this one doesn't repeat or has already
    spawned. ``next_occurrence`` is what makes the second call a no-op — without
    it, approve → reopen → approve would fork the chain.
    """
    if project.next_occurrence_id is not None:
        return None
    start = next_start_for(project)
    if start is None:
        return None

    # The successor runs as long as this one was scheduled to, so a two-week job
    # stays a two-week job; an open-ended one stays open-ended.
    end = None
    if project.end_at and project.start_at:
        end = start + (project.end_at - project.start_at)

    successor = WorkspaceProject.objects.create(
        workspace=project.workspace,
        name=occurrence_name(project, start),
        created_by=project.created_by,
        start_at=start,
        end_at=end,
        repeat_frequency=project.repeat_frequency,
    )

    # Carry the roster over. A project with members is need-to-know, and letting
    # the next turn start with an empty roster would quietly re-open it to the
    # whole workspace — a permission change nobody asked for.
    WorkspaceProjectMember.objects.bulk_create([
        WorkspaceProjectMember(project=successor, user_id=m.user_id, added_by=actor)
        for m in project.members.all()
    ])

    project.next_occurrence = successor
    project.save(update_fields=["next_occurrence"])
    return successor
