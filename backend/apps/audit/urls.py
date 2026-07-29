from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import AuditExportView, AuditLogViewSet, ObjectHistoryView, RetentionPolicyViewSet

router = DefaultRouter()
router.register("audit/logs", AuditLogViewSet, basename="audit-log")
router.register("audit/retention", RetentionPolicyViewSet, basename="retention-policy")

urlpatterns = [
    path("audit/export/", AuditExportView.as_view(), name="audit-export"),
    path("audit/history/", ObjectHistoryView.as_view(), name="audit-history"),
    *router.urls,
]
