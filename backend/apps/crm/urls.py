from rest_framework.routers import DefaultRouter

from .views import ContactViewSet, CustomerViewSet, OpportunityViewSet

router = DefaultRouter()
router.register("crm/customers", CustomerViewSet, basename="crm-customer")
router.register("crm/contacts", ContactViewSet, basename="crm-contact")
router.register("crm/opportunities", OpportunityViewSet, basename="crm-opportunity")

urlpatterns = router.urls
