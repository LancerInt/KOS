"""Run the retention purge once, synchronously (PRD §26.4).

Only purge-safe record types are ever touched; audit & regulatory records are
exempt. See ``apps.audit.retention``.

    python manage.py purge_expired
"""
from django.core.management.base import BaseCommand

from apps.audit.retention import run_purge


class Command(BaseCommand):
    help = "Delete expired purge-safe records per the retention policies."

    def handle(self, *args, **options):
        results = run_purge()
        self.stdout.write(self.style.SUCCESS(f"Purge complete: {results}"))
