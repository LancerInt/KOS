"""Tests for the automation engine (PRD §24)."""
from __future__ import annotations

from django.test import TestCase

from apps.accounts.models import User
from apps.projects.models import Project

from .engine import conditions_met
from .models import AutomationRule, TriggerType


class ConditionTests(TestCase):
    def test_all_conditions_must_hold(self):
        ctx = {"status": "blocked", "priority": "critical", "is_overdue": True}
        self.assertTrue(conditions_met([{"field": "status", "op": "eq", "value": "blocked"}], ctx))
        self.assertFalse(conditions_met([{"field": "status", "op": "eq", "value": "done"}], ctx))
        self.assertTrue(conditions_met([
            {"field": "priority", "op": "in", "value": ["high", "critical"]},
            {"field": "is_overdue", "op": "is_true"},
        ], ctx))
        self.assertFalse(conditions_met([
            {"field": "priority", "op": "eq", "value": "critical"},
            {"field": "is_overdue", "op": "is_false"},
        ], ctx))

    def test_empty_conditions_always_match(self):
        self.assertTrue(conditions_met([], {"status": "anything"}))


class RuleScopeTests(TestCase):
    def test_global_and_project_rules_coexist(self):
        owner = User.objects.create_user(username="o", email="o@k.in", password="x")
        project = Project.objects.create(name="Alpha", code="ALPHA", owner=owner)
        AutomationRule.objects.create(name="Global", trigger=TriggerType.TASK_CREATED)
        AutomationRule.objects.create(name="Scoped", trigger=TriggerType.TASK_CREATED, project=project)
        self.assertEqual(AutomationRule.objects.filter(trigger=TriggerType.TASK_CREATED).count(), 2)
