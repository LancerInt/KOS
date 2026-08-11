"""One-to-one direct messages between two people.

A private thread, not a project artefact: a Management/IT member opens a
conversation with one person, and from then on both sides can write in it. Who
may *open* a thread is policy and lives in ``permissions.py``; this module only
models the thread and its messages.

The pair is canonical — ``user_low`` always holds the smaller user id — so a
conversation between A and B exists exactly once no matter who opened it. Use
``Conversation.between()`` rather than creating rows directly; it is what keeps
that invariant true.
"""
from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import F, Q


class Conversation(models.Model):
    user_low = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="conversations_as_low"
    )
    user_high = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="conversations_as_high"
    )
    started_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    # Stamped on creation as well as on each message, so a thread that has been
    # opened but not yet written in still sorts sensibly in the list.
    last_message_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ("-last_message_at", "-created_at")
        constraints = [
            models.UniqueConstraint(fields=["user_low", "user_high"], name="uniq_dm_pair"),
            # Without this, (A,B) and (B,A) would both satisfy the unique
            # constraint and the same two people could end up with two threads.
            models.CheckConstraint(condition=Q(user_low__lt=F("user_high")), name="dm_pair_ordered"),
        ]

    def __str__(self) -> str:
        return f"DM {self.user_low_id} ↔ {self.user_high_id}"

    @classmethod
    def between(cls, a, b, *, started_by=None):
        """The thread for this pair, creating it if it does not exist yet.

        Returns ``(conversation, created)``. Ordering the pair by id here is
        what makes the lookup symmetric.
        """
        from django.utils import timezone

        low, high = (a, b) if a.id < b.id else (b, a)
        return cls.objects.get_or_create(
            user_low=low,
            user_high=high,
            defaults={"started_by": started_by or a, "last_message_at": timezone.now()},
        )

    @classmethod
    def visible_to(cls, user):
        """Threads ``user`` takes part in."""
        return cls.objects.filter(Q(user_low=user) | Q(user_high=user))

    def includes(self, user) -> bool:
        return bool(user) and user.id in (self.user_low_id, self.user_high_id)

    def other_party(self, user):
        """The person on the far side of the thread from ``user``."""
        return self.user_high if user.id == self.user_low_id else self.user_low


class DirectMessage(models.Model):
    conversation = models.ForeignKey(
        Conversation, on_delete=models.CASCADE, related_name="messages"
    )
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sent_direct_messages"
    )
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    # When the *other* party read it. Null means still unread by them; a message
    # is never unread for its own sender.
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("created_at",)
        indexes = [models.Index(fields=["conversation", "created_at"])]

    def __str__(self) -> str:
        return f"{self.sender_id}: {self.body[:40]}"

    @property
    def recipient(self):
        return self.conversation.other_party(self.sender)
