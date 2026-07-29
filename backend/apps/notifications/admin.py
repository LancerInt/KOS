from django.contrib import admin

from .models import Notification, NotificationPreference


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("event", "recipient", "title", "is_read", "requires_acknowledgement", "acknowledged_at", "created_at")
    list_filter = ("event", "is_read", "requires_acknowledgement")
    search_fields = ("title",)


@admin.register(NotificationPreference)
class NotificationPreferenceAdmin(admin.ModelAdmin):
    list_display = ("user", "inapp_enabled", "email_enabled", "daily_digest")
