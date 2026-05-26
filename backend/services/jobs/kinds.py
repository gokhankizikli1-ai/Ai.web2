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
)


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


__all__ = ["public_kinds", "is_public_kind",
           "echo", "sleep_progress", "memory_consolidation_stub"]
