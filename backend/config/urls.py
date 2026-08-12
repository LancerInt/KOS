"""Root URL configuration for KOS."""
from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path
from django.views.static import serve as media_serve
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

# Serve uploaded media (message/record attachments, document files, avatars) in
# every environment. Django's static() helper only wires this up under DEBUG, so
# on Render (DEBUG off) uploads wouldn't load at all; serve them explicitly.
# NOTE: these URLs are public-by-link (no per-file auth) and, on the free tier's
# ephemeral disk, don't survive a redeploy — the same as existing attachments.
urlpatterns += [
    re_path(r"^media/(?P<path>.*)$", media_serve, {"document_root": settings.MEDIA_ROOT}),
]
