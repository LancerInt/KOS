"""Delete workspace notifications delivered to people who no longer have access
to the workspace they belong to.

A one-off tidy-up after tightening who gets workspace notifications: e.g. a
Researcher who created a project in another team's workspace kept getting its
overdue pings even though they can't open it. This clears those already-sitting
notifications. Safe to run repeatedly.

    python manage.py prune_orphan_notifications            # delete
    python manage.py prune_orphan_notifications --dry-run  # just report
"""
from __future__ import annotations

import re

from django.core.management.base import BaseCommand

from apps.notifications.models import Notification, NotificationEvent
from apps.workspaces.access import effective_access

# Notifications that belong to a specific workspace and encode it in their URL.
WORKSPACE_EVENTS = [
    NotificationEvent.OVERDUE,
    NotificationEvent.COMPLIANCE_DUE,
    NotificationEvent.COMPLIANCE_OVERDUE,
]
_WS = re.compile(r"^/workspaces/([^/?]+)")


class Command(BaseCommand):
    help = "Remove workspace notifications delivered to users who no longer have access to that workspace."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true",
                            help="Report what would be deleted without deleting.")

    def handle(self, *args, **opts):
        access_cache: dict[int, object] = {}
        doomed: list[int] = []
        # Never touch an unacknowledged 48-hour item — that has to be acknowledged,
        # not silently swept away.
        qs = (
            Notification.objects.filter(event__in=WORKSPACE_EVENTS)
            .exclude(requires_acknowledgement=True, acknowledged_at__isnull=True)
            .select_related("recipient")
        )
        for n in qs.iterator():
            m = _WS.match(n.url or "")
            if not m:
                continue
            workspace = m.group(1)
            if n.recipient_id not in access_cache:
                access_cache[n.recipient_id] = effective_access(n.recipient)
            acc = access_cache[n.recipient_id]
            if acc is None:              # supervisor (IT / Management) — sees everything
                continue
            if workspace not in acc:     # recipient no longer has access → orphaned
                doomed.append(n.id)

        if opts["dry_run"]:
            self.stdout.write(self.style.WARNING(f"Would delete {len(doomed)} orphaned notification(s)."))
            return
        deleted, _ = Notification.objects.filter(id__in=doomed).delete()
        self.stdout.write(self.style.SUCCESS(f"Deleted {deleted} orphaned notification(s)."))
