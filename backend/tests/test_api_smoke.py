"""Smoke tests: authentication gating on the API (PRD §7.7, §32)."""
from __future__ import annotations

import pytest


@pytest.mark.django_db
def test_projects_require_authentication(api_client):
    assert api_client.get("/api/projects/").status_code == 401


@pytest.mark.django_db
def test_audit_requires_admin(api_client, member_user):
    api_client.force_authenticate(member_user)
    # A non-admin is refused the audit trail (§26).
    assert api_client.get("/api/audit/logs/").status_code == 403


@pytest.mark.django_db
def test_authenticated_lists_ok(auth_client):
    for path in ("/api/projects/", "/api/tasks/mine/", "/api/crm/customers/", "/api/regulatory/registrations/"):
        assert auth_client.get(path).status_code == 200
