"""Seed the Finance & Statutory workspace with its recurring statutory filings.

Default due dates follow the standard GST/TDS calendar; they're editable per
obligation (and per deadline) because the government shifts these often.
"""
from django.db import migrations

WORKSPACE = "finance-statutory"

# name, cadence, due_day, month_offset, due_month, lead_days, order, description
OBLIGATIONS = [
    ("GSTR-1", "monthly", 11, 1, None, 5, 1, "Monthly outward-supplies return — due the 11th of the next month."),
    ("GSTR-3B", "monthly", 20, 1, None, 5, 2, "Monthly summary return & tax payment — due the 20th of the next month."),
    ("TDS Payment", "monthly", 7, 1, None, 5, 3, "Monthly TDS deposit — due the 7th of the next month."),
    ("TDS Quarterly Return", "quarterly", 31, 1, None, 7, 4, "Quarterly TDS return — due the end of the month after the quarter."),
    ("GSTR-9 (Annual Return)", "annual", 31, 1, 12, 15, 5, "Annual GST return — due 31 December of the following financial year."),
]


def seed(apps, schema_editor):
    Obligation = apps.get_model("workspaces", "ComplianceObligation")
    for name, cadence, due_day, offset, due_month, lead, order, desc in OBLIGATIONS:
        Obligation.objects.update_or_create(
            workspace=WORKSPACE, name=name,
            defaults=dict(cadence=cadence, due_day=due_day, month_offset=offset,
                          due_month=due_month, lead_days=lead, order=order,
                          description=desc, active=True),
        )


def unseed(apps, schema_editor):
    Obligation = apps.get_model("workspaces", "ComplianceObligation")
    Obligation.objects.filter(workspace=WORKSPACE, name__in=[o[0] for o in OBLIGATIONS]).delete()


class Migration(migrations.Migration):
    dependencies = [("workspaces", "0029_complianceobligation_compliancedeadline")]
    operations = [migrations.RunPython(seed, unseed)]
