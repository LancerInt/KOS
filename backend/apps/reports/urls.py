from django.urls import path

from .views import (
    DashboardView,
    GlobalSearchView,
    ProjectReportExportView,
    ProjectReportView,
    TaskExportView,
)

urlpatterns = [
    path("search/", GlobalSearchView.as_view(), name="global-search"),
    path("dashboard/", DashboardView.as_view(), name="dashboard"),
    path("reports/projects/", ProjectReportView.as_view(), name="project-report"),
    path("reports/projects/export/", ProjectReportExportView.as_view(), name="project-report-export"),
    path("reports/tasks/export/", TaskExportView.as_view(), name="task-report-export"),
]
