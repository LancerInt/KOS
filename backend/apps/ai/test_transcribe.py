"""Dictation — the speech-to-text fallback behind the microphone.

The browser's own recognition is preferred on the client (free, live, no round
trip). This endpoint exists for the browsers that have none, so the rules it has
to hold are about *not* being the weak point: it must reject anything that isn't
a plausible audio clip before spending a paid vendor call on it, and it must be
counted and capped exactly like every other AI call.
"""
from __future__ import annotations

import io

import pytest
from rest_framework.test import APIClient

from apps.ai.models import AIAction, AIRequestLog, AISettings
from apps.ai.providers import AIProviderError
from apps.ai.providers.base import AIResult
from apps.ai.views import MAX_AUDIO_BYTES

TRANSCRIBE = "/api/ai/transcribe/"
STATUS = "/api/ai/status/"


def _clip(content: bytes = b"fake-opus-bytes-" * 100, name="speech.webm", ctype="audio/webm"):
    upload = io.BytesIO(content)
    upload.name = name
    upload.content_type = ctype
    return upload


@pytest.fixture
def transcribing(monkeypatch):
    """A provider that transcribes, standing in for Groq's Whisper endpoint."""
    calls: list[dict] = []

    class FakeProvider:
        name = "groq"
        model = "llama-3.3-70b-versatile"
        supports_transcription = True

        def transcribe(self, audio, *, filename, content_type, language=""):
            calls.append({"bytes": len(audio), "filename": filename,
                          "content_type": content_type, "language": language})
            return AIResult(text="  Draft the neem oil label revision.  ",
                            provider=self.name, model="whisper-large-v3-turbo")

    monkeypatch.setattr("apps.ai.service.get_provider", lambda *a, **k: FakeProvider())
    return calls


# --------------------------------------------------------------------------- #
# The happy path
# --------------------------------------------------------------------------- #
@pytest.mark.django_db
def test_a_clip_comes_back_as_text(auth_client, transcribing):
    r = auth_client.post(TRANSCRIBE, {"audio": _clip()}, format="multipart")
    assert r.status_code == 200, r.data
    assert r.data["text"] == "Draft the neem oil label revision."
    assert transcribing[0]["content_type"] == "audio/webm"


@pytest.mark.django_db
def test_the_codec_parameter_browsers_add_is_stripped(auth_client, transcribing):
    """MediaRecorder labels its output 'audio/webm;codecs=opus'. Matching the
    allowlist on the whole string would reject every real recording."""
    r = auth_client.post(
        TRANSCRIBE, {"audio": _clip(ctype="audio/webm;codecs=opus")}, format="multipart")
    assert r.status_code == 200, r.data
    assert transcribing[0]["content_type"] == "audio/webm"


@pytest.mark.django_db
def test_the_language_hint_is_passed_through(auth_client, transcribing):
    auth_client.post(TRANSCRIBE, {"audio": _clip(), "language": "en-IN"}, format="multipart")
    assert transcribing[0]["language"] == "en-IN"


@pytest.mark.django_db
def test_every_clip_is_logged_like_any_other_ai_call(auth_client, transcribing):
    """Dictation is a paid call and must not be the one that escapes the trail."""
    auth_client.post(TRANSCRIBE, {"audio": _clip()}, format="multipart")
    log = AIRequestLog.objects.get()
    assert log.action == AIAction.TRANSCRIBE and log.ok
    assert log.model == "whisper-large-v3-turbo"      # the audio model, not the chat one


# --------------------------------------------------------------------------- #
# What must never reach the vendor
# --------------------------------------------------------------------------- #
@pytest.mark.django_db
def test_a_non_audio_upload_is_refused(auth_client, transcribing):
    r = auth_client.post(
        TRANSCRIBE, {"audio": _clip(name="notes.pdf", ctype="application/pdf")}, format="multipart")
    assert r.status_code == 400, r.data
    assert not transcribing, "a PDF must not cost a transcription call"


@pytest.mark.django_db
def test_an_empty_recording_is_refused(auth_client, transcribing):
    r = auth_client.post(TRANSCRIBE, {"audio": _clip(content=b"")}, format="multipart")
    assert r.status_code == 400, r.data
    assert not transcribing


@pytest.mark.django_db
def test_an_oversized_clip_is_refused_here_rather_than_by_the_vendor(auth_client, transcribing):
    r = auth_client.post(
        TRANSCRIBE, {"audio": _clip(content=b"x" * (MAX_AUDIO_BYTES + 1))}, format="multipart")
    assert r.status_code == 400, r.data
    assert not transcribing


@pytest.mark.django_db
def test_anonymous_callers_are_turned_away(api_client):
    assert api_client.post(TRANSCRIBE, {"audio": _clip()}, format="multipart").status_code == 401


@pytest.mark.django_db
def test_the_master_switch_stops_dictation_too(auth_client, transcribing):
    config = AISettings.load()
    config.is_enabled = False
    config.save()
    r = auth_client.post(TRANSCRIBE, {"audio": _clip()}, format="multipart")
    assert r.status_code == 503, r.data
    assert not transcribing


@pytest.mark.django_db
def test_a_provider_failure_is_a_clean_503(auth_client, monkeypatch):
    class FailingProvider:
        name, model, supports_transcription = "groq", "x", True

        def transcribe(self, *a, **k):
            raise AIProviderError("whisper is down")

    monkeypatch.setattr("apps.ai.service.get_provider", lambda *a, **k: FailingProvider())
    r = auth_client.post(TRANSCRIBE, {"audio": _clip()}, format="multipart")
    assert r.status_code == 503, r.data
    assert AIRequestLog.objects.get().ok is False


# --------------------------------------------------------------------------- #
# What the browser asks before showing a microphone
# --------------------------------------------------------------------------- #
@pytest.mark.django_db
def test_status_advertises_transcription_when_the_provider_has_it(auth_client, transcribing):
    assert auth_client.get(STATUS).data["transcription"] is True


@pytest.mark.django_db
def test_status_says_no_when_the_provider_cannot_transcribe(auth_client, monkeypatch):
    """Grok and the offline stub have no audio endpoint. A browser with no
    recognition of its own then shows no mic, rather than one that fails."""
    class NoAudioProvider:
        name, model, supports_transcription = "grok", "grok-2", False

    monkeypatch.setattr("apps.ai.service.get_provider", lambda *a, **k: NoAudioProvider())
    assert auth_client.get(STATUS).data["transcription"] is False


@pytest.mark.django_db
def test_a_provider_without_audio_says_so_rather_than_failing_obscurely():
    from apps.ai.providers.grok import GrokProvider

    provider = GrokProvider(api_key="k")
    assert provider.supports_transcription is False
    with pytest.raises(AIProviderError, match="cannot transcribe"):
        provider.transcribe(b"x", filename="a.webm", content_type="audio/webm")
