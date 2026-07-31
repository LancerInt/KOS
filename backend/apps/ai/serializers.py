"""Serializers for the AI API.

Request serializers exist so that bad input is rejected *before* it reaches a
paid provider call — an empty prompt should cost nothing.
"""
from __future__ import annotations

import re

from rest_framework import serializers

from .models import (
    AIAutomationLog,
    AIConversation,
    AIMessage,
    AIReport,
    AIRequestLog,
    AISettings,
    DailyStandup,
    ExecutiveSummary,
    OutboundEmail,
)

MAX_INPUT_CHARS = 60_000
MAX_EMAIL_BODY_CHARS = 100_000


class AIOutcomeSerializer(serializers.Serializer):
    """The uniform envelope every AI endpoint returns.

    One shape for every action keeps the frontend renderer generic: it reads
    ``data`` when ``structured`` is true and falls back to ``text`` otherwise.
    """

    ok = serializers.BooleanField(default=True)
    action = serializers.CharField()
    data = serializers.JSONField()
    text = serializers.CharField(allow_blank=True)
    structured = serializers.BooleanField()
    provider = serializers.CharField()
    model = serializers.CharField()
    log_id = serializers.IntegerField(allow_null=True)


# --------------------------------------------------------------------------- #
# Request serializers
# --------------------------------------------------------------------------- #
class TextInputSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=MAX_INPUT_CHARS, trim_whitespace=True)


class SummarizeSerializer(TextInputSerializer):
    style = serializers.CharField(required=False, default="brief", max_length=60)
    audience = serializers.CharField(required=False, default="the project team", max_length=120)
    instructions = serializers.CharField(required=False, allow_blank=True, default="", max_length=2000)


class RewriteSerializer(TextInputSerializer):
    instruction = serializers.CharField(required=False, allow_blank=True, default="", max_length=2000)
    tone = serializers.CharField(required=False, default="clear and professional", max_length=80)


class TranslateSerializer(TextInputSerializer):
    language = serializers.CharField(max_length=60)


class ChatSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=MAX_INPUT_CHARS)
    conversation_id = serializers.IntegerField(required=False, allow_null=True)
    #: Text scraped from the user's current screen, so "summarise this page" works.
    page_context = serializers.CharField(required=False, allow_blank=True, default="", max_length=MAX_INPUT_CHARS)
    page_path = serializers.CharField(required=False, allow_blank=True, default="", max_length=300)
    project_id = serializers.IntegerField(required=False, allow_null=True)


class EmailSerializer(serializers.Serializer):
    purpose = serializers.CharField(max_length=MAX_INPUT_CHARS)
    context = serializers.CharField(required=False, allow_blank=True, default="", max_length=MAX_INPUT_CHARS)
    tone = serializers.CharField(required=False, default="professional", max_length=80)
    recipient = serializers.CharField(required=False, allow_blank=True, default="", max_length=200)
    language = serializers.CharField(required=False, default="English", max_length=60)
    project_id = serializers.IntegerField(required=False, allow_null=True)
    task_id = serializers.IntegerField(required=False, allow_null=True)


class GoalSerializer(serializers.Serializer):
    goal = serializers.CharField(required=False, allow_blank=True, default="", max_length=2000)


class SubtaskCountSerializer(serializers.Serializer):
    count = serializers.IntegerField(required=False, default=6, min_value=1, max_value=15)


class ApplySubtasksSerializer(serializers.Serializer):
    """Subtasks the user chose to keep after reviewing the AI's suggestions."""

    subtasks = serializers.ListField(
        child=serializers.CharField(max_length=300), allow_empty=False, max_length=25
    )


class NotesSerializer(serializers.Serializer):
    notes = serializers.CharField(max_length=MAX_INPUT_CHARS)
    context = serializers.CharField(required=False, allow_blank=True, default="", max_length=MAX_INPUT_CHARS)
    project_id = serializers.IntegerField(required=False, allow_null=True)


class WorkspaceScaffoldSerializer(serializers.Serializer):
    prompt = serializers.CharField(max_length=4000)
    workspace = serializers.CharField(max_length=64)
    workspace_label = serializers.CharField(required=False, allow_blank=True, default="", max_length=120)


class CreateTasksSerializer(serializers.Serializer):
    """Confirmed task drafts to actually write into the project."""

    project_id = serializers.IntegerField()
    tasks = serializers.ListField(child=serializers.DictField(), allow_empty=False, max_length=40)


class CustomerReplySerializer(serializers.Serializer):
    incoming_message = serializers.CharField(max_length=MAX_INPUT_CHARS)
    intent = serializers.CharField(required=False, allow_blank=True, default="", max_length=2000)
    tone = serializers.CharField(required=False, default="professional and warm", max_length=80)


class ProposalSerializer(serializers.Serializer):
    brief = serializers.CharField(max_length=MAX_INPUT_CHARS)
    opportunity_id = serializers.IntegerField(required=False, allow_null=True)


class JobDescriptionSerializer(serializers.Serializer):
    role_title = serializers.CharField(max_length=160)
    department = serializers.CharField(required=False, allow_blank=True, default="", max_length=120)
    seniority = serializers.CharField(required=False, allow_blank=True, default="", max_length=80)
    requirements = serializers.CharField(required=False, allow_blank=True, default="", max_length=8000)


class PerformanceSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    period_label = serializers.CharField(required=False, allow_blank=True, default="", max_length=120)
    notes = serializers.CharField(required=False, allow_blank=True, default="", max_length=8000)


class MetricsSerializer(serializers.Serializer):
    metrics = serializers.DictField(required=False)
    question = serializers.CharField(required=False, allow_blank=True, default="", max_length=2000)
    project_id = serializers.IntegerField(required=False, allow_null=True)


class ReportRequestSerializer(serializers.Serializer):
    period = serializers.ChoiceField(choices=["daily", "weekly", "monthly"], default="weekly")
    project_id = serializers.IntegerField(required=False, allow_null=True)


class StandupRequestSerializer(serializers.Serializer):
    """``force`` is the difference between "Refresh" and "Regenerate".

    Without it the endpoint returns the stored stand-up and costs nothing; with
    it the user has explicitly asked to spend another provider call.
    """

    force = serializers.BooleanField(required=False, default=False)
    date = serializers.DateField(required=False, allow_null=True)


class ExecutiveSummaryRequestSerializer(serializers.Serializer):
    period = serializers.ChoiceField(choices=["daily", "weekly", "monthly"], default="daily")
    force = serializers.BooleanField(required=False, default=False)


class ExecutiveEmailSerializer(serializers.Serializer):
    """Email an existing summary. Omit ``summary_id`` to send the latest."""

    summary_id = serializers.IntegerField(required=False, allow_null=True)
    period = serializers.ChoiceField(choices=["daily", "weekly", "monthly"], required=False)


class AddressListField(serializers.ListField):
    """A recipient list that accepts either a list or a pasted string.

    The compose form sends ``["a@x.com", "b@y.com"]``; a user pasting from
    another mail client sends ``"a@x.com, b@y.com"``. Both are the same
    intention, and rejecting the second over punctuation is the kind of
    validation people hate. Normalisation and address validation happen in
    :mod:`apps.ai.outbound`, so there is exactly one definition of a valid
    address in the system.
    """

    child = serializers.CharField(max_length=320)

    def __init__(self, **kwargs):
        kwargs.setdefault("required", False)
        kwargs.setdefault("max_length", 100)
        # DRF forbids declaring both; an optional address list defaults to empty,
        # a required one has no default by definition.
        if not kwargs["required"]:
            kwargs.setdefault("default", list)
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        if isinstance(data, str):
            data = [part for part in re.split(r"[,;\n]+", data) if part.strip()]
        return super().to_internal_value(data)


class SendEmailSerializer(serializers.Serializer):
    """A message a user composed — usually from an AI draft — and wants sent.

    The body is accepted verbatim. This endpoint does not regenerate or rewrite
    anything: what the user read on screen is what leaves, which is the whole
    point of the review step before Send.
    """

    to = AddressListField(required=True, allow_empty=False)
    cc = AddressListField()
    bcc = AddressListField()
    reply_to = serializers.CharField(required=False, allow_blank=True, default="", max_length=320)

    subject = serializers.CharField(max_length=300)
    body = serializers.CharField(max_length=MAX_EMAIL_BODY_CHARS)

    #: Ties the sent mail back to the work it is about, so the task's history
    #: shows that the client was emailed.
    project_id = serializers.IntegerField(required=False, allow_null=True)
    task_id = serializers.IntegerField(required=False, allow_null=True)
    #: The ``log_id`` from the generate-email response, when the draft was AI-written.
    draft_log_id = serializers.IntegerField(required=False, allow_null=True)

    def validate_subject(self, value):
        if not value.strip():
            raise serializers.ValidationError("A subject line is required.")
        return value

    def validate_body(self, value):
        if not value.strip():
            raise serializers.ValidationError("The message body is empty.")
        return value


class OutboundEmailSerializer(serializers.ModelSerializer):
    sender_name = serializers.SerializerMethodField()
    recipient_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = OutboundEmail
        fields = (
            "id", "to", "cc", "bcc", "reply_to", "subject", "body",
            "source", "sender", "sender_name", "task", "project", "draft_log",
            "status", "error", "attempts", "sent_at", "recipient_count", "created_at",
        )
        read_only_fields = fields

    def get_sender_name(self, obj) -> str:
        if obj.sender is None:
            return "KOS automation"
        return obj.sender.get_full_name() or obj.sender.get_username()


class AIStatusSerializer(serializers.Serializer):
    """What the assistant panel needs to know before offering AI actions.

    ``offline_fallback`` is the honest signal: a provider is configured but has
    no key, so answers are coming from the local stub rather than the vendor.
    """

    enabled = serializers.BooleanField()
    configured_provider = serializers.CharField()
    active_provider = serializers.CharField()
    model = serializers.CharField()
    key_configured = serializers.BooleanField()
    offline_fallback = serializers.BooleanField()
    automation_enabled = serializers.BooleanField()


# --------------------------------------------------------------------------- #
# Model serializers
# --------------------------------------------------------------------------- #
class AIMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = AIMessage
        fields = ("id", "role", "content", "created_at")


class AIConversationSerializer(serializers.ModelSerializer):
    messages = AIMessageSerializer(many=True, read_only=True)
    message_count = serializers.IntegerField(source="messages.count", read_only=True)

    class Meta:
        model = AIConversation
        fields = ("id", "title", "page_path", "project", "messages", "message_count",
                  "created_at", "updated_at")


class AIConversationListSerializer(serializers.ModelSerializer):
    """Thread list — deliberately excludes messages so the sidebar stays cheap."""

    message_count = serializers.IntegerField(source="messages.count", read_only=True)

    class Meta:
        model = AIConversation
        fields = ("id", "title", "page_path", "project", "message_count", "created_at", "updated_at")


class AISettingsSerializer(serializers.ModelSerializer):
    """Editable configuration. The API key is never a field here — it lives in
    the server environment and is only ever reported as present or absent."""

    class Meta:
        model = AISettings
        fields = (
            "provider", "model", "base_url", "temperature", "max_tokens", "timeout_seconds",
            "is_enabled", "automation_enabled", "email_enabled",
            "overdue_scan_enabled", "blocked_scan_enabled", "health_scan_enabled",
            "daily_summary_enabled", "weekly_report_enabled", "monthly_report_enabled",
            "standup_enabled", "standup_hour", "standup_minute",
            "standup_notify_enabled", "standup_email_enabled",
            "executive_summary_enabled", "executive_daily_enabled",
            "executive_weekly_enabled", "executive_monthly_enabled", "executive_email_enabled",
            "outbound_email_enabled", "outbound_max_recipients", "outbound_hourly_limit_per_user",
            "critical_alert_enabled", "critical_alert_cooldown_hours",
            "critical_alert_bcc", "critical_alert_include_managers",
            "reminder_repeat_minutes", "manager_notify_hours", "escalate_hours",
            "max_calls_per_hour", "max_items_per_scan", "updated_at",
        )
        read_only_fields = ("updated_at",)

    def validate_temperature(self, value):
        if not 0 <= value <= 2:
            raise serializers.ValidationError("Temperature must be between 0 and 2.")
        return value

    def validate_critical_alert_bcc(self, value):
        """Reject a bad watch-list address here, not at 3am when it matters.

        An invalid address in this field would otherwise fail silently at send
        time, and the whole point of the list is that nobody is watching it.
        """
        from .outbound import EmailRejected, parse_addresses

        try:
            parse_addresses(value)
        except EmailRejected as exc:
            raise serializers.ValidationError(str(exc)) from None
        return value

    def validate_standup_hour(self, value):
        if not 0 <= value <= 23:
            raise serializers.ValidationError("The stand-up hour must be between 0 and 23.")
        return value

    def validate_standup_minute(self, value):
        if not 0 <= value <= 59:
            raise serializers.ValidationError("The stand-up minute must be between 0 and 59.")
        return value

    def validate(self, attrs):
        repeat = attrs.get("reminder_repeat_minutes", getattr(self.instance, "reminder_repeat_minutes", 30))
        manager = attrs.get("manager_notify_hours", getattr(self.instance, "manager_notify_hours", 2))
        escalate = attrs.get("escalate_hours", getattr(self.instance, "escalate_hours", 24))
        # The ladder only makes sense in ascending order.
        if manager * 60 <= repeat:
            raise serializers.ValidationError(
                "Manager notification must come later than the repeat reminder."
            )
        if escalate <= manager:
            raise serializers.ValidationError(
                "Escalation must come later than the manager notification."
            )
        return attrs


class AIRequestLogSerializer(serializers.ModelSerializer):
    total_tokens = serializers.IntegerField(read_only=True)
    user_name = serializers.CharField(source="user.get_full_name", read_only=True, default="")

    class Meta:
        model = AIRequestLog
        fields = ("id", "action", "provider", "model", "user", "user_name",
                  "subject_type", "subject_id", "ok", "error", "structured",
                  "prompt_tokens", "completion_tokens", "total_tokens",
                  "latency_ms", "response_preview", "created_at")


class AIAutomationLogSerializer(serializers.ModelSerializer):
    task_title = serializers.CharField(source="task.title", read_only=True, default="")
    project_name = serializers.CharField(source="project.name", read_only=True, default="")

    class Meta:
        model = AIAutomationLog
        fields = ("id", "event", "task", "task_title", "project", "project_name", "user",
                  "ai_response", "executed_actions", "ok", "message", "created_at")


class AIReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = AIReport
        fields = ("id", "period", "title", "user", "project", "period_start", "period_end",
                  "content", "metrics", "emailed_at", "created_at")


class DailyStandupSerializer(serializers.ModelSerializer):
    """A stand-up as the widget reads it.

    ``metrics`` carries the full collected data, so the widget can show counts
    and the underlying task lists without a second round trip.
    """

    user_name = serializers.CharField(source="user.get_full_name", read_only=True, default="")

    class Meta:
        model = DailyStandup
        fields = ("id", "user", "user_name", "standup_date", "content", "metrics",
                  "trigger", "generation_count", "ai_ok", "error", "duration_ms",
                  "notified_at", "emailed_at", "created_at", "updated_at")
        read_only_fields = fields


class DailyStandupListSerializer(serializers.ModelSerializer):
    """History list — omits ``metrics``, which is by far the largest field and
    is not needed to render a row in "previous stand-ups"."""

    class Meta:
        model = DailyStandup
        fields = ("id", "standup_date", "content", "trigger", "generation_count",
                  "ai_ok", "emailed_at", "created_at")
        read_only_fields = fields


class ExecutiveSummarySerializer(serializers.ModelSerializer):
    generated_by_name = serializers.CharField(
        source="generated_by.get_full_name", read_only=True, default=""
    )

    class Meta:
        model = ExecutiveSummary
        fields = ("id", "period", "title", "period_start", "period_end", "content", "metrics",
                  "health_score", "risk_count", "trigger", "generated_by", "generated_by_name",
                  "generation_count", "ai_ok", "error", "duration_ms", "notified_at",
                  "emailed_at", "created_at", "updated_at")
        read_only_fields = fields


class ExecutiveSummaryListSerializer(serializers.ModelSerializer):
    """History list — the headline figures only, so the trend chart is cheap."""

    class Meta:
        model = ExecutiveSummary
        fields = ("id", "period", "title", "period_start", "period_end", "health_score",
                  "risk_count", "ai_ok", "emailed_at", "created_at")
        read_only_fields = fields
