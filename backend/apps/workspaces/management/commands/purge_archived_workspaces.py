"""Hard-delete archived workspaces (and their projects/sections/records) once
they pass the 30-day retention window. Schedule daily (cron / Task Scheduler);
the API also purges lazily whenever an admin opens the Archive."""
from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.workspaces.views import purge_expired_workspaces


class Command(BaseCommand):
    help = "Permanently remove workspaces archived more than 30 days ago."

    def handle(self, *args, **options):
        n = purge_expired_workspaces()
        self.stdout.write(self.style.SUCCESS(f"Purged {n} expired workspace(s)."))
