"""Project-scoped visibility tests (PRD §7.3, §7.6 — AC-3, AC-4, AC-5).

This is the cross-project access test the Definition of Done mandates (§37.7).
"""
import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Role, RoleCapability, User
from apps.accounts.rbac import Capability, Scope
from apps.projects.models import (
    Confidentiality,
    Membership,
    Milestone,
    Project,
    ProjectTemplate,
    ProjectType,
)


def _executive_role() -> Role:
    role = Role.objects.create(name="Executive", default_scope=Scope.PROJECT)
    RoleCapability.objects.create(role=role, capability=Capability.VIEW, scope="")
    return role


def _manager_role() -> Role:
    role = Role.objects.create(name="PM", default_scope=Scope.PROJECT)
    RoleCapability.objects.create(role=role, capability=Capability.VIEW, scope="")
    RoleCapability.objects.create(role=role, capability=Capability.MANAGE_PROJECT, scope="")
    return role


def _org_role() -> Role:
    role = Role.objects.create(name="Org Viewer", default_scope=Scope.ORGANISATION)
    RoleCapability.objects.create(role=role, capability=Capability.VIEW, scope=Scope.ORGANISATION)
    return role


def _user(username: str, role: Role) -> User:
    user = User.objects.create_user(
        username=username, email=f"{username}@kos.local", password="pw-123456"
    )
    user.roles.add(role)
    return user


@pytest.fixture
def world(db):
    root = User.objects.create_superuser("root", "root@kos.local", "pw-123456")
    p1 = Project.objects.create(name="P1", code="P1", owner=root)
    p2 = Project.objects.create(name="P2", code="P2", owner=root)
    p3 = Project.objects.create(name="P3", code="P3", owner=root)

    exec_role = _executive_role()
    a, b, c = _user("a", exec_role), _user("b", exec_role), _user("c", exec_role)
    Membership.objects.create(user=a, project=p1)
    Membership.objects.create(user=a, project=p2)
    Membership.objects.create(user=b, project=p2)
    Membership.objects.create(user=c, project=p3)
    return locals()


def _codes(response) -> set[str]:
    return {row["code"] for row in response.data["results"]}


@pytest.mark.django_db
def test_executive_sees_only_member_projects(world):
    """AC-3: A on P1+P2 sees exactly P1,P2. B on P2 sees exactly P2."""
    client = APIClient()

    client.force_authenticate(world["a"])
    assert _codes(client.get("/api/projects/")) == {"P1", "P2"}

    client.force_authenticate(world["b"])
    assert _codes(client.get("/api/projects/")) == {"P2"}

    client.force_authenticate(world["c"])
    assert _codes(client.get("/api/projects/")) == {"P3"}


@pytest.mark.django_db
def test_direct_access_to_foreign_project_is_forbidden(world):
    """AC-4: a direct API call for an unauthorised project returns 403, not a
    hidden UI element."""
    client = APIClient()
    client.force_authenticate(world["a"])
    resp = client.get(f"/api/projects/{world['p3'].id}/")
    assert resp.status_code == 403


@pytest.mark.django_db
def test_confidential_project_hidden_from_org_scope_non_member(world):
    """AC-5: a confidential project is invisible to a non-member holding
    Organisation scope (§7.6)."""
    confidential = Project.objects.create(
        name="Secret", code="SEC", owner=world["root"],
        confidentiality=Confidentiality.CONFIDENTIAL,
    )
    org_user = _user("org", _org_role())

    client = APIClient()
    client.force_authenticate(org_user)

    # Org scope sees the open projects...
    assert _codes(client.get("/api/projects/")) == {"P1", "P2", "P3"}
    # ...but not the confidential one, and cannot reach it directly (404 — hidden).
    assert client.get(f"/api/projects/{confidential.id}/").status_code == 404


@pytest.mark.django_db
def test_create_project_from_template_seeds_hierarchy(db):
    """AC-6: a project created from a template comes with its hierarchy seeded."""
    ProjectTemplate.objects.create(
        key="reg", name="Reg", project_type=ProjectType.HYBRID,
        structure={
            "epics": [{"title": "Dossier", "milestones": [{"title": "Submitted", "offset_days": 30}]}],
            "milestones": [{"title": "Grant", "offset_days": 90}],
        },
    )
    pm = _user("pm", _manager_role())
    client = APIClient()
    client.force_authenticate(pm)

    resp = client.post(
        "/api/projects/from_template/",
        {"template": "reg", "name": "Neem reg", "code": "NR1", "start_date": "2026-08-01"},
        format="json",
    )
    assert resp.status_code == 201
    assert len(resp.data["epics"]) == 1
    assert len(resp.data["milestones"]) == 2  # one under the epic + one project-level

    project = Project.objects.get(code="NR1")
    # Creator is auto-enrolled as project Owner so they can see/manage it.
    assert Membership.objects.filter(user=pm, project=project, project_role="owner").exists()
    # offset_days became a real due date (2026-08-01 + 90 days).
    grant = Milestone.objects.get(project=project, title="Grant")
    assert str(grant.due_date) == "2026-10-30"
