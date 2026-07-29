"""Delivering what the AI decided: in-app notifications and email.

The split of responsibility matters and is deliberate: **the AI writes copy,
Django decides who gets it and sends it.** Nothing in this module asks a model
anything — it takes already-generated copy and delivers it through the existing
notification engine, honouring each user's preferences and the AI email
kill-switch.

Reusing ``apps.notifications`` rather than inventing a parallel channel means
AI-driven messages appear in the same bell, obey the same preferences, and are
read the same way as every other KOS notification.
"""
from __future__ import annotations

import logging

from django.conf import settings
from django.core.mail import send_mail

from apps.notifications.models import NotificationEvent
from apps.notifications.services import get_prefs, notify

logger = logging.getLogger(__name__)

URGENCY_ORDER = {"low": 0, "normal": 1, "high": 2, "critical": 3}


def is_urgent(urgency: str, *, threshold: str = "high") -> bool:
    return URGENCY_ORDER.get((urgency or "").lower(), 1) >= URGENCY_ORDER.get(threshold, 2)


def send_ai_email(recipient, *, subject: str, body: str, url: str = "", config=None) -> bool:
    """Send an AI-drafted email. Returns whether it was actually sent.

    Unlike the generic notification mailer this preserves the AI's own subject
    line rather than wrapping it, because the copy was written to stand alone.
    """
    from .models import AISettings

    config = config or AISettings.load()
    if not config.email_enabled:
        return False
    if not getattr(recipient, "email", ""):
        return False
    if not get_prefs(recipient).email_enabled:
        return False

    link = f"{settings.FRONTEND_BASE_URL}{url}" if url else settings.FRONTEND_BASE_URL
    full_body = f"{body}\n\n{link}".strip()
    try:
        send_mail(
            subject=subject or "[KOS] Update",
            message=full_body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[recipient.email],
            fail_silently=False,
        )
    except Exception:
        # A broken SMTP host must not abort a scan mid-way through the queue.
        logger.exception("Failed to send AI email to %s", recipient.email)
        return False
    return True


def deliver(
    recipient,
    *,
    title: str,
    message: str,
    email_subject: str = "",
    email_body: str = "",
    event: str = NotificationEvent.AUTOMATION,
    task=None,
    project=None,
    url: str = "",
    requires_ack: bool = False,
    send_email: bool = True,
    config=None,
) -> list[str]:
    """Create the in-app notification and optionally email it.

    Returns a list of executed-action labels for the automation log — the audit
    trail records exactly which channels fired for whom.
    """
    if recipient is None:
        return []

    actions: list[str] = []
    notification = notify(
        recipient,
        event,
        title[:240],
        body=message,
        task=task,
        project=project,
        url=url,
        requires_ack=requires_ack,
        email=False,  # the AI-written email is sent below instead of the generic one
    )
    if notification is not None:
        actions.append(f"notified:{recipient.id}")

    if send_email and (email_subject or email_body):
        sent = send_ai_email(
            recipient,
            subject=email_subject or f"[KOS] {title}",
            body=email_body or message,
            url=url or (notification.url if notification else ""),
            config=config,
        )
        if sent:
            actions.append(f"emailed:{recipient.id}")

    return actions


def deliver_many(recipients, **kwargs) -> list[str]:
    """Deliver to several people, once each."""
    actions: list[str] = []
    seen: set[int] = set()
    for recipient in recipients:
        if recipient is None or recipient.id in seen:
            continue
        seen.add(recipient.id)
        actions += deliver(recipient, **kwargs)
    return actions


def managers_of(project) -> list:
    """Who counts as management for a project, most specific first."""
    if project is None:
        return []
    people = [project.manager, project.owner]
    return [p for p in people if p is not None]


def escalation_audience(project) -> list:
    """Who a 24-hour escalation reaches: project leadership plus anyone holding
    organisation-wide administration."""
    from django.contrib.auth import get_user_model

    audience = managers_of(project)
    if project is not None and project.portfolio_id and project.portfolio.owner_id:
        audience.append(project.portfolio.owner)

    User = get_user_model()
    for user in User.objects.filter(is_active=True, is_superuser=True)[:5]:
        audience.append(user)
    return audience
