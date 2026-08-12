from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    ConversationViewSet, DirectMessageViewSet, GroupMessageViewSet,
    GroupThreadViewSet, MessageDirectoryView,
)

router = DefaultRouter()
router.register("conversations", ConversationViewSet, basename="conversation")
router.register("direct-messages", DirectMessageViewSet, basename="direct-message")
router.register("group-threads", GroupThreadViewSet, basename="group-thread")
router.register("group-messages", GroupMessageViewSet, basename="group-message")

urlpatterns = [
    path("message-directory/", MessageDirectoryView.as_view(), name="message-directory"),
    *router.urls,
]
