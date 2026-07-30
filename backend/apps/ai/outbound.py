"""Sending real email out of KOS — to Gmail, or any other mailbox.

This is deliberately separate from :mod:`apps.ai.delivery`. That module notifies
*KOS users* and honours their in-app notification preferences; this one puts a
message on the internet, addressed to whoever the sender chose. The two must not
share a code path, because the questions they answer are different:

* delivery.py — "should this user be told, and how do they like to be told?"
* outbound.py — "is this system allowed to send this, to these addresses, now?"

Everything here funnels into :func:`send`, and :func:`send` always writes an
:class:`~apps.ai.models.OutboundEmail` row first. Nothing leaves without a
record — including the Bcc list, which is by definition invisible in every other
trace of the message.

The transport is Django's configured email backend, so pointing KOS at Gmail is
environment configuration and not a code change::

    EMAIL_HOST=smtp.gmail.com
    EMAIL_PORT=587
    EMAIL_USE_TLS=True
    EMAIL_HOST_USER=you@yourdomain.com
    EMAIL_HOST_PASSWORD=<16-character Google app password>
    DEFAULT_FROM_EMAIL=KOS <you@yourdomain.com>

Gmail rejects a plain account password; an app password (with 2-step
verification enabled) is required. Gmail also rewrites ``From`` to the
authenticated account, which is exactly why every message sets ``Reply-To`` to
the human who sent it — replies reach the person, not the service mailbox.
"""
from __future__ import annotations

import logging
import re
from datetime import timedelta
from email.utils import formataddr, parseaddr

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.mail import EmailMultiAlternatives, get_connection
from django.core.validators import validate_email
from django.utils import timezone
from django.utils.html import escape

from .models import AISettings, EmailStatus, OutboundEmail

logger = logging.getLogger(__name__)

#: Longest a single subject line may be, matching the model field.
MAX_SUBJECT_CHARS = 300
MAX_BODY_CHARS = 100_000

#: Control characters that would let a crafted subject inject its own headers.
_HEADER_BREAK = re.compile(r"[\r\n\x00]+")


class EmailRejected(ValueError):
    """The message was refused before any SMTP conversation started.

    Carries a message safe to show the user — a bad address, a disabled
    kill-switch, a rate limit. Distinct from a send *failure*, which happens
    after the row exists and is recorded on the row itself.
    """


# --------------------------------------------------------------------------- #
# Address handling
# --------------------------------------------------------------------------- #
def clean_address(raw: str) -> str:
    """Normalise one address, accepting ``Name <a@b.com>`` as well as ``a@b.com``.

    Returns the address in whichever form it arrived, with the display name kept
    (people recognise "Priya Nair <…>" in a Cc line and that is worth keeping)
    but the *address* part validated. A display name containing a newline is
    stripped rather than rejected — it is cosmetic, and rejecting a paste from
    Outlook over an invisible character helps nobody.
    """
    raw = _HEADER_BREAK.sub(" ", (raw or "")).strip().strip(",;")
    if not raw:
        raise EmailRejected("An empty email address was supplied.")

    name, address = parseaddr(raw)
    if not address:
        raise EmailRejected(f"{raw!r} is not a valid email address.")
    try:
        validate_email(address)
    except DjangoValidationError:
        raise EmailRejected(f"{address!r} is not a valid email address.") from None

    return formataddr((name.strip(), address)) if name.strip() else address


def parse_addresses(value) -> list[str]:
    """Turn a list, or a comma/semicolon/newline separated string, into addresses.

    Both shapes arrive in practice: the compose form sends a list, while a
    configuration field an administrator typed into is free text. Duplicates are
    dropped case-insensitively on the address part, so ``A@x.com`` and
    ``a@x.com`` do not both get a copy.
    """
    if value is None:
        return []
    if isinstance(value, str):
        parts = re.split(r"[,;\n]+", value)
    else:
        parts = list(value)

    cleaned: list[str] = []
    seen: set[str] = set()
    for part in parts:
        if not str(part).strip():
            continue
        address = clean_address(str(part))
        key = parseaddr(address)[1].lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(address)
    return cleaned


def _address_keys(addresses: list[str]) -> set[str]:
    return {parseaddr(a)[1].lower() for a in addresses}


# --------------------------------------------------------------------------- #
# Guard rails
# --------------------------------------------------------------------------- #
def _rate_limited(sender, config: AISettings) -> bool:
    """Whether this user has already sent their hour's allowance.

    A generous cap that exists for one reason: an ERP account with a stolen
    session must not become an open mail relay. Counts every row the user
    created in the last hour, sent or failed — a failing loop is exactly the
    case worth stopping.
    """
    if sender is None or not config.outbound_hourly_limit_per_user:
        return False
    since = timezone.now() - timedelta(hours=1)
    recent = OutboundEmail.objects.filter(sender=sender, created_at__gte=since).count()
    return recent >= config.outbound_hourly_limit_per_user


def _check_allowed(config: AISettings, *, automated: bool) -> None:
    if not config.outbound_email_enabled:
        raise EmailRejected("Sending email from KOS is switched off for this system.")
    # Automation mail obeys the automation kill-switch as well; a person pressing
    # Send is not an automation and is not silenced by it.
    if automated and not config.email_enabled:
        raise EmailRejected("Automated email is switched off for this system.")


# --------------------------------------------------------------------------- #
# Composition
# --------------------------------------------------------------------------- #
def _footer(link: str) -> str:
    return (
        "\n\n—\nSent from KOS · Kriya Operations\n"
        f"{link}"
    )


def _html_body(body: str, link: str) -> str:
    """A plain HTML alternative.

    Not a template: an AI-drafted business email is prose, and wrapping prose in
    a marketing layout makes it read like one. Paragraphs, a rule and a link is
    the whole design — and escaping every character of the body means a draft can
    never inject markup into the message.
    """
    paragraphs = "".join(
        f"<p style=\"margin:0 0 14px;\">{escape(para).replace(chr(10), '<br>')}</p>"
        for para in re.split(r"\n{2,}", body.strip())
        if para.strip()
    )
    return (
        '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'
        'font-size:14px;line-height:1.6;color:#1c1c1c;max-width:640px;">'
        f"{paragraphs}"
        '<hr style="border:none;border-top:1px solid #e4e4e4;margin:24px 0 12px;">'
        '<p style="margin:0;font-size:12px;color:#767676;">Sent from KOS · Kriya Operations<br>'
        f'<a href="{escape(link)}" style="color:#767676;">{escape(link)}</a></p>'
        "</div>"
    )


def _reply_to_for(sender, explicit: str) -> str:
    """Where replies should land.

    The ``From`` header is the service mailbox — with Gmail it is forcibly
    rewritten to the authenticated account regardless of what we ask for — so
    ``Reply-To`` is the only header that can carry the actual human. Without it
    every reply to a KOS-sent email disappears into a no-reply inbox.
    """
    if explicit:
        return clean_address(explicit)
    if sender is not None and getattr(sender, "email", ""):
        name = sender.get_full_name() or sender.get_username()
        return formataddr((name, sender.email))
    return ""


# --------------------------------------------------------------------------- #
# The public entry point
# --------------------------------------------------------------------------- #
def prepare(
    *,
    to,
    subject: str,
    body: str,
    cc=None,
    bcc=None,
    reply_to: str = "",
    sender=None,
    source: str = OutboundEmail.Source.MANUAL,
    task=None,
    project=None,
    draft_log_id: int | None = None,
    config: AISettings | None = None,
) -> OutboundEmail:
    """Validate a message and store it as a queued :class:`OutboundEmail`.

    Split from :func:`send` on purpose: this half is fast, synchronous and can
    reject with a readable error inside the HTTP request, while the send half is
    slow, network-bound and belongs on a worker. The row exists before any SMTP
    conversation starts, so a message can never be sent without a trace of it.
    """
    config = config or AISettings.load()
    automated = source != OutboundEmail.Source.MANUAL
    _check_allowed(config, automated=automated)

    to_list = parse_addresses(to)
    cc_list = parse_addresses(cc)
    bcc_list = parse_addresses(bcc)
    if not to_list:
        raise EmailRejected("At least one recipient is required.")

    # Someone on To or Cc must not also receive a blind copy — they would get the
    # message twice, and a duplicate arriving from a Bcc looks like a leak.
    visible = _address_keys(to_list) | _address_keys(cc_list)
    bcc_list = [a for a in bcc_list if parseaddr(a)[1].lower() not in visible]
    cc_list = [a for a in cc_list if parseaddr(a)[1].lower() not in _address_keys(to_list)]

    total = len(to_list) + len(cc_list) + len(bcc_list)
    if total > config.outbound_max_recipients:
        raise EmailRejected(
            f"{total} recipients exceeds the limit of {config.outbound_max_recipients} "
            "for a single message."
        )

    subject = _HEADER_BREAK.sub(" ", (subject or "")).strip()[:MAX_SUBJECT_CHARS]
    if not subject:
        raise EmailRejected("A subject line is required.")
    body = (body or "").strip()[:MAX_BODY_CHARS]
    if not body:
        raise EmailRejected("The message body is empty.")

    if _rate_limited(sender, config):
        raise EmailRejected(
            f"You have reached the limit of {config.outbound_hourly_limit_per_user} emails "
            "per hour. Try again shortly."
        )

    return OutboundEmail.objects.create(
        to=to_list, cc=cc_list, bcc=bcc_list,
        reply_to=_reply_to_for(sender, reply_to)[:320],
        subject=subject, body=body,
        source=source, sender=sender, task=task, project=project,
        draft_log_id=draft_log_id,
        status=EmailStatus.QUEUED,
    )


def send(email: OutboundEmail, *, connection=None) -> bool:
    """Send a prepared message. Returns whether it left the building.

    Never raises on a transport failure: the caller is either a Celery task or a
    view that has already answered the user, and in both cases the useful
    outcome is a ``failed`` row carrying the reason, not an exception thrown into
    a worker log.
    """
    if email.status == EmailStatus.SENT:
        return True

    link = settings.FRONTEND_BASE_URL
    text = f"{email.body}{_footer(link)}"

    message = EmailMultiAlternatives(
        subject=email.subject,
        body=text,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=email.to,
        cc=email.cc,
        bcc=email.bcc,
        reply_to=[email.reply_to] if email.reply_to else None,
        connection=connection or get_connection(),
    )
    message.attach_alternative(_html_body(email.body, link), "text/html")

    email.attempts += 1
    try:
        message.send(fail_silently=False)
    except Exception as exc:
        email.status = EmailStatus.FAILED
        email.error = f"{type(exc).__name__}: {exc}"[:400]
        email.save(update_fields=["status", "error", "attempts", "updated_at"])
        logger.exception("Failed to send email %s to %s", email.pk, email.to)
        return False

    email.status = EmailStatus.SENT
    email.error = ""
    email.sent_at = timezone.now()
    email.save(update_fields=["status", "error", "attempts", "sent_at", "updated_at"])
    logger.info("Sent email %s to %s recipients", email.pk, email.recipient_count)
    return True


def send_now(**kwargs) -> OutboundEmail:
    """Prepare and send in one call — for automations that have no worker to hand."""
    email = prepare(**kwargs)
    send(email)
    return email
