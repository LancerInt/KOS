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
    #:
    #: Groq retired the Llama 3.x line for newer accounts, so keys created in
    #: 2026 return 404 for ``llama-3.3-70b-versatile``. ``gpt-oss-120b`` is the
    #: strongest chat model such accounts do list and honours ``response_format``
    #: JSON mode. It is a *reasoning* model — it spends tokens thinking before it
    #: answers — so a stingy ``max_tokens`` can starve the JSON; the 1200-token
    #: default leaves room. If large analyses ever truncate, set AI_MODEL to the
    #: non-reasoning ``qwen/qwen3.6-27b`` instead.
    default_model = "openai/gpt-oss-120b"
    supports_json_mode = True
    #: Groq hosts Whisper too, so dictation needs no second vendor or key. The
    #: turbo variant is the one to use for a person waiting on their own words:
    #: near-identical accuracy to whisper-large-v3, several times faster.
    supports_transcription = True
    transcription_model = "whisper-large-v3-turbo"
