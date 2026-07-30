"""AI automation models.

Five concerns, kept separate:

* :class:`AISettings`      — the admin-editable configuration singleton.
* :class:`AIRequestLog`    — one row per provider call (cost & latency trail).
* :class:`AIAutomationLog` — one row per automated decision the system acted on.
* :class:`AIConversation`  — assistant chat threads.
* :class:`TaskEscalation`  — the per-task state machine for the reminder ladder.
* :class:`AIReport`        — generated daily / weekly / monthly reports.
* :class:`DailyStandup`    — one person's AI stand-up for one day.
* :class:`ExecutiveSummary`— one organisation-wide executive briefing.
* :class:`OutboundEmail`   — one email this system sent to the outside world.

The two log models answer different questions. The request log answers "what did
we send the vendor and what did it cost"; the automation log answers "why did the
system email my manager at 3am". Auditors want the second one.
"""
from __future__ import annotations

from django.conf import settings
from django.db import models

from apps.core.models import TimeStampedModel

from .providers import provider_choices


class AISettings(models.Model):
    """Singleton configuration row (PRD §34 — configuration over code).

    Everything an administrator can safely change at runtime lives here.
    The API key deliberately does **not**: it is read from the server
    environment so it can never leak through the settings endpoint.
    """

    SINGLETON_PK = 1

    provider = models.CharField(max_length=20, choices=provider_choices, default="grok")
    model = models.CharField(
        max_length=80, blank=True, help_text="Blank uses the provider's default model."
    )
    base_url = models.CharField(
        max_length=200, blank=True, help_text="Override the provider endpoint (self-hosted / proxy)."
    )
    temperature = models.FloatField(default=0.3)
    max_tokens = models.PositiveIntegerField(default=1200)
    timeout_seconds = models.PositiveIntegerField(default=60)

    # --- master switches --------------------------------------------------- #
    is_enabled = models.BooleanField(default=True, help_text="Turn every AI feature off at once.")
    automation_enabled = models.BooleanField(default=True, help_text="Run the scheduled AI scans.")
    email_enabled = models.BooleanField(default=True, help_text="Let automations send email.")

    # --- individual automations -------------------------------------------- #
    overdue_scan_enabled = models.BooleanField(default=True)
    blocked_scan_enabled = models.BooleanField(default=True)
    health_scan_enabled = models.BooleanField(default=True)
    daily_summary_enabled = models.BooleanField(default=True)
    weekly_report_enabled = models.BooleanField(default=True)
    monthly_report_enabled = models.BooleanField(default=True)

    # --- daily stand-up ----------------------------------------------------- #
    # The stand-up beat entry ticks every 15 minutes and this is the gate: the
    # run only proceeds once local time has reached standup_hour:standup_minute.
    # Keeping the *time* here rather than in the crontab is what makes it
    # configurable at runtime without a redeploy or a beat restart.
    standup_enabled = models.BooleanField(default=True, help_text="Generate the AI daily stand-up.")
    standup_hour = models.PositiveSmallIntegerField(
        default=9, help_text="Local hour the stand-up is generated at (0-23)."
    )
    standup_minute = models.PositiveSmallIntegerField(
        default=0, help_text="Local minute the stand-up is generated at (0-59)."
    )
    standup_notify_enabled = models.BooleanField(
        default=True, help_text="Raise an in-app notification when a stand-up is ready."
    )
    standup_email_enabled = models.BooleanField(
        default=True, help_text="Email the stand-up (still honours each user's own preferences)."
    )

    # --- executive summary -------------------------------------------------- #
    executive_summary_enabled = models.BooleanField(
        default=True, help_text="Master switch for the AI executive summary."
    )
    executive_daily_enabled = models.BooleanField(default=True)
    executive_weekly_enabled = models.BooleanField(default=True)
    executive_monthly_enabled = models.BooleanField(default=True)
    executive_email_enabled = models.BooleanField(
        default=True, help_text="Email each generated executive summary to leadership."
    )

    # --- outbound email (user-composed, sent from the AI draft) -------------- #
    # ``email_enabled`` above governs *automation* mail. This governs mail a
    # person composes and sends from the screen, which is a different decision:
    # an administrator may well want to silence the robots while leaving people
    # able to send. Both must be on for the critical-task alert, which is an
    # automation that uses the outbound path.
    outbound_email_enabled = models.BooleanField(
        default=True, help_text="Let users send email to external addresses from KOS."
    )
    outbound_max_recipients = models.PositiveSmallIntegerField(
        default=25, help_text="Most addresses one message may reach across To, Cc and Bcc combined."
    )
    outbound_hourly_limit_per_user = models.PositiveIntegerField(
        default=30, help_text="Messages one user may send per hour. 0 = unlimited."
    )

    # --- critical-stage alerting -------------------------------------------- #
    critical_alert_enabled = models.BooleanField(
        default=True, help_text="Email immediately when a task reaches a critical stage."
    )
    critical_alert_cooldown_hours = models.PositiveIntegerField(
        default=12, help_text="Do not re-alert on the same task within this many hours."
    )
    #: Addresses that are **blind**-copied on every critical alert — a shared
    #: operations mailbox, a duty pager, a compliance archive. Bcc rather than
    #: Cc so the watchers stay invisible to the task's own team.
    critical_alert_bcc = models.TextField(
        blank=True,
        help_text="Comma or newline separated addresses blind-copied on every critical alert.",
    )
    critical_alert_include_managers = models.BooleanField(
        default=True, help_text="Copy the project manager and owner on critical alerts."
    )

    # --- escalation ladder (§ "Automated Features") ------------------------- #
    reminder_repeat_minutes = models.PositiveIntegerField(
        default=30, help_text="Repeat the reminder this many minutes after the first."
    )
    manager_notify_hours = models.PositiveIntegerField(
        default=2, help_text="Notify the project manager after this many hours overdue."
    )
    escalate_hours = models.PositiveIntegerField(
        default=24, help_text="Escalate to project owner / management after this many hours."
    )

    # --- guard rails -------------------------------------------------------- #
    max_calls_per_hour = models.PositiveIntegerField(
        default=500, help_text="Safety cap on provider calls per hour across the whole system. 0 = unlimited."
    )
    max_items_per_scan = models.PositiveIntegerField(
        default=50, help_text="Most records one scheduled scan will process in a single run."
    )

    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        verbose_name = "AI settings"
        verbose_name_plural = "AI settings"

    def __str__(self) -> str:
        return f"AI settings ({self.provider})"

    def save(self, *args, **kwargs):
        # Force the singleton — there is exactly one AI configuration.
        self.pk = self.SINGLETON_PK
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):  # pragma: no cover - guarded by design
        raise RuntimeError("The AI settings row cannot be deleted.")

    @classmethod
    def load(cls) -> "AISettings":
        """The one settings row, seeded from the environment on first access."""
        from django.conf import settings as django_settings

        obj, _ = cls.objects.get_or_create(
            pk=cls.SINGLETON_PK,
            defaults={
                "provider": getattr(django_settings, "AI_DEFAULT_PROVIDER", "grok"),
                "model": getattr(django_settings, "AI_DEFAULT_MODEL", ""),
            },
        )
        return obj


class AIAction(models.TextChoices):
    """Every distinct thing the ERP asks the AI to do — the log's vocabulary."""

    CHAT = "chat", "Chat"
    SUMMARIZE = "summarize", "Summarize"
    REWRITE = "rewrite", "Rewrite"
    TRANSLATE = "translate", "Translate"
    GENERATE_EMAIL = "generate_email", "Generate email"
    ANALYSE_TASKS = "analyse_tasks", "Analyse tasks"
    ANALYSE_PROJECT = "analyse_project", "Analyse project"
    GENERATE_NOTIFICATIONS = "generate_notifications", "Generate notifications"
    CREATE_TASKS_FROM_NOTES = "create_tasks_from_notes", "Create tasks from notes"
    PROJECT_SUMMARY = "project_summary", "Project summary"
    RISK_ANALYSIS = "risk_analysis", "Risk analysis"
    DELAY_PREDICTION = "delay_prediction", "Delay prediction"
    HEALTH_SCORE = "health_score", "Health score"
    SUBTASKS = "subtasks", "Generate subtasks"
    ESTIMATE = "estimate", "Estimate effort"
    PRIORITIZE = "prioritize", "Prioritise"
    MEETING_SUMMARY = "meeting_summary", "Meeting summary"
    CUSTOMER_SUMMARY = "customer_summary", "Customer summary"
    DRAFT_REPLY = "draft_reply", "Draft customer reply"
    PROPOSAL = "proposal", "Generate proposal"
    JOB_DESCRIPTION = "job_description", "Job description"
    PERFORMANCE_SUMMARY = "performance_summary", "Performance summary"
    INSIGHTS = "insights", "Dashboard insights"
    EXPLAIN_STATS = "explain_stats", "Explain statistics"
    REPORT = "report", "Generate report"
    DUPLICATE_DETECTION = "duplicate_detection", "Duplicate detection"
    WORKLOAD = "workload", "Workload balancing"
    DAILY_STANDUP = "daily_standup", "Daily stand-up"
    EXECUTIVE_SUMMARY = "executive_summary", "Executive summary"


class AIRequestLog(models.Model):
    """One provider call. Written for every call, successful or not (spec:
    "All automations must be logged")."""

    action = models.CharField(max_length=40, choices=AIAction.choices, db_index=True)
    provider = models.CharField(max_length=20)
    model = models.CharField(max_length=80, blank=True)

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="ai_requests"
    )
    #: Free-form pointer to what the call was about, e.g. "Project:12".
    subject_type = models.CharField(max_length=60, blank=True)
    subject_id = models.CharField(max_length=40, blank=True)

    ok = models.BooleanField(default=True)
    error = models.CharField(max_length=400, blank=True)
    structured = models.BooleanField(default=False, help_text="Response parsed as valid JSON.")

    prompt_chars = models.PositiveIntegerField(default=0)
    prompt_tokens = models.PositiveIntegerField(default=0)
    completion_tokens = models.PositiveIntegerField(default=0)
    latency_ms = models.PositiveIntegerField(default=0)

    #: Truncated for storage — the full text is never needed after the fact.
    response_preview = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["action", "created_at"])]

    def __str__(self) -> str:
        return f"{self.action} via {self.provider} [{'ok' if self.ok else 'error'}]"

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


class AutomationEvent(models.TextChoices):
    OVERDUE_REMINDER = "overdue_reminder", "Overdue reminder"
    OVERDUE_REPEAT = "overdue_repeat", "Repeat reminder"
    MANAGER_NOTIFIED = "manager_notified", "Manager notified"
    ESCALATED = "escalated", "Escalated"
    BLOCKED_TASK = "blocked_task", "Blocked task"
    HIGH_PRIORITY = "high_priority", "High-priority task attention"
    SLA_VIOLATION = "sla_violation", "SLA violation"
    PROJECT_HEALTH = "project_health", "Project health analysis"
    CRITICAL_STATUS = "critical_status", "Critical status"
    CRITICAL_TASK = "critical_task", "Task reached a critical stage"
    DAILY_SUMMARY = "daily_summary", "Daily summary"
    WEEKLY_REPORT = "weekly_report", "Weekly report"
    MONTHLY_REPORT = "monthly_report", "Monthly report"
    MILESTONE_MISSED = "milestone_missed", "Milestone missed"
    DAILY_STANDUP = "daily_standup", "Daily stand-up"
    EXECUTIVE_SUMMARY = "executive_summary", "Executive summary"


class AIAutomationLog(models.Model):
    """One automated decision, with the AI response and what was executed.

    This is the record an auditor reads: time, event, what the AI said, what the
    system then did, and whether it worked.
    """

    event = models.CharField(max_length=30, choices=AutomationEvent.choices, db_index=True)
    task = models.ForeignKey(
        "tasks.Task", on_delete=models.SET_NULL, null=True, blank=True, related_name="ai_automation_logs"
    )
    project = models.ForeignKey(
        "projects.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="ai_automation_logs"
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="ai_automation_logs"
    )

    ai_response = models.JSONField(default=dict, blank=True)
    executed_actions = models.JSONField(
        default=list, blank=True, help_text='e.g. ["notified:3", "email:2", "priority:high"]'
    )
    ok = models.BooleanField(default=True)
    message = models.CharField(max_length=400, blank=True)

    request_log = models.ForeignKey(
        AIRequestLog, on_delete=models.SET_NULL, null=True, blank=True, related_name="automation_logs"
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["event", "created_at"])]

    def __str__(self) -> str:
        return f"{self.event} [{'ok' if self.ok else 'failed'}] {self.created_at:%Y-%m-%d %H:%M}"


class EmailStatus(models.TextChoices):
    QUEUED = "queued", "Queued"
    SENT = "sent", "Sent"
    FAILED = "failed", "Failed"


class OutboundEmail(TimeStampedModel):
    """One email KOS sent to the outside world.

    Distinct from :class:`apps.notifications.models.Notification`, which is
    in-app messaging to KOS users. This is mail leaving the building — to a
    customer's Gmail, a supplier, a regulator — so it is stored in full rather
    than as a delivery flag. Two reasons that matters:

    * **Accountability.** "Who emailed the client that date?" has to have an
      answer, and it has to include the Bcc list, which is invisible everywhere
      else by definition.
    * **Retry.** SMTP fails transiently. A failed row keeps its body and its
      error, so sending again is a re-send, not a re-compose.

    Recipients are stored as JSON lists rather than a comma string because
    "did this address receive it" must be answerable without parsing.
    """

    class Source(models.TextChoices):
        #: A person composed and sent it from a screen.
        MANUAL = "manual", "Sent by a user"
        #: An automation sent it — currently only the critical-task alert.
        CRITICAL_ALERT = "critical_alert", "Critical task alert"

    to = models.JSONField(default=list)
    cc = models.JSONField(default=list, blank=True)
    bcc = models.JSONField(default=list, blank=True)
    reply_to = models.CharField(max_length=320, blank=True)

    subject = models.CharField(max_length=300)
    body = models.TextField()

    source = models.CharField(max_length=20, choices=Source.choices, default=Source.MANUAL)
    #: Null for automation-sent mail — nobody pressed anything.
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="sent_emails",
    )

    task = models.ForeignKey(
        "tasks.Task", on_delete=models.SET_NULL, null=True, blank=True, related_name="outbound_emails"
    )
    project = models.ForeignKey(
        "projects.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="outbound_emails"
    )
    #: The draft this was sent from, when the AI wrote it. Null when hand-typed.
    draft_log = models.ForeignKey(
        AIRequestLog, on_delete=models.SET_NULL, null=True, blank=True, related_name="sent_emails"
    )

    status = models.CharField(max_length=10, choices=EmailStatus.choices, default=EmailStatus.QUEUED, db_index=True)
    error = models.CharField(max_length=400, blank=True)
    attempts = models.PositiveSmallIntegerField(default=0)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-created_at",)
        indexes = [
            models.Index(fields=["status", "created_at"]),
            models.Index(fields=["sender", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.subject} → {', '.join(self.to)[:80]} [{self.status}]"

    @property
    def recipient_count(self) -> int:
        return len(self.to) + len(self.cc) + len(self.bcc)


class AIConversation(TimeStampedModel):
    """A chat thread in the assistant panel."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ai_conversations"
    )
    title = models.CharField(max_length=200, blank=True)
    #: Where the thread was started, so the assistant can stay page-aware.
    page_path = models.CharField(max_length=300, blank=True)
    project = models.ForeignKey(
        "projects.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="ai_conversations"
    )

    class Meta:
        ordering = ("-updated_at",)

    def __str__(self) -> str:
        return self.title or f"Conversation {self.pk}"


class AIMessage(models.Model):
    class Role(models.TextChoices):
        USER = "user", "User"
        ASSISTANT = "assistant", "Assistant"

    conversation = models.ForeignKey(AIConversation, on_delete=models.CASCADE, related_name="messages")
    role = models.CharField(max_length=10, choices=Role.choices)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ("created_at", "id")

    def __str__(self) -> str:
        return f"{self.role}: {self.content[:50]}"


class EscalationStage(models.IntegerChoices):
    """How far up the ladder an overdue task has climbed."""

    NONE = 0, "Not yet reminded"
    REMINDED = 1, "Owner reminded"
    REPEATED = 2, "Reminder repeated"
    MANAGER = 3, "Manager notified"
    ESCALATED = 4, "Escalated to management"


class TaskEscalation(models.Model):
    """Per-task escalation state.

    The five-minute scan is stateless by itself; this row is what makes it
    idempotent. Without it a task that stays overdue for a week would be
    emailed about every five minutes.
    """

    task = models.OneToOneField("tasks.Task", on_delete=models.CASCADE, related_name="ai_escalation")
    stage = models.IntegerField(choices=EscalationStage.choices, default=EscalationStage.NONE)

    first_detected_at = models.DateTimeField(null=True, blank=True)
    last_reminder_at = models.DateTimeField(null=True, blank=True)
    manager_notified_at = models.DateTimeField(null=True, blank=True)
    escalated_at = models.DateTimeField(null=True, blank=True)
    reminder_count = models.PositiveIntegerField(default=0)

    #: Cleared when the task is completed, so a reopened task escalates afresh.
    resolved_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-updated_at",)

    def __str__(self) -> str:
        return f"Escalation for task {self.task_id} at stage {self.stage}"

    def reset(self) -> None:
        self.stage = EscalationStage.NONE
        self.first_detected_at = None
        self.last_reminder_at = None
        self.manager_notified_at = None
        self.escalated_at = None
        self.reminder_count = 0
        self.resolved_at = None


class ReportPeriod(models.TextChoices):
    DAILY = "daily", "Daily"
    WEEKLY = "weekly", "Weekly"
    MONTHLY = "monthly", "Monthly"


class AIReport(TimeStampedModel):
    """A generated report, kept so users can read it in-app as well as by email."""

    period = models.CharField(max_length=10, choices=ReportPeriod.choices, db_index=True)
    title = models.CharField(max_length=240)
    #: Null for organisation-wide reports.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, null=True, blank=True, related_name="ai_reports"
    )
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, null=True, blank=True, related_name="ai_reports"
    )

    period_start = models.DateField()
    period_end = models.DateField()

    content = models.JSONField(default=dict, blank=True, help_text="Structured report body from the AI.")
    metrics = models.JSONField(default=dict, blank=True, help_text="The figures the report was built from.")
    emailed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ("-period_end", "-created_at")
        indexes = [models.Index(fields=["period", "period_end"])]

    def __str__(self) -> str:
        return f"{self.get_period_display()} report · {self.title}"


class GenerationTrigger(models.TextChoices):
    """Why a stand-up or executive summary was generated.

    Kept on the row itself because "the 9am job produced this" and "a manager
    pressed the button at 14:30" are answers to different questions, and the
    execution log is the only other place that distinction survives.
    """

    SCHEDULED = "scheduled", "Scheduled"
    MANUAL = "manual", "Manual"


class GeneratedBriefing(TimeStampedModel):
    """Shared behaviour of the two AI briefings.

    Both are "run something expensive, store the result, record how the run
    went" — so the execution record (timing, AI status, delivery status) is
    modelled once here rather than duplicated in each table.
    """

    content = models.JSONField(default=dict, blank=True, help_text="Structured body from the AI.")
    metrics = models.JSONField(default=dict, blank=True, help_text="The figures it was built from.")

    trigger = models.CharField(
        max_length=10, choices=GenerationTrigger.choices, default=GenerationTrigger.SCHEDULED
    )
    generated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
        help_text="Who pressed the button. Null for scheduled runs.",
    )

    #: False when the provider was unavailable and deterministic copy was used
    #: instead — the briefing is still valid, just not AI-written.
    ai_ok = models.BooleanField(default=True)
    error = models.CharField(max_length=400, blank=True)
    duration_ms = models.PositiveIntegerField(default=0)
    request_log = models.ForeignKey(
        AIRequestLog, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    notified_at = models.DateTimeField(null=True, blank=True)
    emailed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        abstract = True


class DailyStandup(GeneratedBriefing):
    """One person's stand-up for one day.

    ``(user, standup_date)`` is unique, which is what makes this row the cache:
    the scheduled job and the "Refresh" button both look here first, so a day's
    stand-up costs exactly one provider call unless someone asks for a
    regeneration explicitly.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ai_standups"
    )
    standup_date = models.DateField(db_index=True)
    #: Bumped by each explicit regeneration, so the UI can say "regenerated".
    generation_count = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ("-standup_date", "-created_at")
        constraints = [
            models.UniqueConstraint(fields=["user", "standup_date"], name="unique_standup_per_user_per_day")
        ]
        indexes = [models.Index(fields=["user", "standup_date"])]

    def __str__(self) -> str:
        return f"Stand-up for {self.user_id} on {self.standup_date}"

    @property
    def greeting(self) -> str:
        return str(self.content.get("greeting") or "")


class ExecutiveSummary(GeneratedBriefing):
    """An organisation-wide executive briefing for one period.

    Unique on ``(period, period_end)`` for the same reason as the stand-up: the
    Monday weekly job and a manager pressing "Generate" on Monday afternoon must
    not produce two different versions of the same week.
    """

    period = models.CharField(max_length=10, choices=ReportPeriod.choices, db_index=True)
    period_start = models.DateField()
    period_end = models.DateField()

    title = models.CharField(max_length=240, blank=True)
    #: Denormalised from ``content`` so the list endpoint and charts do not have
    #: to parse every JSON body to draw a trend line.
    health_score = models.PositiveSmallIntegerField(default=0)
    risk_count = models.PositiveSmallIntegerField(default=0)
    generation_count = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ("-period_end", "-created_at")
        constraints = [
            models.UniqueConstraint(fields=["period", "period_end"], name="unique_executive_summary_per_period")
        ]
        indexes = [models.Index(fields=["period", "period_end"])]

    def __str__(self) -> str:
        return f"{self.get_period_display()} executive summary · {self.period_end}"
