"""Notification & preference endpoints (PRD §22)."""
from __future__ import annotations

from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditAction
from apps.audit.services import record

from .models import Notification
from .serializers import NotificationPreferenceSerializer, NotificationSerializer
from .services import get_prefs


class NotificationViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["is_read", "event", "requires_acknowledgement"]

    def get_queryset(self):
        return Notification.objects.filter(recipient=self.request.user)

    @action(detail=False, methods=["get"])
    def unread_count(self, request):
        qs = self.get_queryset().filter(is_read=False)
        return Response({
            "unread": qs.count(),
            "needs_ack": qs.filter(requires_acknowledgement=True, acknowledged_at__isnull=True).count(),
        })

    @action(detail=True, methods=["post"])
    def mark_read(self, request, pk=None):
        n = self.get_object()
        n.is_read = True
        n.save(update_fields=["is_read"])
        return Response(NotificationSerializer(n).data)

    @action(detail=False, methods=["post"])
    def mark_all_read(self, request):
        self.get_queryset().filter(is_read=False).update(is_read=True)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def acknowledge(self, request, pk=None):
        """Return the mandatory status message for a 48-hour notification (§22.4)."""
        n = self.get_object()
        if not n.requires_acknowledgement:
            raise ValidationError("This notification does not require acknowledgement.")
        message = (request.data.get("message") or "").strip()
        if not message:
            raise ValidationError({"message": "An acknowledgement message is required."})
        n.acknowledged_at = timezone.now()
        n.acknowledgement_message = message
        n.is_read = True
        n.save(update_fields=["acknowledged_at", "acknowledgement_message", "is_read"])
        record(action=AuditAction.NOTIFICATION_ACK, obj=n.task or n,
               new_value={"message": message}, request=request)
        return Response(NotificationSerializer(n).data)


class NotificationPreferenceView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        return Response(NotificationPreferenceSerializer(get_prefs(request.user)).data)

    def put(self, request: Request) -> Response:
        pref = get_prefs(request.user)
        serializer = NotificationPreferenceSerializer(pref, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)
