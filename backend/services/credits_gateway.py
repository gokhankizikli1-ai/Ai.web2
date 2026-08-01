# coding: utf-8
"""
Credits — Phase 1 application gateway.

A thin, NON-billing-internal seam over the existing immutable credit ledger
(`backend.services.billing.credits.service`). It exists so the rest of the app
(auth signup, AI/build ops, the read API) can grant, spend and read credits
WITHOUT importing/modifying the protected billing ledger internals — the ledger
service is reused read/write through its stable public API only.

What this adds on top of the ledger:
  * `ensure_starter_grant(user_id)` — the once-per-account new-user grant, keyed
    on a STABLE idempotency reference so it is exactly-once under retries,
    duplicate signups, concurrency and redeploys (the ledger's UNIQUE(reference)
    index enforces it). Best-effort: never raises into the auth/signup path.
  * `spend_credits(...)` — the single reusable consume operation, raising a
    typed `InsufficientCreditsError` on overdraw so routes can map it to a
    stable HTTP contract (402). Atomicity + non-negativity come from the ledger.
  * `credit_summary(user_id)` — the authoritative read (balance + lifetime
    granted/consumed) the account UI displays.

Everything is dormant when `ENABLE_BILLING_CREDITS` is off (the ledger returns a
`disabled` result); callers then see balance 0 and grant/spend are no-ops.
No secrets/tokens/PII are logged here.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from backend.services.billing.credits import service as credits
from backend.services.billing.credits import types as credit_types

logger = logging.getLogger(__name__)

# The one-time starter allowance for a newly created real account.
STARTER_CREDITS = 20
STARTER_REASON = "starter_grant"


@dataclass(frozen=True)
class GrantContext:
    """Non-secret request context for the starter-credit abuse decision. Built by
    the route from authenticated identity + trusted-proxy IP + the signed install
    cookie. `exempt` short-circuits the abuse gate (configured owner)."""
    provider: str = ""            # "password" | "google" | ...
    ip: Optional[str] = None      # already trusted-proxy-resolved
    install_id: Optional[str] = None
    exempt: bool = False          # owner (paid users are detected via balance)


def _starter_reference(user_id: str) -> str:
    """Stable idempotency key — one starter grant per user, forever."""
    return f"{STARTER_REASON}:{user_id}"


def _already_granted(user_id: str) -> bool:
    """True when the starter grant already exists in the ledger (so the abuse
    gate is skipped — repeats are the ledger's idempotent no-op, never denied)."""
    try:
        from backend.services.billing.credits import store as credits_store
        return credits_store.get_by_reference(user_id, _starter_reference(user_id)) is not None
    except Exception:  # pragma: no cover — treat unknown as "not yet granted"
        return False


def ensure_starter_grant(
    user_id: str, *, kind: Optional[str] = None, context: Optional[GrantContext] = None,
) -> None:
    """Grant the one-time starter credits to a newly created account.

    Idempotent and exactly-once via the ledger's UNIQUE(reference) index: calling
    this more than once for the same user (retry, duplicate signup event,
    concurrent request, redeploy) records at most ONE grant. Best-effort — it
    NEVER raises into the caller (auth/signup must not fail on a credit hiccup).

    Abuse gate (only for a genuinely NEW grant, and only when a `context` is
    supplied): a layered risk decision may withhold the PROMOTIONAL starter grant
    when enforcement is on. It NEVER touches purchased/subscription credits, never
    denies an owner, and in shadow mode always allows (log only). Guests are
    skipped (their identity rotates; they are not real accounts).
    """
    uid = (user_id or "").strip()
    if not uid:
        return
    if (kind or "").strip().lower() == "guest":
        return

    # ── Layered abuse gate (promotional starter grant only) ───────────────────
    granted_new = True     # assume this call will create the grant unless proven otherwise
    try:
        from backend.services.auth import starter_abuse
        if (
            context is not None
            and not context.exempt
            and starter_abuse.mode() != "off"
            and credits.is_enabled()
            and not _already_granted(uid)          # only gate a genuinely first grant
            and not _has_prior_credits(uid)        # paid/other credits ⇒ exempt (never block a customer)
        ):
            decision = starter_abuse.evaluate(
                uid, provider=context.provider, ip=context.ip, install_id=context.install_id,
            )
            if not decision.grant_allowed:
                # enforce + deny/defer → withhold the promotional grant. Account
                # creation/login already succeeded; the user simply has no starter
                # credits (and thus no paid execution access without real credits).
                logger.info("credits.starter withheld | user=%s reason=%s", uid, decision.reason)
                return
    except Exception:  # pragma: no cover — a gate hiccup must never block a legit grant
        pass

    try:
        result = credits.grant(
            uid, STARTER_CREDITS,
            reason=STARTER_REASON,
            reference=_starter_reference(uid),
        )
        # reason_code is one of applied | idempotent | disabled | invalid.
        if result.reason_code == credit_types.REASON_APPLIED:
            logger.info("credits.starter granted | user=%s amount=%d", uid, STARTER_CREDITS)
            if context is not None:
                try:
                    from backend.services.auth import starter_abuse
                    starter_abuse.record_grant(
                        uid, provider=context.provider, ip=context.ip, install_id=context.install_id,
                    )
                except Exception:  # pragma: no cover — velocity recording is best-effort
                    pass
        elif result.reason_code == credit_types.REASON_IDEMPOTENT:
            logger.debug("credits.starter already granted (idempotent) | user=%s", uid)
        # disabled/invalid → no-op, no log noise.
    except Exception as exc:  # pragma: no cover — never break signup on credits
        logger.warning("credits.starter grant failed (non-fatal): %s", type(exc).__name__)


def _has_prior_credits(user_id: str) -> bool:
    """True when the account already holds credits (a proxy for a paying customer
    / previously-granted account) — such accounts are exempt from the promotional
    abuse gate so a real purchase is never blocked. Cheap; never raises."""
    try:
        return int(credits.get_balance(user_id)) > 0
    except Exception:  # pragma: no cover
        return False


class InsufficientCreditsError(Exception):
    """Typed error raised when a spend would overdraw the account. Carries the
    non-secret amounts so a route can surface a stable client message (402)."""

    def __init__(self, *, required: int, balance: int) -> None:
        super().__init__("insufficient credits")
        self.required = int(required)
        self.balance = int(balance)


def spend_credits(
    user_id: str, amount: int, *, reason: str, reference: str,
) -> credit_types.TxnResult:
    """Consume `amount` credits atomically for `user_id`.

    The single reusable spend operation for AI/build ops. Sufficient-balance
    validation + deduction happen atomically inside the ledger (concurrent
    spends cannot overspend), and the balance can never go negative. A retry
    with the same `reference` does NOT double-charge (idempotent).

    Raises `InsufficientCreditsError` on overdraw. Returns the `TxnResult`
    otherwise (which may be a `disabled` no-op when the ledger is off).
    """
    result = credits.consume(user_id, amount, reason=reason, reference=reference)
    if result.reason_code == credit_types.REASON_INSUFFICIENT:
        raise InsufficientCreditsError(required=int(amount), balance=int(result.balance))
    return result


# ── Read: authoritative balance + lifetime totals ────────────────────────────

# Bound the lifetime aggregation so a pathological ledger can't blow the request
# budget. Phase-1 accounts have a handful of entries; this is exact for all
# realistic cases. If ever exceeded, `lifetime_capped` flags the totals as a
# lower bound (a future indexed store aggregate would replace this).
_LIFETIME_PAGE = 200
_LIFETIME_MAX_PAGES = 25


def credit_summary(user_id: str) -> dict:
    """Authoritative snapshot for the account UI: current balance + lifetime
    granted/consumed. Never raises; returns a dormant snapshot when the ledger
    is disabled. `user_id` MUST be the backend-authenticated id."""
    uid = (user_id or "").strip()
    enabled = credits.is_enabled()
    if not uid or not enabled:
        return {
            "enabled": enabled, "balance": 0,
            "lifetime_granted": 0, "lifetime_consumed": 0, "lifetime_capped": False,
        }

    balance = 0
    try:
        balance = int(credits.get_balance(uid))
    except Exception:  # pragma: no cover — read must not 500
        balance = 0

    granted = 0
    consumed = 0
    capped = False
    try:
        for page in range(_LIFETIME_MAX_PAGES):
            txns = credits.list_transactions(uid, limit=_LIFETIME_PAGE, offset=page * _LIFETIME_PAGE)
            for t in txns:
                amt = int(getattr(t, "amount", 0) or 0)
                if amt > 0:
                    granted += amt
                elif amt < 0:
                    consumed += -amt
            if len(txns) < _LIFETIME_PAGE:
                break
        else:
            capped = True   # hit the page cap without exhausting the ledger
    except Exception:  # pragma: no cover — lifetime is best-effort
        capped = True

    # Starter-grant availability signal for a NEUTRAL UI message (never a fake
    # balance). True only when the abuse layer is ENFORCING and withheld the
    # promotional grant (no grant recorded) AND the account currently has no
    # credits — so a paying customer is never flagged.
    starter_denied = False
    try:
        if balance <= 0:
            from backend.services.auth import starter_abuse
            starter_denied = bool(starter_abuse.was_denied(uid))
    except Exception:  # pragma: no cover — advisory only
        starter_denied = False

    return {
        "enabled": True,
        "balance": max(0, balance),
        "lifetime_granted": granted,
        "lifetime_consumed": consumed,
        "lifetime_capped": capped,
        "starter_denied": starter_denied,
    }


__all__ = [
    "STARTER_CREDITS", "STARTER_REASON",
    "ensure_starter_grant", "InsufficientCreditsError", "spend_credits",
    "credit_summary",
]
