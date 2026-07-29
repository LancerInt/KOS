from rest_framework.routers import DefaultRouter

from .views import BlockerViewSet, DependencyViewSet

router = DefaultRouter()
router.register("dependencies", DependencyViewSet, basename="dependency")
router.register("blockers", BlockerViewSet, basename="blocker")

urlpatterns = router.urls
