from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import NotificationPreferenceView, NotificationViewSet

router = DefaultRouter()
router.register("notifications", NotificationViewSet, basename="notification")

urlpatterns = [
    path("notification-preferences/", NotificationPreferenceView.as_view(), name="notification-preferences"),
    *router.urls,
]
