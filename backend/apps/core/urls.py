from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import HealthView, SavedViewViewSet

router = DefaultRouter()
router.register("saved-views", SavedViewViewSet, basename="saved-view")

urlpatterns = [
    path("health/", HealthView.as_view(), name="health"),
    *router.urls,
]
