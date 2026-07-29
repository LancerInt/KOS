"""Core endpoints — health check and API root."""
from __future__ import annotations

from django.db import connection
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthView(APIView):
    """Liveness/readiness probe. Public — no auth required."""

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def get(self, request: Request) -> Response:
        db_ok = True
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
        except Exception:  # pragma: no cover - defensive
            db_ok = False

        return Response(
            {
                "service": "KOS API",
                "status": "ok" if db_ok else "degraded",
                "database": "ok" if db_ok else "unreachable",
                "version": "0.1.0",
            }
        )
