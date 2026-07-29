"""Tests for the AI module.

Every test runs against the offline provider — the suite must never make a
network call, and must never need an API key. What is being tested is *our*
logic: the provider abstraction, the JSON contract, access control, the
escalation ladder's idempotency, and the fact that an AI outage degrades
instead of breaking.
"""
from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.ai import service
from apps.ai.models import (
    AIAutomationLog,
    AIRequestLog,
    AISettings,
    EscalationStage,
    TaskEscalation,
)
from apps.ai.providers import PROVIDERS, get_provider, parse_json_object
from apps.ai.providers.base import AIProvider, AIProviderError
from apps.ai.providers.grok import GrokProvider
from apps.ai.providers.mock import MockProvider
from apps.ai.providers.openai import OpenAIProvider
from apps.ai.service import AIUnavailable
from apps.projects.models import Membership, Project, ProjectStatus
from apps.tasks.models import Task


@pytest.fixture(autouse=True)
def no_real_api_keys(settings):
    """Blank every provider key for the whole module.

    Without this, a developer with a real ``GROK_API_KEY`` in their environment
    would have the suite make live, billable calls. Tests that need a key present
    set it explicitly; everything else falls back to the offline provider.
    """
    settings.AI_API_KEYS = {"grok": "", "openai": ""}


@pytest.fixture
def ai_settings(db) -> AISettings:
    """Offline provider so no test ever reaches the network."""
    config = AISettings.load()
    config.provider = "mock"
    config.save()
    return config


@pytest.fixture
def project(db, admin_user) -> Project:
    return Project.objects.create(
        name="Effluent Upgrade", code="EFF-1", owner=admin_user, status=ProjectStatus.ACTIVE
    )


@pytest.fixture
def overdue_task(db, project, admin_user) -> Task:
    task = Task.objects.create(
        title="Submit consent renewal",
        project=project,
        due_date=timezone.localdate() - timedelta(days=3),
        primary_owner=admin_user,
        created_by=admin_user,
    )
    task.owners.add(admin_user)
    return task


# --------------------------------------------------------------------------- #
# Provider abstraction
# --------------------------------------------------------------------------- #
class TestProviderAbstraction:
    def test_every_provider_implements_the_erp_interface(self):
        """The seven mandated operations must exist on every provider, so no
        ERP module can ever be written against a vendor-specific method."""
        required = [
            "summarize", "chat", "generate_email", "analyse_tasks",
            "analyse_project", "generate_notifications", "create_tasks_from_notes",
        ]
        for provider_class in PROVIDERS.values():
            for method in required:
                assert callable(getattr(provider_class, method, None)), (
                    f"{provider_class.__name__} is missing {method}()"
                )

    def test_grok_and_openai_differ_only_in_configuration(self):
        """The swap the specification demands: same behaviour, different endpoint."""
        assert GrokProvider.default_base_url != OpenAIProvider.default_base_url
        for method in ("summarize", "analyse_project", "create_tasks_from_notes"):
            assert getattr(GrokProvider, method) is getattr(AIProvider, method)
            assert getattr(OpenAIProvider, method) is getattr(AIProvider, method)

    def test_missing_key_falls_back_to_offline_provider(self, db, settings):
        """A missing key must degrade the feature, not break every request."""
        settings.AI_API_KEYS = {"grok": "", "openai": ""}
        config = AISettings.load()
        config.provider = "grok"
        config.save()
        assert isinstance(get_provider(config), MockProvider)

    def test_configured_key_builds_the_real_provider(self, db, settings):
        settings.AI_API_KEYS = {"grok": "test-key", "openai": ""}
        config = AISettings.load()
        config.provider = "grok"
        config.save()
        provider = get_provider(config)
        assert isinstance(provider, GrokProvider)
        assert provider.api_key == "test-key"

    def test_provider_without_key_refuses_to_call(self):
        with pytest.raises(AIProviderError):
            GrokProvider(api_key="")._complete([], temperature=0.3, max_tokens=100, json_mode=False)


class TestJSONRecovery:
    """Models wrap JSON in prose and fences; the parser has to cope."""

    def test_plain_object(self):
        assert parse_json_object('{"a": 1}') == {"a": 1}

    def test_fenced_block(self):
        assert parse_json_object('```json\n{"a": 1}\n```') == {"a": 1}

    def test_object_embedded_in_prose(self):
        assert parse_json_object('Sure! Here you go:\n{"a": 1}\nHope that helps.') == {"a": 1}

    def test_bare_list_is_wrapped(self):
        assert parse_json_object("[1, 2]") == {"items": [1, 2]}

    def test_unparseable_returns_none(self):
        assert parse_json_object("no json here at all") is None


class TestOfflineProvider:
    """The offline provider must satisfy the requested schema, so that every
    screen can be exercised end to end without a key."""

    def test_response_matches_the_requested_shape(self, ai_settings):
        result = MockProvider().analyse_project("Project: Test\nMetrics: overdue_tasks=2")
        assert result.structured
        assert set(result.data) >= {"summary", "health_score", "health_label", "risk_level", "risks"}
        assert isinstance(result.data["risks"], list)

    def test_choice_fields_use_an_allowed_value(self, ai_settings):
        result = MockProvider().analyse_project("Project: Test")
        assert result.data["health_label"] in {"on_track", "at_risk", "off_track"}
        assert result.data["risk_level"] in {"low", "medium", "high", "critical"}


# --------------------------------------------------------------------------- #
# Service layer
# --------------------------------------------------------------------------- #
class TestServiceLayer:
    def test_every_call_is_logged(self, ai_settings, admin_user):
        service.summarize("Some project notes.", user=admin_user)
        log = AIRequestLog.objects.get()
        assert log.ok and log.provider == "mock" and log.action == "summarize"

    def test_disabled_ai_raises_and_makes_no_call(self, ai_settings, admin_user):
        ai_settings.is_enabled = False
        ai_settings.save()
        with pytest.raises(AIUnavailable):
            service.summarize("text", user=admin_user)
        assert not AIRequestLog.objects.exists()

    def test_rate_limit_blocks_further_calls(self, ai_settings, admin_user):
        ai_settings.max_calls_per_hour = 1
        ai_settings.save()
        service.summarize("first", user=admin_user)
        with pytest.raises(AIUnavailable) as exc:
            service.summarize("second", user=admin_user)
        assert "limit" in str(exc.value).lower()

    def test_provider_failure_is_logged_and_wrapped(self, ai_settings, admin_user, monkeypatch):
        def explode(*args, **kwargs):
            raise AIProviderError("upstream is down", status=503, retryable=True)

        monkeypatch.setattr(MockProvider, "_complete", explode)
        with pytest.raises(AIUnavailable):
            service.summarize("text", user=admin_user)

        log = AIRequestLog.objects.get()
        assert not log.ok and "upstream is down" in log.error

    def test_project_analysis_is_grounded_in_real_data(self, ai_settings, project, admin_user):
        Task.objects.create(
            title="Overdue thing", project=project,
            due_date=timezone.localdate() - timedelta(days=5),
        )
        outcome = service.analyse_project(project, user=admin_user)
        assert outcome.structured
        log = AIRequestLog.objects.get()
        # The prompt must actually carry the project's data, not just its name.
        assert log.prompt_chars > 100
        assert log.subject_type == "Project"


# --------------------------------------------------------------------------- #
# API access control
# --------------------------------------------------------------------------- #
@pytest.mark.django_db
class TestAPIAccessControl:
    def test_requires_authentication(self, api_client):
        assert api_client.post("/api/ai/summarize/", {"text": "hello"}).status_code == 401

    def test_rejects_empty_input_before_calling_the_provider(self, auth_client, ai_settings):
        assert auth_client.post("/api/ai/summarize/", {"text": ""}).status_code == 400
        assert not AIRequestLog.objects.exists()

    def test_summarize_returns_the_standard_envelope(self, auth_client, ai_settings):
        response = auth_client.post("/api/ai/summarize/", {"text": "Notes from the site visit."})
        assert response.status_code == 200
        body = response.json()
        assert body["ok"] and body["structured"]
        assert set(body) >= {"action", "data", "text", "provider", "model", "log_id"}

    def test_cannot_analyse_a_project_you_cannot_see(self, api_client, ai_settings, project, member_user):
        api_client.force_authenticate(member_user)
        response = api_client.post(f"/api/ai/projects/{project.id}/summary/")
        assert response.status_code == 404, "AI must not widen project visibility"

    def test_member_can_analyse_their_own_project(self, api_client, ai_settings, project, member_user):
        Membership.objects.create(user=member_user, project=project)
        api_client.force_authenticate(member_user)
        assert api_client.post(f"/api/ai/projects/{project.id}/summary/").status_code == 200

    def test_ai_outage_is_a_503_not_a_500(self, auth_client, ai_settings, monkeypatch):
        def explode(*args, **kwargs):
            raise AIProviderError("provider unreachable")

        monkeypatch.setattr(MockProvider, "_complete", explode)
        response = auth_client.post("/api/ai/summarize/", {"text": "hello"})
        assert response.status_code == 503
        assert response.json()["ok"] is False

    def test_settings_are_admin_only(self, api_client, ai_settings, member_user):
        api_client.force_authenticate(member_user)
        assert api_client.get("/api/ai/settings/").status_code == 403

    def test_settings_never_expose_an_api_key(self, auth_client, ai_settings, settings):
        settings.AI_API_KEYS = {"grok": "super-secret", "openai": ""}
        body = auth_client.get("/api/ai/settings/").json()
        assert "super-secret" not in str(body)
        assert body["status"]["key_configured"] is False  # provider is 'mock' here

    def test_settings_round_trip(self, auth_client, ai_settings):
        """The settings screen sends the whole object back; it must persist."""
        response = auth_client.put(
            "/api/ai/settings/",
            {"provider": "openai", "temperature": 0.7, "reminder_repeat_minutes": 45,
             "manager_notify_hours": 3, "escalate_hours": 12, "weekly_report_enabled": False},
            format="json",
        )
        assert response.status_code == 200, response.content[:300]

        config = AISettings.load()
        assert config.provider == "openai"
        assert config.temperature == 0.7
        assert config.reminder_repeat_minutes == 45
        assert config.weekly_report_enabled is False
        # Still exactly one row — the singleton must not have been duplicated.
        assert AISettings.objects.count() == 1

    def test_escalation_ladder_ordering_is_validated(self, auth_client, ai_settings):
        response = auth_client.put(
            "/api/ai/settings/", {"reminder_repeat_minutes": 30, "manager_notify_hours": 48, "escalate_hours": 2}
        )
        assert response.status_code == 400


@pytest.mark.django_db
class TestTaskWrites:
    """Generation is a preview; only the explicit apply endpoints mutate data."""

    def test_generating_subtasks_creates_nothing(self, auth_client, ai_settings, overdue_task):
        auth_client.post(f"/api/ai/tasks/{overdue_task.id}/subtasks/", {"count": 3})
        assert overdue_task.subtasks.count() == 0

    def test_applying_subtasks_writes_them(self, auth_client, ai_settings, overdue_task):
        response = auth_client.post(
            f"/api/ai/tasks/{overdue_task.id}/apply-subtasks/",
            {"subtasks": ["Draft the form", "Collect signatures"]},
            format="json",
        )
        assert response.status_code == 201
        assert list(overdue_task.subtasks.values_list("title", flat=True)) == [
            "Draft the form", "Collect signatures"
        ]

    def test_creating_tasks_from_notes_respects_project_access(
        self, api_client, ai_settings, project, member_user
    ):
        api_client.force_authenticate(member_user)
        response = api_client.post(
            "/api/ai/notes/create-tasks/",
            {"project_id": project.id, "tasks": [{"title": "Sneaky task"}]},
            format="json",
        )
        assert response.status_code == 404
        assert not Task.objects.filter(title="Sneaky task").exists()

    def test_owner_hint_only_matches_real_members(self, auth_client, ai_settings, project, admin_user):
        Membership.objects.create(user=admin_user, project=project)
        response = auth_client.post(
            "/api/ai/notes/create-tasks/",
            {"project_id": project.id, "tasks": [
                {"title": "Real owner", "owner_hint": admin_user.username},
                {"title": "Invented owner", "owner_hint": "Someone Who Does Not Exist"},
            ]},
            format="json",
        )
        assert response.status_code == 201
        assert Task.objects.get(title="Real owner").primary_owner == admin_user
        assert Task.objects.get(title="Invented owner").primary_owner is None


# --------------------------------------------------------------------------- #
# Automation
# --------------------------------------------------------------------------- #
@pytest.mark.django_db
class TestEscalationLadder:
    """The five-minute scan sees the same task 288 times a day. It must not
    send 288 emails."""

    def test_first_scan_reminds_the_owner(self, ai_settings, overdue_task):
        from apps.ai.tasks import scan_overdue_tasks

        result = scan_overdue_tasks()
        assert result["delivered"] == 1
        escalation = TaskEscalation.objects.get(task=overdue_task)
        assert escalation.stage == EscalationStage.REMINDED
        assert AIAutomationLog.objects.filter(event="overdue_reminder").exists()

    def test_immediate_rescan_does_nothing(self, ai_settings, overdue_task):
        from apps.ai.tasks import scan_overdue_tasks

        scan_overdue_tasks()
        before = AIAutomationLog.objects.count()
        assert scan_overdue_tasks()["delivered"] == 0
        assert AIAutomationLog.objects.count() == before

    def test_ladder_climbs_on_schedule(self, ai_settings, overdue_task):
        from apps.ai.tasks import scan_overdue_tasks

        scan_overdue_tasks()
        escalation = TaskEscalation.objects.get(task=overdue_task)

        # Wind the clock back past the repeat interval.
        past = timezone.now() - timedelta(minutes=ai_settings.reminder_repeat_minutes + 1)
        TaskEscalation.objects.filter(pk=escalation.pk).update(last_reminder_at=past, first_detected_at=past)
        scan_overdue_tasks()
        assert TaskEscalation.objects.get(pk=escalation.pk).stage == EscalationStage.REPEATED

        # Past the manager threshold.
        past = timezone.now() - timedelta(hours=ai_settings.manager_notify_hours + 1)
        TaskEscalation.objects.filter(pk=escalation.pk).update(first_detected_at=past, last_reminder_at=past)
        scan_overdue_tasks()
        escalation.refresh_from_db()
        assert escalation.stage == EscalationStage.MANAGER
        assert escalation.manager_notified_at is not None

        # Past the escalation threshold.
        past = timezone.now() - timedelta(hours=ai_settings.escalate_hours + 1)
        TaskEscalation.objects.filter(pk=escalation.pk).update(first_detected_at=past, last_reminder_at=past)
        scan_overdue_tasks()
        escalation.refresh_from_db()
        assert escalation.stage == EscalationStage.ESCALATED
        assert escalation.escalated_at is not None

        # Terminal: further scans add nothing.
        assert scan_overdue_tasks()["delivered"] == 0

    def test_completing_a_task_clears_its_escalation(self, ai_settings, overdue_task):
        from apps.ai.tasks import scan_overdue_tasks

        scan_overdue_tasks()
        overdue_task.status = "completed"
        overdue_task.save()

        scan_overdue_tasks()
        escalation = TaskEscalation.objects.get(task=overdue_task)
        assert escalation.resolved_at is not None
        assert escalation.stage == EscalationStage.NONE

    def test_reminders_still_go_out_when_ai_is_down(self, ai_settings, overdue_task, monkeypatch):
        """The most important failure mode: AI outage must not stop reminders."""
        def explode(*args, **kwargs):
            raise AIProviderError("provider unreachable")

        monkeypatch.setattr(MockProvider, "_complete", explode)

        from apps.ai.tasks import scan_overdue_tasks

        assert scan_overdue_tasks()["delivered"] == 1
        log = AIAutomationLog.objects.get(event="overdue_reminder")
        assert log.ok
        assert any(a.startswith("notified:") for a in log.executed_actions)
        # Fallback copy, not the AI's — but real copy nonetheless.
        assert overdue_task.title in log.ai_response["title"]

    def test_disabled_automation_scans_nothing(self, ai_settings, overdue_task):
        from apps.ai.tasks import scan_overdue_tasks

        ai_settings.automation_enabled = False
        ai_settings.save()
        assert scan_overdue_tasks() == {"skipped": "disabled"}


@pytest.mark.django_db
class TestAutomationLogging:
    def test_automation_log_records_what_was_executed(self, ai_settings, overdue_task):
        from apps.ai.tasks import scan_overdue_tasks

        scan_overdue_tasks()
        log = AIAutomationLog.objects.get()
        assert log.task == overdue_task
        assert log.project == overdue_task.project
        assert log.executed_actions
        assert log.ai_response

    def test_non_admin_only_sees_automation_for_visible_projects(
        self, api_client, ai_settings, overdue_task, member_user
    ):
        from apps.ai.tasks import scan_overdue_tasks

        scan_overdue_tasks()
        api_client.force_authenticate(member_user)
        response = api_client.get("/api/ai/automation-logs/")
        assert response.status_code == 200
        assert response.json()["count"] == 0


@pytest.mark.django_db
class TestSettingsSingleton:
    def test_load_is_idempotent(self, db):
        first, second = AISettings.load(), AISettings.load()
        assert first.pk == second.pk == AISettings.SINGLETON_PK
        assert AISettings.objects.count() == 1

    def test_saving_cannot_create_a_second_row(self, db):
        config = AISettings.load()
        config.pk = None
        config.save()
        assert AISettings.objects.count() == 1

    def test_status_reports_the_offline_fallback_honestly(self, db, settings):
        settings.AI_API_KEYS = {"grok": "", "openai": ""}
        config = AISettings.load()
        config.provider = "grok"
        config.save()
        status = service.provider_status()
        assert status["configured_provider"] == "grok"
        assert status["active_provider"] == "mock"
        assert status["offline_fallback"] is True


@pytest.mark.django_db
class TestEndpointSmoke:
    """Every AI endpoint answers with the standard envelope.

    These are wiring tests: a typo in a URL, a serializer import or a view's
    context builder would otherwise only surface when a user clicked the button.
    """

    def test_status_endpoint(self, auth_client, ai_settings):
        body = auth_client.get("/api/ai/status/").json()
        assert body["active_provider"] == "mock"
        assert set(body) >= {"enabled", "configured_provider", "model", "key_configured"}

    def test_chat_creates_a_conversation(self, auth_client, ai_settings):
        response = auth_client.post(
            "/api/ai/chat/", {"message": "What is overdue?", "page_path": "/"}, format="json"
        )
        assert response.status_code == 200
        conversation_id = response.json()["conversation_id"]

        # A follow-up turn must attach to the same thread, not start a new one.
        again = auth_client.post(
            "/api/ai/chat/", {"message": "And this week?", "conversation_id": conversation_id},
            format="json",
        )
        assert again.json()["conversation_id"] == conversation_id
        assert auth_client.get(f"/api/ai/conversations/{conversation_id}/").json()["message_count"] == 4

    @pytest.mark.parametrize(
        ("url", "payload"),
        [
            ("/api/ai/rewrite/", {"text": "we need do the thing quick"}),
            ("/api/ai/grammar/", {"text": "this sentence have a error"}),
            ("/api/ai/translate/", {"text": "The report is ready.", "language": "Tamil"}),
            ("/api/ai/generate-email/", {"purpose": "Chase the overdue consent renewal"}),
            ("/api/ai/meetings/summarize/", {"notes": "Priya to file the renewal by Friday."}),
            ("/api/ai/notes/extract-tasks/", {"notes": "Priya to file the renewal by Friday."}),
            ("/api/ai/hr/job-description/", {"role_title": "Process Engineer"}),
            ("/api/ai/dashboard/insights/", {}),
            ("/api/ai/dashboard/explain/", {}),
        ],
    )
    def test_endpoint_returns_the_envelope(self, auth_client, ai_settings, url, payload):
        response = auth_client.post(url, payload, format="json")
        assert response.status_code == 200, f"{url} -> {response.status_code} {response.content[:200]}"
        body = response.json()
        assert body["ok"] and body["structured"]
        assert set(body) >= {"action", "data", "text", "provider", "model", "log_id"}

    def test_project_endpoints(self, auth_client, ai_settings, project):
        for suffix in ("summary", "explain", "risks", "delay", "health", "analyse",
                       "analyse-tasks", "duplicates"):
            response = auth_client.post(f"/api/ai/projects/{project.id}/{suffix}/", {}, format="json")
            assert response.status_code == 200, f"{suffix} -> {response.content[:200]}"

    def test_task_endpoints(self, auth_client, ai_settings, overdue_task):
        for suffix in ("summary", "subtasks", "estimate", "prioritize"):
            response = auth_client.post(f"/api/ai/tasks/{overdue_task.id}/{suffix}/", {}, format="json")
            assert response.status_code == 200, f"{suffix} -> {response.content[:200]}"

    def test_report_generation_persists_the_report(self, auth_client, ai_settings):
        from apps.ai.models import AIReport

        response = auth_client.post("/api/ai/reports/generate/", {"period": "weekly"}, format="json")
        assert response.status_code == 200
        assert AIReport.objects.filter(pk=response.json()["report_id"]).exists()

    def test_daily_recommendations_handles_an_empty_queue(self, auth_client, ai_settings):
        body = auth_client.post("/api/ai/dashboard/recommendations/", {}, format="json").json()
        assert body["ok"]

    def test_performance_summary_of_self_is_allowed(self, api_client, ai_settings, member_user):
        api_client.force_authenticate(member_user)
        response = api_client.post(
            "/api/ai/hr/performance-summary/", {"user_id": member_user.id}, format="json"
        )
        assert response.status_code == 200

    def test_performance_summary_of_others_needs_reports_capability(
        self, api_client, ai_settings, member_user, admin_user
    ):
        api_client.force_authenticate(member_user)
        response = api_client.post(
            "/api/ai/hr/performance-summary/", {"user_id": admin_user.id}, format="json"
        )
        assert response.status_code == 403
