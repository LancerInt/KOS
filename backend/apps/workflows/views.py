"""Workflow builder endpoints (PRD §12.4, D3).

`GET /projects/<id>/workflow/`     resolved workflow (custom or built-in default)
`POST /projects/<id>/workflow/`    clone the default into an editable custom workflow
`PUT /projects/<id>/workflow/`     save the builder (statuses + transitions)
`DELETE /projects/<id>/workflow/`  revert to the default

Writes require the ``manage_workflows`` capability (D3) and are audited (§26).
"""
from __future__ import annotations

from django.db import transaction
from django.http import Http404
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.rbac import Capability
from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.projects.models import Project
from apps.projects.scoping import visible_projects
from apps.tasks.models import Task
from apps.tasks.statuses import DEFAULT_TRANSITIONS, StatusCategory

from .models import Workflow, WorkflowStatus, WorkflowTransition
from .resolver import BUILTIN_STATUSES, resolve


class ProjectWorkflowView(APIView):
    permission_classes = [IsAuthenticated]

    # --- helpers -------------------------------------------------------- #
    def _project(self, request, project_id) -> Project:
        project = visible_projects(request.user, Project.objects.filter(pk=project_id)).first()
        if project is None:
            raise Http404
        return project

    def _require_manage(self, request) -> None:
        user = request.user
        if not (user.is_superuser or user.has_capability(Capability.MANAGE_WORKFLOWS)):
            raise PermissionDenied("You need the 'manage workflows' capability.")

    def _payload(self, project) -> dict:
        rw = resolve(project)
        data = rw.as_dict()
        data["has_custom"] = rw.source == "custom"
        data["project"] = project.id
        return data

    # --- GET ------------------------------------------------------------ #
    def get(self, request, project_id):
        return Response(self._payload(self._project(request, project_id)))

    # --- POST (clone default) ------------------------------------------ #
    def post(self, request, project_id):
        project = self._project(request, project_id)
        self._require_manage(request)
        if getattr(project, "custom_workflow", None) is not None:
            raise ValidationError("This project already has a custom workflow.")

        with transaction.atomic():
            wf = Workflow.objects.create(project=project, name="Custom workflow", created_by=request.user)
            smap = {
                s["key"]: WorkflowStatus.objects.create(
                    workflow=wf, key=s["key"], label=s["label"], category=s["category"],
                    order=s["order"], is_initial=s["is_initial"],
                )
                for s in BUILTIN_STATUSES
            }
            WorkflowTransition.objects.bulk_create(
                WorkflowTransition(workflow=wf, from_status=smap[f], to_status=smap[t])
                for f, t in DEFAULT_TRANSITIONS
                if f in smap and t in smap
            )
        record(action=AuditAction.WORKFLOW_CHANGE, obj=wf, new_value={"op": "clone_default"}, request=request)
        return Response(self._payload(project), status=201)

    # --- PUT (save builder) --------------------------------------------- #
    def put(self, request, project_id):
        project = self._project(request, project_id)
        self._require_manage(request)

        statuses = request.data.get("statuses") or []
        transitions = request.data.get("transitions") or []
        self._validate(project, statuses, transitions)

        with transaction.atomic():
            wf = getattr(project, "custom_workflow", None) or Workflow.objects.create(
                project=project, name="Custom workflow", created_by=request.user
            )
            wf.name = request.data.get("name", wf.name)
            wf.save()
            wf.statuses.all().delete()  # cascades transitions

            if not any(s.get("is_initial") for s in statuses):
                statuses[0]["is_initial"] = True

            smap = {
                s["key"]: WorkflowStatus.objects.create(
                    workflow=wf, key=s["key"], label=s["label"], category=s["category"],
                    order=s.get("order", i), is_initial=bool(s.get("is_initial")),
                )
                for i, s in enumerate(statuses)
            }
            WorkflowTransition.objects.bulk_create(
                WorkflowTransition(workflow=wf, from_status=smap[tr["from"]], to_status=smap[tr["to"]])
                for tr in transitions
            )
        record(action=AuditAction.WORKFLOW_CHANGE, obj=wf, new_value={"statuses": len(statuses)}, request=request)
        return Response(self._payload(project))

    # --- DELETE (revert) ------------------------------------------------ #
    def delete(self, request, project_id):
        project = self._project(request, project_id)
        self._require_manage(request)
        wf = getattr(project, "custom_workflow", None)
        if wf is None:
            return Response(self._payload(project))

        default_keys = {s["key"] for s in BUILTIN_STATUSES}
        used = set(Task.objects.filter(project=project).values_list("status", flat=True))
        invalid = used - default_keys
        if invalid:
            raise ValidationError(
                {"detail": f"Tasks use custom statuses {sorted(invalid)} not in the default. Migrate them first."}
            )
        record(action=AuditAction.WORKFLOW_CHANGE, obj=wf, old_value={"op": "revert_to_default"}, request=request)
        wf.delete()
        return Response(self._payload(project))

    # --- validation ----------------------------------------------------- #
    def _validate(self, project, statuses, transitions) -> None:
        if not statuses:
            raise ValidationError({"statuses": "At least one status is required."})

        keys = [s.get("key") for s in statuses]
        if len(keys) != len(set(keys)):
            raise ValidationError({"statuses": "Status keys must be unique."})

        valid_categories = set(StatusCategory.values)
        for s in statuses:
            if s.get("category") not in valid_categories:
                raise ValidationError({"statuses": f"Status '{s.get('key')}' needs a valid canonical category."})
            if not s.get("label"):
                raise ValidationError({"statuses": f"Status '{s.get('key')}' needs a label."})

        keyset = set(keys)
        for tr in transitions:
            if tr.get("from") not in keyset or tr.get("to") not in keyset:
                raise ValidationError({"transitions": "A transition references an unknown status."})

        # §12.4 — a status in use by active tasks cannot be removed until migrated.
        used = set(Task.objects.filter(project=project).values_list("status", flat=True))
        removed = used - keyset
        if removed:
            raise ValidationError(
                {"statuses": f"Cannot remove status(es) still used by tasks: {sorted(removed)}. Migrate those tasks first."}
            )
