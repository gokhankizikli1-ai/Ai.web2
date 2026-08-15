# coding: utf-8
"""Slack connector — OAuth v2 (authorization URL + server-side code exchange).

Covers the exact scopes requested, the deliberate absence of any user-token
request, the `ok: false`-at-HTTP-200 rejection path Slack actually uses, the
fail-closed behaviour when the app is unconfigured, and secret discipline (the
client secret / code / bot token never appear in an error). No real network:
the token POST is stubbed at the urllib seam.
"""
from __future__ import annotations

import io
import json
import urllib.error
import urllib.parse

import pytest

from backend.services.slack import config as sl_config
from backend.services.slack import oauth as sl_oauth
from backend.services.slack.errors import (
    SlackConfigError, SlackOAuthError, SlackServerError,
)

SECRET = "SLACK-CLIENT-SECRET"
BOT_TOKEN = "xoxb-REAL-BOT-TOKEN"
CODE = "1234.5678.authcode"


@pytest.fixture()
def env(monkeypatch):
    monkeypatch.setenv("ENABLE_SLACK_CONNECTOR", "true")
    monkeypatch.setenv("SLACK_CLIENT_ID", "A123.456")
    monkeypatch.setenv("SLACK_CLIENT_SECRET", SECRET)
    monkeypatch.setenv("SLACK_OAUTH_REDIRECT_URI",
                       "https://backend.example.com/v2/slack/oauth/callback")
    monkeypatch.setenv("SLACK_API_BASE", "https://slack.test/api")
    yield


class _Resp(io.BytesIO):
    """Minimal urlopen context-manager stand-in."""

    def __init__(self, payload):
        super().__init__(json.dumps(payload).encode("utf-8"))
        self.status = 200

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _stub_urlopen(monkeypatch, payload, *, capture=None):
    def fake(req, timeout=None):
        if capture is not None:
            capture["url"] = req.full_url
            capture["method"] = req.get_method()
            capture["body"] = dict(urllib.parse.parse_qsl(
                (req.data or b"").decode("utf-8")))
        return _Resp(payload)

    monkeypatch.setattr(sl_oauth.urllib.request, "urlopen", fake)


def _http_error(status, payload):
    body = json.dumps(payload).encode("utf-8")
    return urllib.error.HTTPError("https://slack.test/api/oauth.v2.access", status,
                                  "err", {}, io.BytesIO(body))


TOKEN_PAYLOAD = {
    "ok": True,
    "access_token": BOT_TOKEN,
    "token_type": "bot",
    "scope": "channels:read,channels:history,groups:read,groups:history",
    "bot_user_id": "U0BOT",
    "app_id": "A123",
    "team": {"id": "T_WORKSPACE", "name": "Korvix HQ"},
    # Slack sends this when a user scope was granted. We never request one, but
    # if it ever appeared it must NOT be persisted.
    "authed_user": {"id": "U_HUMAN"},
}


# ── authorization URL ────────────────────────────────────────────────────────

def test_authorization_url_requests_exactly_the_four_readonly_bot_scopes(env):
    url = sl_oauth.build_authorization_url("STATE-1")
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    assert url.startswith("https://slack.com/oauth/v2/authorize?")
    assert set(q["scope"][0].split(",")) == {
        "channels:read", "channels:history", "groups:read", "groups:history"}
    assert q["state"] == ["STATE-1"]
    assert q["redirect_uri"] == ["https://backend.example.com/v2/slack/oauth/callback"]
    assert q["client_id"] == ["A123.456"]


def test_authorization_url_requests_no_user_token(env):
    """`user_scope` is sent EMPTY on purpose: Korvix stores a bot token only."""
    url = sl_oauth.build_authorization_url("S")
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query,
                              keep_blank_values=True)
    assert q.get("user_scope") == [""]


def test_authorization_url_never_contains_the_client_secret(env):
    assert SECRET not in sl_oauth.build_authorization_url("S")


def test_authorization_url_requests_no_write_scope(env):
    url = sl_oauth.build_authorization_url("S")
    for forbidden in ("chat:write", "files:read", "users:read", "im:history",
                      "reactions:write", "channels:manage", "admin",
                      "incoming-webhook"):
        assert forbidden not in url


def test_authorization_url_fails_closed_when_unconfigured(env, monkeypatch):
    monkeypatch.delenv("SLACK_CLIENT_SECRET", raising=False)
    with pytest.raises(SlackConfigError):
        sl_oauth.build_authorization_url("S")


# ── code exchange ────────────────────────────────────────────────────────────

def test_exchange_returns_the_bot_token_and_authoritative_workspace(env, monkeypatch):
    captured = {}
    _stub_urlopen(monkeypatch, TOKEN_PAYLOAD, capture=captured)
    tok = sl_oauth.exchange_code(CODE)
    assert tok.access_token == BOT_TOKEN
    assert tok.team_id == "T_WORKSPACE"
    assert tok.team_name == "Korvix HQ"
    assert tok.bot_user_id == "U0BOT"
    assert tok.app_id == "A123"
    # The exchange is a server-side POST carrying the secret in the BODY.
    assert captured["method"] == "POST"
    assert captured["url"] == "https://slack.test/api/oauth.v2.access"
    assert captured["body"]["client_secret"] == SECRET
    assert captured["body"]["code"] == CODE
    assert captured["body"]["redirect_uri"].endswith("/v2/slack/oauth/callback")


def test_exchange_result_carries_no_user_token_field(env, monkeypatch):
    """The dataclass has no place to put a user token, so one cannot leak into
    the connection even if Slack returned it."""
    _stub_urlopen(monkeypatch, TOKEN_PAYLOAD)
    tok = sl_oauth.exchange_code(CODE)
    fields = set(tok.__dataclass_fields__)
    assert "authed_user" not in fields
    assert not any("user_token" in f for f in fields)
    assert "U_HUMAN" not in json.dumps(tok.__dict__)


def test_exchange_rejects_slack_ok_false_at_http_200(env, monkeypatch):
    """Slack answers HTTP 200 with {"ok": false} for a bad/reused code. Treating
    that as success would store a connection with no credential."""
    _stub_urlopen(monkeypatch, {"ok": False, "error": "invalid_code"})
    with pytest.raises(SlackOAuthError) as exc:
        sl_oauth.exchange_code(CODE)
    assert exc.value.reason == "invalid_code"


def test_exchange_rejects_a_grant_without_a_bot_token(env, monkeypatch):
    _stub_urlopen(monkeypatch, {"ok": True, "team": {"id": "T1"},
                                "authed_user": {"access_token": "xoxp-USER"}})
    with pytest.raises(SlackOAuthError) as exc:
        sl_oauth.exchange_code(CODE)
    assert exc.value.reason == "missing_bot_token"


def test_exchange_rejects_a_response_without_a_team_id(env, monkeypatch):
    _stub_urlopen(monkeypatch, {"ok": True, "access_token": BOT_TOKEN})
    with pytest.raises(SlackOAuthError) as exc:
        sl_oauth.exchange_code(CODE)
    assert exc.value.reason == "missing_team_id"


def test_exchange_rejects_an_empty_code_without_calling_slack(env, monkeypatch):
    def boom(*a, **k):  # pragma: no cover — must never run
        raise AssertionError("no provider call should be made")

    monkeypatch.setattr(sl_oauth.urllib.request, "urlopen", boom)
    with pytest.raises(SlackOAuthError) as exc:
        sl_oauth.exchange_code("")
    assert exc.value.reason == "missing_code"


def test_exchange_fails_closed_when_unconfigured(env, monkeypatch):
    monkeypatch.delenv("SLACK_CLIENT_ID", raising=False)
    with pytest.raises(SlackConfigError):
        sl_oauth.exchange_code(CODE)


def test_exchange_maps_a_4xx_to_a_typed_oauth_error_without_secrets(env, monkeypatch):
    def fake(req, timeout=None):
        raise _http_error(400, {"error": "invalid_client_id"})

    monkeypatch.setattr(sl_oauth.urllib.request, "urlopen", fake)
    with pytest.raises(SlackOAuthError) as exc:
        sl_oauth.exchange_code(CODE)
    assert exc.value.reason == "invalid_client_id"
    message = str(exc.value)
    assert SECRET not in message and CODE not in message and BOT_TOKEN not in message


def test_exchange_maps_a_5xx_to_a_transient_server_error(env, monkeypatch):
    def fake(req, timeout=None):
        raise _http_error(503, {"error": "service_unavailable"})

    monkeypatch.setattr(sl_oauth.urllib.request, "urlopen", fake)
    with pytest.raises(SlackServerError):
        sl_oauth.exchange_code(CODE)


def test_exchange_maps_a_network_failure_to_a_transient_server_error(env, monkeypatch):
    def fake(req, timeout=None):
        raise urllib.error.URLError("connection reset")

    monkeypatch.setattr(sl_oauth.urllib.request, "urlopen", fake)
    with pytest.raises(SlackServerError):
        sl_oauth.exchange_code(CODE)


# ── no mutation / revoke surface ────────────────────────────────────────────

def test_oauth_module_exposes_no_revoke_or_write_helper():
    """A remote revoke would break every OTHER Korvix project bound to the same
    Slack workspace installation (Slack installs an app once per workspace), so
    the helper deliberately does not exist."""
    exported = set(sl_oauth.__all__)
    assert exported == {"TokenResponse", "build_authorization_url", "exchange_code"}
    for forbidden in ("revoke", "post_message", "uninstall", "write"):
        assert not any(forbidden in name for name in dir(sl_oauth)
                       if not name.startswith("_"))


def test_config_scope_tuple_is_the_single_source_of_truth():
    assert sl_config.BOT_SCOPES == ("channels:read", "channels:history",
                                    "groups:read", "groups:history")
    assert sl_config.scope_param() == ",".join(sl_config.BOT_SCOPES)
