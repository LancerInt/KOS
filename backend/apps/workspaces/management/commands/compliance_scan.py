"""Top up statutory-filing deadlines and send any due reminders.

Run daily (a Render Cron Job, or Celery beat). Reminders also fire lazily when
someone opens the workspace or their notifications, so this is the belt to that
suspenders.
"""
from django.core.management.base import BaseCommand

from apps.workspaces.compliance import scan_compliance


class Command(BaseCommand):
    help = "Generate upcoming statutory deadlines and send due/overdue reminders."

    def handle(self, *args, **options):
        sent = scan_compliance()
        self.stdout.write(self.style.SUCCESS(f"Compliance scan complete — {sent} reminder(s) sent."))
