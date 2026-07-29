"""Definition of Done gates completion (PRD §11.5, AC-13)."""
from __future__ import annotations

import pytest

from apps.projects.models import Project
from apps.tasks.models import ChecklistItem, Task


@pytest.mark.django_db
def test_task_cannot_complete_without_deliverable():
    from apps.accounts.models import User

    user = User.objects.create_user(username="u", email="u@kos.test", password="x")
    project = Project.objects.create(name="P", code="DOD", owner=user)
    task = Task.objects.create(title="Ship it", project=project)

    reasons = task.blocking_reasons()
    assert any("deliverable" in r.lower() for r in reasons)
    assert task.can_complete() is False


@pytest.mark.django_db
def test_required_checklist_blocks_completion():
    from apps.accounts.models import User

    user = User.objects.create_user(username="u2", email="u2@kos.test", password="x")
    project = Project.objects.create(name="P2", code="DOD2", owner=user)
    task = Task.objects.create(title="Release", project=project, deliverable="A signed release note")
    ChecklistItem.objects.create(task=task, title="QA passed", is_required=True, is_done=False)

    assert task.can_complete() is False
    task.checklist_items.update(is_done=True)
    assert task.can_complete() is True
