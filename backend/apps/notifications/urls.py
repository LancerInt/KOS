from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    EmailAccountTestView, EmailAccountView, NotificationPreferenceView, NotificationViewSet,
)

router = DefaultRouter()
router.register("notifications", NotificationViewSet, basename="notification")

urlpatterns = [
    path("notification-preferences/", NotificationPreferenceView.as_view(), name="notification-preferences"),
    path("email-account/", EmailAccountView.as_view(), name="email-account"),
    path("email-account/test/", EmailAccountTestView.as_view(), name="email-account-test"),
    *router.urls,
]
