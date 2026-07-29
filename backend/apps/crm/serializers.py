"""Serializers for the CRM module (PRD §28)."""
from __future__ import annotations

from rest_framework import serializers

from .models import CLOSED_STAGES, Contact, Customer, Opportunity


def _name(user) -> str:
    return (user.get_full_name() or user.username) if user else ""


class ContactSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contact
        fields = ("id", "customer", "name", "title", "email", "phone", "is_primary", "created_at")


class CustomerSerializer(serializers.ModelSerializer):
    owner_name = serializers.SerializerMethodField()
    contacts = ContactSerializer(many=True, read_only=True)
    open_opportunities = serializers.SerializerMethodField()
    pipeline_value = serializers.SerializerMethodField()

    class Meta:
        model = Customer
        fields = (
            "id", "name", "customer_type", "status", "industry", "region", "website", "notes",
            "owner", "owner_name", "contacts", "open_opportunities", "pipeline_value", "created_at",
        )

    def get_owner_name(self, obj: Customer) -> str:
        return _name(obj.owner)

    def get_open_opportunities(self, obj: Customer) -> int:
        return sum(1 for o in obj.opportunities.all() if o.stage not in CLOSED_STAGES)

    def get_pipeline_value(self, obj: Customer) -> float:
        return float(sum(o.amount for o in obj.opportunities.all() if o.stage not in CLOSED_STAGES))


class OpportunitySerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    owner_name = serializers.SerializerMethodField()
    stage_display = serializers.CharField(source="get_stage_display", read_only=True)
    amount = serializers.FloatField(required=False)
    probability = serializers.IntegerField(read_only=True)
    weighted_amount = serializers.SerializerMethodField()
    is_open = serializers.BooleanField(read_only=True)

    class Meta:
        model = Opportunity
        fields = (
            "id", "customer", "customer_name", "title", "stage", "stage_display",
            "amount", "currency", "expected_close_date", "owner", "owner_name",
            "source", "notes", "lost_reason", "project", "probability", "weighted_amount",
            "is_open", "created_at",
        )
        read_only_fields = ("project",)

    def get_owner_name(self, obj: Opportunity) -> str:
        return _name(obj.owner)

    def get_weighted_amount(self, obj: Opportunity) -> float:
        return obj.weighted_amount
