"""Serializers for dependencies & blockers (PRD §14, §15)."""
from __future__ import annotations

from rest_framework import serializers

from .models import Blocker, Dependency, DependencyType


def _creates_cycle(predecessor_id: int, successor_id: int) -> bool:
    """Would making ``successor`` depend on ``predecessor`` create a cycle?

    A cycle exists if ``predecessor`` already (transitively) depends on
    ``successor``. We walk the predecessor's own dependency chain (§14.3, AC-14).
    """
    if predecessor_id == successor_id:
        return True
    stack, seen = [predecessor_id], set()
    while stack:
        current = stack.pop()
        if current == successor_id:
            return True
        if current in seen:
            continue
        seen.add(current)
        stack.extend(
            Dependency.objects.filter(successor_id=current, predecessor_task__isnull=False)
            .values_list("predecessor_task_id", flat=True)
        )
    return False


class DependencySerializer(serializers.ModelSerializer):
    label = serializers.CharField(source="short_label", read_only=True)
    is_satisfied = serializers.BooleanField(read_only=True)

    class Meta:
        model = Dependency
        fields = (
            "id", "successor", "predecessor_task", "predecessor_milestone",
            "dependency_type", "is_mandatory", "external_note",
            "label", "is_satisfied", "created_at",
        )

    def validate(self, attrs):
        dtype = attrs.get("dependency_type")
        successor = attrs.get("successor")
        pred_task = attrs.get("predecessor_task")
        pred_ms = attrs.get("predecessor_milestone")

        if dtype in (DependencyType.FINISH_TO_START, DependencyType.START_TO_START):
            if pred_task is None:
                raise serializers.ValidationError({"predecessor_task": "A predecessor task is required."})
            if _creates_cycle(pred_task.id, successor.id):
                raise serializers.ValidationError("This dependency would create a circular reference.")
        elif dtype == DependencyType.MILESTONE:
            if pred_ms is None:
                raise serializers.ValidationError({"predecessor_milestone": "A milestone is required."})
        elif dtype == DependencyType.EXTERNAL:
            if not attrs.get("external_note"):
                raise serializers.ValidationError({"external_note": "Describe the external dependency."})
        return attrs


class BlockerSerializer(serializers.ModelSerializer):
    resolver_name = serializers.SerializerMethodField()
    raised_by_name = serializers.SerializerMethodField()
    is_open = serializers.BooleanField(read_only=True)
    age_hours = serializers.IntegerField(read_only=True)

    class Meta:
        model = Blocker
        fields = (
            "id", "task", "description", "resolver", "resolver_name",
            "severity", "target_resolution_date", "raised_by", "raised_by_name",
            "resolved_at", "resolution_note", "is_open", "age_hours", "created_at",
        )
        read_only_fields = ("raised_by", "resolved_at", "resolution_note")

    def get_resolver_name(self, obj: Blocker) -> str:
        return (obj.resolver.get_full_name() or obj.resolver.username) if obj.resolver_id else ""

    def get_raised_by_name(self, obj: Blocker) -> str:
        return (obj.raised_by.get_full_name() or obj.raised_by.username) if obj.raised_by_id else ""
