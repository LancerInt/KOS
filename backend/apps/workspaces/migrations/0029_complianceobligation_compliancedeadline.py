# Compliance calendar models. Re-chained after 0028_workspaceproject_next_occurrence
# (a teammate's project-recurrence migration that also branched from 0027).

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('workspaces', '0028_workspaceproject_next_occurrence_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='ComplianceObligation',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('workspace', models.CharField(db_index=True, max_length=64)),
                ('name', models.CharField(max_length=120)),
                ('description', models.CharField(blank=True, max_length=300)),
                ('cadence', models.CharField(choices=[('monthly', 'Monthly'), ('quarterly', 'Quarterly'), ('annual', 'Annual')], default='monthly', max_length=12)),
                ('due_day', models.PositiveSmallIntegerField(default=1)),
                ('month_offset', models.PositiveSmallIntegerField(default=1)),
                ('due_month', models.PositiveSmallIntegerField(blank=True, null=True)),
                ('lead_days', models.PositiveSmallIntegerField(default=5)),
                ('active', models.BooleanField(default=True)),
                ('order', models.PositiveSmallIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'ordering': ('order', 'name'),
                'unique_together': {('workspace', 'name')},
            },
        ),
        migrations.CreateModel(
            name='ComplianceDeadline',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('period_label', models.CharField(max_length=40)),
                ('due_date', models.DateField(db_index=True)),
                ('status', models.CharField(choices=[('pending', 'Pending'), ('filed', 'Filed')], default='pending', max_length=10)),
                ('filed_at', models.DateTimeField(blank=True, null=True)),
                ('reminders_sent', models.JSONField(blank=True, default=list)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('filed_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('obligation', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='deadlines', to='workspaces.complianceobligation')),
            ],
            options={
                'ordering': ('due_date',),
                'unique_together': {('obligation', 'due_date')},
            },
        ),
    ]
