from rest_framework import serializers

from .models import Notification, NotificationPreference


class NotificationSerializer(serializers.ModelSerializer):
    needs_acknowledgement = serializers.BooleanField(read_only=True)

    class Meta:
        model = Notification
        fields = (
            "id", "event", "title", "body", "url", "task", "project",
            "is_read", "requires_acknowledgement", "needs_acknowledgement",
            "acknowledged_at", "acknowledgement_message", "created_at",
        )


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationPreference
        fields = ("inapp_enabled", "email_enabled", "daily_digest")
