"""Transport for vendors that speak the OpenAI chat-completions wire format.

Grok (xAI) and OpenAI both expose ``POST {base_url}/chat/completions`` with the
same request and response bodies, so the HTTP layer is written once here and
each vendor subclass only supplies its endpoint, default model and key.

This class is deliberately *transport only* — no prompting, no ERP vocabulary.
A vendor with a different wire format subclasses :class:`AIProvider` directly
instead and the rest of the system is unaffected.
"""
from __future__ import annotations

import logging
import time

import requests

from .base import AIProvider, AIProviderError, AIResult

logger = logging.getLogger(__name__)

#: Statuses worth a second attempt — transient rate limits and upstream blips.
RETRYABLE_STATUSES = {408, 429, 500, 502, 503, 504}
MAX_ATTEMPTS = 3
BACKOFF_SECONDS = 1.5


class OpenAICompatibleProvider(AIProvider):
    """Shared HTTP implementation for OpenAI-style chat completions."""

    #: Set by subclasses; used when no base URL is configured.
    default_base_url: str = ""
    #: Vendors differ on whether they honour ``response_format``.
    supports_json_mode: bool = True

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)
        if not self.base_url:
            self.base_url = self.default_base_url.rstrip("/")

    @property
    def endpoint(self) -> str:
        return f"{self.base_url}/chat/completions"

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _payload(self, messages, *, model, temperature, max_tokens, json_mode) -> dict:
        payload = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if json_mode and self.supports_json_mode:
            payload["response_format"] = {"type": "json_object"}
        return payload

    def _candidate_models(self) -> list[str]:
        """The primary model first, then each configured fallback once."""
        models: list[str] = []
        for name in [self.model, *self.fallback_models]:
            name = (name or "").strip()
            if name and name not in models:
                models.append(name)
        return models or [self.default_model]

    @staticmethod
    def _worth_another_model(error: AIProviderError) -> bool:
        """Whether a *different model* could succeed where this one failed.

        Only two failures are about the model itself: a 404 (retired or not
        entitled — exactly what happened when Groq dropped Llama 3.x) and a 400
        JSON-validation error (the model could not satisfy the ``json_object``
        contract, e.g. a reasoning model that spent its budget thinking). A 401,
        a timeout or a 5xx are not the model's fault, so the next model would
        fail identically — we don't waste the call.
        """
        if error.status == 404:
            return True
        if error.status == 400:
            low = str(error).lower()
            return "json_validate" in low or "validate json" in low
        return False

    def _complete(self, messages, *, temperature, max_tokens, json_mode):
        if not self.api_key:
            raise AIProviderError(
                f"No API key configured for the {self.name} provider. "
                "Set it in the server environment and restart.",
            )

        candidates = self._candidate_models()
        last_error: AIProviderError | None = None
        for index, model in enumerate(candidates):
            try:
                text, usage = self._complete_once(
                    model, messages, temperature=temperature,
                    max_tokens=max_tokens, json_mode=json_mode,
                )
            except AIProviderError as exc:
                last_error = exc
                if index < len(candidates) - 1 and self._worth_another_model(exc):
                    logger.warning(
                        "%s model %r failed (%s) — falling back to %r",
                        self.name, model, exc, candidates[index + 1],
                    )
                    continue
                raise
            # Record which model actually served so the request log and the
            # AIResult name the real one, not the primary we started from.
            if model != self.model:
                logger.info("%s served by fallback model %r", self.name, model)
                self.model = model
            return text, usage

        raise last_error or AIProviderError(f"{self.name} call failed")

    def _complete_once(self, model, messages, *, temperature, max_tokens, json_mode):
        payload = self._payload(
            messages, model=model, temperature=temperature,
            max_tokens=max_tokens, json_mode=json_mode,
        )
        last_error: AIProviderError | None = None

        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                response = requests.post(
                    self.endpoint, json=payload, headers=self._headers(), timeout=self.timeout
                )
            except requests.Timeout as exc:
                last_error = AIProviderError(f"{self.name} timed out after {self.timeout}s", retryable=True)
                logger.warning("%s timeout on attempt %d: %s", self.name, attempt, exc)
            except requests.RequestException as exc:
                last_error = AIProviderError(f"Could not reach {self.name}: {exc}", retryable=True)
                logger.warning("%s transport error on attempt %d: %s", self.name, attempt, exc)
            else:
                if response.status_code == 200:
                    return self._parse(response.json())

                detail = self._error_detail(response)
                retryable = response.status_code in RETRYABLE_STATUSES
                last_error = AIProviderError(
                    f"{self.name} returned {response.status_code}: {detail}",
                    status=response.status_code,
                    retryable=retryable,
                )
                logger.warning("%s HTTP %s on attempt %d: %s", self.name, response.status_code, attempt, detail)
                if not retryable:
                    break

            if attempt < MAX_ATTEMPTS:
                time.sleep(BACKOFF_SECONDS * attempt)

        raise last_error or AIProviderError(f"{self.name} call failed")

    # --- transcription ----------------------------------------------------- #
    # Groq and OpenAI expose the same multipart endpoint as well, so dictation
    # rides on the one transport just as chat does. Deliberately *not* retried:
    # a clip is megabytes, the caller is a person holding a microphone waiting
    # for their words, and three attempts at a rate limit costs them the wait
    # three times over. One try, then a clear failure they can repeat by choice.
    def transcribe(self, audio, *, filename="speech.webm", content_type="audio/webm", language=""):
        if not self.supports_transcription:
            return super().transcribe(
                audio, filename=filename, content_type=content_type, language=language)
        if not self.api_key:
            raise AIProviderError(
                f"No API key configured for the {self.name} provider. "
                "Set it in the server environment and restart.",
            )

        model = self.transcription_model
        data = {"model": model, "response_format": "json"}
        if language:
            # A hint, not a constraint — the models auto-detect, but naming the
            # expected language measurably steadies short clips.
            data["language"] = language

        started = time.monotonic()
        try:
            response = requests.post(
                f"{self.base_url}/audio/transcriptions",
                headers={"Authorization": f"Bearer {self.api_key}"},
                files={"file": (filename, audio, content_type)},
                data=data,
                timeout=self.timeout,
            )
        except requests.Timeout as exc:
            raise AIProviderError(
                f"{self.name} timed out after {self.timeout}s while transcribing", retryable=True
            ) from exc
        except requests.RequestException as exc:
            raise AIProviderError(f"Could not reach {self.name}: {exc}", retryable=True) from exc

        if response.status_code != 200:
            detail = self._error_detail(response)
            logger.warning("%s transcription HTTP %s: %s", self.name, response.status_code, detail)
            raise AIProviderError(
                f"{self.name} returned {response.status_code}: {detail}",
                status=response.status_code,
                retryable=response.status_code in RETRYABLE_STATUSES,
            )

        try:
            body = response.json()
        except ValueError as exc:
            raise AIProviderError(f"{self.name} returned an unreadable transcription") from exc

        return AIResult(
            text=(body.get("text") or "").strip(),
            provider=self.name,
            model=model,
            latency_ms=int((time.monotonic() - started) * 1000),
        )

    @staticmethod
    def _error_detail(response) -> str:
        try:
            body = response.json()
        except ValueError:
            return (response.text or "")[:300]
        error = body.get("error")
        if isinstance(error, dict):
            return str(error.get("message") or error)[:300]
        return str(error or body)[:300]

    @staticmethod
    def _parse(body: dict) -> tuple[str, dict[str, int]]:
        choices = body.get("choices") or []
        if not choices:
            raise AIProviderError("Provider returned no choices")
        text = (choices[0].get("message") or {}).get("content") or ""
        usage = body.get("usage") or {}
        return text, {
            "prompt_tokens": usage.get("prompt_tokens") or 0,
            "completion_tokens": usage.get("completion_tokens") or 0,
        }
