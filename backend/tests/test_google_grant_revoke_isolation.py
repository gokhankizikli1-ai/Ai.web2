# coding: utf-8
"""`backend.services.google_grant` — the shared-Google-grant revoke guard.

Korvix's two Google connectors (Gmail + Google Calendar) reuse ONE Google OAuth
Web client by design. Google models consent as one GRANT per (client_id, user),
so POSTing either connector's refresh token to the revoke endpoint can destroy
the sibling's credential too. This module is the single authority that decides
whether a remote revoke is safe; these tests pin its behaviour, including its
FAIL-CLOSED defaults.

Local credential deletion is never gated by any of this — it is unconditional in
both disconnect routes and is covered by the route tests.
"""
from __future__ import annotations

import pytest

from backend.services import google_grant
from backend.services.gmail import crypto as credential_crypto
from backend.services.gmail import store as gm_store
from backend.services.google_calendar import store as cal_store

GMAIL = google_grant.PROVIDER_GMAIL
CALENDAR = google_grant.PROVIDER_CALENDAR


@pytest.fixture()
def grants(tmp_path, monkeypatch):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setattr(gm_store, "DB_PATH", path, raising=False)
    monkeypatch.setattr(cal_store, "DB_PATH", path, raising=False)
    # Shared Google client (the default deployment): Calendar falls back to the
    # Gmail client id.
    monkeypatch.setenv("GMAIL_OAUTH_CLIENT_ID", "shared.apps.googleusercontent.com")
    monkeypatch.delenv("CALENDAR_OAUTH_CLIENT_ID", raising=False)
    credential_crypto.set_cipher_for_tests(credential_crypto._ReversibleTestCipher())
    gm_store._reset_for_tests(); gm_store.init_gmail_tables()
    cal_store._reset_for_tests(); cal_store.init_calendar_tables()
    yield path
    credential_crypto.set_cipher_for_tests(None)


def _gmail(project_id="p1", email="me@x.com"):
    return gm_store.upsert_connection(
        project_id=project_id, owner_user_id="uA", google_email=email,
        scopes="", refresh_token="GM-RT", access_token="GM-AT")


def _calendar(project_id="p1", email="me@x.com"):
    return cal_store.upsert_connection(
        project_id=project_id, owner_user_id="uA", google_email=email,
        calendar_id="primary", time_zone="UTC", scopes="",
        refresh_token="CAL-RT", access_token="CAL-AT")


# ── the safe case: nothing else shares the grant ─────────────────────────────

def test_revoke_is_safe_when_no_sibling_connection_exists(grants):
    _calendar()
    assert google_grant.remote_revoke_is_safe(
        provider=CALENDAR, google_email="me@x.com", project_id="p1") is True


def test_gmail_revoke_is_safe_when_no_calendar_connection_exists(grants):
    _gmail()
    assert google_grant.remote_revoke_is_safe(
        provider=GMAIL, google_email="me@x.com", project_id="p1") is True


# ── the dangerous cases: a sibling would be destroyed ────────────────────────

def test_calendar_revoke_blocked_by_a_live_gmail_connection(grants):
    _gmail(project_id="p1", email="me@x.com")
    _calendar(project_id="p1", email="me@x.com")
    assert google_grant.remote_revoke_is_safe(
        provider=CALENDAR, google_email="me@x.com", project_id="p1") is False


def test_gmail_revoke_blocked_by_a_live_calendar_connection(grants):
    _gmail(project_id="p1", email="me@x.com")
    _calendar(project_id="p1", email="me@x.com")
    assert google_grant.remote_revoke_is_safe(
        provider=GMAIL, google_email="me@x.com", project_id="p1") is False


def test_sibling_on_a_DIFFERENT_project_also_blocks(grants):
    """The grant is per Google ACCOUNT, not per Korvix project — a Gmail
    connection on another project shares it just as much."""
    _gmail(project_id="p2", email="me@x.com")
    _calendar(project_id="p1", email="me@x.com")
    assert google_grant.remote_revoke_is_safe(
        provider=CALENDAR, google_email="me@x.com", project_id="p1") is False


def test_same_connector_on_another_project_also_blocks(grants):
    """Disconnecting Calendar from p1 must not revoke the grant that Calendar on
    p2 (same Google account) still depends on."""
    _calendar(project_id="p1", email="me@x.com")
    _calendar(project_id="p2", email="me@x.com")
    assert google_grant.remote_revoke_is_safe(
        provider=CALENDAR, google_email="me@x.com", project_id="p1") is False


def test_a_different_google_account_does_not_block(grants):
    _gmail(project_id="p2", email="someone-else@x.com")
    _calendar(project_id="p1", email="me@x.com")
    assert google_grant.remote_revoke_is_safe(
        provider=CALENDAR, google_email="me@x.com", project_id="p1") is True


def test_a_revoked_sibling_does_not_block(grants):
    _gmail(project_id="p1", email="me@x.com")
    gm_store.mark_revoked("p1")
    _calendar(project_id="p1", email="me@x.com")
    assert google_grant.remote_revoke_is_safe(
        provider=CALENDAR, google_email="me@x.com", project_id="p1") is True


# ── fail-closed defaults ─────────────────────────────────────────────────────

def test_unknown_identity_fails_closed(grants):
    """With no Google account on the connection we cannot prove no sibling
    shares it, so the remote revoke is skipped (local deletion still happens)."""
    assert google_grant.remote_revoke_is_safe(
        provider=CALENDAR, google_email="", project_id="p1") is False
    assert google_grant.remote_revoke_is_safe(
        provider=CALENDAR, google_email="   ", project_id="p1") is False


def test_unknown_provider_with_separate_clients_fails_closed(grants, monkeypatch):
    monkeypatch.setenv("CALENDAR_OAUTH_CLIENT_ID", "calendar-only")
    assert google_grant.remote_revoke_is_safe(
        provider="not-a-google-connector", google_email="me@x.com") is False


def test_store_failure_fails_closed(grants, monkeypatch):
    def _boom(email, *, exclude_project_id=""):
        raise RuntimeError("db is down")
    monkeypatch.setattr(gm_store, "count_connected_for_email", _boom)
    assert google_grant.remote_revoke_is_safe(
        provider=CALENDAR, google_email="me@x.com", project_id="p1") is False


# ── separate Google clients ⇒ independent grants ─────────────────────────────

def test_separate_google_clients_make_the_other_connector_irrelevant(grants, monkeypatch):
    monkeypatch.setenv("CALENDAR_OAUTH_CLIENT_ID", "calendar-only.apps.googleusercontent.com")
    _gmail(project_id="p1", email="me@x.com")
    _calendar(project_id="p1", email="me@x.com")
    # Gmail's grant is now a different grant entirely → revoking Calendar's is safe.
    assert google_grant.remote_revoke_is_safe(
        provider=CALENDAR, google_email="me@x.com", project_id="p1") is True


def test_separate_clients_still_protect_the_same_connectors_other_projects(grants, monkeypatch):
    monkeypatch.setenv("CALENDAR_OAUTH_CLIENT_ID", "calendar-only.apps.googleusercontent.com")
    _calendar(project_id="p1", email="me@x.com")
    _calendar(project_id="p2", email="me@x.com")
    assert google_grant.remote_revoke_is_safe(
        provider=CALENDAR, google_email="me@x.com", project_id="p1") is False


def test_guard_never_mutates_anything(grants):
    _gmail(project_id="p1", email="me@x.com")
    _calendar(project_id="p1", email="me@x.com")
    before_gm = gm_store.get_connection("p1")
    before_cal = cal_store.get_connection("p1")
    for provider in (GMAIL, CALENDAR):
        google_grant.remote_revoke_is_safe(
            provider=provider, google_email="me@x.com", project_id="p1")
    assert gm_store.get_connection("p1") == before_gm
    assert cal_store.get_connection("p1") == before_cal
