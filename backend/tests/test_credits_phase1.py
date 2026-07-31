# coding: utf-8
"""
Tests — Credits Phase 1 gateway (starter grant + atomic spend + read).

Exercises the NON-billing seam (`backend.services.credits_gateway`) over the
existing immutable credit ledger. No live external API. The credit store is reset
per test and the ledger is enabled via ENABLE_BILLING_CREDITS.
"""
from __future__ import annotations

import threading

import pytest

from backend.services import credits_gateway as gw
from backend.services.billing.credits import service as credits
from backend.services.billing.credits import store as credits_store


@pytest.fixture(autouse=True)
def _ledger(monkeypatch, tmp_path):
    monkeypatch.setenv("ENABLE_BILLING_CREDITS", "true")
    monkeypatch.setenv("BILLING_DB_PATH", str(tmp_path / "billing.db"))
    credits_store._reset_for_tests()
    yield
    credits_store._reset_for_tests()


# ── Starter grant: exactly-once, idempotent ───────────────────────────────────
def test_starter_grant_is_idempotent():
    uid = "user_1"
    gw.ensure_starter_grant(uid)
    gw.ensure_starter_grant(uid)          # retry / duplicate signup / redeploy
    gw.ensure_starter_grant(uid)
    assert credits.get_balance(uid) == gw.STARTER_CREDITS   # exactly 20, once
    # Exactly one ledger entry for the starter grant.
    txns = credits.list_transactions(uid, limit=100)
    grants = [t for t in txns if t.reference == f"{gw.STARTER_REASON}:{uid}"]
    assert len(grants) == 1


def test_starter_grant_skips_guests():
    gw.ensure_starter_grant("guest_1", kind="guest")
    assert credits.get_balance("guest_1") == 0


def test_starter_grant_dormant_when_disabled(monkeypatch):
    monkeypatch.setenv("ENABLE_BILLING_CREDITS", "false")
    gw.ensure_starter_grant("user_x")
    assert credits.get_balance("user_x") == 0


# ── Spend: deducts, summary, insufficient, duplicate ref, non-negative ─────────
def test_spend_deducts_and_summary_reports_lifetime():
    uid = "user_2"
    gw.ensure_starter_grant(uid)                                  # +20
    gw.spend_credits(uid, 5, reason="deep_think", reference="op:1")   # -5
    assert credits.get_balance(uid) == 15
    s = gw.credit_summary(uid)
    assert s["enabled"] is True
    assert s["balance"] == 15
    assert s["lifetime_granted"] == 20
    assert s["lifetime_consumed"] == 5


def test_spend_insufficient_raises_and_does_not_deduct():
    uid = "user_3"
    gw.ensure_starter_grant(uid)                                  # 20
    with pytest.raises(gw.InsufficientCreditsError) as ei:
        gw.spend_credits(uid, 25, reason="big_op", reference="op:big")
    assert ei.value.required == 25
    assert ei.value.balance == 20
    assert credits.get_balance(uid) == 20                        # unchanged


def test_spend_duplicate_reference_charges_once():
    uid = "user_4"
    gw.ensure_starter_grant(uid)                                  # 20
    gw.spend_credits(uid, 5, reason="op", reference="op:same")
    gw.spend_credits(uid, 5, reason="op", reference="op:same")    # retry, same ref
    assert credits.get_balance(uid) == 15                        # charged once


def test_balance_never_negative_under_concurrent_spend():
    uid = "user_5"
    credits.grant(uid, 10, reason="seed", reference="seed:1")     # balance 10
    successes: list[bool] = []
    lock = threading.Lock()

    def worker(i: int) -> None:
        try:
            gw.spend_credits(uid, 1, reason="race", reference=f"race:{i}")
            with lock:
                successes.append(True)
        except gw.InsufficientCreditsError:
            with lock:
                successes.append(False)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(25)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # Exactly 10 of the 25 concurrent spends succeed; the rest are rejected.
    assert sum(1 for ok in successes if ok) == 10
    assert credits.get_balance(uid) == 0        # drained exactly, never negative
    assert credits.get_balance(uid) >= 0


def test_credit_summary_neutral_when_disabled(monkeypatch):
    monkeypatch.setenv("ENABLE_BILLING_CREDITS", "false")
    s = gw.credit_summary("user_6")
    assert s["enabled"] is False
    assert s["balance"] == 0
    assert s["lifetime_granted"] == 0 and s["lifetime_consumed"] == 0
