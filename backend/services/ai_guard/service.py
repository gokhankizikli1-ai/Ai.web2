# coding: utf-8
"""
Phase 14L.1 — Founder-Beta AI protection: the centralized preflight SERVICE.

ONE function, `preflight(...)`, is called on the server BEFORE every protected
provider/model invocation. It runs the deliberate check order:

    1. authenticated user        (caller supplies the trusted uid)
    2. kill switch               → ai_temporarily_disabled
    3. operation policy enabled  → operation_disabled
    4. request rate limit        → rate_limited (+ retryAfterSeconds)
    5. entitlement / credit      → credit_unavailable
    6. idempotency + concurrency + daily quota + global spend + lock
       (atomic, in store.try_attach_continuation / store.reserve_start)

FAIL-CLOSED for costly operations: if the durable store is unreachable the
protected operation is BLOCKED (credit_unavailable), never allowed to spend.
Non-AI operations never call this and are unaffected.

Also exposes classification (server-derived from mode + envelope), cost
reconciliation (`record_model_cost`), lifecycle (`finalize`), the privacy-safe
request fingerprint, and an owner status snapshot. No model/provider calls here.
"""
from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from typing import Dict, Optional

from backend.services.ai_guard import policy as P
from backend.services.ai_guard import store

logger = logging.getLogger(__name__)


# ── Server-derived operation classification ───────────────────────────────────
# Kept for the metadata/UX layer. The authoritative START-vs-CONTINUATION decision
# is NOT static here — it is made atomically in preflight from whether the user
# already holds an active Web Build lock (so planning-repairs / code-gen / repairs
# correctly attach to the same operation instead of re-charging quota).
ROLE_START = "start"

_REVISION_MARKER = "[FRONTEND REVISION REQUEST]"
_FAMILY = (P.OP_WEB_BUILD_FULL, P.OP_WEB_BUILD_MAJOR_REDESIGN, P.OP_WEB_BUILD_SMALL_EDIT)


def classify(mode: Optional[str], message: str, declared_intent: Optional[str] = None) -> str:
    """Return the candidate operation_type derived from trusted route context —
    never from an arbitrary client label. `declared_intent` only ever ESCALATES to
    the stricter, policy-gated major-redesign path; it can never downgrade a full
    build into a cheaper bucket. The value is the type used IF the call begins a new
    operation; a continuation inherits its active operation's type instead."""
    m = (mode or "").strip().lower()
    msg = message or ""
    if m == "website_builder":
        if (declared_intent or "").strip().lower() == P.OP_WEB_BUILD_MAJOR_REDESIGN:
            return P.OP_WEB_BUILD_MAJOR_REDESIGN
        return P.OP_WEB_BUILD_FULL
    if m == "frontend_builder":
        return P.OP_WEB_BUILD_SMALL_EDIT if _REVISION_MARKER in msg else P.OP_WEB_BUILD_FULL
    if m == "visual_intelligence":
        return P.OP_WEB_BUILD_FULL
    return P.OP_OTHER


def is_protected(operation_type: str) -> bool:
    return operation_type in P.PROTECTED_OPERATIONS


# ── Privacy-safe request fingerprint ──────────────────────────────────────────
def fingerprint(user_id: str, operation_type: str, message: str) -> str:
    """Deterministic, non-reversible identity of THIS request. Hashes only the
    normalized message body (whitespace-collapsed) + user + type. The raw prompt
    is never stored or logged; secrets are never included. Different edits keep
    different fingerprints (full body hashed, not a truncation)."""
    norm = " ".join((message or "").split())
    h = hashlib.sha256()
    h.update(str(user_id).encode("utf-8", "ignore"))
    h.update(b"\x00")
    h.update(operation_type.encode("utf-8", "ignore"))
    h.update(b"\x00")
    h.update(norm.encode("utf-8", "ignore"))
    return h.hexdigest()


# ── Preflight result ──────────────────────────────────────────────────────────
@dataclass
class Preflight:
    allowed: bool
    code: str
    operation_type: str
    role: str = ROLE_START
    operation_id: Optional[str] = None
    reservation_id: Optional[str] = None
    idempotent_replay: bool = False
    retry_after_seconds: Optional[int] = None
    reset_at: Optional[str] = None
    remaining: Optional[int] = None
    fail_closed: bool = False

    def to_metadata(self) -> Dict[str, object]:
        """Bounded, user-safe structured payload for the response envelope.
        Codes + numbers only — never a dollar budget, provider, or raw error."""
        md: Dict[str, object] = {
            "status": "allowed" if self.allowed else "blocked",
            "code": self.code,
            "operationType": self.operation_type,
        }
        if self.operation_id:
            md["operationId"] = self.operation_id
        if self.retry_after_seconds is not None:
            md["retryAfterSeconds"] = self.retry_after_seconds
        if self.reset_at:
            md["resetAt"] = self.reset_at
        if self.remaining is not None:
            md["remaining"] = self.remaining
        return md


def _policy() -> P.FounderBetaPolicy:
    return P.FounderBetaPolicy(store.get_overrides())


def preflight(*, user_id: str, operation_type: str, message: str,
              idempotency_key: Optional[str] = None) -> Preflight:
    """Run the ordered gate before a protected provider call. The START-vs-
    CONTINUATION decision is made atomically from the user's active Web Build lock,
    so a build's planning-repairs / code-gen / repairs attach (uncharged) instead of
    re-charging quota. Never raises."""
    window = P.utc_window()
    reset_at = P.utc_reset_at()
    family = operation_type in _FAMILY
    fp = fingerprint(str(user_id), operation_type, message)
    try:
        pol = _policy()
    except Exception as e:  # policy read failure → fail closed for costly work
        logger.warning("ai_guard policy read failed, failing closed: %s", e)
        return Preflight(False, P.CODE_CREDIT_UNAVAILABLE, operation_type, reset_at=reset_at, fail_closed=True)

    # 2. Kill switch — precedence over everything else.
    if not pol.ai_operations_enabled:
        return Preflight(False, P.CODE_AI_DISABLED, operation_type, reset_at=reset_at)

    # Web Build family: is this a CONTINUATION of an already-running build? Decided
    # atomically. A continuation never re-charges quota; a duplicate of the START
    # request returns operation_in_progress (so the model is not called twice).
    if family:
        try:
            kind, op_id = store.try_attach_continuation(
                user_id=str(user_id), idempotency_key=idempotency_key, fingerprint=fp,
                lock_ttl=pol.lock_ttl_seconds)
        except Exception as e:
            logger.warning("ai_guard continuation check failed (treating as start): %s", e)
            kind, op_id = "none", None
        if kind == "duplicate":
            return Preflight(False, P.CODE_IN_PROGRESS, operation_type, operation_id=op_id, reset_at=reset_at)
        if kind == "attached":
            return Preflight(True, P.CODE_ALLOWED, operation_type, role="continuation",
                             operation_id=op_id, idempotent_replay=True, reset_at=reset_at)

    limit = pol.limit_for(operation_type)

    # 3. Operation policy enabled (truthful disabled response, never a silent
    #    reclassification into a cheaper bucket).
    if not limit.enabled:
        return Preflight(False, P.CODE_OPERATION_DISABLED, operation_type, reset_at=reset_at)

    # 4. Short-window rate limit (submission burst protection).
    try:
        ok, retry = store.rate_check(str(user_id), operation_type, pol.rate_limit_per_min(operation_type))
    except Exception:
        ok, retry = True, 0
    if not ok:
        return Preflight(False, P.CODE_RATE_LIMITED, operation_type,
                         retry_after_seconds=retry, reset_at=reset_at)

    # 5. Entitlement / credit foundation (founder-beta supplies entitlement).
    try:
        used_now = store.daily_count(str(user_id), window, operation_type)
    except Exception:
        used_now = 0
    decision = P.credit_decision(pol, operation_type, remaining=max(0, limit.daily_per_user - used_now))
    if not decision.allowed:
        return Preflight(False, P.CODE_CREDIT_UNAVAILABLE, operation_type, reset_at=reset_at)

    # 6. Atomic: concurrency + daily quota + global spend + lock reservation.
    try:
        out = store.reserve_start(
            user_id=str(user_id), operation_type=operation_type, window=window,
            daily_limit=limit.daily_per_user, max_concurrent=limit.max_concurrent_per_user,
            estimate_usd=pol.estimate_usd(operation_type),
            spend_enabled=pol.global_spend_enabled, spend_limit=pol.global_spend_limit_usd,
            lock_ttl=pol.lock_ttl_seconds, idempotency_key=idempotency_key,
            fingerprint=fp, idem_ttl=pol.idempotency_ttl_seconds,
        )
    except Exception as e:
        # Durable store unreachable → FAIL CLOSED for costly generation.
        logger.warning("ai_guard reserve failed, failing closed: %s", e)
        return Preflight(False, P.CODE_CREDIT_UNAVAILABLE, operation_type, reset_at=reset_at, fail_closed=True)

    if out.code == "allowed":
        remaining = max(0, limit.daily_per_user - out.used) if out.used else None
        return Preflight(True, P.CODE_ALLOWED, operation_type, operation_id=out.operation_id,
                         reservation_id=out.reservation_id, idempotent_replay=out.replay,
                         reset_at=reset_at, remaining=remaining)

    remaining = max(0, limit.daily_per_user - out.used) if out.code == "daily_limit_reached" else None
    return Preflight(False, out.code, operation_type, operation_id=out.operation_id,
                     reset_at=reset_at, remaining=remaining)


def record_model_cost(*, operation_id: Optional[str], user_id: str, model: Optional[str],
                      provider: Optional[str], input_tokens: int, output_tokens: int,
                      operation_type: str) -> None:
    """Reconcile REAL spend after a protected sub-call returns. Uses server-known
    token usage; falls back to the conservative per-op estimate when tokens are
    absent so the global ledger is never under-counted. Never raises."""
    try:
        window = P.utc_window()
        actual = P.compute_actual_usd(model, int(input_tokens or 0), int(output_tokens or 0))
        if actual is None:
            # No token data → attribute a conservative fixed estimate once.
            actual = P.FounderBetaPolicy(store.get_overrides()).estimate_usd(operation_type)
        store.record_cost(operation_id=operation_id, user_id=str(user_id), window=window,
                          actual_usd=float(actual), model=model, provider=provider)
    except Exception as e:
        logger.debug("ai_guard record_model_cost skipped: %s", e)


def finalize(*, user_id: str, status: str, operation_id: Optional[str] = None,
             idempotency_key: Optional[str] = None, error_code: Optional[str] = None) -> bool:
    """Release the lock + outstanding reservation for a user's own operation,
    targeted by the server operation_id when known, else by the client
    idempotency key (abort-before-response). Never raises."""
    try:
        if operation_id:
            if store.finalize(operation_id=operation_id, user_id=str(user_id), status=status, error_code=error_code):
                return True
        if idempotency_key:
            return store.finalize_by_key(user_id=str(user_id), idempotency_key=idempotency_key,
                                         status=status, error_code=error_code)
        return False
    except Exception as e:
        logger.warning("ai_guard finalize failed: %s", e)
        return False


# ── User-facing usage snapshot (for the honest founder-beta UI state) ─────────
def usage_snapshot(user_id: str) -> Dict[str, object]:
    window = P.utc_window()
    pol = _policy()
    ops: Dict[str, object] = {}
    for op in P.PROTECTED_OPERATIONS:
        lim = pol.limit_for(op)
        try:
            used = store.daily_count(str(user_id), window, op)
        except Exception:
            used = 0
        ops[op] = {
            "enabled": lim.enabled,
            "used": used,
            "limit": lim.daily_per_user,
            "remaining": max(0, lim.daily_per_user - used) if lim.enabled else 0,
        }
    return {
        "mode": P.FounderBetaPolicy.MODE,
        "aiOperationsEnabled": pol.ai_operations_enabled,
        "resetAt": P.utc_reset_at(),
        "operations": ops,
    }


# ── Owner status snapshot (admin diagnostics — no dollar budget leaked to users) ─
def owner_snapshot() -> Dict[str, object]:
    window = P.utc_window()
    pol = _policy()
    snap = pol.snapshot()
    try:
        spend = store.global_spend(window)
    except Exception:
        spend = {"reservedUsd": 0.0, "actualUsd": 0.0}
    limit_usd = pol.global_spend_limit_usd
    pct = round(((spend["reservedUsd"] + spend["actualUsd"]) / limit_usd) * 100, 2) if limit_usd > 0 else 0.0
    return {
        "policy": snap,
        "window": window,
        "globalSpend": {**spend, "limitUsd": limit_usd, "percentUsed": pct},
        "activeOperations": _safe(store.active_operations_count),
        "countsByType": _safe(lambda: store.counts_by_type(window), {}),
        # Persistence proof (owner-only): which DB is actually live, and whether it
        # is on a durable path. Read-only — no quota consumed, no model called.
        "storage": _safe(store.storage_health, {"backend": "sqlite", "error": "unavailable"}),
    }


def storage_health() -> Dict[str, object]:
    """Owner-only storage diagnostics passthrough (read-only)."""
    return store.storage_health()


def verify_storage() -> Dict[str, object]:
    """Startup-safe persistence verification passthrough (writes a harmless meta
    marker; no quota, no model call)."""
    return store.verify_storage()


def _safe(fn, default=0):
    try:
        return fn()
    except Exception:
        return default
