# coding: utf-8
"""Vercel connector — read-only REST client: GET-only, team-scoped, bounded.

Proves the guarantees the connector's safety rests on:
  * there is NO write verb anywhere on the client (no deploy/rollback/env/domain
    path exists to call);
  * the connection's team scope is attached to EVERY request (without it Vercel
    would answer for the personal account and read the wrong projects);
  * pagination is hard-capped by pages AND page size, so a read can never crawl
    an account's whole deployment history;
  * provider failures map to TRUTHFUL typed errors (never an empty success), and
    a 401 wipes the dead credential while a 403 does not.

No real Vercel: `urlopen` is faked.
"""
from __future__ import annotations

import io
import json
import urllib.error
import urllib.parse

import pytest

from backend.services.gmail import crypto as credential_crypto
from backend.services.vercel import client as vc_client_mod
from backend.services.vercel import store as vc_store
from backend.services.vercel.client import VercelClient
from backend.services.vercel.errors import (
    VercelAuthError, VercelError, VercelNotFoundError, VercelRateLimitError,
    VercelServerError,
)


class _Resp:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode("utf-8")

    def read(self, *_a):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture()
def db(tmp_path, monkeypatch):
    path = str(tmp_path / "projects.db")
    monkeypatch.setenv("PROJECTS_DB_PATH", path)
    monkeypatch.setenv("VERCEL_SYNC_PAGE_SIZE", "2")
    monkeypatch.setattr(vc_store, "DB_PATH", path, raising=False)
    vc_store._reset_for_tests(); vc_store.init_vercel_tables()
    credential_crypto.set_cipher_for_tests(credential_crypto._ReversibleTestCipher())
    yield path
    credential_crypto.set_cipher_for_tests(None)


def _conn(db, *, team_id="team_9", project="prj_1"):
    vc_store.upsert_authorization(project_id="p1", owner_user_id="uA",
                                  access_token="vtok", team_id=team_id)
    if project:
        vc_store.bind_project(project_id="p1", vercel_project_id=project)
    return vc_store.get_connection("p1")


def _urlopen(monkeypatch, handler):
    monkeypatch.setattr(vc_client_mod.urllib.request, "urlopen",
                        lambda req, timeout=None: handler(req))


def _qs(url):
    return {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlparse(url).query).items()}


def _raise(code, body=b""):
    def handler(req):
        raise urllib.error.HTTPError(req.full_url, code, "err", {}, io.BytesIO(body))
    return handler


# ── read-only guarantee ──────────────────────────────────────────────────────

def test_client_exposes_no_write_verb():
    for verb in ("post", "put", "patch", "delete", "_post", "_put", "_patch",
                 "_delete", "deploy", "redeploy", "rollback", "cancel",
                 "set_env", "add_domain"):
        assert not hasattr(VercelClient, verb), f"client must not expose {verb}"


def test_every_request_is_a_get(db, monkeypatch):
    methods = []

    def handler(req):
        methods.append(req.get_method())
        return _Resp({"projects": [], "deployments": []})

    _urlopen(monkeypatch, handler)
    c = VercelClient(_conn(db))
    c.list_projects()
    c.get_project("prj_1")
    c.list_deployments("prj_1")
    assert methods and set(methods) == {"GET"}


def test_client_never_reads_env_or_logs(db, monkeypatch):
    """Only the two allowed read families are ever contacted — never
    /env (secret VALUES) and never /events (build logs)."""
    paths = []

    def handler(req):
        paths.append(urllib.parse.urlparse(req.full_url).path)
        return _Resp({"projects": [], "deployments": [], "id": "prj_1"})

    _urlopen(monkeypatch, handler)
    c = VercelClient(_conn(db))
    c.list_projects(); c.get_project("prj_1"); c.list_deployments("prj_1")
    assert all(p.startswith("/v9/projects") or p.startswith("/v6/deployments") for p in paths)
    assert not any("/env" in p or "/events" in p for p in paths)


# ── team scope ───────────────────────────────────────────────────────────────

def test_team_scope_is_attached_to_every_request(db, monkeypatch):
    seen = []

    def handler(req):
        seen.append(_qs(req.full_url))
        return _Resp({"projects": [], "deployments": []})

    _urlopen(monkeypatch, handler)
    c = VercelClient(_conn(db, team_id="team_9"))
    c.list_projects(); c.get_project("prj_1"); c.list_deployments("prj_1")
    assert all(q.get("teamId") == "team_9" for q in seen)


def test_personal_installation_sends_no_team_id(db, monkeypatch):
    seen = []

    def handler(req):
        seen.append(_qs(req.full_url))
        return _Resp({"projects": []})

    _urlopen(monkeypatch, handler)
    VercelClient(_conn(db, team_id="")).list_projects()
    assert all("teamId" not in q for q in seen)


def test_bearer_token_is_sent_and_decrypted_from_the_store(db, monkeypatch):
    seen = {}

    def handler(req):
        seen["auth"] = req.get_header("Authorization")
        return _Resp({"projects": []})

    _urlopen(monkeypatch, handler)
    VercelClient(_conn(db)).list_projects()
    assert seen["auth"] == "Bearer vtok"


# ── bounded pagination ───────────────────────────────────────────────────────

def _paged(pages):
    """A handler serving `pages` (list of (items, next_cursor)) in order."""
    calls = {"n": 0}

    def handler(req):
        idx = min(calls["n"], len(pages) - 1)
        items, nxt = pages[idx]
        calls["n"] += 1
        return _Resp({"deployments": items, "projects": items,
                      "pagination": {"count": len(items), "next": nxt}})

    return handler, calls


def test_pagination_stops_at_max_pages(db, monkeypatch):
    # Vercel always offers another cursor; the client must still stop.
    handler, calls = _paged([([{"uid": f"d{i}"} for i in range(2)], 1700000000000)])
    _urlopen(monkeypatch, handler)
    out = VercelClient(_conn(db)).list_deployments("prj_1", max_pages=2)
    assert calls["n"] == 2
    assert len(out) == 2  # both pages returned the same uids → de-duplicated


def test_pagination_follows_the_next_cursor_as_until(db, monkeypatch):
    seen = []
    pages = [([{"uid": "d1"}], 1699999999999), ([{"uid": "d2"}], None)]
    calls = {"n": 0}

    def handler(req):
        seen.append(_qs(req.full_url))
        items, nxt = pages[min(calls["n"], len(pages) - 1)]
        calls["n"] += 1
        return _Resp({"deployments": items, "pagination": {"next": nxt}})

    _urlopen(monkeypatch, handler)
    out = VercelClient(_conn(db)).list_deployments("prj_1", max_pages=5)
    assert [d["uid"] for d in out] == ["d1", "d2"]
    assert "until" not in seen[0]
    assert seen[1]["until"] == "1699999999999"
    assert seen[0]["limit"] == "2"          # VERCEL_SYNC_PAGE_SIZE
    assert seen[0]["projectId"] == "prj_1"


def test_pagination_stops_when_no_next_cursor(db, monkeypatch):
    handler, calls = _paged([([{"uid": "d1"}], None)])
    _urlopen(monkeypatch, handler)
    VercelClient(_conn(db)).list_deployments("prj_1", max_pages=5)
    assert calls["n"] == 1


def test_page_ceiling_is_hard_even_when_asked_for_more(db, monkeypatch):
    handler, calls = _paged([([{"uid": "d1"}], 123)])
    _urlopen(monkeypatch, handler)
    VercelClient(_conn(db)).list_deployments("prj_1", max_pages=999)
    assert calls["n"] == 5  # the absolute ceiling, not 999


def test_list_projects_is_capped_by_item_count(db, monkeypatch):
    monkeypatch.setenv("VERCEL_PENDING_PROJECTS_MAX", "3")
    handler, _ = _paged([([{"id": f"prj_{i}"} for i in range(10)], 123)])
    _urlopen(monkeypatch, handler)
    out = VercelClient(_conn(db)).list_projects()
    assert len(out) == 3


def test_deployments_without_a_project_id_reads_nothing(db, monkeypatch):
    called = {"n": 0}

    def handler(req):
        called["n"] += 1
        return _Resp({"deployments": []})

    _urlopen(monkeypatch, handler)
    assert VercelClient(_conn(db)).list_deployments("") == []
    assert called["n"] == 0


# ── truthful error mapping ───────────────────────────────────────────────────

def test_401_marks_the_connection_revoked_and_raises(db, monkeypatch):
    _urlopen(monkeypatch, _raise(401))
    conn = _conn(db)
    with pytest.raises(VercelAuthError):
        VercelClient(conn).list_deployments("prj_1")
    assert vc_store.get_connection("p1").is_revoked is True
    assert vc_store.get_connection("p1").access_token_enc == ""


def test_403_does_not_wipe_the_credential(db, monkeypatch):
    _urlopen(monkeypatch, _raise(403))
    conn = _conn(db)
    with pytest.raises(VercelAuthError):
        VercelClient(conn).list_deployments("prj_1")
    assert vc_store.get_connection("p1").is_revoked is False


def test_404_and_429_and_5xx_map_to_typed_errors(db, monkeypatch):
    conn = _conn(db)
    for code, exc in ((404, VercelNotFoundError), (429, VercelRateLimitError),
                      (500, VercelServerError)):
        _urlopen(monkeypatch, _raise(code))
        with pytest.raises(exc):
            VercelClient(conn).get_project("prj_1")


def test_network_failure_is_a_server_error(db, monkeypatch):
    def handler(req):
        raise urllib.error.URLError("down")

    _urlopen(monkeypatch, handler)
    with pytest.raises(VercelServerError):
        VercelClient(_conn(db)).list_projects()


def test_malformed_json_is_a_server_error_not_an_empty_success(db, monkeypatch):
    class _Bad:
        def read(self, *_a):
            return b"<html>nope"

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    _urlopen(monkeypatch, lambda req: _Bad())
    with pytest.raises(VercelServerError):
        VercelClient(_conn(db)).list_projects()


def test_revoked_connection_cannot_read(db, monkeypatch):
    conn = _conn(db)
    vc_store.mark_revoked("p1")
    with pytest.raises(VercelAuthError):
        VercelClient(vc_store.get_connection("p1")).list_projects()


def test_connection_without_token_cannot_read(db):
    vc_store.upsert_authorization(project_id="p2", owner_user_id="uA", access_token="t")
    conn = vc_store.get_connection("p2")
    stripped = type(conn)(**{**conn.__dict__, "access_token_enc": ""})
    with pytest.raises(VercelAuthError):
        VercelClient(stripped).list_projects()


def test_client_requires_a_connection():
    with pytest.raises(VercelError):
        VercelClient(None)
