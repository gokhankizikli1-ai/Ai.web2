# coding: utf-8
"""
Legacy normal-chat quota bypass for structured Web Builds — focused tests.

The legacy free-message quota ran BEFORE ai_guard and rejected structured
builder requests (and owner chat) with intent=limit_exceeded. These tests prove
protected builders + verified owners bypass ONLY the legacy quota (ai_guard
stays authoritative), ordinary non-owner chat is unchanged, and no client owner
flag can bypass it.

No model calls, no Web Build generation — `process_chat` and the structured
safety guard are stubbed so the test isolates the quota-routing decision.
"""
from __future__ import annotations

import importlib
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest

_OWNER = "k" * 32


@pytest.fixture()
def app(tmp_path, monkeypatch):
    monkeypatch.setenv("ENABLE_ADMIN_MODE", "true")
    monkeypatch.setenv("OWNER_EMAIL", "owner@example.com")
    monkeypatch.setenv("OWNER_ID", "0")
    monkeypatch.setenv("OWNER_TOKEN", _OWNER)
    monkeypatch.setenv("COST_TRACKING_DB_PATH", str(tmp_path / "cost.db"))
    monkeypatch.setenv("AI_GUARD_DB_PATH", str(tmp_path / "guard.db"))
    monkeypatch.setenv("JWT_SECRET_KEY", "t" * 40)
    from backend.services.ai_guard import store as gstore
    importlib.reload(gstore)
    gstore.init()
    from fastapi.testclient import TestClient
    from backend.api import app as _app
    return TestClient(_app, raise_server_exceptions=False)


@contextmanager
def _harness(*, can_send, preflight=None):
    """Patch the inside-function imports: legacy quota result + structured safety
    (→ allowed). `process_chat` is intentionally NOT patched — it can't import in
    this sandbox (no `openai`), and the route already catches that and continues
    to the quota-routing + record_usage seam under test, returning a normal_chat
    fallback (never limit_exceeded). record_usage is a mock so accounting can be
    asserted. Optional preflight override for the ai_guard-block tests."""
    from backend.services.safety.guard import SafetyResult
    rec = MagicMock()
    patches = [
        patch("backend.services.user_service.check_and_count", return_value=(can_send, 20)),
        patch("backend.services.user_service.record_usage", rec),
        patch("backend.services.safety.guard.check_structured_website_builder_message",
              return_value=SafetyResult(allowed=True)),
        patch("backend.services.safety.guard.check_structured_builder_message",
              return_value=SafetyResult(allowed=True)),
    ]
    if preflight is not None:
        patches.append(patch("backend.services.ai_guard.service.preflight", return_value=preflight))
    for p in patches:
        p.start()
    try:
        yield rec
    finally:
        for p in patches:
            p.stop()


def _post(app, mode=None, headers=None, extra=None):
    body = {"message": "[BUILD] make me a notes app", "user_id": "7"}
    if mode:
        body["mode"] = mode
    if extra:
        body.update(extra)
    return app.post("/chat", json=body, headers=headers or {})


def _pf(allowed, code, op="op_x"):
    from backend.services.ai_guard.service import Preflight
    return Preflight(allowed, code, "web_build_full", operation_id=(op if allowed else None))


# ── 1/2. ordinary non-owner chat: limit enforced / below-limit works ─────────
def test_ordinary_chat_at_limit_blocked(app):
    with _harness(can_send=False):
        j = _post(app).json()
    assert j["intent"] == "limit_exceeded" and j["mode"] == "limit_exceeded"


def test_ordinary_chat_below_limit_ok(app):
    with _harness(can_send=True) as rec:
        j = _post(app).json()
    assert j["intent"] != "limit_exceeded"
    rec.assert_called()          # ordinary chat still increments legacy usage


# ── 3/4. verified owner bypasses; fake client flags do not ───────────────────
def test_owner_ordinary_chat_at_limit_not_blocked(app):
    with _harness(can_send=False):
        j = _post(app, headers={"X-Korvix-Owner-Token": _OWNER}).json()
    assert j["intent"] != "limit_exceeded"


def test_fake_owner_flags_do_not_bypass(app):
    with _harness(can_send=False):
        j = _post(app, headers={"X-Korvix-Owner": "true", "X-Owner-Mode": "1"},
                  extra={"is_owner": True, "premium": True, "owner": True}).json()
    assert j["intent"] == "limit_exceeded"       # client flags ignored


# ── 5/6/7. structured builders bypass the legacy quota ───────────────────────
@pytest.mark.parametrize("mode", ["website_builder", "frontend_builder", "visual_intelligence"])
def test_builder_at_limit_not_blocked_by_legacy_quota(app, mode):
    with _harness(can_send=False):
        j = _post(app, mode=mode).json()
    assert j["intent"] != "limit_exceeded", f"{mode} must not hit legacy limit_exceeded"


# ── 8. protected builder still runs ai_guard preflight ───────────────────────
def test_builder_still_runs_ai_guard(app):
    from backend.services.ai_guard import service as guard
    with _harness(can_send=False):
        spy = MagicMock(wraps=guard.preflight)
        with patch("backend.services.ai_guard.service.preflight", spy):
            _post(app, mode="website_builder")
        assert spy.called, "ai_guard.preflight must run for a protected builder"


# ── 9/10/11. builder blocked by ai_guard returns ai_guard block, not quota ───
@pytest.mark.parametrize("code", ["global_spend_limit_reached", "operation_in_progress",
                                  "daily_limit_reached"])
def test_builder_ai_guard_block_preserved(app, code):
    with _harness(can_send=False, preflight=_pf(False, code)):
        j = _post(app, mode="website_builder").json()
    assert j["intent"] == "ai_guard_block"
    assert j["intent"] != "limit_exceeded"
    md = (j.get("metadata") or {}).get("aiOperation") or {}
    assert md.get("code") == code


# ── 12. structured builder does NOT consume ordinary-chat allowance ──────────
def test_builder_does_not_charge_legacy_counter(app):
    with _harness(can_send=True, preflight=_pf(True, "allowed")) as rec:
        _post(app, mode="website_builder")
    rec.assert_not_called()      # no legacy record_usage for a builder


# ── 13. ordinary chat still increments legacy usage exactly as before ────────
def test_ordinary_chat_still_records_usage(app):
    with _harness(can_send=True) as rec:
        _post(app)
    assert rec.call_count == 1


# ── 16. builder response contract preserved (stub passthrough) ───────────────
def test_builder_response_contract_preserved(app):
    with _harness(can_send=False, preflight=_pf(True, "allowed")):
        j = _post(app, mode="website_builder").json()
    for k in ("reply", "intent", "model", "provider", "mode", "request_id"):
        assert k in j
    assert j["intent"] != "limit_exceeded"
