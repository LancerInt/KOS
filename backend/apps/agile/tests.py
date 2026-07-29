"""Agile & sprint tests (PRD §16)."""
import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Role, RoleCapability, User
from apps.accounts.rbac import Capability, Scope
from apps.agile.models import Sprint
from apps.projects.models import Membership, Project
from apps.tasks.models import Task


def _lead_role() -> Role:
    role = Role.objects.create(name="Agile Lead", default_scope=Scope.PROJECT)
    for cap in (
        Capability.VIEW, Capability.CREATE_TASKS, Capability.UPDATE_ASSIGNED,
        Capability.MANAGE_BACKLOG, Capability.MANAGE_PROJECT,
    ):
        RoleCapability.objects.create(role=role, capability=cap, scope="")
    return role


@pytest.fixture
def lead(db):
    root = User.objects.create_superuser("root", "root@kos.local", "pw-123456")
    project = Project.objects.create(name="P", code="P1", owner=root, sprint_enabled=True)
    user = User.objects.create_user("u", "u@kos.local", "pw-123456")
    user.roles.add(_lead_role())
    Membership.objects.create(user=user, project=project)
    client = APIClient()
    client.force_authenticate(user)
    return {"project": project, "user": user, "client": client}


@pytest.mark.django_db
def test_create_sprint_and_assign_tasks(lead):
    c, p = lead["client"], lead["project"]
    sid = c.post("/api/sprints/", {"name": "Sprint 1", "project": p.id}, format="json").data["id"]

    t1 = c.post("/api/tasks/", {"title": "A", "project": p.id}, format="json").data["id"]
    t2 = c.post("/api/tasks/", {"title": "B", "project": p.id}, format="json").data["id"]

    r = c.post(f"/api/sprints/{sid}/assign/", {"task_ids": [t1, t2], "op": "add"}, format="json")
    assert r.status_code == 200
    assert Task.objects.filter(sprint_id=sid).count() == 2

    # standup summary buckets both as in progress? They're backlog → not active.
    r = c.get(f"/api/sprints/{sid}/standup/")
    assert r.status_code == 200
    assert set(r.data.keys()) >= {"in_progress", "blocked", "overdue", "done", "no_recent_update", "decisions_required"}


@pytest.mark.django_db
def test_sprint_requires_sprint_enabled_project(lead):
    root = User.objects.get(username="root")
    off = Project.objects.create(name="NoSprints", code="NS1", owner=root, sprint_enabled=False)
    Membership.objects.create(user=lead["user"], project=off)

    r = lead["client"].post("/api/sprints/", {"name": "X", "project": off.id}, format="json")
    assert r.status_code == 400


@pytest.mark.django_db
def test_backlog_lists_unscheduled_tasks(lead):
    c, p = lead["client"], lead["project"]
    Task.objects.create(title="Backlog task", project=p)
    sprint = Sprint.objects.create(project=p, name="S")
    Task.objects.create(title="Sprint task", project=p, sprint=sprint)

    r = c.get(f"/api/tasks/?project={p.id}&unscheduled=true")
    assert r.status_code == 200
    titles = {row["title"] for row in r.data["results"]}
    assert "Backlog task" in titles and "Sprint task" not in titles
