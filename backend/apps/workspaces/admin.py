from django.contrib import admin

from .models import WorkspaceProjectMember, WorkspaceRecord, WorkspaceSection


@admin.register(WorkspaceProjectMember)
class WorkspaceProjectMemberAdmin(admin.ModelAdmin):
    list_display = ("id", "project", "user", "added_by", "created_at")
    list_filter = ("project__workspace",)
    search_fields = ("project__name", "user__username", "user__email")


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
