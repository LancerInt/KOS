"""Serializers for workspace projects, sections and category records."""
from __future__ import annotations

import json
import math

from django.utils import timezone
from rest_framework import serializers

from .models import (
    MAX_SECTION_DEPTH, Workspace, WorkspaceMember, WorkspacePermission,
    WorkspaceProject, WorkspaceProjectMember, WorkspaceRecord, WorkspaceRecordAttachment,
    WorkspaceSection,
)


class WorkspaceSerializer(serializers.ModelSerializer):
    is_archived = serializers.SerializerMethodField()
    days_left = serializers.SerializerMethodField()

    class Meta:
        model = Workspace
        fields = (
            "id", "key", "label", "blurb", "icon", "accent", "domain", "order",
            "is_builtin", "archived_at", "is_archived", "days_left", "created_at",
        )
        # is_builtin is decided by how the row came into being, never by the
        # client — it is what stops a built-in being archived.
        read_only_fields = ("key", "domain", "is_builtin", "archived_at", "created_at")

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


class WorkspaceProjectMemberSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    user_email = serializers.EmailField(source="user.email", read_only=True)
    added_by_name = serializers.SerializerMethodField()

    class Meta:
        model = WorkspaceProjectMember
        fields = (
            "id", "project", "user", "user_name", "user_email",
            "added_by", "added_by_name", "created_at",
        )
        # Who added them and when are set server-side. There is no per-member
        # access level: a project member holds whatever the workspace grants
        # them — membership decides *whether* they see the project, not how much.
        read_only_fields = ("added_by", "created_at")

    def get_user_name(self, obj) -> str:
        return obj.user.get_full_name() or obj.user.username

    def get_added_by_name(self, obj) -> str:
        u = obj.added_by
        return (u.get_full_name() or u.username) if u else ""


class WorkspaceProjectSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    section_count = serializers.SerializerMethodField()
    record_count = serializers.SerializerMethodField()
    member_count = serializers.SerializerMethodField()
    duration = serializers.SerializerMethodField()

    class Meta:
        model = WorkspaceProject
        fields = (
            "id", "workspace", "name",
            "created_by", "created_by_name", "created_at",
            "section_count", "record_count", "member_count",
            "start_at", "end_at", "completed_at", "duration", "review_state",
        )
        read_only_fields = ("created_by", "created_at", "completed_at")

    def get_duration(self, obj) -> dict:
        return obj.duration_state()

    def get_member_count(self, obj) -> int:
        """Size of the project's roster. Zero means the project is open to
        everyone who can open its workspace — see ``WorkspaceProjectMember``."""
        return obj.members.count()

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
        # Live, visible sections at every depth. (This used to count hidden and
        # soft-deleted rows too, which over-reported on the project cards.)
        return obj.sections.filter(deleted_at__isnull=True, hidden=False).count()

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


class RecordAttachmentSerializer(serializers.ModelSerializer):
    name = serializers.CharField(read_only=True)

    class Meta:
        model = WorkspaceRecordAttachment
        fields = ("id", "file", "name")


class WorkspaceRecordSerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()
    attachment_name = serializers.SerializerMethodField()
    attachments = RecordAttachmentSerializer(many=True, read_only=True)
    duration = serializers.SerializerMethodField()

    class Meta:
        model = WorkspaceRecord
        fields = (
            "id", "project", "workspace", "section", "category", "data",
            "attachment", "attachment_name", "attachments",
            "start_at", "end_at", "completed_at", "duration",
            "created_by", "created_by_name", "created_at", "updated_at",
        )
        read_only_fields = ("workspace", "completed_at", "created_by", "created_at", "updated_at")
        # `category` is derived in validate() — from the section when one is
        # given, otherwise from the legacy name payload. A client sending
        # `section` alone must not be rejected for omitting the mirror.
        extra_kwargs = {"category": {"required": False}}

    def get_duration(self, obj) -> dict:
        return obj.duration_state()

    def validate(self, attrs):
        instance = self.instance
        project = attrs.get("project", getattr(instance, "project", None))
        section = attrs["section"] if "section" in attrs else getattr(instance, "section", None)

        if section is not None:
            if project is None:
                attrs["project"] = project = section.project
            elif section.project_id != project.pk:
                raise serializers.ValidationError({"section": "That section isn't available."})
            # `category` mirrors the section's name — never set independently.
            attrs["category"] = section.name
        else:
            category = (attrs.get("category") if "category" in attrs
                        else getattr(instance, "category", "")) or ""
            category = category.strip()
            if category and project is not None:
                # Legacy path: the client sent a name and no section. A bare name
                # is ambiguous once sections nest, so it resolves against
                # *top-level* sections only. No match means a built-in section
                # nobody has customised yet — leave section null and keep
                # resolving by name, exactly as before.
                match = WorkspaceSection.objects.filter(
                    project=project, name__iexact=category,
                    deleted_at__isnull=True, parent__isnull=True,
                ).first()
                if match is not None:
                    attrs["section"] = match
                    category = match.name
            attrs["category"] = category

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
        fields = ("id", "project", "parent", "workspace", "name", "blurb", "fields",
                  "builtin_key", "hidden", "created_by", "created_at")
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

    def validate_builtin_key(self, value):
        return (value or "").strip().lower()

    def validate(self, attrs):
        instance = self.instance
        project = attrs.get("project") or (instance.project if instance else None)
        parent = attrs["parent"] if "parent" in attrs else (instance.parent if instance else None)

        # builtin_key is write-once. It is what a renamed built-in is recognised
        # by, so letting an update repoint it would let one row take over another
        # built-in's identity — and silently move its records with it. Setting it
        # on a row that has none is allowed: that is how a section adopted before
        # this column existed acquires its key, on the first rename.
        if "builtin_key" in attrs and instance is not None:
            if instance.builtin_key and attrs["builtin_key"] != instance.builtin_key:
                raise serializers.ValidationError(
                    {"builtin_key": "A section can't be repointed to another built-in section."})

        # On a partial update (e.g. saving only the field schema) name isn't in
        # the payload — fall back to the existing name instead of erroring.
        provided_name = "name" in attrs
        name = (attrs.get("name") if provided_name else (instance.name if instance else "")) or ""
        name = name.strip()
        if not name:
            raise serializers.ValidationError({"name": "A section name is required."})

        # A section never changes project: moving a subtree across projects would
        # break record scoping and sibling uniqueness in a single step.
        if instance is not None and project is not None and instance.project_id != project.pk:
            raise serializers.ValidationError(
                {"project": "A section can't be moved to another project."})

        if parent is not None:
            if instance is not None and parent.pk == instance.pk:
                raise serializers.ValidationError({"parent": "A section can't be inside itself."})
            # Neutral wording — don't confirm whether an id exists elsewhere.
            if parent.project_id != (project.pk if project else None):
                raise serializers.ValidationError({"parent": "That parent section isn't available."})
            if parent.deleted_at is not None or parent.hidden:
                raise serializers.ValidationError(
                    {"parent": "You can't add a sub-section to a deleted section."})

            if instance is not None:
                # Cycle guard: walk up from the *proposed* parent. Meeting the
                # section being moved means the move would make it its own
                # ancestor, which would strand the whole subtree.
                node, hops, seen = parent, 0, set()
                while node is not None and hops <= MAX_SECTION_DEPTH + 1:
                    if node.pk == instance.pk:
                        raise serializers.ValidationError(
                            {"parent": "A section can't be moved inside one of its own sub-sections."})
                    if node.pk in seen:
                        raise serializers.ValidationError(
                            {"parent": "That parent section isn't available."})
                    seen.add(node.pk)
                    node, hops = node.parent, hops + 1

            height = instance.subtree_height() if instance is not None else 1
            if parent.depth + 1 + height > MAX_SECTION_DEPTH + 1:
                raise serializers.ValidationError(
                    {"parent": f"Sections can only be nested {MAX_SECTION_DEPTH} levels deep."})

        # Uniqueness is per sibling group, matching the two database constraints:
        # "Documents" may exist under two different parents. Live rows only — a
        # deleted section no longer reserves its name for the retention window.
        qs = WorkspaceSection.objects.filter(
            project=project, name__iexact=name, deleted_at__isnull=True)
        qs = qs.filter(parent__isnull=True) if parent is None else qs.filter(parent=parent)
        if instance:
            qs = qs.exclude(pk=instance.pk)
        if qs.exists():
            raise serializers.ValidationError(
                {"name": "A section with this name already exists here."})
        if provided_name:
            attrs["name"] = name
        return attrs
