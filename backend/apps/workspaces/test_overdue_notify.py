"""Overdue workspace-project reminders reach the whole assigned team (not just
the creator), fire as soon as the project runs late, and never duplicate."""
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.notifications.models import Notification, NotificationEvent
from apps.workspaces.duration import sync_all_due_durations
from apps.workspaces.models import WorkspaceMember, WorkspaceProject

User = get_user_model()


@pytest.mark.django_db
def test_overdue_project_notifies_every_member_once():
    creator = User.objects.create_user(username="creator", email="c@kos.test", password="x")
    member = User.objects.create_user(username="member", email="m@kos.test", password="x")
    stranger = User.objects.create_user(username="stranger", email="s@kos.test", password="x")

    # `member` is on the workspace team; `stranger` is not.
    WorkspaceMember.objects.create(user=member, workspace="amazon-usa", access=WorkspaceMember.EDIT)

    now = timezone.now()
    project = WorkspaceProject.objects.create(
        workspace="amazon-usa", name="Overdue project", created_by=creator,
        start_at=now - timedelta(days=2), end_at=now - timedelta(minutes=5),  # just went overdue
    )

    fired = sync_all_due_durations()
    assert fired >= 2

    url = f"/workspaces/{project.workspace}/projects/{project.id}"

    def overdue_for(user):
        return Notification.objects.filter(
            recipient=user, url=url, event=NotificationEvent.OVERDUE
        )

    assert overdue_for(creator).count() == 1     # creator always included
    assert overdue_for(member).count() == 1      # the assigned team member gets it too
    assert overdue_for(stranger).count() == 0    # someone with no access does not

    # Running the scan again must not create duplicates.
    sync_all_due_durations()
    assert overdue_for(creator).count() == 1
    assert overdue_for(member).count() == 1


@pytest.mark.django_db
def test_not_yet_overdue_project_is_silent():
    owner = User.objects.create_user(username="owner", email="o@kos.test", password="x")
    now = timezone.now()
    project = WorkspaceProject.objects.create(
        workspace="amazon-usa", name="On track", created_by=owner,
        start_at=now - timedelta(days=1), end_at=now + timedelta(days=3),  # still in the future
    )
    sync_all_due_durations()
    url = f"/workspaces/{project.workspace}/projects/{project.id}"
    assert not Notification.objects.filter(url=url, event=NotificationEvent.OVERDUE).exists()
