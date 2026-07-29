"""ERP integration endpoints (PRD §27).

Connection config, the delivery log and inbound events are administrator-only.
The inbound webhook is public but **signature-verified** — an unsigned or
mis-signed request is rejected.
"""
from __future__ import annotations

from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.rbac import Capability
from apps.audit.models import AuditAction
from apps.audit.services import client_ip, record

from .engine import send_test, verify_inbound
from .inbound import handle_inbound
from .models import ErpConnection, EventType, InboundEvent, WebhookDelivery
from .serializers import (
    ErpConnectionSerializer,
    InboundEventSerializer,
    WebhookDeliverySerializer,
)


def _require_admin(user) -> None:
    if not (user.is_superuser or user.has_capability(Capability.ADMINISTER)):
        raise PermissionDenied("ERP integration settings are restricted to administrators.")


class ErpConnectionViewSet(viewsets.ModelViewSet):
    queryset = ErpConnection.objects.select_related("created_by").all()
    serializer_class = ErpConnectionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return ErpConnection.objects.none()
        _require_admin(self.request.user)
        return super().get_queryset()

    def perform_create(self, serializer):
        _require_admin(self.request.user)
        conn = serializer.save(created_by=self.request.user)
        record(action=AuditAction.CREATE, obj=conn, new_value={"name": conn.name}, request=self.request)

    def perform_update(self, serializer):
        _require_admin(self.request.user)
        conn = serializer.save()
        record(action=AuditAction.UPDATE, obj=conn, request=self.request)

    def perform_destroy(self, instance):
        _require_admin(self.request.user)
        record(action=AuditAction.DELETE, obj=instance, old_value={"name": instance.name}, request=self.request)
        instance.delete()

    @action(detail=True, methods=["post"])
    def test(self, request, pk=None):
        _require_admin(request.user)
        delivery = send_test(self.get_object())
        record(action=AuditAction.UPDATE, obj=delivery.connection, new_value={"test": "ping"}, request=request)
        return Response(WebhookDeliverySerializer(delivery).data)


class WebhookDeliveryViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = WebhookDelivery.objects.select_related("connection").all()
    serializer_class = WebhookDeliverySerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["connection", "status", "event_type"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return WebhookDelivery.objects.none()
        _require_admin(self.request.user)
        return super().get_queryset()

    @action(detail=True, methods=["post"])
    def retry(self, request, pk=None):
        _require_admin(request.user)
        from .engine import attempt_delivery
        delivery = attempt_delivery(self.get_object())
        return Response(WebhookDeliverySerializer(delivery).data)


class InboundEventViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    queryset = InboundEvent.objects.select_related("connection").all()
    serializer_class = InboundEventSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["connection", "status", "event_type"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return InboundEvent.objects.none()
        _require_admin(self.request.user)
        return super().get_queryset()


class EventVocabularyView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _require_admin(request.user)
        return Response({"events": [{"value": v, "label": lbl} for v, lbl in EventType.choices if v != "ping"]})


class InboundWebhookView(APIView):
    """Public, signature-verified endpoint the ERP posts to (§27.3)."""

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def post(self, request):
        connection = verify_inbound(request)
        if connection is None:
            return Response({"detail": "Invalid or missing signature."}, status=401)

        data = request.data if isinstance(request.data, dict) else {}
        event_type = data.get("event") or request.headers.get("X-KOS-Event") or ""
        payload = data.get("data", data)

        event = InboundEvent.objects.create(
            connection=connection, event_type=event_type, payload=payload, source_ip=client_ip(request)
        )
        status_, result = handle_inbound(event_type, payload if isinstance(payload, dict) else {})
        event.status = status_
        event.result = result[:300]
        event.save(update_fields=["status", "result"])
        return Response({"status": status_, "result": result})
