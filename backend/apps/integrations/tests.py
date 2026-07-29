"""Tests for the ERP integration layer (PRD §27)."""
from __future__ import annotations

import json

from django.test import TestCase

from apps.accounts.models import User
from apps.projects.models import Project

from .engine import publish, send_test, sign
from .inbound import handle_inbound
from .models import DeliveryStatus, ErpConnection, EventType, WebhookDelivery


class OutboundTests(TestCase):
    def setUp(self):
        self.conn = ErpConnection.objects.create(
            name="ERP", base_url="https://erp.example/hook", mock_mode=True,
            subscribed_events=[EventType.PROJECT_CREATED, EventType.PING],
        )
        self.owner = User.objects.create_user(username="o", email="o@k.in", password="x")

    def test_publish_only_to_subscribers(self):
        project = Project.objects.create(name="Alpha", code="ALPHA", owner=self.owner)
        # PROJECT_CREATED is subscribed → one mocked delivery (plus the signal-fired one).
        self.assertTrue(WebhookDelivery.objects.filter(event_type=EventType.PROJECT_CREATED).exists())
        d = WebhookDelivery.objects.filter(event_type=EventType.PROJECT_CREATED).first()
        self.assertEqual(d.status, DeliveryStatus.MOCKED)
        self.assertEqual(d.payload["data"]["code"], "ALPHA")

    def test_unsubscribed_event_creates_no_delivery(self):
        created = publish(EventType.TASK_COMPLETED, None)
        self.assertEqual(created, 0)

    def test_send_test_ping(self):
        delivery = send_test(self.conn)
        self.assertEqual(delivery.event_type, EventType.PING)
        self.assertEqual(delivery.status, DeliveryStatus.MOCKED)


class SignatureTests(TestCase):
    def test_hmac_signature_is_stable(self):
        body = json.dumps({"a": 1}).encode()
        self.assertEqual(sign("secret", body), sign("secret", body))
        self.assertNotEqual(sign("secret", body), sign("other", body))


class InboundTests(TestCase):
    def test_ping_handler(self):
        self.assertEqual(handle_inbound("ping", {}), ("processed", "pong"))

    def test_unknown_event_ignored(self):
        status, _ = handle_inbound("nope", {})
        self.assertEqual(status, "ignored")

    def test_project_status_update(self):
        owner = User.objects.create_user(username="o2", email="o2@k.in", password="x")
        Project.objects.create(name="Beta", code="BETA", owner=owner)
        status, _ = handle_inbound("project.status", {"project_code": "BETA", "status": "completed"})
        self.assertEqual(status, "processed")
        self.assertEqual(Project.objects.get(code="BETA").status, "completed")
