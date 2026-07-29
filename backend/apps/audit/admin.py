from django.contrib import admin

from .models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "actor", "action", "object_type", "object_id")
    list_filter = ("action", "object_type")
    search_fields = ("object_id", "reason", "actor__username")
    readonly_fields = (
        "actor", "action", "object_type", "object_id",
        "old_value", "new_value", "reason", "source_ip", "created_at",
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False  # immutable (§26.3)

    def has_delete_permission(self, request, obj=None):
        return False
