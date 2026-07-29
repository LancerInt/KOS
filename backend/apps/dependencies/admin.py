from django.contrib import admin

from .models import Blocker, Dependency


@admin.register(Dependency)
class DependencyAdmin(admin.ModelAdmin):
    list_display = ("successor", "dependency_type", "is_mandatory", "short_label")
    list_filter = ("dependency_type", "is_mandatory")


@admin.register(Blocker)
class BlockerAdmin(admin.ModelAdmin):
    list_display = ("task", "severity", "resolver", "target_resolution_date", "resolved_at")
    list_filter = ("severity",)
    search_fields = ("description",)
