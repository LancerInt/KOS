"""Notification delivery (PRD §22, D1). In-app record + optional email."""
from __future__ import annotations

from django.conf import settings
from django.core.mail import get_connection, send_mail

from .models import EmailAccount, Notification, NotificationPreference


def get_prefs(user) -> NotificationPreference:
    pref, _ = NotificationPreference.objects.get_or_create(user=user)
    return pref


def _url_for(task, project) -> str:
    if task is not None:
        return f"/projects/{task.project_id}"
    if project is not None:
        return f"/projects/{project.id}"
    return "/"


def connection_for(user):
    """(connection, from_email) built from ``user``'s own connected email account,
    or ``(None, default)`` if they haven't set one up. Per-user: everyone sends
    through their own address — there is no shared organisation account."""
    if user is None:
        return None, settings.DEFAULT_FROM_EMAIL
    account = EmailAccount.for_user(user)
    if account.is_ready:
        conn = get_connection(
            backend="django.core.mail.backends.smtp.EmailBackend",
            host=account.host, port=account.port, username=account.username,
            password=account.get_password(), use_tls=account.use_tls, fail_silently=True,
        )
        return conn, (account.from_email or account.username)
    return None, settings.DEFAULT_FROM_EMAIL


def _send_email(recipient, title, body, url) -> None:
    """Deliver a notification email to ``recipient`` through their own account.

    KOS uses the recipient's connected email to send them their reminders. If
    they haven't connected one, they get the in-app notification only — nothing
    is sent, so no one is emailed against their will."""
    if not getattr(recipient, "email", ""):
        return
    connection, from_email = connection_for(recipient)
    if connection is None:
        return  # no connected account → in-app only
    link = f"{settings.FRONTEND_BASE_URL}{url}" if url else settings.FRONTEND_BASE_URL
    send_mail(
        subject=f"[KOS] {title}",
        message=f"{body}\n\n{link}".strip(),
        from_email=from_email,
        recipient_list=[recipient.email],
        connection=connection,
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
