from django.contrib import admin

from .models import ApprovalRequest


@admin.register(ApprovalRequest)
class ApprovalRequestAdmin(admin.ModelAdmin):
    list_display = ("kind", "target_label", "status", "requested_by", "approver", "acted_at")
    list_filter = ("kind", "status")
    search_fields = ("target_label",)
    readonly_fields = ("acted_at",)
