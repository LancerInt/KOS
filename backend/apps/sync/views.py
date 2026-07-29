"""Offline sync endpoint (PRD §25, recommended change #5).

``POST /sync/`` replays a batch of queued client operations. Only **merge-safe**
operations are accepted:

* ``add_comment`` — additive; comments never conflict, and op_id dedup prevents
  a double-post on retry.
* ``set_checklist`` — a *field-level* set on one checklist item, so syncing a
  tick never clobbers other changes to the task (the merge-not-last-write-wins
  fix for the offline case).

Riskier mutations (status changes gated by Definition of Done, deadline changes)
are intentionally NOT queued offline — they need the live server state.
"""
from __future__ import annotations

from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.projects.models import Project
from apps.projects.scoping import visible_projects
from apps.tasks.models import ChecklistItem, Comment, Task

from .models import SyncedOperation


def _task_visible(user, task) -> bool:
    return visible_projects(user, Project.objects.filter(pk=task.project_id)).exists()


def _add_comment(op, request) -> dict:
    task = Task.objects.get(pk=op["task"])
    if not _task_visible(request.user, task):
        raise PermissionDenied("You do not have access to that task.")
    body = (op.get("body") or "").strip()
    if not body:
        raise ValueError("A comment body is required.")
    comment = Comment.objects.create(task=task, author=request.user, body=body)
    task.last_activity_at = timezone.now()
    task.save(update_fields=["last_activity_at"])
    record(action=AuditAction.CREATE, obj=comment, request=request)
    return {"comment_id": comment.id, "task": task.id}


def _set_checklist(op, request) -> dict:
    item = ChecklistItem.objects.select_related("task").get(pk=op["item"])
    if not _task_visible(request.user, item.task):
        raise PermissionDenied("You do not have access to that task.")
    item.is_done = bool(op.get("is_done"))
    item.save(update_fields=["is_done"])
    return {"item": item.id, "is_done": item.is_done}


HANDLERS = {"add_comment": _add_comment, "set_checklist": _set_checklist}


class SyncView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ops = request.data.get("ops") or []
        results = [self._apply(op, request) for op in ops[:200]]
        return Response({"results": results})

    def _apply(self, op, request) -> dict:
        op_id = op.get("op_id")
        kind = op.get("kind")
        if not op_id:
            return {"op_id": None, "ok": False, "error": "missing op_id"}

        existing = SyncedOperation.objects.filter(op_id=op_id).first()
        if existing:
            return {"op_id": op_id, "ok": True, "duplicate": True, **(existing.result or {})}

        handler = HANDLERS.get(kind)
        if handler is None:
            return {"op_id": op_id, "ok": False, "error": f"unknown kind '{kind}'"}

        try:
            result = handler(op, request)
        except PermissionDenied as exc:
            return {"op_id": op_id, "ok": False, "error": str(exc)}
        except (Task.DoesNotExist, ChecklistItem.DoesNotExist):
            return {"op_id": op_id, "ok": False, "error": "target no longer exists"}
        except Exception as exc:  # noqa: BLE001
            return {"op_id": op_id, "ok": False, "error": str(exc)[:200]}

        SyncedOperation.objects.create(op_id=op_id, user=request.user, kind=kind, result=result)
        return {"op_id": op_id, "ok": True, **result}
