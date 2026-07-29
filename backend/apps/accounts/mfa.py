"""TOTP multi-factor auth for privileged users (PRD §32)."""
from __future__ import annotations

import pyotp
from django.conf import settings


def new_secret() -> str:
    return pyotp.random_base32()


def provisioning_uri(user, secret: str) -> str:
    """otpauth:// URI for QR enrolment in an authenticator app."""
    issuer = getattr(settings, "MFA_ISSUER", "KOS")
    return pyotp.TOTP(secret).provisioning_uri(name=user.email or user.username, issuer_name=issuer)


def verify(secret: str, code: str) -> bool:
    if not secret or not code:
        return False
    # valid_window=1 tolerates ~30s clock drift either side.
    return pyotp.TOTP(secret).verify(code.strip(), valid_window=1)
