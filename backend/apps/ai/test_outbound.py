"""Tests for sending real email out of KOS, and for the critical-stage alert.

Every test runs against Django's locmem email backend — the suite must never
open an SMTP connection. What is being tested is our own logic: address
handling, the guard rails, the Bcc contract, access control on the send
endpoint, and the fact that a critical alert fires on the *transition* only.
"""
from __future__ import annotations

from datetime import timedelta

import pytest
from django.core import mail
from django.utils import timezone

from apps.ai import critical, outbound
from apps.ai.models import (
    AIAutomationLog,
    AISettings,
    AutomationEvent,
    EmailStatus,
    OutboundEmail,
)
from apps.ai.outbound import EmailRejected
from apps.projects.models import Project, ProjectStatus
from apps.tasks.models import Task


@pytest.fixture(autouse=True)
def locmem_email(settings):
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    settings.DEFAULT_FROM_EMAIL = "KOS <no-reply@kos.local>"
    settings.FRONTEND_BASE_URL = "https://kos.example.com"
    mail.outbox.clear()


@pytest.fixture(autouse=True)
def no_real_api_keys(settings):
    settings.AI_API_KEYS = {"grok": "", "openai": ""}


@pytest.fixture
def ai_settings(db) -> AISettings:
    config = AISettings.load()
    config.provider = "mock"
    config.save()
    return config


@pytest.fixture
def project(db, admin_user) -> Project:
    return Project.objects.create(
        name="Effluent Upgrade", code="EFF-2", owner=admin_user, manager=admin_user,
        status=ProjectStatus.ACTIVE,
    )


@pytest.fixture
def eager_worker(monkeypatch):
    """Run a queued alert in-process, as a worker picking it off the queue would.

    Patching ``apply_async`` rather than setting ``task_always_eager``: the
    Celery app reads that flag when it is configured at import time, so
    flipping it mid-test has no effect on an already-built app.
    """
    from apps.ai.tasks import alert_critical_task

    monkeypatch.setattr(
        alert_critical_task, "apply_async",
        lambda args=(), kwargs=None, **opts: alert_critical_task(*args, **(kwargs or {})),
    )
    return alert_critical_task


@pytest.fixture
def task(db, project, admin_user) -> Task:
    task = Task.objects.create(
        title="Renew the discharge consent", project=project, priority="medium", status="in_progress"
    )
    task.owners.add(admin_user)
    task.primary_owner = admin_user
    task.save(update_fields=["primary_owner"])
    return task


# --------------------------------------------------------------------------- #
# Address handling
# --------------------------------------------------------------------------- #
class TestAddressParsing:
    def test_accepts_plain_and_named_addresses(self):
        assert outbound.clean_address("a@example.com") == "a@example.com"
        assert outbound.clean_address("Priya Nair <p@example.com>") == "Priya Nair <p@example.com>"

    def test_rejects_a_malformed_address(self):
        with pytest.raises(EmailRejected):
            outbound.clean_address("not-an-address")

    def test_parses_a_pasted_string_as_well_as_a_list(self):
        """People paste from other mail clients; punctuation must not be fatal."""
        parsed = outbound.parse_addresses("a@example.com, b@example.com; c@example.com")
        assert parsed == ["a@example.com", "b@example.com", "c@example.com"]

    def test_drops_duplicates_case_insensitively(self):
        assert outbound.parse_addresses(["A@Example.com", "a@example.com"]) == ["A@Example.com"]

    def test_strips_header_injection_from_an_address(self):
        with pytest.raises(EmailRejected):
            outbound.clean_address("victim@example.com\nBcc: attacker@evil.com")


# --------------------------------------------------------------------------- #
# Preparing and sending
# --------------------------------------------------------------------------- #
class TestPrepareAndSend:
    def test_sends_with_cc_and_bcc(self, ai_settings, admin_user):
        email = outbound.send_now(
            to=["client@example.com"],
            cc=["manager@example.com"],
            bcc=["archive@example.com"],
            subject="Consent renewal",
            body="The renewal is submitted.",
            sender=admin_user,
        )
        assert email.status == EmailStatus.SENT
        assert len(mail.outbox) == 1

        message = mail.outbox[0]
        assert message.to == ["client@example.com"]
        assert message.cc == ["manager@example.com"]
        assert message.bcc == ["archive@example.com"]
        # Every recipient is on the envelope, but only To and Cc are visible.
        assert "archive@example.com" not in message.message().as_string()

    def test_reply_to_is_the_sender_not_the_service_mailbox(self, ai_settings, admin_user):
        admin_user.email = "priya@example.com"
        admin_user.save(update_fields=["email"])
        outbound.send_now(
            to=["client@example.com"], subject="Hello", body="Body", sender=admin_user
        )
        assert "priya@example.com" in mail.outbox[0].reply_to[0]

    def test_a_subject_cannot_inject_headers(self, ai_settings, admin_user):
        email = outbound.prepare(
            to=["client@example.com"],
            subject="Update\nBcc: attacker@evil.com",
            body="Body",
            sender=admin_user,
        )
        assert "\n" not in email.subject
        assert "attacker@evil.com" not in email.bcc

    def test_bcc_drops_anyone_already_visible(self, ai_settings, admin_user):
        """A duplicate arriving via Bcc reads as a leak, so it is removed."""
        email = outbound.prepare(
            to=["client@example.com"], cc=["manager@example.com"],
            bcc=["client@example.com", "archive@example.com"],
            subject="Update", body="Body", sender=admin_user,
        )
        assert email.bcc == ["archive@example.com"]

    def test_rejects_a_message_with_no_recipients(self, ai_settings, admin_user):
        with pytest.raises(EmailRejected):
            outbound.prepare(to=[], subject="Update", body="Body", sender=admin_user)

    def test_rejects_more_recipients_than_the_configured_cap(self, ai_settings, admin_user):
        ai_settings.outbound_max_recipients = 2
        ai_settings.save()
        with pytest.raises(EmailRejected, match="exceeds the limit"):
            outbound.prepare(
                to=["a@example.com", "b@example.com"], bcc=["c@example.com"],
                subject="Update", body="Body", sender=admin_user, config=ai_settings,
            )

    def test_respects_the_outbound_kill_switch(self, ai_settings, admin_user):
        ai_settings.outbound_email_enabled = False
        ai_settings.save()
        with pytest.raises(EmailRejected, match="switched off"):
            outbound.prepare(
                to=["a@example.com"], subject="Update", body="Body",
                sender=admin_user, config=ai_settings,
            )

    def test_enforces_the_per_user_hourly_limit(self, ai_settings, admin_user):
        ai_settings.outbound_hourly_limit_per_user = 1
        ai_settings.save()
        outbound.prepare(to=["a@example.com"], subject="One", body="Body", sender=admin_user)
        with pytest.raises(EmailRejected, match="limit of 1 emails"):
            outbound.prepare(to=["b@example.com"], subject="Two", body="Body", sender=admin_user)

    def test_a_transport_failure_is_recorded_not_raised(self, ai_settings, admin_user, settings):
        """A dead SMTP host must produce a failed row, never an exception."""
        settings.EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
        settings.EMAIL_HOST = "127.0.0.1"
        settings.EMAIL_PORT = 1  # nothing listens here
        settings.EMAIL_TIMEOUT = 1

        email = outbound.prepare(
            to=["a@example.com"], subject="Update", body="Body", sender=admin_user
        )
        assert outbound.send(email) is False
        email.refresh_from_db()
        assert email.status == EmailStatus.FAILED
        assert email.error
        assert email.attempts == 1

    def test_the_body_is_escaped_in_the_html_alternative(self, ai_settings, admin_user):
        outbound.send_now(
            to=["a@example.com"], subject="Update",
            body="<script>alert(1)</script>", sender=admin_user,
        )
        html = mail.outbox[0].alternatives[0][0]
        assert "<script>" not in html
        assert "&lt;script&gt;" in html


# --------------------------------------------------------------------------- #
# The send endpoint
# --------------------------------------------------------------------------- #
@pytest.mark.django_db
class TestSendEndpoint:
    URL = "/api/ai/send-email/"

    def test_requires_authentication(self, api_client):
        response = api_client.post(
            self.URL, {"to": ["a@example.com"], "subject": "x", "body": "y"}, format="json"
        )
        assert response.status_code in (401, 403)

    def test_sends_and_records_the_message(self, ai_settings, auth_client, admin_user, task):
        response = auth_client.post(
            self.URL,
            {
                "to": ["client@example.com"],
                "cc": ["manager@example.com"],
                "bcc": ["archive@example.com"],
                "subject": "Consent renewal",
                "body": "The renewal is submitted.",
                "task_id": task.id,
            },
            format="json",
        )
        assert response.status_code in (201, 202)
        body = response.json()
        assert body["status"] == "sent"
        assert body["bcc"] == ["archive@example.com"]
        assert len(mail.outbox) == 1

        stored = OutboundEmail.objects.get(pk=body["id"])
        assert stored.sender == admin_user
        assert stored.task_id == task.id
        # Linking a task links its project, so the mail shows in project history.
        assert stored.project_id == task.project_id

    def test_a_bad_address_is_a_400_with_the_reason(self, ai_settings, auth_client):
        response = auth_client.post(
            self.URL, {"to": ["nonsense"], "subject": "x", "body": "y"},
            format="json",
        )
        assert response.status_code == 400
        assert not mail.outbox

    def test_an_empty_subject_is_rejected_before_sending(self, ai_settings, auth_client):
        response = auth_client.post(
            self.URL, {"to": ["a@example.com"], "subject": "   ", "body": "y"},
            format="json",
        )
        assert response.status_code == 400
        assert not mail.outbox

    def test_cannot_attach_a_task_the_user_may_not_see(self, ai_settings, django_user_model, task):
        """Attaching an invisible task must 404 — a 200 would confirm it exists."""
        from rest_framework.test import APIClient

        outsider = django_user_model.objects.create_user(
            username="outsider", password="pw", email="outsider@example.com"
        )
        client = APIClient()
        client.force_authenticate(outsider)
        response = client.post(
            self.URL,
            {"to": ["a@example.com"], "subject": "x", "body": "y", "task_id": task.id},
            format="json",
        )
        assert response.status_code in (403, 404)
        assert not mail.outbox

    def test_sent_mail_is_listed_back_to_its_sender(self, ai_settings, auth_client):
        auth_client.post(
            self.URL, {"to": ["a@example.com"], "subject": "Hello", "body": "Body"},
            format="json",
        )
        listing = auth_client.get("/api/ai/emails/")
        assert listing.status_code == 200
        results = listing.json()
        results = results["results"] if isinstance(results, dict) else results
        assert any(row["subject"] == "Hello" for row in results)


# --------------------------------------------------------------------------- #
# Critical-stage detection
# --------------------------------------------------------------------------- #
class TestCriticalDetection:
    def test_raising_priority_to_critical_is_a_transition(self, task):
        assert critical.detect_transition(
            _with(task, priority="critical"), old_priority="medium"
        ) == "was raised to critical priority"

    def test_a_task_already_critical_does_not_re_trigger(self, task):
        assert critical.detect_transition(
            _with(task, priority="critical"), old_priority="critical", old_status=task.status
        ) is None

    def test_blocking_high_priority_work_is_a_transition(self, task):
        reason = critical.detect_transition(
            _with(task, priority="high", status="blocked"),
            old_priority="high", old_status="in_progress",
        )
        assert reason and "blocked" in reason

    def test_blocking_low_priority_work_is_not(self, task):
        assert critical.detect_transition(
            _with(task, priority="low", status="blocked"),
            old_priority="low", old_status="in_progress",
        ) is None

    def test_a_completed_task_never_counts_as_critical(self, task):
        assert critical.detect_transition(
            _with(task, priority="critical", status="completed"), old_priority="medium"
        ) is None

    def test_a_critical_risk_flag_is_a_transition(self, task):
        assert critical.detect_transition(
            _with(task, risk_level="critical"), old_risk=""
        ) == "was flagged as a critical risk"


def _with(task, **changes):
    for field, value in changes.items():
        setattr(task, field, value)
    return task


# --------------------------------------------------------------------------- #
# Critical-stage alerting
# --------------------------------------------------------------------------- #
@pytest.mark.django_db
class TestCriticalAlert:
    def test_alerts_owners_and_bccs_the_watch_list(self, ai_settings, task, admin_user):
        admin_user.email = "owner@example.com"
        admin_user.save(update_fields=["email"])
        ai_settings.critical_alert_bcc = "ops@example.com, compliance@example.com"
        ai_settings.save()

        result = critical.alert(task, "was raised to critical priority", use_ai=False)

        assert result["sent"] is True
        assert len(mail.outbox) == 1
        message = mail.outbox[0]
        assert "owner@example.com" in message.to
        assert set(message.bcc) == {"ops@example.com", "compliance@example.com"}

    def test_the_alert_is_logged_for_audit(self, ai_settings, task, admin_user):
        admin_user.email = "owner@example.com"
        admin_user.save(update_fields=["email"])
        critical.alert(task, "was raised to critical priority", use_ai=False)

        log = AIAutomationLog.objects.filter(event=AutomationEvent.CRITICAL_TASK, task=task).first()
        assert log is not None and log.ok

    def test_the_cooldown_stops_a_second_alert(self, ai_settings, task, admin_user):
        admin_user.email = "owner@example.com"
        admin_user.save(update_fields=["email"])
        critical.alert(task, "was raised to critical priority", use_ai=False)
        second = critical.alert(task, "was raised to critical priority", use_ai=False)

        assert second == {"skipped": "cooldown"}
        assert len(mail.outbox) == 1

    def test_the_cooldown_expires(self, ai_settings, task, admin_user):
        admin_user.email = "owner@example.com"
        admin_user.save(update_fields=["email"])
        critical.alert(task, "was raised to critical priority", use_ai=False)

        stale = timezone.now() - timedelta(hours=ai_settings.critical_alert_cooldown_hours + 1)
        AIAutomationLog.objects.filter(event=AutomationEvent.CRITICAL_TASK).update(created_at=stale)

        critical.alert(task, "was raised to critical priority", use_ai=False)
        assert len(mail.outbox) == 2

    def test_the_kill_switch_is_honoured(self, ai_settings, task, admin_user):
        admin_user.email = "owner@example.com"
        admin_user.save(update_fields=["email"])
        ai_settings.critical_alert_enabled = False
        ai_settings.save()

        assert critical.alert(task, "reason", use_ai=False) == {"skipped": "disabled"}
        assert not mail.outbox

    def test_no_addresses_is_logged_rather_than_silently_dropped(self, ai_settings, task, admin_user):
        """Silence would look identical to the alert having worked."""
        admin_user.email = ""
        admin_user.save(update_fields=["email"])

        result = critical.alert(task, "was raised to critical priority", use_ai=False)

        assert result == {"skipped": "no recipients"}
        log = AIAutomationLog.objects.filter(event=AutomationEvent.CRITICAL_TASK, task=task).first()
        assert log is not None and not log.ok

    def test_saving_a_task_critical_sends_the_alert(
        self, ai_settings, task, admin_user, eager_worker, django_capture_on_commit_callbacks
    ):
        """The end-to-end path: a save crosses the line and mail goes out.

        Exercises the signal, the queued Celery task and the mailer together.
        The alert is dispatched from ``transaction.on_commit`` — which never
        runs inside a test's rolled-back transaction — so the commit hooks are
        captured and executed explicitly.
        """
        admin_user.email = "owner@example.com"
        admin_user.save(update_fields=["email"])

        with django_capture_on_commit_callbacks(execute=True):
            task.priority = "critical"
            task.save()

        assert len(mail.outbox) == 1
        assert "owner@example.com" in mail.outbox[0].to

    def test_an_unrelated_edit_sends_nothing(
        self, ai_settings, task, admin_user, eager_worker, django_capture_on_commit_callbacks
    ):
        admin_user.email = "owner@example.com"
        admin_user.save(update_fields=["email"])

        with django_capture_on_commit_callbacks(execute=True):
            task.description = "Some new detail."
            task.save()

        assert not mail.outbox

    def test_the_alert_still_goes_out_with_no_broker(
        self, ai_settings, task, admin_user, monkeypatch, django_capture_on_commit_callbacks
    ):
        """A dead queue must downgrade the copy, not cancel the alert.

        The inline fallback skips the provider call deliberately — it runs
        inside the request that saved the task — so the email is templated
        rather than AI-written, but it is still sent.
        """
        from apps.ai.tasks import alert_critical_task

        admin_user.email = "owner@example.com"
        admin_user.save(update_fields=["email"])
        monkeypatch.setattr(
            alert_critical_task, "apply_async",
            lambda *a, **kw: (_ for _ in ()).throw(OSError("no broker")),
        )

        with django_capture_on_commit_callbacks(execute=True):
            task.priority = "critical"
            task.save()

        assert len(mail.outbox) == 1
