"""Group chats: creating a group, membership, posting, unread, and the
one-per-message admin/leave rules."""
from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.notifications.models import Notification, NotificationEvent

from .models import GroupMembership, GroupMessage, GroupThread


def client(user) -> APIClient:
    c = APIClient()
    c.force_authenticate(user)
    return c


@pytest.fixture
def alice(db):
    return User.objects.create_user(username="alice", email="a@x.io", password="pw")


@pytest.fixture
def bob(db):
    return User.objects.create_user(username="bob", email="b@x.io", password="pw")


@pytest.fixture
def carol(db):
    return User.objects.create_user(username="carol", email="c@x.io", password="pw")


@pytest.fixture
def group(alice, bob, carol):
    """A group started by alice with bob and carol."""
    r = client(alice).post("/api/group-threads/", {
        "name": "Amazon Launch", "members": [bob.id, carol.id],
    }, format="json")
    assert r.status_code == 201, r.data
    return r.data


# --- creating ---------------------------------------------------------------- #

def test_anyone_can_create_a_group(group, alice, bob, carol):
    assert group["name"] == "Amazon Launch"
    assert group["kind"] == "group"
    # Creator is a member and the admin; passed members are added.
    assert group["member_count"] == 3
    ids = {m["id"] for m in group["members"]}
    assert ids == {alice.id, bob.id, carol.id}
    assert group["is_admin"] is True   # for the creator/viewer


def test_a_group_needs_a_name_and_someone_else(alice, bob):
    no_name = client(alice).post("/api/group-threads/", {"name": "  ", "members": [bob.id]}, format="json")
    assert no_name.status_code == 400
    solo = client(alice).post("/api/group-threads/", {"name": "Just me", "members": []}, format="json")
    assert solo.status_code == 400


def test_creating_with_a_first_message_posts_it(alice, bob):
    r = client(alice).post("/api/group-threads/", {
        "name": "Kickoff", "members": [bob.id], "body": "Welcome!",
    }, format="json")
    gid = r.data["id"]
    rows = client(bob).get(f"/api/group-threads/{gid}/messages/").data
    assert [m["body"] for m in rows] == ["Welcome!"]


# --- membership boundaries --------------------------------------------------- #

def test_a_non_member_cannot_read_or_write(group, db):
    outsider = User.objects.create_user(username="out", email="o@x.io", password="pw")
    gid = group["id"]
    assert client(outsider).get(f"/api/group-threads/{gid}/messages/").status_code == 404
    assert client(outsider).post(f"/api/group-threads/{gid}/messages/", {"body": "hi"}, format="json").status_code == 404
    # And it doesn't appear in their list.
    assert client(outsider).get("/api/group-threads/").data["results"] == []


def test_members_see_the_group_in_their_list(group, bob):
    rows = client(bob).get("/api/group-threads/").data["results"]
    assert len(rows) == 1 and rows[0]["name"] == "Amazon Launch"
    assert rows[0]["is_admin"] is False  # bob isn't the creator


# --- posting, reading, unread ------------------------------------------------ #

def test_posting_pings_other_members_once(group, alice, bob, carol):
    gid = group["id"]
    client(alice).post(f"/api/group-threads/{gid}/messages/", {"body": "one"}, format="json")
    client(alice).post(f"/api/group-threads/{gid}/messages/", {"body": "two"}, format="json")

    # bob and carol each get exactly one standing ping; alice (sender) none.
    for u in (bob, carol):
        pings = Notification.objects.filter(recipient=u, event=NotificationEvent.DIRECT_MESSAGE)
        assert pings.count() == 1
        assert pings.first().url == f"/messages/g/{gid}"
    assert Notification.objects.filter(recipient=alice, event=NotificationEvent.DIRECT_MESSAGE).count() == 0


def test_unread_clears_on_read(group, alice, bob):
    gid = group["id"]
    client(alice).post(f"/api/group-threads/{gid}/messages/", {"body": "hi"}, format="json")
    assert client(bob).get("/api/group-threads/unread_count/").data["unread"] == 1
    assert client(bob).post(f"/api/group-threads/{gid}/read/").data["marked"] == 1
    assert client(bob).get("/api/group-threads/unread_count/").data["unread"] == 0
    # The sender never has unread of their own.
    assert client(alice).get("/api/group-threads/unread_count/").data["unread"] == 0


def test_thread_reads_oldest_first(group, alice, bob, carol):
    gid = group["id"]
    client(alice).post(f"/api/group-threads/{gid}/messages/", {"body": "1"}, format="json")
    client(bob).post(f"/api/group-threads/{gid}/messages/", {"body": "2"}, format="json")
    rows = client(carol).get(f"/api/group-threads/{gid}/messages/").data
    assert [m["body"] for m in rows] == ["1", "2"]


# --- managing the group ------------------------------------------------------ #

def test_any_member_can_add_people(group, bob, db):
    gid = group["id"]
    dave = User.objects.create_user(username="dave", email="d@x.io", password="pw")
    r = client(bob).post(f"/api/group-threads/{gid}/members/", {"members": [dave.id]}, format="json")
    assert r.status_code == 200
    assert r.data["member_count"] == 4
    assert client(dave).get("/api/group-threads/").data["results"][0]["name"] == "Amazon Launch"


def test_only_admin_can_rename(group, alice, bob):
    gid = group["id"]
    assert client(bob).patch(f"/api/group-threads/{gid}/", {"name": "Nope"}, format="json").status_code == 403
    r = client(alice).patch(f"/api/group-threads/{gid}/", {"name": "Amazon US Launch"}, format="json")
    assert r.status_code == 200 and r.data["name"] == "Amazon US Launch"


def test_leaving_removes_you(group, bob):
    gid = group["id"]
    assert client(bob).post(f"/api/group-threads/{gid}/leave/").status_code == 204
    assert client(bob).get("/api/group-threads/").data["results"] == []
    assert GroupThread.objects.get(pk=gid).memberships.count() == 2


def test_admin_leaving_hands_off_admin(group, alice, bob, carol):
    gid = group["id"]
    client(alice).post(f"/api/group-threads/{gid}/leave/")
    thread = GroupThread.objects.get(pk=gid)
    assert thread.memberships.filter(is_admin=True).count() == 1  # never adminless


def test_last_member_leaving_deletes_the_group(alice, bob):
    gid = client(alice).post("/api/group-threads/", {"name": "Tiny", "members": [bob.id]}, format="json").data["id"]
    client(alice).post(f"/api/group-threads/{gid}/leave/")
    client(bob).post(f"/api/group-threads/{gid}/leave/")
    assert not GroupThread.objects.filter(pk=gid).exists()


# --- editing / retracting your own line -------------------------------------- #

def test_sender_can_edit_and_retract_their_own_message(group, alice, bob):
    gid = group["id"]
    msg = client(alice).post(f"/api/group-threads/{gid}/messages/", {"body": "draft"}, format="json").data
    edited = client(alice).patch(f"/api/group-messages/{msg['id']}/", {"body": "final"}, format="json")
    assert edited.status_code == 200 and edited.data["body"] == "final" and edited.data["edited_at"]

    tomb = client(alice).delete(f"/api/group-messages/{msg['id']}/")
    assert tomb.status_code == 200 and tomb.data["deleted"] is True and tomb.data["body"] == ""
    # Others can't edit or delete it.
    assert client(bob).patch(f"/api/group-messages/{msg['id']}/", {"body": "x"}, format="json").status_code in (400, 403)
