# coding: utf-8
"""Google Calendar connector — OAuth URL building + config resolution.

No network: only the pure URL/So-config surface is exercised here (the token
exchange itself is covered through the route tests with a faked exchange).

The security-critical assertions are:
  * EXACTLY ONE scope, and it is the read-only events scope.
  * `include_granted_scopes` is NOT sent — otherwise the Calendar token would
    inherit Gmail's scope on the shared Google client.
  * the redirect URI is the pre-registered CALENDAR value, never Gmail's.
  * the client secret never appears in anything returned to a caller.
"""
from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import pytest

from backend.services.google_calendar import config as cal_config
from backend.services.google_calendar import oauth as cal_oauth
from backend.services.google_calendar.errors import CalendarConfigError


@pytest.fixture()
def google_env(monkeypatch):
    monkeypatch.delenv("CALENDAR_OAUTH_CLIENT_ID", raising=False)
    monkeypatch.delenv("CALENDAR_OAUTH_CLIENT_SECRET", raising=False)
    monkeypatch.setenv("GMAIL_OAUTH_CLIENT_ID", "cid.apps.googleusercontent.com")
    monkeypatch.setenv("GMAIL_OAUTH_CLIENT_SECRET", "gmail-secret")
    monkeypatch.setenv("CALENDAR_OAUTH_REDIRECT_URI",
                       "https://backend.example.com/v2/calendar/oauth/callback")
    monkeypatch.setenv("GMAIL_OAUTH_REDIRECT_URI",
                       "https://backend.example.com/v2/gmail/oauth/callback")
    return monkeypatch


def _params(url: str):
    return {k: v[0] for k, v in parse_qs(urlparse(url).query).items()}


def test_scope_is_exactly_one_readonly_events_scope(google_env):
    assert cal_config.scopes() == [
        "https://www.googleapis.com/auth/calendar.events.readonly"]
    # Nothing that could write, and no Gmail scope.
    joined = cal_config.scope_param()
    assert "readonly" in joined
    assert "gmail" not in joined
    assert joined.count(" ") == 0  # a single scope


def test_authorization_url_shape(google_env):
    url = cal_oauth.build_authorization_url("STATE-123")
    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    p = _params(url)
    assert p["client_id"] == "cid.apps.googleusercontent.com"
    assert p["redirect_uri"] == "https://backend.example.com/v2/calendar/oauth/callback"
    assert p["response_type"] == "code"
    assert p["scope"] == "https://www.googleapis.com/auth/calendar.events.readonly"
    assert p["access_type"] == "offline"      # guarantees a refresh token
    assert p["prompt"] == "consent"
    assert p["state"] == "STATE-123"
    # The client SECRET never appears in a browser-bound URL.
    assert "gmail-secret" not in url


def test_authorization_url_does_not_include_granted_scopes(google_env):
    """Incremental authorization would hand the Calendar token Gmail's scope on
    the shared Google client. It must never be requested."""
    url = cal_oauth.build_authorization_url("S")
    assert "include_granted_scopes" not in url


def test_calendar_redirect_uri_is_not_gmails(google_env):
    from backend.services.gmail import config as gm_config
    assert cal_config.redirect_uri() != gm_config.redirect_uri()
    assert cal_config.redirect_uri().endswith("/v2/calendar/oauth/callback")


def test_client_falls_back_through_gmail_then_google(monkeypatch):
    monkeypatch.delenv("CALENDAR_OAUTH_CLIENT_ID", raising=False)
    monkeypatch.delenv("GMAIL_OAUTH_CLIENT_ID", raising=False)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "shared-google-id")
    assert cal_config.client_id() == "shared-google-id"
    monkeypatch.setenv("GMAIL_OAUTH_CLIENT_ID", "gmail-id")
    assert cal_config.client_id() == "gmail-id"
    monkeypatch.setenv("CALENDAR_OAUTH_CLIENT_ID", "calendar-id")
    assert cal_config.client_id() == "calendar-id"


def test_shares_google_client_detection(google_env, monkeypatch):
    # Same resolved client id (Calendar falls back to Gmail's) ⇒ shared.
    assert cal_config.shares_google_client_with_gmail() is True
    # A dedicated Calendar client ⇒ independent grants.
    monkeypatch.setenv("CALENDAR_OAUTH_CLIENT_ID", "calendar-only-id")
    assert cal_config.shares_google_client_with_gmail() is False


def test_unconfigured_client_fails_closed(monkeypatch):
    for k in ("CALENDAR_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_ID", "GOOGLE_CLIENT_ID",
              "CALENDAR_OAUTH_CLIENT_SECRET", "GMAIL_OAUTH_CLIENT_SECRET",
              "GOOGLE_CLIENT_SECRET", "CALENDAR_OAUTH_REDIRECT_URI"):
        monkeypatch.delenv(k, raising=False)
    assert cal_config.oauth_configured() is False
    with pytest.raises(CalendarConfigError):
        cal_oauth.build_authorization_url("S")


def test_enabled_flag_defaults_off(monkeypatch):
    monkeypatch.delenv("ENABLE_CALENDAR_CONNECTOR", raising=False)
    assert cal_config.is_enabled() is False
    monkeypatch.setenv("ENABLE_CALENDAR_CONNECTOR", "true")
    assert cal_config.is_enabled() is True


def test_module_exposes_no_write_helper():
    """Read-only guarantee at the module surface: nothing that could create,
    edit, move, or delete an event."""
    forbidden = ("insert", "update", "patch", "delete", "move", "import_event",
                 "quick_add", "create_event")
    names = {n.lower() for n in dir(cal_oauth)}
    from backend.services.google_calendar import client as cal_client
    names |= {n.lower() for n in dir(cal_client.CalendarClient)}
    assert not [f for f in forbidden if any(f in n for n in names)]


def test_sync_bounds_are_clamped(monkeypatch):
    monkeypatch.setenv("CALENDAR_SYNC_UPCOMING_DAYS", "9999")
    monkeypatch.setenv("CALENDAR_SYNC_PAST_DAYS", "-5")
    monkeypatch.setenv("CALENDAR_SYNC_PAGE_SIZE", "100000")
    monkeypatch.setenv("CALENDAR_SYNC_MAX_PAGES", "99")
    monkeypatch.setenv("CALENDAR_SYNC_MAX_EVENTS", "99999")
    monkeypatch.setenv("CALENDAR_ATTENDEES_MAX", "9999")
    monkeypatch.setenv("CALENDAR_DESCRIPTION_MAX_CHARS", "99999")
    assert cal_config.sync_upcoming_days() == 180
    assert cal_config.sync_past_days() == 0
    assert cal_config.sync_page_size() == 250
    assert cal_config.sync_max_pages() == 5
    assert cal_config.sync_max_events() == 500
    assert cal_config.attendees_max() == 20
    assert cal_config.description_max_chars() == 1000
