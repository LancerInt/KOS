"""Search, dashboards & reports (PRD §20, §21, §23).

* ``GET /search/``            — global search across visible content
* ``GET /dashboard/``         — the personal + management dashboard
* ``GET /reports/projects/``  — per-project rollup table (needs View Reports)
* ``GET /reports/projects/export/`` and ``/reports/tasks/export/`` — CSV
  (needs Export Data)

Everything is scoped to the caller's visible projects (§7.7) and reported on the
six canonical categories (§12.1).
"""
from __future__ import annotations

import csv
from datetime import date, timedelta

from django.db.models import Count, Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.rbac import Capability
from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.approvals.models import ApprovalRequest, ApprovalStatus
from apps.dependencies.models import Blocker
from apps.documents.models import Document, DocumentStatus, SOP, SOPStage
from apps.notifications.models import Notification
from apps.projects.models import Project, ProjectHealth, ProjectStatus
from apps.projects.scoping import visible_projects
from apps.registers.models import Decision, Issue, RegisterStatus, Risk
from apps.tasks.models import Task

from .aggregates import (
    category_map,
    closed_statuses,
    fold_categories,
    horizon,
    project_report_rows,
)


def _name(user) -> str:
    return (user.get_full_name() or user.username) if user else ""


def _require(user, capability) -> None:
    if not (user.is_superuser or user.has_capability(capability)):
        raise PermissionDenied("You do not have permission for this report.")


# --------------------------------------------------------------------------- #
# Global search (§20)
# --------------------------------------------------------------------------- #
class GlobalSearchView(APIView):
    permission_classes = [IsAuthenticated]
    LIMIT = 8

    def get(self, request):
        q = (request.query_params.get("q") or "").strip()
        if len(q) < 2:
            return Response({"query": q, "results": {}, "total": 0})

        user = request.user
        cat_map = category_map()
        visible = visible_projects(user, Project.objects.all())
        n = self.LIMIT

        projects = [
            {"id": p.id, "code": p.code, "name": p.name, "project_type": p.project_type,
             "status": p.status, "health": p.health}
            for p in visible.filter(Q(name__icontains=q) | Q(code__icontains=q))[:n]
        ]
        tasks = [
            {"id": t.id, "title": t.title, "project": t.project_id, "project_code": t.project.code,
             "status": t.status, "category": cat_map.get(t.status, "not_started"),
             "due_date": t.due_date, "is_overdue": t.is_overdue}
            for t in Task.objects.filter(project__in=visible, title__icontains=q).select_related("project")[:n]
        ]
        documents = [
            {"id": d.id, "title": d.title, "project": d.project_id, "category": d.category,
             "status": d.status}
            for d in Document.objects.filter(Q(project__in=visible) | Q(project__isnull=True))
            .filter(Q(title__icontains=q) | Q(tags__icontains=q))[:n]
        ]
        sops = [
            {"id": s.id, "code": s.code, "title": s.title, "stage": s.stage}
            for s in SOP.objects.filter(Q(code__icontains=q) | Q(title__icontains=q))[:n]
        ]
        registers = []
        for r in Risk.objects.filter(project__in=visible, statement__icontains=q)[:n]:
            registers.append({"type": "risk", "id": r.id, "label": r.statement[:140], "project": r.project_id, "status": r.status})
        for i in Issue.objects.filter(project__in=visible, description__icontains=q)[:n]:
            registers.append({"type": "issue", "id": i.id, "label": i.description[:140], "project": i.project_id, "status": i.status})
        for d in Decision.objects.filter(project__in=visible, decision_required__icontains=q)[:n]:
            registers.append({"type": "decision", "id": d.id, "label": d.decision_required[:140], "project": d.project_id, "status": d.status})

        results = {"projects": projects, "tasks": tasks, "documents": documents, "sops": sops, "registers": registers}
        return Response({"query": q, "results": results, "total": sum(len(v) for v in results.values())})


# --------------------------------------------------------------------------- #
# Dashboard (§21, §23)
# --------------------------------------------------------------------------- #
class DashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        today = date.today()
        soon = horizon(7)
        soon30 = horizon(30)
        cat_map = category_map()
        closed = closed_statuses(cat_map)

        visible = visible_projects(user, Project.objects.all())
        vtasks = Task.objects.filter(project__in=visible)

        mine = vtasks.filter(Q(owners=user) | Q(primary_owner=user)).distinct()
        my_rows = list(mine.values("status").annotate(n=Count("id")))
        me = {
            "assigned_total": sum(r["n"] for r in my_rows),
            "by_category": fold_categories(my_rows, cat_map),
            "overdue": mine.filter(due_date__lt=today).exclude(status__in=closed).count(),
            "due_soon": mine.filter(due_date__gte=today, due_date__lte=soon).exclude(status__in=closed).count(),
        }

        data = {"me": me, "can_view_reports": bool(user.is_superuser or user.has_capability(Capability.VIEW_REPORTS))}

        if data["can_view_reports"]:
            data["management"] = self._management(user, visible, vtasks, cat_map, closed, today, soon30)
        return Response(data)

    def _management(self, user, visible, vtasks, cat_map, closed, today, soon30):
        projects = list(visible.values("id", "code", "name", "health", "status"))

        by_health = {h.value: 0 for h in ProjectHealth}
        by_status = {s.value: 0 for s in ProjectStatus}
        for p in projects:
            by_health[p["health"]] = by_health.get(p["health"], 0) + 1
            by_status[p["status"]] = by_status.get(p["status"], 0) + 1

        overdue_by_project = {
            r["project_id"]: r["n"]
            for r in vtasks.filter(due_date__lt=today).exclude(status__in=closed)
            .values("project_id").annotate(n=Count("id"))
        }
        open_reg = [RegisterStatus.OPEN, RegisterStatus.IN_PROGRESS]
        risks_by_project = {
            r["project_id"]: r["n"]
            for r in Risk.objects.filter(project__in=visible, status__in=open_reg)
            .values("project_id").annotate(n=Count("id"))
        }

        at_risk = [
            {
                "id": p["id"], "code": p["code"], "name": p["name"],
                "health": p["health"], "status": p["status"],
                "overdue_tasks": overdue_by_project.get(p["id"], 0),
                "open_risks": risks_by_project.get(p["id"], 0),
            }
            for p in projects
            if p["health"] in (ProjectHealth.AT_RISK, ProjectHealth.OFF_TRACK) or p["status"] == ProjectStatus.AT_RISK
        ]

        high_risks = sum(
            1 for r in Risk.objects.filter(project__in=visible, status__in=open_reg) if r.score >= 15
        )

        escalations = self._escalations(visible)

        return {
            "projects_total": len(projects),
            "by_health": by_health,
            "by_status": by_status,
            "tasks_open": vtasks.exclude(status__in=closed).count(),
            "tasks_overdue": vtasks.filter(due_date__lt=today).exclude(status__in=closed).count(),
            "open_blockers": Blocker.objects.filter(resolved_at__isnull=True, task__project__in=visible).count(),
            "high_risks": high_risks,
            "pending_approvals": ApprovalRequest.objects.filter(status=ApprovalStatus.PENDING)
                .filter(Q(task__project__in=visible) | Q(project__in=visible)).count(),
            "documents_expiring": Document.objects.filter(expiry_date__isnull=False, expiry_date__lte=soon30)
                .exclude(status=DocumentStatus.ARCHIVED)
                .filter(Q(project__in=visible) | Q(project__isnull=True)).count(),
            "sops_review_due": SOP.objects.filter(
                stage=SOPStage.PUBLISHED, next_review_date__isnull=False, next_review_date__lte=soon30
            ).count(),
            "at_risk_projects": at_risk,
            "escalations": escalations,
        }

    def _escalations(self, visible):
        """Unacknowledged 48h-ack notifications older than 24h (§22.4)."""
        cutoff = timezone.now() - timedelta(hours=24)
        qs = (
            Notification.objects.filter(
                requires_acknowledgement=True, acknowledged_at__isnull=True, created_at__lt=cutoff
            )
            .filter(Q(project__in=visible) | Q(task__project__in=visible) | Q(project__isnull=True, task__isnull=True))
            .select_related("recipient", "project", "task", "task__project")
            .order_by("created_at")[:12]
        )
        out = []
        for note in qs:
            project = note.project or (note.task.project if note.task_id else None)
            hours = int((timezone.now() - note.created_at).total_seconds() // 3600)
            out.append({
                "id": note.id, "title": note.title, "recipient": _name(note.recipient),
                "project": project.code if project else None, "task": note.task_id,
                "hours_open": hours, "created_at": note.created_at,
            })
        return out


# --------------------------------------------------------------------------- #
# Reports (§23)
# --------------------------------------------------------------------------- #
class ProjectReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _require(request.user, Capability.VIEW_REPORTS)
        return Response({"rows": project_report_rows(request.user)})


class ProjectReportExportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _require(request.user, Capability.EXPORT_DATA)
        rows = project_report_rows(request.user)
        record(action=AuditAction.EXPORT, object_type="ProjectReport",
               new_value={"rows": len(rows)}, request=request)
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="kos_projects_report.csv"'
        writer = csv.writer(response)
        writer.writerow([
            "Code", "Name", "Type", "Status", "Health", "Progress %", "Owner", "Members",
            "Tasks", "Open", "Done", "Overdue", "Open risks", "Open issues",
        ])
        for r in rows:
            writer.writerow([
                r["code"], r["name"], r["project_type"], r["status"], r["health"], r["progress"],
                r["owner_name"], r["members"], r["tasks_total"], r["tasks_open"], r["tasks_done"],
                r["tasks_overdue"], r["open_risks"], r["open_issues"],
            ])
        return response


class TaskExportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        _require(request.user, Capability.EXPORT_DATA)
        cat_map = category_map()
        visible = visible_projects(request.user, Project.objects.all())
        qs = Task.objects.filter(project__in=visible).select_related("project", "primary_owner").order_by("project__code", "-created_at")
        project_id = request.query_params.get("project")
        if project_id:
            qs = qs.filter(project_id=project_id)

        record(action=AuditAction.EXPORT, object_type="TaskReport",
               new_value={"project": project_id or "all"}, request=request)
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = 'attachment; filename="kos_tasks_report.csv"'
        writer = csv.writer(response)
        writer.writerow([
            "ID", "Title", "Project", "Status", "Category", "Priority",
            "Primary owner", "Due date", "Overdue", "Created",
        ])
        for t in qs:
            writer.writerow([
                t.id, t.title, t.project.code, t.status, cat_map.get(t.status, "not_started"),
                t.priority, _name(t.primary_owner), t.due_date or "", "yes" if t.is_overdue else "",
                t.created_at.date(),
            ])
        return response
