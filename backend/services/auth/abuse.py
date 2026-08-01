# coding: utf-8
"""
Auth abuse controls — registration rate limiting + a clean extension seam.

Scope for THIS PR (deliberately conservative — no fingerprinting, no VPN bans,
no disposable-domain blacklists, no phone verification):

  * A generic in-process sliding-window rate limiter (best-effort; resets on
    redeploy). Good enough as a brake on scripted account farming from a single
    host; a durable/redis-backed limiter can replace the store later without
    touching call sites.
  * `evaluate_registration(email, ip)` — the single decision seam every signup
    path calls. Today it enforces a per-IP hourly cap; it is the place a future
    abuse-risk engine (reputation, velocity, ML score) plugs in, returning the
    same `AbuseDecision` so callers never change.

No raw IP or full email is logged here (IPs are only counted; emails are only
normalised for the per-identity counter).
"""
from __future__ import annotations

import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, List

from backend.core.config import settings

_LOCK = threading.Lock()
# key -> ascending list of hit timestamps within the window.
_REGISTER_HITS: Dict[str, List[datetime]] = {}


@dataclass(frozen=True)
class AbuseDecision:
    allowed: bool
    reason: str = ""          # non-secret: "" | "ip_rate_limited"
    retry_after: int = 0      # seconds until the caller may retry (advisory)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _sliding_allowed(store: Dict[str, List[datetime]], key: str, cap: int, window: timedelta) -> tuple[bool, int]:
    """Record a hit for `key` and report whether it is within `cap` over
    `window`. Returns (allowed, retry_after_seconds). Thread-safe + self-pruning."""
    if not key or cap <= 0:
        return True, 0
    now = _now()
    cutoff = now - window
    with _LOCK:
        hits = [t for t in store.get(key, []) if t > cutoff]
        if len(hits) >= cap:
            store[key] = hits
            retry = int((hits[0] + window - now).total_seconds())
            return False, max(1, retry)
        hits.append(now)
        store[key] = hits
        # Opportunistic global prune so the dict can't grow unbounded.
        if len(store) > 8192:
            for k in [k for k, v in store.items() if not any(t > cutoff for t in v)]:
                store.pop(k, None)
        return True, 0


def evaluate_registration(*, email: str, ip: str | None) -> AbuseDecision:
    """Decide whether a signup attempt may proceed. The single seam every
    registration path calls. Extend here (not at the call sites) for a richer
    abuse engine later."""
    cap = max(0, int(getattr(settings, "AUTH_REGISTER_MAX_PER_IP_HOUR", 10) or 0))
    if not ip or cap <= 0:
        return AbuseDecision(allowed=True)
    allowed, retry = _sliding_allowed(_REGISTER_HITS, f"ip:{ip}", cap, timedelta(hours=1))
    if not allowed:
        return AbuseDecision(allowed=False, reason="ip_rate_limited", retry_after=retry)
    return AbuseDecision(allowed=True)


def _reset_for_tests() -> None:  # pragma: no cover — test hook
    with _LOCK:
        _REGISTER_HITS.clear()


__all__ = ["AbuseDecision", "evaluate_registration"]
