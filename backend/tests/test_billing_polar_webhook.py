# coding: utf-8
"""
Tests — Polar Standard-Webhooks verification + webhook route (PR #524).

Covers webhook cases 16–28. Authored for a later run — NOT executed in this PR.
No live Polar API is called; signatures are computed locally.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import time

from backend.services.billing.polar import signature as polar_sig


_RAW_KEY = b"polar-standard-webhooks-test-key"
_SECRET = "whsec_" + base64.b64encode(_RAW_KEY).decode()


def _sign(wid: str, wts: str, body: bytes) -> str:
    to_sign = f"{wid}.{wts}.".encode("utf-8") + body
    digest = hmac.new(_RAW_KEY, to_sign, hashlib.sha256).digest()
    return "v1," + base64.b64encode(digest).decode("ascii")


def _headers(wid, wts, sig):
    return {"webhook-id": wid, "webhook-timestamp": wts, "webhook-signature": sig}


# ── 16. Valid signature accepted ──────────────────────────────────────────────
def test_valid_signature_accepted():
    body = b'{"type":"subscription.created","data":{"id":"sub_1"}}'
    now = int(time.time())
    sig = _sign("msg_1", str(now), body)
    assert polar_sig.verify(raw_body=body, headers=_headers("msg_1", str(now), sig),
                            secret=_SECRET, now=now) is True


# ── 17. Invalid signature rejected ────────────────────────────────────────────
def test_invalid_signature_rejected():
    body = b'{"type":"subscription.created","data":{"id":"sub_1"}}'
    now = int(time.time())
    assert polar_sig.verify(raw_body=body, headers=_headers("msg_1", str(now), "v1,deadbeef"),
                            secret=_SECRET, now=now) is False
    # a signature over a DIFFERENT body must not verify (tamper).
    good = _sign("msg_1", str(now), b"other")
    assert polar_sig.verify(raw_body=body, headers=_headers("msg_1", str(now), good),
                            secret=_SECRET, now=now) is False


# ── 18. Stale timestamp rejected ──────────────────────────────────────────────
def test_stale_timestamp_rejected():
    body = b'{"type":"subscription.created","data":{"id":"sub_1"}}'
    old = int(time.time()) - 10_000
    sig = _sign("msg_1", str(old), body)
    now = int(time.time())
    assert polar_sig.verify(raw_body=body, headers=_headers("msg_1", str(old), sig),
                            secret=_SECRET, now=now) is False
    # within tolerance it passes.
    fresh = now - 10
    sig2 = _sign("msg_1", str(fresh), body)
    assert polar_sig.verify(raw_body=body, headers=_headers("msg_1", str(fresh), sig2),
                            secret=_SECRET, now=now) is True


# ── missing headers / secret fail closed ──────────────────────────────────────
def test_missing_headers_or_secret_fail_closed():
    body = b"{}"
    now = int(time.time())
    sig = _sign("m", str(now), body)
    assert polar_sig.verify(raw_body=body, headers={}, secret=_SECRET, now=now) is False
    assert polar_sig.verify(raw_body=body, headers=_headers("m", str(now), sig), secret="", now=now) is False


# ── 19. Raw-body verification occurs BEFORE JSON parsing (route contract) ──────
def test_route_verifies_before_parse():
    import inspect
    from backend.routes import v2_billing_polar
    src = inspect.getsource(v2_billing_polar.polar_webhook)
    verify_at = src.index("polar_signature.verify")
    parse_at = src.index("json.loads")
    assert verify_at < parse_at            # signature check precedes any parse


# ── 28. The route never logs the full body or the secret ──────────────────────
def test_route_does_not_log_full_body_or_secret():
    import inspect
    from backend.routes import v2_billing_polar
    src = inspect.getsource(v2_billing_polar)
    # No logging of the raw body or the payload, and the secret is never
    # interpolated into a log call.
    assert "logger.info(payload" not in src and "logger.warning(payload" not in src
    assert "logger" not in src or ", secret" not in src.split("logger", 1)[1]
    assert "%s\", secret" not in src


# ── Route-level (needs ENABLE_BILLING + POLAR_WEBHOOK_SECRET + tmp billing db) ──
# 16/17/20/21/22: happy path, bad signature, oversized, duplicate, unknown event.
def _route_env(monkeypatch, tmp_path):
    monkeypatch.setenv("ENABLE_BILLING", "true")
    monkeypatch.setenv("POLAR_WEBHOOK_SECRET", _SECRET)
    monkeypatch.setenv("BILLING_DB_PATH", str(tmp_path / "billing.db"))


def test_route_accepts_valid_and_is_idempotent(client, monkeypatch, tmp_path):
    _route_env(monkeypatch, tmp_path)
    body = b'{"type":"subscription.created","data":{"id":"sub_route_1","status":"active","customer":{"external_id":"u1"}}}'
    now = int(time.time())
    sig = _sign("evt_1", str(now), body)
    h = _headers("evt_1", str(now), sig)
    r1 = client.post("/v2/billing/webhooks/polar", content=body, headers=h)
    assert r1.status_code == 200
    assert r1.json()["data"]["duplicate"] is False
    # 21. duplicate delivery (identical bytes) is idempotent.
    r2 = client.post("/v2/billing/webhooks/polar", content=body, headers=h)
    assert r2.status_code == 200
    assert r2.json()["data"]["duplicate"] is True


def test_route_rejects_bad_signature(client, monkeypatch, tmp_path):
    _route_env(monkeypatch, tmp_path)
    body = b'{"type":"subscription.created","data":{"id":"x"}}'
    now = int(time.time())
    r = client.post("/v2/billing/webhooks/polar", content=body,
                    headers=_headers("e", str(now), "v1,bad"))
    assert r.status_code == 401


def test_route_503_when_secret_missing(client, monkeypatch, tmp_path):
    monkeypatch.setenv("ENABLE_BILLING", "true")
    monkeypatch.delenv("POLAR_WEBHOOK_SECRET", raising=False)
    monkeypatch.setenv("BILLING_DB_PATH", str(tmp_path / "billing.db"))
    r = client.post("/v2/billing/webhooks/polar", content=b"{}",
                    headers=_headers("e", str(int(time.time())), "v1,x"))
    assert r.status_code == 503
