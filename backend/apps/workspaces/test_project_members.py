"""Per-project membership — the tier below workspace membership.

A workspace decides *whether you can walk in*; a project may narrow that to a
named few. The rule the whole feature turns on is **empty means open**: a project
with no member rows stays visible to everyone who can open its workspace, and
only becomes need-to-know once someone is listed. That is what keeps every
project created before the feature existed exactly as visible as it was, and it
makes emptying the roster the way to re-open one.
"""
from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Role, User
from apps.workspaces.models import WorkspaceMember, WorkspaceProject, WorkspaceProjectMember

PROJECTS = "/api/workspace-projects/"
MEMBERS = "/api/workspace-project-members/"
RECORDS = "/api/workspace-records/"
WORKSPACE = "amazon-usa"          # a built-in, domain team "executive"


# --------------------------------------------------------------------------- #
# Fixtures
# --------------------------------------------------------------------------- #
@pytest.fixture
def executive_role(db) -> Role:
    return Role.objects.create(name="Executive")


def _exec(username: str, role: Role) -> User:
    """An Executive with workspace access — the ordinary, non-supervisor user."""
    user = User.objects.create_user(username=username, email=f"{username}@kos.test",
                                    password="pw-exec-123", first_name=username.title())
    user.roles.add(role)
    WorkspaceMember.objects.create(user=user, workspace=WORKSPACE, access=WorkspaceMember.EDIT)
    return user


def _client(user: User) -> APIClient:
    # One client per user: re-authenticating a shared client would send every
    # request as whichever fixture resolved last.
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def alice(executive_role) -> User:
    return _exec("alice", executive_role)


@pytest.fixture
def bob(executive_role) -> User:
    return _exec("bob", executive_role)


@pytest.fixture
def project(alice) -> WorkspaceProject:
    return WorkspaceProject.objects.create(workspace=WORKSPACE, name="Neem Oil 2026", created_by=alice)


def _ids(response) -> set[int]:
    return {row["id"] for row in response.data}


# --------------------------------------------------------------------------- #
# Empty means open
# --------------------------------------------------------------------------- #
@pytest.mark.django_db
def test_a_project_with_no_members_is_open_to_the_workspace(project, bob):
    """Bob is nobody's project member — he still sees it, as he always did."""
    r = _client(bob).get(PROJECTS, {"workspace": WORKSPACE})
    assert r.status_code == 200
    assert project.id in _ids(r)
    assert r.data[0]["member_count"] == 0


@pytest.mark.django_db
def test_listing_someone_closes_the_project_to_that_list(project, alice, bob, executive_role):
    carol = _exec("carol", executive_role)
    r = _client(alice).post(MEMBERS, {"project": project.id, "user": carol.id}, format="json")
    assert r.status_code == 201, r.data

    assert project.id in _ids(_client(carol).get(PROJECTS, {"workspace": WORKSPACE}))
    # Bob could open it a moment ago; the roster now excludes him.
    assert project.id not in _ids(_client(bob).get(PROJECTS, {"workspace": WORKSPACE}))
    assert _client(bob).get(f"{PROJECTS}{project.id}/").status_code == 404


@pytest.mark.django_db
def test_emptying_the_roster_reopens_the_project(project, alice, bob, auth_client, executive_role):
    carol = _exec("carol", executive_role)
    _client(alice).post(MEMBERS, {"project": project.id, "user": carol.id}, format="json")
    assert project.id not in _ids(_client(bob).get(PROJECTS, {"workspace": WORKSPACE}))

    # Emptied by a supervisor: a member who removes *themselves* first would walk
    # out of the very project whose roster they were editing (the gate is the
    # roster), so the last removals have to come from someone outside it.
    for member in WorkspaceProjectMember.objects.filter(project=project):
        assert auth_client.delete(f"{MEMBERS}{member.id}/").status_code == 204
    assert project.id in _ids(_client(bob).get(PROJECTS, {"workspace": WORKSPACE}))


@pytest.mark.django_db
def test_supervisors_are_never_gated(project, alice, auth_client, executive_role):
    carol = _exec("carol", executive_role)
    _client(alice).post(MEMBERS, {"project": project.id, "user": carol.id}, format="json")
    # The admin is on no roster and sees it anyway, as they see every workspace.
    assert project.id in _ids(auth_client.get(PROJECTS, {"workspace": WORKSPACE}))


# --------------------------------------------------------------------------- #
# Closing a project must not lock out the people who were already in it
# --------------------------------------------------------------------------- #
@pytest.mark.django_db
def test_the_creator_and_the_adder_are_seeded_onto_the_first_roster(project, bob, executive_role):
    """Alice created it, Bob closed it — neither should be shut out by that."""
    carol = _exec("carol", executive_role)
    _client(bob).post(MEMBERS, {"project": project.id, "user": carol.id}, format="json")

    on_it = set(WorkspaceProjectMember.objects.filter(project=project).values_list("user_id", flat=True))
    assert on_it == {project.created_by_id, bob.id, carol.id}


@pytest.mark.django_db
def test_seeding_only_happens_for_the_first_member(project, alice, bob, executive_role):
    """Once a roster exists it is exactly what the user made it — a later add by
    someone else must not quietly re-add them."""
    carol, dave = _exec("carol", executive_role), _exec("dave", executive_role)
    _client(alice).post(MEMBERS, {"project": project.id, "user": carol.id}, format="json")
    WorkspaceProjectMember.objects.filter(project=project, user=alice).delete()

    _client(carol).post(MEMBERS, {"project": project.id, "user": dave.id}, format="json")
    on_it = set(WorkspaceProjectMember.objects.filter(project=project).values_list("user_id", flat=True))
    assert on_it == {carol.id, dave.id}          # alice stays removed, bob never joined


# --------------------------------------------------------------------------- #
# Joining a project joins its workspace
# --------------------------------------------------------------------------- #
@pytest.mark.django_db
def test_a_new_member_gains_workspace_access(project, alice, executive_role):
    outsider = User.objects.create_user(username="erin", email="erin@kos.test", password="pw-erin-123")
    outsider.roles.add(executive_role)           # on the team, but in no workspace
    assert not WorkspaceMember.objects.filter(user=outsider, workspace=WORKSPACE).exists()

    r = _client(alice).post(MEMBERS, {"project": project.id, "user": outsider.id}, format="json")
    assert r.status_code == 201, r.data
    assert WorkspaceMember.objects.filter(user=outsider, workspace=WORKSPACE).exists()
    assert project.id in _ids(_client(outsider).get(PROJECTS, {"workspace": WORKSPACE}))


@pytest.mark.django_db
def test_only_the_workspace_team_can_be_added(project, alice):
    stranger = User.objects.create_user(username="frank", email="frank@kos.test", password="pw-frank-1")
    r = _client(alice).post(MEMBERS, {"project": project.id, "user": stranger.id}, format="json")
    assert r.status_code == 400, r.data
    assert not WorkspaceProjectMember.objects.filter(project=project).exists()


@pytest.mark.django_db
def test_the_same_person_cannot_be_added_twice(project, alice, executive_role):
    carol = _exec("carol", executive_role)
    _client(alice).post(MEMBERS, {"project": project.id, "user": carol.id}, format="json")
    r = _client(alice).post(MEMBERS, {"project": project.id, "user": carol.id}, format="json")
    assert r.status_code == 400, r.data


# --------------------------------------------------------------------------- #
# The gate covers the project's content, not just its listing
# --------------------------------------------------------------------------- #
@pytest.mark.django_db
def test_a_non_member_cannot_read_or_write_the_projects_records(project, alice, bob, executive_role):
    carol = _exec("carol", executive_role)
    _client(alice).post(MEMBERS, {"project": project.id, "user": carol.id}, format="json")

    payload = {"project": project.id, "category": "Product", "data": {"Name": "Neem"}}
    assert _client(carol).post(RECORDS, payload, format="json").status_code == 201
    assert _client(bob).get(RECORDS, {"project": project.id}).data == []
    assert _client(bob).post(RECORDS, payload, format="json").status_code == 403


@pytest.mark.django_db
def test_a_non_member_cannot_rename_or_delete_the_project(project, alice, bob, executive_role):
    carol = _exec("carol", executive_role)
    _client(alice).post(MEMBERS, {"project": project.id, "user": carol.id}, format="json")

    # 404 rather than 403: the project is out of his queryset entirely.
    assert _client(bob).patch(f"{PROJECTS}{project.id}/", {"name": "Mine"}, format="json").status_code == 404
    assert _client(bob).delete(f"{PROJECTS}{project.id}/").status_code == 404
    assert WorkspaceProject.objects.get(pk=project.pk).deleted_at is None


@pytest.mark.django_db
def test_a_non_member_cannot_read_or_change_the_roster(project, alice, bob, executive_role):
    carol = _exec("carol", executive_role)
    _client(alice).post(MEMBERS, {"project": project.id, "user": carol.id}, format="json")

    assert _client(bob).get(MEMBERS, {"project": project.id}).data == []
    assert _client(bob).get(f"{MEMBERS}addable/", {"project": project.id}).status_code == 403
    r = _client(bob).post(MEMBERS, {"project": project.id, "user": bob.id}, format="json")
    assert r.status_code == 403, r.data


@pytest.mark.django_db
def test_a_closed_project_does_not_leak_through_search(project, alice, bob, executive_role):
    """Hiding it from the project list is worth nothing if search names it."""
    carol = _exec("carol", executive_role)
    _client(alice).post(MEMBERS, {"project": project.id, "user": carol.id}, format="json")
    _client(carol).post(RECORDS, {"project": project.id, "category": "Product",
                                  "data": {"Name": "Neem extract"}}, format="json")

    hit = _client(carol).get("/api/search/", {"q": "Neem"}).data["results"]
    assert [p["id"] for p in hit["workspace_projects"]] == [project.id]
    assert hit["records"]

    blind = _client(bob).get("/api/search/", {"q": "Neem"}).data["results"]
    assert blind["workspace_projects"] == [] and blind["records"] == []


@pytest.mark.django_db
def test_overdue_reminders_follow_the_roster(project, alice, bob, executive_role):
    """A project narrowed to a few people shouldn't chase the whole workspace."""
    from apps.workspaces.duration import _project_recipients

    assert bob in _project_recipients(project)          # open project: the whole team
    carol = _exec("carol", executive_role)
    _client(alice).post(MEMBERS, {"project": project.id, "user": carol.id}, format="json")

    chased = {u.id for u in _project_recipients(project)}
    assert chased == {alice.id, carol.id}               # alice was seeded as creator


@pytest.mark.django_db
def test_addable_offers_the_team_minus_those_already_on_it(project, alice, bob, executive_role):
    carol = _exec("carol", executive_role)
    _client(alice).post(MEMBERS, {"project": project.id, "user": carol.id}, format="json")

    r = _client(alice).get(f"{MEMBERS}addable/", {"project": project.id})
    assert r.status_code == 200, r.data
    assert r.data["domain"] == "executive"
    assert {u["id"] for u in r.data["users"]} == {bob.id}     # alice + carol are on it
