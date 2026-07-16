# coding: utf-8
"""
Phase 14L.1 — Founder-Beta AI usage & spend protection.

Server-enforced launch safeguards for the Limited Founder Beta: per-user daily
operation quotas, a per-user concurrency lock, a global daily AI spend guard, a
global AI kill switch, an idempotency/duplicate-call guard, bounded-retry-safe
operation records, short-window rate limiting and a founder-beta entitlement
foundation — all BEFORE any provider/model call, all backend-owned.

Public surface (import from this package):

    from backend.services.ai_guard import service, policy
    pf = service.preflight(user_id=..., operation_type=..., role=..., message=..., idempotency_key=...)

Nothing here calls a model, a provider or a payment system.
"""
from backend.services.ai_guard import policy, service, store  # noqa: F401

__all__ = ["policy", "service", "store"]
