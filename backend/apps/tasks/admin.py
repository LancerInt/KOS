from django.contrib import admin

from .models import Activity, ChecklistItem, Comment, Subtask, Task


class SubtaskInline(admin.TabularInline):
    model = Subtask
    extra = 0


class ChecklistItemInline(admin.TabularInline):
    model = ChecklistItem
    extra = 0


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ("title", "project", "status", "priority", "primary_owner", "due_date")
    list_filter = ("status", "priority", "task_type", "project")
    search_fields = ("title",)
    filter_horizontal = ("owners", "collaborators", "watchers")
    inlines = [SubtaskInline, ChecklistItemInline]


@admin.register(Comment)
class CommentAdmin(admin.ModelAdmin):
    list_display = ("task", "author", "created_at")


@admin.register(Activity)
class ActivityAdmin(admin.ModelAdmin):
    list_display = ("task", "actor", "verb", "created_at")
    list_filter = ("verb",)
