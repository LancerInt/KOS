"""Offline sync must be idempotent and merge-safe (PRD §25, recommended #5)."""
from __future__ import annotations

import pytest

from apps.projects.models import Project
from apps.tasks.models import ChecklistItem, Task


@pytest.mark.django_db
def test_replayed_comment_is_not_double_posted(auth_client, admin_user):
    project = Project.objects.create(name="P", code="PSY", owner=admin_user)
    task = Task.objects.create(title="Task", project=project)
    op = {"op_id": "op-comment-1", "kind": "add_comment", "task": task.id, "body": "queued while offline"}

    first = auth_client.post("/api/sync/", {"ops": [op]}, format="json")
    second = auth_client.post("/api/sync/", {"ops": [op]}, format="json")

    assert first.status_code == 200 and second.status_code == 200
    assert task.comments.count() == 1                          # replay did not duplicate
    assert second.data["results"][0].get("duplicate") is True


@pytest.mark.django_db
def test_checklist_tick_is_field_level(auth_client, admin_user):
    project = Project.objects.create(name="P2", code="PSY2", owner=admin_user)
    task = Task.objects.create(title="Task", project=project)
    item = ChecklistItem.objects.create(task=task, title="Sign off")

    op = {"op_id": "op-chk-1", "kind": "set_checklist", "item": item.id, "is_done": True}
    resp = auth_client.post("/api/sync/", {"ops": [op]}, format="json")

    assert resp.status_code == 200
    item.refresh_from_db()
    assert item.is_done is True
