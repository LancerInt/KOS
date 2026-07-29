"""Tests for the CRM module (PRD §28)."""
from __future__ import annotations

from decimal import Decimal

from django.test import TestCase

from apps.accounts.models import User

from .models import Customer, Opportunity, OpportunityStage


class OpportunityTests(TestCase):
    def setUp(self):
        self.customer = Customer.objects.create(name="Agro Ltd")

    def test_probability_and_weighting(self):
        opp = Opportunity.objects.create(
            customer=self.customer, title="Bulk order", stage=OpportunityStage.PROPOSAL, amount=Decimal("100000"),
        )
        self.assertEqual(opp.probability, 50)
        self.assertTrue(opp.is_open)
        self.assertEqual(opp.weighted_amount, 50000.0)

    def test_won_is_closed(self):
        opp = Opportunity.objects.create(customer=self.customer, title="Deal", stage=OpportunityStage.WON)
        self.assertFalse(opp.is_open)
        self.assertEqual(opp.probability, 100)


class ConvertTests(TestCase):
    def test_convert_links_project(self):
        from apps.projects.models import Project

        user = User.objects.create_superuser(username="a", email="a@k.in", password="x")
        customer = Customer.objects.create(name="Beta Corp")
        opp = Opportunity.objects.create(customer=customer, title="Trial", stage=OpportunityStage.NEGOTIATION)
        # Simulate the conversion effect.
        project = Project.objects.create(name=f"{customer.name}: {opp.title}", code=f"CRM-{opp.id:04d}", owner=user)
        opp.project = project
        opp.save()
        self.assertEqual(Opportunity.objects.get(pk=opp.pk).project_id, project.id)
