"""Tests for the AI daily stand-up and executive summary.

Same rules as :mod:`apps.ai.tests`: every test runs against the offline
provider, so the suite makes no network call and needs no API key. What is
under test is our logic — access scoping, the caching that stops duplicate
provider calls, graceful degradation when the provider is down, and the fact
that neither feature disturbs anything that already existed.
"""
from __future__ import annotations

from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone

from apps.accounts.models import Role
from apps.accounts.rbac import Capability, Scope
from apps.ai import briefings, executive, standup
from apps.ai.models import (
    AIAutomationLog,
    AIRequestLog,
    AISettings,
    AutomationEvent,
    DailyStandup,
    ExecutiveSummary,
    GenerationTrigger,
    ReportPeriod,
)
from apps.ai.service import AIUnavailable
from apps.projects.models import Confidentiality, Membership, Project, ProjectStatus
from apps.tasks.models import Task

User = get_user_model()


@pytest.fixture(autouse=True)
def no_real_api_keys(settings):
    """Blank every provider key, so a developer's real key is never spent here."""
    settings.AI_API_KEYS = {"grok": "", "groq": "", "openai": ""}


@pytest.fixture
def ai_settings(db) -> AISettings:
    config = AISettings.load()
    config.provider = "mock"
    config.is_enabled = True
    config.automation_enabled = True
    config.standup_enabled = True
    config.executive_summary_enabled = True
    config.save()
    return config


@pytest.fixture
def person(db) -> User:
    return User.objects.create_user(username="ravi", email="ravi@kos.local", password="x")


@pytest.fixture
def project(db, person) -> Project:
    return Project.objects.create(
        name="Effluent Upgrade", code="EFF-STANDUP", owner=person, status=ProjectStatus.ACTIVE,
        target_date=timezone.localdate() + timedelta(days=30),
    )


def make_task(project, owner, **kwargs) -> Task:
    task = Task.objects.create(
        title=kwargs.pop("title", "Do the thing"),
        project=project,
        created_by=owner,
        **kwargs,
    )
    task.owners.add(owner)
    return task


# --------------------------------------------------------------------------- #
# Stand-up: data collection
# --------------------------------------------------------------------------- #
class TestStandupCollection:
    def test_counts_reflect_the_users_own_work(self, ai_settings, person, project):
        today = timezone.localdate()
        make_task(project, person, title="Late one", due_date=today - timedelta(days=3))
        make_task(project, person, title="Due today", due_date=today)
        make_task(project, person, title="Next week", due_date=today + timedelta(days=4))
        make_task(project, person, title="Critical", priority="critical")

        data = standup.collect(person, today=today)
        counts = data["counts"]

        assert counts["assigned_open"] == 4
        assert counts["overdue"] == 1
        assert counts["due_today"] == 1
        assert counts["upcoming_week"] == 1
        assert counts["high_priority"] == 1

    def test_only_the_users_own_tasks_appear(self, ai_settings, person, project):
        other = User.objects.create_user(username="asha", email="asha@kos.local", password="x")
        make_task(project, person, title="Mine")
        make_task(project, other, title="Theirs")

        data = standup.collect(person, today=timezone.localdate())

        titles = [t["title"] for t in data["overdue"] + data["due_today"] + data["pending"]]
        assert "Theirs" not in titles
        assert data["counts"]["assigned_open"] == 1

    def test_completed_work_counts_for_yesterday_only(self, ai_settings, person, project):
        today = timezone.localdate()
        yesterday_task = make_task(project, person, title="Finished yesterday", status="completed")
        yesterday_task.completed_at = timezone.now() - timedelta(days=1)
        yesterday_task.save(update_fields=["completed_at"])

        old = make_task(project, person, title="Finished last week", status="completed")
        old.completed_at = timezone.now() - timedelta(days=7)
        old.save(update_fields=["completed_at"])

        data = standup.collect(person, today=today)
        assert data["counts"]["completed_yesterday"] == 1
        assert data["completed_yesterday"][0]["title"] == "Finished yesterday"

    def test_a_confidential_project_the_user_is_not_on_stays_invisible(self, ai_settings, person):
        """The stand-up must never become a side channel into a hidden project."""
        outsider = User.objects.create_user(username="mo", email="mo@kos.local", password="x")
        secret = Project.objects.create(
            name="Acquisition", code="SECRET-1", owner=outsider,
            status=ProjectStatus.ACTIVE, confidentiality=Confidentiality.CONFIDENTIAL,
        )
        from apps.agile.models import Sprint

        Sprint.objects.create(
            project=secret, name="Secret sprint", start_date=timezone.localdate(), status="active"
        )

        data = standup.collect(person, today=timezone.localdate())
        assert data["counts"]["meetings_today"] == 0

    def test_a_sprint_on_a_visible_project_shows_as_an_event(self, ai_settings, person, project):
        from apps.agile.models import Sprint

        Membership.objects.create(user=person, project=project)
        Sprint.objects.create(
            project=project, name="Sprint 4", start_date=timezone.localdate(), status="active"
        )

        data = standup.collect(person, today=timezone.localdate())
        assert data["counts"]["meetings_today"] == 1
        assert "Sprint 4 starts" == data["meetings_today"][0]["title"]

    def test_an_empty_day_is_not_worth_a_standup(self, ai_settings, person):
        data = standup.collect(person, today=timezone.localdate())
        assert standup.has_anything_to_say(data) is False


# --------------------------------------------------------------------------- #
# Stand-up: generation
# --------------------------------------------------------------------------- #
class TestStandupGeneration:
    def test_generates_and_stores_a_standup(self, ai_settings, person, project):
        make_task(project, person, title="Ship the invoice module", due_date=timezone.localdate())

        record, generated = briefings.generate_standup(person, config=ai_settings)

        assert generated is True
        assert record is not None
        assert record.standup_date == timezone.localdate()
        assert record.ai_ok is True
        assert record.content["greeting"]
        assert record.metrics["counts"]["assigned_open"] == 1

    def test_a_second_call_the_same_day_reuses_the_stored_row(self, ai_settings, person, project):
        """The row is the cache — this is what stops duplicate provider calls."""
        make_task(project, person, due_date=timezone.localdate())

        first, _ = briefings.generate_standup(person, config=ai_settings)
        calls_after_first = AIRequestLog.objects.count()

        second, generated = briefings.generate_standup(person, config=ai_settings)

        assert generated is False
        assert second.pk == first.pk
        assert AIRequestLog.objects.count() == calls_after_first

    def test_force_regenerates_and_counts_the_regeneration(self, ai_settings, person, project):
        make_task(project, person, due_date=timezone.localdate())

        first, _ = briefings.generate_standup(person, config=ai_settings)
        calls_after_first = AIRequestLog.objects.count()

        second, generated = briefings.generate_standup(person, config=ai_settings, force=True)

        assert generated is True
        assert second.pk == first.pk  # same row, rewritten
        assert second.generation_count == 2
        assert AIRequestLog.objects.count() == calls_after_first + 1

    def test_one_standup_per_person_per_day(self, ai_settings, person, project):
        make_task(project, person, due_date=timezone.localdate())
        briefings.generate_standup(person, config=ai_settings)
        briefings.generate_standup(person, config=ai_settings, force=True)
        assert DailyStandup.objects.filter(user=person).count() == 1

    def test_a_provider_outage_still_produces_a_standup(self, ai_settings, person, project, monkeypatch):
        """Degrading to deterministic copy beats sending nothing at 9am."""
        make_task(project, person, title="Payment testing", due_date=timezone.localdate() - timedelta(days=2))

        def explode(*args, **kwargs):
            raise AIUnavailable("Provider is down")

        monkeypatch.setattr("apps.ai.service.daily_standup", explode)

        record, generated = briefings.generate_standup(person, config=ai_settings)

        assert generated is True
        assert record.ai_ok is False
        assert record.error == "Provider is down"
        # Every contract key is still present, so the UI renders identically.
        for key in ("greeting", "yesterday", "today_priorities", "overdue", "blockers",
                    "recommendations", "productivity_insight", "suggested_order"):
            assert key in record.content
        assert record.content["overdue"], "the overdue task should appear in the fallback copy"

    def test_partial_ai_output_is_completed_from_the_fallback(self, ai_settings, person, project, monkeypatch):
        from apps.ai.service import AIOutcome

        make_task(project, person, title="Payment testing", due_date=timezone.localdate() - timedelta(days=1))
        monkeypatch.setattr(
            "apps.ai.service.daily_standup",
            lambda *a, **k: AIOutcome(
                data={"greeting": "Good morning, Ravi."}, structured=True, provider="mock"
            ),
        )

        record, _ = briefings.generate_standup(person, config=ai_settings)

        assert record.content["greeting"] == "Good morning, Ravi."
        assert record.content["overdue"], "missing keys must fall back, not vanish"

    def test_generation_is_logged_for_audit(self, ai_settings, person, project):
        make_task(project, person, due_date=timezone.localdate())
        briefings.generate_standup(person, config=ai_settings)

        log = AIAutomationLog.objects.filter(event=AutomationEvent.DAILY_STANDUP, user=person).first()
        assert log is not None
        joined = " ".join(log.executed_actions)
        assert "schedule:scheduled" in joined
        assert "ai:ok" in joined
        assert any(a.startswith("duration_ms:") for a in log.executed_actions)


class TestStandupDelivery:
    def test_a_user_who_switched_off_digests_is_not_emailed(self, ai_settings, person, project):
        from apps.notifications.services import get_prefs

        prefs = get_prefs(person)
        prefs.daily_digest = False
        prefs.save()

        make_task(project, person, due_date=timezone.localdate())
        record, _ = briefings.generate_standup(person, config=ai_settings)

        assert record.emailed_at is None
        assert record.notified_at is None
        # …but the stand-up itself still exists for the widget.
        assert record.content["greeting"]

    def test_notification_is_raised_when_enabled(self, ai_settings, person, project):
        from apps.notifications.models import Notification

        make_task(project, person, due_date=timezone.localdate())
        record, _ = briefings.generate_standup(person, config=ai_settings)

        assert Notification.objects.filter(recipient=person).exists()
        assert record.notified_at is not None


# --------------------------------------------------------------------------- #
# Stand-up: the scheduled job
# --------------------------------------------------------------------------- #
class TestStandupSchedule:
    def test_waits_until_the_configured_time(self, ai_settings, person, project):
        from apps.ai.tasks import generate_daily_standups

        make_task(project, person, due_date=timezone.localdate())
        ai_settings.standup_hour = 23
        ai_settings.standup_minute = 59
        ai_settings.save()

        result = generate_daily_standups()

        assert result.get("skipped") == "before configured time"
        assert DailyStandup.objects.count() == 0

    def test_runs_once_the_configured_time_has_passed(self, ai_settings, person, project):
        from apps.ai.tasks import generate_daily_standups

        make_task(project, person, due_date=timezone.localdate())
        ai_settings.standup_hour = 0
        ai_settings.standup_minute = 0
        ai_settings.save()

        result = generate_daily_standups()

        assert result["generated"] == 1
        assert DailyStandup.objects.filter(user=person).count() == 1

    def test_a_second_tick_the_same_day_generates_nothing(self, ai_settings, person, project):
        from apps.ai.tasks import generate_daily_standups

        make_task(project, person, due_date=timezone.localdate())
        ai_settings.standup_hour = 0
        ai_settings.save()

        generate_daily_standups()
        calls = AIRequestLog.objects.count()
        second = generate_daily_standups()

        assert second["generated"] == 0
        assert AIRequestLog.objects.count() == calls

    def test_the_switch_turns_it_off(self, ai_settings, person, project):
        from apps.ai.tasks import generate_daily_standups

        make_task(project, person, due_date=timezone.localdate())
        ai_settings.standup_enabled = False
        ai_settings.save()

        assert generate_daily_standups() == {"skipped": "disabled"}


# --------------------------------------------------------------------------- #
# Executive summary
# --------------------------------------------------------------------------- #
class TestExecutiveCollection:
    def test_metrics_cover_every_required_source(self, ai_settings, person, project):
        today = timezone.localdate()
        make_task(project, person, title="Late", due_date=today - timedelta(days=5))

        data = executive.collect(start=today - timedelta(days=7), end=today)
        metrics = data["metrics"]

        for section in ("projects", "delivery", "productivity", "milestones",
                        "governance", "quality", "commercial"):
            assert section in metrics, f"missing {section}"
        assert metrics["delivery"]["overdue_tasks"] == 1
        assert 0 <= metrics["health_score"] <= 100

    def test_commercial_is_marked_unavailable_without_crm_data(self, ai_settings, project):
        today = timezone.localdate()
        data = executive.collect(start=today - timedelta(days=7), end=today)
        assert data["metrics"]["commercial"] == {"available": False}

    def test_commercial_appears_once_crm_holds_opportunities(self, ai_settings, person):
        from apps.crm.models import Customer, Opportunity, OpportunityStage

        customer = Customer.objects.create(name="Acme", owner=person)
        Opportunity.objects.create(
            customer=customer, title="Plant upgrade", stage=OpportunityStage.QUALIFIED, amount=500000
        )

        today = timezone.localdate()
        commercial = executive.collect(start=today - timedelta(days=7), end=today)["metrics"]["commercial"]

        assert commercial["available"] is True
        assert commercial["open_pipeline_value"] == 500000.0
        assert commercial["open_deals"] == 1

    def test_a_healthy_organisation_scores_well(self, ai_settings, person, project):
        today = timezone.localdate()
        make_task(project, person, title="On track", due_date=today + timedelta(days=10))

        metrics = executive.collect(start=today - timedelta(days=7), end=today)["metrics"]
        assert metrics["health_score"] >= 90

    def test_overdue_and_blocked_work_pushes_a_project_into_the_risk_list(self, ai_settings, person, project):
        today = timezone.localdate()
        for index in range(6):
            make_task(project, person, title=f"Late {index}", due_date=today - timedelta(days=10))

        data = executive.collect(start=today - timedelta(days=7), end=today)

        assert data["metrics"]["projects"]["high_risk"] >= 1
        assert data["high_risk_projects"][0]["code"] == "EFF-STANDUP"
        assert data["high_risk_projects"][0]["reasons"]


class TestExecutiveGeneration:
    def test_generates_stores_and_scores(self, ai_settings, person, project):
        make_task(project, person, due_date=timezone.localdate())

        record, generated = briefings.generate_executive_summary(
            ReportPeriod.WEEKLY, config=ai_settings, deliver_it=False
        )

        assert generated is True
        assert record.period == ReportPeriod.WEEKLY
        assert record.period_start == record.period_end - timedelta(days=7)
        assert 0 <= record.health_score <= 100
        assert record.content["overall_health"]
        assert "detail" in record.metrics

    def test_the_same_period_is_only_generated_once(self, ai_settings, project):
        first, _ = briefings.generate_executive_summary(
            ReportPeriod.DAILY, config=ai_settings, deliver_it=False
        )
        calls = AIRequestLog.objects.count()

        second, generated = briefings.generate_executive_summary(
            ReportPeriod.DAILY, config=ai_settings, deliver_it=False
        )

        assert generated is False
        assert second.pk == first.pk
        assert AIRequestLog.objects.count() == calls

    def test_a_provider_outage_still_produces_a_summary(self, ai_settings, person, project, monkeypatch):
        make_task(project, person, due_date=timezone.localdate() - timedelta(days=3))

        def explode(*args, **kwargs):
            raise AIUnavailable("Provider is down")

        monkeypatch.setattr("apps.ai.service.executive_summary", explode)

        record, _ = briefings.generate_executive_summary(
            ReportPeriod.DAILY, config=ai_settings, deliver_it=False
        )

        assert record.ai_ok is False
        # The figures are computed, not generated, so they survive the outage.
        assert record.metrics["delivery"]["overdue_tasks"] == 1
        assert str(record.health_score) in record.content["overall_health"]

    def test_scheduled_run_emails_leadership(self, ai_settings, db, project):
        from django.core import mail

        boss = User.objects.create_user(
            username="boss", email="boss@kos.local", password="x", is_superuser=True
        )
        mail.outbox.clear()

        record, _ = briefings.generate_executive_summary(ReportPeriod.DAILY, config=ai_settings)

        assert record.emailed_at is not None
        assert any(boss.email in m.to for m in mail.outbox)

    def test_generation_is_logged_for_audit(self, ai_settings, project):
        briefings.generate_executive_summary(ReportPeriod.DAILY, config=ai_settings, deliver_it=False)

        log = AIAutomationLog.objects.filter(event=AutomationEvent.EXECUTIVE_SUMMARY).first()
        assert log is not None
        joined = " ".join(log.executed_actions)
        assert "period:daily" in joined
        assert "schedule:scheduled" in joined

    def test_the_switch_turns_it_off(self, ai_settings, project):
        from apps.ai.tasks import generate_executive_summary

        ai_settings.executive_summary_enabled = False
        ai_settings.save()
        assert generate_executive_summary("daily") == {"skipped": "disabled"}

    def test_a_single_period_can_be_switched_off(self, ai_settings, project):
        from apps.ai.tasks import generate_executive_summary

        ai_settings.executive_weekly_enabled = False
        ai_settings.save()

        assert generate_executive_summary("weekly")["skipped"] == "weekly summary disabled"
        assert generate_executive_summary("daily")["generated"] is True

    def test_csv_export_carries_figures_and_findings(self, ai_settings, person, project):
        make_task(project, person, due_date=timezone.localdate() - timedelta(days=2))
        record, _ = briefings.generate_executive_summary(
            ReportPeriod.DAILY, config=ai_settings, deliver_it=False
        )

        rows = briefings.executive_summary_csv_rows(record)

        assert rows[0] == ["Section", "Item", "Value"]
        flat = "\n".join(",".join(r) for r in rows)
        assert "Health score" in flat
        assert "overdue tasks" in flat
        # The bulky nested detail blob must not be dumped into a spreadsheet.
        assert "detail" not in {r[0].lower() for r in rows[1:]}


# --------------------------------------------------------------------------- #
# API
# --------------------------------------------------------------------------- #
@pytest.fixture
def client_for(db):
    from rest_framework.test import APIClient

    def build(user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    return build


def grant(user, capability, scope=Scope.ORGANISATION) -> None:
    role = Role.objects.create(name=f"{capability}-{user.username}", default_scope=scope)
    role.role_capabilities.create(capability=capability, scope=scope)
    user.roles.add(role)


class TestStandupApi:
    def test_get_does_not_generate(self, ai_settings, person, project, client_for):
        make_task(project, person, due_date=timezone.localdate())

        response = client_for(person).get(reverse("ai-standup"))

        assert response.status_code == 200
        assert response.data["exists"] is False
        assert AIRequestLog.objects.count() == 0

    def test_post_generates_and_get_then_returns_it(self, ai_settings, person, project, client_for):
        make_task(project, person, title="Invoice module", due_date=timezone.localdate())
        client = client_for(person)

        created = client.post(reverse("ai-standup"), {}, format="json")
        assert created.status_code in (200, 202)

        read = client.get(reverse("ai-standup"))
        assert read.status_code == 200
        assert read.data["exists"] is True
        assert read.data["standup"]["content"]["greeting"]

    def test_history_is_strictly_the_users_own(self, ai_settings, person, project, client_for):
        other = User.objects.create_user(username="nita", email="nita@kos.local", password="x")
        make_task(project, person, due_date=timezone.localdate())
        make_task(project, other, due_date=timezone.localdate())
        briefings.generate_standup(person, config=ai_settings)
        briefings.generate_standup(other, config=ai_settings)

        response = client_for(person).get("/api/ai/standups/")

        assert response.status_code == 200
        assert response.data["count"] == 1

    def test_anonymous_access_is_refused(self, ai_settings, client_for, db):
        from rest_framework.test import APIClient

        assert APIClient().get(reverse("ai-standup")).status_code in (401, 403)


class TestExecutiveApi:
    def test_an_ordinary_user_is_refused(self, ai_settings, person, client_for):
        response = client_for(person).get(reverse("ai-executive-summary"))
        assert response.status_code == 403

    def test_a_report_viewer_is_allowed(self, ai_settings, person, project, client_for):
        grant(person, Capability.VIEW_REPORTS)
        response = client_for(person).get(reverse("ai-executive-summary"))
        assert response.status_code == 200
        assert response.data["exists"] is False

    def test_a_superuser_can_generate_and_read(self, ai_settings, db, project, client_for):
        boss = User.objects.create_user(
            username="md", email="md@kos.local", password="x", is_superuser=True
        )
        client = client_for(boss)

        created = client.post(reverse("ai-executive-summary"), {"period": "daily"}, format="json")
        assert created.status_code in (200, 202)

        read = client.get(reverse("ai-executive-summary"), {"period": "daily"})
        assert read.status_code == 200
        assert read.data["exists"] is True
        assert read.data["summary"]["health_score"] >= 0

    def test_history_is_refused_without_the_capability(self, ai_settings, person, client_for):
        assert client_for(person).get("/api/ai/executive-summaries/").status_code == 403

    def test_csv_export_is_refused_without_the_capability(self, ai_settings, person, client_for):
        assert client_for(person).get(reverse("ai-executive-summary-csv")).status_code == 403

    def test_csv_export_downloads(self, ai_settings, db, project, client_for):
        boss = User.objects.create_user(
            username="ceo", email="ceo@kos.local", password="x", is_superuser=True
        )
        briefings.generate_executive_summary(ReportPeriod.DAILY, config=ai_settings, deliver_it=False)

        response = client_for(boss).get(reverse("ai-executive-summary-csv"), {"period": "daily"})

        assert response.status_code == 200
        assert response["Content-Type"] == "text/csv"
        assert b"Health score" in response.content

    def test_email_endpoint_sends_and_audits(self, ai_settings, db, project, client_for):
        from django.core import mail

        from apps.audit.models import AuditLog

        boss = User.objects.create_user(
            username="coo", email="coo@kos.local", password="x", is_superuser=True
        )
        briefings.generate_executive_summary(ReportPeriod.DAILY, config=ai_settings, deliver_it=False)
        mail.outbox.clear()

        response = client_for(boss).post(
            reverse("ai-executive-summary-email"), {"period": "daily"}, format="json"
        )

        assert response.status_code == 200
        assert response.data["emailed"] >= 1
        assert len(mail.outbox) >= 1
        assert AuditLog.objects.filter(reason="Executive summary emailed manually").exists()


# --------------------------------------------------------------------------- #
# Backward compatibility
# --------------------------------------------------------------------------- #
class TestNothingElseChanged:
    def test_the_existing_scans_still_run(self, ai_settings, person, project):
        """The new features must not disturb the automations that predate them."""
        from apps.ai.tasks import run_all_ai_scans

        make_task(project, person, due_date=timezone.localdate() - timedelta(days=2))
        result = run_all_ai_scans()

        assert set(result) == {"overdue", "blocked", "milestones", "health"}
        assert "skipped" not in result["overdue"]

    def test_the_existing_daily_summary_report_is_untouched(self, ai_settings, person, project):
        from apps.ai.models import AIReport
        from apps.ai.tasks import generate_daily_summaries

        make_task(project, person, due_date=timezone.localdate())
        generate_daily_summaries()

        # Still writes an AIReport, not a DailyStandup — two separate features.
        assert AIReport.objects.filter(user=person, period="daily").exists()

    def test_settings_endpoint_still_serialises_every_original_field(self, ai_settings, db, client_for):
        boss = User.objects.create_user(
            username="root", email="root@kos.local", password="x", is_superuser=True
        )
        response = client_for(boss).get(reverse("ai-settings"))

        assert response.status_code == 200
        for field in ("provider", "temperature", "overdue_scan_enabled", "daily_summary_enabled",
                      "weekly_report_enabled", "monthly_report_enabled", "escalate_hours"):
            assert field in response.data
        # …plus the new ones.
        assert response.data["standup_hour"] == 9
