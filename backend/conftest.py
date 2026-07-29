"""Shared pytest fixtures for the KOS test suite (PRD §30)."""
from __future__ import annotations

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


@pytest.fixture
def admin_user(db) -> User:
    return User.objects.create_superuser(username="admin", email="admin@kos.test", password="pw-admin-123")


@pytest.fixture
def member_user(db) -> User:
    return User.objects.create_user(username="member", email="member@kos.test", password="pw-member-123")


@pytest.fixture
def auth_client(api_client: APIClient, admin_user: User) -> APIClient:
    api_client.force_authenticate(admin_user)
    return api_client
