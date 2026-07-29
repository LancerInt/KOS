from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import Department, Role, RoleCapability, Team, User


class RoleCapabilityInline(admin.TabularInline):
    model = RoleCapability
    extra = 1


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ("name", "default_scope", "is_system")
    list_filter = ("is_system", "default_scope")
    search_fields = ("name",)
    inlines = [RoleCapabilityInline]


@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display = ("name", "code")
    search_fields = ("name", "code")


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
    list_display = ("name", "department")
    list_filter = ("department",)


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    fieldsets = DjangoUserAdmin.fieldsets + (
        ("KOS profile", {"fields": ("phone", "avatar", "department", "teams")}),
        ("Access (dynamic RBAC)", {"fields": ("roles",)}),
        ("MFA", {"fields": ("mfa_enabled",)}),
    )
    filter_horizontal = DjangoUserAdmin.filter_horizontal + ("teams", "roles")
    list_display = ("username", "email", "first_name", "last_name", "is_staff", "mfa_enabled")
