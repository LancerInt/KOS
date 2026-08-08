"""Sub-sections: nesting, sibling-scoped uniqueness, and the record link.

The behaviour these pin down is the reason sections could not nest before: a
record found its section by *name*, so two sections sharing a name were
indistinguishable. Records now carry a ``section`` FK and ``category`` is only a
mirror of it.
"""
from __future__ import annotations

from datetime import timedelta

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.workspaces.models import (
    ARCHIVE_TTL_DAYS, MAX_SECTION_DEPTH, WorkspaceProject, WorkspaceRecord, WorkspaceSection,
)
from apps.workspaces.views import purge_expired_deleted_items

SECTIONS = "/api/workspace-sections/"
RECORDS = "/api/workspace-records/"
ARCHIVE = "/api/workspaces/deleted-items/"
WS = "amazon-usa"


@pytest.fixture
def project(db) -> WorkspaceProject:
    return WorkspaceProject.objects.create(workspace=WS, name="Neem Oil 2026")


def mk(project, name, parent=None, **kw) -> WorkspaceSection:
    return WorkspaceSection.objects.create(
        project=project, workspace=project.workspace, name=name, parent=parent, **kw)


# --------------------------------------------------------------------------- #
# Structure
# --------------------------------------------------------------------------- #
@pytest.mark.django_db
def test_create_sub_section(auth_client, project):
    parent = mk(project, "Product")
    r = auth_client.post(SECTIONS, {
        "project": project.id, "parent": parent.id, "name": "Variants", "blurb": "", "fields": [],
    }, format="json")
    assert r.status_code == 201, r.data
    assert r.data["parent"] == parent.id
    child = WorkspaceSection.objects.get(pk=r.data["id"])
    assert child.depth == 1
    assert child.path_label() == "Product › Variants"


@pytest.mark.django_db
def test_same_name_under_different_parents_is_allowed(auth_client, project):
    a, b = mk(project, "Product"), mk(project, "Packaging")
    for parent in (a, b):
        r = auth_client.post(SECTIONS, {
            "project": project.id, "parent": parent.id, "name": "Documents", "fields": [],
        }, format="json")
        assert r.status_code == 201, r.data
    assert WorkspaceSection.objects.filter(name="Documents").count() == 2


@pytest.mark.django_db
def test_same_name_under_the_same_parent_is_rejected(auth_client, project):
    parent = mk(project, "Product")
    mk(project, "Documents", parent=parent)
    r = auth_client.post(SECTIONS, {
        "project": project.id, "parent": parent.id, "name": "documents", "fields": [],
    }, format="json")
    assert r.status_code == 400
    assert "name" in r.data


@pytest.mark.django_db
def test_two_root_sections_cannot_share_a_name(auth_client, project):
    """The NULL trap: a naive UniqueConstraint over a nullable `parent` would
    let both through, because SQL treats NULLs as distinct."""
    mk(project, "Trials")
    r = auth_client.post(SECTIONS, {"project": project.id, "name": "trials", "fields": []},
                         format="json")
    assert r.status_code == 400

    # ...and the database, not just the serializer, refuses it.
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            mk(project, "Trials")


@pytest.mark.django_db
def test_a_deleted_name_can_be_reused(auth_client, project):
    gone = mk(project, "Trials", hidden=True, deleted_at=timezone.now())
    r = auth_client.post(SECTIONS, {"project": project.id, "name": "Trials", "fields": []},
                         format="json")
    assert r.status_code == 201, r.data
    assert r.data["id"] != gone.id


# --------------------------------------------------------------------------- #
# Cycles and depth
# --------------------------------------------------------------------------- #
@pytest.mark.django_db
def test_a_section_cannot_be_its_own_parent(auth_client, project):
    s = mk(project, "Product")
    r = auth_client.patch(f"{SECTIONS}{s.id}/", {"parent": s.id}, format="json")
    assert r.status_code == 400
    assert "parent" in r.data


@pytest.mark.django_db
def test_a_section_cannot_move_inside_its_own_descendant(auth_client, project):
    a = mk(project, "A")
    b = mk(project, "B", parent=a)
    c = mk(project, "C", parent=b)
    r = auth_client.patch(f"{SECTIONS}{a.id}/", {"parent": c.id}, format="json")
    assert r.status_code == 400
    assert "sub-sections" in str(r.data["parent"][0])


@pytest.mark.django_db
def test_depth_cap(auth_client, project):
    parent = mk(project, "L0")
    for level in range(1, MAX_SECTION_DEPTH + 1):
        r = auth_client.post(SECTIONS, {
            "project": project.id, "parent": parent.id, "name": f"L{level}", "fields": [],
        }, format="json")
        assert r.status_code == 201, (level, r.data)
        parent = WorkspaceSection.objects.get(pk=r.data["id"])
    r = auth_client.post(SECTIONS, {
        "project": project.id, "parent": parent.id, "name": "TooDeep", "fields": [],
    }, format="json")
    assert r.status_code == 400
    assert "levels deep" in str(r.data["parent"][0])


@pytest.mark.django_db
def test_parent_from_another_project_is_rejected(auth_client, project):
    other = WorkspaceProject.objects.create(workspace=WS, name="Other")
    foreign = mk(other, "Elsewhere")
    r = auth_client.post(SECTIONS, {
        "project": project.id, "parent": foreign.id, "name": "Child", "fields": [],
    }, format="json")
    assert r.status_code == 400
    assert "parent" in r.data


@pytest.mark.django_db
def test_cannot_nest_under_a_deleted_section(auth_client, project):
    dead = mk(project, "Gone", hidden=True, deleted_at=timezone.now())
    r = auth_client.post(SECTIONS, {
        "project": project.id, "parent": dead.id, "name": "Child", "fields": [],
    }, format="json")
    assert r.status_code == 400


# --------------------------------------------------------------------------- #
# Records ↔ sections
# --------------------------------------------------------------------------- #
@pytest.mark.django_db
def test_record_in_a_sub_section_mirrors_its_name(auth_client, project):
    parent = mk(project, "Product")
    child = mk(project, "Variants", parent=parent)
    r = auth_client.post(RECORDS, {
        "project": project.id, "section": child.id, "category": "wrong-on-purpose",
        "data": {"Description": "500ml"},
    }, format="json")
    assert r.status_code == 201, r.data
    assert r.data["section"] == child.id
    assert r.data["category"] == "Variants"      # derived from the section, not the payload


@pytest.mark.django_db
def test_same_named_sub_sections_keep_their_records_apart(auth_client, project):
    a, b = mk(project, "Product"), mk(project, "Packaging")
    da, db_ = mk(project, "Documents", parent=a), mk(project, "Documents", parent=b)
    for sec, text in ((da, "spec"), (db_, "carton")):
        auth_client.post(RECORDS, {"project": project.id, "section": sec.id,
                                   "data": {"Description": text}}, format="json")

    one = auth_client.get(f"{RECORDS}?project={project.id}&section={da.id}").data
    two = auth_client.get(f"{RECORDS}?project={project.id}&section={db_.id}").data
    assert [x["data"]["Description"] for x in one] == ["spec"]
    assert [x["data"]["Description"] for x in two] == ["carton"]
    # The legacy name filter cannot tell them apart — which is exactly why the
    # FK exists, and why the frontend must filter by section.
    both = auth_client.get(f"{RECORDS}?project={project.id}&category=Documents").data
    assert len(both) == 2


@pytest.mark.django_db
def test_legacy_category_payload_resolves_to_a_root_section(auth_client, project):
    root = mk(project, "Product")
    r = auth_client.post(RECORDS, {"project": project.id, "category": "product",
                                   "data": {"Description": "x"}}, format="json")
    assert r.status_code == 201, r.data
    assert r.data["section"] == root.id
    assert r.data["category"] == "Product"       # normalised to the section's casing


@pytest.mark.django_db
def test_record_on_an_unadopted_builtin_keeps_a_null_section(auth_client, project):
    r = auth_client.post(RECORDS, {"project": project.id, "category": "Product",
                                   "data": {"Description": "x"}}, format="json")
    assert r.status_code == 201, r.data
    assert r.data["section"] is None
    assert auth_client.get(f"{RECORDS}?project={project.id}&category=Product").data


@pytest.mark.django_db
def test_adopting_a_builtin_claims_the_records_waiting_for_it(auth_client, project):
    auth_client.post(RECORDS, {"project": project.id, "category": "Product",
                               "data": {"Description": "x"}}, format="json")
    r = auth_client.post(SECTIONS, {"project": project.id, "name": "Product", "fields": []},
                         format="json")
    assert r.status_code == 201, r.data
    rec = WorkspaceRecord.objects.get()
    assert rec.section_id == r.data["id"]


@pytest.mark.django_db
def test_renaming_a_section_carries_its_records(auth_client, project):
    sec = mk(project, "Product")
    rec = WorkspaceRecord.objects.create(project=project, workspace=WS, section=sec,
                                         category="Product", data={"Description": "x"})
    r = auth_client.patch(f"{SECTIONS}{sec.id}/", {"name": "Produce"}, format="json")
    assert r.status_code == 200, r.data
    rec.refresh_from_db()
    assert rec.section_id == sec.id and rec.category == "Produce"


# --------------------------------------------------------------------------- #
# Built-in identity across a rename
#
# Built-in sections live in frontend config, not in the database, so a row only
# appears once one is customised. Identity used to be the name, which meant a
# rename detached the row and the built-in reappeared unadopted beside it.
# ``builtin_key`` is that identity, recorded once at adoption.
# --------------------------------------------------------------------------- #
@pytest.mark.django_db
def test_renaming_a_builtin_keeps_the_key_it_was_adopted_under(auth_client, project):
    r = auth_client.post(SECTIONS, {"project": project.id, "name": "Product",
                                    "builtin_key": "product", "fields": []}, format="json")
    assert r.status_code == 201, r.data
    r = auth_client.patch(f"{SECTIONS}{r.data['id']}/", {"name": "Products"}, format="json")
    assert r.status_code == 200, r.data
    # The name moved; the identity did not, so the grid still shows one section.
    assert r.data["name"] == "Products" and r.data["builtin_key"] == "product"


@pytest.mark.django_db
def test_builtin_key_is_normalised_on_the_way_in(auth_client, project):
    r = auth_client.post(SECTIONS, {"project": project.id, "name": "Product",
                                    "builtin_key": "  PRODUCT  ", "fields": []}, format="json")
    assert r.status_code == 201, r.data
    assert r.data["builtin_key"] == "product"


@pytest.mark.django_db
def test_a_section_cannot_be_repointed_to_another_builtin(auth_client, project):
    sec = mk(project, "Product", builtin_key="product")
    r = auth_client.patch(f"{SECTIONS}{sec.id}/", {"builtin_key": "category"}, format="json")
    # Repointing would hand this row — and its records — another built-in's
    # identity, so the grid would lose one section and duplicate the other.
    assert r.status_code == 400, r.data
    sec.refresh_from_db()
    assert sec.builtin_key == "product"


@pytest.mark.django_db
def test_a_section_adopted_before_the_key_existed_can_still_acquire_one(auth_client, project):
    """Rows adopted before ``builtin_key`` was added carry none. The first rename
    sends it, which is what keeps *those* sections attached to their built-in."""
    sec = mk(project, "Product")
    assert sec.builtin_key == ""
    r = auth_client.patch(f"{SECTIONS}{sec.id}/",
                          {"name": "Products", "builtin_key": "product"}, format="json")
    assert r.status_code == 200, r.data
    sec.refresh_from_db()
    assert sec.name == "Products" and sec.builtin_key == "product"


@pytest.mark.django_db
def test_resending_the_same_builtin_key_is_accepted(auth_client, project):
    """The client sends the key on every rename; that must not read as repointing."""
    sec = mk(project, "Product", builtin_key="product")
    r = auth_client.patch(f"{SECTIONS}{sec.id}/",
                          {"name": "Products", "builtin_key": "product"}, format="json")
    assert r.status_code == 200, r.data


@pytest.mark.django_db
def test_a_custom_section_keeps_an_empty_key(auth_client, project):
    r = auth_client.post(SECTIONS, {"project": project.id, "name": "Trials", "fields": []},
                         format="json")
    assert r.status_code == 201, r.data
    assert r.data["builtin_key"] == ""


@pytest.mark.django_db
def test_a_long_section_name_does_not_truncate_the_mirror(auth_client, project):
    long_name = "N" * 120
    sec = mk(project, long_name)
    rec = WorkspaceRecord.objects.create(project=project, workspace=WS, section=sec,
                                         category=long_name, data={})
    rec.refresh_from_db()
    assert len(rec.category) == 120


# --------------------------------------------------------------------------- #
# Delete / restore / purge
# --------------------------------------------------------------------------- #
@pytest.mark.django_db
def test_deleting_a_parent_leaves_descendants_untouched_but_unreachable(auth_client, project):
    a = mk(project, "A")
    b = mk(project, "B", parent=a)
    auth_client.delete(f"{SECTIONS}{a.id}/")
    a.refresh_from_db(); b.refresh_from_db()
    assert a.deleted_at is not None and a.hidden
    # The child is deliberately not stamped — it is hidden by its ancestor, so a
    # restore returns the subtree exactly as it was.
    assert b.deleted_at is None and not b.hidden
    assert b.is_effectively_hidden()


@pytest.mark.django_db
def test_archive_lists_only_the_subtree_root(auth_client, project):
    a = mk(project, "A")
    mk(project, "B", parent=a)
    auth_client.delete(f"{SECTIONS}{a.id}/")
    items = auth_client.get(ARCHIVE).data["items"]
    sections = [i for i in items if i["kind"] == "section"]
    assert [s["name"] for s in sections] == ["A"]


@pytest.mark.django_db
def test_restoring_a_parent_brings_back_the_subtree_and_its_records(auth_client, project):
    a = mk(project, "A")
    b = mk(project, "B", parent=a)
    WorkspaceRecord.objects.create(project=project, workspace=WS, section=b,
                                   category="B", data={"Description": "keep me"})
    auth_client.delete(f"{SECTIONS}{a.id}/")
    r = auth_client.post(ARCHIVE, {"kind": "section", "id": a.id}, format="json")
    assert r.status_code == 200, r.data
    a.refresh_from_db(); b.refresh_from_db()
    assert a.deleted_at is None and not a.hidden
    assert not b.is_effectively_hidden()
    assert b.records.count() == 1


@pytest.mark.django_db
def test_a_child_deleted_on_its_own_stays_deleted_when_the_parent_returns(auth_client, project):
    a = mk(project, "A")
    b = mk(project, "B", parent=a)
    auth_client.delete(f"{SECTIONS}{b.id}/")
    auth_client.delete(f"{SECTIONS}{a.id}/")
    auth_client.post(ARCHIVE, {"kind": "section", "id": a.id}, format="json")
    b.refresh_from_db()
    assert b.deleted_at is not None       # it was deleted in its own right


@pytest.mark.django_db
def test_cannot_restore_a_child_while_its_parent_is_deleted(auth_client, project):
    a = mk(project, "A")
    b = mk(project, "B", parent=a)
    auth_client.delete(f"{SECTIONS}{b.id}/")
    auth_client.delete(f"{SECTIONS}{a.id}/")
    r = auth_client.post(ARCHIVE, {"kind": "section", "id": b.id}, format="json")
    assert r.status_code == 400


@pytest.mark.django_db
def test_a_restore_rename_keeps_the_records_attached(auth_client, project):
    """The old bug: restoring into a name clash renamed the section, and every
    record — linked only by that name — was silently orphaned for good."""
    old = mk(project, "Trials")
    rec = WorkspaceRecord.objects.create(project=project, workspace=WS, section=old,
                                         category="Trials", data={"Description": "x"})
    auth_client.delete(f"{SECTIONS}{old.id}/")
    mk(project, "Trials")                       # the name is taken again
    r = auth_client.post(ARCHIVE, {"kind": "section", "id": old.id}, format="json")
    assert r.status_code == 200, r.data
    old.refresh_from_db(); rec.refresh_from_db()
    assert old.name == "Trials (restored)"
    assert rec.section_id == old.id             # the FK held
    assert rec.category == "Trials (restored)"  # and the mirror followed


@pytest.mark.django_db
def test_purge_takes_the_whole_subtree(auth_client, project):
    a = mk(project, "A")
    b = mk(project, "B", parent=a)
    c = mk(project, "C", parent=b)
    for sec in (a, b, c):
        WorkspaceRecord.objects.create(project=project, workspace=WS, section=sec,
                                       category=sec.name, data={})
    survivor = mk(project, "Untouched")
    WorkspaceRecord.objects.create(project=project, workspace=WS, section=survivor,
                                   category="Untouched", data={})

    auth_client.delete(f"{SECTIONS}{a.id}/")
    WorkspaceSection.objects.filter(pk=a.pk).update(
        deleted_at=timezone.now() - timedelta(days=ARCHIVE_TTL_DAYS + 1))

    purge_expired_deleted_items()
    assert not WorkspaceSection.objects.filter(pk__in=[a.pk, b.pk, c.pk]).exists()
    assert WorkspaceRecord.objects.count() == 1          # only the survivor's
    assert WorkspaceSection.objects.filter(pk=survivor.pk).exists()


@pytest.mark.django_db
def test_section_count_ignores_hidden_and_deleted(auth_client, project):
    mk(project, "Live")
    mk(project, "Nested", parent=WorkspaceSection.objects.get(name="Live"))
    mk(project, "Gone", hidden=True, deleted_at=timezone.now())
    r = auth_client.get(f"/api/workspace-projects/{project.id}/")
    assert r.data["section_count"] == 2       # both live rows, at any depth
