"""Groq provider.

Groq is a fast inference host for open models (Llama, GPT-OSS, Qwen), not to be
confused with xAI's **Grok** — different company, different endpoint, similar
name. Both are supported; pick one with ``AI_PROVIDER``.

Like the others it speaks the OpenAI chat-completions format, so this is a
transport-only subclass and every ERP module is unaffected by the choice.
"""
from __future__ import annotations

from .openai_compatible import OpenAICompatibleProvider


class GroqProvider(OpenAICompatibleProvider):
    name = "groq"
    default_base_url = "https://api.groq.com/openai/v1"
    #: Strong general model with reliable JSON-mode support, which the
    #: structured ERP contracts depend on. Override with AI_MODEL.
    default_model = "llama-3.3-70b-versatile"
    supports_json_mode = True
