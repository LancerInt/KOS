from django.contrib import admin

from .models import Epic, Membership, Milestone, Portfolio, Project, ProjectTemplate


class MembershipInline(admin.TabularInline):
    model = Membership
    extra = 1
    autocomplete_fields = ("user",)


class EpicInline(admin.TabularInline):
    model = Epic
    extra = 0


class MilestoneInline(admin.TabularInline):
    model = Milestone
    extra = 0


@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "project_type", "status", "health", "priority", "owner")
    list_filter = ("project_type", "status", "health", "confidentiality", "portfolio")
    search_fields = ("code", "name")
    inlines = [EpicInline, MilestoneInline, MembershipInline]


@admin.register(Epic)
class EpicAdmin(admin.ModelAdmin):
    list_display = ("title", "project", "order")
    list_filter = ("project",)
    search_fields = ("title",)


@admin.register(Milestone)
class MilestoneAdmin(admin.ModelAdmin):
    list_display = ("title", "project", "epic", "due_date", "status")
    list_filter = ("status", "project")
    search_fields = ("title",)


@admin.register(Portfolio)
class PortfolioAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "owner")
    search_fields = ("code", "name")


@admin.register(ProjectTemplate)
class ProjectTemplateAdmin(admin.ModelAdmin):
    list_display = ("key", "name", "project_type", "is_active")
    search_fields = ("key", "name")


@admin.register(Membership)
class MembershipAdmin(admin.ModelAdmin):
    list_display = ("user", "project", "project_role", "added_by")
    list_filter = ("project_role",)
