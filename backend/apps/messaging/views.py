"""Direct-message endpoints.

* ``GET/POST /conversations/``                 — my threads / open a new one
* ``GET/POST /conversations/{id}/messages/``   — read a thread / write in it
* ``POST     /conversations/{id}/read/``       — mark the other side's lines read
* ``GET      /conversations/unread_count/``    — sidebar badge
* ``GET      /message-directory/``             — who I may write to
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db.models import Count, OuterRef, Q, Subquery
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditAction
from apps.audit.services import record

from .models import Conversation, DirectMessage
from .permissions import can_start_conversation
from .serializers import ConversationSerializer, DirectMessageSerializer, PersonSerializer
from .services import mark_thread_read, send_message, unread_for

User = get_user_model()

# A thread view returns at most this many of the most recent lines. Long enough
# that no real conversation is truncated in practice, bounded so a single
# request can't pull an unbounded history.
THREAD_LIMIT = 300
MAX_BODY_CHARS = 5000


class ConversationViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = ConversationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        latest = DirectMessage.objects.filter(conversation=OuterRef("pk")).order_by("-created_at")
        return (
            Conversation.visible_to(user)
            .select_related("user_low", "user_high")
            .prefetch_related("user_low__roles", "user_high__roles")
            .annotate(
                unread_count=Count(
                    "messages",
                    filter=Q(messages__read_at__isnull=True) & ~Q(messages__sender=user),
                    distinct=True,
                ),
                message_count=Count("messages", distinct=True),
                last_body=Subquery(latest.values("body")[:1]),
                last_sender_id=Subquery(latest.values("sender_id")[:1]),
            )
            # An opened-but-unwritten thread is only the opener's business —
            # the other person shouldn't see an empty conversation appear.
            .filter(Q(message_count__gt=0) | Q(started_by=user))
            # Spelled out rather than left to Meta.ordering: annotating adds a
            # GROUP BY, which drops the model default and would let pagination
            # hand back rows in an unstable order.
            .order_by("-last_message_at", "-created_at")
        )

    def create(self, request: Request) -> Response:
        """Open (or reuse) a thread with one person, optionally with a first line.

        Starting a conversation is the gated action; ``recipient`` is a user id.
        Passing ``body`` sends the opening message in the same call, which is
        what the quick-send dialog does.
        """
        if not can_start_conversation(request.user):
            raise PermissionDenied("Only Management or IT Team can start a direct message.")

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

        body = (request.data.get("body") or "").strip()
        if body:
            send_message(conversation, request.user, self._clean_body(body))

        return Response(self._serialize(conversation.pk), status=201 if created else 200)

    @action(detail=True, methods=["get", "post"])
    def messages(self, request: Request, pk=None) -> Response:
        """Read the thread, or add a line to it. Either way you must be in it —
        ``get_object`` already restricts to the viewer's own conversations."""
        conversation = self.get_object()

        if request.method == "POST":
            body = self._clean_body((request.data.get("body") or "").strip())
            if not body:
                raise ValidationError({"body": "Write something first."})
            message = send_message(conversation, request.user, body)
            return Response(
                DirectMessageSerializer(message, context={"request": request}).data, status=201
            )

        rows = list(
            conversation.messages.select_related("sender").order_by("-created_at")[:THREAD_LIMIT]
        )
        rows.reverse()  # oldest → newest, the order a thread reads in
        return Response(DirectMessageSerializer(rows, many=True, context={"request": request}).data)

    @action(detail=True, methods=["post"])
    def read(self, request: Request, pk=None) -> Response:
        conversation = self.get_object()
        count = mark_thread_read(conversation, request.user)
        return Response({"marked": count})

    @action(detail=False, methods=["get"])
    def unread_count(self, request: Request) -> Response:
        rows = unread_for(request.user)
        return Response({
            "unread": rows.count(),
            "threads": rows.values("conversation_id").distinct().count(),
        })

    def _serialize(self, pk: int) -> dict:
        obj = self.get_queryset().get(pk=pk)
        return ConversationSerializer(obj, context={"request": self.request}).data

    @staticmethod
    def _clean_body(body: str) -> str:
        if len(body) > MAX_BODY_CHARS:
            raise ValidationError({"body": f"Keep a message under {MAX_BODY_CHARS} characters."})
        return body


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
