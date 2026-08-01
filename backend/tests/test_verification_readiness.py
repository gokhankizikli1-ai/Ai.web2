# coding: utf-8
"""
Tests — email-verification production-readiness diagnostics + existing-account
transition + remaining costly-route guarding.

Readiness must make a misconfiguration unmistakable (enforcement on but console
provider, or missing key/from/base-url) and must never leak a secret value.
"""
from __future__ import annotations

import json

import pytest

from backend.core.config import settings
from backend.services.auth import verification_readiness as vr
from backend.services.auth import verification as ver
from backend.services.billing.credits import service as credits
from backend.services.billing.credits import store as credits_store


def _configure(monkeypatch, **kw):
    defaults = dict(
        ENABLE_EMAIL_VERIFICATION=True,
        EMAIL_PROVIDER="console",
        RESEND_API_KEY="",
        EMAIL_FROM="",
        EMAIL_VERIFICATION_BASE_URL="",
        PUBLIC_APP_URL="https://korvixai.com",
        ENVIRONMENT="production",
    )
    defaults.update(kw)
    for k, v in defaults.items():
        monkeypatch.setattr(settings, k, v, raising=False)


# ── Readiness ─────────────────────────────────────────────────────────────────

def test_console_while_enforced_is_not_production_ready(monkeypatch):
    _configure(monkeypatch, EMAIL_PROVIDER="console")
    r = vr.evaluate()
    assert r["emailVerificationEnabled"] is True
    assert r["productionReady"] is False
    assert r["usingConsoleWhileEnforced"] is True
    assert r["status"] == "misconfigured"
    assert r["providerConfigured"] is False


def test_resend_missing_key_and_from_is_not_ready(monkeypatch):
    _configure(monkeypatch, EMAIL_PROVIDER="resend", RESEND_API_KEY="", EMAIL_FROM="")
    r = vr.evaluate()
    assert r["productionReady"] is False
    assert "RESEND_API_KEY" in " ".join(r["missing"])
    assert "EMAIL_FROM" in " ".join(r["missing"])


def test_resend_http_base_url_not_ready_in_production(monkeypatch):
    _configure(
        monkeypatch, EMAIL_PROVIDER="resend",
        RESEND_API_KEY="rk_live_xxx", EMAIL_FROM="KorvixAI <noreply@korvixai.com>",
        EMAIL_VERIFICATION_BASE_URL="http://korvixai.com",   # not https
    )
    r = vr.evaluate()
    assert r["baseUrlConfigured"] is False
    assert r["productionReady"] is False


def test_fully_configured_resend_is_ready(monkeypatch):
    _configure(
        monkeypatch, EMAIL_PROVIDER="resend",
        RESEND_API_KEY="rk_live_xxx", EMAIL_FROM="KorvixAI <noreply@korvixai.com>",
        EMAIL_VERIFICATION_BASE_URL="https://korvixai.com",
    )
    r = vr.evaluate()
    assert r["providerConfigured"] is True
    assert r["baseUrlConfigured"] is True
    assert r["productionReady"] is True
    assert r["status"] == "ready"
    assert r["missing"] == []


def test_dormant_when_disabled(monkeypatch):
    _configure(monkeypatch, ENABLE_EMAIL_VERIFICATION=False)
    r = vr.evaluate()
    assert r["status"] == "dormant"
    assert r["productionReady"] is False


def test_readiness_contains_no_secret_value(monkeypatch):
    secret = "rk_live_SUPERSECRET_9f83b21c"
    _configure(
        monkeypatch, EMAIL_PROVIDER="resend",
        RESEND_API_KEY=secret, EMAIL_FROM="ops@korvixai.com",
        EMAIL_VERIFICATION_BASE_URL="https://korvixai.com",
    )
    blob = json.dumps(vr.evaluate())
    assert secret not in blob                # the API key value never appears
    assert "ops@korvixai.com" not in blob    # the full from-address never appears
    assert r_ok_shape(vr.evaluate())


def r_ok_shape(r: dict) -> bool:
    # Every spec-required field present.
    required = {
        "emailVerificationEnabled", "providerConfigured", "providerName",
        "fromAddressConfigured", "baseUrlConfigured", "productionReady",
        "verificationRouteRegistered", "guardedRouteCount",
        "uncoveredCostlyRoutes", "rateLimitMode",
    }
    return required.issubset(r.keys())


def test_route_coverage_fields(monkeypatch):
    _configure(monkeypatch)
    r = vr.evaluate()
    assert r["verificationRouteRegistered"] is True
    assert r["guardedRouteCount"] == 10
    assert r["uncoveredCostlyRoutes"] == []          # no costly route left ungoverned
    assert r["rateLimitMode"] == "in_process"
    # The costly chat path is governed in-handler by ai_guard, reported for transparency.
    assert any("/chat" in s for s in r["costlyRoutesGatedInHandler"])


# ── Existing-account transition (recoverable verification flow) ────────────────

@pytest.fixture
def _ledger(monkeypatch, tmp_path):
    monkeypatch.setenv("ENABLE_BILLING_CREDITS", "true")
    monkeypatch.setenv("BILLING_DB_PATH", str(tmp_path / "billing.db"))
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    credits_store._reset_for_tests()
    ver._INITIALIZED = False
    ver.init()
    yield
    credits_store._reset_for_tests()
    ver._INITIALIZED = False


def test_existing_unverified_account_recoverable_flow(_ledger):
    # An existing password account with NO verification row (pre-dates the
    # system). It reads unverified and has no destination on file...
    uid = "legacy_1"
    assert ver.is_verified(uid) is False
    assert ver.get_status(uid)["email"] is None
    assert credits.get_balance(uid) == 0                 # no grant before verify

    # ...the login transition records a pending row (idempotent, no verify/grant).
    ver.record_pending(uid, "legacy@example.com")
    assert ver.get_status(uid)["email"] == "legacy@example.com"
    assert ver.is_verified(uid) is False
    assert credits.get_balance(uid) == 0

    # Now the resend/verify flow is reachable and completes exactly once.
    raw = ver.issue_token(uid, "legacy@example.com")
    assert ver.consume_token(raw).status == "verified"
    assert ver.is_verified(uid) is True
    assert credits.get_balance(uid) == 20               # granted once, only after verify


def test_record_pending_never_downgrades_verified(_ledger):
    uid = "legacy_2"
    ver.mark_verified(uid, "v@example.com", source="oauth_google")
    assert ver.is_verified(uid) is True
    ver.record_pending(uid, "v@example.com")            # login transition, later
    assert ver.is_verified(uid) is True                 # still verified


# ── Owner-only readiness route ────────────────────────────────────────────────

def _admin_client():
    from fastapi import FastAPI
    from starlette.testclient import TestClient
    from backend.core.errors import install_api_error_handlers
    from backend.routes.v2_admin_email import router
    app = FastAPI()
    app.include_router(router)
    install_api_error_handlers(app)
    return TestClient(app)


def test_readiness_route_requires_owner(monkeypatch):
    # Guest (no token, not owner) → 401.
    r = _admin_client().get("/v2/admin/email-verification/readiness")
    assert r.status_code == 401


def test_readiness_route_owner_gets_redacted_report(monkeypatch):
    import backend.services.admin.owner as owner_mod
    monkeypatch.setattr(owner_mod, "is_owner_request", lambda *a, **k: True)
    _configure(monkeypatch, EMAIL_PROVIDER="resend",
               RESEND_API_KEY="rk_live_zzz", EMAIL_FROM="ops@korvixai.com",
               EMAIL_VERIFICATION_BASE_URL="https://korvixai.com")
    r = _admin_client().get("/v2/admin/email-verification/readiness")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert body["data"]["productionReady"] is True
    assert "rk_live_zzz" not in r.text          # no secret in the response
    assert r.headers.get("Cache-Control", "").startswith("no-store")


# ── Remaining costly routes carry the guard ───────────────────────────────────

def _has_guard(route) -> bool:
    from backend.core.deps import require_verified_identity
    for dep in getattr(route, "dependencies", []) or []:
        if getattr(dep, "dependency", None) is require_verified_identity:
            return True
    return False


def test_costly_stream_and_orchestrate_are_guarded():
    from backend.routes.v2_chat_stream import router as stream_router
    from backend.routes.v2_intelligence_orchestrate import router as orch_router
    stream = [r for r in stream_router.routes if getattr(r, "path", "") == "/v2/chat/stream"]
    orch = [r for r in orch_router.routes if getattr(r, "path", "") == "/v2/intelligence/orchestrate"]
    assert stream and _has_guard(stream[0])
    assert orch and _has_guard(orch[0])


def test_free_rule_based_routes_not_guarded():
    # Intentionally-free, low-cost routes must NOT carry the verified-identity
    # guard (they trigger no LLM/provider spend).
    from backend.routes.v2_coordinator import router as coord_router
    for r in coord_router.routes:
        if getattr(r, "path", "") in ("/v2/coordinator/plan", "/v2/coordinator/classify"):
            assert not _has_guard(r)
