"""Emoji reactions on DMs and group messages."""
from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User

from .models import MessageReaction


def client(u):
    c = APIClient()
    c.force_authenticate(u)
    return c


@pytest.fixture
def alice(db):
    return User.objects.create_user(username="alice", email="a@x.io", password="pw")


@pytest.fixture
def bob(db):
    return User.objects.create_user(username="bob", email="b@x.io", password="pw")


@pytest.fixture
def dm_msg(alice, bob):
    """A DM thread with one message from alice; returns its id."""
    cid = client(alice).post("/api/conversations/", {"recipient": bob.id, "body": "hey"}, format="json").data["id"]
    rows = client(bob).get(f"/api/conversations/{cid}/messages/").data
    return rows[0]["id"]


def _react(user, mid, emoji):
    return client(user).post(f"/api/direct-messages/{mid}/react/", {"emoji": emoji}, format="json")


def test_react_and_tally(dm_msg, alice, bob):
    assert _react(bob, dm_msg, "👍").status_code == 200
    r = _react(alice, dm_msg, "👍")
    rx = {x["emoji"]: x for x in r.data["reactions"]}
    assert rx["👍"]["count"] == 2 and rx["👍"]["mine"] is True   # alice is the viewer here


def test_same_emoji_toggles_off(dm_msg, bob):
    _react(bob, dm_msg, "❤️")
    r = _react(bob, dm_msg, "❤️")
    assert r.data["reactions"] == []
    assert MessageReaction.objects.count() == 0


def test_different_emoji_replaces(dm_msg, bob):
    _react(bob, dm_msg, "👍")
    r = _react(bob, dm_msg, "😂")
    emojis = [x["emoji"] for x in r.data["reactions"]]
    assert emojis == ["😂"]                         # only one reaction per person
    assert MessageReaction.objects.filter(user=bob).count() == 1


def test_outsider_cannot_react(dm_msg, db):
    outsider = User.objects.create_user(username="out", email="o@x.io", password="pw")
    assert client(outsider).post(f"/api/direct-messages/{dm_msg}/react/", {"emoji": "👍"}, format="json").status_code == 404


def test_group_message_reactions(alice, bob):
    gid = client(alice).post("/api/group-threads/", {"name": "Launch", "members": [bob.id]}, format="json").data["id"]
    msg = client(alice).post(f"/api/group-threads/{gid}/messages/", {"body": "ship it"}, format="json").data
    r = client(bob).post(f"/api/group-messages/{msg['id']}/react/", {"emoji": "🚀"}, format="json")
    assert r.status_code == 200
    assert r.data["reactions"][0] == {"emoji": "🚀", "count": 1, "mine": True}
