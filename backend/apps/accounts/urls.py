from django.urls import path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from .views import (
    DepartmentViewSet,
    LastLoginsView,
    LoginView,
    LogoutView,
    MeView,
    MfaSetupView,
    MfaVerifyView,
    RoleViewSet,
    TeamViewSet,
    UserViewSet,
)

router = DefaultRouter()
router.register("users", UserViewSet, basename="user")
router.register("roles", RoleViewSet, basename="role")
router.register("departments", DepartmentViewSet, basename="department")
router.register("teams", TeamViewSet, basename="team")

urlpatterns = [
    path("auth/login/", LoginView.as_view(), name="login"),
    path("auth/refresh/", TokenRefreshView.as_view(), name="token-refresh"),
    path("auth/logout/", LogoutView.as_view(), name="logout"),
    path("auth/me/", MeView.as_view(), name="me"),
    path("auth/mfa/setup/", MfaSetupView.as_view(), name="mfa-setup"),
    path("auth/mfa/verify/", MfaVerifyView.as_view(), name="mfa-verify"),
    path("auth/last-logins/", LastLoginsView.as_view(), name="last-logins"),
    *router.urls,
]
