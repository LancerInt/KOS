"""Auth, MFA and RBAC admin endpoints (PRD §7, §32)."""
from __future__ import annotations

from django.contrib.auth import authenticate
from django.db.models import ProtectedError
from rest_framework import status, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditAction, AuditLog
from apps.audit.services import record

from . import mfa
from .models import Department, Role, Team, User
from .permissions import IsAdministrator
from .serializers import (
    DepartmentSerializer,
    MeSerializer,
    RoleSerializer,
    TeamSerializer,
    UserSerializer,
    UserWriteSerializer,
)


class PeopleDirectoryView(APIView):
    """Active users' names + emails, for recipient pickers (any authenticated
    user). Deliberately minimal — id, name, email only — so it can be open to
    everyone without exposing the full user record."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        users = (
            User.objects.filter(is_active=True).exclude(email="")
            .order_by("first_name", "last_name", "username")
        )
        return Response([
            {"id": u.id, "name": u.get_full_name() or u.username, "email": u.email}
            for u in users
        ])


class LoginView(APIView):
    """Username/password login, enforcing MFA for privileged users (§32).

    Responses:
    * ``{"mfa_required": true}`` — privileged user with MFA enabled, no code sent yet.
    * ``{access, refresh, user, mfa_setup_required}`` — success.
    """

    permission_classes = [AllowAny]
    authentication_classes: list = []

    def post(self, request: Request) -> Response:
        username = request.data.get("username")
        password = request.data.get("password")
        otp = request.data.get("otp")

        user = authenticate(request, username=username, password=password)
        if user is None or not user.is_active:
            return Response(
                {"detail": "Incorrect username or password."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        if user.is_privileged and user.mfa_enabled:
            if not otp:
                return Response({"mfa_required": True}, status=status.HTTP_200_OK)
            if not mfa.verify(user.mfa_secret, otp):
                return Response(
                    {"detail": "Invalid authentication code."},
                    status=status.HTTP_401_UNAUTHORIZED,
                )

        refresh = RefreshToken.for_user(user)
        record(action=AuditAction.LOGIN, actor=user, obj=user, request=request)

        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "user": MeSerializer(user).data,
                # Privileged users without MFA must enrol before doing anything sensitive.
                "mfa_setup_required": user.is_privileged and not user.mfa_enabled,
            }
        )


class LastLoginsView(APIView):
    """Who last signed in — one row per user with their most recent login time
    and source IP, newest first. Admin-only. This is the only login/audit view
    kept in the UI (surfaced from Roles & Access)."""

    permission_classes = [IsAdministrator]

    def get(self, request: Request) -> Response:
        latest = (
            AuditLog.objects.filter(action=AuditAction.LOGIN, actor__isnull=False)
            .order_by("actor_id", "-created_at")
            .distinct("actor_id")
            .select_related("actor")
        )
        rows = [
            {
                "id": e.actor_id,
                "name": e.actor.get_full_name() or e.actor.username,
                "username": e.actor.username,
                "last_login": e.created_at,
                "source_ip": e.source_ip,
            }
            for e in latest
        ]
        rows.sort(key=lambda r: r["last_login"], reverse=True)
        return Response(rows)


class LogoutView(APIView):
    """Blacklist the presented refresh token (§32 — forced logout)."""

    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        token = request.data.get("refresh")
        if not token:
            return Response({"detail": "refresh token required."}, status=400)
        try:
            RefreshToken(token).blacklist()
        except Exception:
            return Response({"detail": "Invalid token."}, status=400)
        return Response(status=status.HTTP_205_RESET_CONTENT)


class MeView(APIView):
    """Current user — identity plus resolved effective capabilities (§7.4)."""

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        return Response(MeSerializer(request.user).data)


class MfaSetupView(APIView):
    """Begin TOTP enrolment: returns a secret + otpauth URI to show as a QR."""

    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        user = request.user
        secret = mfa.new_secret()
        user.mfa_secret = secret
        user.mfa_enabled = False  # not active until a code is verified
        user.save(update_fields=["mfa_secret", "mfa_enabled"])
        return Response(
            {"secret": secret, "otpauth_uri": mfa.provisioning_uri(user, secret)}
        )


class MfaVerifyView(APIView):
    """Confirm enrolment by verifying the first code; activates MFA."""

    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        user = request.user
        code = request.data.get("code", "")
        if not mfa.verify(user.mfa_secret, code):
            return Response({"detail": "Invalid code."}, status=400)
        user.mfa_enabled = True
        user.save(update_fields=["mfa_enabled"])
        record(action=AuditAction.MFA_CHANGE, actor=user, obj=user,
               new_value={"mfa_enabled": True}, request=request)
        return Response({"mfa_enabled": True})


class RoleViewSet(viewsets.ModelViewSet):
    """The dynamic role builder (§7.1). Administrator-only; every change audited (§7.7)."""

    queryset = Role.objects.prefetch_related("role_capabilities", "users").all()
    serializer_class = RoleSerializer
    permission_classes = [IsAdministrator]

    def perform_create(self, serializer):
        role = serializer.save()
        record(action=AuditAction.PERMISSION_CHANGE, obj=role,
               new_value=RoleSerializer(role).data, request=self.request)

    def perform_update(self, serializer):
        old = RoleSerializer(serializer.instance).data
        role = serializer.save()
        record(action=AuditAction.PERMISSION_CHANGE, obj=role,
               old_value=old, new_value=RoleSerializer(role).data, request=self.request)

    def perform_destroy(self, instance):
        record(action=AuditAction.PERMISSION_CHANGE, obj=instance,
               old_value=RoleSerializer(instance).data, request=self.request)
        instance.delete()


class UserViewSet(viewsets.ModelViewSet):
    """User administration. Administrator-only; role assignments audited (§26)."""

    queryset = User.objects.prefetch_related("roles", "teams").all()
    permission_classes = [IsAdministrator]

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return UserWriteSerializer
        return UserSerializer

    def perform_create(self, serializer):
        user = serializer.save()
        record(action=AuditAction.CREATE, obj=user,
               new_value={"roles": list(user.roles.values_list("name", flat=True))},
               request=self.request)

    def perform_update(self, serializer):
        old_roles = list(serializer.instance.roles.values_list("name", flat=True))
        user = serializer.save()
        new_roles = list(user.roles.values_list("name", flat=True))
        if old_roles != new_roles:
            record(action=AuditAction.ROLE_CHANGE, obj=user,
                   old_value={"roles": old_roles}, new_value={"roles": new_roles},
                   request=self.request)

    def perform_destroy(self, instance):
        # Safeguards: never delete yourself, and never orphan protected records
        # (a project owner is PROTECTed). Deactivating is the norm for leavers —
        # it blocks login but preserves their audit trail and attribution (§26).
        if instance.pk == self.request.user.pk:
            raise ValidationError("You cannot delete your own account.")
        uid, label = instance.pk, instance.username
        try:
            instance.delete()
        except ProtectedError:
            raise ValidationError(
                "This user owns projects or other protected records. Reassign those, "
                "or deactivate the user instead of deleting."
            )
        record(action=AuditAction.DELETE, object_type="User", object_id=str(uid),
               old_value={"username": label}, request=self.request)


class DepartmentViewSet(viewsets.ModelViewSet):
    queryset = Department.objects.all()
    serializer_class = DepartmentSerializer
    permission_classes = [IsAdministrator]


class TeamViewSet(viewsets.ModelViewSet):
    queryset = Team.objects.select_related("department").all()
    serializer_class = TeamSerializer
    permission_classes = [IsAdministrator]
