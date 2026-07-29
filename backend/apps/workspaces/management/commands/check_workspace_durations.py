"""Notify creators of any Entomology projects whose duration is complete.

Idempotent (each project notifies once). Wire this to cron or Celery beat for a
daily sweep; it also runs lazily when an owner opens their notifications.

    python manage.py check_workspace_durations
"""
from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.workspaces.duration import sync_all_due_durations


class Command(BaseCommand):
    help = "Send 'duration complete' notifications for due workspace projects."

    def handle(self, *args, **options):
        n = sync_all_due_durations()
        self.stdout.write(self.style.SUCCESS(f"Duration check done - {n} notification(s) sent."))
