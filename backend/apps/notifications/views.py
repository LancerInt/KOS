"""Notification & preference endpoints (PRD §22)."""
from __future__ import annotations

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import get_connection, send_mail
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsAdministrator
from apps.audit.models import AuditAction
from apps.audit.services import record

from .models import EmailAccount, Notification, NotificationEvent
from .serializers import (
    EmailAccountSerializer, NotificationPreferenceSerializer, NotificationSerializer,
)
from .services import get_prefs, notify_many

User = get_user_model()

# Oversight teams that receive a copy of every acknowledgement.
ACK_OVERSIGHT_ROLES = ["Management", "IT Team"]


class NotificationViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["is_read", "event", "requires_acknowledgement"]

    def get_queryset(self):
        # Lazily raise "duration complete" notifications for the viewer's own
        # Entomology projects, so they surface without a running scheduler.
        try:
            from apps.workspaces.duration import sync_due_durations
            sync_due_durations(self.request.user)
        except Exception:
            pass
        return Notification.objects.filter(recipient=self.request.user)

    @action(detail=False, methods=["get"])
    def unread_count(self, request):
        qs = self.get_queryset().filter(is_read=False)
        return Response({
            "unread": qs.count(),
            "needs_ack": qs.filter(requires_acknowledgement=True, acknowledged_at__isnull=True).count(),
        })

    @action(detail=True, methods=["post"])
    def mark_read(self, request, pk=None):
        n = self.get_object()
        n.is_read = True
        n.save(update_fields=["is_read"])
        return Response(NotificationSerializer(n).data)

    @action(detail=False, methods=["post"])
    def mark_all_read(self, request):
        self.get_queryset().filter(is_read=False).update(is_read=True)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def acknowledge(self, request, pk=None):
        """Return the mandatory status message for a 48-hour notification (§22.4)."""
        n = self.get_object()
        if not n.requires_acknowledgement:
            raise ValidationError("This notification does not require acknowledgement.")
        message = (request.data.get("message") or "").strip()
        if not message:
            raise ValidationError({"message": "An acknowledgement message is required."})
        n.acknowledged_at = timezone.now()
        n.acknowledgement_message = message
        n.is_read = True
        n.save(update_fields=["acknowledged_at", "acknowledgement_message", "is_read"])
        record(action=AuditAction.NOTIFICATION_ACK, obj=n.task or n,
               new_value={"message": message}, request=request)
        # Route the acknowledgement to the oversight teams (Management + IT Team)
        # so someone above actually sees the response — the acknowledger is skipped.
        actor = request.user
        actor_name = actor.get_full_name() or actor.username
        oversight = User.objects.filter(roles__name__in=ACK_OVERSIGHT_ROLES).distinct()
        notify_many(
            oversight, exclude=[actor],
            event=NotificationEvent.ACK_RECEIVED,
            title=f"{actor_name} acknowledged: {n.title}",
            body=message,
            url=n.url,
        )
        return Response(NotificationSerializer(n).data)


class NotificationPreferenceView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        return Response(NotificationPreferenceSerializer(get_prefs(request.user)).data)

    def put(self, request: Request) -> Response:
        pref = get_prefs(request.user)
        serializer = NotificationPreferenceSerializer(pref, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class EmailAccountView(APIView):
    """Configure the KOS outbound email account (Integrations → Email). Admins
    only; the stored password is never returned."""

    permission_classes = [IsAuthenticated, IsAdministrator]

    def get(self, request: Request) -> Response:
        return Response(EmailAccountSerializer(EmailAccount.load()).data)

    def put(self, request: Request) -> Response:
        account = EmailAccount.load()
        serializer = EmailAccountSerializer(account, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        record(action=AuditAction.UPDATE, object_type="EmailAccount", object_id="1",
               new_value={"username": account.username, "is_enabled": account.is_enabled}, request=request)
        return Response(EmailAccountSerializer(account).data)


class EmailAccountTestView(APIView):
    """Send a test email using the posted form values (falling back to the saved
    account), so an admin can verify before saving/enabling."""

    permission_classes = [IsAuthenticated, IsAdministrator]

    def post(self, request: Request) -> Response:
        account = EmailAccount.load()
        data = request.data
        to = (data.get("to") or request.user.email or "").strip()
        if not to:
            raise ValidationError({"to": "Enter an address to send the test to."})
        host = (data.get("host") or account.host or "").strip()
        try:
            port = int(data.get("port") or account.port or 587)
        except (TypeError, ValueError):
            port = 587
        use_tls = data.get("use_tls", account.use_tls)
        if isinstance(use_tls, str):
            use_tls = use_tls.lower() in ("true", "1", "yes")
        username = (data.get("username") or account.username or "").strip()
        password = data.get("password") or account.get_password()
        from_email = (data.get("from_email") or username or settings.DEFAULT_FROM_EMAIL).strip()
        if not (host and username and password):
            raise ValidationError("Enter the sender email, password and host before sending a test.")
        try:
            connection = get_connection(
                backend="django.core.mail.backends.smtp.EmailBackend",
                host=host, port=port, username=username, password=password,
                use_tls=bool(use_tls), fail_silently=False,
            )
            send_mail(
                "[KOS] Test email",
                "This is a test from KOS. Your email integration is working.",
                from_email, [to], connection=connection, fail_silently=False,
            )
        except Exception as exc:  # surface the SMTP error to the admin
            return Response({"ok": False, "detail": f"Could not send: {exc}"[:300]},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response({"ok": True, "detail": f"Test email sent to {to}."})
