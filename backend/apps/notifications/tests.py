"""Notification & escalation tests (PRD §22 — AC-15, AC-16)."""
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Role, RoleCapability, User
from apps.accounts.rbac import Capability, Scope
from apps.notifications.models import Notification, NotificationEvent
from apps.notifications.tasks import scan_due_soon, scan_overdue_acknowledgements
from apps.projects.models import Membership, Project
from apps.tasks.models import Task


@pytest.fixture
def member(db):
    root = User.objects.create_superuser("root", "root@kos.local", "pw-123456")
    project = Project.objects.create(name="P", code="P1", owner=root)
    user = User.objects.create_user("u", "u@kos.local", "pw-123456")
    role = Role.objects.create(name="Contributor", default_scope=Scope.PROJECT)
    RoleCapability.objects.create(role=role, capability=Capability.VIEW, scope="")
    user.roles.add(role)
    Membership.objects.create(user=user, project=project)
    return {"project": project, "user": user}


@pytest.mark.django_db
def test_due_soon_reminder_fires_two_days_before(member):
    today = timezone.now().date()
    task = Task.objects.create(title="Submit", project=member["project"], due_date=today + timedelta(days=2))
    task.owners.add(member["user"])

    assert scan_due_soon() == 1
    assert Notification.objects.filter(recipient=member["user"], task=task, event=NotificationEvent.DUE_SOON).exists()

    # Idempotent — a second scan doesn't duplicate.
    assert scan_due_soon() == 0


@pytest.mark.django_db
def test_overdue_48h_requires_acknowledgement(member):
    today = timezone.now().date()
    task = Task.objects.create(title="Late", project=member["project"], due_date=today - timedelta(days=3),
                               primary_owner=member["user"])
    task.owners.add(member["user"])

    assert scan_overdue_acknowledgements() == 1
    notif = Notification.objects.get(task=task, event=NotificationEvent.OVERDUE_ACK)
    assert notif.requires_acknowledgement and notif.acknowledged_at is None

    client = APIClient()
    client.force_authenticate(member["user"])

    # Acknowledgement message is mandatory (§22.4).
    assert client.post(f"/api/notifications/{notif.id}/acknowledge/", {}, format="json").status_code == 400
    r = client.post(f"/api/notifications/{notif.id}/acknowledge/", {"message": "Done Friday, waiting on lab"}, format="json")
    assert r.status_code == 200
    notif.refresh_from_db()
    assert notif.acknowledged_at is not None and notif.acknowledgement_message
