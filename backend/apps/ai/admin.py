from django.contrib import admin

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
    TaskEscalation,
)


@admin.register(AISettings)
class AISettingsAdmin(admin.ModelAdmin):
    list_display = ("provider", "model", "is_enabled", "automation_enabled", "email_enabled", "updated_at")

    def has_add_permission(self, request):
        # Singleton: the row is created on first access, never added by hand.
        return not AISettings.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(AIRequestLog)
class AIRequestLogAdmin(admin.ModelAdmin):
    list_display = ("action", "provider", "model", "user", "ok", "structured",
                    "prompt_tokens", "completion_tokens", "latency_ms", "created_at")
    list_filter = ("action", "provider", "ok", "structured")
    search_fields = ("subject_type", "subject_id", "error")
    readonly_fields = [f.name for f in AIRequestLog._meta.fields]


@admin.register(AIAutomationLog)
class AIAutomationLogAdmin(admin.ModelAdmin):
    list_display = ("event", "task", "project", "user", "ok", "message", "created_at")
    list_filter = ("event", "ok")
    search_fields = ("message",)
    readonly_fields = [f.name for f in AIAutomationLog._meta.fields]


@admin.register(OutboundEmail)
class OutboundEmailAdmin(admin.ModelAdmin):
    list_display = ("subject", "sender", "status", "source", "recipient_count",
                    "attempts", "sent_at", "created_at")
    list_filter = ("status", "source", "created_at")
    search_fields = ("subject", "body", "error")
    # Sent mail is a record of what left the building, so nothing here is
    # editable — an admin who could rewrite the Bcc list after the fact would
    # make the log worth less than no log.
    readonly_fields = [f.name for f in OutboundEmail._meta.fields] + ["recipient_count"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


class AIMessageInline(admin.TabularInline):
    model = AIMessage
    extra = 0
    readonly_fields = ("role", "content", "created_at")


@admin.register(AIConversation)
class AIConversationAdmin(admin.ModelAdmin):
    list_display = ("title", "user", "project", "page_path", "updated_at")
    search_fields = ("title",)
    inlines = [AIMessageInline]


@admin.register(TaskEscalation)
class TaskEscalationAdmin(admin.ModelAdmin):
    list_display = ("task", "stage", "reminder_count", "first_detected_at",
                    "manager_notified_at", "escalated_at", "resolved_at")
    list_filter = ("stage",)


@admin.register(AIReport)
class AIReportAdmin(admin.ModelAdmin):
    list_display = ("title", "period", "user", "project", "period_start", "period_end", "emailed_at")
    list_filter = ("period",)
    search_fields = ("title",)


@admin.register(DailyStandup)
class DailyStandupAdmin(admin.ModelAdmin):
    list_display = ("user", "standup_date", "trigger", "ai_ok", "generation_count",
                    "duration_ms", "notified_at", "emailed_at")
    list_filter = ("trigger", "ai_ok", "standup_date")
    search_fields = ("user__username", "user__email", "error")
    readonly_fields = [f.name for f in DailyStandup._meta.fields]

    def has_add_permission(self, request):
        # Stand-ups are generated, never hand-written.
        return False


@admin.register(ExecutiveSummary)
class ExecutiveSummaryAdmin(admin.ModelAdmin):
    list_display = ("title", "period", "period_end", "health_score", "risk_count",
                    "trigger", "ai_ok", "duration_ms", "emailed_at")
    list_filter = ("period", "trigger", "ai_ok")
    search_fields = ("title", "error")
    readonly_fields = [f.name for f in ExecutiveSummary._meta.fields]

    def has_add_permission(self, request):
        return False
