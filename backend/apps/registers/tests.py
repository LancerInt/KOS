"""Register tests (PRD §17)."""
import pytest
from rest_framework.test import APIClient

from apps.accounts.models import Role, RoleCapability, User
from apps.accounts.rbac import Capability, Scope
from apps.projects.models import Membership, Project
from apps.registers.models import Risk


@pytest.fixture
def member(db):
    root = User.objects.create_superuser("root", "root@kos.local", "pw-123456")
    project = Project.objects.create(name="P", code="P1", owner=root)
    user = User.objects.create_user("u", "u@kos.local", "pw-123456")
    role = Role.objects.create(name="Contributor", default_scope=Scope.PROJECT)
    for cap in (Capability.VIEW, Capability.CREATE_TASKS):
        RoleCapability.objects.create(role=role, capability=cap, scope="")
    user.roles.add(role)
    Membership.objects.create(user=user, project=project)
    client = APIClient()
    client.force_authenticate(user)
    return {"project": project, "root": root, "user": user, "client": client}


@pytest.mark.django_db
def test_create_risk_computes_score(member):
    r = member["client"].post("/api/risks/", {
        "project": member["project"].id, "statement": "Supplier delay",
        "probability": "high", "impact": "high",
    }, format="json")
    assert r.status_code == 201
    assert r.data["score"] == 16  # high(4) × high(4)


@pytest.mark.django_db
def test_registers_are_project_scoped(member):
    # A risk on a project the user isn't a member of is invisible.
    other = Project.objects.create(name="Other", code="P2", owner=member["root"])
    Risk.objects.create(project=other, statement="Hidden risk")

    r = member["client"].get("/api/risks/")
    statements = {row["statement"] for row in r.data["results"]}
    assert "Hidden risk" not in statements
