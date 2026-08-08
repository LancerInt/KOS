"""AI REST API.

Every endpoint here obeys two rules from the specification:

* **The frontend never calls the AI provider.** It calls these endpoints; the
  server holds the key and makes the outbound call.
* **AI never widens access.** Each endpoint resolves its subject through the
  same visibility rules as the rest of KOS (``visible_projects`` and friends),
  so nobody can read a confidential project by asking the assistant to
  summarise it.

Endpoints that *change* ERP data (applying subtasks, creating tasks from notes)
are separate from the ones that generate suggestions. Generation is always a
preview; the user confirms before anything is written.
"""
from __future__ import annotations

import logging

from django.contrib.auth import get_user_model
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsAdministrator
from apps.accounts.rbac import Capability
from apps.audit.models import AuditAction
from apps.audit.services import record
from apps.projects.models import Project
from apps.projects.scoping import lookup_queryset, visible_projects
from apps.tasks.models import Task

from . import context as ctx
from . import service
from .models import (
    AIAutomationLog,
    AIConversation,
    AIMessage,
    AIReport,
    AIRequestLog,
    AISettings,
    AIAction,
    DailyStandup,
    ExecutiveSummary,
    GenerationTrigger,
    OutboundEmail,
)
from .serializers import (
    AIAutomationLogSerializer,
    AIConversationListSerializer,
    AIConversationSerializer,
    AIReportSerializer,
    AIRequestLogSerializer,
    AIOutcomeSerializer,
    AISettingsSerializer,
    AIStatusSerializer,
    ApplySubtasksSerializer,
    ChatSerializer,
    CreateTasksSerializer,
    CustomerReplySerializer,
    DailyStandupListSerializer,
    DailyStandupSerializer,
    EmailSerializer,
    ExecutiveEmailSerializer,
    ExecutiveSummaryListSerializer,
    ExecutiveSummaryRequestSerializer,
    ExecutiveSummarySerializer,
    GoalSerializer,
    JobDescriptionSerializer,
    MetricsSerializer,
    NotesSerializer,
    OutboundEmailSerializer,
    PerformanceSerializer,
    ProposalSerializer,
    ReportRequestSerializer,
    RewriteSerializer,
    SendEmailSerializer,
    StandupRequestSerializer,
    SubtaskCountSerializer,
    SummarizeSerializer,
    TextInputSerializer,
    TranslateSerializer,
    WorkspaceScaffoldSerializer,
)
from .service import AIUnavailable

logger = logging.getLogger(__name__)
User = get_user_model()

CONVERSATION_HISTORY_LIMIT = 20


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def envelope(outcome: service.AIOutcome, action: str) -> Response:
    """The single response shape every AI endpoint returns."""
    return Response({
        "ok": True,
        "action": action,
        "data": outcome.data,
        "text": outcome.text,
        "structured": outcome.structured,
        "provider": outcome.provider,
        "model": outcome.model,
        "log_id": outcome.log_id,
    })


def unavailable(exc: AIUnavailable) -> Response:
    """AI outages are a 503 with a readable message, never a stack trace."""
    return Response(
        {"ok": False, "detail": str(exc)},
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
    )


def validated(serializer_class, request):
    serializer = serializer_class(data=request.data)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


def ai_endpoint(request_serializer=None, *, responses=AIOutcomeSerializer):
    """Document an AI endpoint for the OpenAPI schema.

    These are plain ``APIView``s — there is no queryset for drf-spectacular to
    introspect — so without this they would be silently dropped from
    ``/api/docs/``. One decorator per view keeps the schema honest.
    """

    def decorate(cls):
        cls.post = extend_schema(request=request_serializer, responses=responses)(cls.post)
        return cls

    return decorate


def get_project(user, pk) -> Project:
    """A project the user is actually allowed to see, or 404."""
    return get_object_or_404(visible_projects(user, Project.objects.all()), pk=pk)


def get_task(user, pk) -> Task:
    """A task the user may see.

    A task inside a confidential project the user is not a member of must 404,
    not 403 — a 403 would confirm it exists (§7.6). ``lookup_queryset`` already
    encodes that distinction, so reuse it rather than re-deriving it.
    """
    task = get_object_or_404(
        Task.objects.select_related("project").filter(project__in=lookup_queryset(user)), pk=pk
    )
    if not visible_projects(user, Project.objects.filter(pk=task.project_id)).exists():
        raise PermissionDenied("You do not have access to this task.")
    return task


class AIView(APIView):
    """Base class: authenticated, and AI failures become a clean 503."""

    permission_classes = [IsAuthenticated]

    def handle_exception(self, exc):
        if isinstance(exc, AIUnavailable):
            return unavailable(exc)
        return super().handle_exception(exc)


# --------------------------------------------------------------------------- #
# Status & settings
# --------------------------------------------------------------------------- #
class AIStatusView(AIView):
    """What the assistant panel checks before offering AI actions."""

    @extend_schema(responses=AIStatusSerializer)
    def get(self, request: Request) -> Response:
        return Response(service.provider_status())


class AISettingsView(APIView):
    """Read and update AI configuration. Administrators only."""

    permission_classes = [IsAuthenticated, IsAdministrator]

    @extend_schema(responses=AISettingsSerializer)
    def get(self, request: Request) -> Response:
        config = AISettings.load()
        return Response({
            **AISettingsSerializer(config).data,
            "status": service.provider_status(),
        })

    @extend_schema(request=AISettingsSerializer, responses=AISettingsSerializer)
    def put(self, request: Request) -> Response:
        config = AISettings.load()
        serializer = AISettingsSerializer(config, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        before = AISettingsSerializer(config).data
        serializer.save(updated_by=request.user)
        record(
            action=AuditAction.UPDATE, obj=config, old_value=before,
            new_value=serializer.data, reason="AI settings updated", request=request,
        )
        return Response({**serializer.data, "status": service.provider_status()})


# --------------------------------------------------------------------------- #
# Assistant: chat and generic text tools
# --------------------------------------------------------------------------- #
@ai_endpoint(ChatSerializer)
class AIChatView(AIView):
    """The assistant panel's conversation endpoint.

    Threads are persisted so the drawer survives a page reload, and history is
    capped so a long-running thread cannot grow the prompt without bound.
    """

    def post(self, request: Request) -> Response:
        data = validated(ChatSerializer, request)

        conversation = None
        if data.get("conversation_id"):
            conversation = get_object_or_404(
                AIConversation, pk=data["conversation_id"], user=request.user
            )

        history = []
        if conversation:
            recent = list(conversation.messages.all())[-CONVERSATION_HISTORY_LIMIT:]
            history = [{"role": m.role, "content": m.content} for m in recent]

        page_context = data.get("page_context") or ""
        if data.get("project_id"):
            project = get_project(request.user, data["project_id"])
            page_context = f"{ctx.project_context(project, task_limit=20)}\n\n{page_context}".strip()

        outcome = service.chat(
            data["message"], history=history, context=page_context, user=request.user
        )

        if conversation is None:
            project = None
            if data.get("project_id"):
                project = get_project(request.user, data["project_id"])
            conversation = AIConversation.objects.create(
                user=request.user,
                # The first question makes a better thread title than anything generated.
                title=data["message"][:80],
                page_path=data.get("page_path", ""),
                project=project,
            )
        AIMessage.objects.create(
            conversation=conversation, role=AIMessage.Role.USER, content=data["message"]
        )
        AIMessage.objects.create(
            conversation=conversation, role=AIMessage.Role.ASSISTANT, content=outcome.text
        )
        conversation.save(update_fields=["updated_at"])

        response = envelope(outcome, AIAction.CHAT)
        response.data["conversation_id"] = conversation.id
        return response


class AIConversationViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet
):
    permission_classes = [IsAuthenticated]
    queryset = AIConversation.objects.none()  # real scoping happens in get_queryset()

    def get_queryset(self):
        return AIConversation.objects.filter(user=self.request.user).prefetch_related("messages")

    def get_serializer_class(self):
        return AIConversationListSerializer if self.action == "list" else AIConversationSerializer


@ai_endpoint(SummarizeSerializer)
class AISummarizeView(AIView):
    def post(self, request: Request) -> Response:
        data = validated(SummarizeSerializer, request)
        outcome = service.summarize(
            data["text"], style=data["style"], audience=data["audience"],
            instructions=data["instructions"], user=request.user,
        )
        return envelope(outcome, AIAction.SUMMARIZE)


@ai_endpoint(RewriteSerializer)
class AIRewriteView(AIView):
    def post(self, request: Request) -> Response:
        data = validated(RewriteSerializer, request)
        outcome = service.rewrite(
            data["text"], instruction=data["instruction"], tone=data["tone"], user=request.user
        )
        return envelope(outcome, AIAction.REWRITE)


@ai_endpoint(TextInputSerializer)
class AIGrammarView(AIView):
    def post(self, request: Request) -> Response:
        data = validated(TextInputSerializer, request)
        return envelope(service.improve_grammar(data["text"], user=request.user), AIAction.REWRITE)


@ai_endpoint(TranslateSerializer)
class AITranslateView(AIView):
    def post(self, request: Request) -> Response:
        data = validated(TranslateSerializer, request)
        outcome = service.translate(data["text"], language=data["language"], user=request.user)
        return envelope(outcome, AIAction.TRANSLATE)


@ai_endpoint(EmailSerializer)
class AIEmailView(AIView):
    def post(self, request: Request) -> Response:
        data = validated(EmailSerializer, request)

        context = data["context"]
        subject = None
        if data.get("project_id"):
            subject = get_project(request.user, data["project_id"])
            context = f"{ctx.project_context(subject, task_limit=20)}\n\n{context}".strip()
        elif data.get("task_id"):
            subject = get_task(request.user, data["task_id"])
            context = f"{ctx.task_detail(subject)}\n\n{context}".strip()

        outcome = service.generate_email(
            data["purpose"], context=context, tone=data["tone"], recipient=data["recipient"],
            sender=request.user.get_full_name() or request.user.username,
            language=data["language"], user=request.user, subject=subject,
        )
        return envelope(outcome, AIAction.GENERATE_EMAIL)


class AIEmailSendView(AIView):
    """Send a composed email out of KOS — to Gmail or any other mailbox.

    Deliberately a separate endpoint from ``generate-email``. Generating is
    free to repeat and changes nothing; sending is irreversible and leaves the
    building. Keeping them apart is what guarantees the rule the rest of this
    module follows — **nothing is ever sent without the user seeing it first** —
    because the only way to reach this endpoint is to post the text back.

    The body is whatever the user approved on screen. This endpoint never
    regenerates or edits it.
    """

    @extend_schema(request=SendEmailSerializer, responses=OutboundEmailSerializer)
    def post(self, request: Request) -> Response:
        from .outbound import EmailRejected, prepare
        from .tasks import send_outbound_email

        data = validated(SendEmailSerializer, request)

        # Resolve the linked records through the same visibility rules as
        # everything else: attaching an email to a project must not become a way
        # to discover that a confidential project exists.
        project = get_project(request.user, data["project_id"]) if data.get("project_id") else None
        task = get_task(request.user, data["task_id"]) if data.get("task_id") else None
        if task is not None and project is None:
            project = task.project

        try:
            email = prepare(
                to=data["to"], cc=data["cc"], bcc=data["bcc"],
                reply_to=data["reply_to"],
                subject=data["subject"], body=data["body"],
                sender=request.user,
                source=OutboundEmail.Source.MANUAL,
                task=task, project=project,
                draft_log_id=data.get("draft_log_id"),
            )
        except EmailRejected as exc:
            # A rejected message is the user's input being wrong or a limit being
            # hit — a 400 with the reason, not a 500 and not a silent no-op.
            raise ValidationError({"detail": str(exc)}) from None

        # Mail sent from KOS is the organisation speaking to the outside world.
        # Who sent what, to whom — including the blind copies — is recorded
        # before the message is handed to the worker.
        record(
            action=AuditAction.UPDATE, obj=email,
            new_value={
                "to": email.to, "cc": email.cc, "bcc": email.bcc,
                "subject": email.subject, "task": email.task_id, "project": email.project_id,
            },
            reason="Email sent from KOS", request=request,
        )

        # SMTP can take seconds. Hand it to a worker, and fall back to sending
        # inline when no broker is reachable — a slow response beats telling
        # someone their email failed because a queue is down.
        if not queued(send_outbound_email, email.id):
            from .outbound import send

            send(email)
            email.refresh_from_db()

        return Response(
            OutboundEmailSerializer(email).data,
            status=status.HTTP_202_ACCEPTED if email.status == "queued" else status.HTTP_201_CREATED,
        )


class OutboundEmailViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """The sent-mail record.

    Scoped like the automation log: administrators see everything, everyone else
    sees what they sent themselves plus what went out about projects they can
    already see. A user must not be able to read mail sent about a project they
    have no access to simply because it exists.
    """

    permission_classes = [IsAuthenticated]
    serializer_class = OutboundEmailSerializer
    queryset = OutboundEmail.objects.none()
    filterset_fields = ["status", "source", "project", "task"]

    def get_queryset(self):
        from django.db.models import Q

        user = self.request.user
        qs = OutboundEmail.objects.select_related("sender", "task", "project")
        if user.is_superuser or user.has_capability(Capability.ADMINISTER):
            return qs
        projects = visible_projects(user, Project.objects.all())
        return qs.filter(
            Q(sender=user) | Q(project__in=projects) | Q(task__project__in=projects)
        ).distinct()

    @extend_schema(request=None, responses=OutboundEmailSerializer)
    @action(detail=True, methods=["post"])
    def resend(self, request: Request, pk=None):
        """Try a failed message again.

        Only failures are resendable — offering it on a message that already
        went out would make sending the same email twice a single click away.
        """
        from .outbound import send

        email = self.get_object()
        if email.status != "failed":
            raise ValidationError("Only a failed email can be resent.")
        if email.sender_id != request.user.id and not (
            request.user.is_superuser or request.user.has_capability(Capability.ADMINISTER)
        ):
            raise PermissionDenied("You can only resend an email you sent.")

        send(email)
        record(
            action=AuditAction.UPDATE, obj=email,
            new_value={"status": email.status, "attempts": email.attempts},
            reason="Failed email resent", request=request,
        )
        return Response(OutboundEmailSerializer(email).data)


# --------------------------------------------------------------------------- #
# Projects
# --------------------------------------------------------------------------- #
class ProjectAIView(AIView):
    """Base for the per-project actions — resolves and access-checks the project."""

    def project(self, request, pk) -> Project:
        return get_project(request.user, pk)


@ai_endpoint(None)
class ProjectSummaryView(ProjectAIView):
    def post(self, request: Request, pk: int) -> Response:
        outcome = service.project_summary(self.project(request, pk), user=request.user)
        return envelope(outcome, AIAction.PROJECT_SUMMARY)


@ai_endpoint(None)
class ProjectRisksView(ProjectAIView):
    def post(self, request: Request, pk: int) -> Response:
        outcome = service.analyse_risks(self.project(request, pk), user=request.user)
        return envelope(outcome, AIAction.RISK_ANALYSIS)


@ai_endpoint(None)
class ProjectDelayView(ProjectAIView):
    def post(self, request: Request, pk: int) -> Response:
        outcome = service.predict_delay(self.project(request, pk), user=request.user)
        return envelope(outcome, AIAction.DELAY_PREDICTION)


@ai_endpoint(None)
class ProjectHealthView(ProjectAIView):
    def post(self, request: Request, pk: int) -> Response:
        outcome = service.health_score(self.project(request, pk), user=request.user)
        return envelope(outcome, AIAction.HEALTH_SCORE)


@ai_endpoint(GoalSerializer)
class ProjectAnalyseView(ProjectAIView):
    def post(self, request: Request, pk: int) -> Response:
        data = validated(GoalSerializer, request)
        outcome = service.analyse_project(
            self.project(request, pk), goal=data["goal"], user=request.user
        )
        return envelope(outcome, AIAction.ANALYSE_PROJECT)


@ai_endpoint(None)
class ProjectExplainView(ProjectAIView):
    """"Explain this project" — a narrative for someone new to it."""

    def post(self, request: Request, pk: int) -> Response:
        project = self.project(request, pk)
        outcome = service.summarize(
            ctx.project_context(project),
            style="an explanation for someone who has never seen this project before",
            audience="a colleague joining the project today",
            user=request.user, subject=project, action=AIAction.PROJECT_SUMMARY,
        )
        return envelope(outcome, AIAction.PROJECT_SUMMARY)


@ai_endpoint(GoalSerializer)
class ProjectTaskAnalysisView(ProjectAIView):
    def post(self, request: Request, pk: int) -> Response:
        project = self.project(request, pk)
        data = validated(GoalSerializer, request)
        tasks = [
            t for t in project.tasks.prefetch_related("owners", "blockers").select_related("project")
            if not ctx.is_closed(t.status)
        ]
        outcome = service.analyse_tasks(
            tasks, goal=data["goal"], user=request.user, subject=project
        )
        return envelope(outcome, AIAction.ANALYSE_TASKS)


@ai_endpoint(None)
class ProjectDuplicatesView(ProjectAIView):
    def post(self, request: Request, pk: int) -> Response:
        project = self.project(request, pk)
        tasks = [
            t for t in project.tasks.prefetch_related("owners", "blockers").select_related("project")
            if not ctx.is_closed(t.status)
        ]
        return envelope(service.detect_duplicates(tasks, user=request.user), AIAction.DUPLICATE_DETECTION)


@ai_endpoint(None)
class ProjectWorkloadView(ProjectAIView):
    def post(self, request: Request, pk: int) -> Response:
        project = self.project(request, pk)
        members = [m.user for m in project.memberships.select_related("user")]
        if not members:
            raise ValidationError("This project has no members to balance work across.")
        return envelope(service.balance_workload(members, user=request.user), AIAction.WORKLOAD)


# --------------------------------------------------------------------------- #
# Tasks
# --------------------------------------------------------------------------- #
class TaskAIView(AIView):
    def task(self, request, pk) -> Task:
        return get_task(request.user, pk)


@ai_endpoint(None)
class TaskRewriteView(TaskAIView):
    def post(self, request: Request, pk: int) -> Response:
        task = self.task(request, pk)
        if not (task.description or "").strip():
            raise ValidationError("This task has no description to rewrite.")
        outcome = service.rewrite(
            task.description,
            instruction="This is an ERP task description. Make it unambiguous about what must be "
                        "done and what 'done' looks like.",
            user=request.user,
        )
        return envelope(outcome, AIAction.REWRITE)


@ai_endpoint(SubtaskCountSerializer)
class TaskSubtasksView(TaskAIView):
    def post(self, request: Request, pk: int) -> Response:
        data = validated(SubtaskCountSerializer, request)
        outcome = service.generate_subtasks(
            self.task(request, pk), count=data["count"], user=request.user
        )
        return envelope(outcome, AIAction.SUBTASKS)


@ai_endpoint(ApplySubtasksSerializer, responses=None)
class TaskApplySubtasksView(TaskAIView):
    """Write the subtasks the user approved. Separate from generation on purpose:
    the AI proposes, the user disposes, and only this call mutates ERP data."""

    def post(self, request: Request, pk: int) -> Response:
        from apps.tasks.models import Subtask

        task = self.task(request, pk)
        if not request.user.has_capability(Capability.CREATE_TASKS):
            raise PermissionDenied("You do not have permission to create tasks.")

        data = validated(ApplySubtasksSerializer, request)
        start = task.subtasks.count()
        created = [
            Subtask.objects.create(task=task, title=title.strip()[:300], order=start + index)
            for index, title in enumerate(data["subtasks"], start=1)
            if title.strip()
        ]
        record(
            action=AuditAction.CREATE, obj=task,
            new_value={"subtasks": [s.title for s in created]},
            reason="AI-generated subtasks accepted", request=request,
        )
        return Response(
            {"ok": True, "created": len(created),
             "subtasks": [{"id": s.id, "title": s.title} for s in created]},
            status=status.HTTP_201_CREATED,
        )


@ai_endpoint(None)
class TaskEstimateView(TaskAIView):
    def post(self, request: Request, pk: int) -> Response:
        return envelope(service.estimate_effort(self.task(request, pk), user=request.user), AIAction.ESTIMATE)


@ai_endpoint(None)
class TaskPrioritizeView(TaskAIView):
    def post(self, request: Request, pk: int) -> Response:
        return envelope(service.prioritize(self.task(request, pk), user=request.user), AIAction.PRIORITIZE)


@ai_endpoint(None)
class TaskSummaryView(TaskAIView):
    def post(self, request: Request, pk: int) -> Response:
        task = self.task(request, pk)
        outcome = service.summarize(
            ctx.task_detail(task), style="brief", audience="the task owner",
            user=request.user, subject=task,
        )
        return envelope(outcome, AIAction.SUMMARIZE)


# --------------------------------------------------------------------------- #
# Meetings & notes
# --------------------------------------------------------------------------- #
@ai_endpoint(NotesSerializer)
class MeetingSummaryView(AIView):
    def post(self, request: Request) -> Response:
        data = validated(NotesSerializer, request)
        subject = get_project(request.user, data["project_id"]) if data.get("project_id") else None
        outcome = service.meeting_summary(
            data["notes"], context=data["context"], user=request.user, subject=subject
        )
        return envelope(outcome, AIAction.MEETING_SUMMARY)


@ai_endpoint(NotesSerializer)
class ExtractTasksView(AIView):
    """Propose tasks from notes. Nothing is written until :class:`CreateTasksView`."""

    def post(self, request: Request) -> Response:
        data = validated(NotesSerializer, request)
        context = data["context"]
        subject = None
        if data.get("project_id"):
            subject = get_project(request.user, data["project_id"])
            context = f"{ctx.people_context(subject)}\n{context}".strip()
        outcome = service.create_tasks_from_notes(
            data["notes"], context=context, user=request.user, subject=subject
        )
        return envelope(outcome, AIAction.CREATE_TASKS_FROM_NOTES)


@ai_endpoint(CreateTasksSerializer, responses=None)
class CreateTasksView(AIView):
    """Create the tasks the user confirmed."""

    def post(self, request: Request) -> Response:
        from datetime import timedelta

        from django.utils import timezone

        from apps.projects.models import Priority
        from apps.tasks.models import Subtask

        data = validated(CreateTasksSerializer, request)
        project = get_project(request.user, data["project_id"])
        if not request.user.has_capability(Capability.CREATE_TASKS):
            raise PermissionDenied("You do not have permission to create tasks.")

        today = timezone.localdate()
        valid_priorities = {p.value for p in Priority}
        members = {
            (m.user.get_full_name() or m.user.username).lower(): m.user
            for m in project.memberships.select_related("user")
        }

        created = []
        for draft in data["tasks"]:
            title = str(draft.get("title") or "").strip()
            if not title:
                continue

            priority = str(draft.get("priority") or "").lower()
            due_date = None
            try:
                due_in = int(draft.get("due_in_days") or 0)
                if due_in > 0:
                    due_date = today + timedelta(days=due_in)
            except (TypeError, ValueError):
                due_date = None

            task = Task.objects.create(
                title=title[:300],
                project=project,
                description=str(draft.get("description") or "")[:5000],
                deliverable=str(draft.get("deliverable") or "")[:2000],
                priority=priority if priority in valid_priorities else Priority.MEDIUM,
                due_date=due_date,
                created_by=request.user,
            )

            # Only honour an owner hint that maps to a real project member.
            owner = members.get(str(draft.get("owner_hint") or "").strip().lower())
            if owner is not None:
                task.owners.add(owner)
                task.primary_owner = owner
                task.save(update_fields=["primary_owner"])

            for index, sub in enumerate(draft.get("subtasks") or [], start=1):
                if str(sub).strip():
                    Subtask.objects.create(task=task, title=str(sub).strip()[:300], order=index)

            created.append(task)

        record(
            action=AuditAction.CREATE, obj=project,
            new_value={"tasks": [t.title for t in created]},
            reason="Tasks created from AI-extracted notes", request=request,
        )
        return Response(
            {"ok": True, "created": len(created),
             "tasks": [{"id": t.id, "title": t.title} for t in created]},
            status=status.HTTP_201_CREATED,
        )


# --------------------------------------------------------------------------- #
# Workspaces — build a project structure from a prompt
# --------------------------------------------------------------------------- #
_SCAFFOLD_FIELD_TYPES = {"text", "paragraph", "dropdown", "radio", "checkbox", "number", "date", "file"}


def _clean_scaffold(data: dict) -> dict:
    """Coerce the model's plan into the exact shape the workspace endpoints expect
    — valid field types, options only where they belong, no empty labels."""
    sections = []
    for raw in (data.get("sections") or [])[:12]:
        if not isinstance(raw, dict):
            continue
        fields = []
        for f in (raw.get("fields") or [])[:20]:
            if not isinstance(f, dict):
                continue
            label = str(f.get("label") or "").strip()
            if not label:
                continue
            ftype = str(f.get("type") or "").strip().lower()
            if ftype not in _SCAFFOLD_FIELD_TYPES:
                ftype = "text"
            field = {"type": ftype, "label": label[:120], "required": str(f.get("required")).lower() in ("true", "1")}
            if ftype in ("dropdown", "radio", "checkbox"):
                opts = [str(o).strip() for o in (f.get("options") or []) if str(o).strip()][:8]
                field["options"] = opts or ["Option 1", "Option 2"]
            fields.append(field)
        name = str(raw.get("name") or "").strip()
        if name:
            sections.append({"name": name[:120], "blurb": str(raw.get("blurb") or "").strip()[:300], "fields": fields})
    return {"project_name": (str(data.get("project_name") or "").strip()[:120] or "New project"), "sections": sections}


@ai_endpoint(WorkspaceScaffoldSerializer)
class WorkspaceScaffoldView(AIView):
    """Propose a project + sections + typed fields from a prompt. Writes nothing —
    the browser confirms, then calls the normal project/section create endpoints."""

    def post(self, request: Request) -> Response:
        from apps.workspaces.access import can_edit

        data = validated(WorkspaceScaffoldSerializer, request)
        if not can_edit(request.user, data["workspace"]):
            raise PermissionDenied("You need edit access to this workspace to build a project in it.")
        outcome = service.scaffold_workspace(
            data["prompt"], workspace_label=data.get("workspace_label", ""), user=request.user
        )
        outcome.data = _clean_scaffold(outcome.data if isinstance(outcome.data, dict) else {})
        return envelope(outcome, AIAction.WORKSPACE_SCAFFOLD)


@ai_endpoint(None)
class WorkspaceSuggestView(AIView):
    """Propose a new workspace's identity (label, blurb, icon, accent) from a
    prompt. Anyone may create a workspace, so this needs no extra gate. Writes
    nothing — the browser confirms via the normal workspace create endpoint."""

    def post(self, request: Request) -> Response:
        import re

        prompt = (request.data.get("prompt") or "").strip()
        if not prompt:
            raise ValidationError({"prompt": "Describe the workspace you want."})
        outcome = service.suggest_workspace(prompt, user=request.user)
        d = outcome.data if isinstance(outcome.data, dict) else {}
        icon = str(d.get("icon") or "").strip().lower()
        if icon not in service.WORKSPACE_ICON_NAMES:
            icon = "folder"
        accent = str(d.get("accent") or "").strip()
        if not re.match(r"^#[0-9a-fA-F]{6}$", accent):
            accent = service.WORKSPACE_ACCENTS[len(str(d.get("label") or "")) % len(service.WORKSPACE_ACCENTS)]
        outcome.data = {
            "label": str(d.get("label") or "").strip()[:120],
            "blurb": str(d.get("blurb") or "").strip()[:300],
            "icon": icon,
            "accent": accent,
        }
        return envelope(outcome, AIAction.WORKSPACE_SCAFFOLD)


# --------------------------------------------------------------------------- #
# CRM
# --------------------------------------------------------------------------- #
class CustomerAIView(AIView):
    def customer(self, pk):
        from apps.crm.models import Customer

        return get_object_or_404(Customer.objects.prefetch_related("contacts", "opportunities"), pk=pk)


@ai_endpoint(None)
class CustomerSummaryView(CustomerAIView):
    def post(self, request: Request, pk: int) -> Response:
        outcome = service.customer_summary(self.customer(pk), user=request.user)
        return envelope(outcome, AIAction.CUSTOMER_SUMMARY)


@ai_endpoint(CustomerReplySerializer)
class CustomerReplyView(CustomerAIView):
    def post(self, request: Request, pk: int) -> Response:
        data = validated(CustomerReplySerializer, request)
        outcome = service.draft_customer_reply(
            self.customer(pk), incoming_message=data["incoming_message"],
            intent=data["intent"], tone=data["tone"], user=request.user,
        )
        return envelope(outcome, AIAction.DRAFT_REPLY)


@ai_endpoint(ProposalSerializer)
class CustomerProposalView(CustomerAIView):
    def post(self, request: Request, pk: int) -> Response:
        from apps.crm.models import Opportunity

        data = validated(ProposalSerializer, request)
        customer = self.customer(pk)
        opportunity = None
        if data.get("opportunity_id"):
            opportunity = get_object_or_404(
                Opportunity, pk=data["opportunity_id"], customer=customer
            )
        outcome = service.generate_proposal(
            customer, brief=data["brief"], opportunity=opportunity, user=request.user
        )
        return envelope(outcome, AIAction.PROPOSAL)


# --------------------------------------------------------------------------- #
# HR
# --------------------------------------------------------------------------- #
@ai_endpoint(JobDescriptionSerializer)
class JobDescriptionView(AIView):
    def post(self, request: Request) -> Response:
        data = validated(JobDescriptionSerializer, request)
        outcome = service.job_description(
            role_title=data["role_title"], department=data["department"],
            seniority=data["seniority"], requirements=data["requirements"], user=request.user,
        )
        return envelope(outcome, AIAction.JOB_DESCRIPTION)


@ai_endpoint(PerformanceSerializer)
class PerformanceSummaryView(AIView):
    """A performance summary about another person is management information —
    gated on the reports capability rather than plain authentication."""

    def post(self, request: Request) -> Response:
        data = validated(PerformanceSerializer, request)
        subject_user = get_object_or_404(User, pk=data["user_id"])

        if subject_user != request.user and not request.user.has_capability(Capability.VIEW_REPORTS):
            raise PermissionDenied("You do not have permission to review another person's performance.")

        outcome = service.performance_summary(
            subject_user, period_label=data["period_label"], notes=data["notes"], user=request.user
        )
        return envelope(outcome, AIAction.PERFORMANCE_SUMMARY)


# --------------------------------------------------------------------------- #
# Dashboard
# --------------------------------------------------------------------------- #
def _workspace_project_metrics(user) -> dict:
    """The figures the Dashboard screen itself shows.

    The dashboard lists **workspace** projects, and those live in a different
    model from the ``Project``/``Task`` pair the rest of this module analyses.
    Reading only the latter is what made the panel report "0 active projects"
    to someone looking at thirteen of them — the two counts were never the same
    thing. Scoped with the workspaces app's own rule so the AI cannot describe a
    project the viewer is not allowed to see.
    """
    from apps.workspaces.models import WorkspaceProject
    from apps.workspaces.views import _scope_to_viewable

    rows = list(_scope_to_viewable(
        WorkspaceProject.objects.filter(deleted_at__isnull=True), user))
    status_of = [(p.duration_state() or {}).get("status", "none") for p in rows]
    return {
        "dashboard_projects": len(rows),
        "dashboard_overdue_projects": status_of.count("due"),
        "dashboard_ending_soon_projects": status_of.count("ending_soon"),
        "dashboard_in_progress_projects": status_of.count("active"),
        "dashboard_completed_projects": status_of.count("completed"),
    }


def _dashboard_metrics(user, project=None) -> dict:
    """Figures for the dashboard AI actions.

    Scoped to what the user can see, so the explanation matches the numbers on
    their own screen.
    """
    if project is not None:
        return ctx.project_metrics(project)

    from django.utils import timezone

    today = timezone.localdate()
    projects = visible_projects(user, Project.objects.all())
    tasks = list(
        Task.objects.filter(project__in=projects).exclude(status="archived")
        .prefetch_related("blockers", "owners")
    )
    open_tasks = [t for t in tasks if not ctx.is_closed(t.status)]
    # Read the prefetched owners rather than querying once per task.
    mine = [t for t in open_tasks if any(o.pk == user.pk for o in t.owners.all())]

    figures = {
        "visible_projects": projects.count(),
        "active_projects": projects.filter(status="active").count(),
        "at_risk_projects": projects.filter(status="at_risk").count(),
        "total_open_tasks": len(open_tasks),
        "overdue_tasks": len([t for t in open_tasks if t.due_date and t.due_date < today]),
        "due_today": len([t for t in open_tasks if t.due_date == today]),
        "blocked_tasks": len([t for t in open_tasks if ctx.has_open_blocker(t)]),
        "critical_tasks": len([t for t in open_tasks if t.priority == "critical"]),
        "unassigned_tasks": len([t for t in open_tasks if not t.owners.all()]),
        "my_open_tasks": len(mine),
        "my_overdue_tasks": len([t for t in mine if t.due_date and t.due_date < today]),
    }
    # The Project/Task subsystem is optional — an installation that works
    # entirely in workspaces has nothing in it. Sending a row of zeros beside
    # thirteen real workspace projects is worse than sending nothing: the model
    # believes the zeros and answers "no current project activity", which is
    # exactly what the deployed dashboard reported to someone looking at a
    # screen full of overdue work.
    if not (figures["visible_projects"] or figures["total_open_tasks"]):
        figures = {}
    return {**figures, **_workspace_project_metrics(user)}


@ai_endpoint(MetricsSerializer)
class DashboardInsightsView(AIView):
    def post(self, request: Request) -> Response:
        data = validated(MetricsSerializer, request)
        project = get_project(request.user, data["project_id"]) if data.get("project_id") else None
        metrics = data.get("metrics") or _dashboard_metrics(request.user, project)
        return envelope(service.dashboard_insights(metrics, user=request.user), AIAction.INSIGHTS)


@ai_endpoint(MetricsSerializer)
class DashboardExplainView(AIView):
    def post(self, request: Request) -> Response:
        data = validated(MetricsSerializer, request)
        project = get_project(request.user, data["project_id"]) if data.get("project_id") else None
        metrics = data.get("metrics") or _dashboard_metrics(request.user, project)
        outcome = service.explain_statistics(metrics, question=data["question"], user=request.user)
        return envelope(outcome, AIAction.EXPLAIN_STATS)


@ai_endpoint(None)
class DailyRecommendationsView(AIView):
    """"What should I do today?" — grounded in the user's own open work."""

    def post(self, request: Request) -> Response:
        tasks = [
            t for t in Task.objects.filter(owners=request.user).exclude(status="archived")
            .select_related("project").prefetch_related("owners", "blockers").distinct()
            if not ctx.is_closed(t.status)
        ]
        if not tasks:
            return Response({
                "ok": True, "action": AIAction.PRIORITIZE, "structured": True,
                "data": {"recommended_order": [], "reasoning": "You have no open tasks."},
                "text": "", "provider": "", "model": "", "log_id": None,
            })
        return envelope(service.prioritize(tasks=tasks, user=request.user), AIAction.PRIORITIZE)


# --------------------------------------------------------------------------- #
# Reports
# --------------------------------------------------------------------------- #
class AIReportViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Generated reports. Users see their own; report-viewers see org-wide ones."""

    serializer_class = AIReportSerializer
    permission_classes = [IsAuthenticated]
    queryset = AIReport.objects.none()  # real scoping happens in get_queryset()
    filterset_fields = ["period", "project"]

    def get_queryset(self):
        user = self.request.user
        qs = AIReport.objects.all()
        if user.is_superuser or user.has_capability(Capability.VIEW_REPORTS):
            return qs.filter(user__isnull=True) | qs.filter(user=user)
        return qs.filter(user=user)


@ai_endpoint(ReportRequestSerializer)
class GenerateReportView(AIView):
    """Generate a report on demand rather than waiting for the schedule."""

    def post(self, request: Request) -> Response:
        from datetime import timedelta

        from django.utils import timezone

        from .models import AIReport as Report
        from .models import ReportPeriod
        from .tasks import _org_metrics

        data = validated(ReportRequestSerializer, request)
        if not request.user.has_capability(Capability.VIEW_REPORTS):
            raise PermissionDenied("You do not have permission to generate reports.")

        end = timezone.localdate()
        spans = {"daily": 1, "weekly": 7, "monthly": 30}
        period = data["period"]
        start = end - timedelta(days=spans[period])

        project = get_project(request.user, data["project_id"]) if data.get("project_id") else None
        if project is not None:
            metrics = ctx.project_metrics(project)
            body = ctx.project_context(project)
        else:
            metrics = _org_metrics(start, end)
            body = ""

        outcome = service.generate_report(
            period_label=f"{period} report", metrics=metrics, body=body,
            audience="management", user=request.user, subject=project,
        )
        report = Report.objects.create(
            period=getattr(ReportPeriod, period.upper()),
            title=outcome.get("title") or f"{period.title()} report — {end.isoformat()}",
            user=None if project is None else request.user,
            project=project, period_start=start, period_end=end,
            content=outcome.data, metrics=metrics,
        )
        response = envelope(outcome, AIAction.REPORT)
        response.data["report_id"] = report.id
        return response


# --------------------------------------------------------------------------- #
# Logs
# --------------------------------------------------------------------------- #
class AIRequestLogViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = AIRequestLogSerializer
    permission_classes = [IsAuthenticated, IsAdministrator]
    queryset = AIRequestLog.objects.select_related("user")
    filterset_fields = ["action", "provider", "ok"]

    @action(detail=False, methods=["get"])
    def stats(self, request):
        """Usage roll-up for the settings screen."""
        from datetime import timedelta

        from django.db.models import Avg, Count, Sum
        from django.utils import timezone

        since = timezone.now() - timedelta(days=7)
        recent = AIRequestLog.objects.filter(created_at__gte=since)
        totals = recent.aggregate(
            calls=Count("id"),
            prompt_tokens=Sum("prompt_tokens"),
            completion_tokens=Sum("completion_tokens"),
            avg_latency_ms=Avg("latency_ms"),
        )
        return Response({
            "window_days": 7,
            "calls": totals["calls"] or 0,
            "failures": recent.filter(ok=False).count(),
            "prompt_tokens": totals["prompt_tokens"] or 0,
            "completion_tokens": totals["completion_tokens"] or 0,
            "avg_latency_ms": round(totals["avg_latency_ms"] or 0),
            "by_action": list(
                recent.values("action").annotate(count=Count("id")).order_by("-count")[:15]
            ),
        })


class AIAutomationLogViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """The automation audit trail — who was notified, why, and what the AI said."""

    serializer_class = AIAutomationLogSerializer
    permission_classes = [IsAuthenticated]
    queryset = AIAutomationLog.objects.select_related("task", "project", "user")
    filterset_fields = ["event", "ok", "project", "task"]

    def get_queryset(self):
        user = self.request.user
        qs = super().get_queryset()
        if user.is_superuser or user.has_capability(Capability.ADMINISTER):
            return qs
        # Everyone else sees automation touching projects they can see, plus
        # anything addressed to them personally.
        projects = visible_projects(user, Project.objects.all())
        from django.db.models import Q

        return qs.filter(Q(project__in=projects) | Q(user=user) | Q(task__project__in=projects))


# --------------------------------------------------------------------------- #
# Daily stand-up & executive summary
#
# Generation takes as long as the provider does, so both POST endpoints hand
# the work to a Celery worker and return 202 rather than holding the request
# open. When no broker is reachable — a developer machine without Redis, most
# often — they fall back to running inline and return the finished briefing:
# a slow response is a far better answer than a 500 telling someone their AI
# feature is broken because a queue is down.
# --------------------------------------------------------------------------- #
def queued(task, *args, **kwargs) -> bool:
    """Hand a task to a Celery worker, or return False to run it inline.

    A live Redis broker makes ``apply_async`` succeed even when **no worker** is
    running to consume the queue — the job would then sit unprocessed forever
    (the page polls and reports "still being generated"). This deployment runs no
    worker, so unless ``AI_USE_CELERY`` is explicitly enabled we always run
    inline: a few seconds' wait beats a briefing that never appears.
    """
    from django.conf import settings

    if not getattr(settings, "AI_USE_CELERY", False):
        return False
    try:
        task.apply_async(args=args, kwargs=kwargs, retry=False)
        return True
    except Exception as exc:  # kombu raises its own OperationalError family
        logger.info("Celery unavailable (%s); running %s inline instead.", exc, task.name)
        return False


class DailyStandupView(AIView):
    """Today's stand-up for the signed-in user.

    ``GET`` never generates: it answers from the stored row, so opening the
    dashboard costs nothing and repeated visits cost nothing. ``POST``
    generates — reusing the stored stand-up unless ``force`` asks for a fresh
    one, which is what separates "Refresh" from "Regenerate".
    """

    @extend_schema(responses=DailyStandupSerializer)
    def get(self, request: Request) -> Response:
        from django.utils import timezone

        today = timezone.localdate()
        standup = DailyStandup.objects.filter(user=request.user, standup_date=today).first()
        if standup is None:
            return Response({
                "ok": True,
                "exists": False,
                "standup": None,
                "detail": "No stand-up has been generated for today yet.",
            })
        return Response({"ok": True, "exists": True, "standup": DailyStandupSerializer(standup).data})

    @extend_schema(request=StandupRequestSerializer, responses=DailyStandupSerializer)
    def post(self, request: Request) -> Response:
        from django.utils import timezone

        from . import briefings
        from .tasks import generate_standup_for_user

        data = validated(StandupRequestSerializer, request)
        today = timezone.localdate()
        requested = data.get("date") or today
        force = bool(data.get("force"))

        # A stand-up for a past date can only ever be served from storage —
        # regenerating it would describe today's data under yesterday's heading.
        if requested != today:
            standup = DailyStandup.objects.filter(user=request.user, standup_date=requested).first()
            if standup is None:
                raise ValidationError("No stand-up exists for that date.")
            return Response({"ok": True, "generated": False, "standup": DailyStandupSerializer(standup).data})

        existing = DailyStandup.objects.filter(user=request.user, standup_date=today).first()
        if existing is not None and not force:
            # Already there: answer straight away rather than queueing a job
            # whose only outcome would be to hand back this same row.
            return Response({"ok": True, "generated": False, "standup": DailyStandupSerializer(existing).data})

        if queued(generate_standup_for_user, request.user.id, force=force, actor_id=request.user.id):
            return Response(
                {"ok": True, "queued": True, "standup": None,
                 "detail": "Your stand-up is being generated."},
                status=status.HTTP_202_ACCEPTED,
            )

        standup, generated = briefings.generate_standup(
            request.user, today=today, trigger=GenerationTrigger.MANUAL,
            actor=request.user, force=force,
        )
        if standup is None:
            return Response({
                "ok": True,
                "generated": False,
                "standup": None,
                "detail": "You have no open work, so there is nothing to brief you on today.",
            })
        return Response({
            "ok": True, "queued": False, "generated": generated,
            "standup": DailyStandupSerializer(standup).data,
        })


class DailyStandupHistoryViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Previous stand-ups. Strictly the requesting user's own — a stand-up is
    personal, and there is no supervisory read of somebody else's."""

    permission_classes = [IsAuthenticated]
    queryset = DailyStandup.objects.none()  # real scoping happens in get_queryset()

    def get_queryset(self):
        return DailyStandup.objects.filter(user=self.request.user)

    def get_serializer_class(self):
        return DailyStandupListSerializer if self.action == "list" else DailyStandupSerializer


def require_executive_access(user) -> None:
    """Gate for every executive endpoint.

    The summary aggregates the whole organisation, including projects the reader
    may not be a member of, so it is restricted to the two capabilities that
    already mean "sees across the business".
    """
    if user.is_superuser:
        return
    if user.has_capability(Capability.VIEW_REPORTS) or user.has_capability(Capability.ADMINISTER):
        return
    raise PermissionDenied("You do not have permission to view the executive summary.")


def resolve_summary(summary_id, period) -> ExecutiveSummary:
    """The summary a request is about: an explicit id, else the latest of a period."""
    if summary_id:
        return get_object_or_404(ExecutiveSummary, pk=summary_id)
    qs = ExecutiveSummary.objects.all()
    if period in {"daily", "weekly", "monthly"}:
        qs = qs.filter(period=period)
    summary = qs.first()  # Meta.ordering puts the most recent first
    if summary is None:
        raise ValidationError("No executive summary has been generated yet.")
    return summary


class ExecutiveAIView(AIView):
    """Base for the executive endpoints — capability-checked before dispatch."""

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        require_executive_access(request.user)


class ExecutiveSummaryView(ExecutiveAIView):
    """The latest executive summary, and the button that generates one.

    ``GET`` reads storage only. ``POST`` reuses the stored summary for the
    period unless ``force`` is set, so two managers pressing "Generate" on the
    same morning share one provider call rather than making two.
    """

    @extend_schema(responses=ExecutiveSummarySerializer)
    def get(self, request: Request) -> Response:
        period = request.query_params.get("period") or "daily"
        qs = ExecutiveSummary.objects.all()
        if period in {"daily", "weekly", "monthly"}:
            qs = qs.filter(period=period)
        summary = qs.first()
        if summary is None:
            return Response({
                "ok": True,
                "exists": False,
                "summary": None,
                "detail": "No executive summary has been generated yet.",
            })
        return Response({"ok": True, "exists": True, "summary": ExecutiveSummarySerializer(summary).data})

    @extend_schema(request=ExecutiveSummaryRequestSerializer, responses=ExecutiveSummarySerializer)
    def post(self, request: Request) -> Response:
        from . import briefings
        from .tasks import generate_executive_summary_on_demand

        data = validated(ExecutiveSummaryRequestSerializer, request)
        period, force = data["period"], bool(data.get("force"))

        start, end = briefings.period_span(period)
        existing = ExecutiveSummary.objects.filter(period=period, period_end=end).first()
        if existing is not None and not force:
            return Response({
                "ok": True, "generated": False,
                "summary": ExecutiveSummarySerializer(existing).data,
            })

        if queued(generate_executive_summary_on_demand, period, force=force, actor_id=request.user.id):
            return Response(
                {"ok": True, "queued": True, "summary": None,
                 "detail": f"The {period} executive summary is being generated."},
                status=status.HTTP_202_ACCEPTED,
            )

        summary, generated = briefings.generate_executive_summary(
            period, trigger=GenerationTrigger.MANUAL, actor=request.user, force=force,
            # A manual generation must not spray email at leadership; that is
            # what the explicit "Email report" action is for.
            deliver_it=False,
        )
        return Response({
            "ok": True, "queued": False, "generated": generated,
            "summary": ExecutiveSummarySerializer(summary).data,
        })


class ExecutiveSummaryHistoryViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """Past summaries — the source of the health-score trend on the page."""

    permission_classes = [IsAuthenticated]
    queryset = ExecutiveSummary.objects.none()  # real scoping happens in get_queryset()
    filterset_fields = ["period"]

    def get_queryset(self):
        require_executive_access(self.request.user)
        return ExecutiveSummary.objects.select_related("generated_by")

    def get_serializer_class(self):
        return ExecutiveSummaryListSerializer if self.action == "list" else ExecutiveSummarySerializer


class ExecutiveSummaryEmailView(ExecutiveAIView):
    """Email an existing summary to everyone who may read reports."""

    @extend_schema(request=ExecutiveEmailSerializer, responses=None)
    def post(self, request: Request) -> Response:
        from . import briefings

        data = validated(ExecutiveEmailSerializer, request)
        summary = resolve_summary(data.get("summary_id"), data.get("period"))

        actions = briefings.email_executive_summary(summary)
        summary.refresh_from_db()
        emailed = sum(1 for a in actions if a.startswith("emailed:"))
        notified = sum(1 for a in actions if a.startswith("notified:"))

        # Sending a business briefing to leadership is an action worth recording
        # who took, not just that it happened.
        record(
            action=AuditAction.UPDATE, obj=summary,
            new_value={"emailed": emailed, "notified": notified, "period": summary.period},
            reason="Executive summary emailed manually", request=request,
        )
        return Response({
            "ok": True,
            "summary_id": summary.id,
            "emailed": emailed,
            "notified": notified,
            "emailed_at": summary.emailed_at,
        })


class ExecutiveSummaryCsvView(ExecutiveAIView):
    """CSV export of a summary — its figures and findings, one row each."""

    @extend_schema(responses={(200, "text/csv"): OpenApiTypes.STR})
    def get(self, request: Request) -> HttpResponse:
        import csv

        from . import briefings

        summary = resolve_summary(
            request.query_params.get("summary_id"), request.query_params.get("period")
        )
        filename = f"kos-executive-summary-{summary.period}-{summary.period_end}.csv"

        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        csv.writer(response).writerows(briefings.executive_summary_csv_rows(summary))
        return response
