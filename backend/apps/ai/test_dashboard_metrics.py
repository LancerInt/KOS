"""The figures the dashboard AI actions read.

The Dashboard screen lists **workspace** projects. The AI module analyses the
``Project``/``Task`` pair, which is a different subsystem entirely — and on an
installation that works only in workspaces, an empty one. Reporting its zeros
alongside real workspace projects is what made the deployed panel announce "no
current project activity" to someone looking at thirteen projects, four of them
overdue.
"""
from __future__ import annotations

import pytest

from apps.ai.views import _dashboard_metrics
from apps.workspaces.models import WorkspaceProject

TASK_KEYS = {"visible_projects", "active_projects", "total_open_tasks", "overdue_tasks"}


@pytest.mark.django_db
def test_workspace_projects_are_counted(admin_user):
    WorkspaceProject.objects.create(workspace="amazon-usa", name="USA Operations")
    WorkspaceProject.objects.create(workspace="cibrc", name="XYZ")
    metrics = _dashboard_metrics(admin_user)
    assert metrics["dashboard_projects"] == 2


@pytest.mark.django_db
def test_a_deleted_workspace_project_is_not_counted(admin_user):
    from django.utils import timezone

    WorkspaceProject.objects.create(workspace="amazon-usa", name="Live")
    WorkspaceProject.objects.create(workspace="amazon-usa", name="Gone", deleted_at=timezone.now())
    assert _dashboard_metrics(admin_user)["dashboard_projects"] == 1


@pytest.mark.django_db
def test_an_empty_task_subsystem_is_left_out_entirely(admin_user):
    """The bug: zeros from an unused subsystem drowned out the real figures."""
    WorkspaceProject.objects.create(workspace="amazon-usa", name="USA Operations")
    metrics = _dashboard_metrics(admin_user)
    # No "0 active projects" for the model to believe and report.
    assert not (TASK_KEYS & set(metrics))
    assert metrics["dashboard_projects"] == 1


@pytest.mark.django_db
def test_task_figures_are_kept_when_that_subsystem_is_in_use(admin_user):
    from apps.projects.models import Project

    Project.objects.create(name="Neem Oil", code="NEEM-1", owner=admin_user)
    WorkspaceProject.objects.create(workspace="amazon-usa", name="USA Operations")
    metrics = _dashboard_metrics(admin_user)
    # Both worlds are real here, so the AI should see both.
    assert TASK_KEYS <= set(metrics)
    assert metrics["visible_projects"] == 1
    assert metrics["dashboard_projects"] == 1


@pytest.mark.django_db
def test_nothing_anywhere_still_answers_with_a_shape(admin_user):
    metrics = _dashboard_metrics(admin_user)
    assert metrics["dashboard_projects"] == 0
    assert not (TASK_KEYS & set(metrics))
