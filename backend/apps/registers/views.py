"""Register endpoints (PRD §17). Scoped to visible projects; changes audited."""
from __future__ import annotations

from rest_framework import viewsets
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated

from apps.accounts.rbac import Capability
from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.projects.models import Project
from apps.projects.scoping import visible_projects

from .models import Decision, Issue, Risk
from .serializers import DecisionSerializer, IssueSerializer, RiskSerializer


class _RegisterViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    filterset_fields = ["project", "status"]

    def get_queryset(self):
        visible = visible_projects(self.request.user, Project.objects.all())
        return self.queryset.filter(project__in=visible)

    def _require(self, project, caps):
        user = self.request.user
        if not visible_projects(user, Project.objects.filter(pk=project.pk)).exists():
            raise PermissionDenied("You do not have access to that project.")
        if user.is_superuser:
            return
        if not any(user.has_capability(c) for c in caps):
            raise PermissionDenied("You lack the capability to change this register.")

    def perform_create(self, serializer):
        project = serializer.validated_data["project"]
        self._require(project, [Capability.CREATE_TASKS, Capability.MANAGE_PROJECT])
        obj = serializer.save()
        record(action=AuditAction.CREATE, obj=obj, request=self.request)

    def perform_update(self, serializer):
        self._require(serializer.instance.project, [Capability.CREATE_TASKS, Capability.MANAGE_PROJECT])
        obj = serializer.save()
        record(action=AuditAction.UPDATE, obj=obj, request=self.request)

    def perform_destroy(self, instance):
        self._require(instance.project, [Capability.MANAGE_PROJECT])
        record(action=AuditAction.DELETE, obj=instance, request=self.request)
        instance.delete()


class RiskViewSet(_RegisterViewSet):
    queryset = Risk.objects.select_related("project", "owner").prefetch_related("related_tasks").all()
    serializer_class = RiskSerializer


class IssueViewSet(_RegisterViewSet):
    queryset = Issue.objects.select_related("project", "owner").prefetch_related("related_tasks").all()
    serializer_class = IssueSerializer


class DecisionViewSet(_RegisterViewSet):
    queryset = Decision.objects.select_related("project", "decision_maker").prefetch_related("related_tasks").all()
    serializer_class = DecisionSerializer
