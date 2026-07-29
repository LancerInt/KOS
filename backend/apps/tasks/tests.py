"""Task Engine tests — Definition of Done enforcement (PRD §11.5, AC-13)."""
import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Role, RoleCapability, User
from apps.accounts.rbac import Capability, Scope
from apps.projects.models import Membership, Project
from apps.tasks.models import Task


def _contributor_role() -> Role:
    role = Role.objects.create(name="Contributor", default_scope=Scope.PROJECT)
    for cap in (Capability.VIEW, Capability.CREATE_TASKS, Capability.UPDATE_ASSIGNED, Capability.COMMENT):
        RoleCapability.objects.create(role=role, capability=cap, scope="")
    return role


@pytest.fixture
def member(db):
    root = User.objects.create_superuser("root", "root@kos.local", "pw-123456")
    project = Project.objects.create(name="P", code="P1", owner=root)
    user = User.objects.create_user("u", "u@kos.local", "pw-123456")
    user.roles.add(_contributor_role())
    Membership.objects.create(user=user, project=project)
    return {"project": project, "user": user}


@pytest.mark.django_db
def test_create_task_assigns_creator_as_primary_owner(member):
    client = APIClient()
    client.force_authenticate(member["user"])
    resp = client.post("/api/tasks/", {"title": "Draft dossier", "project": member["project"].id}, format="json")
    assert resp.status_code == 201
    task = Task.objects.get(id=resp.data["id"])
    # Creator becomes an owner and the Primary Owner (A1).
    assert task.primary_owner_id == member["user"].id
    assert task.owners.filter(pk=member["user"].id).exists()


@pytest.mark.django_db
def test_cannot_complete_without_deliverable_or_required_checklist(member):
    client = APIClient()
    client.force_authenticate(member["user"])

    tid = client.post("/api/tasks/", {"title": "T", "project": member["project"].id}, format="json").data["id"]

    # No deliverable → completion blocked (AC-13).
    r = client.post(f"/api/tasks/{tid}/set_status/", {"status": "completed"}, format="json")
    assert r.status_code == 400
    assert any("deliverable" in reason.lower() for reason in r.data["blocking_reasons"])

    # Add a deliverable, then a required, unchecked checklist item → still blocked.
    client.patch(f"/api/tasks/{tid}/", {"deliverable": "Signed dossier"}, format="json")
    cid = client.post(
        "/api/checklist-items/",
        {"task": tid, "title": "QA sign-off", "is_required": True},
        format="json",
    ).data["id"]
    r = client.post(f"/api/tasks/{tid}/set_status/", {"status": "completed"}, format="json")
    assert r.status_code == 400

    # Complete the checklist item → completion now allowed.
    client.patch(f"/api/checklist-items/{cid}/", {"is_done": True}, format="json")
    r = client.post(f"/api/tasks/{tid}/set_status/", {"status": "completed"}, format="json")
    assert r.status_code == 200
    assert r.data["status"] == "completed"


@pytest.mark.django_db
def test_moving_to_in_progress_stamps_actual_start(member):
    client = APIClient()
    client.force_authenticate(member["user"])
    tid = client.post("/api/tasks/", {"title": "T", "project": member["project"].id}, format="json").data["id"]

    r = client.post(f"/api/tasks/{tid}/set_status/", {"status": "in_progress"}, format="json")
    assert r.status_code == 200
    assert Task.objects.get(id=tid).actual_start_date is not None
