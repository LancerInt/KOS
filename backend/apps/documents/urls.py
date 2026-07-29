from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import DocumentVersionDownloadView, DocumentViewSet, SOPViewSet

router = DefaultRouter()
router.register("documents", DocumentViewSet, basename="document")
router.register("sops", SOPViewSet, basename="sop")

urlpatterns = [
    path("documents/versions/<int:pk>/download/", DocumentVersionDownloadView.as_view(), name="document-version-download"),
    *router.urls,
]
