"""CRM & Sales — a department module (PRD §28, §34).

A worked example of the architecture rule: this *configures* the shared engines
rather than rebuilding them. Customers and a sales pipeline live here; when an
opportunity is won it converts into a **Project** (the project engine), whose
work is then tracked by the **task engine** like everything else.
"""
from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel


class CustomerType(models.TextChoices):
    COMPANY = "company", "Company"
    INDIVIDUAL = "individual", "Individual"
    GOVERNMENT = "government", "Government / Institution"
    DISTRIBUTOR = "distributor", "Distributor / Dealer"


class CustomerStatus(models.TextChoices):
    LEAD = "lead", "Lead"
    PROSPECT = "prospect", "Prospect"
    ACTIVE = "active", "Active customer"
    INACTIVE = "inactive", "Inactive"


class Customer(TimeStampedModel):
    name = models.CharField(max_length=200)
    customer_type = models.CharField(max_length=20, choices=CustomerType.choices, default=CustomerType.COMPANY)
    status = models.CharField(max_length=20, choices=CustomerStatus.choices, default=CustomerStatus.LEAD)
    industry = models.CharField(max_length=120, blank=True)
    region = models.CharField(max_length=120, blank=True)
    website = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="owned_customers"
    )

    class Meta:
        ordering = ("name",)

    def __str__(self) -> str:
        return self.name


class Contact(TimeStampedModel):
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="contacts")
    name = models.CharField(max_length=160)
    title = models.CharField(max_length=120, blank=True)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=40, blank=True)
    is_primary = models.BooleanField(default=False)

    class Meta:
        ordering = ("-is_primary", "name")

    def __str__(self) -> str:
        return self.name


class OpportunityStage(models.TextChoices):
    LEAD = "lead", "Lead"
    QUALIFIED = "qualified", "Qualified"
    PROPOSAL = "proposal", "Proposal"
    NEGOTIATION = "negotiation", "Negotiation"
    WON = "won", "Won"
    LOST = "lost", "Lost"


STAGE_PROBABILITY = {
    OpportunityStage.LEAD: 10,
    OpportunityStage.QUALIFIED: 30,
    OpportunityStage.PROPOSAL: 50,
    OpportunityStage.NEGOTIATION: 75,
    OpportunityStage.WON: 100,
    OpportunityStage.LOST: 0,
}
CLOSED_STAGES = {OpportunityStage.WON, OpportunityStage.LOST}


class Opportunity(TimeStampedModel):
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="opportunities")
    title = models.CharField(max_length=200)
    stage = models.CharField(max_length=20, choices=OpportunityStage.choices, default=OpportunityStage.LEAD)
    amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    currency = models.CharField(max_length=8, default="INR")
    expected_close_date = models.DateField(null=True, blank=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="owned_opportunities"
    )
    source = models.CharField(max_length=120, blank=True)
    notes = models.TextField(blank=True)
    lost_reason = models.CharField(max_length=200, blank=True)

    # Won opportunities become projects — the link back to the project engine.
    project = models.ForeignKey(
        "projects.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="opportunities"
    )

    class Meta:
        ordering = ("-created_at",)

    def __str__(self) -> str:
        return self.title

    @property
    def probability(self) -> int:
        return STAGE_PROBABILITY.get(self.stage, 0)

    @property
    def is_open(self) -> bool:
        return self.stage not in CLOSED_STAGES

    @property
    def weighted_amount(self) -> float:
        return float(self.amount) * self.probability / 100
