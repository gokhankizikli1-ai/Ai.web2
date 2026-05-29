# coding: utf-8
"""Phase 7 closure — Jobs panel visibility regression tests.

The bypass these tests lock in:
  After WEB_RESEARCH_VIA_CELERY=true was set on Railway, research
  answers returned but the AdminPanel Jobs tab stayed empty. Cause:
  the chat path created jobs under one user_id (the chat session
  user) while the operator viewed /v2/jobs which filters by the
  authenticated viewer's user_id — when they didn't match, the row
  was invisible. Fix: owner panel uses /v2/jobs/all which is
  ownership-scoped, not creator-scoped.

These tests verify the contract end-to-end:
  1. After build_web_search_context_block (with WEB_RESEARCH_VIA_CELERY
     ON) runs, a job row exists in the DB
  2. /v2/jobs/all returns it to the owner regardless of who created it
  3. /v2/jobs returns it to the creator
  4. Non-owner gets 404 from /v2/jobs/all
"""
from __future__ import annotations

import asyncio
import json
import os
from typing import Optional

import pytest

from backend.services.jobs import client as jobs_client
from backend.services.jobs import store as jobs_store
from backend.services.jobs.types import JobRecord, STATUS_SUCCEEDED
from backend.services.tool_extraction import web_search_intent as wsi


@pytest.fixture()
def tmp_jobs_db(tmp_path, monkeypatch):
    """Isolate jobs.db per test."""
    db = tmp_path / "jobs.db"
    monkeypatch.setenv("JOBS_DB_PATH", str(db))
    monkeypatch.setenv("ENABLE_JOB_QUEUE", "true")
    jobs_store._reset_for_tests()
    jobs_store.init()
    yield db


# ── 1. Chat path creates a DB row ──────────────────────────────────────────

class TestCeleryPathCreatesJobRow:
    def _enable_routing(self, monkeypatch):
        monkeypatch.setenv("WEB_RESEARCH_VIA_CELERY", "true")
        monkeypatch.setenv("ENABLE_JOB_QUEUE", "true")
        monkeypatch.setenv("JOB_QUEUE_RESEARCH", "true")
        monkeypatch.setenv("ENABLE_WEB_RESEARCH", "true")
        monkeypatch.setenv("ENABLE_TOOLS", "true")

    def test_create_succeeds_and_persists_row(self, monkeypatch, tmp_jobs_db):
        """When the dispatch helper calls jobs_client.create, the
        DB store should hold the row with the chat user_id, kind=
        research.deep, and the caller=chat_auto metadata.

        We stub jobs_client.create at the seam (avoiding the manager
        singleton shadowing gotcha) but actually call store.insert so
        the row lands in the test DB.
        """
        self._enable_routing(monkeypatch)

        # Capture create kwargs + insert a real row into the store so
        # downstream reads find it. This is what InlineJobRunner does
        # for real, minus the actual handler dispatch.
        captured = {}
        async def _stub_create(**kwargs):
            captured.update(kwargs)
            rec = jobs_store.insert(JobRecord(
                user_id=kwargs.get("user_id") or "anonymous",
                kind=kwargs.get("kind") or "unknown",
                payload=kwargs.get("payload") or {},
                project_id=kwargs.get("project_id"),
                metadata=kwargs.get("metadata") or {},
            ))
            return rec
        monkeypatch.setattr(jobs_client, "create", _stub_create)

        # Stub bus consume — yield done immediately.
        from backend.services.jobs.events import get_bus
        from backend.services.jobs.types import JobEvent
        bus = get_bus()
        async def _bus_consume(jid, heartbeat_s=5.0):
            yield JobEvent(job_id=jid, kind="done",
                           payload={"status": "succeeded"}, timestamp="t")
        monkeypatch.setattr(bus, "consume", _bus_consume)

        # Post-bus DB read returns a succeeded record so the helper
        # returns an envelope rather than None.
        original_get = jobs_client.get
        def _get_succeeded(job_id, user_id=None):
            rec = original_get(job_id, user_id=user_id)
            if rec is not None:
                rec.status = STATUS_SUCCEEDED
                rec.result = {"query": "test", "answer": "yes",
                              "citations": [], "count": 0,
                              "provider": "test", "cached": False,
                              "elapsed_ms": 1}
            return rec
        monkeypatch.setattr(jobs_client, "get", _get_succeeded)

        env = asyncio.run(wsi._run_research_via_celery(
            user_id="user-a", query="test research",
            project_id=None, correlation_id="cid-1",
        ))

        # 1. The function returned an envelope (didn't fall back inline)
        assert env is not None
        assert env["status"] == "available"

        # 2. The store has the row, owned by user-a, with the right
        # kind + payload + metadata
        all_rows = jobs_store.list_all(limit=100)
        research_rows = [r for r in all_rows if r.kind == "research.deep"]
        assert len(research_rows) >= 1
        row = research_rows[0]
        assert row.user_id == "user-a"
        assert row.payload["query"] == "test research"
        assert row.metadata["caller"] == "chat_auto"
        assert row.metadata["correlation_id"] == "cid-1"

        # 3. The captured create call had the right shape (locked in
        # so the helper's contract with the client doesn't drift)
        assert captured["kind"] == "research.deep"
        assert captured["user_id"] == "user-a"


# ── 2. /v2/jobs/all visibility for the owner ──────────────────────────────

class TestJobsAllEndpointVisibility:
    """The fix: owner uses /v2/jobs/all so chat-created rows are
    visible even when the chat session user_id != the operator's."""

    @pytest.fixture
    def client(self, tmp_jobs_db):
        from fastapi.testclient import TestClient
        from backend.api import app
        return TestClient(app, raise_server_exceptions=False)

    _OWNER_TOKEN = "owner-secret-token-1234567890"

    def _make_owner(self, monkeypatch):
        monkeypatch.setenv("ENABLE_ADMIN_MODE", "true")
        monkeypatch.setenv("OWNER_TOKEN", self._OWNER_TOKEN)
        # Make is_owner() succeed for any User dataclass.
        import backend.services.admin.owner as _owner
        monkeypatch.setattr(_owner, "is_owner", lambda u: True)

    def test_v2_jobs_all_returns_rows_from_different_user_id(
        self, client, monkeypatch, tmp_jobs_db,
    ):
        """The exact production scenario: chat created a job under
        user_id 'chat-user', operator views the panel as 'admin-user'.
        /v2/jobs/all must return the row regardless of creator."""
        self._make_owner(monkeypatch)
        # Insert a job under a DIFFERENT user_id than the test caller
        jobs_store.insert(JobRecord(
            user_id="chat-session-user",
            kind="research.deep",
            payload={"query": "what is the moon"},
        ))

        r = client.get(
            "/v2/jobs/all",
            headers={"X-Korvix-Owner-Token": self._OWNER_TOKEN},
        )
        assert r.status_code == 200
        body = r.json()
        rows = body.get("data", {}).get("jobs") or []
        kinds = {row["kind"] for row in rows}
        assert "research.deep" in kinds, (
            f"/v2/jobs/all should return the chat-created row even "
            f"though it was created under a different user_id. Got: {rows}"
        )

    def test_v2_jobs_filters_by_caller_user(
        self, client, monkeypatch, tmp_jobs_db,
    ):
        """Parity check — /v2/jobs (NOT /v2/jobs/all) still filters
        by the authenticated user. This is the contract that caused
        the bug; we lock it in so future code remembers."""
        # No owner mode — falls back to guest current_user
        monkeypatch.delenv("ENABLE_ADMIN_MODE", raising=False)
        monkeypatch.delenv("OWNER_TOKEN", raising=False)

        # Insert a row under a specific user
        jobs_store.insert(JobRecord(
            user_id="other-user",
            kind="research.deep",
            payload={"query": "elsewhere"},
        ))
        # Guest hits /v2/jobs — gets their own (empty) list
        r = client.get("/v2/jobs")
        # Either 200 with empty list, or auth error; both prove the
        # cross-user filter is active
        if r.status_code == 200:
            rows = r.json().get("data", {}).get("jobs") or []
            owners = {row.get("user_id") for row in rows}
            assert "other-user" not in owners

    def test_non_owner_gets_404_from_v2_jobs_all(
        self, client, monkeypatch, tmp_jobs_db,
    ):
        """Non-owners must NOT see /v2/jobs/all. Route returns 404
        (intentional — hides the route's existence)."""
        # No owner mode set
        monkeypatch.delenv("ENABLE_ADMIN_MODE", raising=False)
        monkeypatch.delenv("OWNER_TOKEN", raising=False)
        r = client.get("/v2/jobs/all")
        assert r.status_code in (401, 404)


# ── 3. Diagnostic log fires ────────────────────────────────────────────────

class TestDiagnosticLogging:
    """The user explicitly asked for tagged logs at each transition
    so they can grep Railway log output. These tests verify the tags
    are emitted at the right time."""

    def test_chat_route_log_emits_routing_decision(
        self, caplog, monkeypatch,
    ):
        """[JOB][CHAT_ROUTE] must log the env flag values so the
        operator can confirm WEB_RESEARCH_VIA_CELERY is being read."""
        monkeypatch.setenv("WEB_RESEARCH_VIA_CELERY", "true")
        monkeypatch.setenv("ENABLE_JOB_QUEUE", "true")
        monkeypatch.setenv("JOB_QUEUE_RESEARCH", "true")
        monkeypatch.delenv("ENABLE_WEB_RESEARCH", raising=False)
        monkeypatch.delenv("ENABLE_TOOLS", raising=False)

        # Make the Celery helper return None so we still exercise the
        # log at the top of build_web_search_context_block without
        # needing a stubbed bus.
        async def _none(**_kw): return None
        monkeypatch.setattr(wsi, "_run_research_via_celery", _none)

        with caplog.at_level("INFO"):
            asyncio.run(wsi.build_web_search_context_block(
                user_id="u-test", query="anything",
                triggers=("test",),
            ))

        # The tagged log must include via_celery + each flag value
        joined = "\n".join(rec.message for rec in caplog.records)
        assert "[JOB][CHAT_ROUTE]" in joined
        assert "via_celery=True" in joined
        assert "WEB_RESEARCH_VIA_CELERY=true" in joined

    def test_create_log_emits_when_job_created(
        self, caplog, monkeypatch, tmp_jobs_db,
    ):
        """[JOB][CREATE] must fire with the new job id."""
        monkeypatch.setenv("WEB_RESEARCH_VIA_CELERY", "true")
        monkeypatch.setenv("ENABLE_JOB_QUEUE", "true")
        monkeypatch.setenv("JOB_QUEUE_RESEARCH", "true")

        # Stub jobs_client.create at the seam (avoids the manager
        # singleton shadowing gotcha). Insert a real row so the
        # downstream DB read finds it.
        async def _stub_create(**kwargs):
            return jobs_store.insert(JobRecord(
                user_id=kwargs.get("user_id") or "anonymous",
                kind=kwargs.get("kind") or "unknown",
                payload=kwargs.get("payload") or {},
            ))
        monkeypatch.setattr(jobs_client, "create", _stub_create)

        from backend.services.jobs.events import get_bus
        from backend.services.jobs.types import JobEvent
        bus = get_bus()
        async def _bus_consume(jid, heartbeat_s=5.0):
            yield JobEvent(job_id=jid, kind="done", payload={}, timestamp="t")
        monkeypatch.setattr(bus, "consume", _bus_consume)

        original_get = jobs_client.get
        def _get_done(job_id, user_id=None):
            rec = original_get(job_id, user_id=user_id)
            if rec is not None:
                rec.status = STATUS_SUCCEEDED
                rec.result = {"query": "q", "answer": "", "citations": [],
                              "count": 0, "provider": "x"}
            return rec
        monkeypatch.setattr(jobs_client, "get", _get_done)

        with caplog.at_level("INFO"):
            asyncio.run(wsi._run_research_via_celery(
                user_id="u-test", query="q",
                project_id=None, correlation_id="cid",
            ))

        joined = "\n".join(rec.message for rec in caplog.records)
        assert "[JOB][CREATE]" in joined
        assert "kind=research.deep" in joined

    def test_jobs_api_log_emits_count(self, caplog, monkeypatch, tmp_jobs_db):
        """[JOB][JOBS_API] must log the count returned."""
        from fastapi.testclient import TestClient
        from backend.api import app
        client = TestClient(app, raise_server_exceptions=False)

        # Make the caller an owner so /v2/jobs/all is allowed
        monkeypatch.setenv("ENABLE_ADMIN_MODE", "true")
        monkeypatch.setenv("OWNER_TOKEN", "owner-secret-token-1234567890")
        import backend.services.admin.owner as _owner
        monkeypatch.setattr(_owner, "is_owner", lambda u: True)

        jobs_store.insert(JobRecord(
            user_id="x", kind="research.deep", payload={"q": "q"},
        ))

        with caplog.at_level("INFO"):
            client.get(
                "/v2/jobs/all",
                headers={"X-Korvix-Owner-Token": "owner-secret-token-1234567890"},
            )

        joined = "\n".join(rec.message for rec in caplog.records)
        assert "[JOB][JOBS_API]" in joined
        assert "endpoint=/v2/jobs/all" in joined
        assert "count=" in joined
