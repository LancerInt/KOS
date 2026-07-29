"""Seed the default retention policies (PRD §26.4).

Idempotent: creates any missing default policy, leaves existing ones untouched
(so admin edits are preserved). Run once after migrate:

    python manage.py seed_retention
"""
from django.core.management.base import BaseCommand

from apps.audit.models import RetentionPolicy
from apps.audit.retention import DEFAULT_POLICIES


class Command(BaseCommand):
    help = "Create default retention policies (audit & regulatory records exempt)."

    def handle(self, *args, **options):
        created = 0
        for policy in DEFAULT_POLICIES:
            _, was_created = RetentionPolicy.objects.get_or_create(
                record_type=policy["record_type"],
                defaults={
                    "label": policy["label"],
                    "retention_days": policy.get("retention_days"),
                    "is_exempt": policy.get("is_exempt", False),
                    "description": policy.get("description", ""),
                },
            )
            created += int(was_created)
        self.stdout.write(self.style.SUCCESS(f"Retention policies ready ({created} created)."))
