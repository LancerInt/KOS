"""Prove the mail configuration works, before anyone trusts a screen with it.

Diagnosing "the Send button did nothing" through the UI is slow: a browser
cannot tell a blank ``EMAIL_HOST`` from a wrong app password from a firewall
eating port 587, and all three look identical to the person clicking. This
command isolates the transport — no AI call, no queue, no HTTP request — so a
failure names itself.

    python manage.py send_test_email you@example.com

Add ``--via-kos`` to send through :mod:`apps.ai.outbound` instead of Django's
mailer directly, which additionally exercises the kill switches, the recipient
caps and the ``OutboundEmail`` record.
"""
from __future__ import annotations

from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone


class Command(BaseCommand):
    help = "Send a test email to check the SMTP configuration."

    def add_arguments(self, parser):
        parser.add_argument("recipient", help="Address to send the test to.")
        parser.add_argument(
            "--via-kos",
            action="store_true",
            help="Send through apps.ai.outbound (exercises the guard rails and writes a record).",
        )
        parser.add_argument("--bcc", default="", help="Comma separated blind copies (--via-kos only).")

    def handle(self, *args, **options):
        recipient = options["recipient"]
        backend = settings.EMAIL_BACKEND

        self.stdout.write(f"Backend:   {backend}")
        if "console" in backend or "locmem" in backend:
            # The single most common cause of "it said sent but nothing arrived".
            # Say it plainly rather than printing a message and claiming success.
            self.stdout.write(self.style.WARNING(
                "\nEMAIL_HOST is blank, so nothing will actually be sent — the message is "
                "printed below instead.\nSet EMAIL_HOST (and the rest of the SMTP block) in "
                "backend/.env, then restart, to send for real.\n"
            ))
        else:
            self.stdout.write(f"Host:      {settings.EMAIL_HOST}:{settings.EMAIL_PORT} "
                              f"(TLS {'on' if settings.EMAIL_USE_TLS else 'off'})")
            self.stdout.write(f"Username:  {settings.EMAIL_HOST_USER or '(none)'}")
            self.stdout.write(f"Password:  {'set' if settings.EMAIL_HOST_PASSWORD else 'NOT SET'}")
        self.stdout.write(f"From:      {settings.DEFAULT_FROM_EMAIL}")
        self.stdout.write(f"To:        {recipient}\n")

        stamp = timezone.localtime().strftime("%d %b %Y %H:%M:%S")
        subject = f"[KOS] Test email · {stamp}"
        body = (
            "This is a test message from KOS.\n\n"
            "If you are reading it in your inbox, the SMTP configuration is working and "
            "the Send button on the AI email draft will reach real mailboxes.\n\n"
            f"Sent at {stamp}."
        )

        try:
            if options["via_kos"]:
                sent = self._via_kos(recipient, subject, body, options["bcc"])
            else:
                sent = send_mail(
                    subject=subject, message=body,
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    recipient_list=[recipient], fail_silently=False,
                ) == 1
        except Exception as exc:
            raise CommandError(f"{type(exc).__name__}: {exc}\n\n{self._diagnose(exc)}") from exc

        if sent:
            self.stdout.write(self.style.SUCCESS("\nSent. Check the inbox (and the spam folder)."))
        else:
            self.stdout.write(self.style.ERROR("\nNot sent — see the error recorded above."))

    def _via_kos(self, recipient: str, subject: str, body: str, bcc: str) -> bool:
        from apps.ai.outbound import EmailRejected, send_now

        try:
            email = send_now(to=[recipient], bcc=bcc, subject=subject, body=body)
        except EmailRejected as exc:
            raise CommandError(f"Rejected before sending: {exc}") from None

        self.stdout.write(f"OutboundEmail #{email.id} · status={email.status}")
        if email.error:
            self.stdout.write(self.style.ERROR(f"Error: {email.error}"))
        return email.status == "sent"

    def _diagnose(self, exc: Exception) -> str:
        """Turn the usual SMTP failures into the thing to actually go and fix."""
        text = str(exc).lower()
        if "username and password not accepted" in text or "535" in text:
            return (
                "Google refused the credentials. Almost always this is the account password "
                "being used instead of an app password. Generate one at "
                "https://myaccount.google.com/apppasswords, paste it into EMAIL_HOST_PASSWORD "
                "with the spaces removed, and restart."
            )
        if "getaddrinfo" in text or "name or service not known" in text:
            return "EMAIL_HOST does not resolve. For Gmail it must be exactly smtp.gmail.com."
        if "timed out" in text or "10060" in text:
            return (
                "Nothing answered on that port. Port 587 outbound is commonly blocked on "
                "office and college networks — try another network to confirm."
            )
        if "certificate" in text or "ssl" in text:
            return "TLS negotiation failed. Use port 587 with EMAIL_USE_TLS=True (not port 465)."
        return "Check EMAIL_HOST, EMAIL_PORT, EMAIL_HOST_USER and EMAIL_HOST_PASSWORD in backend/.env."
