"""Sending photos, files and voice notes in DMs and groups."""
from __future__ import annotations

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.notifications.models import Notification

from .models import MessageAttachment


def client(u):
    c = APIClient()
    c.force_authenticate(u)
    return c


@pytest.fixture
def alice(db):
    return User.objects.create_user(username="alice", email="a@x.io", password="pw")


@pytest.fixture
def bob(db):
    return User.objects.create_user(username="bob", email="b@x.io", password="pw")


@pytest.fixture
def dm(alice, bob):
    return client(alice).post("/api/conversations/", {"recipient": bob.id, "body": "hi"}, format="json").data


def _img(name="pic.png"):
    return SimpleUploadedFile(name, b"\x89PNG\r\n\x1a\nfake", content_type="image/png")


def _audio(name="note.webm"):
    return SimpleUploadedFile(name, b"OggSfake-audio", content_type="audio/webm")


def _doc(name="report.pdf"):
    return SimpleUploadedFile(name, b"%PDF-1.4 fake", content_type="application/pdf")


def test_send_a_photo_with_a_caption(dm, alice):
    cid = dm["id"]
    r = client(alice).post(f"/api/conversations/{cid}/messages/",
                           {"body": "look", "files": _img()}, format="multipart")
    assert r.status_code == 201, r.data
    assert r.data["body"] == "look"
    assert len(r.data["attachments"]) == 1
    att = r.data["attachments"][0]
    assert att["kind"] == "image" and att["name"] == "pic.png" and att["url"]


def test_a_message_can_be_attachment_only(dm, alice, bob):
    cid = dm["id"]
    client(bob).post(f"/api/conversations/{cid}/read/")   # clear the opening ping first
    r = client(alice).post(f"/api/conversations/{cid}/messages/",
                           {"files": _doc()}, format="multipart")
    assert r.status_code == 201, r.data
    assert r.data["body"] == "" and r.data["attachments"][0]["kind"] == "file"
    # The bell preview names the attachment rather than showing a blank line.
    ping = Notification.objects.filter(recipient=bob, event="direct_message").order_by("-id").first()
    assert ping is not None and "Attachment" in ping.body


def test_empty_message_with_no_file_is_rejected(dm, alice):
    cid = dm["id"]
    r = client(alice).post(f"/api/conversations/{cid}/messages/", {"body": "  "}, format="multipart")
    assert r.status_code == 400


def test_voice_note_carries_its_duration(dm, alice):
    cid = dm["id"]
    r = client(alice).post(f"/api/conversations/{cid}/messages/",
                           {"files": _audio(), "duration_ms": "4200"}, format="multipart")
    assert r.status_code == 201, r.data
    att = r.data["attachments"][0]
    assert att["kind"] == "audio" and att["duration_ms"] == 4200


def test_retracting_a_message_drops_its_attachments(dm, alice):
    cid = dm["id"]
    msg = client(alice).post(f"/api/conversations/{cid}/messages/",
                             {"files": _img()}, format="multipart").data
    assert MessageAttachment.objects.count() == 1
    client(alice).delete(f"/api/direct-messages/{msg['id']}/")
    assert MessageAttachment.objects.count() == 0


def test_group_message_attachments(alice, bob):
    gid = client(alice).post("/api/group-threads/",
                             {"name": "Launch", "members": [bob.id]}, format="json").data["id"]
    r = client(alice).post(f"/api/group-threads/{gid}/messages/",
                           {"files": _img()}, format="multipart")
    assert r.status_code == 201, r.data
    assert r.data["attachments"][0]["kind"] == "image"
    # And the other member can read it back with the attachment.
    rows = client(bob).get(f"/api/group-threads/{gid}/messages/").data
    assert rows[-1]["attachments"][0]["name"] == "pic.png"


def test_too_many_files_is_rejected(dm, alice):
    cid = dm["id"]
    files = [_img(f"p{i}.png") for i in range(11)]
    r = client(alice).post(f"/api/conversations/{cid}/messages/",
                           {"files": files}, format="multipart")
    assert r.status_code == 400
