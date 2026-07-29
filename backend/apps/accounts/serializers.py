"""Serializers for accounts & RBAC (PRD §7, §10.5)."""
from __future__ import annotations

from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import Department, Role, RoleCapability, Team, User


class DepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ("id", "name", "code")


class TeamSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source="department.name", read_only=True)

    class Meta:
        model = Team
        fields = ("id", "name", "department", "department_name")


class RoleCapabilitySerializer(serializers.ModelSerializer):
    class Meta:
        model = RoleCapability
        fields = ("capability", "scope")


class RoleSerializer(serializers.ModelSerializer):
    """A dynamic role with its capabilities (§7.1). Writable nested capabilities
    let the Administrator compose a role in one call (the role builder)."""

    capabilities = RoleCapabilitySerializer(source="role_capabilities", many=True)
    user_count = serializers.IntegerField(source="users.count", read_only=True)

    class Meta:
        model = Role
        fields = (
            "id", "name", "description", "is_system",
            "default_scope", "capabilities", "user_count",
        )

    def create(self, validated_data):
        caps = validated_data.pop("role_capabilities", [])
        role = Role.objects.create(**validated_data)
        self._sync_capabilities(role, caps)
        return role

    def update(self, instance, validated_data):
        caps = validated_data.pop("role_capabilities", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if caps is not None:
            instance.role_capabilities.all().delete()
            self._sync_capabilities(instance, caps)
        return instance

    @staticmethod
    def _sync_capabilities(role: Role, caps: list[dict]) -> None:
        RoleCapability.objects.bulk_create(
            [RoleCapability(role=role, **cap) for cap in caps]
        )


class UserSerializer(serializers.ModelSerializer):
    """Read representation, including resolved effective capabilities (§7.4)."""

    full_name = serializers.CharField(source="get_full_name", read_only=True)
    role_names = serializers.SerializerMethodField()
    effective_capabilities = serializers.SerializerMethodField()
    is_privileged = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields = (
            "id", "username", "email", "first_name", "last_name", "full_name",
            "phone", "department", "teams", "roles", "role_names",
            "is_active", "is_privileged", "mfa_enabled", "effective_capabilities",
        )

    def get_role_names(self, obj: User) -> list[str]:
        return list(obj.roles.values_list("name", flat=True))

    def get_effective_capabilities(self, obj: User) -> dict[str, str]:
        return obj.effective_capabilities()


class UserWriteSerializer(serializers.ModelSerializer):
    """Create/update a user (Administrator only). Password is write-only."""

    password = serializers.CharField(write_only=True, required=False, validators=[validate_password])

    class Meta:
        model = User
        fields = (
            "id", "username", "email", "password", "first_name", "last_name",
            "phone", "department", "teams", "roles", "is_active",
        )

    def create(self, validated_data):
        teams = validated_data.pop("teams", [])
        roles = validated_data.pop("roles", [])
        password = validated_data.pop("password", None)
        user = User(**validated_data)
        if password:
            user.set_password(password)
        user.save()
        user.teams.set(teams)
        user.roles.set(roles)
        return user

    def update(self, instance, validated_data):
        teams = validated_data.pop("teams", None)
        roles = validated_data.pop("roles", None)
        password = validated_data.pop("password", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if password:
            instance.set_password(password)
        instance.save()
        if teams is not None:
            instance.teams.set(teams)
        if roles is not None:
            instance.roles.set(roles)
        return instance


class MeSerializer(UserSerializer):
    """Current-user payload for the frontend (identity + resolved access)."""

    class Meta(UserSerializer.Meta):
        pass
