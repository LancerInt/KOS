from rest_framework.routers import DefaultRouter

from .views import DecisionViewSet, IssueViewSet, RiskViewSet

router = DefaultRouter()
router.register("risks", RiskViewSet, basename="risk")
router.register("issues", IssueViewSet, basename="issue")
router.register("decisions", DecisionViewSet, basename="decision")

urlpatterns = router.urls
