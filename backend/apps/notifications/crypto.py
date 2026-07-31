"""Symmetric encryption for secrets stored in the DB (the outbound email
password). The key is derived from ``SECRET_KEY`` so nothing extra needs
provisioning; rotating ``SECRET_KEY`` invalidates stored secrets (they'd need
re-entering), which is the correct, safe behaviour."""
from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings


def _fernet() -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode()).digest())
    return Fernet(key)


def encrypt(value: str) -> str:
    if not value:
        return ""
    return _fernet().encrypt(value.encode()).decode()


def decrypt(token: str) -> str:
    if not token:
        return ""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except (InvalidToken, ValueError):
        return ""
