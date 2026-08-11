"""Direct messages: who may open a thread, and how a thread behaves once open.

The policy under test is asymmetric — Management/IT start conversations, both
sides write in them — so most of these cases are about a staff member being
able to do everything *except* start.
"""
from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.notifications.models import Notification, NotificationEvent

from .models import Conversation, DirectMessage
from .services import EDIT_WINDOW


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
    assert row["last_message"] == {"body": "ping", "sender": management.id, "mine": False, "deleted": False}
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


# --- editing your own message ---------------------------------------------------- #

@pytest.fixture
def thread(management, staff):
    """An open thread plus the id of management's opening message."""
    conv = client(management).post(
        "/api/conversations/", {"recipient": staff.id, "body": "Send it by Wednesday"}, format="json"
    ).data
    msg = DirectMessage.objects.get(conversation_id=conv["id"])
    return conv["id"], msg


def test_sender_can_correct_their_own_message(management, staff, thread):
    cid, msg = thread
    r = client(management).patch(f"/api/direct-messages/{msg.id}/", {"body": "Send it by Thursday"}, format="json")
    assert r.status_code == 200, r.data
    assert r.data["body"] == "Send it by Thursday"
    assert r.data["edited_at"] is not None

    # The other side sees the correction, and that it was corrected.
    rows = client(staff).get(f"/api/conversations/{cid}/messages/").data
    assert rows[0]["body"] == "Send it by Thursday"
    assert rows[0]["edited_at"] is not None


def test_recipient_cannot_edit_the_senders_message(staff, thread):
    _, msg = thread
    r = client(staff).patch(f"/api/direct-messages/{msg.id}/", {"body": "Send it whenever"}, format="json")
    assert r.status_code == 403
    msg.refresh_from_db()
    assert msg.body == "Send it by Wednesday"


def test_edit_closes_after_the_window(management, thread):
    cid, msg = thread
    DirectMessage.objects.filter(pk=msg.pk).update(
        created_at=timezone.now() - EDIT_WINDOW - timedelta(minutes=1)
    )
    r = client(management).patch(f"/api/direct-messages/{msg.id}/", {"body": "too late"}, format="json")
    assert r.status_code == 400
    assert client(management).get(f"/api/conversations/{cid}/messages/").data[0]["can_edit"] is False


def test_edit_rejects_an_empty_body(management, thread):
    _, msg = thread
    assert client(management).patch(f"/api/direct-messages/{msg.id}/", {"body": "  "}, format="json").status_code == 400


def test_outsider_gets_404_not_403(other_staff, thread):
    _, msg = thread
    assert client(other_staff).patch(f"/api/direct-messages/{msg.id}/", {"body": "x"}, format="json").status_code == 404
    assert client(other_staff).delete(f"/api/direct-messages/{msg.id}/").status_code == 404


# --- retracting a message ---------------------------------------------------------- #

def test_delete_leaves_a_tombstone_and_drops_the_text(management, staff, thread):
    cid, msg = thread
    r = client(management).delete(f"/api/direct-messages/{msg.id}/")
    assert r.status_code == 200, r.data
    assert r.data["deleted"] is True and r.data["body"] == ""

    msg.refresh_from_db()
    assert msg.deleted_at is not None
    assert msg.body == ""  # the text itself is gone, not just hidden

    # The row survives, so the thread still shows something was withdrawn.
    rows = client(staff).get(f"/api/conversations/{cid}/messages/").data
    assert len(rows) == 1 and rows[0]["deleted"] is True


def test_recipient_cannot_delete_the_senders_message(staff, thread):
    _, msg = thread
    assert client(staff).delete(f"/api/direct-messages/{msg.id}/").status_code == 403
    msg.refresh_from_db()
    assert msg.deleted_at is None


def test_a_retracted_message_stops_counting_as_unread(management, staff, thread):
    cid, msg = thread
    assert client(staff).get("/api/conversations/unread_count/").data["unread"] == 1
    client(management).delete(f"/api/direct-messages/{msg.id}/")
    assert client(staff).get("/api/conversations/unread_count/").data["unread"] == 0


def test_a_deleted_message_cannot_be_edited(management, thread):
    _, msg = thread
    client(management).delete(f"/api/direct-messages/{msg.id}/")
    assert client(management).patch(f"/api/direct-messages/{msg.id}/", {"body": "back"}, format="json").status_code == 400


def test_deleting_twice_is_harmless(management, thread):
    _, msg = thread
    client(management).delete(f"/api/direct-messages/{msg.id}/")
    first = DirectMessage.objects.get(pk=msg.pk).deleted_at
    assert client(management).delete(f"/api/direct-messages/{msg.id}/").status_code == 200
    assert DirectMessage.objects.get(pk=msg.pk).deleted_at == first  # not re-stamped


# --- deleting a conversation (one-sided) -------------------------------------------- #

def test_deleting_a_conversation_clears_only_your_own_copy(management, staff, thread):
    cid, _ = thread
    assert client(staff).delete(f"/api/conversations/{cid}/").status_code == 204

    assert client(staff).get("/api/conversations/").data["results"] == []
    assert client(staff).get("/api/conversations/unread_count/").data["unread"] == 0
    assert client(staff).get(f"/api/conversations/{cid}/messages/").data == []

    # Management's copy is untouched — neither side can erase the other's record.
    rows = client(management).get("/api/conversations/").data["results"]
    assert len(rows) == 1 and rows[0]["last_message"]["body"] == "Send it by Wednesday"
    assert len(client(management).get(f"/api/conversations/{cid}/messages/").data) == 1
    assert DirectMessage.objects.count() == 1  # nothing actually destroyed


def test_a_cleared_thread_is_still_writable_by_the_person_who_cleared_it(staff, thread):
    """Staff can't start a conversation, so clearing one must not strand them."""
    cid, _ = thread
    client(staff).delete(f"/api/conversations/{cid}/")

    r = client(staff).post(f"/api/conversations/{cid}/messages/", {"body": "one more thing"}, format="json")
    assert r.status_code == 201, r.data
    # Writing in it puts it back on their own list, showing only the new line.
    rows = client(staff).get("/api/conversations/").data["results"]
    assert len(rows) == 1 and rows[0]["last_message"]["body"] == "one more thing"
    assert [m["body"] for m in client(staff).get(f"/api/conversations/{cid}/messages/").data] == ["one more thing"]


def test_a_new_message_brings_a_cleared_thread_back_with_only_what_follows(management, staff, thread):
    cid, _ = thread
    client(staff).delete(f"/api/conversations/{cid}/")
    client(management).post(f"/api/conversations/{cid}/messages/", {"body": "Still waiting"}, format="json")

    rows = client(staff).get("/api/conversations/").data["results"]
    assert len(rows) == 1 and rows[0]["unread"] == 1
    bodies = [m["body"] for m in client(staff).get(f"/api/conversations/{cid}/messages/").data]
    assert bodies == ["Still waiting"]  # the cleared history stays cleared


def test_clearing_an_unwritten_thread_you_started_removes_it(management, staff):
    conv = client(management).post("/api/conversations/", {"recipient": staff.id}, format="json").data
    assert len(client(management).get("/api/conversations/").data["results"]) == 1
    client(management).delete(f"/api/conversations/{conv['id']}/")
    assert client(management).get("/api/conversations/").data["results"] == []


def test_clearing_suppresses_the_ping_for_older_unread_but_not_the_next_one(management, staff, thread):
    cid, _ = thread
    Notification.objects.all().delete()
    client(staff).delete(f"/api/conversations/{cid}/")
    # The unread opener is behind staff's clear-point, so the next message is
    # the first thing genuinely waiting for them and must ping.
    client(management).post(f"/api/conversations/{cid}/messages/", {"body": "second"}, format="json")
    assert Notification.objects.filter(recipient=staff, event=NotificationEvent.DIRECT_MESSAGE).count() == 1
