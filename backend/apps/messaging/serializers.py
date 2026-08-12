"""Serializers for direct messages.

``ConversationSerializer`` reads the annotations the viewset attaches
(``unread``, ``last_body``, ``last_sender_id``) rather than walking the message
table per row, so listing threads stays one query.
"""
from __future__ import annotations

from rest_framework import serializers

from .models import Conversation, DirectMessage, GroupMessage, GroupThread, MessageAttachment
from .services import can_edit, group_unread_for


class MessageAttachmentSerializer(serializers.ModelSerializer):
    name = serializers.CharField(read_only=True)
    url = serializers.SerializerMethodField()

    class Meta:
        model = MessageAttachment
        fields = ("id", "url", "name", "kind", "content_type", "size", "duration_ms")

    def get_url(self, obj) -> str:
        if not obj.file:
            return ""
        url = obj.file.url
        # MEDIA_URL has no leading slash; force one so the absolute URL points at
        # the backend host, not wherever the API call happened to be made from.
        if "://" not in url and not url.startswith("/"):
            url = "/" + url
        request = self.context.get("request")
        return request.build_absolute_uri(url) if request else url


class PersonSerializer(serializers.Serializer):
    """The minimum needed to render someone in a thread list or picker."""

    id = serializers.IntegerField()
    name = serializers.SerializerMethodField()
    username = serializers.CharField()
    email = serializers.CharField()
    role = serializers.SerializerMethodField()

    def get_name(self, user) -> str:
        return user.get_full_name() or user.username

    def get_role(self, user) -> str:
        names = getattr(user, "_prefetched_role_names", None)
        if names is None:
            names = [r.name for r in user.roles.all()]
        return names[0] if names else ""


class DirectMessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.SerializerMethodField()
    mine = serializers.SerializerMethodField()
    deleted = serializers.BooleanField(source="is_deleted", read_only=True)
    can_edit = serializers.SerializerMethodField()
    attachments = MessageAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = DirectMessage
        fields = (
            "id", "conversation", "sender", "sender_name", "mine", "body",
            "created_at", "read_at", "edited_at", "deleted", "can_edit", "attachments",
        )
        read_only_fields = ("conversation", "sender", "created_at", "read_at", "edited_at")

    def _viewer(self):
        request = self.context.get("request")
        return request.user if request else None

    def get_sender_name(self, obj) -> str:
        return obj.sender.get_full_name() or obj.sender.username

    def get_mine(self, obj) -> bool:
        user = self._viewer()
        return bool(user and obj.sender_id == user.id)

    def get_can_edit(self, obj) -> bool:
        """Whether the *viewer* may still correct this one — the UI shows or
        hides the Edit action from this rather than re-deriving the window."""
        user = self._viewer()
        return bool(user and can_edit(obj, user))


class ConversationSerializer(serializers.ModelSerializer):
    other = serializers.SerializerMethodField()
    unread = serializers.SerializerMethodField()
    last_message = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = ("id", "other", "unread", "last_message", "last_message_at", "created_at")

    def _viewer(self):
        request = self.context.get("request")
        return request.user if request else None

    def get_other(self, obj):
        viewer = self._viewer()
        if viewer is None:
            return None
        return PersonSerializer(obj.other_party(viewer)).data

    def get_unread(self, obj) -> int:
        return getattr(obj, "unread_count", 0) or 0

    def get_last_message(self, obj):
        sender_id = getattr(obj, "last_sender_id", None)
        if sender_id is None:
            return None
        # A retracted last message still belongs in the preview — the row is
        # gated on the sender, not the body, because a tombstone has no body.
        viewer = self._viewer()
        return {
            "body": getattr(obj, "last_body", None) or "",
            "sender": sender_id,
            "mine": bool(viewer and sender_id == viewer.id),
            "deleted": getattr(obj, "last_deleted_at", None) is not None,
        }


class GroupMessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.SerializerMethodField()
    mine = serializers.SerializerMethodField()
    deleted = serializers.BooleanField(source="is_deleted", read_only=True)
    can_edit = serializers.SerializerMethodField()
    attachments = MessageAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = GroupMessage
        fields = (
            "id", "thread", "sender", "sender_name", "mine", "body",
            "created_at", "edited_at", "deleted", "can_edit", "attachments",
        )
        read_only_fields = ("thread", "sender", "created_at", "edited_at")

    def _viewer(self):
        request = self.context.get("request")
        return request.user if request else None

    def get_sender_name(self, obj) -> str:
        return obj.sender.get_full_name() or obj.sender.username

    def get_mine(self, obj) -> bool:
        user = self._viewer()
        return bool(user and obj.sender_id == user.id)

    def get_can_edit(self, obj) -> bool:
        user = self._viewer()
        return bool(user and can_edit(obj, user))


class GroupThreadSerializer(serializers.ModelSerializer):
    """A group in the conversation list. ``kind`` lets the client render DMs and
    groups in one merged inbox."""

    kind = serializers.SerializerMethodField()
    members = serializers.SerializerMethodField()
    member_count = serializers.SerializerMethodField()
    is_admin = serializers.SerializerMethodField()
    unread = serializers.SerializerMethodField()
    last_message = serializers.SerializerMethodField()

    class Meta:
        model = GroupThread
        fields = (
            "id", "name", "kind", "members", "member_count", "is_admin",
            "unread", "last_message", "last_message_at", "created_at", "created_by",
        )

    def _viewer(self):
        request = self.context.get("request")
        return request.user if request else None

    def get_kind(self, obj) -> str:
        return "group"

    def get_members(self, obj):
        return PersonSerializer([m.user for m in obj.memberships.all()], many=True).data

    def get_member_count(self, obj) -> int:
        return obj.memberships.count()

    def get_is_admin(self, obj) -> bool:
        viewer = self._viewer()
        return bool(viewer and obj.is_admin(viewer))

    def get_unread(self, obj) -> int:
        viewer = self._viewer()
        return group_unread_for(obj, viewer) if viewer else 0

    def get_last_message(self, obj):
        last = obj.messages.order_by("-created_at").select_related("sender").first()
        if last is None:
            return None
        viewer = self._viewer()
        return {
            "body": last.body or "",
            "sender": last.sender_id,
            "sender_name": last.sender.get_full_name() or last.sender.username,
            "mine": bool(viewer and last.sender_id == viewer.id),
            "deleted": last.deleted_at is not None,
        }
