"""Dependency & blocker tests (PRD §14, §15 — AC-13, AC-14)."""
import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Role, RoleCapability, User
from apps.accounts.rbac import Capability, Scope
from apps.projects.models import Membership, Project
from apps.tasks.models import Task


def _role() -> Role:
    role = Role.objects.create(name="Contributor", default_scope=Scope.PROJECT)
    for cap in (Capability.VIEW, Capability.CREATE_TASKS, Capability.UPDATE_ASSIGNED,
                Capability.ASSIGN_TASKS, Capability.MANAGE_PROJECT):
        RoleCapability.objects.create(role=role, capability=cap, scope="")
    return role


@pytest.fixture
def member(db):
    root = User.objects.create_superuser("root", "root@kos.local", "pw-123456")
    project = Project.objects.create(name="P", code="P1", owner=root)
    user = User.objects.create_user("u", "u@kos.local", "pw-123456")
    user.roles.add(_role())
    Membership.objects.create(user=user, project=project)
    client = APIClient()
    client.force_authenticate(user)
    return {"project": project, "user": user, "client": client}


def _task(client, project, **extra):
    return client.post("/api/tasks/", {"title": "T", "project": project.id, **extra}, format="json").data["id"]


@pytest.mark.django_db
def test_circular_dependency_rejected(member):
    """AC-14: circular dependencies are rejected at save."""
    c, p = member["client"], member["project"]
    a, b = _task(c, p), _task(c, p)

    r1 = c.post("/api/dependencies/", {"successor": b, "predecessor_task": a, "dependency_type": "fs"}, format="json")
    assert r1.status_code == 201

    r2 = c.post("/api/dependencies/", {"successor": a, "predecessor_task": b, "dependency_type": "fs"}, format="json")
    assert r2.status_code == 400


@pytest.mark.django_db
def test_mandatory_dependency_blocks_completion(member):
    """AC-13: a task can't complete while a mandatory predecessor is incomplete."""
    c, p = member["client"], member["project"]
    pred = _task(c, p, deliverable="Done thing")
    succ = _task(c, p, deliverable="Result")

    c.post("/api/dependencies/", {"successor": succ, "predecessor_task": pred, "dependency_type": "fs", "is_mandatory": True}, format="json")

    # Successor can't complete — predecessor isn't done.
    r = c.post(f"/api/tasks/{succ}/set_status/", {"status": "completed"}, format="json")
    assert r.status_code == 400
    assert any("dependency" in reason.lower() for reason in r.data["blocking_reasons"])

    # Complete the predecessor, then the successor is free to complete.
    assert c.post(f"/api/tasks/{pred}/set_status/", {"status": "completed"}, format="json").status_code == 200
    assert c.post(f"/api/tasks/{succ}/set_status/", {"status": "completed"}, format="json").status_code == 200


@pytest.mark.django_db
def test_blocker_sets_and_clears_status(member):
    """§15.2: raising a blocker blocks the task; resolving restores its status."""
    c, p = member["client"], member["project"]
    tid = _task(c, p)

    r = c.post("/api/blockers/", {"task": tid, "description": "Awaiting parts", "severity": "high"}, format="json")
    assert r.status_code == 201
    assert Task.objects.get(id=tid).status == "blocked"

    bid = r.data["id"]
    r2 = c.post(f"/api/blockers/{bid}/resolve/", {"resolution_note": "Parts arrived"}, format="json")
    assert r2.status_code == 200
    assert Task.objects.get(id=tid).status == "backlog"  # restored to pre-block status
