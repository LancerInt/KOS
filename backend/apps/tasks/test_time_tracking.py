"""Time logging on tasks, and the per-person workload roll-up."""
import pytest

from apps.projects.models import Project
from apps.tasks.models import Task


def _results(data):
    return data["results"] if isinstance(data, dict) and "results" in data else data


@pytest.mark.django_db
def test_log_time_and_workload(auth_client, admin_user):
    project = Project.objects.create(name="P", code="TT-1", owner=admin_user)
    task = Task.objects.create(title="T", project=project, estimate_minutes=120)
    task.owners.add(admin_user)

    created = auth_client.post("/api/time-entries/", {"task": task.id, "minutes": 90, "spent_on": "2026-08-06"})
    assert created.status_code == 201, created.content
    assert created.data["user"] == admin_user.id

    listing = _results(auth_client.get(f"/api/time-entries/?task={task.id}").data)
    assert len(listing) == 1 and listing[0]["minutes"] == 90

    task.refresh_from_db()
    assert task.logged_minutes == 90

    wl = auth_client.get("/api/time-entries/workload/?start=2026-08-03&end=2026-08-09")
    assert wl.status_code == 200
    row = next(r for r in wl.data["rows"] if r["user_id"] == admin_user.id)
    assert row["logged_minutes"] == 90
    assert row["open_tasks"] == 1
    assert row["open_estimate_minutes"] == 120


@pytest.mark.django_db
def test_zero_minutes_rejected(auth_client, admin_user):
    project = Project.objects.create(name="P", code="TT-2", owner=admin_user)
    task = Task.objects.create(title="T", project=project)
    r = auth_client.post("/api/time-entries/", {"task": task.id, "minutes": 0, "spent_on": "2026-08-06"})
    assert r.status_code == 400
