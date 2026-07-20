# coding: utf-8
"""
Billing processor — dynamic configuration accessors (PR 2).

Read on every call so a Railway env flip is live without a restart (same
convention as backend.services.billing.config). Canonical documentation for
each variable lives on backend.core.config.Config.

The processor is gated SEPARATELY from ingestion: ENABLE_BILLING governs
whether deliveries are accepted + stored (PR 1); ENABLE_BILLING_PROCESSOR
governs whether stored events are consumed (PR 2). With the processor off,
events simply accumulate as `stored` and can be drained later once it is
enabled — nothing is lost.
"""
from __future__ import annotations

import os

_DEFAULT_MAX_ATTEMPTS = 5
_DEFAULT_DRAIN_LIMIT = 100
_DEFAULT_STALE_SECONDS = 900  # 15 minutes


def is_enabled() -> bool:
    """Master gate for the consumer. Default OFF — stored events accumulate
    untouched until this is flipped on."""
    return os.getenv("ENABLE_BILLING_PROCESSOR", "false").strip().lower() == "true"


def process_inline() -> bool:
    """When true, a freshly-ingested delivery is processed best-effort inline
    right after it is durably stored (low latency, no worker needed). When
    false, events are only processed by an explicit drain. Default ON — but
    only takes effect when the processor itself is enabled."""
    return os.getenv("BILLING_PROCESS_INLINE", "true").strip().lower() == "true"


def _positive_int(env_key: str, default: int) -> int:
    raw = os.getenv(env_key, "")
    try:
        val = int(raw) if raw.strip() else default
    except (TypeError, ValueError):
        return default
    return val if val > 0 else default


def max_attempts() -> int:
    """Total processing attempts before an event is dead-lettered. The atomic
    claim increments attempts; once attempts >= this cap the event is no
    longer picked up by the reprocessable queue."""
    return _positive_int("BILLING_MAX_PROCESSING_ATTEMPTS", _DEFAULT_MAX_ATTEMPTS)


def drain_batch_limit() -> int:
    """Upper bound on how many events one drain pass will process."""
    return _positive_int("BILLING_DRAIN_BATCH_LIMIT", _DEFAULT_DRAIN_LIMIT)


def stale_processing_seconds() -> int:
    """Age after which an event stuck in `processing` (crashed worker) is
    reclaimed back to the reprocessable queue."""
    return _positive_int("BILLING_PROCESSING_STALE_SECONDS", _DEFAULT_STALE_SECONDS)


__all__ = [
    "is_enabled", "process_inline", "max_attempts",
    "drain_batch_limit", "stale_processing_seconds",
]
