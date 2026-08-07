"""A workspace record can carry multiple file attachments."""
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.workspaces.models import WorkspaceProject


@pytest.mark.django_db
def test_create_record_with_multiple_files(auth_client, admin_user):
    project = WorkspaceProject.objects.create(workspace="amazon-usa", name="P", created_by=admin_user)
    f1 = SimpleUploadedFile("a.pdf", b"one", content_type="application/pdf")
    f2 = SimpleUploadedFile("b.png", b"two", content_type="image/png")

    resp = auth_client.post(
        "/api/workspace-records/",
        {"project": project.id, "category": "Product", "data": "{}", "attachments": [f1, f2]},
        format="multipart",
    )
    assert resp.status_code == 201, resp.content
    names = {a["name"] for a in resp.data["attachments"]}
    assert len(resp.data["attachments"]) == 2
    assert any(n.endswith(".pdf") for n in names)
    assert any(n.endswith(".png") for n in names)
