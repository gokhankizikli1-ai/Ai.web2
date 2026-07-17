# coding: utf-8
"""
Phase 14L.1 — Founder-Beta AI usage/spend protection: CENTRAL POLICY.

One backend-owned source of truth for:
  • the AI operation taxonomy (typed operation names, no magic strings),
  • the founder-beta launch limits (daily-per-user + concurrency, per operation),
  • the global daily AI kill switch and spend guard configuration,
  • conservative cost estimation + reconciliation pricing,
  • the founder-beta entitlement (credit) decision,
  • the UTC daily-window helpers and stable error codes.

Values come from safe env defaults (read dynamically so a Railway flip takes
effect without a redeploy, mirroring backend/services/db/engine.py::_flag), and
may be OVERRIDDEN at runtime by the owner-writable overrides store. Limits are
NEVER trusted from the frontend. Nothing here calls a model or a provider.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional


# ── Operation taxonomy (typed, centralized — no magic strings elsewhere) ──────
OP_WEB_BUILD_FULL = "web_build_full"
OP_WEB_BUILD_MAJOR_REDESIGN = "web_build_major_redesign"
OP_WEB_BUILD_SMALL_EDIT = "web_build_small_edit"
OP_IMAGE_GENERATION = "image_generation"
OP_RESEARCH = "research"
OP_CHAT = "chat"
OP_OTHER = "other"

# Only these are subject to the mandatory founder-beta launch restrictions.
PROTECTED_OPERATIONS = (
    OP_WEB_BUILD_FULL,
    OP_WEB_BUILD_MAJOR_REDESIGN,
    OP_WEB_BUILD_SMALL_EDIT,
    OP_IMAGE_GENERATION,
)

# ── Stable error codes (backend returns codes; frontend localizes to en/tr/de) ─
CODE_ALLOWED = "allowed"
CODE_AI_DISABLED = "ai_temporarily_disabled"
CODE_OPERATION_DISABLED = "operation_disabled"
CODE_DAILY_LIMIT = "daily_limit_reached"
CODE_IN_PROGRESS = "operation_in_progress"
CODE_GLOBAL_SPEND = "global_spend_limit_reached"
CODE_RATE_LIMITED = "rate_limited"
CODE_IDEMPOTENCY_CONFLICT = "idempotency_conflict"
CODE_CREDIT_UNAVAILABLE = "credit_unavailable"


def _env(key: str, default: str) -> str:
    try:
        return os.getenv(key, default)
    except Exception:  # pragma: no cover — os access should never fail
        return default


def _env_flag(key: str, default: bool) -> bool:
    return _env(key, "true" if default else "false").strip().lower() == "true"


def _env_int(key: str, default: int) -> int:
    try:
        return int(str(_env(key, str(default))).strip())
    except Exception:
        return default


def _env_float(key: str, default: float) -> float:
    try:
        return float(str(_env(key, str(default))).strip())
    except Exception:
        return default


# ── Per-operation founder-beta limits ─────────────────────────────────────────
@dataclass(frozen=True)
class OperationLimit:
    operation_type: str
    enabled: bool
    daily_per_user: int
    max_concurrent_per_user: int


# ── Cost model (conservative reservation estimates + reconciliation pricing) ──
# Reservation estimates are deliberately conservative (max-ish) so the global
# guard reserves BEFORE the provider call and can never be surprised after it.
# Reconciliation pricing (USD per 1M tokens) refines the ledger when real token
# usage is available; otherwise the fixed estimate stands. These are dev-safe
# fallbacks — production sets the env values explicitly.
_DEFAULT_ESTIMATES: Dict[str, float] = {
    OP_WEB_BUILD_FULL: 0.60,
    OP_WEB_BUILD_MAJOR_REDESIGN: 0.60,
    OP_WEB_BUILD_SMALL_EDIT: 0.15,
    OP_IMAGE_GENERATION: 0.08,
    OP_RESEARCH: 0.05,
    OP_CHAT: 0.02,
    OP_OTHER: 0.02,
}

# (input_usd_per_1m, output_usd_per_1m). Conservative rounded public list prices;
# reconciliation only ever shrinks a reservation, so slight over-estimation is safe.
_MODEL_PRICES: Dict[str, tuple] = {
    "gpt-4o": (5.0, 15.0),
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-5.6": (10.0, 30.0),
    "gpt-image-1": (5.0, 40.0),
}
_FALLBACK_PRICE = (5.0, 15.0)


class FounderBetaPolicy:
    """Resolved, read-only snapshot of the founder-beta policy. Built per call
    from env defaults + optional owner overrides. `overrides` is a plain
    dict[str,str] fetched from the overrides store (may be empty)."""

    MODE = "founder_beta"

    def __init__(self, overrides: Optional[Dict[str, str]] = None) -> None:
        self._ov = overrides or {}

    # -- override-aware readers ------------------------------------------------
    def _ov_flag(self, key: str, env_key: str, default: bool) -> bool:
        if key in self._ov:
            return str(self._ov[key]).strip().lower() == "true"
        return _env_flag(env_key, default)

    def _ov_int(self, key: str, env_key: str, default: int) -> int:
        if key in self._ov:
            try:
                return int(str(self._ov[key]).strip())
            except Exception:
                return default
        return _env_int(env_key, default)

    def _ov_float(self, key: str, env_key: str, default: float) -> float:
        if key in self._ov:
            try:
                return float(str(self._ov[key]).strip())
            except Exception:
                return default
        return _env_float(env_key, default)

    # -- top-level switches ----------------------------------------------------
    @property
    def founder_beta_enabled(self) -> bool:
        return self._ov_flag("founder_beta_enabled", "AI_FOUNDER_BETA_ENABLED", True)

    @property
    def ai_operations_enabled(self) -> bool:
        """Global AI kill switch. True → AI operations permitted. A flip to
        false blocks every PROTECTED AI operation before the provider call."""
        return self._ov_flag("ai_operations_enabled", "AI_OPERATIONS_ENABLED", True)

    # -- global spend guard ----------------------------------------------------
    @property
    def global_spend_enabled(self) -> bool:
        return self._ov_flag("global_spend_enabled", "AI_GLOBAL_DAILY_SPEND_ENABLED", True)

    @property
    def global_spend_limit_usd(self) -> float:
        # Dev-safe conservative fallback; production MUST set the env explicitly.
        return max(0.0, self._ov_float("global_spend_limit_usd", "AI_GLOBAL_DAILY_SPEND_LIMIT_USD", 25.0))

    # -- lock / idempotency TTLs ----------------------------------------------
    @property
    def lock_ttl_seconds(self) -> int:
        return max(30, _env_int("AI_OPERATION_LOCK_TTL_SECONDS", 600))

    @property
    def idempotency_ttl_seconds(self) -> int:
        return max(60, _env_int("AI_OPERATION_IDEMPOTENCY_TTL_SECONDS", 86_400))

    # -- short-window rate limits (attempts/min per user) ----------------------
    def rate_limit_per_min(self, operation_type: str, is_owner: bool = False) -> int:
        if is_owner:
            # Narrowly-justified owner-only testing allowance. This is NOT a
            # removal of burst protection — it is a much higher ceiling so the
            # verified owner can run sequential Web Builds to collect cost data
            # without tripping the 2/min founder-beta submission guard. A runaway
            # loop is still bounded (default 60/min).
            return _env_int("AI_RATE_OWNER_PER_MIN", 60)
        if operation_type == OP_WEB_BUILD_SMALL_EDIT:
            return _env_int("AI_RATE_SMALL_EDIT_PER_MIN", 10)
        if operation_type in (OP_WEB_BUILD_FULL, OP_WEB_BUILD_MAJOR_REDESIGN):
            return _env_int("AI_RATE_FULL_BUILD_PER_MIN", 2)
        return _env_int("AI_RATE_PROTECTED_PER_MIN", 6)

    # -- per-operation limits --------------------------------------------------
    def limit_for(self, operation_type: str) -> OperationLimit:
        if operation_type == OP_WEB_BUILD_FULL:
            return OperationLimit(
                operation_type, enabled=True,
                daily_per_user=max(0, self._ov_int("full.daily", "AI_BETA_FULL_BUILDS_PER_DAY", 1)),
                max_concurrent_per_user=1,
            )
        if operation_type == OP_WEB_BUILD_MAJOR_REDESIGN:
            return OperationLimit(
                operation_type,
                enabled=self._ov_flag("major_redesign.enabled", "AI_BETA_MAJOR_REDESIGNS_ENABLED", False),
                daily_per_user=max(0, self._ov_int("major_redesign.daily", "AI_BETA_MAJOR_REDESIGNS_PER_DAY", 1)),
                max_concurrent_per_user=1,
            )
        if operation_type == OP_WEB_BUILD_SMALL_EDIT:
            return OperationLimit(
                operation_type, enabled=True,
                daily_per_user=max(0, self._ov_int("small_edit.daily", "AI_BETA_SMALL_EDITS_PER_DAY", 5)),
                max_concurrent_per_user=1,
            )
        if operation_type == OP_IMAGE_GENERATION:
            return OperationLimit(
                operation_type,
                enabled=self._ov_flag("image_generation.enabled", "AI_BETA_IMAGE_GENERATION_ENABLED", False),
                daily_per_user=max(0, self._ov_int("image_generation.daily", "AI_BETA_IMAGE_GENERATION_PER_DAY", 0)),
                max_concurrent_per_user=0,
            )
        # Non-protected operations are unrestricted by the founder-beta layer.
        return OperationLimit(operation_type, enabled=True, daily_per_user=0, max_concurrent_per_user=1)

    # -- cost model ------------------------------------------------------------
    def estimate_usd(self, operation_type: str) -> float:
        base = _DEFAULT_ESTIMATES.get(operation_type, 0.05)
        return max(0.0, self._ov_float(f"estimate.{operation_type}", f"AI_EST_COST_{operation_type.upper()}", base))

    def snapshot(self) -> Dict[str, object]:
        """Owner-facing policy view (no secrets, no provider names)."""
        ops = {}
        for op in PROTECTED_OPERATIONS:
            lim = self.limit_for(op)
            ops[op] = {
                "enabled": lim.enabled,
                "dailyPerUser": lim.daily_per_user,
                "maxConcurrentPerUser": lim.max_concurrent_per_user,
            }
        return {
            "mode": self.MODE,
            "founderBetaEnabled": self.founder_beta_enabled,
            "aiOperationsEnabled": self.ai_operations_enabled,
            "globalSpend": {
                "enabled": self.global_spend_enabled,
                "limitUsd": self.global_spend_limit_usd,
            },
            "lockTtlSeconds": self.lock_ttl_seconds,
            "operations": ops,
        }


# ── Entitlement / credit foundation (founder-beta supplies entitlement now) ───
@dataclass(frozen=True)
class AiCreditDecision:
    allowed: bool
    source: str  # 'founder-beta' | 'paid-plan' | 'admin-grant'
    remaining: Optional[int] = None
    reason: Optional[str] = None


def credit_decision(policy: FounderBetaPolicy, operation_type: str, remaining: Optional[int],
                    is_owner: bool = False) -> AiCreditDecision:
    """Narrow entitlement interface. For this launch the founder-beta policy IS
    the entitlement source; a paid wallet/ledger can augment/replace this later
    WITHOUT changing the call site. No monetary credits are invented here.

    `is_owner` is a BACKEND-VERIFIED flag (see service.resolve_owner). When set,
    the personal entitlement is an unlimited `admin-grant`: the founder-beta
    per-plan credit gate never rejects the owner. This grant is ONLY about
    personal entitlement/quota — it does NOT touch the global kill switch,
    operation-enabled toggles, the global spend cap, concurrency, idempotency
    or cost tracking, which are enforced elsewhere in preflight/reserve_start.
    """
    if is_owner:
        return AiCreditDecision(True, "admin-grant", None, None)
    if not policy.founder_beta_enabled:
        return AiCreditDecision(False, "founder-beta", remaining, "founder beta disabled")
    return AiCreditDecision(True, "founder-beta", remaining, None)


# ── Cost helpers ──────────────────────────────────────────────────────────────
def compute_actual_usd(model: Optional[str], input_tokens: int, output_tokens: int) -> Optional[float]:
    """Best-effort USD from token usage. Returns None when token data is absent
    so the caller keeps the conservative reservation instead of guessing zero.

    Pricing is delegated to the CENTRALIZED table in
    backend.services.cost_tracking.pricing (task #5 — one source of truth). The
    local `_MODEL_PRICES` above is retained only as a defensive fallback for the
    (import-error) edge case so this guardrail never fails closed on a bad
    import."""
    if not model or (input_tokens <= 0 and output_tokens <= 0):
        return None
    try:
        from backend.services.cost_tracking import pricing as _pricing
        bd = _pricing.compute_call_cost(
            provider=None, model=model,
            input_tokens=int(input_tokens or 0),
            output_tokens=int(output_tokens or 0),
        )
        return round(bd.input_cost_usd + bd.output_cost_usd, 6)
    except Exception:
        # Fallback to the legacy local table if the central module is
        # unavailable for any reason — spend accounting must never break.
        key = str(model).strip().lower()
        price = None
        for name, p in _MODEL_PRICES.items():
            if key == name or key.startswith(name):
                price = p
                break
        if price is None:
            price = _FALLBACK_PRICE
        return round((input_tokens / 1_000_000.0) * price[0] + (output_tokens / 1_000_000.0) * price[1], 6)


# ── UTC daily window ──────────────────────────────────────────────────────────
def utc_window(now: Optional[datetime] = None) -> str:
    """Server-consistent UTC calendar day 'YYYY-MM-DD'. Never uses client time."""
    n = now or datetime.now(timezone.utc)
    return n.strftime("%Y-%m-%d")


def utc_reset_at(now: Optional[datetime] = None) -> str:
    """ISO-8601 of the next UTC midnight — exposed to the frontend as the reset
    time so it never computes limits from the client clock."""
    n = now or datetime.now(timezone.utc)
    nxt = (n + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return nxt.astimezone(timezone.utc).isoformat()
