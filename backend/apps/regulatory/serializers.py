"""Serializers for regulatory registrations (PRD §29)."""
from __future__ import annotations

from rest_framework import serializers

from .models import REG_TRANSITIONS, RegulatoryRegistration


class RegistrationSerializer(serializers.ModelSerializer):
    owner_name = serializers.SerializerMethodField()
    authority_display = serializers.CharField(source="get_authority_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    is_expired = serializers.BooleanField(read_only=True)
    expires_in_days = serializers.IntegerField(read_only=True, allow_null=True)
    next_stages = serializers.SerializerMethodField()
    document_titles = serializers.SerializerMethodField()

    class Meta:
        model = RegulatoryRegistration
        fields = (
            "id", "product_name", "registration_number", "authority", "authority_display",
            "category", "status", "status_display", "owner", "owner_name", "project",
            "documents", "document_titles", "submission_date", "approval_date", "expiry_date",
            "reminder_lead_days", "is_expired", "expires_in_days", "next_stages", "notes", "created_at",
        )
        read_only_fields = ("status", "owner", "approval_date")

    def get_owner_name(self, obj: RegulatoryRegistration) -> str:
        u = obj.owner
        return (u.get_full_name() or u.username) if u else ""

    def get_next_stages(self, obj: RegulatoryRegistration) -> list[str]:
        return [str(s) for s in REG_TRANSITIONS.get(obj.status, [])]

    def get_document_titles(self, obj: RegulatoryRegistration) -> list[dict]:
        return [{"id": d.id, "title": d.title} for d in obj.documents.all()]
