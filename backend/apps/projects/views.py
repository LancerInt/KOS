"""Project Engine endpoints (PRD §10.1, §10.6).

Visibility is enforced in `get_queryset` (before pagination — §7.7) and, for
single objects, via `lookup_queryset` + `CanAccessProject`. Any authenticated
user may create a project (becoming its owner); editing an existing one requires
the ``manage_project`` capability or ownership of that project (CanManageProject).
Project and membership changes are audited (§7.7).
"""
from __future__ import annotations

import re
from datetime import timedelta

from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import HasCapability
from apps.accounts.rbac import Capability, ProjectRole
from apps.audit.models import AuditAction
from apps.audit.services import record

from .models import (
    Epic,
    Membership,
    Milestone,
    Portfolio,
    Priority,
    Project,
    ProjectTemplate,
)
from .permissions import CanAccessProject, CanManageProject, can_manage_project
from .scoping import lookup_queryset, visible_projects
from .serializers import (
    CreateFromTemplateSerializer,
    EpicSerializer,
    MembershipSerializer,
    MilestoneSerializer,
    PortfolioSerializer,
    ProjectDetailSerializer,
    ProjectSerializer,
    ProjectTemplateSerializer,
)

WRITE_ACTIONS = {"create", "update", "partial_update", "destroy"}


@transaction.atomic
def build_from_template(data: dict, user) -> Project:
    """Create a project and seed its epics/milestones from a template (AC-6)."""
    tmpl = data["template"]
    start = data.get("start_date")

    project = Project.objects.create(
        name=data["name"],
        code=data["code"],
        portfolio=data.get("portfolio"),
        owner=user,
        project_type=tmpl.project_type,
        confidentiality=tmpl.default_confidentiality,
        priority=data.get("priority") or Priority.MEDIUM,
        start_date=start,
    )
    Membership.objects.get_or_create(
        user=user, project=project,
        defaults={"project_role": ProjectRole.OWNER, "added_by": user},
    )

    structure = tmpl.structure or {}

    def due_from(offset):
        if start is not None and offset is not None:
            return start + timedelta(days=int(offset))
        return None

    for e_order, epic_def in enumerate(structure.get("epics", [])):
        epic = Epic.objects.create(
            project=project, title=epic_def["title"],
            description=epic_def.get("description", ""), order=e_order,
        )
        for m_order, m in enumerate(epic_def.get("milestones", [])):
            Milestone.objects.create(
                project=project, epic=epic, title=m["title"],
                due_date=due_from(m.get("offset_days")), order=m_order,
            )

    for m_order, m in enumerate(structure.get("milestones", [])):
        Milestone.objects.create(
            project=project, title=m["title"],
            due_date=due_from(m.get("offset_days")), order=m_order,
        )
    return project


def _unique_project_code(name: str) -> str:
    """Derive a short unique project code from a name (auto-code for quick create)."""
    base = re.sub(r"[^A-Z0-9]", "", (name or "").upper())[:6] or "PRJ"
    code, n = base, 1
    while Project.objects.filter(code=code).exists():
        n += 1
        code = f"{base}{n}"[:30]
    return code


class ProjectViewSet(viewsets.ModelViewSet):
    queryset = Project.objects.select_related("portfolio", "owner", "manager", "department").all()
    # Anyone signed in may create a project (and owns what they create); editing or
    # deleting an existing one is gated per-object by CanManageProject (§7.4).
    permission_classes = [IsAuthenticated, CanAccessProject, CanManageProject]

    def get_serializer_class(self):
        return ProjectDetailSerializer if self.action == "retrieve" else ProjectSerializer

    def get_queryset(self):
        return visible_projects(self.request.user, self.queryset)

    def get_object(self):
        qs = lookup_queryset(self.request.user, self.queryset)
        obj = get_object_or_404(qs, pk=self.kwargs["pk"])
        self.check_object_permissions(self.request, obj)
        return obj

    def perform_create(self, serializer):
        owner = serializer.validated_data.get("owner") or self.request.user
        code = (serializer.validated_data.get("code") or "").strip() or _unique_project_code(
            serializer.validated_data.get("name", "")
        )
        project = serializer.save(owner=owner, code=code)
        Membership.objects.get_or_create(
            user=self.request.user, project=project,
            defaults={"project_role": ProjectRole.OWNER, "added_by": self.request.user},
        )
        record(action=AuditAction.CREATE, obj=project,
               new_value={"code": project.code, "name": project.name}, request=self.request)

    def perform_update(self, serializer):
        project = serializer.save()
        record(action=AuditAction.UPDATE, obj=project, request=self.request)

    def perform_destroy(self, instance):
        record(action=AuditAction.DELETE, obj=instance,
               old_value={"code": instance.code}, request=self.request)
        instance.delete()

    @action(detail=False, methods=["post"], url_path="from_template")
    def from_template(self, request):
        """Create a project from a template, seeding its hierarchy (AC-6).

        Open to any authenticated user — the creator becomes the project owner.
        """
        serializer = CreateFromTemplateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        project = build_from_template(serializer.validated_data, request.user)
        record(action=AuditAction.CREATE, obj=project,
               new_value={"code": project.code, "from_template": serializer.validated_data["template"].key},
               request=request)
        data = ProjectDetailSerializer(project, context={"request": request}).data
        return Response(data, status=201)


class _ProjectChildViewSet(viewsets.ModelViewSet):
    """Base for epics/milestones — scoped to visible projects; writes need manage rights."""

    project_field = "project"
    permission_classes = [IsAuthenticated, CanAccessProject, CanManageProject]

    def get_queryset(self):
        visible = visible_projects(self.request.user, Project.objects.all())
        return self.queryset.filter(**{f"{self.project_field}__in": visible})

    def perform_create(self, serializer):
        target = serializer.validated_data.get("project")
        if not can_manage_project(self.request.user, target):
            raise PermissionDenied("You do not have rights to change that project.")
        serializer.save()


class EpicViewSet(_ProjectChildViewSet):
    queryset = Epic.objects.select_related("project", "owner").all()
    serializer_class = EpicSerializer


class MilestoneViewSet(_ProjectChildViewSet):
    queryset = Milestone.objects.select_related("project", "epic").all()
    serializer_class = MilestoneSerializer


class MembershipViewSet(viewsets.ModelViewSet):
    """Add / change / remove project members (PRD §7.4). Audited (§7.7)."""

    queryset = Membership.objects.select_related("user", "project", "added_by").all()
    serializer_class = MembershipSerializer
    permission_classes = [IsAuthenticated, CanAccessProject, CanManageProject]

    def get_queryset(self):
        visible = visible_projects(self.request.user, Project.objects.all())
        return self.queryset.filter(project__in=visible)

    def perform_create(self, serializer):
        target = serializer.validated_data["project"]
        if not can_manage_project(self.request.user, target):
            raise PermissionDenied("You do not have rights to manage members of that project.")
        membership = serializer.save(added_by=self.request.user)
        record(action=AuditAction.MEMBERSHIP_CHANGE, obj=membership,
               new_value={"user": membership.user_id, "project": membership.project_id,
                          "role": membership.project_role, "op": "add"},
               request=self.request)

    def perform_update(self, serializer):
        old_role = serializer.instance.project_role
        membership = serializer.save()
        record(action=AuditAction.MEMBERSHIP_CHANGE, obj=membership,
               old_value={"role": old_role}, new_value={"role": membership.project_role},
               request=self.request)

    def perform_destroy(self, instance):
        record(action=AuditAction.MEMBERSHIP_CHANGE, obj=instance,
               old_value={"user": instance.user_id, "project": instance.project_id,
                          "role": instance.project_role, "op": "remove"},
               request=self.request)
        instance.delete()


class PortfolioViewSet(viewsets.ModelViewSet):
    queryset = Portfolio.objects.all()
    serializer_class = PortfolioSerializer
    permission_classes = [IsAuthenticated, HasCapability]

    def get_permissions(self):
        self.required_capability = (
            Capability.MANAGE_PROJECT if self.action in WRITE_ACTIONS else None
        )
        return super().get_permissions()


class ProjectTemplateViewSet(viewsets.ReadOnlyModelViewSet):
    """The 6 launch templates (PRD §10.6). Read-only; used by the create flow."""

    queryset = ProjectTemplate.objects.filter(is_active=True)
    serializer_class = ProjectTemplateSerializer
    permission_classes = [IsAuthenticated]


class TimelineView(APIView):
    """Gantt / roadmap data (visibility-scoped).

    ``GET /api/timeline/`` → a roadmap of every visible project (start → target).
    ``GET /api/timeline/?project=<id>`` → that project's dated tasks, milestones
    and task→task dependencies, for a detailed Gantt.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from django.db.models import Q

        from apps.dependencies.models import Dependency
        from apps.tasks.models import Task
        from apps.tasks.statuses import category_for

        visible = visible_projects(request.user, Project.objects.all())
        pid = request.query_params.get("project")

        if not pid:
            return Response({"projects": [
                {"id": p.id, "name": p.name, "code": p.code, "status": p.status,
                 "health": p.health, "start_date": p.start_date, "end_date": p.target_date}
                for p in visible.order_by("target_date", "name")
            ]})

        project = get_object_or_404(visible, pk=pid)
        tasks = list(
            Task.objects.filter(project=project)
            .filter(Q(start_date__isnull=False) | Q(due_date__isnull=False))
            .select_related("primary_owner")
        )
        task_ids = {t.id for t in tasks}
        deps = Dependency.objects.filter(
            successor__project=project, predecessor_task__isnull=False
        ).values("successor_id", "predecessor_task_id")

        return Response({
            "project": {"id": project.id, "name": project.name, "code": project.code,
                        "start_date": project.start_date, "end_date": project.target_date},
            "tasks": [
                {"id": t.id, "title": t.title, "status": t.status,
                 "category": category_for(t.status),
                 "start_date": t.start_date, "due_date": t.due_date,
                 "owner": (t.primary_owner.get_full_name() or t.primary_owner.username) if t.primary_owner else None}
                for t in tasks
            ],
            "milestones": [
                {"id": m.id, "title": m.title, "due_date": m.due_date, "status": m.status}
                for m in project.milestones.filter(due_date__isnull=False)
            ],
            "dependencies": [
                {"successor": d["successor_id"], "predecessor": d["predecessor_task_id"]}
                for d in deps
                if d["predecessor_task_id"] in task_ids and d["successor_id"] in task_ids
            ],
        })
