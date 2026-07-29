from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import AutomationLogViewSet, AutomationRuleViewSet, AutomationVocabularyView

router = DefaultRouter()
router.register("automation/rules", AutomationRuleViewSet, basename="automation-rule")
router.register("automation/logs", AutomationLogViewSet, basename="automation-log")

urlpatterns = [
    path("automation/vocabulary/", AutomationVocabularyView.as_view(), name="automation-vocabulary"),
    *router.urls,
]
