"""Saved-view presets: per-user isolation, uniqueness, opaque config."""
from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.core.models import SavedView


@pytest.fixture
def user(db):
    return User.objects.create_user(username="alice", email="alice@x.io", password="pw")


@pytest.fixture
def other(db):
    return User.objects.create_user(username="bob", email="bob@x.io", password="pw")


def auth(user) -> APIClient:
    c = APIClient()
    c.force_authenticate(user)
    return c


def test_create_stores_config_verbatim_and_sets_owner(user):
    c = auth(user)
    cfg = {"filter": "due", "query": "roof", "sort": "end", "layout": "board"}
    r = c.post("/api/saved-views/", {"surface": "dashboard", "name": "Overdue roofing", "config": cfg}, format="json")
    assert r.status_code == 201, r.content
    assert r.data["config"] == cfg
    view = SavedView.objects.get(pk=r.data["id"])
    assert view.owner == user  # owner comes from the request, not the body


def test_list_is_scoped_to_the_requesting_user(user, other):
    SavedView.objects.create(owner=user, name="Mine", config={})
    SavedView.objects.create(owner=other, name="Theirs", config={})
    r = auth(user).get("/api/saved-views/?surface=dashboard")
    names = [v["name"] for v in (r.data["results"] if "results" in r.data else r.data)]
    assert names == ["Mine"]


def test_cannot_delete_another_users_view(user, other):
    theirs = SavedView.objects.create(owner=other, name="Theirs", config={})
    r = auth(user).delete(f"/api/saved-views/{theirs.id}/")
    assert r.status_code == 404
    assert SavedView.objects.filter(pk=theirs.id).exists()


def test_duplicate_name_per_user_is_rejected(user):
    c = auth(user)
    body = {"surface": "dashboard", "name": "Hot list", "config": {}}
    assert c.post("/api/saved-views/", body, format="json").status_code == 201
    dup = c.post("/api/saved-views/", body, format="json")
    assert dup.status_code == 400


def test_same_name_allowed_for_different_users(user, other):
    body = {"surface": "dashboard", "name": "Hot list", "config": {}}
    assert auth(user).post("/api/saved-views/", body, format="json").status_code == 201
    assert auth(other).post("/api/saved-views/", body, format="json").status_code == 201


def test_non_object_config_is_rejected(user):
    r = auth(user).post(
        "/api/saved-views/", {"name": "Bad", "config": ["not", "a", "dict"]}, format="json"
    )
    assert r.status_code == 400


def test_requires_authentication():
    r = APIClient().get("/api/saved-views/")
    assert r.status_code in (401, 403)
