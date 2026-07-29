from django.contrib import admin

from .models import RegulatoryRegistration


@admin.register(RegulatoryRegistration)
class RegulatoryRegistrationAdmin(admin.ModelAdmin):
    list_display = ("product_name", "authority", "status", "registration_number", "expiry_date")
    list_filter = ("authority", "status")
    search_fields = ("product_name", "registration_number", "category")
    filter_horizontal = ("documents",)
