# coding: utf-8
"""GitHub connector — read-only REST client: bounded pagination + truthful
error mapping. No real GitHub: `urlopen` and the installation token are faked.
"""
from __future__ import annotations

import io
import json
import urllib.error

import pytest

from backend.services.github import auth as gh_auth
from backend.services.github import client as gh_client
from backend.services.github.client import GitHubClient
from backend.services.github.errors import (
    GitHubAuthError, GitHubNotFoundError, GitHubRateLimitError,
    GitHubServerError, GitHubUnprocessableError,
)


class _Resp:
    def __init__(self, payload, headers=None):
        self._body = json.dumps(payload).encode("utf-8")
        self.headers = _Headers(headers or {})

    def read(self, *_a):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _Headers:
    def __init__(self, d):
        self._d = d

    def items(self):
        return self._d.items()

    def get(self, k, default=None):
        return self._d.get(k, default)


@pytest.fixture(autouse=True)
def _token(monkeypatch):
    # Never mint a real token.
    monkeypatch.setattr(gh_auth, "get_installation_token", lambda iid, **k: "ghs_test")


def _urlopen(monkeypatch, handler):
    def fake(req, timeout=None):
        return handler(req)
    monkeypatch.setattr(gh_client.urllib.request, "urlopen", fake)


def _raise(code, headers=None, body=b""):
    def handler(req):
        raise urllib.error.HTTPError(req.full_url, code, "err", headers or {}, io.BytesIO(body))
    return handler


# ── read-only guarantee ──────────────────────────────────────────────────────

def test_client_is_get_only():
    # The client exposes no write verb — it cannot push/merge/close/deploy.
    for verb in ("post", "put", "patch", "delete", "_post", "_put", "_patch", "_delete"):
        assert not hasattr(GitHubClient, verb), f"unexpected write helper: {verb}"


def test_every_request_uses_get(monkeypatch):
    seen = {"methods": set()}

    def handler(req):
        seen["methods"].add(req.get_method())
        return _Resp({"full_name": "o/r", "id": 1})

    _urlopen(monkeypatch, handler)
    GitHubClient("1").get_repo("o/r")
    assert seen["methods"] == {"GET"}


# ── bounded pagination ───────────────────────────────────────────────────────

def test_pagination_is_bounded(monkeypatch):
    # A server that ALWAYS advertises a next page must not loop forever.
    pages = {"n": 0}

    def handler(req):
        pages["n"] += 1
        nxt = f'<https://api.github.com/repos/o/r/pulls?page={pages["n"]+1}>; rel="next"'
        return _Resp([{"number": pages["n"]}], headers={"link": nxt})

    _urlopen(monkeypatch, handler)
    items = GitHubClient("1").paginate("/repos/o/r/pulls", max_pages=3)
    assert pages["n"] == 3           # stopped at the cap despite endless `next`
    assert len(items) == 3


def test_per_page_clamped_to_100(monkeypatch):
    captured = {"url": ""}

    def handler(req):
        captured["url"] = req.full_url
        return _Resp([], headers={})

    _urlopen(monkeypatch, handler)
    GitHubClient("1").paginate("/repos/o/r/pulls", params={"per_page": 999}, max_pages=1)
    assert "per_page=100" in captured["url"]


# ── error mapping — provider failure is never a false success ────────────────

@pytest.mark.parametrize("code,exc", [
    (404, GitHubNotFoundError),
    (422, GitHubUnprocessableError),
    (500, GitHubServerError),
    (503, GitHubServerError),
])
def test_http_errors_map_to_typed(monkeypatch, code, exc):
    _urlopen(monkeypatch, _raise(code))
    with pytest.raises(exc):
        GitHubClient("1").get_repo("o/r")


def test_403_rate_limit_maps_to_rate_limit(monkeypatch):
    _urlopen(monkeypatch, _raise(403, headers={"X-RateLimit-Remaining": "0",
                                               "X-RateLimit-Reset": "1700000000"}))
    with pytest.raises(GitHubRateLimitError) as ei:
        GitHubClient("1").get_repo("o/r")
    assert ei.value.reset_at == 1700000000


def test_403_forbidden_not_rate_limited_maps_to_auth(monkeypatch):
    _urlopen(monkeypatch, _raise(403, headers={"X-RateLimit-Remaining": "50"}, body=b"forbidden"))
    with pytest.raises(GitHubAuthError):
        GitHubClient("1").get_repo("o/r")


def test_network_error_maps_to_server_error(monkeypatch):
    def handler(req):
        raise urllib.error.URLError("connection refused")
    _urlopen(monkeypatch, handler)
    with pytest.raises(GitHubServerError):
        GitHubClient("1").get_repo("o/r")


def test_401_retries_once_then_succeeds(monkeypatch):
    calls = {"n": 0}
    invalidated = {"v": False}
    monkeypatch.setattr(gh_auth, "invalidate_installation_token",
                        lambda iid: invalidated.__setitem__("v", True))

    def handler(req):
        calls["n"] += 1
        if calls["n"] == 1:
            raise urllib.error.HTTPError(req.full_url, 401, "err", {}, io.BytesIO(b""))
        return _Resp({"full_name": "o/r", "id": 1})

    _urlopen(monkeypatch, handler)
    out = GitHubClient("1").get_repo("o/r")
    assert out["full_name"] == "o/r"
    assert calls["n"] == 2 and invalidated["v"] is True  # dropped stale token, re-minted


def test_401_twice_raises_auth_error(monkeypatch):
    monkeypatch.setattr(gh_auth, "invalidate_installation_token", lambda iid: None)
    _urlopen(monkeypatch, _raise(401))
    with pytest.raises(GitHubAuthError):
        GitHubClient("1").get_repo("o/r")
