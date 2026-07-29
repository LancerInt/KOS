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

from .base import AIProvider, AIProviderError

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

    def _payload(self, messages, *, temperature, max_tokens, json_mode) -> dict:
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if json_mode and self.supports_json_mode:
            payload["response_format"] = {"type": "json_object"}
        return payload

    def _complete(self, messages, *, temperature, max_tokens, json_mode):
        if not self.api_key:
            raise AIProviderError(
                f"No API key configured for the {self.name} provider. "
                "Set it in the server environment and restart.",
            )

        payload = self._payload(messages, temperature=temperature, max_tokens=max_tokens, json_mode=json_mode)
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
