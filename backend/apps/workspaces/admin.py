from django.contrib import admin

from .models import WorkspaceRecord, WorkspaceSection


@admin.register(WorkspaceRecord)
class WorkspaceRecordAdmin(admin.ModelAdmin):
    list_display = ("id", "workspace", "category", "created_by", "created_at")
    list_filter = ("workspace", "category")
    search_fields = ("workspace", "category")


@admin.register(WorkspaceSection)
class WorkspaceSectionAdmin(admin.ModelAdmin):
    list_display = ("id", "workspace", "name", "created_by", "created_at")
    list_filter = ("workspace",)
    search_fields = ("workspace", "name")
