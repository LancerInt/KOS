"""Finish the move to per-user email accounts.

The old shared account was inserted with an explicit ``pk=1``, which left the
Postgres id sequence stuck at 1 — so the first per-user insert collides. Drop
the orphan global row (its credentials are obsolete now that everyone connects
their own) and realign the sequence so new accounts get fresh ids.
"""
from django.db import migrations


def clear_global_account(apps, schema_editor):
    EmailAccount = apps.get_model("notifications", "EmailAccount")
    EmailAccount.objects.filter(user__isnull=True).delete()

    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT setval("
            "  pg_get_serial_sequence('notifications_emailaccount', 'id'),"
            "  COALESCE((SELECT MAX(id) FROM notifications_emailaccount), 1),"
            "  (SELECT MAX(id) IS NOT NULL FROM notifications_emailaccount)"
            ")"
        )


class Migration(migrations.Migration):
    dependencies = [("notifications", "0005_emailaccount_user")]
    operations = [migrations.RunPython(clear_global_account, migrations.RunPython.noop)]
