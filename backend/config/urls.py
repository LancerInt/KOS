"""Root URL configuration for KOS."""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

api_patterns = [
    # Core / health
    path("", include("apps.core.urls")),
    # Module 1 — auth, dynamic RBAC, projects & membership
    path("", include("apps.accounts.urls")),
    path("", include("apps.projects.urls")),
    # Module 3 — task engine
    path("", include("apps.tasks.urls")),
    # Module 4 — workflow engine
    path("", include("apps.workflows.urls")),
    # Module 5 — agile & sprints
    path("", include("apps.agile.urls")),
    # Module 6 — dependencies & blockers
    path("", include("apps.dependencies.urls")),
    # Module 7 — approvals
    path("", include("apps.approvals.urls")),
    # Module 8 — notifications & escalation
    path("", include("apps.notifications.urls")),
    # One-to-one direct messages between people
    path("", include("apps.messaging.urls")),
    # Module 9 — registers (risk / issue / decision)
    path("", include("apps.registers.urls")),
    # Module 10 — documents & SOPs
    path("", include("apps.documents.urls")),
    # Module 11 — search, reports & dashboards
    path("", include("apps.reports.urls")),
    # Module 12 — automation engine
    path("", include("apps.automation.urls")),
    # Module 13 — audit & compliance
    path("", include("apps.audit.urls")),
    # Module 14 — ERP integration
    path("", include("apps.integrations.urls")),
    # Module 15 — offline sync
    path("", include("apps.sync.urls")),
    # Module 16 — department modules (CRM/Sales + EPA/regulatory pilots)
    path("", include("apps.crm.urls")),
    path("", include("apps.regulatory.urls")),
    # Sidebar workspaces — flexible per-category records
    path("", include("apps.workspaces.urls")),
    # AI automation — assistant, per-module AI actions, automation & logs
    path("", include("apps.ai.urls")),
    # OpenAPI schema + docs
    path("schema/", SpectacularAPIView.as_view(), name="schema"),
    path("docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include(api_patterns)),
]

# Serve uploaded media in development (document files, avatars).
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
