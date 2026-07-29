from django.contrib import admin

from .models import Decision, Issue, Risk


@admin.register(Risk)
class RiskAdmin(admin.ModelAdmin):
    list_display = ("statement", "project", "probability", "impact", "score", "status", "owner")
    list_filter = ("status", "probability", "impact", "project")
    search_fields = ("statement",)


@admin.register(Issue)
class IssueAdmin(admin.ModelAdmin):
    list_display = ("description", "project", "severity", "status", "owner", "target_resolution_date")
    list_filter = ("status", "severity", "project")
    search_fields = ("description",)


@admin.register(Decision)
class DecisionAdmin(admin.ModelAdmin):
    list_display = ("decision_required", "project", "status", "decision_maker", "decided_on")
    list_filter = ("status", "project")
    search_fields = ("decision_required",)
