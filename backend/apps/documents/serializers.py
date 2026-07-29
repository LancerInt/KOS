"""Serializers for documents & SOPs (PRD §18, §19)."""
from __future__ import annotations

from rest_framework import serializers

from .models import (
    SOP_TRANSITIONS,
    Document,
    DocumentVersion,
    SOP,
    SOPVersion,
)


def _name(user) -> str:
    return (user.get_full_name() or user.username) if user else ""


class DocumentVersionSerializer(serializers.ModelSerializer):
    uploaded_by_name = serializers.SerializerMethodField()
    is_current = serializers.SerializerMethodField()

    class Meta:
        model = DocumentVersion
        fields = (
            "id", "version_number", "original_filename", "size_bytes", "content_type",
            "uploaded_by", "uploaded_by_name", "notes", "created_at", "is_current",
        )

    def get_uploaded_by_name(self, obj: DocumentVersion) -> str:
        return _name(obj.uploaded_by)

    def get_is_current(self, obj: DocumentVersion) -> bool:
        return obj.document.current_version_id == obj.id


class DocumentSerializer(serializers.ModelSerializer):
    owner_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    version_number = serializers.IntegerField(read_only=True)
    is_expired = serializers.BooleanField(read_only=True)
    expires_in_days = serializers.IntegerField(read_only=True, allow_null=True)
    versions = DocumentVersionSerializer(many=True, read_only=True)

    class Meta:
        model = Document
        fields = (
            "id", "project", "title", "description", "category", "tags",
            "status", "status_display", "owner", "owner_name",
            "version_number", "approved_by", "approved_by_name", "approved_at",
            "expiry_date", "reminder_lead_days", "expires_in_days", "is_expired",
            "versions", "created_at", "updated_at",
        )
        read_only_fields = ("status", "owner", "approved_by", "approved_at", "project")

    def get_owner_name(self, obj: Document) -> str:
        return _name(obj.owner)

    def get_approved_by_name(self, obj: Document) -> str:
        return _name(obj.approved_by)


class SOPVersionSerializer(serializers.ModelSerializer):
    published_by_name = serializers.SerializerMethodField()

    class Meta:
        model = SOPVersion
        fields = ("id", "version_number", "content", "change_summary", "published_by_name", "created_at")

    def get_published_by_name(self, obj: SOPVersion) -> str:
        return _name(obj.published_by)


class SOPSerializer(serializers.ModelSerializer):
    owner_name = serializers.SerializerMethodField()
    department_name = serializers.SerializerMethodField()
    approved_by_name = serializers.SerializerMethodField()
    stage_display = serializers.CharField(source="get_stage_display", read_only=True)
    review_overdue = serializers.BooleanField(read_only=True)
    next_stages = serializers.SerializerMethodField()
    versions = SOPVersionSerializer(many=True, read_only=True)

    class Meta:
        model = SOP
        fields = (
            "id", "code", "title", "department", "department_name", "owner", "owner_name",
            "stage", "stage_display", "purpose", "scope", "content", "version_number",
            "approved_by", "approved_by_name", "approved_at", "published_at", "effective_date",
            "review_interval_months", "next_review_date", "review_overdue", "next_stages",
            "versions", "created_at",
        )
        read_only_fields = (
            "owner", "stage", "version_number", "approved_by", "approved_at",
            "published_at", "effective_date", "next_review_date",
        )

    def get_owner_name(self, obj: SOP) -> str:
        return _name(obj.owner)

    def get_department_name(self, obj: SOP) -> str:
        return obj.department.name if obj.department else ""

    def get_approved_by_name(self, obj: SOP) -> str:
        return _name(obj.approved_by)

    def get_next_stages(self, obj: SOP) -> list[str]:
        return [str(s) for s in SOP_TRANSITIONS.get(obj.stage, [])]
