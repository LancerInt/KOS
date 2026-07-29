"""Notification delivery (PRD §22, D1). In-app record + optional email."""
from __future__ import annotations

from django.conf import settings
from django.core.mail import send_mail

from .models import Notification, NotificationPreference


def get_prefs(user) -> NotificationPreference:
    pref, _ = NotificationPreference.objects.get_or_create(user=user)
    return pref


def _url_for(task, project) -> str:
    if task is not None:
        return f"/projects/{task.project_id}"
    if project is not None:
        return f"/projects/{project.id}"
    return "/"


def _send_email(recipient, title, body, url) -> None:
    if not getattr(recipient, "email", ""):
        return
    link = f"{settings.FRONTEND_BASE_URL}{url}" if url else settings.FRONTEND_BASE_URL
    send_mail(
        subject=f"[KOS] {title}",
        message=f"{body}\n\n{link}".strip(),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[recipient.email],
        fail_silently=True,
    )


def notify(recipient, event, title, *, body="", task=None, project=None,
           url="", requires_ack=False, email=True) -> Notification | None:
    """Create an in-app notification and (per prefs) send an email (§22.1)."""
    if recipient is None:
        return None
    pref = get_prefs(recipient)
    notification = Notification.objects.create(
        recipient=recipient, event=event, title=title, body=body,
        task=task, project=project, url=url or _url_for(task, project),
        requires_acknowledgement=requires_ack,
    )
    if email and pref.email_enabled:
        _send_email(recipient, title, body, notification.url)
    return notification


def notify_many(recipients, *, exclude=None, **kwargs) -> None:
    """Notify a set of users once each, skipping ``exclude`` and duplicates."""
    exclude_ids = {u.id for u in (exclude or []) if u is not None}
    seen: set[int] = set()
    for r in recipients:
        if r is None or r.id in seen or r.id in exclude_ids:
            continue
        seen.add(r.id)
        notify(r, **kwargs)
