"""The ERP-facing AI service.

Every view, Celery task and department module calls into this module — never
into a provider class and never into a vendor SDK. In exchange it guarantees
four things on every call:

1. the configured provider is used (swappable without touching callers);
2. the call is logged to :class:`AIRequestLog`, success or failure;
3. global kill-switches and the hourly rate cap are honoured;
4. failures raise :class:`AIUnavailable`, which callers can render or ignore —
   an AI outage never breaks an ERP request.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, Callable, Sequence

from django.utils import timezone

from . import context as ctx
from . import prompts, schemas
from .models import AIAction, AIRequestLog, AISettings
from .providers import AIProvider, AIProviderError, AIResult, get_provider

logger = logging.getLogger(__name__)

RESPONSE_PREVIEW_CHARS = 4000


class AIUnavailable(RuntimeError):
    """AI could not be used for this call — disabled, rate-limited or upstream error.

    Carries a message safe to show a user.
    """


@dataclass
class AIOutcome:
    """What a service call produced, plus the log row it wrote."""

    data: dict[str, Any] = field(default_factory=dict)
    text: str = ""
    structured: bool = False
    provider: str = ""
    model: str = ""
    log_id: int | None = None

    def get(self, key: str, default=None):
        return self.data.get(key, default)


# --------------------------------------------------------------------------- #
# Core plumbing
# --------------------------------------------------------------------------- #
def _rate_limited(config: AISettings) -> bool:
    if not config.max_calls_per_hour:
        return False
    since = timezone.now() - timedelta(hours=1)
    return AIRequestLog.objects.filter(created_at__gte=since).count() >= config.max_calls_per_hour


def _subject(obj) -> tuple[str, str]:
    if obj is None:
        return "", ""
    return obj.__class__.__name__, str(getattr(obj, "pk", "") or "")


def run(
    action: str,
    call: Callable[[AIProvider], AIResult],
    *,
    user=None,
    subject=None,
    prompt_chars: int = 0,
    config: AISettings | None = None,
) -> AIOutcome:
    """Execute one provider call with logging, guard rails and error mapping.

    ``call`` receives the provider and returns its :class:`AIResult`; keeping the
    prompt construction in the caller means this wrapper stays generic while
    still owning every cross-cutting concern.
    """
    config = config or AISettings.load()
    subject_type, subject_id = _subject(subject)

    if not config.is_enabled:
        raise AIUnavailable("AI features are currently switched off for this system.")
    if _rate_limited(config):
        raise AIUnavailable(
            f"The hourly AI request limit ({config.max_calls_per_hour}) has been reached. "
            "Try again shortly or raise the limit in AI settings."
        )

    provider = get_provider(config)

    try:
        result = call(provider)
    except AIProviderError as exc:
        AIRequestLog.objects.create(
            action=action, provider=provider.name, model=provider.model, user=user,
            subject_type=subject_type, subject_id=subject_id,
            ok=False, error=str(exc)[:400], prompt_chars=prompt_chars,
        )
        logger.warning("AI call %s failed: %s", action, exc)
        raise AIUnavailable(str(exc)) from exc
    except Exception as exc:  # defensive: a bug here must not 500 an ERP request
        AIRequestLog.objects.create(
            action=action, provider=provider.name, model=provider.model, user=user,
            subject_type=subject_type, subject_id=subject_id,
            ok=False, error=f"{type(exc).__name__}: {exc}"[:400], prompt_chars=prompt_chars,
        )
        logger.exception("Unexpected error during AI call %s", action)
        raise AIUnavailable("The AI service failed unexpectedly. The error has been logged.") from exc

    log = AIRequestLog.objects.create(
        action=action, provider=result.provider, model=result.model, user=user,
        subject_type=subject_type, subject_id=subject_id,
        ok=True, structured=result.structured,
        prompt_chars=prompt_chars,
        prompt_tokens=result.prompt_tokens, completion_tokens=result.completion_tokens,
        latency_ms=result.latency_ms,
        response_preview=result.text[:RESPONSE_PREVIEW_CHARS],
    )
    return AIOutcome(
        data=result.data, text=result.text, structured=result.structured,
        provider=result.provider, model=result.model, log_id=log.pk,
    )


def _json(action, prompt, *, system, schema, user=None, subject=None, config=None,
          temperature=None, max_tokens=None) -> AIOutcome:
    """Shorthand for the many features that are 'one prompt, one JSON shape'."""
    return run(
        action,
        lambda p: p.complete_json(
            prompt, system=system, schema=schema, temperature=temperature, max_tokens=max_tokens
        ),
        user=user, subject=subject, prompt_chars=len(prompt), config=config,
    )


def provider_status() -> dict:
    """What the settings screen shows about the current provider."""
    from .providers import api_key_for

    config = AISettings.load()
    provider = get_provider(config)
    return {
        "enabled": config.is_enabled,
        "configured_provider": config.provider,
        "active_provider": provider.name,
        "model": provider.model,
        "key_configured": bool(api_key_for(config.provider)),
        "offline_fallback": provider.name == "mock" and config.provider != "mock",
        "automation_enabled": config.automation_enabled,
    }


# --------------------------------------------------------------------------- #
# The seven core operations
# --------------------------------------------------------------------------- #
def summarize(text: str, *, style="brief", audience="the project team", instructions="",
              user=None, subject=None, action=AIAction.SUMMARIZE) -> AIOutcome:
    return run(
        action,
        lambda p: p.summarize(text, style=style, audience=audience, instructions=instructions),
        user=user, subject=subject, prompt_chars=len(text),
    )


def chat(message: str, *, history: Sequence[dict] = (), context: str = "", user=None) -> AIOutcome:
    return run(
        AIAction.CHAT,
        lambda p: p.chat(message, history=history, context=context),
        user=user, prompt_chars=len(message) + len(context),
    )


def generate_email(purpose: str, *, context: str = "", tone="professional", recipient="",
                   sender="", language="English", user=None, subject=None) -> AIOutcome:
    return run(
        AIAction.GENERATE_EMAIL,
        lambda p: p.generate_email(
            purpose, context=context, tone=tone, recipient=recipient, sender=sender, language=language
        ),
        user=user, subject=subject, prompt_chars=len(purpose) + len(context),
    )


def analyse_tasks(tasks, *, goal: str = "", user=None, subject=None, config=None) -> AIOutcome:
    body = ctx.tasks_context(tasks)
    return run(
        AIAction.ANALYSE_TASKS,
        lambda p: p.analyse_tasks(body, goal=goal),
        user=user, subject=subject, prompt_chars=len(body), config=config,
    )


def analyse_project(project, *, goal: str = "", user=None, config=None) -> AIOutcome:
    body = ctx.project_context(project)
    people = ctx.people_context(project)
    if people:
        body = f"{body}\n\n{people}"
    return run(
        AIAction.ANALYSE_PROJECT,
        lambda p: p.analyse_project(body, goal=goal),
        user=user, subject=project, prompt_chars=len(body), config=config,
    )


def generate_notifications(events: str, *, audience: str = "", user=None, subject=None,
                           config=None) -> AIOutcome:
    return run(
        AIAction.GENERATE_NOTIFICATIONS,
        lambda p: p.generate_notifications(events, audience=audience),
        user=user, subject=subject, prompt_chars=len(events), config=config,
    )


def create_tasks_from_notes(notes: str, *, context: str = "", user=None, subject=None) -> AIOutcome:
    return run(
        AIAction.CREATE_TASKS_FROM_NOTES,
        lambda p: p.create_tasks_from_notes(notes, context=context),
        user=user, subject=subject, prompt_chars=len(notes) + len(context),
    )


# --------------------------------------------------------------------------- #
# Feature operations — all built on the same primitives
# --------------------------------------------------------------------------- #
def rewrite(text: str, *, instruction: str = "", tone: str = "clear and professional",
            user=None, subject=None) -> AIOutcome:
    prompt = (
        f"Rewrite the text below to be {tone}. Keep every fact, name, number and date exactly as "
        "given; improve clarity, grammar and structure only."
        + (f"\n\n### Extra instruction\n{instruction}" if instruction else "")
        + f"\n\n### Text\n{text}"
    )
    return _json(AIAction.REWRITE, prompt, system=prompts.BASE_SYSTEM, schema=schemas.REWRITE, user=user, subject=subject)


def translate(text: str, *, language: str, user=None, subject=None) -> AIOutcome:
    prompt = (
        f"Translate the text below into {language}. Preserve formatting, names, numbers and "
        f"technical terms.\n\n### Text\n{text}"
    )
    return _json(AIAction.TRANSLATE, prompt, system=prompts.BASE_SYSTEM, schema=schemas.TRANSLATE,
                 user=user, subject=subject)


def improve_grammar(text: str, *, user=None, subject=None) -> AIOutcome:
    return rewrite(
        text,
        instruction="Correct grammar, spelling and punctuation only. Do not change the wording, "
                    "tone or meaning beyond what correctness requires.",
        tone="grammatically correct",
        user=user,
        subject=subject,
    )


def project_summary(project, *, user=None) -> AIOutcome:
    body = ctx.project_context(project)
    prompt = (
        "Write a status summary of this project for its stakeholders — where it stands, what has "
        "been achieved, what is outstanding and what needs attention."
        f"\n\n### Project data\n{body}"
    )
    return _json(AIAction.PROJECT_SUMMARY, prompt, system=prompts.SUMMARIZE_SYSTEM,
                 schema=schemas.SUMMARY, user=user, subject=project)


def generate_subtasks(task, *, count: int = 6, user=None) -> AIOutcome:
    prompt = (
        f"Break this task into at most {count} concrete subtasks that together complete it. "
        "Each subtask must be a single actionable step, ordered so it can be worked top to bottom. "
        "Do not repeat subtasks that already exist."
        f"\n\n### Task\n{ctx.task_detail(task)}"
    )
    return _json(AIAction.SUBTASKS, prompt, system=prompts.EXTRACTION_SYSTEM,
                 schema=schemas.SUBTASKS, user=user, subject=task)


def estimate_effort(task, *, user=None) -> AIOutcome:
    prompt = (
        "Estimate the effort this task needs, in hours. Give a best guess plus an optimistic and "
        "pessimistic range, and state the assumptions the estimate rests on."
        f"\n\n### Task\n{ctx.task_detail(task)}"
    )
    return _json(AIAction.ESTIMATE, prompt, system=prompts.ANALYSIS_SYSTEM,
                 schema=schemas.ESTIMATE, user=user, subject=task)


def prioritize(task=None, *, tasks=None, user=None) -> AIOutcome:
    if task is not None:
        body = ctx.task_detail(task)
        instruction = "Recommend the priority and risk level this task should carry, and explain why."
    else:
        body = ctx.tasks_context(tasks or [])
        instruction = (
            "Recommend the order these tasks should be tackled in, and the priority the most "
            "important one should carry."
        )
    prompt = f"{instruction}\n\n### Tasks\n{body}"
    return _json(AIAction.PRIORITIZE, prompt, system=prompts.ANALYSIS_SYSTEM,
                 schema=schemas.PRIORITIZE, user=user, subject=task)


def analyse_risks(project, *, user=None) -> AIOutcome:
    """Risk-focused view of a project — reuses the project analysis contract so
    the UI renders one shape everywhere."""
    return run(
        AIAction.RISK_ANALYSIS,
        lambda p: p.analyse_project(
            ctx.project_context(project),
            goal="Concentrate on risk: what could go wrong, how likely it is, what it would cost, "
                 "and what should be done now to prevent it.",
        ),
        user=user, subject=project,
    )


def predict_delay(project, *, user=None) -> AIOutcome:
    return run(
        AIAction.DELAY_PREDICTION,
        lambda p: p.analyse_project(
            ctx.project_context(project),
            goal="Concentrate on schedule: will this project hit its target date, and if not, by "
                 "how many days will it slip and why.",
        ),
        user=user, subject=project,
    )


def health_score(project, *, user=None) -> AIOutcome:
    return run(
        AIAction.HEALTH_SCORE,
        lambda p: p.analyse_project(
            ctx.project_context(project),
            goal="Concentrate on scoring overall health 0-100 and justifying the score with the "
                 "specific figures that drove it.",
        ),
        user=user, subject=project,
    )


def meeting_summary(notes: str, *, context: str = "", user=None, subject=None) -> AIOutcome:
    prompt = (
        "Summarise this meeting: what was covered, what was decided, who agreed to do what by when, "
        "and what remains open."
        + (f"\n\n### Context\n{context}" if context else "")
        + f"\n\n### Meeting notes\n{notes}"
    )
    return _json(AIAction.MEETING_SUMMARY, prompt, system=prompts.EXTRACTION_SYSTEM,
                 schema=schemas.MEETING, user=user, subject=subject)


def customer_summary(customer, *, user=None) -> AIOutcome:
    prompt = (
        "Summarise this customer relationship for the account owner: who they are, the state of the "
        "pipeline, what is at risk and what to do next."
        f"\n\n### Customer data\n{ctx.customer_context(customer)}"
    )
    return _json(AIAction.CUSTOMER_SUMMARY, prompt, system=prompts.ANALYSIS_SYSTEM,
                 schema=schemas.CUSTOMER_SUMMARY, user=user, subject=customer)


def draft_customer_reply(customer, *, incoming_message: str, intent: str = "",
                         tone: str = "professional and warm", user=None) -> AIOutcome:
    return generate_email(
        purpose=(
            "Reply to the customer message below."
            + (f" The reply should: {intent}" if intent else "")
            + f"\n\n### Customer's message\n{incoming_message}"
        ),
        context=ctx.customer_context(customer),
        tone=tone,
        recipient=customer.name,
        user=user,
        subject=customer,
    )


def generate_proposal(customer, *, brief: str, opportunity=None, user=None) -> AIOutcome:
    body = ctx.customer_context(customer)
    if opportunity is not None:
        body += (
            f"\n\nTarget opportunity: {opportunity.title} — stage {opportunity.stage}, "
            f"value {opportunity.amount} {opportunity.currency}"
        )
    prompt = (
        "Write a business proposal for this customer based on the brief below. Use their actual "
        "context; do not invent pricing that was not supplied."
        f"\n\n### Brief\n{brief}\n\n### Customer context\n{body}"
    )
    return _json(AIAction.PROPOSAL, prompt, system=prompts.BASE_SYSTEM, schema=schemas.PROPOSAL,
                 user=user, subject=customer, max_tokens=2000)


def job_description(*, role_title: str, department: str = "", seniority: str = "",
                    requirements: str = "", user=None) -> AIOutcome:
    prompt = (
        f"Write a job description for the role of {role_title}."
        + (f" Department: {department}." if department else "")
        + (f" Seniority: {seniority}." if seniority else "")
        + (f"\n\n### Requirements supplied by the hiring manager\n{requirements}" if requirements else "")
    )
    return _json(AIAction.JOB_DESCRIPTION, prompt, system=prompts.BASE_SYSTEM,
                 schema=schemas.JOB_DESCRIPTION, user=user, max_tokens=1800)


def performance_summary(subject_user, *, period_label: str = "", notes: str = "", user=None) -> AIOutcome:
    prompt = (
        "Write a balanced performance summary for this person based on their actual delivery record "
        "below. Be specific and evidence-based; do not speculate about behaviour the data cannot show."
        + (f" Review period: {period_label}." if period_label else "")
        + (f"\n\n### Manager's notes\n{notes}" if notes else "")
        + f"\n\n### Delivery record\n{ctx.user_workload_context(subject_user)}"
    )
    return _json(AIAction.PERFORMANCE_SUMMARY, prompt, system=prompts.ANALYSIS_SYSTEM,
                 schema=schemas.PERFORMANCE_SUMMARY, user=user, subject=subject_user)


def dashboard_insights(metrics: dict, *, audience: str = "a project manager", user=None) -> AIOutcome:
    prompt = (
        f"Read these dashboard figures and tell {audience} what actually matters right now — "
        "what is going well, what needs intervention today, and what trend is forming."
        f"\n\n{ctx.metrics_context(metrics)}"
    )
    return _json(AIAction.INSIGHTS, prompt, system=prompts.ANALYSIS_SYSTEM,
                 schema=schemas.INSIGHTS, user=user)


def explain_statistics(metrics: dict, *, question: str = "", user=None) -> AIOutcome:
    prompt = (
        "Explain what these figures mean in plain English for someone who does not read dashboards."
        + (f"\n\n### Specific question\n{question}" if question else "")
        + f"\n\n{ctx.metrics_context(metrics)}"
    )
    return _json(AIAction.EXPLAIN_STATS, prompt, system=prompts.BASE_SYSTEM,
                 schema=schemas.EXPLAIN, user=user)


def generate_report(*, period_label: str, metrics: dict, body: str = "", audience: str = "management",
                    user=None, subject=None, config=None) -> AIOutcome:
    prompt = (
        f"Write the {period_label} report for {audience}. Cover completed work, delayed work, "
        "upcoming deadlines and anything needing a decision. Ground every statement in the figures."
        f"\n\n{ctx.metrics_context(metrics)}"
        + (f"\n\n### Detail\n{body}" if body else "")
    )
    return _json(AIAction.REPORT, prompt, system=prompts.ANALYSIS_SYSTEM, schema=schemas.REPORT,
                 user=user, subject=subject, config=config, max_tokens=2400)


def detect_duplicates(tasks, *, user=None) -> AIOutcome:
    prompt = (
        "Identify tasks below that describe the same underlying work. Only report a pair when the "
        "overlap is genuine — similar wording about different deliverables is not a duplicate."
        f"\n\n### Tasks\n{ctx.tasks_context(tasks, limit=120)}"
    )
    return _json(AIAction.DUPLICATE_DETECTION, prompt, system=prompts.ANALYSIS_SYSTEM,
                 schema=schemas.DUPLICATES, user=user)


def daily_standup(standup_context: str, *, person: str = "", user=None, config=None) -> AIOutcome:
    """One person's morning stand-up.

    Takes rendered context rather than the user object so the caller owns the
    access-scoping decision — this function must never be the thing that
    decides which records a stand-up may mention.
    """
    return _json(
        AIAction.DAILY_STANDUP,
        prompts.standup_prompt(standup_context, person=person),
        system=prompts.STANDUP_SYSTEM,
        schema=schemas.DAILY_STANDUP,
        user=user, subject=user, config=config, max_tokens=1600,
    )


def executive_summary(executive_context: str, *, period_label: str, user=None, config=None) -> AIOutcome:
    """The organisation-wide leadership briefing.

    Same contract as :func:`daily_standup`: the figures arrive already computed,
    and the model is asked to interpret them rather than to produce them.
    """
    return _json(
        AIAction.EXECUTIVE_SUMMARY,
        prompts.executive_prompt(executive_context, period_label=period_label),
        system=prompts.EXECUTIVE_SYSTEM,
        schema=schemas.EXECUTIVE_SUMMARY,
        user=user, config=config, max_tokens=2600,
    )


def balance_workload(users, *, user=None) -> AIOutcome:
    prompt = (
        "Assess how work is spread across this team. Identify who is overloaded, who has capacity, "
        "who shows signs of burnout risk (sustained overdue work, no completions, constant critical "
        "priority), and what to rebalance."
        f"\n\n### Team\n{ctx.team_workload_context(users)}"
    )
    return _json(AIAction.WORKLOAD, prompt, system=prompts.ANALYSIS_SYSTEM, schema=schemas.WORKLOAD,
                 user=user, max_tokens=1800)
