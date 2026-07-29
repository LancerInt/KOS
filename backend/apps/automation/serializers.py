"""Serializers for automation rules & logs (PRD §24)."""
from __future__ import annotations

from rest_framework import serializers

from .models import AutomationLog, AutomationRule


class AutomationRuleSerializer(serializers.ModelSerializer):
    trigger_display = serializers.CharField(source="get_trigger_display", read_only=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = AutomationRule
        fields = (
            "id", "name", "description", "project", "trigger", "trigger_display",
            "conditions", "actions", "is_active", "order",
            "created_by", "created_by_name", "run_count", "last_run_at", "created_at",
        )
        read_only_fields = ("created_by", "run_count", "last_run_at")

    def get_created_by_name(self, obj: AutomationRule) -> str:
        u = obj.created_by
        return (u.get_full_name() or u.username) if u else ""


class AutomationLogSerializer(serializers.ModelSerializer):
    trigger_display = serializers.CharField(source="get_trigger_display", read_only=True)

    class Meta:
        model = AutomationLog
        fields = ("id", "rule", "rule_name", "trigger", "trigger_display", "task", "project",
                  "actions_run", "ok", "message", "created_at")
