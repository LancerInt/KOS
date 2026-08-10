"""Workspace-project approval workflow: submit → notify approvers → approve
(completes) / reject (sends back with a reason, notifies the owner)."""
from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.notifications.models import Notification
from apps.workspaces.models import WorkspaceMember, WorkspaceProject

WS = "crm"  # a built-in workspace


@pytest.fixture
def approver(db):  # superuser → IT/Management-style approver
    return User.objects.create_superuser(username="root", email="root@x.io", password="pw")


@pytest.fixture
def owner(db):
    u = User.objects.create_user(username="owner", email="owner@x.io", password="pw")
    WorkspaceMember.objects.create(user=u, workspace=WS, access="edit")
    return u


@pytest.fixture
def project(owner):
    return WorkspaceProject.objects.create(workspace=WS, name="Neem Oil 2026", created_by=owner)


def client(user) -> APIClient:
    c = APIClient()
    c.force_authenticate(user)
    return c


def test_submit_flags_pending_and_notifies_approvers(owner, approver, project):
    r = client(owner).post(f"/api/workspace-projects/{project.id}/submit/")
    assert r.status_code == 200, r.data
    project.refresh_from_db()
    assert project.review_state == "needs_decision"
    assert project.submitted_by == owner
    assert Notification.objects.filter(recipient=approver, title__icontains="Approval needed").exists()


def test_approve_completes_and_notifies_owner(owner, approver, project):
    client(owner).post(f"/api/workspace-projects/{project.id}/submit/")
    r = client(approver).post(f"/api/workspace-projects/{project.id}/approve/")
    assert r.status_code == 200, r.data
    project.refresh_from_db()
    assert project.completed_at is not None and project.review_state == ""
    assert Notification.objects.filter(recipient=owner, title__icontains="Approved").exists()


def test_reject_requires_a_reason(owner, approver, project):
    client(owner).post(f"/api/workspace-projects/{project.id}/submit/")
    r = client(approver).post(f"/api/workspace-projects/{project.id}/reject/", {}, format="json")
    assert r.status_code == 400


def test_reject_sends_back_with_reason_and_notifies_owner(owner, approver, project):
    client(owner).post(f"/api/workspace-projects/{project.id}/submit/")
    r = client(approver).post(
        f"/api/workspace-projects/{project.id}/reject/", {"reason": "Fix the EPA label"}, format="json")
    assert r.status_code == 200, r.data
    project.refresh_from_db()
    assert project.review_state == "blocked"
    assert project.review_reason == "Fix the EPA label"
    assert project.completed_at is None
    note = Notification.objects.filter(recipient=owner, title__icontains="Sent back").first()
    assert note and "Fix the EPA label" in note.body


def test_a_non_approver_cannot_approve(owner, project):
    client(owner).post(f"/api/workspace-projects/{project.id}/submit/")
    r = client(owner).post(f"/api/workspace-projects/{project.id}/approve/")   # owner isn't a supervisor
    assert r.status_code == 403
