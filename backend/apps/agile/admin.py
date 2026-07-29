from django.contrib import admin

from .models import RetrospectiveItem, Sprint


class RetroInline(admin.TabularInline):
    model = RetrospectiveItem
    extra = 0


@admin.register(Sprint)
class SprintAdmin(admin.ModelAdmin):
    list_display = ("name", "project", "status", "start_date", "end_date", "is_baselined")
    list_filter = ("status", "is_baselined", "project")
    search_fields = ("name",)
    inlines = [RetroInline]


@admin.register(RetrospectiveItem)
class RetrospectiveItemAdmin(admin.ModelAdmin):
    list_display = ("sprint", "kind", "owner", "due_date")
    list_filter = ("kind",)
