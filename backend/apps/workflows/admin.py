from django.contrib import admin

from .models import Workflow, WorkflowStatus, WorkflowTransition


class WorkflowStatusInline(admin.TabularInline):
    model = WorkflowStatus
    extra = 0


class WorkflowTransitionInline(admin.TabularInline):
    model = WorkflowTransition
    extra = 0
    autocomplete_fields = ("from_status", "to_status")


@admin.register(Workflow)
class WorkflowAdmin(admin.ModelAdmin):
    list_display = ("name", "project", "is_template")
    list_filter = ("is_template",)
    inlines = [WorkflowStatusInline, WorkflowTransitionInline]


@admin.register(WorkflowStatus)
class WorkflowStatusAdmin(admin.ModelAdmin):
    list_display = ("label", "key", "category", "workflow", "is_initial")
    list_filter = ("category",)
    search_fields = ("label", "key")
