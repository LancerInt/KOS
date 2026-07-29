from django.contrib import admin

from .models import Contact, Customer, Opportunity


class ContactInline(admin.TabularInline):
    model = Contact
    extra = 0


@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ("name", "customer_type", "status", "owner")
    list_filter = ("status", "customer_type")
    search_fields = ("name",)
    inlines = [ContactInline]


@admin.register(Opportunity)
class OpportunityAdmin(admin.ModelAdmin):
    list_display = ("title", "customer", "stage", "amount", "currency", "owner", "project")
    list_filter = ("stage",)
    search_fields = ("title", "customer__name")
