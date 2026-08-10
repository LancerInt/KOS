"""The provider-agnostic AI interface.

Every ERP module talks to AI through :class:`AIProvider` and never to a vendor
SDK. A provider implements exactly one primitive — :meth:`AIProvider._complete`,
the raw chat call — and inherits the whole ERP-facing vocabulary from this base
class. Swapping Grok for OpenAI is therefore a new subclass plus a settings
change; no business logic moves.

The seven mandated ERP operations live here as concrete methods so that the
*prompting and JSON contract* stay identical across vendors. A vendor that
returns better JSON does not get to change what a "project analysis" contains.
"""
from __future__ import annotations

import json
import logging
import re
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Sequence

from .. import prompts, schemas

logger = logging.getLogger(__name__)


class AIProviderError(RuntimeError):
    """Raised when the upstream provider fails or returns something unusable.

    Callers are expected to catch this — an AI outage must never take down an
    ERP request or a Celery beat scan.
    """

    def __init__(self, message: str, *, status: int | None = None, retryable: bool = False):
        super().__init__(message)
        self.status = status
        self.retryable = retryable


@dataclass
class AIResult:
    """One completed AI call: the text, the parsed JSON, and how it went."""

    text: str = ""
    data: dict[str, Any] = field(default_factory=dict)
    provider: str = ""
    model: str = ""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    latency_ms: int = 0
    #: True when the response was expected to be JSON and parsed cleanly.
    structured: bool = False

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


# --------------------------------------------------------------------------- #
# JSON recovery
# --------------------------------------------------------------------------- #
_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


def parse_json_object(text: str) -> dict[str, Any] | None:
    """Best-effort extraction of a JSON object from a model response.

    Models wrap JSON in prose or code fences even when told not to, so we try,
    in order: the whole string, a fenced block, then the outermost ``{...}``
    span. Returns None when nothing parses — callers fall back to plain text
    rather than raising, so a chatty model degrades instead of erroring.
    """
    candidates = [text.strip()]

    fence = _FENCE_RE.search(text)
    if fence:
        candidates.append(fence.group(1).strip())

    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        candidates.append(text[start : end + 1])

    for candidate in candidates:
        if not candidate:
            continue
        try:
            parsed = json.loads(candidate)
        except (ValueError, TypeError):
            continue
        if isinstance(parsed, dict):
            return parsed
        if isinstance(parsed, list):
            return {"items": parsed}
    return None


# --------------------------------------------------------------------------- #
# Provider
# --------------------------------------------------------------------------- #
class AIProvider(ABC):
    """Base class for every AI vendor.

    Subclasses set :attr:`name` / :attr:`default_model` and implement
    :meth:`_complete`. Everything else — prompting, JSON contracts, retries,
    token accounting — is shared.
    """

    #: Short identifier stored on every log row.
    name: str = "base"
    #: Used when neither the DB settings nor the environment names a model.
    default_model: str = ""
    #: Whether this vendor can turn speech into text. Transcription is a second
    #: primitive rather than a variation of ``_complete`` — different endpoint,
    #: different wire format, different model — and most vendors do not offer
    #: one, so the default is a plain no and callers ask before offering a mic.
    supports_transcription: bool = False
    #: The audio model, kept apart from :attr:`model`: that one is the chat
    #: model an admin picks in settings, and feeding it an audio file would be
    #: a confusing failure rather than a transcription.
    transcription_model: str = ""

    def __init__(
        self,
        *,
        api_key: str = "",
        model: str = "",
        base_url: str = "",
        temperature: float = 0.3,
        max_tokens: int = 1200,
        timeout: int = 60,
    ) -> None:
        self.api_key = api_key
        self.model = model or self.default_model
        self.base_url = (base_url or "").rstrip("/")
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.timeout = timeout

    # --- transport (the only thing a vendor must implement) ---------------- #
    @abstractmethod
    def _complete(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float,
        max_tokens: int,
        json_mode: bool,
    ) -> tuple[str, dict[str, int]]:
        """Send a chat completion and return ``(text, usage)``.

        ``usage`` uses the keys ``prompt_tokens`` and ``completion_tokens``;
        providers that do not report usage may return zeros.
        """

    def transcribe(
        self,
        audio: bytes,
        *,
        filename: str = "speech.webm",
        content_type: str = "audio/webm",
        language: str = "",
    ) -> AIResult:
        """Turn a recorded clip into text.

        Only vendors advertising :attr:`supports_transcription` implement this;
        the rest say so plainly rather than failing somewhere deeper.
        """
        raise AIProviderError(
            f"The {self.name} provider cannot transcribe audio. "
            "Switch to Groq or OpenAI in AI settings to dictate."
        )

    @property
    def is_configured(self) -> bool:
        """Whether this provider can actually be called (key present, etc.)."""
        return bool(self.api_key)

    # --- primitives -------------------------------------------------------- #
    def complete(
        self,
        prompt: str,
        *,
        system: str = "",
        history: Sequence[dict[str, str]] = (),
        temperature: float | None = None,
        max_tokens: int | None = None,
        json_mode: bool = False,
    ) -> AIResult:
        """One free-text completion."""
        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        for message in history:
            role = message.get("role")
            content = (message.get("content") or "").strip()
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": content})
        messages.append({"role": "user", "content": prompt})

        started = time.monotonic()
        text, usage = self._complete(
            messages,
            temperature=self.temperature if temperature is None else temperature,
            max_tokens=max_tokens or self.max_tokens,
            json_mode=json_mode,
        )
        latency_ms = int((time.monotonic() - started) * 1000)

        return AIResult(
            text=(text or "").strip(),
            provider=self.name,
            model=self.model,
            prompt_tokens=int(usage.get("prompt_tokens") or 0),
            completion_tokens=int(usage.get("completion_tokens") or 0),
            latency_ms=latency_ms,
        )

    def complete_json(
        self,
        prompt: str,
        *,
        system: str = "",
        schema: dict[str, Any] | None = None,
        history: Sequence[dict[str, str]] = (),
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AIResult:
        """A completion that must come back as a JSON object.

        The expected shape is appended to the system prompt as an example
        document — this works across vendors, including ones with no native
        schema support. When parsing fails the raw text is still returned with
        ``structured=False`` so the caller can show *something*.
        """
        system_prompt = system or prompts.BASE_SYSTEM
        if schema is not None:
            system_prompt = f"{system_prompt}\n\n{prompts.json_instruction(schema)}"

        result = self.complete(
            prompt,
            system=system_prompt,
            history=history,
            temperature=temperature,
            max_tokens=max_tokens,
            json_mode=True,
        )
        parsed = parse_json_object(result.text)
        if parsed is None:
            logger.warning("%s returned unparseable JSON (%d chars)", self.name, len(result.text))
            result.data = {}
            result.structured = False
        else:
            result.data = parsed
            result.structured = True
        return result

    # ------------------------------------------------------------------ #
    # The seven ERP-facing operations. Every module uses these names.
    # ------------------------------------------------------------------ #
    def summarize(
        self,
        text: str,
        *,
        style: str = "brief",
        audience: str = "the project team",
        instructions: str = "",
    ) -> AIResult:
        """Summarise any ERP content into a summary, key points and actions."""
        return self.complete_json(
            prompts.summarize_prompt(text, style=style, audience=audience, instructions=instructions),
            system=prompts.SUMMARIZE_SYSTEM,
            schema=schemas.SUMMARY,
        )

    def chat(
        self,
        message: str,
        *,
        history: Sequence[dict[str, str]] = (),
        context: str = "",
        persona: str = "",
    ) -> AIResult:
        """Free-form assistant conversation, grounded in ERP context."""
        return self.complete(
            prompts.chat_prompt(message, context=context),
            system=persona or prompts.CHAT_SYSTEM,
            history=history,
            temperature=0.5,
        )

    def generate_email(
        self,
        purpose: str,
        *,
        context: str = "",
        tone: str = "professional",
        recipient: str = "",
        sender: str = "",
        language: str = "English",
    ) -> AIResult:
        """Draft an email. Django — never the model — actually sends it."""
        return self.complete_json(
            prompts.email_prompt(
                purpose, context=context, tone=tone, recipient=recipient,
                sender=sender, language=language,
            ),
            system=prompts.EMAIL_SYSTEM,
            schema=schemas.EMAIL,
        )

    def analyse_tasks(self, tasks_context: str, *, goal: str = "") -> AIResult:
        """Assess a set of tasks: urgency, priority, assignee and follow-ups."""
        return self.complete_json(
            prompts.analyse_tasks_prompt(tasks_context, goal=goal),
            system=prompts.ANALYSIS_SYSTEM,
            schema=schemas.TASK_ANALYSIS,
        )

    def analyse_project(self, project_context: str, *, goal: str = "") -> AIResult:
        """Assess one project: health, risks, delay prediction, next actions."""
        return self.complete_json(
            prompts.analyse_project_prompt(project_context, goal=goal),
            system=prompts.ANALYSIS_SYSTEM,
            schema=schemas.PROJECT_ANALYSIS,
        )

    def generate_notifications(self, events_context: str, *, audience: str = "") -> AIResult:
        """Turn raw ERP events into notification + email copy with urgency."""
        return self.complete_json(
            prompts.notifications_prompt(events_context, audience=audience),
            system=prompts.NOTIFICATION_SYSTEM,
            schema=schemas.NOTIFICATIONS,
        )

    def create_tasks_from_notes(self, notes: str, *, context: str = "") -> AIResult:
        """Extract decisions and actionable tasks from meeting or free notes."""
        return self.complete_json(
            prompts.tasks_from_notes_prompt(notes, context=context),
            system=prompts.EXTRACTION_SYSTEM,
            schema=schemas.TASKS_FROM_NOTES,
        )
