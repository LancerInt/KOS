"""Serializers for agile & sprints (PRD §16)."""
from __future__ import annotations

from rest_framework import serializers

from .models import RetrospectiveItem, Sprint


class RetrospectiveItemSerializer(serializers.ModelSerializer):
    owner_name = serializers.SerializerMethodField()

    class Meta:
        model = RetrospectiveItem
        fields = ("id", "sprint", "kind", "text", "owner", "owner_name", "due_date", "created_at")

    def get_owner_name(self, obj: RetrospectiveItem) -> str:
        return (obj.owner.get_full_name() or obj.owner.username) if obj.owner_id else ""


class SprintSerializer(serializers.ModelSerializer):
    owner_name = serializers.SerializerMethodField()
    task_count = serializers.IntegerField(source="tasks.count", read_only=True)

    class Meta:
        model = Sprint
        fields = (
            "id", "project", "name", "objective", "start_date", "end_date",
            "owner", "owner_name", "status", "is_baselined", "baselined_at",
            "retrospective_notes", "task_count", "created_at",
        )
        extra_kwargs = {"owner": {"required": False, "allow_null": True}}

    def get_owner_name(self, obj: Sprint) -> str:
        return (obj.owner.get_full_name() or obj.owner.username) if obj.owner_id else ""


class SprintDetailSerializer(SprintSerializer):
    retro_items = RetrospectiveItemSerializer(many=True, read_only=True)

    class Meta(SprintSerializer.Meta):
        fields = SprintSerializer.Meta.fields + ("retro_items",)
