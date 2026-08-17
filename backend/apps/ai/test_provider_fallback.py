"""Model fallback in the OpenAI-compatible transport.

When the chosen model is unavailable (404) or cannot satisfy the JSON contract
(400 json_validate_failed), the provider tries the next model in its chain
before giving up — but it does *not* burn the chain on failures a different
model would not fix (a bad key, a timeout, a 5xx).
"""
from __future__ import annotations

import json as jsonlib

import pytest

from apps.ai.providers.base import AIProviderError
from apps.ai.providers.groq import GroqProvider

PRIMARY = "openai/gpt-oss-120b"
FALLBACKS = ["qwen/qwen3.6-27b", "openai/gpt-oss-20b"]


class FakeResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload
        self.text = jsonlib.dumps(payload)

    def json(self):
        return self._payload


def _ok():
    return FakeResponse(200, {
        "choices": [{"message": {"content": '{"ok": true}'}}],
        "usage": {"prompt_tokens": 5, "completion_tokens": 3},
    })


def _err(status: int, message: str, code: str = ""):
    error = {"message": message}
    if code:
        error["code"] = code
    return FakeResponse(status, {"error": error})


@pytest.fixture
def route(monkeypatch):
    """Capture the model of every request and answer via a per-test responder."""
    seen: list[str] = []

    def _post(url, **kwargs):
        model = kwargs["json"]["model"]
        seen.append(model)
        return _post.responder(model)

    _post.responder = lambda model: _ok()
    _post.seen = seen
    monkeypatch.setattr("apps.ai.providers.openai_compatible.requests.post", _post)
    return _post


def _provider():
    return GroqProvider(api_key="test-key", model=PRIMARY, fallback_models=FALLBACKS)


def test_primary_success_never_touches_fallbacks(route):
    result = _provider().complete("hi")
    assert route.seen == [PRIMARY]
    assert result.model == PRIMARY


def test_404_on_primary_falls_back_to_next_model(route):
    route.responder = lambda m: _err(404, "does not exist or you do not have access") if m == PRIMARY else _ok()
    result = _provider().complete("hi")
    assert route.seen == [PRIMARY, FALLBACKS[0]]
    assert result.model == FALLBACKS[0]  # the served model is recorded, not the primary


def test_json_validate_failure_falls_back(route):
    route.responder = lambda m: (
        _err(400, "Failed to validate JSON. Please adjust your prompt.", code="json_validate_failed")
        if m == PRIMARY else _ok()
    )
    result = _provider().complete_json("hi", schema={"ok": True})
    assert route.seen[0] == PRIMARY
    assert result.model == FALLBACKS[0]
    assert result.structured is True


def test_bad_key_does_not_burn_the_chain(route):
    route.responder = lambda m: _err(401, "Invalid API Key")
    with pytest.raises(AIProviderError):
        _provider().complete("hi")
    assert route.seen == [PRIMARY]  # stopped after the primary — a 401 is not the model's fault


def test_all_models_exhausted_raises_the_last_error(route):
    route.responder = lambda m: _err(404, "gone")
    with pytest.raises(AIProviderError):
        _provider().complete("hi")
    assert route.seen == [PRIMARY, *FALLBACKS]  # every candidate tried, in order


def test_no_fallbacks_configured_still_raises_once(route):
    route.responder = lambda m: _err(404, "gone")
    provider = GroqProvider(api_key="test-key", model=PRIMARY, fallback_models=[])
    with pytest.raises(AIProviderError):
        provider.complete("hi")
    assert route.seen == [PRIMARY]
