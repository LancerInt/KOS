"""Serializers for direct messages.

``ConversationSerializer`` reads the annotations the viewset attaches
(``unread``, ``last_body``, ``last_sender_id``) rather than walking the message
table per row, so listing threads stays one query.
"""
from __future__ import annotations

from rest_framework import serializers

from .models import Conversation, DirectMessage


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

    class Meta:
        model = DirectMessage
        fields = ("id", "conversation", "sender", "sender_name", "mine", "body", "created_at", "read_at")
        read_only_fields = ("conversation", "sender", "created_at", "read_at")

    def get_sender_name(self, obj) -> str:
        return obj.sender.get_full_name() or obj.sender.username

    def get_mine(self, obj) -> bool:
        user = self.context.get("request").user if self.context.get("request") else None
        return bool(user and obj.sender_id == user.id)


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
        body = getattr(obj, "last_body", None)
        if not body:
            return None
        viewer = self._viewer()
        sender_id = getattr(obj, "last_sender_id", None)
        return {
            "body": body,
            "sender": sender_id,
            "mine": bool(viewer and sender_id == viewer.id),
        }
