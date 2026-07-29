"""Automation endpoints (PRD §24).

Rules are managed by holders of **Manage Workflows** (or Administrator) — the
same power that authors workflows (§12.4). A project-scoped rule additionally
requires access to that project. The ``vocabulary`` endpoint feeds the rule
builder so the UI never hard-codes the trigger/condition/action vocabulary.
"""
from __future__ import annotations

from django.db.models import Q
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.rbac import Capability
from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.projects.models import Priority, Project
from apps.projects.scoping import visible_projects
from apps.tasks.statuses import DEFAULT_STATUSES

from .engine import CONTEXT_FIELDS
from .models import (
    ActionType,
    AutomationLog,
    AutomationRule,
    ConditionOp,
    TriggerType,
)
from .serializers import AutomationLogSerializer, AutomationRuleSerializer

MANAGE_CAPS = [Capability.MANAGE_WORKFLOWS, Capability.ADMINISTER]


def _can_manage(user) -> bool:
    return user.is_superuser or any(user.has_capability(c) for c in MANAGE_CAPS)


class AutomationRuleViewSet(viewsets.ModelViewSet):
    queryset = AutomationRule.objects.select_related("project", "created_by").all()
    serializer_class = AutomationRuleSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["project", "trigger", "is_active"]

    def get_queryset(self):
        visible = visible_projects(self.request.user, Project.objects.all())
        return self.queryset.filter(Q(project__in=visible) | Q(project__isnull=True))

    def _require(self, project) -> None:
        user = self.request.user
        if not _can_manage(user):
            raise PermissionDenied("You need the Manage Workflows capability to change automations.")
        if project is not None and not visible_projects(user, Project.objects.filter(pk=project.pk)).exists():
            raise PermissionDenied("You do not have access to that project.")

    def perform_create(self, serializer):
        self._require(serializer.validated_data.get("project"))
        rule = serializer.save(created_by=self.request.user)
        record(action=AuditAction.CREATE, obj=rule, new_value={"trigger": rule.trigger}, request=self.request)

    def perform_update(self, serializer):
        self._require(serializer.instance.project)
        rule = serializer.save()
        record(action=AuditAction.UPDATE, obj=rule, request=self.request)

    def perform_destroy(self, instance):
        self._require(instance.project)
        record(action=AuditAction.DELETE, obj=instance, old_value={"name": instance.name}, request=self.request)
        instance.delete()


class AutomationLogViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    queryset = AutomationLog.objects.all()
    serializer_class = AutomationLogSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["rule", "project", "trigger", "ok"]

    def get_queryset(self):
        visible = visible_projects(self.request.user, Project.objects.all())
        return self.queryset.filter(Q(project__in=visible) | Q(project__isnull=True))


class AutomationVocabularyView(APIView):
    """The trigger / condition / action vocabulary for the rule builder."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            "triggers": [{"value": v, "label": lbl} for v, lbl in TriggerType.choices],
            "condition_ops": [{"value": v, "label": lbl} for v, lbl in ConditionOp.choices],
            "condition_fields": CONTEXT_FIELDS,
            "actions": [{"value": v, "label": lbl} for v, lbl in ActionType.choices],
            "statuses": [{"value": key, "label": label, "category": cat} for key, label, cat in DEFAULT_STATUSES],
            "priorities": [{"value": v, "label": lbl} for v, lbl in Priority.choices],
        })
