from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import ConversationViewSet, DirectMessageViewSet, MessageDirectoryView

router = DefaultRouter()
router.register("conversations", ConversationViewSet, basename="conversation")
router.register("direct-messages", DirectMessageViewSet, basename="direct-message")

urlpatterns = [
    path("message-directory/", MessageDirectoryView.as_view(), name="message-directory"),
    *router.urls,
]
