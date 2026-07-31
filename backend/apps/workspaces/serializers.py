"""Serializers for workspace projects, sections and category records."""
from __future__ import annotations

import json
import math

from django.utils import timezone
from rest_framework import serializers

from .models import (
    Workspace, WorkspaceMember, WorkspacePermission, WorkspaceProject,
    WorkspaceRecord, WorkspaceSection,
)


class WorkspaceSerializer(serializers.ModelSerializer):
    is_archived = serializers.SerializerMethodField()
    days_left = serializers.SerializerMethodField()

    class Meta:
        model = Workspace
        fields = (
            "id", "key", "label", "blurb", "icon", "accent", "domain", "order",
            "archived_at", "is_archived", "days_left", "created_at",
        )
        read_only_fields = ("key", "domain", "archived_at", "created_at")

    def get_is_archived(self, obj) -> bool:
        return obj.is_archived

    def get_days_left(self, obj):
        if not obj.archived_at:
            return None
        gone_days = (timezone.now() - obj.archived_at).total_seconds() / 86400
        return max(0, math.ceil(Workspace.ARCHIVE_TTL_DAYS - gone_days))

    def validate_label(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("A workspace name is required.")
        return value


class WorkspacePermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkspacePermission
        fields = ("id", "role", "workspace", "access")


class WorkspaceMemberSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    user_email = serializers.EmailField(source="user.email", read_only=True)
    added_by_name = serializers.SerializerMethodField()

    class Meta:
        model = WorkspaceMember
        fields = (
            "id", "workspace", "user", "user_name", "user_email",
            "access", "added_by", "added_by_name", "created_at",
        )
        # A member always holds full edit; who added them and when are set server-side.
        read_only_fields = ("access", "added_by", "created_at")

    def get_user_name(self, obj) -> str:
        return obj.user.get_full_name() or obj.user.username

    def get_added_by_name(self, obj) -> str:
        u = obj.added_by
        return (u.get_full_name() or u.username) if u else ""


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
            "start_at", "end_at", "completed_at", "duration",
        )
        read_only_fields = ("created_by", "created_at", "completed_at")

    def get_duration(self, obj) -> dict:
        return obj.duration_state()

    def _check_window(self, attrs):
        instance = self.instance
        start_at = attrs.get("start_at", getattr(instance, "start_at", None))
        end_at = attrs.get("end_at", getattr(instance, "end_at", None))
        if start_at and end_at and end_at <= start_at:
            raise serializers.ValidationError({"end_at": "The end must be after the start."})

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
        self._check_window(attrs)
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
            "start_at", "end_at", "completed_at", "duration",
            "created_by", "created_by_name", "created_at", "updated_at",
        )
        read_only_fields = ("workspace", "completed_at", "created_by", "created_at", "updated_at")

    def get_duration(self, obj) -> dict:
        return obj.duration_state()

    def validate(self, attrs):
        instance = self.instance
        start_at = attrs.get("start_at", getattr(instance, "start_at", None))
        end_at = attrs.get("end_at", getattr(instance, "end_at", None))
        if start_at and end_at and end_at <= start_at:
            raise serializers.ValidationError({"end_at": "The end must be after the start."})
        return attrs

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
        fields = ("id", "project", "workspace", "name", "blurb", "fields", "hidden", "created_by", "created_at")
        read_only_fields = ("workspace", "created_by", "created_at")

    def validate_fields(self, value):
        # Over multipart the schema could arrive as a JSON string; parse it.
        if isinstance(value, str):
            try:
                value = json.loads(value or "[]")
            except ValueError:
                raise serializers.ValidationError("fields must be valid JSON.")
        if not isinstance(value, list):
            raise serializers.ValidationError("fields must be a list of field definitions.")
        clean = []
        for f in value:
            if isinstance(f, dict) and f.get("type") and f.get("label") is not None:
                clean.append(f)
        return clean

    def validate(self, attrs):
        instance = self.instance
        project = attrs.get("project") or (instance.project if instance else None)
        # On a partial update (e.g. saving only the field schema) name isn't in
        # the payload — fall back to the existing name instead of erroring.
        provided_name = "name" in attrs
        name = (attrs.get("name") if provided_name else (instance.name if instance else "")) or ""
        name = name.strip()
        if not name:
            raise serializers.ValidationError({"name": "A section name is required."})
        qs = WorkspaceSection.objects.filter(project=project, name__iexact=name)
        if instance:
            qs = qs.exclude(pk=instance.pk)
        if qs.exists():
            raise serializers.ValidationError({"name": "A section with this name already exists."})
        if provided_name:
            attrs["name"] = name
        return attrs
