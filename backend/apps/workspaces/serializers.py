"""Serializers for workspace projects, sections and category records."""
from __future__ import annotations

import json

from rest_framework import serializers

from .models import (
    WorkspacePermission, WorkspaceProject, WorkspaceRecord, WorkspaceSection,
)


class WorkspacePermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkspacePermission
        fields = ("id", "role", "workspace", "access")


class WorkspaceProjectSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    section_count = serializers.SerializerMethodField()
    record_count = serializers.SerializerMethodField()
    duration = serializers.SerializerMethodField()

    class Meta:
        model = WorkspaceProject
        fields = (
            "id", "workspace", "name",
            "created_by", "created_by_name", "created_at",
            "section_count", "record_count",
            "start_date", "duration_days", "completed_at", "duration",
        )
        read_only_fields = ("created_by", "created_at", "completed_at")

    def get_duration(self, obj) -> dict:
        return obj.duration_state()

    def get_created_by_name(self, obj) -> str:
        user = obj.created_by
        return (user.get_full_name() or user.username) if user else ""

    def get_section_count(self, obj) -> int:
        return obj.sections.count()

    def get_record_count(self, obj) -> int:
        return obj.records.count()

    def validate(self, attrs):
        instance = self.instance
        workspace = attrs.get("workspace") or (instance.workspace if instance else "")
        # On a partial update (e.g. setting the duration) name isn't in the
        # payload — fall back to the existing name instead of erroring.
        provided_name = "name" in attrs
        name = (attrs.get("name") if provided_name else (instance.name if instance else "")) or ""
        name = name.strip()
        if not name:
            raise serializers.ValidationError({"name": "A project name is required."})
        qs = WorkspaceProject.objects.filter(workspace=workspace, name__iexact=name)
        if instance:
            qs = qs.exclude(pk=instance.pk)
        if qs.exists():
            raise serializers.ValidationError({"name": "A project with this name already exists."})
        if provided_name:
            attrs["name"] = name
        return attrs


class WorkspaceRecordSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    attachment_name = serializers.SerializerMethodField()
    duration = serializers.SerializerMethodField()

    class Meta:
        model = WorkspaceRecord
        fields = (
            "id", "project", "workspace", "category", "data",
            "attachment", "attachment_name",
            "start_date", "duration_days", "completed_at", "duration",
            "created_by", "created_by_name", "created_at", "updated_at",
        )
        read_only_fields = ("workspace", "completed_at", "created_by", "created_at", "updated_at")

    def get_duration(self, obj) -> dict:
        return obj.duration_state()

    def get_created_by_name(self, obj) -> str:
        user = obj.created_by
        return (user.get_full_name() or user.username) if user else ""

    def get_attachment_name(self, obj) -> str:
        return obj.attachment.name.rsplit("/", 1)[-1] if obj.attachment else ""

    def validate_data(self, value):
        # Over multipart (file uploads) `data` arrives as a JSON string; parse it.
        if isinstance(value, str):
            try:
                value = json.loads(value or "{}")
            except ValueError:
                raise serializers.ValidationError("data must be valid JSON.")
        if not isinstance(value, dict):
            raise serializers.ValidationError("data must be an object of field → value.")
        return value


class WorkspaceSectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkspaceSection
        fields = ("id", "project", "workspace", "name", "blurb", "created_by", "created_at")
        read_only_fields = ("workspace", "created_by", "created_at")

    def validate(self, attrs):
        project = attrs.get("project") or (self.instance.project if self.instance else None)
        name = (attrs.get("name") or "").strip()
        if not name:
            raise serializers.ValidationError({"name": "A section name is required."})
        qs = WorkspaceSection.objects.filter(project=project, name__iexact=name)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError({"name": "A section with this name already exists."})
        attrs["name"] = name
        return attrs
