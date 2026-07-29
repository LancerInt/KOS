"""CRM endpoints (PRD §28). Writes need Create-Tasks / Manage-Project.

The headline action is ``convert_to_project`` — a won opportunity becomes a real
Project, wiring the sales module into the shared project & task engines (§34).
"""
from __future__ import annotations

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.rbac import Capability, ProjectRole
from apps.audit.models import AuditAction
from apps.audit.services import record

from .models import Contact, Customer, Opportunity
from .serializers import ContactSerializer, CustomerSerializer, OpportunitySerializer

WRITE_CAPS = [Capability.CREATE_TASKS, Capability.MANAGE_PROJECT, Capability.ADMINISTER]


class _CrmWriteMixin:
    permission_classes = [IsAuthenticated]

    def _require_write(self) -> None:
        user = self.request.user
        if not (user.is_superuser or any(user.has_capability(c) for c in WRITE_CAPS)):
            raise PermissionDenied("You do not have permission to modify CRM records.")

    def perform_create(self, serializer):
        self._require_write()
        obj = serializer.save()
        record(action=AuditAction.CREATE, obj=obj, request=self.request)

    def perform_update(self, serializer):
        self._require_write()
        obj = serializer.save()
        record(action=AuditAction.UPDATE, obj=obj, request=self.request)

    def perform_destroy(self, instance):
        self._require_write()
        record(action=AuditAction.DELETE, obj=instance, request=self.request)
        instance.delete()


class CustomerViewSet(_CrmWriteMixin, viewsets.ModelViewSet):
    queryset = Customer.objects.select_related("owner").prefetch_related("contacts", "opportunities").all()
    serializer_class = CustomerSerializer
    filterset_fields = ["status", "customer_type"]
    search_fields = ["name", "industry", "region"]


class ContactViewSet(_CrmWriteMixin, viewsets.ModelViewSet):
    queryset = Contact.objects.select_related("customer").all()
    serializer_class = ContactSerializer
    filterset_fields = ["customer"]


class OpportunityViewSet(_CrmWriteMixin, viewsets.ModelViewSet):
    queryset = Opportunity.objects.select_related("customer", "owner", "project").all()
    serializer_class = OpportunitySerializer
    filterset_fields = ["stage", "customer", "owner"]
    search_fields = ["title"]

    @action(detail=True, methods=["post"])
    def convert_to_project(self, request, pk=None):
        self._require_write()
        opp = self.get_object()
        if opp.project_id:
            raise ValidationError("This opportunity is already linked to a project.")

        from apps.projects.models import Membership, Project

        project = Project.objects.create(
            name=f"{opp.customer.name}: {opp.title}"[:200],
            code=f"CRM-{opp.id:04d}",
            description=opp.notes,
            owner=request.user,
            business_objective=f"Deliver sales opportunity worth {opp.currency} {opp.amount}.",
        )
        Membership.objects.get_or_create(
            user=request.user, project=project,
            defaults={"project_role": ProjectRole.OWNER, "added_by": request.user},
        )
        opp.project = project
        opp.save(update_fields=["project"])
        record(action=AuditAction.CREATE, obj=project, new_value={"from_opportunity": opp.id}, request=request)
        return Response({"project": project.id, "code": project.code}, status=201)
