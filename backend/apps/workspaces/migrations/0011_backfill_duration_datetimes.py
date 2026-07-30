"""Backfill the new datetime durations from the legacy date-only fields.

Existing projects/records stored ``start_date`` + ``duration_days``. Convert
each to ``start_at`` (that date at 09:00 local) → ``end_at`` (+ duration_days).
"""
from datetime import datetime, time, timedelta

from django.db import migrations
from django.utils import timezone


def forwards(apps, schema_editor):
    tz = timezone.get_current_timezone()
    for model_name in ("WorkspaceProject", "WorkspaceRecord"):
        Model = apps.get_model("workspaces", model_name)
        for row in Model.objects.filter(start_date__isnull=False, duration_days__isnull=False):
            start_at = timezone.make_aware(datetime.combine(row.start_date, time(9, 0)), tz)
            row.start_at = start_at
            row.end_at = start_at + timedelta(days=row.duration_days)
            row.save(update_fields=["start_at", "end_at"])


def backwards(apps, schema_editor):
    # start_date / duration_days are left intact, so nothing to undo.
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("workspaces", "0010_workspaceproject_end_at_workspaceproject_start_at_and_more"),
    ]
    operations = [migrations.RunPython(forwards, backwards)]
