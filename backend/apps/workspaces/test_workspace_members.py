"""Workspace membership management: who may add and remove people."""
from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.workspaces.models import WorkspaceMember

WS = "amazon-usa"
MEMBERS = "/api/workspace-members/"


def _superuser():
    return User.objects.create_user(username="it", email="it@x.io", password="pw", is_superuser=True, is_staff=True)


def _add(actor, user_id):
    return client(actor).post(MEMBERS, {"workspace": WS, "user": user_id}, format="json")


def client(u):
    c = APIClient()
    c.force_authenticate(u)
    return c


@pytest.fixture
def exec_role(db):
    return Role.objects.create(name="Executive")


def _exec(name, role, member=False):
    u = User.objects.create_user(username=name, email=f"{name}@x.io", password="pw", first_name=name.title())
    u.roles.add(role)
    if member:
        WorkspaceMember.objects.create(user=u, workspace=WS, access=WorkspaceMember.EDIT)
    return u


@pytest.mark.django_db
def test_a_member_can_add_and_remove_members(exec_role):
    owner = _exec("owner", exec_role, member=True)
    newbie = _exec("newbie", exec_role)

    r = client(owner).post(MEMBERS, {"workspace": WS, "user": newbie.id}, format="json")
    assert r.status_code == 201, r.data
    mid = r.data["id"]

    d = client(owner).delete(f"{MEMBERS}{mid}/")
    assert d.status_code == 204, getattr(d, "data", d)
    assert not WorkspaceMember.objects.filter(user=newbie, workspace=WS).exists()


@pytest.mark.django_db
def test_a_non_member_cannot_add(exec_role):
    outsider = _exec("outsider", exec_role, member=False)
    target = _exec("target", exec_role)
    r = client(outsider).post(MEMBERS, {"workspace": WS, "user": target.id}, format="json")
    assert r.status_code == 403


@pytest.mark.django_db
def test_a_member_cannot_remove_someone_they_did_not_add(exec_role):
    """Any member may add, but only the adder (or IT/Management) may remove."""
    alice = _exec("alice", exec_role, member=True)
    bob = _exec("bob", exec_role, member=True)
    newbie = _exec("newbie", exec_role)

    mid = _add(alice, newbie.id).data["id"]          # alice added newbie
    # bob is a member too, but didn't add newbie — he can't remove them.
    assert client(bob).delete(f"{MEMBERS}{mid}/").status_code == 403
    assert WorkspaceMember.objects.filter(pk=mid).exists()
    # alice, who added them, can.
    assert client(alice).delete(f"{MEMBERS}{mid}/").status_code == 204


@pytest.mark.django_db
def test_it_management_can_remove_anyone(exec_role):
    alice = _exec("alice2", exec_role, member=True)
    newbie = _exec("newbie2", exec_role)
    mid = _add(alice, newbie.id).data["id"]
    # A superuser (stands in for IT/Management) can remove a member they didn't add.
    assert client(_superuser()).delete(f"{MEMBERS}{mid}/").status_code == 204
