"""Approval tests (PRD §13 — AC-11, AC-12, AC-20)."""
import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Role, RoleCapability, User
from apps.accounts.rbac import Capability, Scope
from apps.projects.models import Membership, Project
from apps.tasks.models import Task


def _role(name, caps) -> Role:
    role = Role.objects.create(name=name, default_scope=Scope.PROJECT)
    for cap in caps:
        RoleCapability.objects.create(role=role, capability=cap, scope="")
    return role


@pytest.fixture
def world(db):
    root = User.objects.create_superuser("root", "root@kos.local", "pw-123456")
    project = Project.objects.create(name="P", code="P1", owner=root)

    submitter = User.objects.create_user("sub", "sub@kos.local", "pw-123456")
    submitter.roles.add(_role("Contributor", [Capability.VIEW, Capability.CREATE_TASKS, Capability.UPDATE_ASSIGNED]))
    Membership.objects.create(user=submitter, project=project)

    approver = User.objects.create_user("mgr", "mgr@kos.local", "pw-123456")
    approver.roles.add(_role("Manager", [Capability.VIEW, Capability.APPROVE]))
    Membership.objects.create(user=approver, project=project)

    sc, ac = APIClient(), APIClient()
    sc.force_authenticate(submitter)
    ac.force_authenticate(approver)
    return {"project": project, "submitter": submitter, "approver": approver, "sc": sc, "ac": ac}


def _task(client, project, **extra):
    return client.post("/api/tasks/", {"title": "T", "project": project.id, **extra}, format="json").data["id"]


@pytest.mark.django_db
def test_single_approver_completes_gate(world):
    """AC-11: approval by one authorised approver completes the gate; the
    submitter cannot approve their own request."""
    sc, ac, p = world["sc"], world["ac"], world["project"]
    tid = _task(sc, p, deliverable="Report")

    req = sc.post("/api/approvals/", {"kind": "deliverable", "task": tid}, format="json")
    assert req.status_code == 201
    aid = req.data["id"]
    assert Task.objects.get(id=tid).status == "review"

    # Submitter can't approve their own (§13.2).
    assert sc.post(f"/api/approvals/{aid}/decide/", {"decision": "approve"}, format="json").status_code == 403

    # One authorised approver acts → done.
    r = ac.post(f"/api/approvals/{aid}/decide/", {"decision": "approve"}, format="json")
    assert r.status_code == 200 and r.data["status"] == "approved"
    assert Task.objects.get(id=tid).status == "approved"


@pytest.mark.django_db
def test_reject_requires_reason(world):
    """AC-12: reject / request changes require a mandatory reason."""
    sc, ac, p = world["sc"], world["ac"], world["project"]
    tid = _task(sc, p, deliverable="Report")
    aid = sc.post("/api/approvals/", {"kind": "deliverable", "task": tid}, format="json").data["id"]

    assert ac.post(f"/api/approvals/{aid}/decide/", {"decision": "reject"}, format="json").status_code == 400
    r = ac.post(f"/api/approvals/{aid}/decide/", {"decision": "reject", "reason": "Missing data"}, format="json")
    assert r.status_code == 200
    assert Task.objects.get(id=tid).status == "rework"


@pytest.mark.django_db
def test_deadline_change_requires_approval_then_applies(world):
    """AC-20: a deadline change goes through approval and is applied on approve."""
    sc, ac, p = world["sc"], world["ac"], world["project"]
    tid = _task(sc, p, due_date="2026-08-01")

    aid = sc.post("/api/approvals/",
                  {"kind": "deadline_change", "task": tid, "payload": {"new_due_date": "2026-09-01"}},
                  format="json").data["id"]
    ac.post(f"/api/approvals/{aid}/decide/", {"decision": "approve"}, format="json")
    assert str(Task.objects.get(id=tid).due_date) == "2026-09-01"


@pytest.mark.django_db
def test_direct_deadline_edit_blocked_without_approve(world):
    """AC-20: a non-approver can't just edit the due date directly."""
    sc, p = world["sc"], world["project"]
    tid = _task(sc, p, due_date="2026-08-01")
    r = sc.patch(f"/api/tasks/{tid}/", {"due_date": "2026-10-01"}, format="json")
    assert r.status_code == 400
