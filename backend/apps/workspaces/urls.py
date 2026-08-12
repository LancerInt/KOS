from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    ComplianceDeadlineViewSet, WorkspaceDeletedItemsView, WorkspaceMemberViewSet,
    WorkspacePermissionViewSet, WorkspaceProjectExportView, WorkspaceProjectMemberViewSet,
    WorkspaceProjectViewSet, WorkspaceRecordViewSet, WorkspaceSectionViewSet,
    WorkspaceUserAccessView, WorkspaceViewSet,
)

router = DefaultRouter()
router.register("workspaces", WorkspaceViewSet, basename="workspace")
router.register("workspace-permissions", WorkspacePermissionViewSet, basename="workspace-permission")
router.register("workspace-members", WorkspaceMemberViewSet, basename="workspace-member")
router.register("workspace-projects", WorkspaceProjectViewSet, basename="workspace-project")
router.register(
    "workspace-project-members", WorkspaceProjectMemberViewSet, basename="workspace-project-member")
router.register("workspace-records", WorkspaceRecordViewSet, basename="workspace-record")
router.register("workspace-sections", WorkspaceSectionViewSet, basename="workspace-section")
router.register("compliance-deadlines", ComplianceDeadlineViewSet, basename="compliance-deadline")

urlpatterns = [
    # Before the router so it isn't captured by the workspaces/<key>/ detail route.
    path("workspaces/deleted-items/", WorkspaceDeletedItemsView.as_view(), name="workspace-deleted-items"),
    path("workspace-user-access/", WorkspaceUserAccessView.as_view(), name="workspace-user-access"),
    # Before the router, so the dot in the filename isn't read as a project id.
    path("workspace-projects/export.xlsx", WorkspaceProjectExportView.as_view(),
         name="workspace-project-export"),
    *router.urls,
]
