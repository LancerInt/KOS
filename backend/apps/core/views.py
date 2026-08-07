"""Core endpoints — health check, API root, and per-user saved views."""
from __future__ import annotations

from django.db import connection
from rest_framework import viewsets
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import SavedView
from .serializers import SavedViewSerializer


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


class SavedViewViewSet(viewsets.ModelViewSet):
    """Per-user saved filter/sort/layout presets for a screen.

    Always scoped to the authenticated user — one user can neither see nor touch
    another's presets. Filter by ``?surface=dashboard`` to fetch one screen's set.
    """

    serializer_class = SavedViewSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = SavedView.objects.filter(owner=self.request.user)
        surface = self.request.query_params.get("surface")
        if surface:
            qs = qs.filter(surface=surface)
        return qs
