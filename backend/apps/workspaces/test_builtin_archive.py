"""Admins can archive (hide) built-in workspaces via a tombstone row, restore
them anytime, and those tombstones are never auto-purged."""
from __future__ import annotations

from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.workspaces.models import Workspace, WorkspaceProject
from apps.workspaces.views import BUILTIN_WORKSPACE_KEYS, purge_expired_workspaces

BUILTIN = "crm"  # one of the 11 config-defined built-ins


@pytest.fixture
def admin(db):
    return User.objects.create_superuser(username="root", email="root@x.io", password="pw")


@pytest.fixture
def member(db):
    return User.objects.create_user(username="mem", email="mem@x.io", password="pw")


def client(user) -> APIClient:
    c = APIClient()
    c.force_authenticate(user)
    return c


def test_admin_archives_builtin_via_tombstone(admin):
    assert BUILTIN in BUILTIN_WORKSPACE_KEYS
    c = client(admin)
    r = c.delete(f"/api/workspaces/{BUILTIN}/")
    assert r.status_code == 204
    ws = Workspace.objects.get(key=BUILTIN)
    assert ws.archived_at is not None
    # It's reported as hidden, and dropped from the active list.
    assert BUILTIN in c.get("/api/workspaces/hidden-builtins/").data["keys"]
    assert all(w["key"] != BUILTIN for w in c.get("/api/workspaces/").data)
    # And it shows in the admin's archived list, ready to restore.
    assert any(w["key"] == BUILTIN for w in c.get("/api/workspaces/?archived=1").data)


def test_non_admin_cannot_archive_builtin(member):
    r = client(member).delete(f"/api/workspaces/{BUILTIN}/")
    assert r.status_code == 403
    assert not Workspace.objects.filter(key=BUILTIN).exists()


def test_archiving_builtin_hides_its_content(admin):
    WorkspaceProject.objects.create(workspace=BUILTIN, name="P1", created_by=admin)
    c = client(admin)
    assert any(p["name"] == "P1" for p in c.get(f"/api/workspace-projects/?workspace={BUILTIN}").data)
    c.delete(f"/api/workspaces/{BUILTIN}/")
    assert all(p["name"] != "P1" for p in c.get(f"/api/workspace-projects/?workspace={BUILTIN}").data)


def test_restore_builtin_drops_the_tombstone(admin):
    c = client(admin)
    c.delete(f"/api/workspaces/{BUILTIN}/")
    r = c.post(f"/api/workspaces/{BUILTIN}/restore/")
    assert r.status_code == 200
    assert not Workspace.objects.filter(key=BUILTIN).exists()   # back to pure config
    assert BUILTIN not in c.get("/api/workspaces/hidden-builtins/").data["keys"]


def test_builtin_tombstone_is_never_purged(admin):
    c = client(admin)
    c.delete(f"/api/workspaces/{BUILTIN}/")
    Workspace.objects.filter(key=BUILTIN).update(archived_at=timezone.now() - timedelta(days=999))
    purge_expired_workspaces()
    assert Workspace.objects.filter(key=BUILTIN).exists()   # survives well past the TTL


def test_dynamic_workspace_still_purges_past_ttl(admin):
    ws = Workspace.objects.create(key="field-trials", label="Field Trials", created_by=admin,
                                  archived_at=timezone.now() - timedelta(days=999))
    purge_expired_workspaces()
    assert not Workspace.objects.filter(pk=ws.pk).exists()
