"""Regulatory registration endpoints (PRD §29).

Writes need Create-Tasks / Manage-Project; approving a registration additionally
needs the Approve capability (a regulatory-affairs decision). Every lifecycle
move is audited, and the expiry reminder reuses the shared reminder engine.
"""
from __future__ import annotations

from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.rbac import Capability
from apps.audit.models import AuditAction
from apps.audit.services import record

from .models import RegStatus, RegulatoryRegistration
from .serializers import RegistrationSerializer

WRITE_CAPS = [Capability.CREATE_TASKS, Capability.MANAGE_PROJECT, Capability.ADMINISTER]


class RegistrationViewSet(viewsets.ModelViewSet):
    queryset = RegulatoryRegistration.objects.select_related("owner", "project").prefetch_related("documents").all()
    serializer_class = RegistrationSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["status", "authority", "owner"]
    search_fields = ["product_name", "registration_number", "category"]

    def _require_write(self) -> None:
        user = self.request.user
        if not (user.is_superuser or any(user.has_capability(c) for c in WRITE_CAPS)):
            raise PermissionDenied("You do not have permission to modify registrations.")

    def perform_create(self, serializer):
        self._require_write()
        obj = serializer.save(owner=self.request.user, status=RegStatus.DRAFT)
        record(action=AuditAction.CREATE, obj=obj, request=self.request)

    def perform_update(self, serializer):
        self._require_write()
        obj = serializer.save()
        record(action=AuditAction.UPDATE, obj=obj, request=self.request)

    def perform_destroy(self, instance):
        self._require_write()
        record(action=AuditAction.DELETE, obj=instance, request=self.request)
        instance.delete()

    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        self._require_write()
        reg = self.get_object()
        to = request.data.get("to")
        if to not in RegStatus.values:
            raise ValidationError({"to": "Unknown status."})
        if not reg.can_transition_to(to):
            raise ValidationError({"to": f"Cannot move from '{reg.status}' to '{to}'."})

        # Approving a registration is a regulatory-affairs decision.
        if to == RegStatus.APPROVED and not (request.user.is_superuser or request.user.has_capability(Capability.APPROVE)):
            raise PermissionDenied("Approving a registration requires the Approve capability.")

        fields = ["status"]
        reg.status = to
        if to == RegStatus.SUBMITTED and reg.submission_date is None:
            reg.submission_date = timezone.now().date()
            fields.append("submission_date")
        if to == RegStatus.APPROVED and reg.approval_date is None:
            reg.approval_date = timezone.now().date()
            fields.append("approval_date")
        if to in (RegStatus.SUBMITTED, RegStatus.RENEWAL_DUE):
            reg.expiry_reminded_at = None
            fields.append("expiry_reminded_at")
        reg.save(update_fields=fields)

        record(action=AuditAction.WORKFLOW_CHANGE, obj=reg, new_value={"status": to}, request=request)
        return Response(self.get_serializer(reg).data)
