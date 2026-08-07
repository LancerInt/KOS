"""Serializers for shared core endpoints."""
from __future__ import annotations

from rest_framework import serializers
from rest_framework.validators import UniqueTogetherValidator

from .models import SavedView


class SavedViewSerializer(serializers.ModelSerializer):
    """A per-user saved filter/sort/layout preset.

    ``owner`` is taken from the request (never client-supplied). ``config`` is an
    opaque object stored verbatim — only its top-level type is validated.
    """

    owner = serializers.HiddenField(default=serializers.CurrentUserDefault())

    class Meta:
        model = SavedView
        fields = ("id", "owner", "surface", "name", "config", "created_at")
        read_only_fields = ("created_at",)
        validators = [
            UniqueTogetherValidator(
                queryset=SavedView.objects.all(),
                fields=("owner", "surface", "name"),
                message="You already have a view with that name.",
            )
        ]

    def validate_name(self, value: str) -> str:
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("Give the view a name.")
        return value

    def validate_config(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Config must be an object.")
        return value
