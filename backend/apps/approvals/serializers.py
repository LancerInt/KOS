"""Serializers for approvals (PRD §13)."""
from __future__ import annotations

from rest_framework import serializers

from apps.projects.models import Project
from apps.tasks.models import Task

from .models import ApprovalKind, ApprovalRequest


class ApprovalRequestSerializer(serializers.ModelSerializer):
    requested_by_name = serializers.SerializerMethodField()
    approver_name = serializers.SerializerMethodField()
    target_project = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalRequest
        fields = (
            "id", "kind", "status", "task", "project", "target_label",
            "requested_by", "requested_by_name", "approver", "approver_name",
            "acted_at", "decision_reason", "payload", "target_project", "created_at",
        )

    def get_requested_by_name(self, obj: ApprovalRequest) -> str:
        return (obj.requested_by.get_full_name() or obj.requested_by.username) if obj.requested_by_id else ""

    def get_approver_name(self, obj: ApprovalRequest) -> str:
        return (obj.approver.get_full_name() or obj.approver.username) if obj.approver_id else ""

    def get_target_project(self, obj: ApprovalRequest) -> int | None:
        p = obj.target_project()
        return p.id if p else None


class CreateApprovalSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=ApprovalKind.choices)
    task = serializers.PrimaryKeyRelatedField(queryset=Task.objects.all(), required=False, allow_null=True)
    project = serializers.PrimaryKeyRelatedField(queryset=Project.objects.all(), required=False, allow_null=True)
    payload = serializers.JSONField(required=False, default=dict)

    def validate(self, attrs):
        kind = attrs["kind"]
        task = attrs.get("task")
        project = attrs.get("project")

        if kind in (ApprovalKind.DELIVERABLE, ApprovalKind.DEADLINE_CHANGE) and task is None:
            raise serializers.ValidationError({"task": "A task is required for this approval."})
        if kind == ApprovalKind.DELETION and task is None and project is None:
            raise serializers.ValidationError("A task or project is required for a deletion request.")
        if kind == ApprovalKind.DEADLINE_CHANGE and not attrs.get("payload", {}).get("new_due_date"):
            raise serializers.ValidationError({"payload": "new_due_date is required for a deadline change."})
        return attrs
