# coding: utf-8
"""Gmail connector — OAuth URL construction + error extraction (no network)."""
from __future__ import annotations

import urllib.parse

import pytest

from backend.services.gmail import config as gm_config
from backend.services.gmail import oauth as gm_oauth
from backend.services.gmail.errors import GmailConfigError, GmailOAuthError


@pytest.fixture()
def oauth_env(monkeypatch):
    monkeypatch.setenv("GMAIL_OAUTH_CLIENT_ID", "client-123.apps.googleusercontent.com")
    monkeypatch.setenv("GMAIL_OAUTH_CLIENT_SECRET", "shh-secret")
    monkeypatch.setenv("GMAIL_OAUTH_REDIRECT_URI",
                       "https://backend.example.com/v2/gmail/oauth/callback")
    yield


def test_authorization_url_minimum_scope_and_offline(oauth_env):
    url = gm_oauth.build_authorization_url("state-xyz")
    parsed = urllib.parse.urlparse(url)
    q = urllib.parse.parse_qs(parsed.query)
    assert q["client_id"] == ["client-123.apps.googleusercontent.com"]
    assert q["redirect_uri"] == ["https://backend.example.com/v2/gmail/oauth/callback"]
    assert q["response_type"] == ["code"]
    assert q["access_type"] == ["offline"]
    assert q["prompt"] == ["consent"]
    assert q["state"] == ["state-xyz"]
    # Exactly the single read-only scope — no openid/email/profile.
    assert q["scope"] == [gm_config.GMAIL_READONLY_SCOPE]
    # Secret never appears in the URL.
    assert "shh-secret" not in url


def test_authorization_url_requires_config(monkeypatch):
    monkeypatch.delenv("GMAIL_OAUTH_CLIENT_ID", raising=False)
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    monkeypatch.delenv("GMAIL_OAUTH_CLIENT_SECRET", raising=False)
    monkeypatch.delenv("GMAIL_OAUTH_REDIRECT_URI", raising=False)
    with pytest.raises(GmailConfigError):
        gm_oauth.build_authorization_url("s")


def test_exchange_code_requires_code(oauth_env):
    with pytest.raises(GmailOAuthError):
        gm_oauth.exchange_code("")


def test_refresh_requires_token(oauth_env):
    with pytest.raises(GmailOAuthError):
        gm_oauth.refresh_access_token("")


def test_exchange_code_maps_token_response(oauth_env, monkeypatch):
    monkeypatch.setattr(gm_oauth, "_post_token", lambda fields: {
        "access_token": "AT", "refresh_token": "RT", "expires_in": 3600,
        "scope": gm_config.GMAIL_READONLY_SCOPE, "token_type": "Bearer",
    })
    tok = gm_oauth.exchange_code("the-code")
    assert tok.access_token == "AT"
    assert tok.refresh_token == "RT"
    assert tok.expires_in == 3600


def test_client_id_falls_back_to_google_client_id(monkeypatch):
    monkeypatch.delenv("GMAIL_OAUTH_CLIENT_ID", raising=False)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "shared-google-id")
    assert gm_config.client_id() == "shared-google-id"
