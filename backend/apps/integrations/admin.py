from django.contrib import admin

from .models import ErpConnection, InboundEvent, WebhookDelivery


@admin.register(ErpConnection)
class ErpConnectionAdmin(admin.ModelAdmin):
    list_display = ("name", "base_url", "is_active", "mock_mode", "inbound_enabled", "last_delivery_at")
    list_filter = ("is_active", "mock_mode", "inbound_enabled")
    search_fields = ("name", "base_url")


@admin.register(WebhookDelivery)
class WebhookDeliveryAdmin(admin.ModelAdmin):
    list_display = ("event_type", "connection", "status", "attempts", "response_status", "created_at")
    list_filter = ("status", "event_type")
    readonly_fields = ("connection", "event_type", "object_type", "object_id", "payload",
                       "status", "attempts", "response_status", "response_body", "error",
                       "next_retry_at", "delivered_at", "created_at")


@admin.register(InboundEvent)
class InboundEventAdmin(admin.ModelAdmin):
    list_display = ("event_type", "connection", "status", "created_at")
    list_filter = ("status", "event_type")
    readonly_fields = ("connection", "event_type", "payload", "status", "result", "source_ip", "created_at")
