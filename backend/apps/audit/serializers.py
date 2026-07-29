"""Serializers for the audit trail & retention policies (PRD §26)."""
from __future__ import annotations

from rest_framework import serializers

from .models import AuditLog, RetentionPolicy


class AuditLogSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()
    action_display = serializers.CharField(source="get_action_display", read_only=True)

    class Meta:
        model = AuditLog
        fields = (
            "id", "actor", "actor_name", "action", "action_display",
            "object_type", "object_id", "old_value", "new_value",
            "reason", "source_ip", "created_at",
        )

    def get_actor_name(self, obj: AuditLog) -> str:
        u = obj.actor
        if not u:
            return "System"
        return u.get_full_name() or u.username


class RetentionPolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = RetentionPolicy
        fields = ("id", "record_type", "label", "retention_days", "is_exempt", "description", "updated_at")
        read_only_fields = ("record_type", "label")
