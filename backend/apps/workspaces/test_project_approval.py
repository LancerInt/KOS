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


def _requests(project):
    return Notification.objects.filter(
        event="review_requested", url=f"/workspaces/{project.workspace}/projects/{project.id}")


def test_history_traces_the_full_lifecycle(owner, approver, project):
    client(owner).post(f"/api/workspace-projects/{project.id}/submit/")
    client(approver).post(f"/api/workspace-projects/{project.id}/reject/", {"reason": "Fix the label"}, format="json")
    client(owner).post(f"/api/workspace-projects/{project.id}/submit/")   # resubmit
    client(approver).post(f"/api/workspace-projects/{project.id}/approve/")

    r = client(owner).get(f"/api/workspace-projects/{project.id}/history/")
    assert r.status_code == 200, r.data
    kinds = [e["kind"] for e in r.data]
    assert kinds == ["submitted", "rejected", "submitted", "approved"]   # oldest first
    sent_back = r.data[1]
    assert sent_back["reason"] == "Fix the label"
    assert sent_back["actor"] == approver.get_full_name() or approver.username


def test_resubmit_does_not_stack_requests(owner, approver, project):
    client(owner).post(f"/api/workspace-projects/{project.id}/submit/")
    client(approver).post(f"/api/workspace-projects/{project.id}/reject/", {"reason": "x"}, format="json")
    client(owner).post(f"/api/workspace-projects/{project.id}/submit/")   # resubmit
    assert _requests(project).count() == 1   # the old request was cleared, not stacked


def test_approve_clears_the_approval_requests(owner, approver, project):
    client(owner).post(f"/api/workspace-projects/{project.id}/submit/")
    assert _requests(project).exists()
    client(approver).post(f"/api/workspace-projects/{project.id}/approve/")
    assert not _requests(project).exists()   # decided → gone from every approver's queue


def test_reject_clears_the_approval_requests(owner, approver, project):
    client(owner).post(f"/api/workspace-projects/{project.id}/submit/")
    client(approver).post(f"/api/workspace-projects/{project.id}/reject/", {"reason": "x"}, format="json")
    assert not _requests(project).exists()


def test_deleting_a_project_clears_its_approval_requests(owner, approver, project):
    # Otherwise the request lingers and 404s in the approver's queue.
    client(owner).post(f"/api/workspace-projects/{project.id}/submit/")
    assert _requests(project).exists()
    r = client(owner).delete(f"/api/workspace-projects/{project.id}/")
    assert r.status_code in (200, 204), getattr(r, "data", r.status_code)
    assert not _requests(project).exists()


def test_completing_clears_any_pending_review(owner, approver, project):
    # submit → sent back (blocked) → then completed directly: no stale flag remains,
    # so the client never offers Resubmit on a done project.
    client(owner).post(f"/api/workspace-projects/{project.id}/submit/")
    client(approver).post(f"/api/workspace-projects/{project.id}/reject/", {"reason": "x"}, format="json")
    client(owner).post(f"/api/workspace-projects/{project.id}/submit/")   # back to pending
    r = client(approver).post(f"/api/workspace-projects/{project.id}/complete/")
    assert r.status_code == 200, r.data
    assert r.data["review_state"] == ""            # serialised as no-review once done
    project.refresh_from_db()
    assert project.review_state == "" and project.completed_at is not None
    assert not _requests(project).exists()         # completing settled the request
