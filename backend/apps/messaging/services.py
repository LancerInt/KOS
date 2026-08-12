"""Sending a direct message, and the notification that announces it."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone as dt_timezone

from django.db.models import Case, DateTimeField, F, Value, When
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.notifications.models import Notification, NotificationEvent
from apps.notifications.services import notify

from .models import Conversation, DirectMessage, GroupMessage

# How much of the message rides along in the bell / email preview.
PREVIEW_CHARS = 240

# How long a sender has to correct their own wording. Long enough for the
# "…meant Thursday" moment, short enough that nobody rewrites an instruction
# after the other person has acted on it.
EDIT_WINDOW = timedelta(minutes=15)

# A stand-in for "never cleared", so every comparison against a clear-point is
# a plain ``>`` with no NULL handling scattered through the queries.
NEVER_CLEARED = datetime(1970, 1, 1, tzinfo=dt_timezone.utc)


def cleared_expression(user, prefix: str = ""):
    """The clear-point for ``user`` on a conversation, as a query expression.

    ``prefix`` lets this be used from a DirectMessage queryset (``"conversation__"``)
    as well as from a Conversation one.
    """
    return Coalesce(
        Case(
            When(**{f"{prefix}user_low": user}, then=F(f"{prefix}low_cleared_at")),
            default=F(f"{prefix}high_cleared_at"),
            output_field=DateTimeField(),
        ),
        Value(NEVER_CLEARED, output_field=DateTimeField()),
        output_field=DateTimeField(),
    )


def can_edit(message: DirectMessage, user) -> bool:
    """Only your own message, only while it is still fresh, never a tombstone."""
    return (
        message.sender_id == user.id
        and message.deleted_at is None
        and timezone.now() - message.created_at <= EDIT_WINDOW
    )


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
    # What is genuinely still waiting for them: not read, not retracted since,
    # and not on the far side of a thread they have cleared.
    waiting = (
        conversation.messages.filter(read_at__isnull=True, deleted_at__isnull=True)
        .exclude(sender=recipient)
        .exclude(pk=message.pk)
    )
    cleared = conversation.cleared_at_for(recipient)
    if cleared is not None:
        waiting = waiting.filter(created_at__gt=cleared)
    if not waiting.exists():
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
    """Unread incoming messages across every thread ``user`` takes part in.

    Retracted messages and anything behind the user's own clear-point don't
    count — the badge has to agree with what they'd actually find on screen.
    """
    return (
        DirectMessage.objects.filter(
            conversation__in=Conversation.visible_to(user),
            read_at__isnull=True,
            deleted_at__isnull=True,
        )
        .exclude(sender=user)
        .annotate(_cleared=cleared_expression(user, prefix="conversation__"))
        .filter(created_at__gt=F("_cleared"))
    )


# --------------------------------------------------------------------------- #
# Group chats
# --------------------------------------------------------------------------- #


def group_thread_url(thread) -> str:
    return f"/messages/g/{thread.pk}"


def _group_unread_queryset(thread, membership):
    """Incoming, still-unread messages for one member of ``thread``."""
    rows = thread.messages.filter(deleted_at__isnull=True).exclude(sender_id=membership.user_id)
    # The later of "last opened" and "cleared" is the floor below which nothing
    # counts as new.
    floor = membership.last_read_at
    if membership.cleared_at and (floor is None or membership.cleared_at > floor):
        floor = membership.cleared_at
    if floor is not None:
        rows = rows.filter(created_at__gt=floor)
    return rows


def group_unread_for(thread, user) -> int:
    m = thread.membership_for(user)
    return _group_unread_queryset(thread, m).count() if m else 0


def mark_group_read(thread, user) -> int:
    """Stamp the member's read-point to now. Returns how many were outstanding."""
    m = thread.membership_for(user)
    if not m:
        return 0
    outstanding = _group_unread_queryset(thread, m).count()
    m.last_read_at = timezone.now()
    m.save(update_fields=["last_read_at"])
    return outstanding


def total_group_unread(user) -> dict:
    """Aggregate unread across every group the user is in — for the badge."""
    from .models import GroupMembership

    unread = 0
    threads = 0
    for m in GroupMembership.objects.filter(user=user).select_related("thread"):
        n = _group_unread_queryset(m.thread, m).count()
        if n:
            unread += n
            threads += 1
    return {"unread": unread, "threads": threads}


def send_group_message(thread, sender, body: str) -> GroupMessage:
    """Append ``body`` to a group and ping the other members.

    Each member gets at most one standing "there's a message here" ping until
    they open the thread — the same courtesy as a DM, so a busy group doesn't
    fire a bell per line.
    """
    message = GroupMessage.objects.create(thread=thread, sender=sender, body=body)
    thread.last_message_at = message.created_at
    thread.save(update_fields=["last_message_at"])

    url = group_thread_url(thread)
    sender_name = sender.get_full_name() or sender.username
    preview = body if len(body) <= PREVIEW_CHARS else body[:PREVIEW_CHARS].rstrip() + "…"
    for m in thread.memberships.exclude(user_id=sender.id).select_related("user"):
        # Someone who has cleared past this message shouldn't be pulled back by it.
        if m.cleared_at and m.cleared_at >= message.created_at:
            continue
        if Notification.objects.filter(recipient=m.user, url=url, is_read=False).exists():
            continue
        notify(
            m.user, NotificationEvent.DIRECT_MESSAGE,
            f"{sender_name} in {thread.name}", body=preview, url=url,
        )
    return message
