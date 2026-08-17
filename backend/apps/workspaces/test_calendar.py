"""The unified calendar feed: projects (by end date) and filings (by due date),
scoped to what the viewer can see."""
from __future__ import annotations

import datetime as dt

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.workspaces.models import (
    ComplianceDeadline, ComplianceObligation, WorkspaceMember, WorkspaceProject,
)


def client(u):
    c = APIClient()
    c.force_authenticate(u)
    return c


def _window():
    now = timezone.now()
    start = now.date().replace(day=1).isoformat()
    end = (now + dt.timedelta(days=45)).date().isoformat()
    return now, start, end


@pytest.fixture
def admin(db):
    return User.objects.create_user(username="adm", email="a@x.io", password="pw",
                                    is_superuser=True, is_staff=True)


def test_calendar_lists_projects_and_filings(admin):
    now, start, end = _window()
    WorkspaceProject.objects.create(
        workspace="amazon-usa", name="US Launch", created_by=admin,
        start_at=now, end_at=now + dt.timedelta(days=3))
    ob = ComplianceObligation.objects.get(workspace="finance-statutory", name="GSTR-1")
    ComplianceDeadline.objects.create(
        obligation=ob, period_label="Aug 2026", due_date=(now + dt.timedelta(days=5)).date())

    r = client(admin).get(f"/api/calendar/?start={start}&end={end}")
    assert r.status_code == 200, r.data
    items = r.data["items"]
    assert any(it["kind"] == "project" and it["title"] == "US Launch" for it in items)
    assert any(it["kind"] == "filing" and "GSTR-1" in it["title"] for it in items)
    # Every item carries a link and a date.
    assert all(it["url"] and it["date"] for it in items)


def test_a_project_outside_the_window_is_excluded(admin):
    now, start, end = _window()
    WorkspaceProject.objects.create(
        workspace="amazon-usa", name="Way later", created_by=admin,
        start_at=now, end_at=now + dt.timedelta(days=120))
    r = client(admin).get(f"/api/calendar/?start={start}&end={end}")
    assert not any(it["title"] == "Way later" for it in r.data["items"])


def test_calendar_is_access_scoped(admin):
    now, start, end = _window()
    # An amazon-usa project and a finance filing exist…
    WorkspaceProject.objects.create(
        workspace="amazon-usa", name="Secret", created_by=admin,
        start_at=now, end_at=now + dt.timedelta(days=2))
    ob = ComplianceObligation.objects.get(workspace="finance-statutory", name="GSTR-1")
    ComplianceDeadline.objects.create(
        obligation=ob, period_label="Aug 2026", due_date=(now + dt.timedelta(days=4)).date())

    # …but a researcher who only has Entomology sees neither.
    researcher = User.objects.create_user(username="res", email="r@x.io", password="pw")
    WorkspaceMember.objects.create(user=researcher, workspace="entomology", access=WorkspaceMember.EDIT)
    r = client(researcher).get(f"/api/calendar/?start={start}&end={end}")
    titles = {it["title"] for it in r.data["items"]}
    assert "Secret" not in titles
    assert not any("GSTR-1" in t for t in titles)
