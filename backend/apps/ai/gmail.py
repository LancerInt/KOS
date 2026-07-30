"""Sending through Gmail with OAuth 2.0 instead of a password.

Why this exists at all: SMTP with `EMAIL_HOST_PASSWORD` means a long-lived
credential sitting in a file, equal in power to whatever it can reach. OAuth
replaces it with a token that is scoped (``gmail.send`` — this can send mail and
do nothing else, not even read the mailbox), revocable from the Google account
page without touching the server, and never the account password.

Implemented as a Django **email backend**, which is the whole trick: every
existing caller — `apps.ai.outbound`, `apps.notifications.services`, Django's
own `send_mail` — goes through `get_connection()` and keeps working untouched.
Switching between console, SMTP and OAuth is one settings line and no code
changes anywhere else.

Two credential shapes are supported, because the right answer differs by account:

* **Service account with domain-wide delegation** (Google Workspace only).
  Nothing expires, nothing needs a browser, and there is no consent screen —
  the correct choice for a server. Requires a Workspace admin to authorise the
  service account's client ID for the ``gmail.send`` scope.
* **A user's refresh token** (works with any account, including personal
  @gmail.com). Obtained once via ``manage.py gmail_oauth_setup``.

Transport is the Gmail REST API rather than SMTP with XOAUTH2. It avoids port
587 entirely — commonly blocked on office and campus networks — and is the path
Google actually supports.
"""
from __future__ import annotations

import base64
import logging
import threading

from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend

logger = logging.getLogger(__name__)

#: Send-only. Deliberately not ``gmail.compose`` or ``mail.google.com``: this
#: token must never be able to read the mailbox it sends from. It is also the
#: difference between a "sensitive" and a "restricted" scope in Google's review
#: process, which matters if the app is ever published.
GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"

GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
TOKEN_URI = "https://oauth2.googleapis.com/token"


class GmailAuthError(RuntimeError):
    """Credentials are missing or malformed — a configuration fault, not a send failure."""


def build_credentials():
    """Resolve Gmail credentials from settings, service account first.

    Service account before refresh token because when both are configured the
    service account is the deliberate production choice and the refresh token is
    usually a developer's leftover.
    """
    service_account_file = getattr(settings, "GMAIL_SERVICE_ACCOUNT_FILE", "")
    delegated_user = getattr(settings, "GMAIL_DELEGATED_USER", "")

    if service_account_file:
        from google.oauth2 import service_account

        if not delegated_user:
            # Without a subject the service account authenticates as itself — an
            # identity with no mailbox — and every send fails with a confusing
            # 400. Failing here names the actual problem.
            raise GmailAuthError(
                "GMAIL_SERVICE_ACCOUNT_FILE is set but GMAIL_DELEGATED_USER is not. "
                "A service account has no mailbox of its own; it must impersonate a "
                "real Workspace user."
            )
        return service_account.Credentials.from_service_account_file(
            service_account_file, scopes=[GMAIL_SEND_SCOPE]
        ).with_subject(delegated_user)

    client_id = getattr(settings, "GMAIL_OAUTH_CLIENT_ID", "")
    client_secret = getattr(settings, "GMAIL_OAUTH_CLIENT_SECRET", "")
    refresh_token = getattr(settings, "GMAIL_OAUTH_REFRESH_TOKEN", "")

    if not (client_id and client_secret and refresh_token):
        missing = [
            name for name, value in (
                ("GMAIL_OAUTH_CLIENT_ID", client_id),
                ("GMAIL_OAUTH_CLIENT_SECRET", client_secret),
                ("GMAIL_OAUTH_REFRESH_TOKEN", refresh_token),
            ) if not value
        ]
        raise GmailAuthError(
            f"Gmail OAuth is selected but {', '.join(missing)} is not set. "
            "Run: python manage.py gmail_oauth_setup"
        )

    from google.oauth2.credentials import Credentials

    # No access token is passed — the library fetches one from the refresh token
    # on first use and renews it automatically as it expires.
    return Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri=TOKEN_URI,
        client_id=client_id,
        client_secret=client_secret,
        scopes=[GMAIL_SEND_SCOPE],
    )


def as_gmail_payload(message) -> dict:
    """Serialise a Django ``EmailMessage`` into a Gmail API request body.

    **The Bcc handling here is load-bearing.** Django's ``message()`` renders
    To and Cc but deliberately omits Bcc — for SMTP the blind copies travel in
    the envelope (``recipients()``), never in the headers, which is what makes
    them blind. The Gmail API has no separate envelope: it reads the recipients
    off the message itself. Serialising without re-adding the header would
    therefore drop every blind copy silently — the message would send, the API
    would return 200, and the Bcc recipients would simply never hear about it.

    Gmail strips the header before delivery, so the copies stay blind.
    """
    mime = message.message()
    if message.bcc and mime.get("Bcc") is None:
        mime["Bcc"] = ", ".join(message.bcc)
    return {"raw": base64.urlsafe_b64encode(mime.as_bytes()).decode("ascii")}


class GmailOAuth2Backend(BaseEmailBackend):
    """Django email backend that sends via the Gmail API using OAuth 2.0.

    One authorised session is opened per connection and reused for the whole
    batch, so a daily digest to fifty people costs one token fetch rather than
    fifty. The session is per-instance and guarded by a lock because Django
    hands the same backend to concurrent sends under some deployments.
    """

    def __init__(self, fail_silently: bool = False, **kwargs):
        super().__init__(fail_silently=fail_silently)
        self._session = None
        self._lock = threading.RLock()

    # --- connection ------------------------------------------------------- #
    def open(self) -> bool:
        """Build the authorised session. True if it was opened by this call."""
        with self._lock:
            if self._session is not None:
                return False
            try:
                from google.auth.transport.requests import AuthorizedSession

                self._session = AuthorizedSession(build_credentials())
            except Exception:
                if not self.fail_silently:
                    raise
                logger.exception("Could not open a Gmail OAuth session")
                return False
            return True

    def close(self) -> None:
        with self._lock:
            if self._session is not None:
                try:
                    self._session.close()
                finally:
                    self._session = None

    # --- sending ---------------------------------------------------------- #
    def send_messages(self, email_messages) -> int:
        if not email_messages:
            return 0

        opened = self.open()
        if self._session is None:
            return 0

        try:
            return sum(1 for message in email_messages if self._send(message))
        finally:
            if opened:
                self.close()

    def _send(self, message) -> bool:
        if not message.recipients():
            return False

        try:
            response = self._session.post(
                GMAIL_SEND_URL,
                json=as_gmail_payload(message),
                timeout=getattr(settings, "GMAIL_TIMEOUT_SECONDS", 30),
            )
        except Exception as exc:
            if not self.fail_silently:
                raise
            logger.exception("Gmail API request failed: %s", exc)
            return False

        if response.status_code >= 400:
            detail = _error_detail(response)
            logger.error("Gmail API refused the message (%s): %s", response.status_code, detail)
            if not self.fail_silently:
                raise GmailSendError(f"Gmail API returned {response.status_code}: {detail}")
            return False

        return True


class GmailSendError(RuntimeError):
    """Gmail accepted the request but refused the message."""


def _error_detail(response) -> str:
    """Pull the human-readable reason out of a Gmail API error body."""
    try:
        payload = response.json()
    except ValueError:
        return (response.text or "")[:300]
    error = payload.get("error")
    if isinstance(error, dict):
        return str(error.get("message") or error)[:300]
    return str(error or payload)[:300]
