"""Sending a direct message, and the notification that announces it."""
from __future__ import annotations

from django.utils import timezone

from apps.notifications.models import NotificationEvent
from apps.notifications.services import notify

from .models import Conversation, DirectMessage

# How much of the message rides along in the bell / email preview.
PREVIEW_CHARS = 240


def thread_url(conversation: Conversation) -> str:
    return f"/messages/{conversation.pk}"


def send_message(conversation: Conversation, sender, body: str) -> DirectMessage:
    """Append ``body`` to ``conversation`` and ping the other party.

    The recipient is notified only when this is the *first* thing they haven't
    read in the thread. A back-and-forth exchange would otherwise put one bell
    entry (and one email) per line typed; the single "you have a message here"
    ping stands until they open the thread, and the next message after that
    pings again.
    """
    message = DirectMessage.objects.create(
        conversation=conversation, sender=sender, body=body
    )
    conversation.last_message_at = message.created_at
    conversation.save(update_fields=["last_message_at"])

    recipient = conversation.other_party(sender)
    already_waiting = (
        conversation.messages.filter(read_at__isnull=True)
        .exclude(sender=recipient)
        .exclude(pk=message.pk)
        .exists()
    )
    if not already_waiting:
        sender_name = sender.get_full_name() or sender.username
        preview = body if len(body) <= PREVIEW_CHARS else body[:PREVIEW_CHARS].rstrip() + "…"
        notify(
            recipient,
            NotificationEvent.DIRECT_MESSAGE,
            f"Message from {sender_name}",
            body=preview,
            url=thread_url(conversation),
        )
    return message


def mark_thread_read(conversation: Conversation, reader) -> int:
    """Mark everything the other party wrote as read. Returns how many."""
    return (
        conversation.messages.filter(read_at__isnull=True)
        .exclude(sender=reader)
        .update(read_at=timezone.now())
    )


def unread_for(user):
    """Unread incoming messages across every thread ``user`` takes part in."""
    return DirectMessage.objects.filter(
        conversation__in=Conversation.visible_to(user), read_at__isnull=True
    ).exclude(sender=user)
