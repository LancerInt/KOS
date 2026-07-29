from rest_framework.routers import DefaultRouter

from .views import (
    ChecklistItemViewSet,
    CommentViewSet,
    SubtaskViewSet,
    TaskViewSet,
)

router = DefaultRouter()
router.register("tasks", TaskViewSet, basename="task")
router.register("subtasks", SubtaskViewSet, basename="subtask")
router.register("checklist-items", ChecklistItemViewSet, basename="checklist-item")
router.register("comments", CommentViewSet, basename="comment")

urlpatterns = router.urls
