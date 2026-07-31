"""Duration reminders for workspace items.

**Projects** get a staged reminder schedule — a heads-up 7 days and 1 day
before the end, on the due date, and once when overdue (that one requires an
acknowledgement, so it escalates to Management if ignored). Each stage fires
once, guarded by ``project.reminders_sent``; offsets that fall before the start
date are skipped (short projects just get fewer stages). If several stages are
already past on the first scan, only the latest is sent (no retroactive burst).

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

from apps.notifications.models import NotificationEvent
from apps.notifications.services import notify

from .access import effective_access
from .models import WorkspaceMember, WorkspaceProject, WorkspaceRecord

User = get_user_model()


def _fmt(dt) -> str:
    return timezone.localtime(dt).strftime("%d %b %Y, %H:%M")


# ---- Projects: staged reminders --------------------------------------------

def _project_stages(project):
    """(key, target_datetime, event, requires_ack) for stages on/after the start."""
    end = project.end_at
    start = project.start_at
    stages = [
        ("due-7", end - timedelta(days=7), NotificationEvent.DUE_SOON, False),
        ("due-1", end - timedelta(days=1), NotificationEvent.DUE_SOON, False),
        ("due", end, NotificationEvent.DURATION_COMPLETE, False),
        ("overdue", end + timedelta(days=1), NotificationEvent.OVERDUE_ACK, True),
    ]
    return [s for s in stages if s[1] >= start]


def _stage_message(project, key):
    end, name = project.end_at, project.name
    if key == "due-7":
        return (f"1 week to go — {name}",
                f"Your project “{name}” is due on {_fmt(end)} — about a week left. "
                f"Wrap it up, or update the schedule if you need more time.")
    if key == "due-1":
        return (f"Due tomorrow — {name}",
                f"Your project “{name}” is due tomorrow ({_fmt(end)}). Mark it complete when it's done.")
    if key == "due":
        return (f"Due now — {name}",
                f"Your project “{name}” reaches its end time ({_fmt(end)}). Mark it complete.")
    return (f"Overdue — {name}",
            f"Your project “{name}” passed its end time ({_fmt(end)}) and isn't complete yet. "
            f"Acknowledge with a new expected date or a reason.")


def _project_recipients(project):
    """Everyone who should hear about a project's schedule: the members of its
    workspace (the people responsible for it) plus its creator. Supervisors
    (IT / Management / admin) see it in the UI and aren't pinged unless they
    created it — otherwise every overdue project would spam them."""
    ids = set(WorkspaceMember.objects.filter(workspace=project.workspace).values_list("user_id", flat=True))
    if project.created_by_id:
        ids.add(project.created_by_id)
    return list(User.objects.filter(id__in=ids))


def _sync_project(project, now) -> int:
    if project.completed_at or not project.end_at or not project.start_at:
        return 0
    reached = [s for s in _project_stages(project) if s[1] <= now]
    if not reached:
        return 0
    sent = set(project.reminders_sent or [])
    key, _target, event, ack = reached[-1]     # latest reached stage only
    fired = 0
    if key not in sent:
        title, body = _stage_message(project, key)
        for user in _project_recipients(project):
            notify(user, event=event, title=title, body=body,
                   url=f"/workspaces/{project.workspace}/projects/{project.id}", requires_ack=ack)
            fired += 1
    new_sent = sent | {s[0] for s in reached}   # mark earlier stages done too
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
