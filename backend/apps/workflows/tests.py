"""Workflow Engine tests (PRD §12.3, §12.4, D3, A2, AC-10)."""
import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Role, RoleCapability, User
from apps.accounts.rbac import Capability, Scope
from apps.projects.models import Membership, Project
from apps.tasks.models import Task


def _wf_role() -> Role:
    role = Role.objects.create(name="Lead", default_scope=Scope.PROJECT)
    for cap in (
        Capability.VIEW, Capability.CREATE_TASKS, Capability.UPDATE_ASSIGNED,
        Capability.MANAGE_WORKFLOWS, Capability.MANAGE_PROJECT,
    ):
        RoleCapability.objects.create(role=role, capability=cap, scope="")
    return role


@pytest.fixture
def lead(db):
    root = User.objects.create_superuser("root", "root@kos.local", "pw-123456")
    project = Project.objects.create(name="P", code="P1", owner=root)
    user = User.objects.create_user("u", "u@kos.local", "pw-123456")
    user.roles.add(_wf_role())
    Membership.objects.create(user=user, project=project)
    client = APIClient()
    client.force_authenticate(user)
    return {"project": project, "user": user, "client": client}


@pytest.mark.django_db
def test_default_workflow_is_permissive_until_customised(lead):
    """Before customizing, the built-in default doesn't reject transitions."""
    c, p = lead["client"], lead["project"]
    r = c.get(f"/api/projects/{p.id}/workflow/")
    assert r.status_code == 200
    assert r.data["source"] == "default"
    assert r.data["strict"] is False


@pytest.mark.django_db
def test_custom_workflow_enforces_transition_graph(lead):
    """AC-10 / §12.3: after cloning, arbitrary transitions are rejected."""
    c, p = lead["client"], lead["project"]

    # Clone the default into a custom (strict) workflow.
    r = c.post(f"/api/projects/{p.id}/workflow/")
    assert r.status_code == 201
    assert r.data["has_custom"] is True and r.data["strict"] is True

    tid = c.post("/api/tasks/", {"title": "T", "project": p.id, "deliverable": "X"}, format="json").data["id"]

    # backlog → completed is not in the graph → rejected.
    r = c.post(f"/api/tasks/{tid}/set_status/", {"status": "completed"}, format="json")
    assert r.status_code == 400

    # backlog → ready IS in the graph → allowed.
    r = c.post(f"/api/tasks/{tid}/set_status/", {"status": "ready"}, format="json")
    assert r.status_code == 200
    assert r.data["status"] == "ready"


@pytest.mark.django_db
def test_status_requires_a_canonical_category(lead):
    """A2: every custom status must map to a canonical category."""
    c, p = lead["client"], lead["project"]
    c.post(f"/api/projects/{p.id}/workflow/")

    bad = {
        "statuses": [{"key": "todo", "label": "To Do", "category": "not_a_category"}],
        "transitions": [],
    }
    r = c.put(f"/api/projects/{p.id}/workflow/", bad, format="json")
    assert r.status_code == 400


@pytest.mark.django_db
def test_cannot_remove_status_in_use(lead):
    """§12.4: a status used by an active task can't be deleted until migrated."""
    c, p = lead["client"], lead["project"]
    c.post(f"/api/projects/{p.id}/workflow/")
    Task.objects.create(title="T", project=p, status="in_progress")

    # Save a workflow that drops 'in_progress' → rejected.
    payload = {
        "statuses": [
            {"key": "backlog", "label": "Backlog", "category": "not_started", "is_initial": True},
            {"key": "done", "label": "Done", "category": "done"},
        ],
        "transitions": [{"from": "backlog", "to": "done"}],
    }
    r = c.put(f"/api/projects/{p.id}/workflow/", payload, format="json")
    assert r.status_code == 400
