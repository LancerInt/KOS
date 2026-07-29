from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    ErpConnectionViewSet,
    EventVocabularyView,
    InboundEventViewSet,
    InboundWebhookView,
    WebhookDeliveryViewSet,
)

router = DefaultRouter()
router.register("integrations/connections", ErpConnectionViewSet, basename="erp-connection")
router.register("integrations/deliveries", WebhookDeliveryViewSet, basename="webhook-delivery")
router.register("integrations/inbound-events", InboundEventViewSet, basename="inbound-event")

urlpatterns = [
    path("integrations/events/", EventVocabularyView.as_view(), name="integration-events"),
    path("integrations/inbound/", InboundWebhookView.as_view(), name="integration-inbound"),
    *router.urls,
]
