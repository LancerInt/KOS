"""Tests for the regulatory module (PRD §29)."""
from __future__ import annotations

from django.test import TestCase

from .models import REG_TRANSITIONS, RegStatus, RegulatoryRegistration


class RegistrationLifecycleTests(TestCase):
    def test_transition_graph(self):
        reg = RegulatoryRegistration.objects.create(product_name="Cyper 10 EC")
        self.assertTrue(reg.can_transition_to(RegStatus.SUBMITTED))
        self.assertFalse(reg.can_transition_to(RegStatus.APPROVED))
        self.assertEqual(REG_TRANSITIONS[RegStatus.UNDER_REVIEW],
                         [RegStatus.QUERY_RAISED, RegStatus.APPROVED, RegStatus.REJECTED])

    def test_expiry_helpers(self):
        past = RegulatoryRegistration.objects.create(product_name="Old", expiry_date="2020-01-01")
        self.assertTrue(past.is_expired)
        self.assertLess(past.expires_in_days, 0)
