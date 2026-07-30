from django.apps import AppConfig


class AIConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.ai"
    verbose_name = "AI Automation"

    def ready(self):
        """Watch tasks for the moment they reach a critical stage.

        Imported inside ``ready`` rather than at module level so the model
        import happens after the app registry is populated. ``dispatch_uid``
        keeps the connection idempotent — ``ready()`` runs more than once under
        the autoreloader and in some test setups.
        """
        from django.db.models.signals import post_save, pre_save

        from apps.tasks.models import Task

        from . import signals

        pre_save.connect(signals.capture_critical_state, sender=Task, dispatch_uid="ai_task_presave")
        post_save.connect(signals.on_task_saved, sender=Task, dispatch_uid="ai_task_postsave")
