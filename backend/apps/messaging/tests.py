"""Direct messages: who may open a thread, and how a thread behaves once open.

The policy under test is asymmetric — Management/IT start conversations, both
sides write in them — so most of these cases are about a staff member being
able to do everything *except* start.
"""
from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.notifications.models import Notification, NotificationEvent

from .models import Conversation, DirectMessage


def client(user) -> APIClient:
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def management(db):
    role = Role.objects.create(name="Management")
    u = User.objects.create_user(username="md", email="md@x.io", password="pw")
    u.roles.add(role)
    return u


@pytest.fixture
def staff(db):
    return User.objects.create_user(username="worker", email="worker@x.io", password="pw")


@pytest.fixture
def other_staff(db):
    return User.objects.create_user(username="worker2", email="worker2@x.io", password="pw")


# --- who may start ---------------------------------------------------------- #

def test_management_can_start_a_thread(management, staff):
    r = client(management).post("/api/conversations/", {"recipient": staff.id}, format="json")
    assert r.status_code == 201, r.data
    assert r.data["other"]["id"] == staff.id


def test_staff_cannot_start_a_thread(staff, other_staff):
    r = client(staff).post("/api/conversations/", {"recipient": other_staff.id}, format="json")
    assert r.status_code == 403
    assert not Conversation.objects.exists()


def test_directory_tells_staff_they_cannot_start(staff, management):
    r = client(staff).get("/api/message-directory/")
    assert r.status_code == 200
    assert r.data == {"can_start": False, "people": []}


def test_directory_lists_colleagues_for_management(management, staff):
    r = client(management).get("/api/message-directory/")
    assert r.data["can_start"] is True
    assert [p["id"] for p in r.data["people"]] == [staff.id]  # never includes self


def test_cannot_message_yourself(management):
    r = client(management).post("/api/conversations/", {"recipient": management.id}, format="json")
    assert r.status_code == 400


def test_thread_is_reused_not_duplicated(management, staff):
    a = client(management).post("/api/conversations/", {"recipient": staff.id}, format="json")
    b = client(management).post("/api/conversations/", {"recipient": staff.id}, format="json")
    assert a.data["id"] == b.data["id"]
    assert b.status_code == 200  # reused, not created
    assert Conversation.objects.count() == 1


# --- writing and reading ------------------------------------------------------ #

def test_staff_can_reply_in_a_thread_opened_for_them(management, staff):
    conv = client(management).post(
        "/api/conversations/", {"recipient": staff.id, "body": "Can you send the report?"}, format="json"
    ).data
    r = client(staff).post(f"/api/conversations/{conv['id']}/messages/", {"body": "On it today"}, format="json")
    assert r.status_code == 201, r.data
    assert r.data["mine"] is True
    bodies = [m.body for m in DirectMessage.objects.order_by("created_at")]
    assert bodies == ["Can you send the report?", "On it today"]


def test_outsider_cannot_read_or_write_someone_elses_thread(management, staff, other_staff):
    conv = client(management).post("/api/conversations/", {"recipient": staff.id, "body": "hi"}, format="json").data
    assert client(other_staff).get(f"/api/conversations/{conv['id']}/messages/").status_code == 404
    r = client(other_staff).post(f"/api/conversations/{conv['id']}/messages/", {"body": "nosy"}, format="json")
    assert r.status_code == 404


def test_empty_body_is_rejected(management, staff):
    conv = client(management).post("/api/conversations/", {"recipient": staff.id}, format="json").data
    r = client(management).post(f"/api/conversations/{conv['id']}/messages/", {"body": "   "}, format="json")
    assert r.status_code == 400


def test_thread_reads_oldest_first(management, staff):
    conv = client(management).post("/api/conversations/", {"recipient": staff.id, "body": "one"}, format="json").data
    client(staff).post(f"/api/conversations/{conv['id']}/messages/", {"body": "two"}, format="json")
    client(management).post(f"/api/conversations/{conv['id']}/messages/", {"body": "three"}, format="json")
    rows = client(staff).get(f"/api/conversations/{conv['id']}/messages/").data
    assert [m["body"] for m in rows] == ["one", "two", "three"]


# --- unread tracking ----------------------------------------------------------- #

def test_unread_counts_only_incoming_and_clears_on_read(management, staff):
    conv = client(management).post("/api/conversations/", {"recipient": staff.id, "body": "first"}, format="json").data
    client(management).post(f"/api/conversations/{conv['id']}/messages/", {"body": "second"}, format="json")

    # The sender never has unread of their own.
    assert client(management).get("/api/conversations/unread_count/").data["unread"] == 0
    assert client(staff).get("/api/conversations/unread_count/").data == {"unread": 2, "threads": 1}

    assert client(staff).post(f"/api/conversations/{conv['id']}/read/").data["marked"] == 2
    assert client(staff).get("/api/conversations/unread_count/").data["unread"] == 0


def test_list_shows_unread_and_last_message(management, staff):
    client(management).post("/api/conversations/", {"recipient": staff.id, "body": "ping"}, format="json")
    row = client(staff).get("/api/conversations/").data["results"][0]
    assert row["unread"] == 1
    assert row["last_message"] == {"body": "ping", "sender": management.id, "mine": False}
    assert row["other"]["id"] == management.id


def test_unwritten_thread_is_hidden_from_the_other_person(management, staff):
    client(management).post("/api/conversations/", {"recipient": staff.id}, format="json")
    assert client(staff).get("/api/conversations/").data["results"] == []
    # …but the person who opened it still sees their own draft thread.
    assert len(client(management).get("/api/conversations/").data["results"]) == 1


# --- notification pings --------------------------------------------------------- #

def test_first_unread_message_pings_but_a_run_of_them_does_not(management, staff):
    conv = client(management).post("/api/conversations/", {"recipient": staff.id, "body": "one"}, format="json").data
    client(management).post(f"/api/conversations/{conv['id']}/messages/", {"body": "two"}, format="json")
    client(management).post(f"/api/conversations/{conv['id']}/messages/", {"body": "three"}, format="json")

    pings = Notification.objects.filter(recipient=staff, event=NotificationEvent.DIRECT_MESSAGE)
    assert pings.count() == 1
    assert pings.first().url == f"/messages/{conv['id']}"

    # Once they've caught up, the next message pings again.
    client(staff).post(f"/api/conversations/{conv['id']}/read/")
    client(management).post(f"/api/conversations/{conv['id']}/messages/", {"body": "four"}, format="json")
    assert pings.count() == 2
