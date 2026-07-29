from django.apps import AppConfig


class IntegrationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.integrations"
    verbose_name = "ERP Integration"

    def ready(self) -> None:
        # Publish outbound events from live model changes (PRD §27.2).
        from django.db.models.signals import post_save, pre_save

        from apps.approvals.models import ApprovalRequest
        from apps.projects.models import Project
        from apps.tasks.models import Task

        from . import signals

        pre_save.connect(signals.capture_task_status, sender=Task, dispatch_uid="erp_task_presave")
        post_save.connect(signals.on_task_saved, sender=Task, dispatch_uid="erp_task_postsave")
        post_save.connect(signals.on_project_saved, sender=Project, dispatch_uid="erp_project_postsave")
        post_save.connect(signals.on_approval_saved, sender=ApprovalRequest, dispatch_uid="erp_approval_postsave")
