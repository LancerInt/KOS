"""Document & SOP endpoints (PRD §18, §19).

Documents are scoped to visible projects (org-wide documents are visible to
everyone); SOPs are an organisation-wide library. Uploads, versions, rollbacks,
approvals and lifecycle transitions are all audited, and downloads are logged to
their own trail (§18.5).
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.rbac import Capability
from apps.audit.models import AuditAction
from apps.audit.services import client_ip, record
from apps.notifications.models import NotificationEvent
from apps.notifications.services import notify, notify_many
from apps.projects.models import Membership, Project
from apps.projects.scoping import visible_projects

from .models import (
    add_months,
    Document,
    DocumentCategory,
    DocumentDownload,
    DocumentStatus,
    DocumentVersion,
    SOP,
    SOPStage,
    SOPVersion,
)
from .serializers import DocumentSerializer, SOPSerializer

User = get_user_model()

AUTHOR_CAPS = [Capability.CREATE_TASKS, Capability.MANAGE_PROJECT]
MANAGE_CAPS = [Capability.MANAGE_PROJECT, Capability.ADMINISTER]


def _has_any(user, caps) -> bool:
    return user.is_superuser or any(user.has_capability(c) for c in caps)


def _doc_url(doc: Document) -> str:
    return f"/projects/{doc.project_id}/documents" if doc.project_id else "/documents"


# --------------------------------------------------------------------------- #
# Documents
# --------------------------------------------------------------------------- #
class DocumentViewSet(viewsets.ModelViewSet):
    queryset = (
        Document.objects.select_related("project", "owner", "current_version", "approved_by")
        .prefetch_related("versions", "versions__uploaded_by")
        .all()
    )
    serializer_class = DocumentSerializer
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    filterset_fields = ["project", "status", "category"]
    search_fields = ["title", "tags"]

    def get_queryset(self):
        visible = visible_projects(self.request.user, Project.objects.all())
        return self.queryset.filter(Q(project__in=visible) | Q(project__isnull=True))

    # -- access helpers ---------------------------------------------------- #
    def _project_from_request(self, request) -> Project | None:
        pid = request.data.get("project")
        if pid in (None, "", "null"):
            return None
        return get_object_or_404(Project, pk=pid)

    def _require_write(self, project) -> None:
        user = self.request.user
        if project is not None and not visible_projects(user, Project.objects.filter(pk=project.pk)).exists():
            raise PermissionDenied("You do not have access to that project.")
        if not _has_any(user, AUTHOR_CAPS):
            raise PermissionDenied("You lack the capability to manage documents.")

    def _add_version(self, doc, upload, request, notes="") -> DocumentVersion:
        version = DocumentVersion.objects.create(
            document=doc,
            version_number=doc.next_version_number(),
            file=upload,
            original_filename=getattr(upload, "name", ""),
            size_bytes=getattr(upload, "size", 0) or 0,
            content_type=getattr(upload, "content_type", "") or "",
            uploaded_by=request.user,
            notes=notes,
        )
        doc.current_version = version
        doc.save(update_fields=["current_version"])
        return version

    def _notify_approvers(self, doc, request) -> None:
        if doc.project_id:
            pool = [
                m.user for m in Membership.objects.filter(project=doc.project).select_related("user")
                if m.user and m.user.has_capability(Capability.APPROVE)
            ]
        else:
            pool = [u for u in User.objects.filter(is_active=True) if u.has_capability(Capability.APPROVE)]
        notify_many(
            pool, exclude=[request.user], event=NotificationEvent.REVIEW_REQUESTED,
            title=f"Approval needed: {doc.title}", project=doc.project, url=_doc_url(doc),
        )

    # -- create / update / delete ----------------------------------------- #
    def create(self, request, *args, **kwargs):
        project = self._project_from_request(request)
        self._require_write(project)
        upload = request.FILES.get("file")
        if upload is None:
            raise ValidationError({"file": "A file is required."})
        doc = Document.objects.create(
            project=project,
            title=request.data.get("title") or upload.name,
            description=request.data.get("description", ""),
            category=request.data.get("category") or DocumentCategory.GENERAL,
            tags=request.data.get("tags", ""),
            expiry_date=request.data.get("expiry_date") or None,
            reminder_lead_days=int(request.data.get("reminder_lead_days") or 30),
            owner=request.user,
        )
        self._add_version(doc, upload, request, notes=request.data.get("notes", ""))
        record(action=AuditAction.CREATE, obj=doc, new_value={"title": doc.title}, request=request)
        return Response(self.get_serializer(doc).data, status=201)

    def perform_update(self, serializer):
        doc = serializer.instance
        self._require_write(doc.project)
        new_expiry = serializer.validated_data.get("expiry_date", doc.expiry_date)
        obj = serializer.save()
        if new_expiry != doc.expiry_date:
            obj.expiry_reminded_at = None
            obj.save(update_fields=["expiry_reminded_at"])
        record(action=AuditAction.UPDATE, obj=obj, request=self.request)

    def perform_destroy(self, instance):
        user = self.request.user
        if not _has_any(user, MANAGE_CAPS):
            raise PermissionDenied("You cannot delete documents.")
        record(action=AuditAction.DELETE, obj=instance, old_value={"title": instance.title}, request=self.request)
        instance.delete()

    # -- actions ----------------------------------------------------------- #
    @action(detail=True, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    def upload_version(self, request, pk=None):
        doc = self.get_object()
        self._require_write(doc.project)
        upload = request.FILES.get("file")
        if upload is None:
            raise ValidationError({"file": "A file is required."})
        version = self._add_version(doc, upload, request, notes=request.data.get("notes", ""))
        # New content invalidates a prior approval — back to draft (§18.3).
        if doc.status == DocumentStatus.APPROVED:
            doc.status = DocumentStatus.DRAFT
            doc.approved_by = None
            doc.approved_at = None
            doc.save(update_fields=["status", "approved_by", "approved_at"])
        record(action=AuditAction.UPDATE, obj=doc, new_value={"version": version.version_number}, request=request)
        return Response(self.get_serializer(doc).data)

    @action(detail=True, methods=["post"])
    def rollback(self, request, pk=None):
        doc = self.get_object()
        self._require_write(doc.project)
        try:
            target = doc.versions.get(pk=request.data.get("version"))
        except DocumentVersion.DoesNotExist:
            raise ValidationError({"version": "Unknown version for this document."})
        old = doc.current_version.version_number if doc.current_version else None
        doc.current_version = target
        doc.save(update_fields=["current_version"])
        record(action=AuditAction.UPDATE, obj=doc, old_value={"current": old},
               new_value={"current": target.version_number, "rollback": True}, request=request)
        return Response(self.get_serializer(doc).data)

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        doc = self.get_object()
        self._require_write(doc.project)
        if doc.status not in (DocumentStatus.DRAFT, DocumentStatus.ARCHIVED):
            raise ValidationError("Only a draft can be submitted for approval.")
        if doc.current_version is None:
            raise ValidationError("Upload a file before submitting for approval.")
        doc.status = DocumentStatus.PENDING
        doc.save(update_fields=["status"])
        self._notify_approvers(doc, request)
        record(action=AuditAction.UPDATE, obj=doc, new_value={"status": doc.status}, request=request)
        return Response(self.get_serializer(doc).data)

    @action(detail=True, methods=["post"])
    def decide(self, request, pk=None):
        doc = self.get_object()
        user = request.user
        if doc.status != DocumentStatus.PENDING:
            raise ValidationError("This document is not awaiting approval.")
        if not (user.is_superuser or user.has_capability(Capability.APPROVE)):
            raise PermissionDenied("You are not an authorised approver.")
        if doc.owner_id == user.id and not user.is_superuser:
            raise PermissionDenied("You cannot approve your own document.")

        decision = request.data.get("decision")
        reason = (request.data.get("reason") or "").strip()
        if decision == "approve":
            doc.status = DocumentStatus.APPROVED
            doc.approved_by = user
            doc.approved_at = timezone.now()
            doc.save(update_fields=["status", "approved_by", "approved_at"])
            audit_action = AuditAction.APPROVE
        elif decision in ("reject", "request_changes"):
            if not reason:
                raise ValidationError({"reason": "A reason is required to reject or request changes."})
            doc.status = DocumentStatus.DRAFT
            doc.save(update_fields=["status"])
            audit_action = AuditAction.REJECT if decision == "reject" else AuditAction.REQUEST_CHANGES
        else:
            raise ValidationError({"decision": "Must be approve, reject or request_changes."})

        if doc.owner:
            notify(doc.owner, NotificationEvent.REVIEW_DECISION,
                   f"Document {doc.get_status_display().lower()}: {doc.title}",
                   body=reason, project=doc.project, url=_doc_url(doc))
        record(action=audit_action, obj=doc, new_value={"decision": decision, "reason": reason}, request=request)
        return Response(self.get_serializer(doc).data)


class DocumentVersionDownloadView(APIView):
    """Stream a version to an authorised user and log the download (§18.5)."""

    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        version = get_object_or_404(
            DocumentVersion.objects.select_related("document", "document__project"), pk=pk
        )
        doc = version.document
        if doc.project_id and not visible_projects(request.user, Project.objects.filter(pk=doc.project_id)).exists():
            raise PermissionDenied("You do not have access to this document.")
        DocumentDownload.objects.create(version=version, user=request.user, source_ip=client_ip(request))
        return FileResponse(
            version.file.open("rb"),
            as_attachment=True,
            filename=version.original_filename or f"document_v{version.version_number}",
        )


# --------------------------------------------------------------------------- #
# SOPs
# --------------------------------------------------------------------------- #
class SOPViewSet(viewsets.ModelViewSet):
    queryset = (
        SOP.objects.select_related("department", "owner", "approved_by")
        .prefetch_related("versions", "versions__published_by")
        .all()
    )
    serializer_class = SOPSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["stage", "department"]
    search_fields = ["code", "title"]

    def perform_create(self, serializer):
        if not _has_any(self.request.user, AUTHOR_CAPS):
            raise PermissionDenied("You are not permitted to author SOPs.")
        sop = serializer.save(owner=self.request.user, stage=SOPStage.RESEARCH)
        record(action=AuditAction.CREATE, obj=sop, request=self.request)

    def perform_update(self, serializer):
        sop = serializer.instance
        if not (self.request.user == sop.owner or _has_any(self.request.user, MANAGE_CAPS)):
            raise PermissionDenied("Only the owner or a manager can edit this SOP.")
        obj = serializer.save()
        record(action=AuditAction.UPDATE, obj=obj, request=self.request)

    def perform_destroy(self, instance):
        if not _has_any(self.request.user, MANAGE_CAPS):
            raise PermissionDenied("You cannot delete SOPs.")
        record(action=AuditAction.DELETE, obj=instance, old_value={"code": instance.code}, request=self.request)
        instance.delete()

    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        sop = self.get_object()
        user = request.user
        to = request.data.get("to")
        reason = (request.data.get("reason") or "").strip()
        if to not in SOPStage.values:
            raise ValidationError({"to": "Unknown stage."})
        if not sop.can_transition_to(to):
            raise ValidationError({"to": f"Cannot move from '{sop.stage}' to '{to}'."})
        self._authorise_transition(sop, to, user)
        self._apply_transition(sop, to, user, reason)
        record(action=AuditAction.WORKFLOW_CHANGE, obj=sop, new_value={"stage": to, "reason": reason}, request=request)
        return Response(self.get_serializer(sop).data)

    def _authorise_transition(self, sop, to, user) -> None:
        author = user == sop.owner or _has_any(user, AUTHOR_CAPS)
        if to == SOPStage.APPROVED:
            if not (user.is_superuser or user.has_capability(Capability.APPROVE)):
                raise PermissionDenied("You are not an authorised approver.")
            if sop.owner_id == user.id and not user.is_superuser:
                raise PermissionDenied("You cannot approve your own SOP.")
        elif to == SOPStage.PUBLISHED:
            if not (_has_any(user, MANAGE_CAPS) or user.has_capability(Capability.APPROVE)):
                raise PermissionDenied("You are not permitted to publish SOPs.")
        elif to == SOPStage.RETIRED:
            if not _has_any(user, MANAGE_CAPS):
                raise PermissionDenied("You are not permitted to retire SOPs.")
        elif not (author or user.has_capability(Capability.APPROVE)):
            raise PermissionDenied("You cannot change this SOP's stage.")

    def _apply_transition(self, sop, to, user, reason) -> None:
        fields = ["stage"]
        sop.stage = to
        if to == SOPStage.APPROVED:
            sop.approved_by = user
            sop.approved_at = timezone.now()
            fields += ["approved_by", "approved_at"]
        elif to == SOPStage.PUBLISHED:
            today = timezone.now().date()
            sop.version_number = (sop.version_number or 0) + 1
            sop.published_at = timezone.now()
            sop.effective_date = today
            sop.next_review_date = add_months(today, sop.review_interval_months or 12)
            sop.review_reminded_at = None
            fields += ["version_number", "published_at", "effective_date", "next_review_date", "review_reminded_at"]
            SOPVersion.objects.create(
                sop=sop, version_number=sop.version_number, content=sop.content,
                change_summary=reason, published_by=user,
            )
        elif to == SOPStage.REVIEW:
            sop.review_reminded_at = None
            fields += ["review_reminded_at"]
        sop.save(update_fields=fields)

        if to == SOPStage.REVIEW:
            pool = [u for u in User.objects.filter(is_active=True) if u.has_capability(Capability.APPROVE)]
            notify_many(pool, exclude=[user], event=NotificationEvent.REVIEW_REQUESTED,
                        title=f"SOP review requested: {sop.code} — {sop.title}", url="/sops")
        elif to in (SOPStage.APPROVED, SOPStage.PUBLISHED) and sop.owner:
            notify(sop.owner, NotificationEvent.REVIEW_DECISION,
                   f"SOP {sop.get_stage_display().lower()}: {sop.code}", url="/sops")
