"""Grok (xAI) provider — the development/testing default.

The only vendor-specific knowledge in the whole system: the endpoint, the
default model, and which environment variable holds the key.
"""
from __future__ import annotations

from .openai_compatible import OpenAICompatibleProvider


class GrokProvider(OpenAICompatibleProvider):
    name = "grok"
    default_base_url = "https://api.x.ai/v1"
    #: Fast and cheap, which suits the scheduled scans that dominate our volume.
    #: Override per deployment with AI_MODEL or on the AI settings screen —
    #: vendors retire model ids, so this is configuration, not a constant.
    default_model = "grok-4-fast-non-reasoning"
    supports_json_mode = True
