from rest_framework.routers import DefaultRouter

from .views import (
    EpicViewSet,
    MembershipViewSet,
    MilestoneViewSet,
    PortfolioViewSet,
    ProjectTemplateViewSet,
    ProjectViewSet,
)

router = DefaultRouter()
router.register("projects", ProjectViewSet, basename="project")
router.register("epics", EpicViewSet, basename="epic")
router.register("milestones", MilestoneViewSet, basename="milestone")
router.register("memberships", MembershipViewSet, basename="membership")
router.register("portfolios", PortfolioViewSet, basename="portfolio")
router.register("project-templates", ProjectTemplateViewSet, basename="project-template")

urlpatterns = router.urls
