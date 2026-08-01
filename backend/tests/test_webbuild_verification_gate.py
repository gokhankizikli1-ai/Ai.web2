# coding: utf-8
"""
Tests — the emergency verified-identity gate that protects the REAL Web Build
execution path (POST /chat protected ops) and related fixes.

Covers the authoritative, NON-raising gate used in-handler (verified_identity_status
/ is_request_verified), the raising dependency form, and the fail-CLOSED frontend
annotation + owner bypass.
"""
from __future__ import annotations

import pytest

from backend.core.config import settings
from backend.core import deps


class _FakePrincipal:
    def __init__(self, *, authenticated, owner=False, uid="u1"):
        self._auth = authenticated
        self._owner = owner
        self.user_id = uid
        self.email = "z@example.com"

    @property
    def is_authenticated(self):
        return self._auth

    @property
    def is_owner(self):
        return self._owner


def _patch(monkeypatch, principal, *, enforced=True, verified=False, verify_raises=False):
    import backend.core.principal as pr
    monkeypatch.setattr(pr, "resolve_principal", lambda request: principal)
    monkeypatch.setattr(settings, "ENABLE_EMAIL_VERIFICATION", enforced, raising=False)
    import backend.services.auth.verification as ver

    def _isv(uid):
        if verify_raises:
            raise RuntimeError("db down")
        return verified
    monkeypatch.setattr(ver, "is_verified", _isv)


# ── verified_identity_status ───────────────────────────────────────────────────

def test_passthrough_when_disabled(monkeypatch):
    _patch(monkeypatch, _FakePrincipal(authenticated=False), enforced=False)
    assert deps.verified_identity_status(object()) == deps.VERIFY_ALLOWED
    assert deps.is_request_verified(object()) is True     # guest allowed when off


def test_owner_bypass(monkeypatch):
    _patch(monkeypatch, _FakePrincipal(authenticated=True, owner=True), enforced=True, verified=False)
    assert deps.verified_identity_status(object()) == deps.VERIFY_ALLOWED
    assert deps.is_request_verified(object()) is True


def test_guest_blocked(monkeypatch):
    _patch(monkeypatch, _FakePrincipal(authenticated=False), enforced=True)
    assert deps.verified_identity_status(object()) == deps.VERIFY_UNAUTHENTICATED
    assert deps.is_request_verified(object()) is False


def test_authenticated_unverified_blocked(monkeypatch):
    _patch(monkeypatch, _FakePrincipal(authenticated=True, uid="u_x"), enforced=True, verified=False)
    assert deps.verified_identity_status(object()) == deps.VERIFY_UNVERIFIED
    assert deps.is_request_verified(object()) is False


def test_verified_allowed(monkeypatch):
    _patch(monkeypatch, _FakePrincipal(authenticated=True, uid="u_y"), enforced=True, verified=True)
    assert deps.is_request_verified(object()) is True


def test_fail_closed_when_verification_unreadable(monkeypatch):
    # is_verified raising must DENY, never open the gate.
    _patch(monkeypatch, _FakePrincipal(authenticated=True), enforced=True, verify_raises=True)
    assert deps.verified_identity_status(object()) == deps.VERIFY_UNVERIFIED
    assert deps.is_request_verified(object()) is False


def test_is_request_verified_never_raises(monkeypatch):
    # Even if resolve_principal itself explodes, the gate returns False (secure).
    import backend.core.principal as pr
    monkeypatch.setattr(settings, "ENABLE_EMAIL_VERIFICATION", True, raising=False)
    monkeypatch.setattr(pr, "resolve_principal", lambda request: (_ for _ in ()).throw(RuntimeError("boom")))
    assert deps.is_request_verified(object()) is False


# ── raising dependency form ─────────────────────────────────────────────────────

def test_dependency_raises_typed_403_for_unverified(monkeypatch):
    _patch(monkeypatch, _FakePrincipal(authenticated=True, uid="u_z"), enforced=True, verified=False)
    with pytest.raises(deps.VerificationRequiredError) as ei:
        deps.require_verified_identity(object())
    assert ei.value.code == "EMAIL_VERIFICATION_REQUIRED"
    assert ei.value.status_code == 403


def test_dependency_raises_401_for_guest(monkeypatch):
    from backend.services.auth.errors import MissingTokenError
    _patch(monkeypatch, _FakePrincipal(authenticated=False), enforced=True)
    with pytest.raises(MissingTokenError):
        deps.require_verified_identity(object())


# ── fail-CLOSED verification annotation + owner bypass (frontend contract) ──────

def test_annotate_verification_fails_closed(monkeypatch):
    from backend.routes import auth as auth_routes
    monkeypatch.setattr(settings, "ENABLE_EMAIL_VERIFICATION", True, raising=False)
    import backend.services.auth.verification as ver
    monkeypatch.setattr(ver, "is_verified", lambda uid: (_ for _ in ()).throw(RuntimeError("db down")))
    out = auth_routes._annotate_verification({"id": "u1", "is_owner": False})
    # Unknown status while enforced ⇒ treated as unverified (block), never usable.
    assert out["email_verified"] is False
    assert out["verification_required"] is True


def test_annotate_verification_owner_bypass(monkeypatch):
    from backend.routes import auth as auth_routes
    monkeypatch.setattr(settings, "ENABLE_EMAIL_VERIFICATION", True, raising=False)
    out = auth_routes._annotate_verification({"id": "owner1", "is_owner": True})
    assert out["email_verified"] is True
    assert out["verification_required"] is False


def test_annotate_verification_unverified_password_user(monkeypatch):
    from backend.routes import auth as auth_routes
    monkeypatch.setattr(settings, "ENABLE_EMAIL_VERIFICATION", True, raising=False)
    import backend.services.auth.verification as ver
    monkeypatch.setattr(ver, "is_verified", lambda uid: False)
    out = auth_routes._annotate_verification({"id": "p1", "is_owner": False})
    assert out["verification_required"] is True


# ── INTEGRATION: the REAL POST /chat Web Build path rejects unverified callers ──

def _chat_client():
    from fastapi import FastAPI
    from starlette.testclient import TestClient
    from backend.routes.chat import router
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _force_protected(monkeypatch):
    """Make the /chat handler treat this request as a protected (paid) op — the
    exact branch that reaches ai_guard.preflight + process_chat and now the
    verified-identity gate."""
    import backend.services.ai_guard.service as guard
    monkeypatch.setattr(guard, "classify", lambda *a, **k: "web_build_generation", raising=False)
    monkeypatch.setattr(guard, "is_protected", lambda op: True, raising=False)


def test_chat_protected_build_blocks_unverified_before_any_work(monkeypatch):
    """A guest (unverified) hitting the protected Web Build path on the LIVE /chat
    route is rejected 403 EMAIL_VERIFICATION_REQUIRED before ai_guard.preflight /
    process_chat run — proving no provider/job spend is created."""
    monkeypatch.setattr(settings, "ENABLE_EMAIL_VERIFICATION", True, raising=False)
    monkeypatch.setattr(deps, "is_request_verified", lambda request: False)
    _force_protected(monkeypatch)
    # Fail LOUD if the request ever reaches model dispatch or preflight (must not).
    import backend.routes.chat as chat_mod
    import backend.services.ai_guard.service as guard

    def _boom(*a, **k):
        raise AssertionError("dispatch reached — spend would have occurred!")
    monkeypatch.setattr(chat_mod, "process_chat", _boom, raising=False)
    monkeypatch.setattr(guard, "preflight", _boom, raising=False)

    r = _chat_client().post("/chat", json={
        "user_id": "guest-xyz",
        "message": "bana bir yapay zeka sitesi yap",
        "mode": "fast",
        "platform": "web",
    })
    assert r.status_code == 403
    body = r.json()
    assert body.get("code") == "EMAIL_VERIFICATION_REQUIRED"
    assert "reply" in body           # frontend never crashes on the rejection


def test_chat_protected_build_passes_verification_gate_when_allowed(monkeypatch):
    """When the gate passes, the handler proceeds PAST verification to preflight —
    proving the gate is the only thing blocking, and it opens for a verified/owner
    caller. We stop at preflight so no real provider work runs in the test."""
    monkeypatch.setattr(settings, "ENABLE_EMAIL_VERIFICATION", True, raising=False)
    monkeypatch.setattr(deps, "is_request_verified", lambda request: True)
    _force_protected(monkeypatch)
    import backend.services.ai_guard.service as guard

    reached = {"preflight": False}

    def _stop(*a, **k):
        reached["preflight"] = True
        raise RuntimeError("stop-after-gate")
    monkeypatch.setattr(guard, "preflight", _stop, raising=False)

    r = _chat_client().post("/chat", json={
        "user_id": "guest-xyz", "message": "build me a site",
        "mode": "fast", "platform": "web",
    })
    # The verification gate let it through (it reached preflight); response is NOT
    # a verification 403.
    assert reached["preflight"] is True
    if r.status_code == 403:
        assert r.json().get("code") != "EMAIL_VERIFICATION_REQUIRED"
