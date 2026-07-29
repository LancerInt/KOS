from django.apps import AppConfig


class AutomationConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.automation"
    verbose_name = "Automation Engine"

    def ready(self) -> None:
        # Wire event triggers once the app registry is populated (PRD §24).
        from django.db.models.signals import post_save, pre_save

        from apps.approvals.models import ApprovalRequest
        from apps.dependencies.models import Blocker
        from apps.tasks.models import Task

        from . import signals

        pre_save.connect(signals.capture_old_status, sender=Task, dispatch_uid="automation_task_presave")
        post_save.connect(signals.on_task_saved, sender=Task, dispatch_uid="automation_task_postsave")
        post_save.connect(signals.on_blocker_saved, sender=Blocker, dispatch_uid="automation_blocker_postsave")
        post_save.connect(signals.on_approval_saved, sender=ApprovalRequest, dispatch_uid="automation_approval_postsave")
