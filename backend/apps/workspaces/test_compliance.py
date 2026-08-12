"""Statutory-compliance reminders: due-date maths, deadline generation, the
lead/overdue reminders, and marking a filing filed."""
from __future__ import annotations

import datetime as dt

import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.notifications.models import Notification
from apps.workspaces import compliance
from apps.workspaces.models import ComplianceDeadline, ComplianceObligation, WorkspaceMember

WS = "finance-statutory"


@pytest.fixture
def finance_user(db):
    u = User.objects.create_user(username="fin", email="fin@x.io", password="pw")
    WorkspaceMember.objects.create(user=u, workspace=WS, access="edit")
    return u


def client(user) -> APIClient:
    c = APIClient()
    c.force_authenticate(user)
    return c


def test_the_five_obligations_are_seeded(db):
    names = set(ComplianceObligation.objects.filter(workspace=WS).values_list("name", flat=True))
    assert names == {"GSTR-1", "GSTR-3B", "TDS Payment", "TDS Quarterly Return", "GSTR-9 (Annual Return)"}


def test_monthly_due_date(db):
    ob = ComplianceObligation.objects.get(workspace=WS, name="GSTR-1")
    # The Aug 2026 return is due the 11th of Sep 2026.
    assert compliance.iter_due_dates(ob, dt.date(2026, 9, 11), dt.date(2026, 9, 11)) == [
        ("Aug 2026", dt.date(2026, 9, 11))]


def test_quarterly_due_date(db):
    ob = ComplianceObligation.objects.get(workspace=WS, name="TDS Quarterly Return")
    # Q1 (Apr–Jun) 2026 is due 31 Jul 2026.
    assert compliance.iter_due_dates(ob, dt.date(2026, 7, 31), dt.date(2026, 7, 31)) == [
        ("Q1 Apr–Jun 2026", dt.date(2026, 7, 31))]


def test_annual_due_date(db):
    ob = ComplianceObligation.objects.get(workspace=WS, name="GSTR-9 (Annual Return)")
    # FY 2024-25 is due 31 Dec 2025.
    assert compliance.iter_due_dates(ob, dt.date(2025, 12, 31), dt.date(2025, 12, 31)) == [
        ("FY 2024-25", dt.date(2025, 12, 31))]


def test_generator_creates_upcoming_deadlines(db):
    ob = ComplianceObligation.objects.get(workspace=WS, name="GSTR-1")
    compliance.ensure_upcoming_deadlines(ob, today=dt.date(2026, 8, 1))
    assert ob.deadlines.filter(due_date=dt.date(2026, 9, 11), period_label="Aug 2026").exists()


def test_lead_reminder_fires_once(finance_user, db):
    ob = ComplianceObligation.objects.get(workspace=WS, name="GSTR-1")
    ComplianceDeadline.objects.create(obligation=ob, period_label="Aug 2026", due_date=dt.date(2026, 9, 11))
    today = dt.date(2026, 9, 7)   # 4 days out → within the 5-day lead window

    compliance.scan_compliance(today=today, workspace=WS)
    fired = Notification.objects.filter(recipient=finance_user, event="compliance_due",
                                        title__icontains="GSTR-1 — Aug 2026")
    assert fired.exists()
    before = fired.count()
    compliance.scan_compliance(today=today, workspace=WS)   # a second scan same day
    assert fired.count() == before                          # doesn't re-notify


def test_overdue_reminder_fires(finance_user, db):
    ob = ComplianceObligation.objects.get(workspace=WS, name="GSTR-1")
    ComplianceDeadline.objects.create(obligation=ob, period_label="Jul 2026", due_date=dt.date(2026, 8, 11))
    compliance.scan_compliance(today=dt.date(2026, 8, 15), workspace=WS)
    assert Notification.objects.filter(recipient=finance_user, title__icontains="Overdue filing") \
        .filter(title__icontains="Jul 2026").exists()


def test_no_reminder_outside_the_window(finance_user, db):
    ob = ComplianceObligation.objects.get(workspace=WS, name="GSTR-1")
    ComplianceDeadline.objects.create(obligation=ob, period_label="Aug 2026", due_date=dt.date(2026, 9, 11))
    compliance.scan_compliance(today=dt.date(2026, 8, 20), workspace=WS)   # 22 days out
    assert not Notification.objects.filter(
        recipient=finance_user, title__icontains="GSTR-1 — Aug 2026").exists()


def test_mark_filed(finance_user, db):
    ob = ComplianceObligation.objects.get(workspace=WS, name="GSTR-1")
    dl = ComplianceDeadline.objects.create(obligation=ob, period_label="Aug 2026", due_date=dt.date(2026, 9, 11))
    r = client(finance_user).post(f"/api/compliance-deadlines/{dl.id}/file/")
    assert r.status_code == 200, r.data
    dl.refresh_from_db()
    assert dl.status == "filed" and dl.filed_by == finance_user and dl.filed_at is not None


def test_edit_due_date_for_an_extension(finance_user, db):
    ob = ComplianceObligation.objects.get(workspace=WS, name="GSTR-1")
    dl = ComplianceDeadline.objects.create(obligation=ob, period_label="Aug 2026", due_date=dt.date(2026, 9, 11))
    r = client(finance_user).patch(f"/api/compliance-deadlines/{dl.id}/", {"due_date": "2026-09-25"}, format="json")
    assert r.status_code == 200, r.data
    dl.refresh_from_db()
    assert str(dl.due_date) == "2026-09-25"


def test_a_non_member_sees_nothing(db):
    outsider = User.objects.create_user(username="out", email="out@x.io", password="pw")
    r = client(outsider).get(f"/api/compliance-deadlines/?workspace={WS}")
    assert r.status_code == 200
    assert r.data == []


def test_user_can_add_an_obligation(finance_user, db):
    r = client(finance_user).post("/api/compliance-obligations/", {
        "workspace": WS, "name": "Professional Tax", "cadence": "monthly", "due_day": 20, "lead_days": 5,
    }, format="json")
    assert r.status_code == 201, r.data
    ob = ComplianceObligation.objects.get(workspace=WS, name="Professional Tax")
    assert ob.month_offset == 1              # sensible default when omitted
    assert ob.deadlines.exists()             # deadlines generated on create


def test_annual_obligation_needs_a_due_month(finance_user, db):
    r = client(finance_user).post("/api/compliance-obligations/", {
        "workspace": WS, "name": "Some Annual", "cadence": "annual", "due_day": 31,
    }, format="json")
    assert r.status_code == 400


def test_a_non_editor_cannot_add(db):
    outsider = User.objects.create_user(username="out2", email="out2@x.io", password="pw")
    r = client(outsider).post("/api/compliance-obligations/", {
        "workspace": WS, "name": "Nope", "cadence": "monthly", "due_day": 5,
    }, format="json")
    assert r.status_code == 403


def test_can_delete_an_obligation(finance_user, db):
    ob = ComplianceObligation.objects.create(workspace=WS, name="Temp", cadence="monthly", due_day=10)
    r = client(finance_user).delete(f"/api/compliance-obligations/{ob.id}/")
    assert r.status_code == 204
    assert not ComplianceObligation.objects.filter(id=ob.id).exists()
