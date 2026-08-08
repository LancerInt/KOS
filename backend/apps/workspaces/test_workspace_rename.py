"""Renaming a workspace, including the eleven that ship as frontend config.

A built-in workspace has no database row — it is declared in ``workspaces.tsx``
and rendered from there. Renaming one therefore has nothing to write to, so the
first edit creates a row that stands in for it (``is_builtin``). That row is not
a workspace of its own: the frontend merges it onto the built-in by key, and it
can never be archived, because the config entry would keep rendering and the
name would silently revert rather than the workspace disappearing.
"""
from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.workspaces.models import Workspace

WORKSPACES = "/api/workspaces/"
BUILTIN = "amazon-usa"


@pytest.fixture
def member_client(member_user) -> APIClient:
    # Its own client, not the shared `api_client` fixture: a test that needs an
    # admin as well would otherwise re-authenticate the one object and both
    # requests would go out as whichever fixture resolved last.
    client = APIClient()
    client.force_authenticate(member_user)
    return client


# --------------------------------------------------------------------------- #
# Built-in workspaces
# --------------------------------------------------------------------------- #
@pytest.mark.django_db
def test_renaming_a_builtin_creates_the_row_that_stands_in_for_it(auth_client):
    assert not Workspace.objects.filter(key=BUILTIN).exists()
    r = auth_client.patch(f"{WORKSPACES}{BUILTIN}/",
                          {"label": "Amazon US", "icon": "storefront"}, format="json")
    assert r.status_code == 200, r.data
    ws = Workspace.objects.get(key=BUILTIN)
    assert ws.label == "Amazon US" and ws.is_builtin
    # The key is the built-in's own — that is what the frontend merges on.
    assert ws.key == BUILTIN


@pytest.mark.django_db
def test_the_identity_sent_with_the_rename_is_kept(auth_client):
    """Without this the workspace would come back wearing a default folder icon."""
    auth_client.patch(f"{WORKSPACES}{BUILTIN}/", {
        "label": "Amazon US", "icon": "storefront", "accent": "#0F7A8B",
        "blurb": "Selling on the Amazon US marketplace.",
    }, format="json")
    ws = Workspace.objects.get(key=BUILTIN)
    assert ws.icon == "storefront" and ws.accent == "#0F7A8B"
    assert ws.blurb == "Selling on the Amazon US marketplace."


@pytest.mark.django_db
def test_renaming_twice_reuses_the_same_row(auth_client):
    auth_client.patch(f"{WORKSPACES}{BUILTIN}/", {"label": "Amazon US"}, format="json")
    auth_client.patch(f"{WORKSPACES}{BUILTIN}/", {"label": "Amazon Storefront"}, format="json")
    # A second row would show the workspace twice in the sidebar.
    assert Workspace.objects.filter(key=BUILTIN).count() == 1
    assert Workspace.objects.get(key=BUILTIN).label == "Amazon Storefront"


@pytest.mark.django_db
def test_a_builtin_workspace_cannot_be_archived(auth_client):
    auth_client.patch(f"{WORKSPACES}{BUILTIN}/", {"label": "Amazon US"}, format="json")
    r = auth_client.delete(f"{WORKSPACES}{BUILTIN}/")
    assert r.status_code == 400, r.data
    assert Workspace.objects.get(key=BUILTIN).archived_at is None


@pytest.mark.django_db
def test_a_user_added_workspace_can_still_be_archived(auth_client):
    r = auth_client.post(WORKSPACES, {"label": "Field Trials"}, format="json")
    assert r.status_code == 201, r.data
    key = r.data["key"]
    assert r.data["is_builtin"] is False
    assert auth_client.delete(f"{WORKSPACES}{key}/").status_code == 204
    assert Workspace.objects.get(key=key).archived_at is not None


# --------------------------------------------------------------------------- #
# Permission
# --------------------------------------------------------------------------- #
@pytest.mark.django_db
def test_a_non_admin_cannot_rename_a_workspace(member_client):
    r = member_client.patch(f"{WORKSPACES}{BUILTIN}/", {"label": "Mine now"}, format="json")
    assert r.status_code == 403, r.data
    # The row must not be created either — the check has to happen before the
    # adoption, or a refused rename would still leave a row behind.
    assert not Workspace.objects.filter(key=BUILTIN).exists()


@pytest.mark.django_db
def test_a_non_admin_cannot_rename_an_existing_workspace(member_client, auth_client):
    auth_client.post(WORKSPACES, {"label": "Field Trials"}, format="json")
    key = Workspace.objects.get().key
    r = member_client.patch(f"{WORKSPACES}{key}/", {"label": "Mine now"}, format="json")
    assert r.status_code == 403, r.data
    assert Workspace.objects.get(key=key).label == "Field Trials"
