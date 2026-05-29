# coding: utf-8
"""Phase 7 closure — shadow-job at the TOOL boundary (hard proof).

PR #158 instrumented build_web_search_context_block. PR #159
discovered an additional bypass path: tool_orchestrator.
run_tools_for_mode() calls web_research_tool.safe_run() directly,
skipping the intent helper entirely. The chat can reach research
via that path AND via OpenAI function-calling — both invisible to
the build_web_search_context_block hook.

The fix: put the shadow-job record INSIDE web_research_tool.run()
so every successful invocation creates a row, regardless of caller.

These tests are the hard-proof regression the user requested:
  1. WebResearchTool.run() called directly → jobs_store has a row
  2. tool_orchestrator.run_tools_for_mode("research") → jobs_store
     has a row (THE production bypass path)
  3. SHADOW_VERIFY log fires with the immediate re-read count
  4. Both writer-side and reader-side log the same JOBS_DB_PATH
"""
from __future__ import annotations

import asyncio
import os
from typing import Optional

import pytest

from backend.services.jobs import store as jobs_store
from backend.services.jobs.types import STATUS_SUCCEEDED


@pytest.fixture()
def tmp_jobs_db(tmp_path, monkeypatch):
    db = tmp_path / "jobs.db"
    monkeypatch.setenv("JOBS_DB_PATH", str(db))
    monkeypatch.setenv("ENABLE_JOB_QUEUE", "true")
    jobs_store._reset_for_tests()
    jobs_store.init()
    yield db


def _stub_research_client(monkeypatch, *, citations=None, answer="ans"):
    """Stub the research client so the tool resolves without network.

    The tool does `from backend.services.research import client,
    active_provider`. Both are package-level re-exports. We patch the
    ResearchClient.search class method (so any instance picks up the
    fake) AND override active_provider in BOTH the module namespace
    AND the package namespace so the tool's import sees the stub.
    """
    import sys
    import backend.services.research               # noqa: F401
    import backend.services.research.client        # noqa: F401
    _research_module = sys.modules["backend.services.research.client"]
    _research_pkg    = sys.modules["backend.services.research"]
    from backend.services.research.types import SearchResult, Citation

    async def _fake_search(self, query, **_kw):
        cits = [
            Citation(title="t", url="https://example.com/x",
                     snippet="s", source_type="news",
                     trust_score=0.6, domain="example.com",
                     provider="stub")
            for _ in (citations or [None])
        ]
        return SearchResult(
            query=query, answer=answer,
            citations=cits, provider="stub", elapsed_ms=5,
        )
    monkeypatch.setattr(
        _research_module.ResearchClient, "search", _fake_search,
    )
    # Patch BOTH namespaces — the tool's `from research import
    # active_provider` binds the function at import time from the
    # package namespace, so we have to flip both.
    monkeypatch.setattr(_research_module, "active_provider", lambda: "stub")
    monkeypatch.setattr(_research_pkg,    "active_provider", lambda: "stub")


# ── 1. WebResearchTool.run() persists a row ────────────────────────────────

class TestWebResearchToolPersistsRow:
    """The TOOL boundary is the chokepoint every research caller
    eventually reaches. Whether the LLM function-calls it, the
    orchestrator runs it for a mode, or the intent helper invokes
    it — the row MUST appear in jobs_store."""

    def test_direct_tool_run_writes_shadow_row(self, monkeypatch, tmp_jobs_db):
        _stub_research_client(monkeypatch)

        from backend.services.tools.web_research_tool import WebResearchTool
        tool = WebResearchTool()

        env = asyncio.run(tool.run("research test query", {
            "user_id":    "user-tool",
            "caller":     "chat_tool",
            "max_results": 5,
        }))

        assert env["status"] == "available"

        # jobs_store has the shadow row
        rows = jobs_store.list_all(limit=100)
        research_rows = [r for r in rows if r.kind == "research.deep"]
        assert len(research_rows) == 1, (
            f"Tool run must produce exactly 1 row. Got: {rows}"
        )
        row = research_rows[0]
        assert row.status == STATUS_SUCCEEDED
        assert row.user_id == "user-tool"
        assert row.metadata.get("caller") == "chat_tool"
        assert row.metadata.get("shadow") is True


# ── 2. Production bypass — run_tools_for_mode("research") ──────────────────

class TestOrchestratorPathPersistsRow:
    """THIS is the path PR #158 missed: tool_orchestrator calls
    tool.safe_run() directly, skipping build_web_search_context_block
    entirely. Now that the shadow-job lives in the tool itself, this
    path must persist a row too."""

    def test_run_tools_for_mode_research_writes_shadow_row(
        self, monkeypatch, tmp_jobs_db,
    ):
        _stub_research_client(monkeypatch)
        monkeypatch.setenv("ENABLE_TOOLS", "true")
        monkeypatch.setenv("ENABLE_WEB_RESEARCH", "true")

        # Make sure web_research is registered in the test tool registry
        from backend.services.tools import tool_registry
        from backend.services.tools.web_research_tool import WebResearchTool
        tool_registry.register(WebResearchTool())

        from backend.services.tools.tool_orchestrator import run_tools_for_mode

        results = asyncio.run(run_tools_for_mode(
            "research", "what is the moon",
            context={"user_id": "user-via-mode"},
        ))

        assert "web_research" in results
        assert results["web_research"]["status"] == "available"

        # The orchestrator's bypass path now records a job
        rows = jobs_store.list_all(limit=100)
        research_rows = [r for r in rows if r.kind == "research.deep"]
        assert len(research_rows) >= 1, (
            "tool_orchestrator path must persist a job. "
            f"jobs_store rows: {[(r.kind, r.metadata) for r in rows]}"
        )


# ── 3. Hard runtime proof — SHADOW_VERIFY log fires ────────────────────────

class TestShadowVerifyLog:
    """The user requested explicit verification logs that prove the
    insert is durable WITHIN the same DB session. If SHADOW_VERIFY
    shows the row but /v2/jobs/all returns 0, the operator knows
    the writer and reader are on different DBs."""

    def test_shadow_verify_log_emits_after_insert(
        self, monkeypatch, tmp_jobs_db, caplog,
    ):
        _stub_research_client(monkeypatch)
        from backend.services.tools.web_research_tool import WebResearchTool

        with caplog.at_level("INFO"):
            asyncio.run(WebResearchTool().run("verify-test", {
                "user_id": "u-verify",
                "caller":  "chat_tool",
            }))

        joined = "\n".join(rec.message for rec in caplog.records)
        # Three tagged log lines must fire in order
        assert "[JOB][SHADOW]" in joined
        assert "before-insert" in joined
        assert "after-insert" in joined
        assert "[JOB][SHADOW_VERIFY]" in joined
        assert "found=True" in joined
        assert "db_path=" in joined


# ── 4. Writer and reader log the same DB path ──────────────────────────────

class TestWriterReaderSameDbPath:
    """Both [JOB][SHADOW_VERIFY] (writer) and [JOB][JOBS_API] (reader)
    log the JOBS_DB_PATH env var. If the values differ in production
    logs, the writer and reader are not seeing the same SQLite file —
    multi-container or ephemeral-disk gotcha."""

    def test_both_paths_log_same_jobs_db_path(
        self, monkeypatch, tmp_jobs_db,
    ):
        import logging
        from fastapi.testclient import TestClient
        from backend.api import app

        _stub_research_client(monkeypatch)
        monkeypatch.setenv("ENABLE_ADMIN_MODE", "true")
        monkeypatch.setenv("OWNER_TOKEN", "owner-secret-token-1234567890")
        import backend.services.admin.owner as _owner
        monkeypatch.setattr(_owner, "is_owner", lambda u: True)

        # Capture via an explicit handler so we don't depend on caplog's
        # logger-propagation rules. The v2_jobs route's logger doesn't
        # always propagate to the test's root logger; attaching here
        # is the reliable path.
        captured: list[str] = []
        class _Capture(logging.Handler):
            def emit(self, record):
                captured.append(record.getMessage())
        h = _Capture()
        h.setLevel(logging.INFO)
        # Attach at root so child loggers' messages bubble up.
        root = logging.getLogger()
        root.addHandler(h)
        root.setLevel(logging.INFO)
        try:
            # 1. Writer path — tool run produces SHADOW_VERIFY log
            from backend.services.tools.web_research_tool import WebResearchTool
            asyncio.run(WebResearchTool().run("path-test", {
                "user_id": "u-path",
                "caller":  "chat_tool",
            }))
            # 2. Reader path — /v2/jobs/all produces JOBS_API log
            TestClient(app, raise_server_exceptions=False).get(
                "/v2/jobs/all",
                headers={"X-Korvix-Owner-Token": "owner-secret-token-1234567890"},
            )
        finally:
            root.removeHandler(h)

        joined = "\n".join(captured)

        # Both writer and reader log a db_path field
        assert "[JOB][SHADOW_VERIFY]" in joined
        assert "[JOB][JOBS_API]" in joined

        # Extract the actual db_path values to confirm parity
        import re
        writer = re.search(r"\[JOB\]\[SHADOW_VERIFY\][^\n]*db_path=([^\s]+)", joined)
        reader = re.search(r"\[JOB\]\[JOBS_API\][^\n]*db_path=([^\s]+)", joined)
        assert writer and reader
        assert writer.group(1) == reader.group(1), (
            f"Writer db_path={writer.group(1)} != reader db_path={reader.group(1)}. "
            f"Production logs showing this divergence mean the chat path and the "
            f"AdminPanel path are reading different SQLite files."
        )
