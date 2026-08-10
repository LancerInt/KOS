"""AI API routes.

Everything lives under ``/api/ai/`` so the module is obvious in the OpenAPI
schema and easy to firewall or rate-limit as a unit.
"""
from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    AIAutomationLogViewSet,
    AIChatView,
    AIConversationViewSet,
    AIEmailSendView,
    AIEmailView,
    AIGrammarView,
    AIReportViewSet,
    AIRequestLogViewSet,
    AIRewriteView,
    AISettingsView,
    AIStatusView,
    AISummarizeView,
    AITranscribeView,
    AITranslateView,
    CreateTasksView,
    CustomerProposalView,
    CustomerReplyView,
    CustomerSummaryView,
    DailyRecommendationsView,
    DailyStandupHistoryViewSet,
    DailyStandupView,
    DashboardExplainView,
    DashboardInsightsView,
    ExecutiveSummaryCsvView,
    ExecutiveSummaryEmailView,
    ExecutiveSummaryHistoryViewSet,
    ExecutiveSummaryView,
    ExtractTasksView,
    GenerateReportView,
    JobDescriptionView,
    MeetingSummaryView,
    OutboundEmailViewSet,
    PerformanceSummaryView,
    ProjectAnalyseView,
    ProjectDelayView,
    ProjectDuplicatesView,
    ProjectExplainView,
    ProjectHealthView,
    ProjectRisksView,
    ProjectSummaryView,
    ProjectTaskAnalysisView,
    ProjectWorkloadView,
    WorkspaceScaffoldView,
    WorkspaceSuggestView,
    TaskApplySubtasksView,
    TaskEstimateView,
    TaskPrioritizeView,
    TaskRewriteView,
    TaskSubtasksView,
    TaskSummaryView,
)

router = DefaultRouter()
router.register("ai/conversations", AIConversationViewSet, basename="ai-conversation")
router.register("ai/reports", AIReportViewSet, basename="ai-report")
router.register("ai/logs", AIRequestLogViewSet, basename="ai-log")
router.register("ai/automation-logs", AIAutomationLogViewSet, basename="ai-automation-log")
router.register("ai/standups", DailyStandupHistoryViewSet, basename="ai-standup-history")
router.register("ai/executive-summaries", ExecutiveSummaryHistoryViewSet, basename="ai-executive-history")
router.register("ai/emails", OutboundEmailViewSet, basename="ai-outbound-email")

urlpatterns = [
    # Status & configuration
    path("ai/status/", AIStatusView.as_view(), name="ai-status"),
    path("ai/settings/", AISettingsView.as_view(), name="ai-settings"),

    # Assistant & generic text tools
    path("ai/chat/", AIChatView.as_view(), name="ai-chat"),
    # Dictation fallback for browsers with no speech recognition of their own.
    path("ai/transcribe/", AITranscribeView.as_view(), name="ai-transcribe"),
    path("ai/summarize/", AISummarizeView.as_view(), name="ai-summarize"),
    path("ai/rewrite/", AIRewriteView.as_view(), name="ai-rewrite"),
    path("ai/grammar/", AIGrammarView.as_view(), name="ai-grammar"),
    path("ai/translate/", AITranslateView.as_view(), name="ai-translate"),
    path("ai/generate-email/", AIEmailView.as_view(), name="ai-generate-email"),
    # Drafting and sending are separate endpoints on purpose — see AIEmailSendView.
    path("ai/send-email/", AIEmailSendView.as_view(), name="ai-send-email"),

    # Projects
    path("ai/projects/<int:pk>/summary/", ProjectSummaryView.as_view(), name="ai-project-summary"),
    path("ai/projects/<int:pk>/explain/", ProjectExplainView.as_view(), name="ai-project-explain"),
    path("ai/projects/<int:pk>/risks/", ProjectRisksView.as_view(), name="ai-project-risks"),
    path("ai/projects/<int:pk>/delay/", ProjectDelayView.as_view(), name="ai-project-delay"),
    path("ai/projects/<int:pk>/health/", ProjectHealthView.as_view(), name="ai-project-health"),
    path("ai/projects/<int:pk>/analyse/", ProjectAnalyseView.as_view(), name="ai-project-analyse"),
    path("ai/projects/<int:pk>/analyse-tasks/", ProjectTaskAnalysisView.as_view(), name="ai-project-tasks"),
    path("ai/projects/<int:pk>/duplicates/", ProjectDuplicatesView.as_view(), name="ai-project-duplicates"),
    path("ai/projects/<int:pk>/workload/", ProjectWorkloadView.as_view(), name="ai-project-workload"),

    # Tasks
    path("ai/tasks/<int:pk>/summary/", TaskSummaryView.as_view(), name="ai-task-summary"),
    path("ai/tasks/<int:pk>/rewrite/", TaskRewriteView.as_view(), name="ai-task-rewrite"),
    path("ai/tasks/<int:pk>/subtasks/", TaskSubtasksView.as_view(), name="ai-task-subtasks"),
    path("ai/tasks/<int:pk>/apply-subtasks/", TaskApplySubtasksView.as_view(), name="ai-task-apply-subtasks"),
    path("ai/tasks/<int:pk>/estimate/", TaskEstimateView.as_view(), name="ai-task-estimate"),
    path("ai/tasks/<int:pk>/prioritize/", TaskPrioritizeView.as_view(), name="ai-task-prioritize"),

    # Meetings & notes
    path("ai/meetings/summarize/", MeetingSummaryView.as_view(), name="ai-meeting-summary"),
    path("ai/notes/extract-tasks/", ExtractTasksView.as_view(), name="ai-extract-tasks"),
    path("ai/notes/create-tasks/", CreateTasksView.as_view(), name="ai-create-tasks"),

    # Workspaces — build from a prompt
    path("ai/workspace/scaffold/", WorkspaceScaffoldView.as_view(), name="ai-workspace-scaffold"),
    path("ai/workspace/suggest/", WorkspaceSuggestView.as_view(), name="ai-workspace-suggest"),

    # CRM
    path("ai/crm/customers/<int:pk>/summary/", CustomerSummaryView.as_view(), name="ai-customer-summary"),
    path("ai/crm/customers/<int:pk>/reply/", CustomerReplyView.as_view(), name="ai-customer-reply"),
    path("ai/crm/customers/<int:pk>/proposal/", CustomerProposalView.as_view(), name="ai-customer-proposal"),

    # HR
    path("ai/hr/job-description/", JobDescriptionView.as_view(), name="ai-job-description"),
    path("ai/hr/performance-summary/", PerformanceSummaryView.as_view(), name="ai-performance-summary"),

    # Dashboard
    path("ai/dashboard/insights/", DashboardInsightsView.as_view(), name="ai-dashboard-insights"),
    path("ai/dashboard/explain/", DashboardExplainView.as_view(), name="ai-dashboard-explain"),
    path("ai/dashboard/recommendations/", DailyRecommendationsView.as_view(), name="ai-recommendations"),

    # Daily stand-up — GET reads today's, POST generates or regenerates it.
    path("ai/standup/", DailyStandupView.as_view(), name="ai-standup"),

    # Executive summary
    path("ai/executive-summary/", ExecutiveSummaryView.as_view(), name="ai-executive-summary"),
    path("ai/executive-summary/email/", ExecutiveSummaryEmailView.as_view(), name="ai-executive-summary-email"),
    path("ai/executive-summary/export.csv", ExecutiveSummaryCsvView.as_view(), name="ai-executive-summary-csv"),

    # Reports
    path("ai/reports/generate/", GenerateReportView.as_view(), name="ai-generate-report"),

    *router.urls,
]
