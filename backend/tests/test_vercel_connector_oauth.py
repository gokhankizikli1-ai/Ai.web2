# coding: utf-8
"""Vercel connector — OAuth foundation: one-time state, code exchange, scope.

Covers the security-bearing halves of Phase 1 that are not HTTP-level:
  * the OAuth state is unguessable, ownership-bound, single-use and TTL-bound;
  * the authorization URL carries the state and NO secret;
  * the code exchange posts the client secret SERVER-SIDE and surfaces Vercel's
    machine-readable error code without ever echoing the code/secret/token;
  * the team scope is taken from the TOKEN RESPONSE (the only trustworthy
    source), not from anything a browser could supply.

No real Vercel: `urlopen` is faked.
"""
from __future__ import annotations

import io
import json
import urllib.error

import pytest

from backend.services.vercel import config as vc_config
from backend.services.vercel import oauth as vc_oauth
from backend.services.vercel import setup_state as vc_setup
from backend.services.vercel.errors import (
    VercelConfigError, VercelOAuthError, VercelServerError,
)


@pytest.fixture()
def env(tmp_path, monkeypatch):
    db = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", db)
    monkeypatch.setenv("ENABLE_VERCEL_CONNECTOR", "true")
    monkeypatch.setenv("VERCEL_OAUTH_CLIENT_ID", "oac_test")
    monkeypatch.setenv("VERCEL_OAUTH_CLIENT_SECRET", "SUPER-SECRET")
    monkeypatch.setenv("VERCEL_OAUTH_REDIRECT_URI",
                       "https://backend.example.com/v2/vercel/oauth/callback")
    monkeypatch.setenv("VERCEL_INTEGRATION_SLUG", "korvixai")
    monkeypatch.setattr(vc_setup, "DB_PATH", db, raising=False)
    vc_setup._reset_for_tests()
    vc_setup.init_vercel_setup_tables()
    return db


class _Resp:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode("utf-8")

    def read(self, *_a):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _urlopen(monkeypatch, handler):
    monkeypatch.setattr(vc_oauth.urllib.request, "urlopen",
                        lambda req, timeout=None: handler(req))


# ── authorization URL ────────────────────────────────────────────────────────

def test_authorization_url_carries_state_and_no_secret(env):
    url = vc_oauth.build_authorization_url("STATE-123")
    assert url.startswith("https://vercel.com/integrations/korvixai/new?")
    assert "state=STATE-123" in url
    assert "SUPER-SECRET" not in url
    # No redirect_uri is passed as a query param — Vercel uses the integration's
    # REGISTERED redirect URL, so the target can never be steered per-request.
    assert "redirect_uri" not in url


def test_authorization_url_fails_closed_when_unconfigured(env, monkeypatch):
    monkeypatch.delenv("VERCEL_OAUTH_CLIENT_SECRET", raising=False)
    with pytest.raises(VercelConfigError):
        vc_oauth.build_authorization_url("s")


def test_install_url_override_wins(env, monkeypatch):
    monkeypatch.setenv("VERCEL_OAUTH_INSTALL_URL", "https://vercel.com/custom/new?x=1")
    url = vc_oauth.build_authorization_url("S")
    assert url == "https://vercel.com/custom/new?x=1&state=S"


# ── one-time, ownership-bound state ─────────────────────────────────────────

def test_state_is_single_use_and_ownership_bound(env):
    s = vc_setup.create_state(owner_user_id="uA", project_id="p1")
    assert len(s) >= 32  # 256-bit url-safe token
    first = vc_setup.consume(s)
    assert first is not None
    assert (first.owner_user_id, first.project_id, first.provider) == ("uA", "p1", "vercel")
    # Replay is rejected.
    assert vc_setup.consume(s) is None


def test_state_rejects_unknown_and_expired(env, monkeypatch):
    assert vc_setup.consume("never-issued") is None
    monkeypatch.setenv("VERCEL_OAUTH_STATE_TTL_S", "60")
    s = vc_setup.create_state(owner_user_id="uA", project_id="p1")
    # Fast-forward past the expiry by rewriting the stored instant.
    from backend.services.orchestrator import _sqlite
    with _sqlite.connection(env) as c:
        c.execute("UPDATE vercel_oauth_states SET expires_at=? WHERE state=?",
                  ("2000-01-01T00:00:00Z", s))
    assert vc_setup.consume(s) is None


def test_state_requires_owner_and_project(env):
    with pytest.raises(ValueError):
        vc_setup.create_state(owner_user_id="", project_id="p1")
    # An EMPTY project id is now legitimate: it is how an ACCOUNT-LEVEL
    # authorization is minted (connect the provider once, bind projects later).
    # The owner binding — the thing that makes the callback safe — is still
    # required.
    account_state = vc_setup.create_state(owner_user_id="uA", project_id="")
    consumed = vc_setup.consume(account_state)
    assert consumed is not None
    assert consumed.owner_user_id == "uA" and consumed.project_id == ""


def test_states_are_unique_per_call(env):
    tokens = {vc_setup.create_state(owner_user_id="uA", project_id="p1") for _ in range(20)}
    assert len(tokens) == 20


# ── code exchange ────────────────────────────────────────────────────────────

def test_exchange_code_posts_secret_server_side(env, monkeypatch):
    seen = {}

    def handler(req):
        seen["url"] = req.full_url
        seen["method"] = req.get_method()
        seen["body"] = req.data.decode("utf-8")
        return _Resp({"access_token": "vtok", "token_type": "Bearer",
                      "installation_id": "icfg_1", "user_id": "u_1",
                      "team_id": "team_9"})

    _urlopen(monkeypatch, handler)
    tok = vc_oauth.exchange_code("CODE-1")
    assert tok.access_token == "vtok"
    assert tok.team_id == "team_9"          # team scope from the TOKEN response
    assert tok.installation_id == "icfg_1"
    assert seen["method"] == "POST"
    assert seen["url"] == "https://api.vercel.com/v2/oauth/access_token"
    assert "client_secret=SUPER-SECRET" in seen["body"]
    assert "code=CODE-1" in seen["body"]
    assert "redirect_uri=" in seen["body"]


def test_exchange_code_personal_account_has_empty_team(env, monkeypatch):
    _urlopen(monkeypatch, lambda req: _Resp({"access_token": "vtok"}))
    tok = vc_oauth.exchange_code("CODE-1")
    assert tok.team_id == ""


def test_exchange_code_rejects_missing_code(env):
    with pytest.raises(VercelOAuthError):
        vc_oauth.exchange_code("")


def test_exchange_code_4xx_is_oauth_error_with_reason_not_secret(env, monkeypatch):
    body = json.dumps({"error": {"code": "bad_request", "message": "bad code"}}).encode()

    def handler(req):
        raise urllib.error.HTTPError(req.full_url, 400, "Bad Request", {}, io.BytesIO(body))

    _urlopen(monkeypatch, handler)
    with pytest.raises(VercelOAuthError) as ei:
        vc_oauth.exchange_code("REUSED-CODE")
    assert ei.value.reason == "bad_request"
    # Never echoes the code or the client secret.
    assert "REUSED-CODE" not in str(ei.value)
    assert "SUPER-SECRET" not in str(ei.value)


def test_exchange_code_5xx_is_server_error(env, monkeypatch):
    def handler(req):
        raise urllib.error.HTTPError(req.full_url, 503, "boom", {}, io.BytesIO(b""))

    _urlopen(monkeypatch, handler)
    with pytest.raises(VercelServerError):
        vc_oauth.exchange_code("C")


def test_exchange_code_missing_access_token_is_rejected(env, monkeypatch):
    _urlopen(monkeypatch, lambda req: _Resp({"token_type": "Bearer"}))
    with pytest.raises(VercelOAuthError):
        vc_oauth.exchange_code("C")


def test_exchange_code_unconfigured_fails_closed(env, monkeypatch):
    monkeypatch.delenv("VERCEL_OAUTH_CLIENT_ID", raising=False)
    with pytest.raises(VercelConfigError):
        vc_oauth.exchange_code("C")


# ── identity read (display label only, never fatal) ─────────────────────────

def test_account_label_uses_team_endpoint_when_team_scoped(env, monkeypatch):
    seen = {}

    def handler(req):
        seen["url"] = req.full_url
        return _Resp({"name": "Acme Inc", "slug": "acme"})

    _urlopen(monkeypatch, handler)
    assert vc_oauth.fetch_account_label("vtok", team_id="team_9") == "Acme Inc"
    assert seen["url"] == "https://api.vercel.com/v2/teams/team_9"


def test_account_label_uses_user_endpoint_for_personal(env, monkeypatch):
    _urlopen(monkeypatch, lambda req: _Resp({"user": {"username": "gokhan"}}))
    assert vc_oauth.fetch_account_label("vtok") == "gokhan"


def test_account_label_failure_is_not_fatal(env, monkeypatch):
    def handler(req):
        raise urllib.error.URLError("down")

    _urlopen(monkeypatch, handler)
    assert vc_oauth.fetch_account_label("vtok") == ""


def test_account_label_without_token_is_empty(env):
    assert vc_oauth.fetch_account_label("") == ""


# ── config bounds ────────────────────────────────────────────────────────────

def test_bounds_are_clamped(monkeypatch):
    monkeypatch.setenv("VERCEL_SYNC_PAGE_SIZE", "9999")
    monkeypatch.setenv("VERCEL_SYNC_MAX_PAGES", "99")
    monkeypatch.setenv("VERCEL_SYNC_INITIAL_MAX_PAGES", "0")
    monkeypatch.setenv("VERCEL_OAUTH_STATE_TTL_S", "999999")
    monkeypatch.setenv("VERCEL_PENDING_PROJECTS_MAX", "9999")
    assert vc_config.sync_page_size() == 100
    assert vc_config.sync_max_pages() == 5
    assert vc_config.sync_initial_max_pages() == 1
    assert vc_config.state_ttl_s() == 1800
    assert vc_config.pending_projects_max() == 200


def test_disabled_by_default(monkeypatch):
    monkeypatch.delenv("ENABLE_VERCEL_CONNECTOR", raising=False)
    assert vc_config.is_enabled() is False
