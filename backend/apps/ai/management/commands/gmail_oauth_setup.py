"""One-time Gmail OAuth consent, run by a human at a terminal.

Produces the refresh token that :mod:`apps.ai.gmail` then uses forever without
further interaction. Run once per account; the result goes in ``.env``.

    python manage.py gmail_oauth_setup

Uses the loopback redirect flow — a throwaway HTTP server on localhost catches
Google's callback. The old copy-a-code-from-the-browser flow was withdrawn by
Google in 2022, and loopback is what replaced it for desktop clients.

Implemented against the OAuth endpoints directly with ``requests`` rather than
pulling in ``google-auth-oauthlib``: a dependency that exists solely for a
command run once in the lifetime of a deployment is not worth carrying in the
production image.
"""
from __future__ import annotations

import secrets
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer

import requests
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.ai.gmail import GMAIL_SEND_SCOPE, TOKEN_URI

AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth"

SUCCESS_PAGE = b"""<!doctype html><meta charset="utf-8">
<title>KOS - Gmail connected</title>
<body style="font-family:system-ui;max-width:32rem;margin:15vh auto;text-align:center">
<h2>Gmail connected</h2>
<p>You can close this tab and go back to the terminal.</p>
</body>"""

FAILURE_PAGE = b"""<!doctype html><meta charset="utf-8">
<title>KOS - Gmail not connected</title>
<body style="font-family:system-ui;max-width:32rem;margin:15vh auto;text-align:center">
<h2>Not connected</h2>
<p>Google did not return an authorisation code. Check the terminal.</p>
</body>"""


class _CallbackHandler(BaseHTTPRequestHandler):
    """Catches the single redirect Google makes back to localhost."""

    code: str | None = None
    state: str | None = None
    error: str | None = None

    def do_GET(self):  # noqa: N802 - name fixed by http.server
        query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        _CallbackHandler.code = (query.get("code") or [None])[0]
        _CallbackHandler.state = (query.get("state") or [None])[0]
        _CallbackHandler.error = (query.get("error") or [None])[0]

        body = SUCCESS_PAGE if _CallbackHandler.code else FAILURE_PAGE
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        """Silence the default per-request logging — it clutters the console."""


class Command(BaseCommand):
    help = "Authorise KOS to send Gmail on your behalf, and print the refresh token."

    def add_arguments(self, parser):
        parser.add_argument(
            "--port", type=int, default=8765,
            help="Local port for the OAuth callback (default 8765).",
        )
        parser.add_argument(
            "--no-browser", action="store_true",
            help="Print the URL instead of opening a browser — for headless servers.",
        )

    def handle(self, *args, **options):
        client_id = getattr(settings, "GMAIL_OAUTH_CLIENT_ID", "")
        client_secret = getattr(settings, "GMAIL_OAUTH_CLIENT_SECRET", "")
        if not (client_id and client_secret):
            raise CommandError(
                "GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET must be set in "
                "backend/.env before running this.\n\n"
                "Create them at https://console.cloud.google.com/apis/credentials —\n"
                "  1. Enable the Gmail API for the project.\n"
                "  2. Configure the OAuth consent screen.\n"
                "  3. Create an OAuth client ID of type 'Desktop app'.\n"
                "A Desktop app client accepts any localhost port, so no redirect URI "
                "needs registering."
            )

        port = options["port"]
        redirect_uri = f"http://localhost:{port}/"
        # Guards against a stray request to the callback port being mistaken for
        # Google's redirect.
        state = secrets.token_urlsafe(24)

        params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": GMAIL_SEND_SCOPE,
            # offline is what produces a refresh token at all; consent forces a
            # fresh one even when this account has authorised before — otherwise
            # a second run returns an access token and no refresh token, and the
            # setup appears to have silently half-worked.
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
        }
        auth_url = f"{AUTH_URI}?{urllib.parse.urlencode(params)}"

        self.stdout.write("Open this URL and grant access:\n")
        self.stdout.write(self.style.HTTP_INFO(auth_url + "\n"))
        if not options["no_browser"]:
            webbrowser.open(auth_url)
        self.stdout.write(f"Waiting for Google to redirect to {redirect_uri} …")

        _CallbackHandler.code = _CallbackHandler.state = _CallbackHandler.error = None
        try:
            server = HTTPServer(("localhost", port), _CallbackHandler)
        except OSError as exc:
            raise CommandError(
                f"Could not listen on port {port}: {exc}\nTry --port with a free port."
            ) from exc
        with server:
            server.handle_request()  # exactly one: the redirect

        if _CallbackHandler.error:
            raise CommandError(f"Google returned an error: {_CallbackHandler.error}")
        if not _CallbackHandler.code:
            raise CommandError("No authorisation code was received.")
        if _CallbackHandler.state != state:
            raise CommandError("State mismatch — the callback did not come from this request.")

        self.stdout.write("Code received, exchanging it for a refresh token …")
        response = requests.post(
            TOKEN_URI,
            data={
                "code": _CallbackHandler.code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            timeout=30,
        )
        if response.status_code >= 400:
            raise CommandError(f"Token exchange failed ({response.status_code}): {response.text[:400]}")

        payload = response.json()
        refresh_token = payload.get("refresh_token")
        if not refresh_token:
            raise CommandError(
                "Google returned no refresh token. This happens when the account has "
                "already authorised this client; revoke it at "
                "https://myaccount.google.com/permissions and run this again."
            )

        self.stdout.write(self.style.SUCCESS("\nAuthorised. Put this in backend/.env:\n"))
        self.stdout.write(f"GMAIL_OAUTH_REFRESH_TOKEN={refresh_token}\n")
        self.stdout.write(
            "\nThen clear EMAIL_HOST_PASSWORD — OAuth replaces it — and restart the "
            "server.\nVerify with:  python manage.py send_test_email you@example.com\n"
        )
