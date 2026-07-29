"""Smoke tests for the documents & SOP module (PRD §18, §19)."""
from __future__ import annotations

from datetime import date

from django.test import TestCase
from django.utils import timezone

from apps.accounts.models import User

from .models import SOP, SOP_TRANSITIONS, SOPStage, add_months


class AddMonthsTests(TestCase):
    def test_add_months_clamps_day(self):
        # 31 Jan + 1 month → 28/29 Feb, not an invalid date.
        self.assertEqual(add_months(date(2026, 1, 31), 1), date(2026, 2, 28))

    def test_add_months_wraps_year(self):
        self.assertEqual(add_months(date(2026, 11, 15), 3), date(2027, 2, 15))


class SOPLifecycleTests(TestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username="owner", email="o@k.in", password="x")

    def test_transition_graph(self):
        sop = SOP.objects.create(code="SOP-QA-001", title="Sampling", owner=self.owner)
        self.assertTrue(sop.can_transition_to(SOPStage.DRAFT))
        self.assertFalse(sop.can_transition_to(SOPStage.PUBLISHED))
        self.assertEqual(SOP_TRANSITIONS[SOPStage.REVIEW], [SOPStage.APPROVED, SOPStage.DRAFT])

    def test_review_overdue_only_when_published(self):
        past = timezone.now().date().replace(year=2020)
        sop = SOP.objects.create(code="SOP-QA-002", title="Storage", owner=self.owner,
                                 stage=SOPStage.DRAFT, next_review_date=past)
        self.assertFalse(sop.review_overdue)
        sop.stage = SOPStage.PUBLISHED
        self.assertTrue(sop.review_overdue)
