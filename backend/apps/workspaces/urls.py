from rest_framework.routers import DefaultRouter

from .views import (
    WorkspaceMemberViewSet, WorkspacePermissionViewSet, WorkspaceProjectViewSet,
    WorkspaceRecordViewSet, WorkspaceSectionViewSet, WorkspaceViewSet,
)

router = DefaultRouter()
router.register("workspaces", WorkspaceViewSet, basename="workspace")
router.register("workspace-permissions", WorkspacePermissionViewSet, basename="workspace-permission")
router.register("workspace-members", WorkspaceMemberViewSet, basename="workspace-member")
router.register("workspace-projects", WorkspaceProjectViewSet, basename="workspace-project")
router.register("workspace-records", WorkspaceRecordViewSet, basename="workspace-record")
router.register("workspace-sections", WorkspaceSectionViewSet, basename="workspace-section")

urlpatterns = router.urls
