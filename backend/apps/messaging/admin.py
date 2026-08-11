from django.contrib import admin

from .models import Conversation, DirectMessage


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ("id", "user_low", "user_high", "started_by", "last_message_at")
    list_select_related = ("user_low", "user_high", "started_by")
    search_fields = ("user_low__username", "user_high__username")


@admin.register(DirectMessage)
class DirectMessageAdmin(admin.ModelAdmin):
    list_display = ("id", "conversation", "sender", "created_at", "read_at")
    list_select_related = ("conversation", "sender")
    list_filter = ("created_at",)
