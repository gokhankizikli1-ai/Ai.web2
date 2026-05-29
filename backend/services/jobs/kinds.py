# coding: utf-8
"""
Phase 7 — First job kinds.

Three safe, self-contained handlers that prove the runtime works
end-to-end:

  echo                  — returns the payload verbatim. Useful for
                          smoke tests + frontend integration.
  sleep_progress        — sleeps in N small steps, reporting progress
                          0..100. Exercises the SSE stream + cancel.
  memory_consolidation_stub
                        — placeholder for Phase 8's real memory
                          consolidation job. Reads `payload.user_id`
                          + Memory Plane stats, returns counts. Does
                          NOT modify any memory (safe-by-default).

Adding more kinds is one decorator. To keep deploys safe, only
allowlist kinds you've reviewed in `_PUBLIC_KINDS`. The API uses
this allowlist to reject arbitrary kind names from the body.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

from backend.services.jobs.decorators import korvix_task
from backend.services.jobs.registry import JobContext


logger = logging.getLogger(__name__)


# ── Allowlist ────────────────────────────────────────────────────────────────
#
# Kinds the public API will accept. The registry can hold more (e.g.
# internal / admin-only kinds); only entries here are visible to
# /v2/jobs POST callers.

_PUBLIC_KINDS: tuple[str, ...] = (
    "echo",
    "sleep_progress",
    "memory_consolidation_stub",
    # Phase 7 slice 3 — handler ports
    "vision.analyze",
    "research.deep",
)


# Phase 7 slice 3 — per-handler env gates so a single misbehaving
# handler can be rolled back without disabling all of Celery. Read
# dynamically on every invocation so a Railway env flip is live without
# restarting the worker.
def _kind_enabled(env_name: str) -> bool:
    import os
    return os.getenv(env_name, "false").strip().lower() == "true"


def public_kinds() -> tuple[str, ...]:
    return _PUBLIC_KINDS


def is_public_kind(kind: str) -> bool:
    return (kind or "").strip().lower() in _PUBLIC_KINDS


# ── echo ─────────────────────────────────────────────────────────────────────

@korvix_task("echo")
async def echo(ctx: JobContext) -> dict:
    """Return the payload verbatim. Smallest possible handler — used
    to verify the create / status / SSE round-trip without external
    dependencies."""
    await ctx.report_progress(50, "echoing")
    return {
        "echo":    ctx.record.payload,
        "user_id": ctx.record.user_id,
        "kind":    ctx.record.kind,
    }


# ── sleep_progress ───────────────────────────────────────────────────────────

@korvix_task("sleep_progress")
async def sleep_progress(ctx: JobContext) -> dict:
    """Sleep in N steps and report progress on each. Verifies the SSE
    stream pushes intermediate updates and that cancellation is
    observed mid-flight.

    Payload:
      steps:        int  — number of progress ticks (default 5)
      step_delay_s: float — seconds between ticks (default 0.2)
      label:        str  — optional progress label
    """
    payload = ctx.record.payload or {}
    steps = int(payload.get("steps", 5))
    delay = float(payload.get("step_delay_s", 0.2))
    label = str(payload.get("label", "sleeping"))

    steps = max(1, min(50, steps))
    delay = max(0.0, min(2.0, delay))

    for i in range(steps):
        if await ctx.is_cancelled():
            return {"completed_steps": i, "cancelled_mid_flight": True}
        pct = int(round((i + 1) * 100 / steps))
        await ctx.report_progress(pct, f"{label} {i+1}/{steps}")
        await asyncio.sleep(delay)
    return {
        "completed_steps": steps,
        "total_delay_s":   round(steps * delay, 3),
    }


# ── memory_consolidation_stub ────────────────────────────────────────────────

@korvix_task("memory_consolidation_stub")
async def memory_consolidation_stub(ctx: JobContext) -> dict:
    """Placeholder for the Phase 8 memory consolidation job.

    Reads Memory Plane counts for the calling user; reports a
    "would consolidate N memories" summary. Does NOT modify any
    memory — explicit non-destructive design so this kind is safe
    to run unattended in production.

    Real consolidation lands in Phase 8.
    """
    user_id = str(ctx.record.user_id)

    await ctx.report_progress(10, "reading memory plane stats")
    try:
        from backend.services.memory_plane import client as mp_client
        mp_items = mp_client.list_user(user_id, limit=200)
    except Exception:
        mp_items = []

    await ctx.report_progress(50, "analysing")

    # Group by kind (no writes; pure read).
    by_kind: dict[str, int] = {}
    for it in mp_items:
        by_kind[it.kind] = by_kind.get(it.kind, 0) + 1

    await ctx.report_progress(90, "summarising")
    await asyncio.sleep(0.05)
    return {
        "user_id":           user_id,
        "total_memories":    len(mp_items),
        "by_kind":           by_kind,
        "would_consolidate": 0,    # stub — real logic in Phase 8
        "note":              "Phase 7 stub: no memories were modified.",
    }


# ── vision.analyze ───────────────────────────────────────────────────────────

@korvix_task("vision.analyze")
async def vision_analyze(ctx: JobContext) -> dict:
    """Phase 7 slice 3 — port of the vision pipeline to the job queue.

    Payload:
      asset_id: str  — required. Asset to analyze.
      force:    bool — re-analyze even when a cached result exists.
      user_id:  str  — ownership check; defaults to record.user_id.

    Routes via per-kind queue mapping to korvix.vision. Behind a
    `JOB_QUEUE_VISION=true` gate so a single bad ship doesn't block
    other Celery work.

    Progress checkpoints:
       5%  validating asset
      20%  loaded record
      40%  running analyzer
      90%  persisting result
     100%  done

    Cancellation: handler polls `ctx.is_cancelled()` between phases.
    A late cancel during the analyzer call doesn't interrupt the
    OpenAI request — that one's atomic — but stops us before we
    persist the result so the row reflects the cancellation.
    """
    if not _kind_enabled("JOB_QUEUE_VISION"):
        return {
            "skipped": True,
            "reason":  "JOB_QUEUE_VISION disabled",
        }

    payload  = ctx.record.payload or {}
    asset_id = str(payload.get("asset_id") or "").strip()
    if not asset_id:
        raise ValueError("vision.analyze: payload.asset_id is required")
    user_id  = str(payload.get("user_id") or ctx.record.user_id or "").strip()
    force    = bool(payload.get("force", False))

    await ctx.report_progress(5, "validating asset")
    if await ctx.is_cancelled():
        return {"cancelled_mid_flight": True}

    from backend.services.vision import client as vision_client
    from backend.services.assets import client as assets_client

    asset = assets_client.get(asset_id, user_id=user_id or None)
    if asset is None:
        raise ValueError(f"vision.analyze: asset {asset_id} not found")

    await ctx.report_progress(20, "asset loaded")
    if await ctx.is_cancelled():
        return {"cancelled_mid_flight": True}

    await ctx.report_progress(40, "running vision analyzer")
    # The analyzer call is sync today — run in a thread so we don't
    # block the worker's event loop.
    result = await asyncio.to_thread(
        vision_client.VisionClient().analyze,
        asset_id, user_id=user_id or None, force=force,
    )

    if await ctx.is_cancelled():
        return {"cancelled_mid_flight": True, "analyzer_completed": True}

    if result is None:
        # Analyzer returned None — either disabled or asset unsuitable.
        raise RuntimeError(
            "vision.analyze: analyzer returned no result "
            "(check ENABLE_VISION_PIPELINE)"
        )

    await ctx.report_progress(90, "persisting result")
    # vision_client.analyze already persists via store.upsert; nothing
    # more to do here. The 100% tick fires from the dispatcher after
    # this handler returns.

    return {
        "asset_id":  asset_id,
        "kind":      result.kind,
        "summary":   (result.summary or "")[:500],
        "tokens":    getattr(result, "tokens", None),
        "created_at": result.created_at,
    }


# ── research.deep ────────────────────────────────────────────────────────────

@korvix_task("research.deep")
async def research_deep(ctx: JobContext) -> dict:
    """Phase 7 slice 3 — long-form web research as a job.

    Replaces the inline path that watchdogs after 30s idle / 90s
    total. Backed by the existing Tavily→Exa→Brave provider cascade
    (Phase 11 — #143). Routes to korvix.research.

    Payload:
      query:       str  — required. Natural-language research query.
      max_results: int  — citations to return (1-10, default 5)
      depth:       str  — "basic" | "advanced" (default "basic")
      include_domains: list[str] | None
      exclude_domains: list[str] | None

    Behind `JOB_QUEUE_RESEARCH=true`.

    Progress:
       5%  validating query
      20%  dispatching to research client
      80%  results received
     100%  done
    """
    if not _kind_enabled("JOB_QUEUE_RESEARCH"):
        return {
            "skipped": True,
            "reason":  "JOB_QUEUE_RESEARCH disabled",
        }

    payload = ctx.record.payload or {}
    query   = str(payload.get("query") or "").strip()
    if not query:
        raise ValueError("research.deep: payload.query is required")

    max_results = max(1, min(10, int(payload.get("max_results", 5))))
    depth       = "advanced" if str(payload.get("depth", "")).lower() == "advanced" else "basic"
    include     = payload.get("include_domains") or None
    exclude     = payload.get("exclude_domains") or None

    await ctx.report_progress(5, "validating query")
    if await ctx.is_cancelled():
        return {"cancelled_mid_flight": True}

    from backend.services.research import client as research_client

    await ctx.report_progress(20, "dispatching providers")
    result = await research_client.search(
        query,
        max_results=    max_results,
        depth=          depth,
        include_domains=include,
        exclude_domains=exclude,
    )

    if await ctx.is_cancelled():
        return {"cancelled_mid_flight": True, "provider_completed": True}

    await ctx.report_progress(80, "results received")

    if result.error:
        # Bubble the error so Celery's retry kicks in for transient
        # provider issues (timeout / rate_limit). DLQ ships in slice 4.
        raise RuntimeError(f"research.deep: {result.error}")

    return {
        "query":      result.query,
        "answer":     result.answer,
        "citations":  [c.to_dict() for c in result.citations],
        "count":      len(result.citations),
        "provider":   result.provider,
        "cached":     result.cached,
        "elapsed_ms": result.elapsed_ms,
    }


__all__ = ["public_kinds", "is_public_kind",
           "echo", "sleep_progress", "memory_consolidation_stub",
           "vision_analyze", "research_deep"]
