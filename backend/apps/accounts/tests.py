"""RBAC resolution tests (PRD §7.4 — union of roles at broadest scope)."""
import pytest

from apps.accounts.models import Role, RoleCapability, User
from apps.accounts.rbac import Capability, Scope, broadest_scope


def test_broadest_scope_picks_widest():
    assert broadest_scope([Scope.PROJECT, Scope.ORGANISATION]) == Scope.ORGANISATION
    assert broadest_scope([Scope.OWN, Scope.PROJECT]) == Scope.PROJECT


@pytest.mark.django_db
def test_effective_capabilities_union_across_roles():
    r_proj = Role.objects.create(name="R Project", default_scope=Scope.PROJECT)
    RoleCapability.objects.create(role=r_proj, capability=Capability.VIEW, scope="")
    r_org = Role.objects.create(name="R Org", default_scope=Scope.ORGANISATION)
    RoleCapability.objects.create(role=r_org, capability=Capability.VIEW, scope=Scope.ORGANISATION)
    RoleCapability.objects.create(role=r_org, capability=Capability.APPROVE, scope=Scope.ORGANISATION)

    user = User.objects.create_user("u", "u@kos.local", "pw-123456")
    user.roles.add(r_proj, r_org)

    caps = user.effective_capabilities()
    # VIEW held at both project & org → resolves to the broadest (org).
    assert caps[Capability.VIEW] == Scope.ORGANISATION
    assert caps[Capability.APPROVE] == Scope.ORGANISATION
    assert user.has_capability(Capability.VIEW)
    assert not user.has_capability(Capability.ADMINISTER)


@pytest.mark.django_db
def test_superuser_holds_everything():
    root = User.objects.create_superuser("root", "root@kos.local", "pw-123456")
    caps = root.effective_capabilities()
    assert caps[Capability.ADMINISTER] == Scope.ORGANISATION
    assert len(caps) == len(Capability.values)
