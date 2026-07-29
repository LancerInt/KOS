"""Serializers for the registers (PRD §17)."""
from __future__ import annotations

from rest_framework import serializers

from .models import Decision, Issue, Risk


def _name(user) -> str:
    return (user.get_full_name() or user.username) if user else ""


class RiskSerializer(serializers.ModelSerializer):
    owner_name = serializers.SerializerMethodField()
    score = serializers.IntegerField(read_only=True)

    class Meta:
        model = Risk
        fields = (
            "id", "project", "statement", "probability", "impact", "score",
            "mitigation", "contingency", "owner", "owner_name", "review_date",
            "status", "related_tasks", "created_at",
        )

    def get_owner_name(self, obj: Risk) -> str:
        return _name(obj.owner)


class IssueSerializer(serializers.ModelSerializer):
    owner_name = serializers.SerializerMethodField()

    class Meta:
        model = Issue
        fields = (
            "id", "project", "description", "severity", "owner", "owner_name",
            "corrective_action", "target_resolution_date", "closure_evidence",
            "status", "related_tasks", "created_at",
        )

    def get_owner_name(self, obj: Issue) -> str:
        return _name(obj.owner)


class DecisionSerializer(serializers.ModelSerializer):
    decision_maker_name = serializers.SerializerMethodField()

    class Meta:
        model = Decision
        fields = (
            "id", "project", "decision_required", "options_considered",
            "decision_maker", "decision_maker_name", "decision", "decided_on",
            "rationale", "supporting_document", "status", "related_tasks", "created_at",
        )

    def get_decision_maker_name(self, obj: Decision) -> str:
        return _name(obj.decision_maker)
