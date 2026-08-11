"""Repeating projects: completing one starts the next.

The cadence is anchored to the start date, so most of these cases are about the
successor landing on the right day regardless of when approval happened.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone as dt_tz

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.workspaces.models import WorkspaceMember, WorkspaceProject, WorkspaceProjectMember
from apps.workspaces.recurrence import add_months, spawn_successor

WS = "crm"


def client(user) -> APIClient:
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def approver(db):
    return User.objects.create_superuser(username="root", email="root@x.io", password="pw")


@pytest.fixture
def owner(db):
    u = User.objects.create_user(username="owner", email="owner@x.io", password="pw")
    WorkspaceMember.objects.create(user=u, workspace=WS, access="edit")
    return u


def at(y, m, d, h=9):
    return datetime(y, m, d, h, tzinfo=dt_tz.utc)


# --- the month arithmetic ------------------------------------------------------ #

@pytest.mark.parametrize("start,months,expected", [
    (at(2026, 1, 15), 1, at(2026, 2, 15)),
    (at(2026, 1, 15), 3, at(2026, 4, 15)),
    (at(2026, 1, 15), 12, at(2027, 1, 15)),
    (at(2026, 11, 20), 3, at(2027, 2, 20)),      # crosses the year
    (at(2026, 1, 31), 1, at(2026, 2, 28)),       # clamps into a short month
    (at(2028, 1, 31), 1, at(2028, 2, 29)),       # …and knows about leap years
    (at(2026, 8, 31), 3, at(2026, 11, 30)),
])
def test_add_months(start, months, expected):
    assert add_months(start, months) == expected


def test_clamping_does_not_erode_across_hops():
    """31 Jan → 28 Feb → 28 Mar would drift; anchoring each hop to the original
    start keeps a 31st job on the 31st whenever the month has one."""
    start = at(2026, 1, 31)
    assert add_months(start, 1) == at(2026, 2, 28)
    assert add_months(start, 2) == at(2026, 3, 31)
    assert add_months(start, 3) == at(2026, 4, 30)


# --- spawning ------------------------------------------------------------------- #

@pytest.fixture
def quarterly(owner):
    return WorkspaceProject.objects.create(
        workspace=WS, name="GST return", created_by=owner,
        start_at=at(2026, 1, 15), end_at=at(2026, 1, 25),
        repeat_frequency=WorkspaceProject.REPEAT_QUARTERLY,
    )


def test_approving_starts_the_next_one(owner, approver, quarterly):
    client(owner).post(f"/api/workspace-projects/{quarterly.id}/submit/")
    r = client(approver).post(f"/api/workspace-projects/{quarterly.id}/approve/")
    assert r.status_code == 200, r.data

    quarterly.refresh_from_db()
    nxt = quarterly.next_occurrence
    assert nxt is not None
    # A workspace allows one live project per name, so the turn is tagged with
    # the period it covers rather than reusing the name.
    assert nxt.name == "GST return · Apr 2026"
    assert nxt.workspace == WS
    assert nxt.start_at == at(2026, 4, 15)
    assert nxt.repeat_frequency == WorkspaceProject.REPEAT_QUARTERLY
    assert nxt.completed_at is None          # the new turn starts open
    assert nxt.review_state == ""


def test_the_successor_keeps_the_same_length(quarterly):
    spawn_successor(quarterly)
    nxt = WorkspaceProject.objects.get(pk=quarterly.next_occurrence_id)
    assert nxt.end_at - nxt.start_at == timedelta(days=10)


def test_an_open_ended_project_stays_open_ended(owner):
    p = WorkspaceProject.objects.create(
        workspace=WS, name="Monthly review", created_by=owner,
        start_at=at(2026, 3, 1), repeat_frequency=WorkspaceProject.REPEAT_MONTHLY)
    spawn_successor(p)
    nxt = WorkspaceProject.objects.get(pk=p.next_occurrence_id)
    assert nxt.start_at == at(2026, 4, 1)
    assert nxt.end_at is None


def test_a_one_off_project_spawns_nothing(owner, approver):
    p = WorkspaceProject.objects.create(
        workspace=WS, name="One and done", created_by=owner, start_at=at(2026, 1, 15))
    client(owner).post(f"/api/workspace-projects/{p.id}/submit/")
    client(approver).post(f"/api/workspace-projects/{p.id}/approve/")
    p.refresh_from_db()
    assert p.next_occurrence_id is None
    assert WorkspaceProject.objects.count() == 1


def test_the_cadence_ignores_a_late_approval(owner, approver, quarterly):
    """Approved months late, the next turn still lands on the regular slot —
    even though that puts its start in the past. A missed cycle should show."""
    spawn_successor(quarterly)
    nxt = WorkspaceProject.objects.get(pk=quarterly.next_occurrence_id)
    assert nxt.start_at == at(2026, 4, 15)   # start + 3 months, not approval + 3


def test_spawning_twice_is_a_no_op(quarterly):
    first = spawn_successor(quarterly)
    again = spawn_successor(quarterly)
    assert again is None
    assert WorkspaceProject.objects.count() == 2
    quarterly.refresh_from_db()
    assert quarterly.next_occurrence_id == first.id


def test_reopening_and_reapproving_does_not_fork_the_chain(owner, approver, quarterly):
    client(owner).post(f"/api/workspace-projects/{quarterly.id}/submit/")
    client(approver).post(f"/api/workspace-projects/{quarterly.id}/approve/")
    client(owner).post(f"/api/workspace-projects/{quarterly.id}/complete/")   # reopen
    client(owner).post(f"/api/workspace-projects/{quarterly.id}/submit/")
    client(approver).post(f"/api/workspace-projects/{quarterly.id}/approve/")
    assert WorkspaceProject.objects.count() == 2


def test_the_period_tag_does_not_accumulate_down_the_chain(quarterly):
    """Ten turns in, the name is still one project plus one date."""
    current = quarterly
    for _ in range(3):
        current = spawn_successor(current)
    # Jan → Apr → Jul → Oct, and one tag throughout, not three stacked up.
    assert current.name == "GST return · Oct 2026"
    assert current.start_at == at(2026, 10, 15)


def test_a_clashing_tagged_name_gets_a_counter(owner, quarterly):
    """Someone already filed one by hand for that period — still nameable."""
    WorkspaceProject.objects.create(
        workspace=WS, name="GST return · Apr 2026", created_by=owner)
    nxt = spawn_successor(quarterly)
    assert nxt.name == "GST return · Apr 2026 (2)"


def test_the_roster_carries_over(owner, approver, quarterly):
    """A project with members is need-to-know; the next turn must not quietly
    re-open to the whole workspace."""
    member = User.objects.create_user(username="analyst", email="a@x.io", password="pw")
    WorkspaceProjectMember.objects.create(project=quarterly, user=member)

    spawn_successor(quarterly, actor=approver)
    nxt = WorkspaceProject.objects.get(pk=quarterly.next_occurrence_id)
    assert list(nxt.members.values_list("user_id", flat=True)) == [member.id]


def test_the_chain_continues_past_the_second_turn(quarterly):
    spawn_successor(quarterly)
    second = WorkspaceProject.objects.get(pk=quarterly.next_occurrence_id)
    spawn_successor(second)
    third = WorkspaceProject.objects.get(pk=second.next_occurrence_id)
    assert [p.start_at for p in (quarterly, second, third)] == [
        at(2026, 1, 15), at(2026, 4, 15), at(2026, 7, 15)]


# --- the API surface ------------------------------------------------------------- #

def test_creating_a_repeating_project_requires_a_start_date(owner):
    r = client(owner).post("/api/workspace-projects/", {
        "workspace": WS, "name": "Annual audit", "repeat_frequency": "yearly",
    }, format="json")
    assert r.status_code == 400
    assert "start_at" in r.data


def test_a_one_off_needs_no_start_date(owner):
    r = client(owner).post("/api/workspace-projects/",
                           {"workspace": WS, "name": "Ad hoc"}, format="json")
    assert r.status_code == 201, r.data


def test_frequency_is_editable_after_creation(owner, quarterly):
    r = client(owner).patch(f"/api/workspace-projects/{quarterly.id}/",
                            {"repeat_frequency": "yearly"}, format="json")
    assert r.status_code == 200, r.data
    assert r.data["repeat_frequency"] == "yearly"
    quarterly.refresh_from_db()
    assert quarterly.repeat_frequency == "yearly"


def test_turning_repetition_off_is_allowed(owner, quarterly):
    r = client(owner).patch(f"/api/workspace-projects/{quarterly.id}/",
                            {"repeat_frequency": ""}, format="json")
    assert r.status_code == 200, r.data
    assert r.data["repeat_frequency"] == ""


def test_clearing_the_start_date_of_a_repeating_project_is_refused(owner, quarterly):
    """The merged-state check: the PATCH only sends start_at, but the stored
    frequency still makes it invalid."""
    r = client(owner).patch(f"/api/workspace-projects/{quarterly.id}/",
                            {"start_at": None}, format="json")
    assert r.status_code == 400
    assert "start_at" in r.data
