"""Tests for the Gmail OAuth 2.0 email backend.

No network and no credentials: the authorised session is replaced with a stub
that records what would have been posted. What is being tested is our own
logic — credential selection, the message serialisation (particularly Bcc), and
that an API refusal surfaces rather than being swallowed.
"""
from __future__ import annotations

import base64
import email

import pytest
from django.core.mail import EmailMultiAlternatives

from apps.ai.gmail import (
    GMAIL_SEND_SCOPE,
    GmailAuthError,
    GmailOAuth2Backend,
    GmailSendError,
    as_gmail_payload,
    build_credentials,
)


def decode(payload: dict):
    """Turn a Gmail API body back into a parsed message, as Google would."""
    return email.message_from_bytes(base64.urlsafe_b64decode(payload["raw"]))


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {"id": "msg-1"}
        self.text = str(self._payload)

    def json(self):
        return self._payload


class FakeSession:
    """Stands in for ``google.auth.transport.requests.AuthorizedSession``."""

    def __init__(self, status_code=200, payload=None):
        self.posts: list[dict] = []
        self.closed = False
        self._status_code = status_code
        self._payload = payload

    def post(self, url, json=None, timeout=None):
        self.posts.append({"url": url, "json": json, "timeout": timeout})
        return FakeResponse(self._status_code, self._payload)

    def close(self):
        self.closed = True


@pytest.fixture
def backend(monkeypatch):
    """A backend whose session is a stub, so nothing reaches Google."""

    def make(status_code=200, payload=None, fail_silently=False):
        session = FakeSession(status_code, payload)
        instance = GmailOAuth2Backend(fail_silently=fail_silently)
        monkeypatch.setattr(instance, "open", lambda: (setattr(instance, "_session", session), True)[1])
        instance._session = session
        return instance, session

    return make


def message(**kwargs) -> EmailMultiAlternatives:
    defaults = {
        "subject": "Consent renewal",
        "body": "The renewal is submitted.",
        "from_email": "KOS <kos@example.com>",
        "to": ["client@example.com"],
    }
    return EmailMultiAlternatives(**{**defaults, **kwargs})


# --------------------------------------------------------------------------- #
# Serialisation
# --------------------------------------------------------------------------- #
class TestPayload:
    def test_carries_subject_and_recipients(self):
        parsed = decode(as_gmail_payload(message(cc=["manager@example.com"])))
        assert parsed["Subject"] == "Consent renewal"
        assert parsed["To"] == "client@example.com"
        assert parsed["Cc"] == "manager@example.com"

    def test_bcc_is_added_to_the_serialised_message(self):
        """The load-bearing one.

        Django omits Bcc from ``message()`` because for SMTP the blind copies
        travel in the envelope. The Gmail API has no envelope — it reads
        recipients off the message — so without re-adding the header every blind
        copy would silently never be delivered, with a 200 back from Google.
        """
        raw = message(bcc=["archive@example.com", "ops@example.com"])

        # Establish the premise the code exists to fix.
        assert raw.message()["Bcc"] is None

        parsed = decode(as_gmail_payload(raw))
        assert parsed["Bcc"] == "archive@example.com, ops@example.com"

    def test_no_bcc_header_when_there_are_no_blind_copies(self):
        assert decode(as_gmail_payload(message()))["Bcc"] is None

    def test_reply_to_survives(self):
        parsed = decode(as_gmail_payload(message(reply_to=["priya@example.com"])))
        assert parsed["Reply-To"] == "priya@example.com"

    def test_html_alternative_survives(self):
        raw = message()
        raw.attach_alternative("<p>Hello</p>", "text/html")
        parsed = decode(as_gmail_payload(raw))
        assert parsed.is_multipart()
        assert any(p.get_content_type() == "text/html" for p in parsed.walk())

    def test_the_raw_field_is_url_safe_base64(self):
        """Standard base64 would be rejected: '+' and '/' are not URL-safe."""
        payload = as_gmail_payload(message(to=["a@example.com"] * 1))
        assert "+" not in payload["raw"] and "/" not in payload["raw"]


# --------------------------------------------------------------------------- #
# Sending
# --------------------------------------------------------------------------- #
class TestSendMessages:
    def test_sends_and_counts(self, backend):
        instance, session = backend()
        assert instance.send_messages([message(), message()]) == 2
        assert len(session.posts) == 2
        assert session.posts[0]["url"].endswith("/messages/send")

    def test_sends_nothing_for_an_empty_batch(self, backend):
        instance, session = backend()
        assert instance.send_messages([]) == 0
        assert not session.posts

    def test_skips_a_message_with_no_recipients(self, backend):
        instance, session = backend()
        assert instance.send_messages([message(to=[])]) == 0
        assert not session.posts

    def test_an_api_refusal_raises_by_default(self, backend):
        instance, _ = backend(status_code=403, payload={"error": {"message": "Insufficient scope"}})
        with pytest.raises(GmailSendError, match="Insufficient scope"):
            instance.send_messages([message()])

    def test_fail_silently_downgrades_a_refusal(self, backend):
        instance, _ = backend(
            status_code=403, payload={"error": {"message": "nope"}}, fail_silently=True
        )
        assert instance.send_messages([message()]) == 0

    def test_close_releases_the_session(self, backend):
        instance, session = backend()
        instance.close()
        assert session.closed and instance._session is None


# --------------------------------------------------------------------------- #
# Credentials
# --------------------------------------------------------------------------- #
class TestCredentials:
    def test_refresh_token_credentials_are_send_only(self, settings):
        settings.GMAIL_SERVICE_ACCOUNT_FILE = ""
        settings.GMAIL_OAUTH_CLIENT_ID = "client-id"
        settings.GMAIL_OAUTH_CLIENT_SECRET = "client-secret"
        settings.GMAIL_OAUTH_REFRESH_TOKEN = "refresh-token"

        credentials = build_credentials()
        assert credentials.refresh_token == "refresh-token"
        # Send-only: this token must never be able to read the mailbox.
        assert credentials.scopes == [GMAIL_SEND_SCOPE]

    def test_missing_configuration_names_what_is_missing(self, settings):
        settings.GMAIL_SERVICE_ACCOUNT_FILE = ""
        settings.GMAIL_OAUTH_CLIENT_ID = "client-id"
        settings.GMAIL_OAUTH_CLIENT_SECRET = ""
        settings.GMAIL_OAUTH_REFRESH_TOKEN = ""

        with pytest.raises(GmailAuthError) as exc:
            build_credentials()
        assert "GMAIL_OAUTH_CLIENT_SECRET" in str(exc.value)
        assert "GMAIL_OAUTH_REFRESH_TOKEN" in str(exc.value)

    def test_a_service_account_without_a_user_to_impersonate_is_rejected(self, settings):
        """A service account has no mailbox; sending as itself fails obscurely."""
        settings.GMAIL_SERVICE_ACCOUNT_FILE = "/tmp/does-not-matter.json"
        settings.GMAIL_DELEGATED_USER = ""

        with pytest.raises(GmailAuthError, match="GMAIL_DELEGATED_USER"):
            build_credentials()


# --------------------------------------------------------------------------- #
# Integration with the KOS mailer
# --------------------------------------------------------------------------- #
@pytest.mark.django_db
class TestOutboundUsesTheBackend:
    def test_a_kos_email_reaches_gmail_with_its_bcc_intact(self, settings, monkeypatch):
        """End to end: apps.ai.outbound → Django → the OAuth backend → Gmail.

        The point of implementing this as an email backend is that outbound.py
        needed no changes at all; this test is what holds that claim honest.
        """
        from apps.ai import outbound
        from apps.ai.models import AISettings

        AISettings.load()
        settings.EMAIL_BACKEND = "apps.ai.gmail.GmailOAuth2Backend"

        session = FakeSession()
        monkeypatch.setattr(
            "google.auth.transport.requests.AuthorizedSession", lambda credentials: session
        )
        monkeypatch.setattr("apps.ai.gmail.build_credentials", lambda: object())

        email_row = outbound.send_now(
            to=["client@example.com"],
            bcc=["ops@example.com"],
            subject="Consent renewal",
            body="The renewal is submitted.",
        )

        assert email_row.status == "sent"
        assert len(session.posts) == 1
        parsed = decode(session.posts[0]["json"])
        assert parsed["To"] == "client@example.com"
        assert parsed["Bcc"] == "ops@example.com"
