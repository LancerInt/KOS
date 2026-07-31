from rest_framework import serializers

from .models import EmailAccount, Notification, NotificationPreference


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


class EmailAccountSerializer(serializers.ModelSerializer):
    """The KOS outbound email account. The password is write-only — it is never
    returned; ``has_password`` tells the UI whether one is stored."""

    has_password = serializers.BooleanField(read_only=True)
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = EmailAccount
        fields = ("host", "port", "use_tls", "username", "from_email",
                  "is_enabled", "has_password", "password", "updated_at")
        read_only_fields = ("updated_at",)

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        for key, value in validated_data.items():
            setattr(instance, key, value)
        if password:  # only replace when a non-blank password is supplied
            instance.set_password(password)
        instance.save()
        return instance
