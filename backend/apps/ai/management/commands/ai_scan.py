"""Run the AI automation scans synchronously.

Useful for verifying automation without a Celery worker, and for a one-off
catch-up run after downtime:

    python manage.py ai_scan                 # the recurring scans
    python manage.py ai_scan --all           # including daily/weekly/monthly
    python manage.py ai_scan --scan overdue
"""
from __future__ import annotations

import json

from django.core.management.base import BaseCommand

from apps.ai import tasks as ai_tasks

SCANS = {
    "overdue": ai_tasks.scan_overdue_tasks,
    "blocked": ai_tasks.scan_blocked_and_priority,
    "milestones": ai_tasks.scan_missed_milestones,
    "health": ai_tasks.scan_project_health,
    "daily": ai_tasks.generate_daily_summaries,
    "weekly": ai_tasks.generate_weekly_reports,
    "monthly": ai_tasks.generate_monthly_reports,
}
RECURRING = ["overdue", "blocked", "milestones", "health"]


class Command(BaseCommand):
    help = "Run AI automation scans synchronously."

    def add_arguments(self, parser):
        parser.add_argument(
            "--scan", choices=sorted(SCANS), action="append", dest="scans",
            help="Run only this scan (repeatable).",
        )
        parser.add_argument(
            "--all", action="store_true",
            help="Include the daily, weekly and monthly report generators.",
        )

    def handle(self, *args, **options):
        selected = options.get("scans") or (sorted(SCANS) if options["all"] else RECURRING)

        for name in selected:
            self.stdout.write(f"Running {name}…")
            try:
                result = SCANS[name]()
            except Exception as exc:  # a failed scan must not hide the others
                self.stderr.write(self.style.ERROR(f"  {name} failed: {exc}"))
                continue
            self.stdout.write(self.style.SUCCESS(f"  {name}: {json.dumps(result, default=str)}"))
