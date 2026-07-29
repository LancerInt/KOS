"""Audit trail viewer, object history, export & retention governance (PRD §26).

The audit trail is immutable and sensitive, so all of this is gated on the
**Administrator** capability. Reads never mutate; the only writes are (a) editing
a retention policy and (b) running a purge — both of which are themselves
audited.
"""
from __future__ import annotations

import csv

from django.http import HttpResponse
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.rbac import Capability

from .models import AuditAction, AuditLog, RetentionPolicy
from .retention import preview_purge, run_purge
from .serializers import AuditLogSerializer, RetentionPolicySerializer
from .services import record


def _require_admin(user) -> None:
    if not (user.is_superuser or user.has_capability(Capability.ADMINISTER)):
        raise PermissionDenied("The audit trail is restricted to administrators.")


def _apply_filters(qs, params):
    action_ = params.get("action")
    object_type = params.get("object_type")
    object_id = params.get("object_id")
    actor = params.get("actor")
    after = params.get("after")
    before = params.get("before")
    if action_:
        qs = qs.filter(action=action_)
    if object_type:
        qs = qs.filter(object_type=object_type)
    if object_id:
        qs = qs.filter(object_id=str(object_id))
    if actor:
        qs = qs.filter(actor_id=actor)
    if after:
        qs = qs.filter(created_at__date__gte=after)
    if before:
        qs = qs.filter(created_at__date__lte=before)
    return qs


class AuditLogViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = AuditLog.objects.select_related("actor").all()
    serializer_class = AuditLogSerializer
    permission_classes = [IsAuthenticated]
    search_fields = ["object_type", "object_id", "reason"]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return AuditLog.objects.none()
        _require_admin(self.request.user)
        return _apply_filters(super().get_queryset(), self.request.query_params)

    @action(detail=False, methods=["get"])
    def actions(self, request):
        """The action vocabulary, for the viewer's filter dropdown."""
        _require_admin(request.user)
        return Response([{"value": v, "label": lbl} for v, lbl in AuditAction.choices])


class ObjectHistoryView(APIView):
    """Full change history for one object — 'who changed what, when, why' (§26.1)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        _require_admin(request.user)
        object_type = request.query_params.get("type")
        object_id = request.query_params.get("id")
        if not object_type or object_id is None:
            return Response({"detail": "type and id are required."}, status=400)
        qs = (
            AuditLog.objects.select_related("actor")
            .filter(object_type=object_type, object_id=str(object_id))
            .order_by("-created_at")[:200]
        )
        return Response(AuditLogSerializer(qs, many=True).data)


class AuditExportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _require_admin(request.user)
        qs = _apply_filters(AuditLog.objects.select_related("actor").all(), request.query_params)
        record(action=AuditAction.EXPORT, object_type="AuditLog",
               new_value={"filters": {k: v for k, v in request.query_params.items()}}, request=request)

        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="kos_audit_log.csv"'
        writer = csv.writer(response)
        writer.writerow(["Timestamp", "Actor", "Action", "Object type", "Object ID", "Reason", "Source IP"])
        for log in qs.iterator():
            actor = (log.actor.get_full_name() or log.actor.username) if log.actor else "System"
            writer.writerow([
                log.created_at.isoformat(), actor, log.action,
                log.object_type, log.object_id, log.reason, log.source_ip or "",
            ])
        return response


class RetentionPolicyViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin,
                             mixins.UpdateModelMixin, viewsets.GenericViewSet):
    queryset = RetentionPolicy.objects.all()
    serializer_class = RetentionPolicySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        if getattr(self, "swagger_fake_view", False):
            return RetentionPolicy.objects.none()
        _require_admin(self.request.user)
        return super().get_queryset()

    def perform_update(self, serializer):
        _require_admin(self.request.user)
        before = {"retention_days": serializer.instance.retention_days, "is_exempt": serializer.instance.is_exempt}
        policy = serializer.save()
        record(action=AuditAction.UPDATE, obj=policy, old_value=before,
               new_value={"retention_days": policy.retention_days, "is_exempt": policy.is_exempt},
               request=self.request)

    @action(detail=False, methods=["get"])
    def preview(self, request):
        _require_admin(request.user)
        return Response(preview_purge())

    @action(detail=False, methods=["post"])
    def purge(self, request):
        _require_admin(request.user)
        results = run_purge()
        record(action=AuditAction.DELETE, object_type="RetentionPurge", new_value=results, request=request)
        return Response(results)
