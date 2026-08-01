# coding: utf-8
"""
Tests — layered starter-credit abuse protection.

Covers the risk engine (install/network velocity, shadow vs enforce), the grant
boundary (withheld promo grant, ledger idempotency preserved, paid-user + owner
exemption), trusted-proxy IP extraction (spoofed XFF ignored), the signed
installation id (client cannot forge), and privacy (no raw IP/PII in diagnostics).
"""
from __future__ import annotations

import threading

import pytest

from backend.core.config import settings
from backend.services.auth import starter_abuse as sa
from backend.services import credits_gateway as gw
from backend.services.billing.credits import service as credits
from backend.services.billing.credits import store as credits_store


@pytest.fixture(autouse=True)
def _env(monkeypatch, tmp_path):
    monkeypatch.setenv("ENABLE_BILLING_CREDITS", "true")
    monkeypatch.setenv("BILLING_DB_PATH", str(tmp_path / "billing.db"))
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(settings, "ENABLE_STARTER_CREDIT_ABUSE_PROTECTION", True, raising=False)
    monkeypatch.setattr(settings, "STARTER_ABUSE_MAX_GRANTS_PER_INSTALL", 1, raising=False)
    monkeypatch.setattr(settings, "STARTER_ABUSE_MAX_GRANTS_PER_NETWORK_DAY", 3, raising=False)
    credits_store._reset_for_tests()
    sa._reset_for_tests()
    sa.init()
    yield
    credits_store._reset_for_tests()
    sa._reset_for_tests()


def _ctx(provider="password", ip="203.0.113.10", install=None, exempt=False):
    install = install or sa.issue_install_id()
    return gw.GrantContext(provider=provider, ip=ip, install_id=install, exempt=exempt), install


# ── Trusted-proxy IP extraction ────────────────────────────────────────────────

class _Req:
    def __init__(self, host, xff=None, cookies=None):
        self.client = type("C", (), {"host": host})()
        self._h = {"x-forwarded-for": xff} if xff else {}
        self.cookies = cookies or {}

    @property
    def headers(self):
        h = self._h
        return type("H", (), {"get": staticmethod(lambda k, d=None: h.get(k.lower(), d))})()


def test_spoofed_xff_is_ignored_by_default(monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_COUNT", 0, raising=False)
    # Client forges XFF to frame another network — must be ignored (peer used).
    req = _Req("198.51.100.5", xff="1.2.3.4, 5.6.7.8")
    assert sa.client_ip(req) == "198.51.100.5"


def test_trusted_proxy_extraction(monkeypatch):
    monkeypatch.setattr(settings, "TRUSTED_PROXY_COUNT", 1, raising=False)
    # One trusted proxy appended the real client (last hop is the proxy's view).
    req = _Req("10.0.0.1", xff="9.9.9.9, 203.0.113.77")
    assert sa.client_ip(req) == "203.0.113.77"


def test_network_hash_is_not_raw_ip():
    h = sa.network_hash("203.0.113.10")
    assert h and "203.0.113" not in h and len(h) == 32


# ── Signed installation id (client cannot forge) ───────────────────────────────

def test_install_id_signed_and_unforgeable():
    real = sa.issue_install_id()
    assert sa.verify_install_id(real) == real
    assert sa.verify_install_id("attacker-picked-id") is None     # no valid signature
    assert sa.verify_install_id(real.split(".")[0] + ".deadbeef") is None
    # Two distinct raw ids hash differently; a hash is not the raw value.
    assert sa.install_hash(real) and sa.install_hash(real) != real


# ── Risk decisions: shadow never denies, enforce withholds ─────────────────────

def test_feature_off_allows(monkeypatch):
    monkeypatch.setattr(settings, "ENABLE_STARTER_CREDIT_ABUSE_PROTECTION", False, raising=False)
    assert sa.mode() == "off"
    d = sa.evaluate("u", provider="password", ip="203.0.113.10", install_id="x")
    assert d.outcome == sa.ALLOW and d.grant_allowed is True


def test_install_velocity_denies_in_enforce(monkeypatch):
    monkeypatch.setattr(settings, "STARTER_CREDIT_ABUSE_MODE", "enforce", raising=False)
    inst = sa.issue_install_id()
    sa.record_grant("u1", provider="password", ip="203.0.113.10", install_id=inst)
    d = sa.evaluate("u2", provider="password", ip="198.51.100.9", install_id=inst)
    assert d.outcome == sa.DENY and d.reason == sa.R_INSTALL_VELOCITY
    assert d.grant_allowed is False


def test_shadow_never_denies(monkeypatch):
    monkeypatch.setattr(settings, "STARTER_CREDIT_ABUSE_MODE", "shadow", raising=False)
    inst = sa.issue_install_id()
    sa.record_grant("u1", provider="password", ip="203.0.113.10", install_id=inst)
    d = sa.evaluate("u2", provider="password", ip="203.0.113.10", install_id=inst)
    assert d.outcome in (sa.DENY, sa.DEFER)      # a risk signal fired…
    assert d.enforced is False and d.grant_allowed is True   # …but shadow still allows


def test_network_only_defers_not_denies(monkeypatch):
    monkeypatch.setattr(settings, "STARTER_CREDIT_ABUSE_MODE", "enforce", raising=False)
    # Distinct installs, same network, at the cap → DEFER (shared-net safe), not DENY.
    for i in range(3):
        sa.record_grant(f"n{i}", provider="password", ip="203.0.113.10", install_id=sa.issue_install_id())
    d = sa.evaluate("n_new", provider="password", ip="203.0.113.10", install_id=sa.issue_install_id())
    assert d.outcome == sa.DEFER and d.reason == sa.R_NETWORK_VELOCITY


# ── Grant boundary integration ─────────────────────────────────────────────────

def test_grant_withheld_in_enforce_but_no_crash(monkeypatch):
    monkeypatch.setattr(settings, "STARTER_CREDIT_ABUSE_MODE", "enforce", raising=False)
    ctx1, inst = _ctx()
    gw.ensure_starter_grant("acct1", context=ctx1)               # first grant OK
    assert credits.get_balance("acct1") == 20
    # Second account, SAME install → enforced deny → zero promotional credits.
    ctx2 = gw.GrantContext(provider="password", ip="198.51.100.1", install_id=inst)
    gw.ensure_starter_grant("acct2", context=ctx2)               # must not raise
    assert credits.get_balance("acct2") == 0


def test_grant_proceeds_in_shadow(monkeypatch):
    monkeypatch.setattr(settings, "STARTER_CREDIT_ABUSE_MODE", "shadow", raising=False)
    ctx1, inst = _ctx()
    gw.ensure_starter_grant("s1", context=ctx1)
    ctx2 = gw.GrantContext(provider="password", ip="203.0.113.10", install_id=inst)
    gw.ensure_starter_grant("s2", context=ctx2)                 # shadow → still granted
    assert credits.get_balance("s2") == 20


def test_owner_exempt(monkeypatch):
    monkeypatch.setattr(settings, "STARTER_CREDIT_ABUSE_MODE", "enforce", raising=False)
    ctx1, inst = _ctx()
    gw.ensure_starter_grant("o0", context=ctx1)
    owner_ctx = gw.GrantContext(provider="password", ip="203.0.113.10", install_id=inst, exempt=True)
    gw.ensure_starter_grant("owner", context=owner_ctx)         # owner bypasses the gate
    assert credits.get_balance("owner") == 20


def test_paid_user_exempt(monkeypatch):
    monkeypatch.setattr(settings, "STARTER_CREDIT_ABUSE_MODE", "enforce", raising=False)
    ctx1, inst = _ctx()
    gw.ensure_starter_grant("p0", context=ctx1)
    # A paying customer already holds purchased credits → never gated on the promo.
    credits.grant("payer", 50, reason="purchase", reference="polar:order:1")
    ctx = gw.GrantContext(provider="google", ip="203.0.113.10", install_id=inst)
    gw.ensure_starter_grant("payer", context=ctx)
    assert credits.get_balance("payer") == 70                   # 50 purchased + 20 starter


def test_ledger_idempotent_under_concurrency(monkeypatch):
    monkeypatch.setattr(settings, "STARTER_CREDIT_ABUSE_MODE", "enforce", raising=False)
    ctx, _ = _ctx()
    barrier = threading.Barrier(10)

    def worker():
        barrier.wait()
        gw.ensure_starter_grant("race", context=ctx)

    ts = [threading.Thread(target=worker) for _ in range(10)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert credits.get_balance("race") == 20                   # exactly one grant


# ── Diagnostics privacy ────────────────────────────────────────────────────────

def test_readiness_has_no_pii(monkeypatch):
    monkeypatch.setattr(settings, "STARTER_CREDIT_ABUSE_MODE", "enforce", raising=False)
    sa.record_grant("d1", provider="password", ip="203.0.113.10", install_id=sa.issue_install_id())
    import json
    blob = json.dumps(sa.readiness())
    assert "203.0.113.10" not in blob and "203.0.113" not in blob
    assert "@" not in blob
    r = sa.readiness()
    assert r["mode"] == "enforce" and "thresholds" in r and "counters" in r
