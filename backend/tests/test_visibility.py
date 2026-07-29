"""The load-bearing visibility rule (PRD §7.3, §7.6) — membership + scope,
confidential projects members-only."""
from __future__ import annotations

import pytest

from apps.accounts.models import Role, RoleCapability, User
from apps.accounts.rbac import Capability, ProjectRole, Scope
from apps.projects.models import Confidentiality, Membership, Project
from apps.projects.scoping import visible_projects


@pytest.mark.django_db
def test_confidential_project_is_members_only():
    owner = User.objects.create_user(username="own", email="own@kos.test", password="x")
    member = User.objects.create_user(username="mem", email="mem@kos.test", password="x")
    outsider = User.objects.create_user(username="out", email="out@kos.test", password="x")

    project = Project.objects.create(
        name="Skunkworks", code="SKW", owner=owner, confidentiality=Confidentiality.CONFIDENTIAL,
    )
    Membership.objects.create(user=member, project=project, project_role=ProjectRole.CONTRIBUTOR)

    assert visible_projects(member).filter(pk=project.pk).exists()
    assert not visible_projects(outsider).filter(pk=project.pk).exists()


@pytest.mark.django_db
def test_org_scope_sees_open_but_not_confidential():
    role = Role.objects.create(name="Org Viewer", default_scope=Scope.ORGANISATION)
    RoleCapability.objects.create(role=role, capability=Capability.VIEW, scope=Scope.ORGANISATION)
    viewer = User.objects.create_user(username="vw", email="vw@kos.test", password="x")
    viewer.roles.add(role)

    owner = User.objects.create_user(username="o2", email="o2@kos.test", password="x")
    p_open = Project.objects.create(name="Open", code="OPN", owner=owner)
    p_conf = Project.objects.create(name="Secret", code="SEC", owner=owner, confidentiality=Confidentiality.CONFIDENTIAL)

    visible = visible_projects(viewer)
    assert visible.filter(pk=p_open.pk).exists()          # org scope covers open projects
    assert not visible.filter(pk=p_conf.pk).exists()      # but never a confidential non-member project
