"""Hard-delete archived workspaces and deleted projects/sections/records once
they pass the 30-day retention window. Schedule daily (cron / Task Scheduler);
the API also purges lazily whenever someone opens the Archive."""
from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.workspaces.views import purge_expired_deleted_items, purge_expired_workspaces


class Command(BaseCommand):
    help = "Permanently remove workspaces + items deleted more than 30 days ago."

    def handle(self, *args, **options):
        ws = purge_expired_workspaces()
        items = purge_expired_deleted_items()
        self.stdout.write(self.style.SUCCESS(
            f"Purged {ws} expired workspace(s) and {items} deleted item(s)."))
