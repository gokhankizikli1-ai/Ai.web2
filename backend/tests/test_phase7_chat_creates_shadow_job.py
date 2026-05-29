# coding: utf-8
"""Phase 7 closure — Jobs panel must show research rows after a chat
research request (hard regression).

This locks in: when build_web_search_context_block runs (the chat
intent path), a row of kind=research.deep MUST land in jobs_store
regardless of the WEB_RESEARCH_VIA_CELERY routing flag. The Jobs
panel is the user's audit trail for research activity and must
reflect every call.

Two paths must both populate jobs_store:
  1. Celery path (WEB_RESEARCH_VIA_CELERY=true + queue + handler flag
     all on) → real job created by jobs_client.create + executed
  2. Inline path (any of the flags off, OR Celery fell back) → shadow
     job recorded post-hoc with status=succeeded and the result
     already attached.

Both paths surface through /v2/jobs/all to owner sessions.
"""
from __future__ import annotations

import asyncio
import os
from typing import Optional

import pytest

from backend.services.jobs import store as jobs_store
from backend.services.jobs.types import JobRecord, STATUS_SUCCEEDED
from backend.services.tool_extraction import web_search_intent as wsi


@pytest.fixture()
def tmp_jobs_db(tmp_path, monkeypatch):
    db = tmp_path / "jobs.db"
    monkeypatch.setenv("JOBS_DB_PATH", str(db))
    monkeypatch.setenv("ENABLE_JOB_QUEUE", "true")
    jobs_store._reset_for_tests()
    jobs_store.init()
    yield db


def _stub_web_research_tool(monkeypatch, *, status="available",
                             citations=None, answer="ans",
                             provider="stub"):
    """Bypass the real web_research tool (network + tavily). Returns
    a known envelope so the inline path produces a deterministic
    block + result."""
    from backend.services.tools import tool_registry

    class _FakeTool:
        name = "web_research"
        cost_estimate = 0.0
        async def safe_run(self, query, ctx=None):
            return {
                "status": status,
                "provider": provider,
                "data": {
                    "query": query,
                    "answer": answer,
                    "citations": citations or [{
                        "title": "fake", "url": "https://example.com",
                        "snippet": "snip",
                    }],
                },
            }

    monkeypatch.setenv("ENABLE_TOOLS", "true")
    monkeypatch.setenv("ENABLE_WEB_RESEARCH", "true")
    monkeypatch.setattr(tool_registry, "get_tool", lambda _: _FakeTool())
    monkeypatch.setattr(tool_registry, "is_enabled", lambda _: True)

    # safe_run_with_timeout wraps the tool — patch it to call the fake
    # directly so the test runs synchronously.
    from backend.services.tool_extraction import _safe_run
    async def _bypass(tool, query, ctx, override_timeout=None):
        return await tool.safe_run(query, ctx)
    monkeypatch.setattr(_safe_run, "safe_run_with_timeout", _bypass)


# ── Hard regression — inline path creates a shadow job ─────────────────────

class TestInlinePathCreatesShadowJob:
    """The exact production scenario the user reported:
    WEB_RESEARCH_VIA_CELERY=false (or any of the three flags off) ->
    the chat path runs the inline tool -> no job was being created.

    After this fix, the inline path records a shadow job at the end
    so the AdminPanel sees the row.
    """

    def test_inline_path_writes_research_deep_row(
        self, monkeypatch, tmp_jobs_db,
    ):
        # Turn the routing flag OFF — force the inline path.
        monkeypatch.delenv("WEB_RESEARCH_VIA_CELERY", raising=False)

        _stub_web_research_tool(monkeypatch)

        # Run the chat-path helper that the SSE route calls
        block, payload = asyncio.run(wsi.build_web_search_context_block(
            user_id="chat-user-1",
            query="research test query",
            triggers=("test_trigger",),
            project_id=None,
            correlation_id="cid-test",
        ))

        # The chat got a real answer block (inline path worked)
        assert block is not None
        assert "KORVIX WEB SEARCH RESULTS" in block

        # AND the jobs store has the shadow row — THIS is the
        # contract that closes the bypass.
        rows = jobs_store.list_all(limit=100)
        research_rows = [r for r in rows if r.kind == "research.deep"]
        assert len(research_rows) >= 1, (
            "Inline path must record a shadow job in jobs_store. "
            f"Found rows: {[(r.kind, r.status) for r in rows]}"
        )
        row = research_rows[0]
        # Shadow jobs are status=succeeded with the result already
        # attached (no runner dispatch needed).
        assert row.status == STATUS_SUCCEEDED
        assert row.user_id == "chat-user-1"
        # Metadata flag distinguishes shadow from real Celery jobs
        assert row.metadata.get("shadow") is True
        assert row.metadata.get("caller") == "chat_inline"
        # Result carries the same shape as the research.deep handler
        assert row.result["query"] == "research test query"
        assert row.result["count"] >= 1

    def test_shadow_log_emits(self, monkeypatch, tmp_jobs_db, caplog):
        """The [JOB][SHADOW] tag must fire so the operator can grep
        Railway logs for it."""
        monkeypatch.delenv("WEB_RESEARCH_VIA_CELERY", raising=False)
        _stub_web_research_tool(monkeypatch)

        with caplog.at_level("INFO"):
            asyncio.run(wsi.build_web_search_context_block(
                user_id="u-log",
                query="q",
                triggers=("t",),
            ))

        joined = "\n".join(rec.message for rec in caplog.records)
        assert "[JOB][SHADOW]" in joined
        assert "kind=research.deep" in joined


# ── Hard regression — /v2/jobs/all returns the shadow row ─────────────────

class TestJobsAllReturnsShadowRow:
    """End-to-end: after a chat research request, the owner's
    /v2/jobs/all panel MUST show the row."""

    _OWNER_TOKEN = "owner-secret-token-1234567890"

    def _make_owner(self, monkeypatch):
        monkeypatch.setenv("ENABLE_ADMIN_MODE", "true")
        monkeypatch.setenv("OWNER_TOKEN", self._OWNER_TOKEN)
        import backend.services.admin.owner as _owner
        monkeypatch.setattr(_owner, "is_owner", lambda u: True)

    def test_full_loop_research_then_jobs_all_count_gt_zero(
        self, monkeypatch, tmp_jobs_db,
    ):
        """The user's exact ask:
            "Phase 7 is not done until count > 0 in Jobs panel."

        Simulates a research chat request → /v2/jobs/all returns
        at least 1 research.deep row.
        """
        from fastapi.testclient import TestClient
        from backend.api import app

        self._make_owner(monkeypatch)
        monkeypatch.delenv("WEB_RESEARCH_VIA_CELERY", raising=False)
        _stub_web_research_tool(monkeypatch)

        # Step 1: run the chat helper (the function v2_chat_stream
        # calls). This produces an answer AND records a shadow job.
        asyncio.run(wsi.build_web_search_context_block(
            user_id="chat-session-user-X",
            query="research the moon",
            triggers=("research",),
            correlation_id="cid-e2e",
        ))

        # Step 2: the operator opens AdminPanel → Jobs.
        client = TestClient(app, raise_server_exceptions=False)
        r = client.get(
            "/v2/jobs/all",
            headers={"X-Korvix-Owner-Token": self._OWNER_TOKEN},
        )
        assert r.status_code == 200, r.text

        body = r.json()
        rows = body.get("data", {}).get("jobs") or []

        # THE assertion the user demanded — count > 0
        assert len(rows) > 0, (
            "Phase 7 is not done until count > 0 in Jobs panel. "
            f"/v2/jobs/all returned: {body}"
        )

        # And the row must be the research.deep one
        kinds = {row["kind"] for row in rows}
        assert "research.deep" in kinds, (
            f"Expected research.deep row, got: {kinds}"
        )
