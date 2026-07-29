from rest_framework.routers import DefaultRouter

from .views import RetrospectiveItemViewSet, SprintViewSet

router = DefaultRouter()
router.register("sprints", SprintViewSet, basename="sprint")
router.register("retro-items", RetrospectiveItemViewSet, basename="retro-item")

urlpatterns = router.urls
