# coding: utf-8
"""
Billing processor — the consumption engine (PR 2).

Consumes durably-stored webhook events (PR 1 inbox) and routes them to typed
handlers, with concurrency-safe claiming, retry, dead-lettering and stale
reclaim. Builds strictly ON TOP of the PR-1 store contract — it adds no
tables and changes no PR-1 behaviour.

Guarantees:
  * At-most-one CONCURRENT processing per event — `store.claim_for_processing`
    is an atomic conditional transition; the loser of a race gets None.
  * At-least-once overall — a handler that raises marks the event `failed`,
    which re-enters the reprocessable queue until the attempt cap, then
    dead-letters (stays `failed`, no longer claimed).
  * Crash-safe — an event stuck in `processing` (worker died mid-handle) is
    reclaimed back to the queue after a staleness threshold.

Two entry points:
  * process_after_ingest(event_id) — best-effort inline processing right after
    a fresh delivery is stored (called from the webhook path; never raises).
  * drain(limit) — batch processing of the reprocessable backlog (called from
    the owner endpoint / a future scheduled worker).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, Optional

from backend.utils.safe_json import safe_parse
from backend.services.billing import store
from backend.services.billing.processor import config as proc_config
from backend.services.billing.processor import registry


logger = logging.getLogger(__name__)


# Outcomes of a single process attempt.
OUTCOME_PROCESSED = "processed"      # handler ran (or no-handler ack) OK
OUTCOME_FAILED = "failed"            # handler raised; will retry until cap
OUTCOME_NO_HANDLER = "no_handler"    # acknowledged, nothing registered
OUTCOME_SKIPPED = "skipped"          # not claimable (race / terminal / dead)
OUTCOME_DISABLED = "disabled"        # processor is off


@dataclass(frozen=True)
class ProcessResult:
    event_id: str
    outcome: str
    event_name: str = ""
    error: Optional[str] = None


def process_event(event_id: str) -> ProcessResult:
    """Claim and process a single event by id.

    Safe to call concurrently for the same id — only one caller wins the
    atomic claim; the rest return OUTCOME_SKIPPED. Never raises: a handler
    exception is captured and recorded as `failed`.
    """
    if not proc_config.is_enabled():
        return ProcessResult(event_id, OUTCOME_DISABLED)
    if not event_id:
        return ProcessResult(event_id, OUTCOME_SKIPPED)

    # Atomic claim (stored/failed + under cap → processing, attempts++).
    event = store.claim_for_processing(event_id, max_attempts=proc_config.max_attempts())
    if event is None:
        # Already processed, being processed elsewhere, or dead-lettered.
        return ProcessResult(event_id, OUTCOME_SKIPPED)

    event_name = event.event_name or ""
    handler = registry.get_handler(event_name)

    if handler is None:
        # Durably stored in PR 1; nothing registered to act on it. Acknowledge
        # so it doesn't sit in the queue forever. A future PR that adds a
        # handler can replay it via the owner retry endpoint.
        store.mark_processed(event_id)
        logger.info(
            "billing.processor no handler for event=%s id=%s — acknowledged",
            event_name or "(unknown)", event_id,
        )
        return ProcessResult(event_id, OUTCOME_NO_HANDLER, event_name)

    # Parse the verified raw payload for the handler (never raises).
    payload = safe_parse(event.payload_json, fallback={})

    try:
        handler(event, payload)
    except Exception as exc:  # handler-signalled failure — retry until the cap
        msg = f"{type(exc).__name__}: {exc}"
        store.mark_failed(event_id, msg)
        logger.warning(
            "billing.processor handler failed | event=%s id=%s attempt=%d: %s",
            event_name or "(unknown)", event_id, event.attempts, msg,
        )
        return ProcessResult(event_id, OUTCOME_FAILED, event_name, msg)

    store.mark_processed(event_id)
    return ProcessResult(event_id, OUTCOME_PROCESSED, event_name)


def process_after_ingest(event_id: str) -> None:
    """Best-effort inline processing hook, called right after a NEW delivery is
    stored. Fully guarded: does nothing when the processor or inline mode is
    off, and never raises into the webhook request path (a processing failure
    must not turn a durably-stored 200 into a 5xx — the drain will retry it)."""
    try:
        if not (proc_config.is_enabled() and proc_config.process_inline()):
            return
        process_event(event_id)
    except Exception as exc:  # pragma: no cover — inline path must never raise
        logger.warning("billing.processor inline processing failed (non-fatal): %s", exc)


def retry_event(event_id: str) -> ProcessResult:
    """Owner-initiated replay of a single delivery. Force-requeues the event
    (resets status→stored + attempts→0, even if it was already processed or
    dead-lettered) and processes it immediately. Returns the process result.

    Returns OUTCOME_DISABLED when the processor is off, or OUTCOME_SKIPPED
    when the event id is unknown."""
    if not proc_config.is_enabled():
        return ProcessResult(event_id, OUTCOME_DISABLED)
    if not event_id or not store.requeue(event_id):
        return ProcessResult(event_id, OUTCOME_SKIPPED)
    logger.info("billing.processor retry requested | id=%s", event_id)
    return process_event(event_id)


def drain(*, limit: Optional[int] = None) -> Dict[str, Any]:
    """Process a batch of the reprocessable backlog.

    Reclaims stale `processing` events first (crashed workers), then processes
    the oldest reprocessable events up to `limit`. Returns a content-free
    summary suitable for an owner endpoint. A no-op summary is returned when
    the processor is disabled."""
    if not proc_config.is_enabled():
        return {"enabled": False, "reclaimed_stale": 0, "claimed": 0,
                "processed": 0, "failed": 0, "no_handler": 0, "skipped": 0}

    max_attempts = proc_config.max_attempts()
    batch = int(limit) if (limit and int(limit) > 0) else proc_config.drain_batch_limit()
    batch = max(1, min(1000, batch))

    reclaimed = store.reclaim_stale_processing(
        older_than_seconds=proc_config.stale_processing_seconds())

    pending = store.list_reprocessable(limit=batch, max_attempts=max_attempts)
    counts = {"processed": 0, "failed": 0, "no_handler": 0, "skipped": 0}
    claimed = 0
    for ev in pending:
        if not ev.id:
            continue
        result = process_event(ev.id)
        if result.outcome == OUTCOME_SKIPPED:
            counts["skipped"] += 1
            continue
        if result.outcome == OUTCOME_DISABLED:
            break
        claimed += 1
        if result.outcome == OUTCOME_PROCESSED:
            counts["processed"] += 1
        elif result.outcome == OUTCOME_FAILED:
            counts["failed"] += 1
        elif result.outcome == OUTCOME_NO_HANDLER:
            counts["no_handler"] += 1

    summary = {
        "enabled": True,
        "reclaimed_stale": reclaimed,
        "candidates": len(pending),
        "claimed": claimed,
        **counts,
    }
    logger.info(
        "billing.processor drain | candidates=%d claimed=%d processed=%d "
        "failed=%d no_handler=%d skipped=%d reclaimed_stale=%d",
        len(pending), claimed, counts["processed"], counts["failed"],
        counts["no_handler"], counts["skipped"], reclaimed,
    )
    return summary


def stats() -> Dict[str, Any]:
    """Processor-view diagnostics: config, registered handlers, and queue
    depth derived from the store. Content-free."""
    max_attempts = proc_config.max_attempts()
    store_stats = store.stats()
    by_status = store_stats.get("by_status", {}) if isinstance(store_stats, dict) else {}
    return {
        "enabled": proc_config.is_enabled(),
        "process_inline": proc_config.process_inline(),
        "max_attempts": max_attempts,
        "drain_batch_limit": proc_config.drain_batch_limit(),
        "stale_processing_seconds": proc_config.stale_processing_seconds(),
        "registered_handlers": registry.registered_event_names(),
        "queue": {
            "stored": int(by_status.get("stored", 0)),
            "processing": int(by_status.get("processing", 0)),
            "processed": int(by_status.get("processed", 0)),
            "failed": int(by_status.get("failed", 0)),
            "dead_letter": store.count_dead_letter(max_attempts=max_attempts),
        },
    }


__all__ = [
    "ProcessResult",
    "OUTCOME_PROCESSED", "OUTCOME_FAILED", "OUTCOME_NO_HANDLER",
    "OUTCOME_SKIPPED", "OUTCOME_DISABLED",
    "process_event", "process_after_ingest", "retry_event", "drain", "stats",
]
