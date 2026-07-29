from rest_framework.routers import DefaultRouter

from .views import (
    WorkspacePermissionViewSet, WorkspaceProjectViewSet,
    WorkspaceRecordViewSet, WorkspaceSectionViewSet,
)

router = DefaultRouter()
router.register("workspace-permissions", WorkspacePermissionViewSet, basename="workspace-permission")
router.register("workspace-projects", WorkspaceProjectViewSet, basename="workspace-project")
router.register("workspace-records", WorkspaceRecordViewSet, basename="workspace-record")
router.register("workspace-sections", WorkspaceSectionViewSet, basename="workspace-section")

urlpatterns = router.urls
