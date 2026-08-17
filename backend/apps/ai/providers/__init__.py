"""Provider registry and factory.

``get_provider()`` is the single place the rest of KOS obtains an AI client.
Which vendor it returns is configuration — an environment variable plus an
admin-editable settings row — never a code change in an ERP module.
"""
from __future__ import annotations

import logging

from django.conf import settings as django_settings

from .base import AIProvider, AIProviderError, AIResult, parse_json_object
from .grok import GrokProvider
from .groq import GroqProvider
from .mock import MockProvider
from .openai import OpenAIProvider

logger = logging.getLogger(__name__)

#: Every provider the system knows how to build. Adding a vendor means adding a
#: subclass and one line here — nothing in the ERP modules changes.
PROVIDERS: dict[str, type[AIProvider]] = {
    GroqProvider.name: GroqProvider,
    GrokProvider.name: GrokProvider,
    OpenAIProvider.name: OpenAIProvider,
    MockProvider.name: MockProvider,
}

__all__ = [
    "AIProvider",
    "AIProviderError",
    "AIResult",
    "GrokProvider",
    "GroqProvider",
    "MockProvider",
    "PROVIDERS",
    "get_provider",
    "parse_json_object",
    "provider_choices",
]


def provider_choices() -> list[tuple[str, str]]:
    return [
        (GroqProvider.name, "Groq"),
        (GrokProvider.name, "Grok (xAI)"),
        (OpenAIProvider.name, "OpenAI"),
        (MockProvider.name, "Offline (no external calls)"),
    ]


def api_key_for(provider_name: str) -> str:
    """The server-side key for a provider. Keys live in the environment only —
    they are never stored in the database and never returned over the API."""
    return (django_settings.AI_API_KEYS.get(provider_name) or "").strip()


def get_provider(config=None, *, force: str = "") -> AIProvider:
    """Build the configured provider.

    Falls back to the offline provider when the selected vendor has no API key,
    so a missing key degrades the feature instead of breaking every request.
    """
    if config is None:
        from ..models import AISettings

        config = AISettings.load()

    name = force or config.provider
    provider_class = PROVIDERS.get(name)
    if provider_class is None:
        logger.warning("Unknown AI provider %r — falling back to offline", name)
        provider_class = MockProvider

    api_key = api_key_for(provider_class.name)
    if provider_class is not MockProvider and not api_key:
        logger.warning(
            "AI provider %r has no API key configured — using the offline provider instead.",
            provider_class.name,
        )
        provider_class = MockProvider

    from django.conf import settings as dj_settings

    # Empty env → None → the provider falls back to its own curated chain.
    fallback_models = getattr(dj_settings, "AI_MODEL_FALLBACKS", None) or None

    return provider_class(
        api_key=api_key,
        model=config.model,
        base_url=config.base_url,
        temperature=config.temperature,
        max_tokens=config.max_tokens,
        timeout=config.timeout_seconds,
        fallback_models=fallback_models,
    )
