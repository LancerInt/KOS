"""Serializers for the Project Engine (PRD §10.1, §10.6)."""
from __future__ import annotations

from rest_framework import serializers

from .models import (
    Epic,
    Membership,
    Milestone,
    Portfolio,
    Project,
    ProjectTemplate,
)


class PortfolioSerializer(serializers.ModelSerializer):
    project_count = serializers.IntegerField(source="projects.count", read_only=True)

    class Meta:
        model = Portfolio
        fields = ("id", "name", "code", "description", "owner", "members", "project_count")


class MilestoneSerializer(serializers.ModelSerializer):
    is_reached = serializers.BooleanField(read_only=True)

    class Meta:
        model = Milestone
        fields = (
            "id", "project", "epic", "title", "description",
            "due_date", "status", "reached_at", "order", "is_reached",
        )


class EpicSerializer(serializers.ModelSerializer):
    milestone_count = serializers.IntegerField(source="milestones.count", read_only=True)

    class Meta:
        model = Epic
        fields = ("id", "project", "title", "description", "owner", "order", "milestone_count")


class ProjectSerializer(serializers.ModelSerializer):
    """List/write representation."""

    owner_name = serializers.SerializerMethodField()
    member_count = serializers.IntegerField(source="memberships.count", read_only=True)
    my_role = serializers.SerializerMethodField()
    progress = serializers.IntegerField(read_only=True)

    class Meta:
        model = Project
        fields = (
            "id", "name", "code", "description", "business_objective",
            "portfolio", "department", "owner", "owner_name", "manager",
            "project_type", "confidentiality", "status", "priority", "health",
            "start_date", "target_date", "actual_completion_date",
            "success_criteria", "working_rules", "sprint_enabled",
            "member_count", "my_role", "progress", "created_at",
        )
        extra_kwargs = {"owner": {"required": False}, "code": {"required": False}}

    def get_owner_name(self, obj: Project) -> str:
        return (obj.owner.get_full_name() or obj.owner.username) if obj.owner_id else ""

    def get_my_role(self, obj: Project) -> str | None:
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None
        m = obj.memberships.filter(user=request.user).first()
        return m.project_role if m else None


class ProjectDetailSerializer(ProjectSerializer):
    """Detail view — includes the seeded hierarchy."""

    epics = EpicSerializer(many=True, read_only=True)
    milestones = MilestoneSerializer(many=True, read_only=True)

    class Meta(ProjectSerializer.Meta):
        fields = ProjectSerializer.Meta.fields + ("epics", "milestones")


class ProjectTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectTemplate
        fields = (
            "id", "key", "name", "description",
            "project_type", "default_confidentiality", "structure", "is_active",
        )


class CreateFromTemplateSerializer(serializers.Serializer):
    """Input for POST /projects/from_template/ (AC-6)."""

    template = serializers.SlugRelatedField(
        slug_field="key", queryset=ProjectTemplate.objects.filter(is_active=True)
    )
    name = serializers.CharField(max_length=200)
    code = serializers.CharField(max_length=30)
    portfolio = serializers.PrimaryKeyRelatedField(
        queryset=Portfolio.objects.all(), required=False, allow_null=True
    )
    start_date = serializers.DateField(required=False, allow_null=True)
    priority = serializers.CharField(required=False)

    def validate_code(self, value: str) -> str:
        if Project.objects.filter(code=value).exists():
            raise serializers.ValidationError("A project with this code already exists.")
        return value


class MembershipSerializer(serializers.ModelSerializer):
    user_name = serializers.SerializerMethodField()
    project_code = serializers.CharField(source="project.code", read_only=True)

    class Meta:
        model = Membership
        fields = (
            "id", "user", "user_name", "project", "project_code",
            "project_role", "added_by", "created_at",
        )
        read_only_fields = ("added_by",)

    def get_user_name(self, obj: Membership) -> str:
        return obj.user.get_full_name() or obj.user.username
