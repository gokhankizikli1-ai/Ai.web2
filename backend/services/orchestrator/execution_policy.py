# coding: utf-8
"""Phase 5 — execution policy: cost enforcement + approval gate.

THE GOAL
--------
Korvix must never become an uncontrolled paid-agent loop. Every operation
the orchestrator is about to run is classified into one of three tiers and
gated accordingly, reusing the EXISTING enforcers rather than inventing a
new cost ledger:

    AUTO              free / cheap / deterministic — runs without approval
    APPROVAL_REQUIRED paid or external — needs a durable, version-bound
                      approval before it runs
    DENIED            never auto-runs from the orchestrator

REUSED AUTHORITIES (no duplication)
-----------------------------------
  * ai_guard  — the real spend/quota enforcer (global daily USD cap, kill
                switch). We consult its global-spend outcome; we do not
                replace it.
  * credits   — the idempotent ledger (UNIQUE (user_id, reference)). When
                enabled, a paid op is charged with reference == the stable
                operation key, so idempotent dispatch ⇒ idempotent charging
                (a retry with the same key never double-charges).
  * approvals_store — the new durable approval record (Phase 5), bound to
                an operation fingerprint so a materially changed plan
                invalidates prior approval.

DORMANT BY DEFAULT
------------------
Approval enforcement is gated by ENABLE_EXECUTION_APPROVAL (default false),
matching the repo's flag-gated rollout convention: the policy layer ships
inert (everything behaves as AUTO) and is flipped on when the approval UX is
ready. Credit charging remains gated by the existing ENABLE_BILLING_CREDITS.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from dataclasses import dataclass
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# ── Policy tiers ─────────────────────────────────────────────────────────
POLICY_AUTO = "AUTO"
POLICY_APPROVAL_REQUIRED = "APPROVAL_REQUIRED"
POLICY_DENIED = "DENIED"

# Capabilities that cost real money or reach outside the system → approval.
# Everything else defaults to AUTO (free/deterministic planning, research
# within budget, product synthesis, noop bookkeeping).
_PAID_CAPABILITIES = frozenset({"web_build", "app_build"})
_EXTERNAL_CAPABILITIES = frozenset({"deploy", "external_message", "publish"})
# Capabilities that must never auto-run from the orchestrator at all.
_DENIED_CAPABILITIES = frozenset({"delete_project"})

# Conservative per-capability credit cost estimates (used only when the
# credits ledger is enabled to gate on balance). Deliberately coarse — the
# real USD accounting is ai_guard's job; this is a credit-gate estimate.
_CREDIT_ESTIMATE: Dict[str, int] = {"web_build": 1, "app_build": 1}


# ── Reason codes ─────────────────────────────────────────────────────────
CODE_ALLOWED = "allowed"
CODE_APPROVAL_REQUIRED = "approval_required"
CODE_DENIED = "denied"
CODE_CREDIT_UNAVAILABLE = "credit_unavailable"
CODE_GLOBAL_SPEND_BLOCK = "global_spend_limit_reached"


@dataclass
class Decision:
    allowed: bool
    tier: str
    code: str
    detail: str = ""
    fingerprint: str = ""


def is_enforced() -> bool:
    """Whether approval enforcement is active. Default false → the policy
    layer is inert and every op behaves as AUTO (backward compatible)."""
    return os.getenv("ENABLE_EXECUTION_APPROVAL", "false").strip().lower() == "true"


def classify_capability(capability: str) -> str:
    """Deterministic tier for a capability. Free/cheap → AUTO; paid or
    external → APPROVAL_REQUIRED; destructive → DENIED."""
    cap = (capability or "").strip().lower()
    if cap in _DENIED_CAPABILITIES:
        return POLICY_DENIED
    if cap in _PAID_CAPABILITIES or cap in _EXTERNAL_CAPABILITIES:
        return POLICY_APPROVAL_REQUIRED
    return POLICY_AUTO


def operation_fingerprint(capability: str, spec: Optional[Dict[str, Any]]) -> str:
    """Deterministic fingerprint over the material fields of an operation.

    Canonical JSON (sorted keys) so the same logical operation always hashes
    the same, and any material change flips the hash — which invalidates a
    prior approval bound to the old fingerprint."""
    material = {"capability": (capability or "").strip().lower(), "spec": spec or {}}
    try:
        blob = json.dumps(material, sort_keys=True, ensure_ascii=False, default=str)
    except Exception:
        blob = repr(material)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:32]


# ── Injectable enforcer hooks (real by default; monkeypatched in tests) ──

def _credits_available(user_id: str, capability: str) -> bool:
    """Consult the credits ledger for whether the estimated cost of this
    capability can be afforded. Dormant ledger → True (nothing to enforce)."""
    est = _CREDIT_ESTIMATE.get((capability or "").lower(), 0)
    if est <= 0:
        return True
    try:
        from backend.services.billing.credits import service as credits_service
        return bool(credits_service.can_consume(user_id, est))
    except Exception:  # pragma: no cover — ledger unavailable → don't block on it
        return True


def _global_spend_ok(user_id: str) -> bool:
    """Advisory early-out against ai_guard's global daily spend guard.

    ai_guard.preflight remains the AUTHORITATIVE hard stop on the real
    model-call path (which builds already traverse) — this is a courtesy
    early check so an obviously-over-budget op can be refused before we even
    dispatch. When the guard is disabled, or we can't cheaply read its
    state, we return True and defer to ai_guard's own preflight. We consult;
    we never replace it. Monkeypatchable for tests."""
    try:
        from backend.services.ai_guard import policy as guard_policy
        from backend.services.ai_guard import store as guard_store
        pol = guard_policy.FounderBetaPolicy(guard_store.get_overrides())
        if not pol.global_spend_enabled():
            return True
        # Read the current window's committed + reserved USD and compare to
        # the cap. Fail-open on any read issue (ai_guard.preflight still
        # guards the real spend).
        snap = guard_store.global_spend(guard_policy.utc_window())
        if not snap:
            return True
        spent = float(snap.get("reservedUsd", 0.0)) + float(snap.get("actualUsd", 0.0))
        return spent < pol.global_spend_limit_usd()
    except Exception:  # pragma: no cover — defer to ai_guard preflight
        return True


def authorize(
    *,
    user_id: str,
    capability: str,
    spec: Optional[Dict[str, Any]] = None,
    project_id: Optional[str] = None,
    inline_approval: bool = False,
    approved_by: str = "",
) -> Decision:
    """Decide whether an operation may execute now.

    `inline_approval=True` means the CURRENT request carries an explicit,
    user-initiated approval for exactly this operation (e.g. the user hit
    "Build" themselves) — it is recorded durably and satisfies the gate.

    Returns a Decision. When enforcement is off, everything is AUTO/allowed.
    """
    tier = classify_capability(capability)
    fp = operation_fingerprint(capability, spec)

    if tier == POLICY_DENIED:
        return Decision(False, tier, CODE_DENIED,
                        "capability is not auto-runnable from the orchestrator", fp)

    # Enforcement dormant → behave exactly as before (allow).
    if not is_enforced():
        return Decision(True, tier, CODE_ALLOWED, "enforcement disabled", fp)

    if tier == POLICY_AUTO:
        return Decision(True, tier, CODE_ALLOWED, "auto", fp)

    # APPROVAL_REQUIRED — need a durable approval matching this fingerprint.
    from backend.services.orchestrator import approvals_store

    approved = approvals_store.is_approved(
        user_id=user_id, capability=capability, fingerprint=fp,
    )
    if not approved and inline_approval:
        # The user initiated this operation now → record + honor it.
        approvals_store.record_approval(
            user_id=user_id, capability=capability, fingerprint=fp,
            project_id=project_id, approved_by=approved_by or user_id,
            note="inline user-initiated approval",
        )
        approved = True

    if not approved:
        return Decision(False, tier, CODE_APPROVAL_REQUIRED,
                        "operation requires approval", fp)

    # Approved — now the cost gates (reuse existing authorities).
    if not _global_spend_ok(user_id):
        return Decision(False, tier, CODE_GLOBAL_SPEND_BLOCK,
                        "global daily spend limit reached", fp)
    if not _credits_available(user_id, capability):
        return Decision(False, tier, CODE_CREDIT_UNAVAILABLE,
                        "insufficient credits for this operation", fp)

    return Decision(True, tier, CODE_ALLOWED, "approved", fp)


def settle_charge(
    *,
    user_id: str,
    capability: str,
    reference: str,
    reason: str = "",
) -> bool:
    """Idempotently charge credits for a completed paid operation.

    `reference` MUST be the stable operation key (e.g. the workflow-step
    idempotency key), so a retry with the same key does NOT double-charge —
    the credits ledger dedups on (user_id, reference). No-op when the ledger
    is dormant. Returns True when the charge applied (or was a dormant/idem
    no-op), False on a real failure (e.g. insufficient funds)."""
    est = _CREDIT_ESTIMATE.get((capability or "").lower(), 0)
    if est <= 0 or not reference:
        return True
    try:
        from backend.services.billing.credits import service as credits_service
        if not credits_service.is_enabled():
            return True
        res = credits_service.consume(
            user_id, est, reason=reason or f"{capability} build",
            reference=str(reference),
        )
        return bool(getattr(res, "applied", False))
    except Exception as exc:  # pragma: no cover
        logger.warning("execution_policy.settle_charge failed: %s", exc)
        return False


__all__ = [
    "POLICY_AUTO", "POLICY_APPROVAL_REQUIRED", "POLICY_DENIED",
    "CODE_ALLOWED", "CODE_APPROVAL_REQUIRED", "CODE_DENIED",
    "CODE_CREDIT_UNAVAILABLE", "CODE_GLOBAL_SPEND_BLOCK",
    "Decision", "is_enforced", "classify_capability", "operation_fingerprint",
    "authorize", "settle_charge",
]
