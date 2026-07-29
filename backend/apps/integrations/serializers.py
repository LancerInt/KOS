"""Serializers for ERP connections, deliveries & inbound events (PRD §27).

Secrets and tokens are **write-only** — never returned. A blank value on update
means "leave unchanged", so the UI needn't re-enter the secret to edit a
connection.
"""
from __future__ import annotations

from rest_framework import serializers

from .models import ErpConnection, InboundEvent, WebhookDelivery


class ErpConnectionSerializer(serializers.ModelSerializer):
    secret = serializers.CharField(write_only=True, required=False, allow_blank=True)
    auth_token = serializers.CharField(write_only=True, required=False, allow_blank=True)
    has_secret = serializers.BooleanField(read_only=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ErpConnection
        fields = (
            "id", "name", "base_url", "secret", "has_secret",
            "auth_scheme", "auth_token", "auth_header_name",
            "subscribed_events", "is_active", "inbound_enabled", "mock_mode", "max_attempts",
            "created_by", "created_by_name", "last_delivery_at", "created_at",
        )
        read_only_fields = ("created_by", "last_delivery_at")

    def get_created_by_name(self, obj: ErpConnection) -> str:
        u = obj.created_by
        return (u.get_full_name() or u.username) if u else ""

    def update(self, instance, validated_data):
        # Blank secret/token → keep the stored value.
        if not validated_data.get("secret", None):
            validated_data.pop("secret", None)
        if not validated_data.get("auth_token", None):
            validated_data.pop("auth_token", None)
        return super().update(instance, validated_data)


class WebhookDeliverySerializer(serializers.ModelSerializer):
    connection_name = serializers.CharField(source="connection.name", read_only=True)

    class Meta:
        model = WebhookDelivery
        fields = (
            "id", "connection", "connection_name", "event_type", "object_type", "object_id",
            "payload", "status", "attempts", "response_status", "response_body", "error",
            "next_retry_at", "delivered_at", "created_at",
        )


class InboundEventSerializer(serializers.ModelSerializer):
    connection_name = serializers.CharField(source="connection.name", read_only=True, default="")

    class Meta:
        model = InboundEvent
        fields = ("id", "connection", "connection_name", "event_type", "payload",
                  "status", "result", "source_ip", "created_at")
