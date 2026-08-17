"""Presence-tracking JWT authentication.

Wraps SimpleJWT's authentication so that every authenticated API request stamps
the user's ``last_seen_at`` — throttled to at most once a minute — which the
Messages UI reads to show online / last-seen. It's here rather than in Django
middleware because the API authenticates at the DRF layer (JWT), so middleware
would only ever see AnonymousUser.
"""
from __future__ import annotations

from django.utils import timezone
from rest_framework_simplejwt.authentication import JWTAuthentication

# Don't write on every request — once a user is "seen" we only re-stamp after
# this many seconds.
PRESENCE_THROTTLE_SECONDS = 55


def touch_presence(user) -> None:
    if user is None or not getattr(user, "is_authenticated", False):
        return
    now = timezone.now()
    last = getattr(user, "last_seen_at", None)
    if last is None or (now - last).total_seconds() > PRESENCE_THROTTLE_SECONDS:
        type(user).objects.filter(pk=user.pk).update(last_seen_at=now)
        user.last_seen_at = now  # keep the in-request copy fresh


class PresenceJWTAuthentication(JWTAuthentication):
    def authenticate(self, request):
        result = super().authenticate(request)
        if result is not None:
            touch_presence(result[0])
        return result
