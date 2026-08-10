"""OpenAI provider — the planned production migration path.

Nothing else in the ERP changes when this becomes the active provider: set
``AI_PROVIDER=openai`` and ``OPENAI_API_KEY`` in the server environment (or
switch the provider on the AI settings screen) and every module keeps calling
the same seven operations.
"""
from __future__ import annotations

from .openai_compatible import OpenAICompatibleProvider


class OpenAIProvider(OpenAICompatibleProvider):
    name = "openai"
    default_base_url = "https://api.openai.com/v1"
    default_model = "gpt-4o-mini"
    supports_json_mode = True
    #: whisper-1 rather than a newer audio model: it is the transcription
    #: endpoint's long-standing default and is available on every account tier,
    #: which matters for a fallback that has to just work.
    supports_transcription = True
    transcription_model = "whisper-1"
