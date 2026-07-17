# coding: utf-8
"""
Cost tracker — the public, server-side API every call site uses.

This is the ONLY module callers import. It:

  • mints build_ids (task #1) and per-call ids,
  • turns server-reported usage into a CostBreakdown via the centralized
    pricing table (task #5) and persists an immutable call record
    (task #2, #3, #4),
  • never trusts a client-supplied token value (task #8) — callers pass
    usage they read from the provider response only,
  • flags usage_missing instead of estimating zero (task #9),
  • exposes build aggregates (task #6) and admin analytics (task #7).

Every public function is best-effort and NEVER raises into the request
path — a tracking failure must never break a build. Errors are logged
and swallowed; the reply is unaffected.

Time is UTC. build_id defaults to a uuid4 but callers SHOULD pass the
Web Build family's stable operation id (from ai_guard) so planning,
repairs, code-gen, research and image calls of ONE build share a
build_id automatically.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from backend.services.cost_tracking import pricing, store
from backend.services.cost_tracking.types import (
    OP_OTHER, OP_STALE_RECOVERY, TokenUsage,
)

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _bounded(v: Optional[str], limit: int) -> Optional[str]:
    """Clamp a diagnostic string to a hard length so a record can never carry an
    unbounded blob. Callers pass ALREADY-sanitized values (no prompts/secrets)."""
    if v is None:
        return None
    s = str(v)
    return s[:limit] if s else None


def new_build_id() -> str:
    """Mint a fresh build id (task #1). Callers with a stable per-build
    key (ai_guard operation id) should pass that instead so continuations
    group correctly."""
    return "build_" + uuid.uuid4().hex[:20]


def _new_call_id() -> str:
    return "call_" + uuid.uuid4().hex[:20]


# ── Build lifecycle ──────────────────────────────────────────────────────────
def start_build(*, user_id: str, build_id: Optional[str] = None,
                label: Optional[str] = None,
                meta: Optional[Dict[str, Any]] = None) -> str:
    """Open (or re-open idempotently) a build and return its id."""
    bid = (build_id or new_build_id()).strip()
    try:
        store.upsert_build(build_id=bid, user_id=str(user_id),
                           started_at=_now_iso(), label=label, meta=meta)
    except Exception as exc:  # never break the request path
        logger.warning("cost_tracking.start_build failed (non-fatal): %s", exc)
    return bid


def complete_build(*, build_id: str, status: str = "completed") -> None:
    try:
        store.complete_build(build_id=str(build_id), status=str(status),
                             completed_at=_now_iso())
    except Exception as exc:
        logger.debug("cost_tracking.complete_build skipped: %s", exc)


def build_exists(build_id: str) -> bool:
    try:
        return store.build_exists(str(build_id))
    except Exception:
        return False


# ── Background job → build correlation ───────────────────────────────────────
def link_background_job(*, job_id: str, build_id: str, user_id: str) -> None:
    """Record that an opaque background frontend job belongs to `build_id`, so
    its TERMINAL result (which arrives on a separate poll request) is recorded
    against the right build. Best-effort; never raises."""
    if not job_id or not build_id:
        return
    try:
        store.link_job(job_id=str(job_id), build_id=str(build_id),
                       user_id=str(user_id), created_at=_now_iso())
    except Exception as exc:
        logger.debug("cost_tracking.link_background_job skipped: %s", exc)


def build_id_for_job(job_id: str) -> Optional[Dict[str, Any]]:
    """Return {'build_id','user_id'} for a linked background job, or None."""
    if not job_id:
        return None
    try:
        return store.build_id_for_job(str(job_id))
    except Exception:
        return None


def link_operation(*, op_key: str, build_id: str, user_id: str) -> None:
    """Associate a stable client operation key with its build so a later EARLY
    terminal failure (e.g. a blocked frontend-generation preflight) can resolve
    and finalize the right build. Best-effort; never raises."""
    if not op_key or not build_id:
        return
    try:
        store.link_operation(op_key=str(op_key), build_id=str(build_id),
                             user_id=str(user_id), created_at=_now_iso())
    except Exception as exc:
        logger.debug("cost_tracking.link_operation skipped: %s", exc)


def build_id_for_operation(op_key: str, user_id: str) -> Optional[str]:
    """Resolve a build_id from a client op key, validated against the owning user."""
    if not op_key:
        return None
    try:
        return store.build_id_for_operation(str(op_key), str(user_id))
    except Exception:
        return None


def early_terminal_failure(
    *, build_id: str, user_id: str, operation_type: str, error_kind: Optional[str] = None,
    error_code: Optional[str] = None, error_message: Optional[str] = None,
    provider: str = "none", model: str = "", request_id: Optional[str] = None,
    stage: Optional[str] = None,
) -> bool:
    """Record ONE bounded FAILED call and mark the build failed — but only if the
    build is still running (idempotent: repeated blocks for the same build do not
    duplicate the row). Used when a Web Build hits a terminal failure BEFORE
    background frontend generation starts (e.g. an ai_guard capacity/credit block).
    No usage → usage_missing (never estimated zero). Never raises. Returns True
    iff it finalized the build."""
    try:
        # Only the first terminal-before-generation finalizes + records.
        if not store.finalize_build_if_running(
            build_id=str(build_id), status="failed", completed_at=_now_iso()
        ):
            return False
        record_ai_call(
            build_id=str(build_id), user_id=str(user_id),
            provider=str(provider or "none"), model=str(model or ""),
            operation_type=str(operation_type),
            usage=None,  # → usage_missing=True (no provider call was made)
            success=False,
            error_kind=error_kind, error_code=error_code, error_message=error_message,
            request_id=request_id, ensure_build=False,
        )
        return True
    except Exception as exc:
        logger.warning("cost_tracking.early_terminal_failure failed: %s", exc)
        return False


# ── Stale-build recovery (owner reaper) ──────────────────────────────────────
def _age_minutes(started_at: Optional[str]) -> Optional[float]:
    if not started_at:
        return None
    try:
        t = datetime.fromisoformat(str(started_at).replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        return max(0.0, round((datetime.now(timezone.utc) - t).total_seconds() / 60.0, 2))
    except Exception:
        return None


def scan_stale_running_builds(*, older_than_minutes: int, limit: int,
                              build_ids: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Cost-side candidates: builds still in_progress AND started older than the
    threshold. Read-only. Returns [{build_id, user_id, started_at, age_minutes,
    label, job_link}]. The route enriches each with ai_guard operation state."""
    try:
        rows = store.list_running_builds(limit=max(1, int(limit)) * 4, build_ids=build_ids)
    except Exception as exc:
        logger.warning("cost_tracking.scan_stale skipped: %s", exc)
        return []
    out: List[Dict[str, Any]] = []
    for r in rows:
        age = _age_minutes(r.get("started_at"))
        if age is None or age < float(older_than_minutes):
            continue
        job = None
        try:
            job = store.job_link_for_build(r["build_id"])
        except Exception:
            job = None
        out.append({
            "build_id": r["build_id"], "user_id": r.get("user_id"),
            "started_at": r.get("started_at"), "age_minutes": age,
            "label": (r.get("label") or None),
            "job_id": (job or {}).get("job_id") if job else None,
        })
        if len(out) >= int(limit):
            break
    return out


def reap_stale_build_cost(*, build_id: str, user_id: str) -> Dict[str, Any]:
    """Finalize a stale cost build as failed and record ONE bounded
    web_build_stale_recovery diagnostic — but ONLY if the build was still running
    (atomic finalize-if-running gate → idempotent; a re-run or an already-terminal
    build changes nothing and records no duplicate). No provider call, no fake
    usage/cost. Returns {cost_finalized, diagnostic_recorded}."""
    try:
        if not store.finalize_build_if_running(
            build_id=str(build_id), status="failed", completed_at=_now_iso()
        ):
            return {"cost_finalized": False, "diagnostic_recorded": False, "reason": "already_terminal"}
        recorded = False
        if not store.has_operation_call(str(build_id), OP_STALE_RECOVERY):
            record_ai_call(
                build_id=str(build_id), user_id=str(user_id),
                provider="none", model="", operation_type=OP_STALE_RECOVERY,
                usage=None,  # → usage_missing=True (no provider work happened)
                success=False, error_kind="stale_build_reaped",
                error_code="STALE_BUILD_REAPED",
                error_message="Stale build closed by owner recovery after exceeding the staleness threshold.",
                ensure_build=False,
            )
            recorded = True
        return {"cost_finalized": True, "diagnostic_recorded": recorded}
    except Exception as exc:
        logger.warning("cost_tracking.reap_stale_build_cost failed: %s", exc)
        return {"cost_finalized": False, "diagnostic_recorded": False, "reason": "error"}


def claim_terminal_once(job_id: str) -> bool:
    """Atomically claim the single terminal recording for a background job so
    repeated polls (or a poll racing a cancel) never double-record. Returns True
    iff this caller won the claim. Fail-CLOSED on error (returns False) so a
    tracker/store fault can never cause a duplicate row."""
    if not job_id:
        return False
    try:
        return store.claim_job_terminal(str(job_id), _now_iso())
    except Exception as exc:
        logger.warning("cost_tracking.claim_terminal_once failed (skipping record): %s", exc)
        return False


# ── Recording paid calls ─────────────────────────────────────────────────────
def record_ai_call(
    *,
    build_id:       str,
    user_id:        str,
    provider:       str,
    model:          str,
    operation_type: str,
    usage:          Optional[TokenUsage] = None,
    success:        bool = True,
    retry_number:   int = 0,
    request_started_at:   Optional[str] = None,
    request_completed_at: Optional[str] = None,
    additional_tool_cost_usd: float = 0.0,
    error_code:     Optional[str] = None,
    error_kind:     Optional[str] = None,
    error_message:  Optional[str] = None,
    request_id:     Optional[str] = None,
    duration_ms:    int = 0,
    ensure_build:   bool = True,
) -> Optional[str]:
    """Record one token-bearing provider call. Returns the call_id (or
    None on failure). `usage` MUST come from the provider response; when
    the provider returned no usage object, pass a TokenUsage with
    usage_missing=True (task #9) — do NOT pass zeros as if they were real.
    """
    try:
        u = usage or TokenUsage(usage_missing=True)
        breakdown = pricing.compute_call_cost(
            provider=provider,
            model=model,
            input_tokens=u.input_tokens,
            output_tokens=u.output_tokens,
            cached_input_tokens=u.cached_input_tokens,
            cache_creation_tokens=u.cache_creation_tokens,
            reasoning_tokens=u.reasoning_tokens,
            additional_tool_cost_usd=additional_tool_cost_usd,
            usage_missing=u.usage_missing,
        )
        # Timestamps (task #2). If the caller gave only a latency, derive the
        # start from completed - duration so both endpoints are stored honestly.
        completed = request_completed_at or _now_iso()
        started = request_started_at
        if started is None and duration_ms and duration_ms > 0:
            try:
                started = (datetime.fromisoformat(completed.replace("Z", "+00:00"))
                           - timedelta(milliseconds=int(duration_ms))).isoformat()
            except Exception:
                started = completed
        started = started or completed
        if ensure_build:
            store.upsert_build(build_id=str(build_id), user_id=str(user_id),
                               started_at=started)
        call_id = _new_call_id()
        record = {
            "call_id": call_id,
            "build_id": str(build_id),
            "user_id": str(user_id),
            "provider": str(provider or ""),
            "model": str(model or ""),
            "operation_type": str(operation_type or OP_OTHER),
            "request_started_at": started,
            "request_completed_at": completed,
            "success": bool(success),
            "retry_number": int(retry_number or 0),
            "input_tokens": int(u.input_tokens or 0),
            "output_tokens": int(u.output_tokens or 0),
            "cached_input_tokens": int(u.cached_input_tokens or 0),
            "cache_creation_tokens": int(u.cache_creation_tokens or 0),
            "reasoning_tokens": int(u.reasoning_tokens or 0),
            "total_tokens": int(u.normalized_total()),
            "usage_missing": bool(u.usage_missing),
            "input_cost_usd": breakdown.input_cost_usd,
            "output_cost_usd": breakdown.output_cost_usd,
            "cache_cost_usd": breakdown.cache_cost_usd,
            "additional_tool_cost_usd": breakdown.additional_tool_cost_usd,
            "total_call_cost_usd": breakdown.total_call_cost_usd,
            "error_code": _bounded(error_code, 64),
            "error_kind": _bounded(error_kind, 64),
            "error_message": _bounded(error_message, 300),
            "request_id": _bounded(request_id, 64),
            "tool_key": None,
            "tool_units": 0.0,
            "duration_ms": int(duration_ms or 0),
            "created_at": _now_iso(),
        }
        store.insert_call(record)
        return call_id
    except Exception as exc:
        logger.warning("cost_tracking.record_ai_call failed (non-fatal): %s", exc)
        return None


def record_tool_cost(
    *,
    build_id:       str,
    user_id:        str,
    tool_key:       str,
    units:          float = 1.0,
    provider:       str = "",
    operation_type: Optional[str] = None,
    success:        bool = True,
    retry_number:   int = 0,
    request_started_at:   Optional[str] = None,
    request_completed_at: Optional[str] = None,
    error_code:     Optional[str] = None,
    ensure_build:   bool = True,
) -> Optional[str]:
    """Record a non-token paid call: image generation, web search,
    embeddings-by-call, a third-party API, or deployment/sandbox
    execution (task #4). Cost is priced from the centralized tool table.
    """
    try:
        usd, matched = pricing.compute_tool_cost(tool_key, units)
        if ensure_build:
            store.upsert_build(build_id=str(build_id), user_id=str(user_id),
                               started_at=request_started_at or _now_iso())
        call_id = _new_call_id()
        record = {
            "call_id": call_id,
            "build_id": str(build_id),
            "user_id": str(user_id),
            "provider": str(provider or ""),
            "model": "",
            "operation_type": str(operation_type or tool_key.split(".", 1)[0] or "tool"),
            "request_started_at": request_started_at or _now_iso(),
            "request_completed_at": request_completed_at or _now_iso(),
            "success": bool(success),
            "retry_number": int(retry_number or 0),
            "input_tokens": 0, "output_tokens": 0, "cached_input_tokens": 0,
            "cache_creation_tokens": 0, "reasoning_tokens": 0, "total_tokens": 0,
            "usage_missing": False,   # a non-token call has no token usage to miss
            "input_cost_usd": 0.0, "output_cost_usd": 0.0, "cache_cost_usd": 0.0,
            "additional_tool_cost_usd": usd,
            "total_call_cost_usd": usd,
            "error_code": error_code,
            "tool_key": str(tool_key),
            "tool_units": float(units or 0.0),
            "duration_ms": 0,
            "created_at": _now_iso(),
        }
        store.insert_call(record)
        return call_id
    except Exception as exc:
        logger.warning("cost_tracking.record_tool_cost failed (non-fatal): %s", exc)
        return None


# ── Reads: build aggregate (task #6) ─────────────────────────────────────────
def get_build(build_id: str) -> Dict[str, Any]:
    """Full build view: lifecycle metadata + computed aggregate + calls."""
    row = store.get_build_row(build_id) or {}
    agg = store.aggregate_build(build_id)
    duration = store._duration_seconds(row.get("started_at"), row.get("completed_at"))
    return {
        "build_id": build_id,
        "user_id": row.get("user_id"),
        "status": row.get("status", "in_progress"),
        "started_at": row.get("started_at"),
        "completed_at": row.get("completed_at"),
        "build_duration_seconds": duration,
        **agg,
        "calls": store.list_calls(build_id),
    }


def list_builds(limit: int = 100, offset: int = 0,
                user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    return store.list_builds(limit=limit, offset=offset, user_id=user_id)


# ── Reads: analytics (task #7) ───────────────────────────────────────────────
def _percentile(sorted_vals: List[float], pct: float) -> float:
    """Linear-interpolation percentile (pct in [0,100]). Matches the
    common 'inclusive' definition used by numpy's default."""
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return round(sorted_vals[0], 6)
    k = (len(sorted_vals) - 1) * (pct / 100.0)
    lo = int(k)
    hi = min(lo + 1, len(sorted_vals) - 1)
    frac = k - lo
    return round(sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * frac, 6)


def _median(sorted_vals: List[float]) -> float:
    if not sorted_vals:
        return 0.0
    n = len(sorted_vals)
    mid = n // 2
    if n % 2 == 1:
        return round(sorted_vals[mid], 6)
    return round((sorted_vals[mid - 1] + sorted_vals[mid]) / 2.0, 6)


def analytics(user_id: Optional[str] = None) -> Dict[str, Any]:
    """Everything the admin dashboard needs (task #7)."""
    totals = sorted(store.per_build_totals(user_id=user_id))
    count = len(totals)
    avg = round(sum(totals) / count, 6) if count else 0.0
    ext = store.cheapest_and_most_expensive(user_id=user_id)
    return {
        "build_count": count,
        "total_cost_usd": round(sum(totals), 6),
        "average_build_cost_usd": avg,
        "median_build_cost_usd": _median(totals),
        "p90_build_cost_usd": _percentile(totals, 90),
        "p95_build_cost_usd": _percentile(totals, 95),
        "cheapest_build": ext.get("cheapest"),
        "most_expensive_build": ext.get("most_expensive"),
        "token_usage_by_model": store.usage_by_model(),
        "cost_by_operation_type": store.cost_by_operation(),
        "retry_costs": store.retry_cost_total(),
        "pricing": pricing.pricing_snapshot(),
    }


__all__ = [
    "new_build_id", "start_build", "complete_build",
    "record_ai_call", "record_tool_cost",
    "get_build", "list_builds", "analytics",
]
