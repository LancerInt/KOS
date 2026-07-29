"""Run the notification scans once, synchronously (PRD §22).

For local testing without Celery beat:  python manage.py notify_scan
"""
from django.core.management.base import BaseCommand

from apps.notifications.tasks import run_all_scans


class Command(BaseCommand):
    help = "Run due-soon, 48h-acknowledgement and daily-digest notification scans."

    def handle(self, *args, **options):
        result = run_all_scans()
        self.stdout.write(self.style.SUCCESS(f"Scans complete: {result}"))
