"""Duration reminders for workspace items.

**Projects** are chased once they run late — no pre-deadline nagging. A project
counts as overdue **as soon as its end time passes** (matching the dashboard);
that fires one reminder to everyone with access to its workspace (the assigned
team) plus its creator. If it's still not complete a **week** later, a single
follow-up goes out — and that's the end of it. Each recipient is pinged once per
stage (deduped on the stored notification); if both stages are already past on
the first scan, only the latest is sent (no retroactive burst). Supervisors
(IT / Management) see everything in the UI and are not pinged per project.

**Records** keep the simple single "duration complete" notice (Entomology
step entries), guarded by ``duration_notified_at``.

Runs daily via Celery beat (apps.notifications.tasks.run_all_scans) and lazily
when an owner opens their notifications, so it works with or without a scheduler.
"""
from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils import timezone

from apps.notifications.models import Notification, NotificationEvent
from apps.notifications.services import notify

from .access import effective_access
from .models import WorkspaceProject, WorkspaceRecord

User = get_user_model()


def _fmt(dt) -> str:
    return timezone.localtime(dt).strftime("%d %b %Y, %H:%M")


# ---- Projects: staged reminders --------------------------------------------

def _project_stages(project):
    """(key, target_datetime) for the two overdue reminders. The first fires the
    moment the project runs late — matching the dashboard, which flags it overdue
    as soon as its end time passes — and a single follow-up a week later."""
    end = project.end_at
    return [
        ("overdue", end),
        ("overdue-week", end + timedelta(days=7)),
    ]


def _stage_message(project, key):
    end, name = project.end_at, project.name
    if key == "overdue":
        return (f"Overdue — {name}",
                f"Your project “{name}” has passed its end time ({_fmt(end)}) and still isn't "
                f"complete. Please finish it, or update the schedule if the date has moved.")
    return (f"Still overdue — {name}",
            f"Your project “{name}” has now been overdue for a week (was due {_fmt(end)}) and "
            f"still isn't complete. This is the final reminder — please close it out or reschedule.")


def _project_recipients(project):
    """Everyone the overdue reminder should reach: the whole team with access to
    the workspace (so the assigned executives who see it overdue on their
    dashboard also get the bell), plus the creator even if their explicit access
    later changed. Supervisors still see everything in the UI without a per-
    project ping."""
    from .access import workspace_members

    people = {u.id: u for u in workspace_members(project.workspace)}
    if project.created_by_id and project.created_by_id not in people:
        people[project.created_by_id] = project.created_by
    return list(people.values())


def _sync_project(project, now) -> int:
    if project.completed_at or not project.end_at or not project.start_at:
        return 0
    reached = [s for s in _project_stages(project) if s[1] <= now]
    if not reached:
        return 0
    key, _target = reached[-1]     # latest reached stage only — no retroactive burst
    title, body = _stage_message(project, key)
    url = f"/workspaces/{project.workspace}/projects/{project.id}"
    fired = 0
    for user in _project_recipients(project):
        # Dedup per recipient by stage: url pins the project, title the stage
        # (they differ per stage). So a member who gains access *after* the
        # reminder first fired still gets it once, while nobody is pinged twice
        # for the same stage. (Notification.project is the core Project FK, not a
        # WorkspaceProject, so the link is carried by the url.)
        if Notification.objects.filter(recipient=user, url=url, title=title).exists():
            continue
        notify(user, event=NotificationEvent.OVERDUE, title=title, body=body, url=url)
        fired += 1
    # Bookkeeping so the escalation stages stay monotonic across scans.
    sent = set(project.reminders_sent or [])
    new_sent = sent | {s[0] for s in reached}
    if new_sent != sent:
        project.reminders_sent = sorted(new_sent)
        project.save(update_fields=["reminders_sent"])
    return fired


# ---- Records: single completion notice -------------------------------------

def _due_records(base):
    return base.filter(
        completed_at__isnull=True, duration_notified_at__isnull=True,
        start_at__isnull=False, end_at__isnull=False,
    )


def _record_label(record) -> str:
    for value in (record.data or {}).values():
        if value:
            return str(value)
    return record.category


def _notify_record(record) -> None:
    end, label = record.end_at, _record_label(record)
    notify(
        record.created_by,
        event=NotificationEvent.DURATION_COMPLETE,
        title=f"Duration complete — {label}",
        body=(f"“{label}” ({record.category}) has reached its end time "
              f"({_fmt(end)}). Mark it complete or update its schedule."),
        url=f"/workspaces/{record.workspace}/projects/{record.project_id}",
    )
    record.duration_notified_at = timezone.now()
    record.save(update_fields=["duration_notified_at"])


# ---- Runners ---------------------------------------------------------------

def _run(project_qs, record_qs) -> int:
    now = timezone.now()
    count = 0
    for p in project_qs.filter(start_at__isnull=False, end_at__isnull=False, completed_at__isnull=True):
        count += _sync_project(p, now)
    for r in _due_records(record_qs):
        if r.end_at and r.end_at <= now and r.created_by_id:
            _notify_record(r)
            count += 1
    return count


def sync_due_durations(user) -> int:
    """Reminders for projects/records the user is responsible for — the lazy
    on-open path. Covers projects they created AND every project in a workspace
    they're a member of, so an assigned member gets overdue pings for their own
    workspaces even when someone else created the project."""
    if not user or not getattr(user, "is_authenticated", False):
        return 0
    q = Q(created_by=user)
    acc = effective_access(user)
    if acc is not None:                       # a member: also scan their workspaces
        q |= Q(workspace__in=set(acc.keys()))
    projects = WorkspaceProject.objects.filter(q)
    records = WorkspaceRecord.objects.filter(created_by=user, workspace="entomology")
    return _run(projects, records)


def sync_all_due_durations() -> int:
    """Scan everyone's projects/records — the daily scheduled path."""
    projects = WorkspaceProject.objects.select_related("created_by").all()
    records = WorkspaceRecord.objects.select_related("created_by").filter(workspace="entomology")
    return _run(projects, records)
