# coding: utf-8
"""GitHub connector — App authentication seam.

Uses NO real private key and hits NO real GitHub: `mint_app_jwt` is
monkeypatched to a sentinel (so RS256/crypto is never invoked) and the token
POST's `urllib.request.urlopen` is faked. Covers JWT-generation seam, token
acquisition, expiry/refresh, caching, redaction, and truthful error mapping.
"""
from __future__ import annotations

import json

import pytest

from backend.services.github import auth
from backend.services.github import config as gh_config
from backend.services.github.errors import (
    GitHubAuthError, GitHubConfigError, GitHubNotFoundError, GitHubRateLimitError,
)


# Capture the REAL mint before the autouse fixture swaps in a sentinel, so the
# config-guard test can exercise the genuine function (which raises BEFORE any
# crypto import when id/key are absent).
_REAL_MINT = auth.mint_app_jwt


class _FakeResp:
    def __init__(self, payload: dict):
        self._body = json.dumps(payload).encode("utf-8")

    def read(self, *_a):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _HTTPError:
    """Marker the handler returns to signal 'raise an HTTPError(code)'."""
    def __init__(self, code, body=b"", headers=None):
        self.code = code
        self._body = body
        self.headers = headers or {}


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    auth._reset_cache_for_tests()
    # No real signing — the App JWT is a sentinel string.
    monkeypatch.setattr(auth, "mint_app_jwt", lambda **k: "sentinel.app.jwt")
    yield
    auth._reset_cache_for_tests()


def _install_urlopen(monkeypatch, handler):
    import io
    import urllib.error

    def fake_urlopen(req, timeout=None):
        result = handler(req)
        if isinstance(result, _HTTPError):
            raise urllib.error.HTTPError(
                getattr(req, "full_url", "u"), result.code, "err",
                result.headers, io.BytesIO(result._body))
        return result

    monkeypatch.setattr(auth.urllib.request, "urlopen", fake_urlopen)


# ── mint_app_jwt config guard ────────────────────────────────────────────────

def test_mint_requires_configuration(monkeypatch):
    # The REAL mint raises GitHubConfigError when unconfigured, BEFORE any
    # crypto import — so an unconfigured deploy never triggers a native crash.
    monkeypatch.setattr(gh_config, "app_id", lambda: "")
    monkeypatch.setattr(gh_config, "private_key", lambda: "")
    with pytest.raises(GitHubConfigError):
        _REAL_MINT()


# ── token acquisition + caching ──────────────────────────────────────────────

def test_installation_token_acquired_and_cached(monkeypatch):
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        assert req.get_method() == "POST"  # token mint is the only POST
        assert "/app/installations/555/access_tokens" in req.full_url
        return _FakeResp({"token": "ghs_secrettoken", "expires_at": "2099-01-01T00:00:00Z"})

    _install_urlopen(monkeypatch, handler)
    t1 = auth.get_installation_token("555", now=0)
    t2 = auth.get_installation_token("555", now=10)
    assert t1 == t2 == "ghs_secrettoken"
    assert calls["n"] == 1  # second call served from cache, no re-mint


def test_token_refreshes_near_expiry(monkeypatch):
    tokens = iter(["ghs_first", "ghs_second"])
    exp = {"v": "1970-01-01T01:00:00Z"}  # expires at 3600s

    def handler(req):
        return _FakeResp({"token": next(tokens), "expires_at": exp["v"]})

    _install_urlopen(monkeypatch, handler)
    # now=0 → token good (expiry 3600, skew 300 → valid until 3300)
    assert auth.get_installation_token("9", now=0) == "ghs_first"
    # now=3400 → within refresh skew of expiry → re-mint
    exp["v"] = "1970-01-01T02:00:00Z"
    assert auth.get_installation_token("9", now=3400) == "ghs_second"


def test_token_response_missing_token_is_auth_error(monkeypatch):
    _install_urlopen(monkeypatch, lambda req: _FakeResp({"expires_at": "2099-01-01T00:00:00Z"}))
    with pytest.raises(GitHubAuthError):
        auth.get_installation_token("1", now=0)


# ── error mapping (provider failure is never a false success) ────────────────

def test_401_maps_to_auth_error(monkeypatch):
    _install_urlopen(monkeypatch, lambda req: _HTTPError(401))
    with pytest.raises(GitHubAuthError):
        auth.get_installation_token("1", now=0)


def test_404_maps_to_not_found(monkeypatch):
    _install_urlopen(monkeypatch, lambda req: _HTTPError(404))
    with pytest.raises(GitHubNotFoundError):
        auth.get_installation_token("1", now=0)


def test_429_maps_to_rate_limit_with_reset(monkeypatch):
    _install_urlopen(monkeypatch, lambda req: _HTTPError(
        429, headers={"X-RateLimit-Reset": "1700000000"}))
    with pytest.raises(GitHubRateLimitError) as ei:
        auth.get_installation_token("1", now=0)
    assert ei.value.reset_at == 1700000000


def test_403_rate_limited_body_maps_to_rate_limit(monkeypatch):
    _install_urlopen(monkeypatch, lambda req: _HTTPError(403, body=b"API rate limit exceeded"))
    with pytest.raises(GitHubRateLimitError):
        auth.get_installation_token("1", now=0)


# ── secret redaction ─────────────────────────────────────────────────────────

def test_redact_scrubs_tokens_and_keys():
    assert "[REDACTED]" in auth.redact("token ghs_abc123def is live")
    assert "[REDACTED]" in auth.redact("here ghu_userToken value")
    assert "[REDACTED]" in auth.redact("-----BEGIN RSA PRIVATE KEY-----")
    # ordinary text is untouched
    assert auth.redact("nothing sensitive here") == "nothing sensitive here"


def test_invalidate_forces_remint(monkeypatch):
    tokens = iter(["ghs_a", "ghs_b"])
    _install_urlopen(monkeypatch, lambda req: _FakeResp(
        {"token": next(tokens), "expires_at": "2099-01-01T00:00:00Z"}))
    assert auth.get_installation_token("7", now=0) == "ghs_a"
    auth.invalidate_installation_token("7")
    assert auth.get_installation_token("7", now=0) == "ghs_b"
