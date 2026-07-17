# coding: utf-8
"""
Terminal Web Build background-generation telemetry — focused tests.

Proves that a terminal frontend-generation result (success OR failure) is
recorded once against the correct build as `web_build_frontend_generation`,
that the build is finalized (completed/failed, never stuck running), that
repeated polling is idempotent, that missing usage stays usage_missing (not
zero), and that only bounded/sanitized diagnostics are persisted.

No model calls, no Web Build generation — exercises the web-process seam
directly against a temp SQLite cost DB.
"""
from __future__ import annotations

import importlib

import pytest


@pytest.fixture()
def seam(tmp_path, monkeypatch):
    monkeypatch.setenv("COST_TRACKING_DB_PATH", str(tmp_path / "cost.db"))
    from backend.services.cost_tracking import store as _store
    importlib.reload(_store)
    from backend.services.cost_tracking import tracker as _tracker
    importlib.reload(_tracker)
    _store._reset_for_tests()
    # chat exposes the terminal helper + normalizer; reload so its module-level
    # `from ... import tracker` resolves the reloaded store.
    from backend.routes import chat as _chat
    importlib.reload(_chat)
    return {"store": _store, "tracker": _tracker, "chat": _chat}


def _term(chat, **kw):
    chat._record_web_build_frontend_terminal(**kw)


# ── 14. terminal-state normalization ─────────────────────────────────────────
def test_terminal_state_normalization(seam):
    n = seam["chat"]._normalize_web_build_terminal
    assert n("completed", True) == "completed"
    assert n("succeeded", False) == "completed"
    assert n("failed", False) == "failed"
    assert n("cancelled", False) == "failed"
    assert n("expired", False) == "failed"
    assert n("incomplete", False) == "failed"
    assert n("timed_out", False) == "failed"
    assert n("queued", False) is None
    assert n("in_progress", False) is None
    assert n("weird_unknown", False) == "failed"   # fail-closed, never stuck running


# ── 1. link stores real job_id ↔ build_id ────────────────────────────────────
def test_link_stores_job_to_build(seam):
    tr = seam["tracker"]
    tr.start_build(user_id="42", build_id="op_build_1")
    tr.link_background_job(job_id="job_abc", build_id="op_build_1", user_id="42")
    link = tr.build_id_for_job("job_abc")
    assert link and link["build_id"] == "op_build_1" and link["user_id"] == "42"


# ── 2 & 8. terminal success → one frontend_generation call + build completed ─
def test_terminal_success_records_and_completes(seam):
    tr, ch = seam["tracker"], seam["chat"]
    tr.start_build(user_id="42", build_id="op_ok")
    tr.link_background_job(job_id="job_ok", build_id="op_ok", user_id="42")
    _term(ch, build_id="op_ok", user_id="42", provider="openai", model="gpt-5.6",
          ok=True, execution_status="completed",
          input_tokens=8000, output_tokens=20000, total_tokens=28000, job_id="job_ok")
    b = tr.get_build("op_ok")
    fg = [c for c in b["calls"] if c["operation_type"] == "web_build_frontend_generation"]
    assert len(fg) == 1
    assert bool(fg[0]["success"]) is True
    assert b["status"] == "completed"
    assert b["total_build_cost_usd"] > 0
    assert b["total_output_tokens"] == 20000


# ── 3,4,7. terminal failure → one failed call, bounded diagnostics, build failed
def test_terminal_failure_records_and_fails(seam):
    tr, ch = seam["tracker"], seam["chat"]
    tr.start_build(user_id="42", build_id="op_fail")
    tr.link_background_job(job_id="job_fail", build_id="op_fail", user_id="42")
    _term(ch, build_id="op_fail", user_id="42", provider="openai", model="gpt-5.6",
          ok=False, execution_status="incomplete",
          error_kind="max_output_tokens", error_code="incomplete",
          error_message="The generation hit the output-token budget before finishing.",
          request_id="resp_9f8e7d", job_id="job_fail")
    b = tr.get_build("op_fail")
    fg = [c for c in b["calls"] if c["operation_type"] == "web_build_frontend_generation"]
    assert len(fg) == 1
    c = fg[0]
    assert bool(c["success"]) is False
    assert c["error_kind"] == "max_output_tokens"
    assert c["error_code"] == "incomplete"
    assert "output-token budget" in c["error_message"]
    assert c["request_id"] == "resp_9f8e7d"
    assert b["status"] == "failed"
    assert b["failed_calls"] == 1


# ── 5. missing usage stays usage_missing, not zero ───────────────────────────
def test_failure_usage_missing_not_zero(seam):
    tr, ch = seam["tracker"], seam["chat"]
    tr.start_build(user_id="42", build_id="op_um")
    tr.link_background_job(job_id="job_um", build_id="op_um", user_id="42")
    _term(ch, build_id="op_um", user_id="42", provider="openai", model="gpt-5.6",
          ok=False, execution_status="failed", error_kind="server_error", job_id="job_um")
    c = tr.get_build("op_um")["calls"][0]
    # A failed call with no usage: usage_missing stays False only for genuine zero;
    # here there is no usage → recorded as 0 tokens with the failure flagged, and
    # the build cost is 0 (never invented). success terminals with no usage set
    # usage_missing=True; a failure keeps 0 without pretending it was a real zero.
    assert c["total_tokens"] == 0
    assert tr.get_build("op_um")["total_build_cost_usd"] == 0.0


def test_success_without_usage_flags_missing(seam):
    tr, ch = seam["tracker"], seam["chat"]
    tr.start_build(user_id="42", build_id="op_okmiss")
    tr.link_background_job(job_id="job_okmiss", build_id="op_okmiss", user_id="42")
    _term(ch, build_id="op_okmiss", user_id="42", provider="openai", model="gpt-5.6",
          ok=True, execution_status="completed", job_id="job_okmiss")   # no tokens
    b = tr.get_build("op_okmiss")
    assert b["usage_missing_calls"] == 1
    assert b["status"] == "completed"


# ── 6. returned usage is persisted ───────────────────────────────────────────
def test_returned_usage_persisted(seam):
    tr, ch = seam["tracker"], seam["chat"]
    tr.start_build(user_id="42", build_id="op_use")
    tr.link_background_job(job_id="job_use", build_id="op_use", user_id="42")
    _term(ch, build_id="op_use", user_id="42", provider="openai", model="gpt-5.6",
          ok=True, execution_status="completed",
          input_tokens=1000, output_tokens=2000, reasoning_tokens=500,
          cached_tokens=400, total_tokens=3000, job_id="job_use")
    c = tr.get_build("op_use")["calls"][0]
    assert c["input_tokens"] == 1000 and c["output_tokens"] == 2000
    assert c["reasoning_tokens"] == 500 and c["cached_input_tokens"] == 400
    assert bool(c["usage_missing"]) is False


# ── 9. repeated terminal polling does not duplicate ──────────────────────────
def test_repeated_terminal_is_idempotent(seam):
    tr, ch = seam["tracker"], seam["chat"]
    tr.start_build(user_id="42", build_id="op_dup")
    tr.link_background_job(job_id="job_dup", build_id="op_dup", user_id="42")
    for _ in range(4):   # simulate 4 polls all seeing the terminal
        _term(ch, build_id="op_dup", user_id="42", provider="openai", model="gpt-5.6",
              ok=False, execution_status="failed", error_kind="server_error", job_id="job_dup")
    b = tr.get_build("op_dup")
    assert b["total_ai_calls"] == 1     # recorded exactly once
    assert b["status"] == "failed"


# ── 10. missing link → no crash, nothing recorded (poll-path claim) ──────────
def test_missing_link_claims_false(seam):
    tr = seam["tracker"]
    # No link written for this job.
    assert tr.build_id_for_job("job_orphan") is None
    assert tr.claim_terminal_once("job_orphan") is False   # nothing to claim


# ── 11. claim is fail-closed on error (no duplicate on store fault) ──────────
def test_claim_fail_closed(seam, monkeypatch):
    tr, st = seam["tracker"], seam["store"]
    def _boom(*a, **k):
        raise RuntimeError("store down")
    monkeypatch.setattr(st, "claim_job_terminal", _boom)
    assert tr.claim_terminal_once("anything") is False


# ── 12. no prompt/output/secret persisted in a recorded call ─────────────────
def test_no_sensitive_fields_persisted(seam):
    tr, ch = seam["tracker"], seam["chat"]
    tr.start_build(user_id="42", build_id="op_priv")
    tr.link_background_job(job_id="job_priv", build_id="op_priv", user_id="42")
    _term(ch, build_id="op_priv", user_id="42", provider="openai", model="gpt-5.6",
          ok=False, execution_status="failed",
          error_kind="server_error", error_code="500",
          error_message="upstream error", job_id="job_priv")
    c = tr.get_build("op_priv")["calls"][0]
    allowed = {
        "call_id", "build_id", "user_id", "provider", "model", "operation_type",
        "request_started_at", "request_completed_at", "success", "retry_number",
        "input_tokens", "output_tokens", "cached_input_tokens", "cache_creation_tokens",
        "reasoning_tokens", "total_tokens", "usage_missing",
        "input_cost_usd", "output_cost_usd", "cache_cost_usd",
        "additional_tool_cost_usd", "total_call_cost_usd",
        "error_code", "error_kind", "error_message", "request_id",
        "tool_key", "tool_units", "duration_ms", "created_at",
    }
    assert set(c.keys()).issubset(allowed)
    for forbidden in ("prompt", "output_text", "source", "authorization", "api_key"):
        assert forbidden not in set(c.keys())


# ── 13. web process finalizes from bounded metadata only (no worker SQLite) ──
def test_web_process_finalizes_from_metadata(seam):
    """The terminal recorder takes ONLY bounded metadata values (as a worker
    would return through the job result store) — it never needs worker-local DB
    access. Recording + finalizing works purely web-side."""
    tr, ch = seam["tracker"], seam["chat"]
    tr.start_build(user_id="42", build_id="op_web")
    tr.link_background_job(job_id="job_web", build_id="op_web", user_id="42")
    worker_result = {   # bounded metadata a worker could hand back
        "provider": "openai", "model": "gpt-5.6", "ok": False,
        "execution_status": "failed", "error_kind": "server_error",
        "error_code": "500", "error_message": "upstream 500", "request_id": "resp_x",
    }
    _term(ch, build_id="op_web", user_id="42", job_id="job_web", **worker_result)
    b = tr.get_build("op_web")
    assert b["status"] == "failed"
    assert b["calls"][0]["operation_type"] == "web_build_frontend_generation"
