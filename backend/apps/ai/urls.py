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
    AIEmailView,
    AIGrammarView,
    AIReportViewSet,
    AIRequestLogViewSet,
    AIRewriteView,
    AISettingsView,
    AIStatusView,
    AISummarizeView,
    AITranslateView,
    CreateTasksView,
    CustomerProposalView,
    CustomerReplyView,
    CustomerSummaryView,
    DailyRecommendationsView,
    DashboardExplainView,
    DashboardInsightsView,
    ExtractTasksView,
    GenerateReportView,
    JobDescriptionView,
    MeetingSummaryView,
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

urlpatterns = [
    # Status & configuration
    path("ai/status/", AIStatusView.as_view(), name="ai-status"),
    path("ai/settings/", AISettingsView.as_view(), name="ai-settings"),

    # Assistant & generic text tools
    path("ai/chat/", AIChatView.as_view(), name="ai-chat"),
    path("ai/summarize/", AISummarizeView.as_view(), name="ai-summarize"),
    path("ai/rewrite/", AIRewriteView.as_view(), name="ai-rewrite"),
    path("ai/grammar/", AIGrammarView.as_view(), name="ai-grammar"),
    path("ai/translate/", AITranslateView.as_view(), name="ai-translate"),
    path("ai/generate-email/", AIEmailView.as_view(), name="ai-generate-email"),

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

    # Reports
    path("ai/reports/generate/", GenerateReportView.as_view(), name="ai-generate-report"),

    *router.urls,
]
