"""Offline provider used for development and tests.

The ERP must stay usable when no API key is present — a developer running
`docker compose up` should still see every AI screen work, and the test suite
must never make a network call. This provider answers locally.

It is not a canned-string stub: it reads the JSON shape that the system prompt
asked for and synthesises a response that satisfies it. So a new AI feature is
exercised end-to-end (view → serializer → UI) offline, and only the wording is
fake. Anything it produces is clearly labelled as a local stub.
"""
from __future__ import annotations

import re

from .base import AIProvider, parse_json_object

STUB_NOTE = "AI is running in offline mode — configure a provider API key for real analysis."

_SHAPE_RE = re.compile(r"matching this shape:\s*(\{.*)", re.DOTALL)


def _one_of(description: str) -> str:
    """Pick a value from a 'one of: a | b | c' description — the calmest one."""
    options = [opt.strip() for opt in description.split(":", 1)[1].split("|") if opt.strip()]
    if not options:
        return ""
    # Prefer a middle-of-the-road option so stub data never looks like a crisis.
    return options[len(options) // 2] if len(options) > 2 else options[0]


def _fill(node, depth: int = 0):
    """Turn a schema example into a response that satisfies it."""
    if isinstance(node, dict):
        return {key: _fill(value, depth + 1) for key, value in node.items()}
    if isinstance(node, list):
        if not node:
            return []
        # One representative entry is enough to prove the shape end to end.
        return [_fill(node[0], depth + 1)]
    if not isinstance(node, str):
        return node

    description = node.lower()
    if description.startswith("one of"):
        return _one_of(node)
    if "true or false" in description:
        return False
    if "integer" in description or "number" in description:
        # Health scores read better as a plausible mid value than as 0.
        return 70 if "0-100" in description else 0
    return STUB_NOTE


class MockProvider(AIProvider):
    """Answers locally, honouring whatever JSON shape was requested."""

    name = "mock"
    default_model = "offline-stub"

    @property
    def is_configured(self) -> bool:
        return True

    def _complete(self, messages, *, temperature, max_tokens, json_mode):
        system = next((m["content"] for m in messages if m["role"] == "system"), "")
        user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")

        shape_match = _SHAPE_RE.search(system)
        if shape_match:
            schema = parse_json_object(shape_match.group(1))
            if schema is not None:
                import json

                return json.dumps(_fill(schema), indent=2), {}

        preview = " ".join(user.split())[:180]
        return (
            f"{STUB_NOTE}\n\nReceived: {preview}"
            if preview
            else STUB_NOTE
        ), {}
