"""The timeline endpoint: roadmap of projects, and a project's tasks/milestones/deps."""
from datetime import date

import pytest

from apps.dependencies.models import Dependency, DependencyType
from apps.projects.models import Milestone, Project
from apps.tasks.models import Task


@pytest.mark.django_db
def test_roadmap_and_project_timeline(auth_client, admin_user):
    p = Project.objects.create(
        name="Roadmap P", code="TL-1", owner=admin_user,
        start_date=date(2026, 8, 1), target_date=date(2026, 9, 1),
    )
    t1 = Task.objects.create(title="Task A", project=p, start_date=date(2026, 8, 2), due_date=date(2026, 8, 10))
    t2 = Task.objects.create(title="Task B", project=p, start_date=date(2026, 8, 11), due_date=date(2026, 8, 20))
    m = Milestone.objects.create(project=p, title="M1", due_date=date(2026, 8, 15))
    Dependency.objects.create(successor=t2, predecessor_task=t1, dependency_type=DependencyType.FINISH_TO_START)

    roadmap = auth_client.get("/api/timeline/")
    assert roadmap.status_code == 200
    assert p.id in [row["id"] for row in roadmap.data["projects"]]

    detail = auth_client.get(f"/api/timeline/?project={p.id}")
    assert detail.status_code == 200
    assert detail.data["project"]["id"] == p.id
    assert {x["id"] for x in detail.data["tasks"]} == {t1.id, t2.id}
    assert any(x["id"] == m.id for x in detail.data["milestones"])
    assert {"successor": t2.id, "predecessor": t1.id} in detail.data["dependencies"]


@pytest.mark.django_db
def test_undated_tasks_are_excluded(auth_client, admin_user):
    p = Project.objects.create(name="P2", code="TL-2", owner=admin_user)
    Task.objects.create(title="No dates", project=p)  # neither start nor due
    detail = auth_client.get(f"/api/timeline/?project={p.id}")
    assert detail.status_code == 200
    assert detail.data["tasks"] == []
