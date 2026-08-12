"""Direct-message endpoints.

* ``GET/POST   /conversations/``                — my threads / open a new one
* ``DELETE     /conversations/{id}/``           — clear the thread from my list
* ``GET/POST   /conversations/{id}/messages/``  — read a thread / write in it
* ``POST       /conversations/{id}/read/``      — mark the other side's lines read
* ``GET        /conversations/unread_count/``   — sidebar badge
* ``PATCH/DEL  /direct-messages/{id}/``         — correct or retract my own line
* ``GET        /message-directory/``            — who I may write to
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db.models import Count, F, OuterRef, Q, Subquery
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditAction
from apps.audit.services import record

from .models import (
    Conversation, DirectMessage, GroupMembership, GroupMessage, GroupThread,
    MessageAttachment, attachment_kind,
)
from .permissions import can_start_conversation
from .serializers import (
    ConversationSerializer, DirectMessageSerializer, GroupMessageSerializer,
    GroupThreadSerializer, PersonSerializer,
)
from .services import (
    NEVER_CLEARED, can_edit, cleared_expression, mark_group_read, mark_thread_read,
    send_group_message, send_message, total_group_unread, unread_for,
)

User = get_user_model()

# A thread view returns at most this many of the most recent lines. Long enough
# that no real conversation is truncated in practice, bounded so a single
# request can't pull an unbounded history.
THREAD_LIMIT = 300
MAX_BODY_CHARS = 5000


def clean_body(raw) -> str:
    """Validate a message body for both writing and editing."""
    body = (raw or "").strip()
    if not body:
        raise ValidationError({"body": "Write something first."})
    if len(body) > MAX_BODY_CHARS:
        raise ValidationError({"body": f"Keep a message under {MAX_BODY_CHARS} characters."})
    return body


# Uploads: bounded so a single message can't fill the disk. Storage is the local
# filesystem (same as record attachments), so files don't survive a backend
# redeploy until a persistent/cloud store is configured.
MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
MAX_ATTACHMENTS = 10


def _incoming_files(request):
    files = request.FILES.getlist("files")
    if len(files) > MAX_ATTACHMENTS:
        raise ValidationError({"files": f"Attach at most {MAX_ATTACHMENTS} files at once."})
    for f in files:
        if (getattr(f, "size", 0) or 0) > MAX_ATTACHMENT_BYTES:
            raise ValidationError({"files": f"“{getattr(f, 'name', 'file')}” is too large (max 25 MB)."})
    return files


def _body_and_preview(request, files):
    """A message needs text or a file. When it's file-only, build the little
    "📷 Photo" / "🎤 Voice message" label the notification and thread list show."""
    body = (request.data.get("body") or "").strip()
    if not body and not files:
        raise ValidationError({"body": "Write something or attach a file."})
    if len(body) > MAX_BODY_CHARS:
        raise ValidationError({"body": f"Keep a message under {MAX_BODY_CHARS} characters."})
    if body:
        return body, None
    kinds = [attachment_kind(getattr(f, "content_type", "") or "") for f in files]
    if all(k == "audio" for k in kinds):
        preview = "🎤 Voice message"
    elif all(k == "image" for k in kinds):
        preview = "📷 Photo" if len(files) == 1 else f"📷 {len(files)} photos"
    else:
        preview = "📎 Attachment" if len(files) == 1 else f"📎 {len(files)} files"
    return body, preview


def _save_attachments(message, request, files, *, is_group):
    raw = request.data.get("duration_ms")
    duration_ms = None
    if raw not in (None, ""):
        try:
            duration_ms = max(0, int(raw))
        except (TypeError, ValueError):
            duration_ms = None
    for f in files:
        ct = getattr(f, "content_type", "") or ""
        kind = attachment_kind(ct)
        MessageAttachment.objects.create(
            direct_message=None if is_group else message,
            group_message=message if is_group else None,
            file=f,
            original_name=(getattr(f, "name", "") or "")[:255],
            content_type=ct[:120],
            size=getattr(f, "size", 0) or 0,
            kind=kind,
            duration_ms=duration_ms if kind == MessageAttachment.AUDIO else None,
        )


class ConversationViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = ConversationSerializer
    permission_classes = [IsAuthenticated]

    def base_queryset(self):
        """Every thread the viewer is in, annotated for their own clear-point.

        Deliberately *not* filtered down to what shows in the list: clearing a
        conversation hides it from the list, it doesn't revoke access to it. A
        staff member who clears a thread must still be able to open it by id and
        write in it — they can't start a new one, so a hard 404 here would strand
        them until the other side happened to message first.
        """
        user = self.request.user
        latest = DirectMessage.objects.filter(
            conversation=OuterRef("pk"), created_at__gt=OuterRef("_cleared")
        ).order_by("-created_at")
        visible = Q(messages__created_at__gt=F("_cleared"))
        return (
            Conversation.visible_to(user)
            .select_related("user_low", "user_high")
            .prefetch_related("user_low__roles", "user_high__roles")
            .annotate(_cleared=cleared_expression(user))
            .annotate(
                unread_count=Count(
                    "messages",
                    filter=(
                        Q(messages__read_at__isnull=True)
                        & Q(messages__deleted_at__isnull=True)
                        & ~Q(messages__sender=user)
                        & visible
                    ),
                    distinct=True,
                ),
                message_count=Count("messages", filter=visible, distinct=True),
                last_body=Subquery(latest.values("body")[:1]),
                last_sender_id=Subquery(latest.values("sender_id")[:1]),
                last_deleted_at=Subquery(latest.values("deleted_at")[:1]),
            )
            # Spelled out rather than left to Meta.ordering: annotating adds a
            # GROUP BY, which drops the model default and would let pagination
            # hand back rows in an unstable order.
            .order_by("-last_message_at", "-created_at")
        )

    def get_queryset(self):
        """What belongs on the viewer's conversation list."""
        return self.base_queryset().filter(
            # Nothing left to show after their own clear-point drops out…
            Q(message_count__gt=0)
            # …except an opened-but-unwritten thread, which is only the opener's
            # business — the other person shouldn't see an empty conversation
            # appear. That courtesy ends once the opener clears it themselves,
            # or clearing an empty thread you started would leave it stuck.
            | (Q(started_by=self.request.user) & Q(_cleared=NEVER_CLEARED))
        )

    def get_object(self):
        """Look up by id in the unfiltered set — see ``base_queryset``."""
        obj = get_object_or_404(self.base_queryset(), pk=self.kwargs["pk"])
        self.check_object_permissions(self.request, obj)
        return obj

    def create(self, request: Request) -> Response:
        """Open (or reuse) a thread with one person, optionally with a first line.

        Starting a conversation is the gated action; ``recipient`` is a user id.
        Passing ``body`` sends the opening message in the same call, which is
        what the quick-send dialog does.
        """
        if not can_start_conversation(request.user):
            raise PermissionDenied("Your account can't start a direct message.")

        raw = request.data.get("recipient")
        try:
            recipient_id = int(raw)
        except (TypeError, ValueError):
            raise ValidationError({"recipient": "Choose someone to message."})
        if recipient_id == request.user.id:
            raise ValidationError({"recipient": "You can't message yourself."})
        recipient = User.objects.filter(pk=recipient_id, is_active=True).first()
        if recipient is None:
            raise ValidationError({"recipient": "That person is not an active user."})

        conversation, created = Conversation.between(
            request.user, recipient, started_by=request.user
        )
        if created:
            # Who opened a private line to whom is governance-relevant, so it is
            # audited. The messages themselves are not — logging their contents
            # would defeat the point of a private thread.
            record(
                action=AuditAction.CREATE, obj=conversation,
                new_value={"with": recipient.get_full_name() or recipient.username},
                request=request,
            )

        if (request.data.get("body") or "").strip():
            send_message(conversation, request.user, clean_body(request.data.get("body")))

        return Response(self._serialize(conversation.pk), status=201 if created else 200)

    @action(detail=True, methods=["get", "post"])
    def messages(self, request: Request, pk=None) -> Response:
        """Read the thread, or add a line to it. Either way you must be in it —
        ``get_object`` already restricts to the viewer's own conversations."""
        conversation = self.get_object()

        if request.method == "POST":
            files = _incoming_files(request)
            body, preview = _body_and_preview(request, files)
            message = send_message(conversation, request.user, body, preview=preview)
            _save_attachments(message, request, files, is_group=False)
            return Response(
                DirectMessageSerializer(message, context={"request": request}).data, status=201
            )

        rows = list(
            conversation.visible_messages(request.user)
            .select_related("sender")
            .prefetch_related("attachments")
            .order_by("-created_at")[:THREAD_LIMIT]
        )
        rows.reverse()  # oldest → newest, the order a thread reads in
        return Response(DirectMessageSerializer(rows, many=True, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def read(self, request: Request, pk=None) -> Response:
        conversation = self.get_object()
        count = mark_thread_read(conversation, request.user)
        return Response({"marked": count})

    def destroy(self, request: Request, pk=None) -> Response:
        """Delete the conversation — from *your* list only.

        Not a real delete: it stamps your own clear-point, hiding everything
        said so far from you while the other person's copy stays exactly as it
        was. Neither participant can erase the other's record, and a later
        message brings the thread back with only what comes after it.
        """
        conversation = self.get_object()
        conversation.clear_for(request.user)
        return Response(status=204)

    @action(detail=False, methods=["get"])
    def unread_count(self, request: Request) -> Response:
        rows = unread_for(request.user)
        return Response({
            "unread": rows.count(),
            "threads": rows.values("conversation_id").distinct().count(),
        })

    def _serialize(self, pk: int) -> dict:
        obj = self.base_queryset().get(pk=pk)
        return ConversationSerializer(obj, context={"request": self.request}).data


class DirectMessageViewSet(viewsets.GenericViewSet):
    """Correcting and retracting individual lines — your own only.

    Both live here rather than under the conversation because they act on one
    message, and the message id is enough to find its thread.
    """

    serializer_class = DirectMessageSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        # Restricted to threads the viewer is in, so an unrelated message id
        # 404s rather than reporting "not yours".
        return DirectMessage.objects.filter(
            conversation__in=Conversation.visible_to(self.request.user)
        ).select_related("sender", "conversation")

    def partial_update(self, request: Request, pk=None) -> Response:
        """Correct your own wording, within the edit window."""
        message = self.get_object()
        if message.sender_id != request.user.id:
            raise PermissionDenied("You can only edit your own messages.")
        if message.deleted_at is not None:
            raise ValidationError("That message was deleted.")
        if not can_edit(message, request.user):
            raise ValidationError(
                "This message is too old to edit. Send a follow-up instead."
            )
        message.body = clean_body(request.data.get("body"))
        message.edited_at = timezone.now()
        message.save(update_fields=["body", "edited_at"])
        return Response(DirectMessageSerializer(message, context={"request": request}).data)

    def destroy(self, request: Request, pk=None) -> Response:
        """Retract your own message, leaving a tombstone in the thread.

        Returns the tombstone rather than an empty 204 so the caller can render
        "This message was deleted" in place without refetching the thread.
        """
        message = self.get_object()
        if message.sender_id != request.user.id:
            raise PermissionDenied("You can only delete your own messages.")
        if message.deleted_at is None:
            message.soft_delete()
        return Response(DirectMessageSerializer(message, context={"request": request}).data)


class GroupThreadViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    """Group chats — named threads with any number of members.

    Anyone active can create one and add anyone; the creator is its admin
    (rename). Any member can add more people or leave.
    """

    serializer_class = GroupThreadSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return (
            GroupThread.visible_to(self.request.user)
            .prefetch_related("memberships__user__roles")
            .distinct()
        )

    def get_object(self):
        return get_object_or_404(self.get_queryset(), pk=self.kwargs["pk"])

    def _resolve_members(self, ids):
        clean = []
        for raw in ids or []:
            try:
                clean.append(int(raw))
            except (TypeError, ValueError):
                continue
        return list(User.objects.filter(pk__in=clean, is_active=True))

    def _serialize(self, pk: int) -> dict:
        obj = self.get_queryset().get(pk=pk)
        return GroupThreadSerializer(obj, context={"request": self.request}).data

    def create(self, request: Request) -> Response:
        if not can_start_conversation(request.user):
            raise PermissionDenied("Your account can't create a group.")
        name = (request.data.get("name") or "").strip()
        if not name:
            raise ValidationError({"name": "Give the group a name."})
        if len(name) > 120:
            raise ValidationError({"name": "Keep the group name under 120 characters."})
        members = [u for u in self._resolve_members(request.data.get("members")) if u.id != request.user.id]
        if not members:
            raise ValidationError({"members": "Add at least one other person."})

        thread = GroupThread.objects.create(name=name, created_by=request.user, last_message_at=timezone.now())
        GroupMembership.objects.create(thread=thread, user=request.user, is_admin=True)
        for u in members:
            GroupMembership.objects.get_or_create(thread=thread, user=u)
        record(
            action=AuditAction.CREATE, obj=thread,
            new_value={"name": name, "members": [u.get_full_name() or u.username for u in members]},
            request=request,
        )
        if (request.data.get("body") or "").strip():
            send_group_message(thread, request.user, clean_body(request.data.get("body")))
        return Response(self._serialize(thread.pk), status=201)

    @action(detail=True, methods=["get", "post"])
    def messages(self, request: Request, pk=None) -> Response:
        thread = self.get_object()
        if request.method == "POST":
            files = _incoming_files(request)
            body, preview = _body_and_preview(request, files)
            message = send_group_message(thread, request.user, body, preview=preview)
            _save_attachments(message, request, files, is_group=True)
            return Response(GroupMessageSerializer(message, context={"request": request}).data, status=201)
        rows = list(
            thread.visible_messages(request.user).select_related("sender")
            .prefetch_related("attachments").order_by("-created_at")[:THREAD_LIMIT]
        )
        rows.reverse()
        return Response(GroupMessageSerializer(rows, many=True, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def read(self, request: Request, pk=None) -> Response:
        thread = self.get_object()
        return Response({"marked": mark_group_read(thread, request.user)})

    @action(detail=True, methods=["post"])
    def members(self, request: Request, pk=None) -> Response:
        """Add people to the group. Any member may add (open policy)."""
        thread = self.get_object()
        added = []
        for u in self._resolve_members(request.data.get("members")):
            _, created = GroupMembership.objects.get_or_create(thread=thread, user=u)
            if created:
                added.append(u)
        if added:
            record(
                action=AuditAction.UPDATE, obj=thread,
                new_value={"added": [u.get_full_name() or u.username for u in added]}, request=request,
            )
        return Response(self._serialize(thread.pk))

    @action(detail=True, methods=["post"])
    def leave(self, request: Request, pk=None) -> Response:
        """Leave the group. If the last member leaves, the group is removed; if an
        admin leaves, the earliest remaining member becomes admin so it's never
        left without one."""
        thread = self.get_object()
        m = thread.membership_for(request.user)
        if m:
            was_admin = m.is_admin
            m.delete()
            remaining = thread.memberships.order_by("joined_at")
            if not remaining.exists():
                thread.delete()
            elif was_admin and not remaining.filter(is_admin=True).exists():
                first = remaining.first()
                first.is_admin = True
                first.save(update_fields=["is_admin"])
        return Response(status=204)

    def partial_update(self, request: Request, pk=None) -> Response:
        """Rename the group — admin only."""
        thread = self.get_object()
        if not thread.is_admin(request.user):
            raise PermissionDenied("Only the group's admin can rename it.")
        name = (request.data.get("name") or "").strip()
        if not name:
            raise ValidationError({"name": "Give the group a name."})
        thread.name = name[:120]
        thread.save(update_fields=["name"])
        return Response(self._serialize(thread.pk))

    @action(detail=False, methods=["get"])
    def unread_count(self, request: Request) -> Response:
        return Response(total_group_unread(request.user))


class GroupMessageViewSet(viewsets.GenericViewSet):
    """Correcting and retracting individual group messages — your own only."""

    serializer_class = GroupMessageSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return GroupMessage.objects.filter(
            thread__in=GroupThread.visible_to(self.request.user)
        ).select_related("sender", "thread")

    def partial_update(self, request: Request, pk=None) -> Response:
        message = self.get_object()
        if message.sender_id != request.user.id:
            raise PermissionDenied("You can only edit your own messages.")
        if message.deleted_at is not None:
            raise ValidationError("That message was deleted.")
        if not can_edit(message, request.user):
            raise ValidationError("This message is too old to edit. Send a follow-up instead.")
        message.body = clean_body(request.data.get("body"))
        message.edited_at = timezone.now()
        message.save(update_fields=["body", "edited_at"])
        return Response(GroupMessageSerializer(message, context={"request": request}).data)

    def destroy(self, request: Request, pk=None) -> Response:
        message = self.get_object()
        if message.sender_id != request.user.id:
            raise PermissionDenied("You can only delete your own messages.")
        if message.deleted_at is None:
            message.soft_delete()
        return Response(GroupMessageSerializer(message, context={"request": request}).data)


class MessageDirectoryView(APIView):
    """Who the viewer can write to, and whether they may start a new thread.

    Everyone can load this — someone who can't start a conversation still gets
    ``can_start: false`` and an empty list, which is what the UI needs to
    explain itself rather than showing a button that always fails.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        allowed = can_start_conversation(request.user)
        if not allowed:
            return Response({"can_start": False, "people": []})
        people = (
            User.objects.filter(is_active=True)
            .exclude(pk=request.user.pk)
            .prefetch_related("roles")
            .order_by("first_name", "last_name", "username")
        )
        return Response({"can_start": True, "people": PersonSerializer(people, many=True).data})
