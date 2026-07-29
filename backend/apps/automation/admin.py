from django.contrib import admin

from .models import AutomationLog, AutomationRule


@admin.register(AutomationRule)
class AutomationRuleAdmin(admin.ModelAdmin):
    list_display = ("name", "project", "trigger", "is_active", "run_count", "last_run_at")
    list_filter = ("trigger", "is_active")
    search_fields = ("name",)


@admin.register(AutomationLog)
class AutomationLogAdmin(admin.ModelAdmin):
    list_display = ("rule_name", "trigger", "task", "ok", "created_at")
    list_filter = ("trigger", "ok")
    readonly_fields = ("rule", "rule_name", "trigger", "task", "project", "actions_run", "ok", "message", "created_at")
