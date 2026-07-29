from django.contrib import admin

from .models import Document, DocumentDownload, DocumentVersion, SOP, SOPVersion


class DocumentVersionInline(admin.TabularInline):
    model = DocumentVersion
    extra = 0
    fields = ("version_number", "original_filename", "size_bytes", "uploaded_by", "notes", "created_at")
    readonly_fields = ("created_at",)


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ("title", "project", "category", "status", "version_number", "expiry_date")
    list_filter = ("status", "category")
    search_fields = ("title", "tags")
    inlines = [DocumentVersionInline]


@admin.register(DocumentDownload)
class DocumentDownloadAdmin(admin.ModelAdmin):
    list_display = ("version", "user", "downloaded_at", "source_ip")
    readonly_fields = ("version", "user", "downloaded_at", "source_ip")


class SOPVersionInline(admin.TabularInline):
    model = SOPVersion
    extra = 0
    fields = ("version_number", "change_summary", "published_by", "created_at")
    readonly_fields = ("created_at",)


@admin.register(SOP)
class SOPAdmin(admin.ModelAdmin):
    list_display = ("code", "title", "department", "stage", "version_number", "next_review_date")
    list_filter = ("stage", "department")
    search_fields = ("code", "title")
    inlines = [SOPVersionInline]
