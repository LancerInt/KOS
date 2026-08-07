"""Serializers for the Task Engine (PRD §11)."""
from __future__ import annotations

from rest_framework import serializers

from apps.accounts.models import User

from .models import Activity, ChecklistItem, Comment, Subtask, Task
from .statuses import STATUS_LABEL, category_for


class UserMiniSerializer(serializers.ModelSerializer):
    full_name = serializers.CharField(source="get_full_name", read_only=True)

    class Meta:
        model = User
        fields = ("id", "username", "full_name")


class SubtaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = Subtask
        fields = ("id", "task", "title", "is_done", "assignee", "order")


class ChecklistItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChecklistItem
        fields = ("id", "task", "title", "is_done", "is_required", "order")


class CommentSerializer(serializers.ModelSerializer):
    author_detail = UserMiniSerializer(source="author", read_only=True)

    class Meta:
        model = Comment
        fields = ("id", "task", "author", "author_detail", "body", "mentions", "created_at")
        read_only_fields = ("author",)


class ActivitySerializer(serializers.ModelSerializer):
    actor_detail = UserMiniSerializer(source="actor", read_only=True)
    verb_display = serializers.CharField(source="get_verb_display", read_only=True)

    class Meta:
        model = Activity
        fields = ("id", "actor_detail", "verb", "verb_display", "detail", "created_at")


class TaskListSerializer(serializers.ModelSerializer):
    project_code = serializers.CharField(source="project.code", read_only=True)
    category = serializers.SerializerMethodField()
    status_label = serializers.SerializerMethodField()
    is_overdue = serializers.BooleanField(read_only=True)
    primary_owner_detail = UserMiniSerializer(source="primary_owner", read_only=True)
    owners_detail = UserMiniSerializer(source="owners", many=True, read_only=True)
    checklist_done = serializers.IntegerField(read_only=True)
    checklist_total = serializers.IntegerField(read_only=True)

    class Meta:
        model = Task
        fields = (
            "id", "title", "project", "project_code", "epic", "milestone",
            "task_type", "status", "status_label", "category", "priority",
            "start_date", "due_date", "is_overdue",
            "primary_owner", "primary_owner_detail", "owners_detail",
            "checklist_done", "checklist_total", "created_at",
        )

    def _resolved(self, project):
        # Resolve the project's workflow once per request (cached in context).
        from apps.workflows.resolver import resolve_cached
        cache = self.context.get("wf_cache")
        if cache is None:
            cache = {}
        return resolve_cached(project, cache)

    def get_category(self, obj: Task) -> str:
        return self._resolved(obj.project).category_for(obj.status)

    def get_status_label(self, obj: Task) -> str:
        return self._resolved(obj.project).label_for(obj.status)


class TaskDetailSerializer(TaskListSerializer):
    owners_detail = UserMiniSerializer(source="owners", many=True, read_only=True)
    collaborators_detail = UserMiniSerializer(source="collaborators", many=True, read_only=True)
    reviewer_detail = UserMiniSerializer(source="reviewer", read_only=True)
    subtasks = SubtaskSerializer(many=True, read_only=True)
    checklist_items = ChecklistItemSerializer(many=True, read_only=True)
    comments = CommentSerializer(many=True, read_only=True)
    activities = ActivitySerializer(many=True, read_only=True)
    blocking_reasons = serializers.SerializerMethodField()

    class Meta(TaskListSerializer.Meta):
        fields = TaskListSerializer.Meta.fields + (
            "description", "deliverable", "definition_of_done", "tags",
            "risk_level", "reminder_lead_days", "reviewer", "reviewer_detail",
            "collaborators", "collaborators_detail", "watchers",
            "actual_start_date", "completed_at",
            "subtasks", "checklist_items", "comments", "activities", "blocking_reasons",
        )

    def get_blocking_reasons(self, obj: Task) -> list[str]:
        return obj.blocking_reasons()


class TaskWriteSerializer(serializers.ModelSerializer):
    """Create/update. Status is changed via the set_status action, not here, so
    the Definition of Done can be enforced (§11.5)."""

    class Meta:
        model = Task
        fields = (
            "id", "title", "project", "epic", "milestone", "description",
            "task_type", "owners", "primary_owner", "collaborators", "reviewer",
            "watchers", "priority", "risk_level", "start_date", "due_date",
            "deliverable", "definition_of_done", "tags", "reminder_lead_days",
        )

    def validate(self, attrs):
        owners = attrs.get("owners")
        primary = attrs.get("primary_owner")
        if owners is not None and primary is not None and primary not in owners:
            raise serializers.ValidationError(
                {"primary_owner": "The Primary Owner must also be listed as an owner."}
            )
        return attrs
