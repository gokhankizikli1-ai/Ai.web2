# coding: utf-8
"""
Web Build cost-attribution & duplicate-call AUDIT (deterministic, read-time).

Given one build's recorded calls (backend.services.cost_tracking.store), this
module produces the owner-facing audit that makes waste obvious: an ordered
cost waterfall, per-stage roll-ups, deterministic duplicate / retry / unused-
output detection, per-call waste flags, a CONSERVATIVE avoidable-cost estimate,
and structured (localizable) recommendations.

Design rules honored here:
  • Deterministic + local ONLY — no AI, no embeddings, no network.
  • Read-time — nothing here runs on the build hot path; it scans a single
    build's rows (bounded) when the owner opens the audit.
  • Privacy — inputs are compared by one-way fingerprint + byte size; this
    module never sees, stores or returns a prompt, generated source or secret.
  • Conservative — the USD waste estimate counts only high-confidence,
    provably-avoidable spend (exact input duplicates + unchanged-input retries).
    Consumption that cannot be PROVEN is "unknown", never "false".

Thresholds are code constants (below) and documented; this PR makes NO pricing
or optimization decision from them — it only measures.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

from backend.services.cost_tracking import store
from backend.services.cost_tracking import types as T

logger = logging.getLogger(__name__)

# ── Audit thresholds (documented; measurement only, never a pricing decision) ─
HIGH_COST_SHARE = 0.20          # a call/stage at ≥20% of build cost is "high cost share"
LARGE_CONTEXT_TOKENS = 20_000   # input ≥ this (or top 10% within build) → large_context
LARGE_OUTPUT_TOKENS = 8_000     # output ≥ this (or top 10% within build) → large_output
LARGE_PERCENTILE = 0.90         # "top 10% within build" band
NEAR_DUP_TOLERANCE = 0.05       # context byte sizes within 5% → near_duplicate_context

# Stages that legitimately run more than once — NOT flagged repeated_stage.
_REPEATABLE_STAGES = {
    T.STAGE_PLANNING_REPAIR, T.STAGE_FRONTEND_REPAIR, T.STAGE_FRONTEND_QUALITY_REPAIR,
    T.STAGE_FRONTEND_VALIDATION, T.STAGE_REVISION, T.STAGE_IMAGE_GENERATION,
    T.STAGE_STOCK_IMAGE_SEARCH, T.STAGE_WEB_RESEARCH, T.STAGE_STALE_RECOVERY,
    T.STAGE_UNKNOWN,
}

# Deterministic output-consumption model: a stage's output is PROVEN consumed
# when at least one of its consumer stages ran LATER in the same build. Absence
# of a later consumer → "unknown" (we never guess "false").
_STAGE_CONSUMERS = {
    T.STAGE_REQUEST_ANALYSIS:   {T.STAGE_WEBSITE_STRATEGY, T.STAGE_WEB_BUILD_PLANNING,
                                 T.STAGE_VISUAL_INTELLIGENCE, T.STAGE_FRONTEND_GENERATION},
    T.STAGE_WEBSITE_STRATEGY:   {T.STAGE_WEB_BUILD_PLANNING, T.STAGE_VISUAL_INTELLIGENCE,
                                 T.STAGE_FRONTEND_GENERATION},
    T.STAGE_WEB_BUILD_PLANNING: {T.STAGE_VISUAL_INTELLIGENCE, T.STAGE_FRONTEND_GENERATION,
                                 T.STAGE_FRONTEND_REPAIR, T.STAGE_PLANNING_REPAIR},
    T.STAGE_PLANNING_REPAIR:    {T.STAGE_VISUAL_INTELLIGENCE, T.STAGE_FRONTEND_GENERATION},
    T.STAGE_VISUAL_INTELLIGENCE:{T.STAGE_FRONTEND_GENERATION, T.STAGE_FRONTEND_REPAIR},
    T.STAGE_WEB_RESEARCH:       {T.STAGE_WEB_BUILD_PLANNING, T.STAGE_VISUAL_INTELLIGENCE,
                                 T.STAGE_FRONTEND_GENERATION},
    T.STAGE_STOCK_IMAGE_SEARCH: {T.STAGE_FRONTEND_GENERATION, T.STAGE_FINALIZATION},
    T.STAGE_IMAGE_GENERATION:   {T.STAGE_FRONTEND_GENERATION, T.STAGE_FINALIZATION},
    T.STAGE_FRONTEND_GENERATION:{T.STAGE_FRONTEND_VALIDATION, T.STAGE_FRONTEND_REPAIR,
                                 T.STAGE_FRONTEND_QUALITY_REPAIR, T.STAGE_FINALIZATION},
    T.STAGE_FRONTEND_REPAIR:    {T.STAGE_FRONTEND_VALIDATION, T.STAGE_FINALIZATION},
    T.STAGE_FRONTEND_QUALITY_REPAIR: {T.STAGE_FINALIZATION},
    T.STAGE_REVISION:           {T.STAGE_FINALIZATION},
}
# Auxiliary producer stages whose output is WASTED if no consumer ever runs.
# Only these can raise `successful_but_unused`, and only with strong evidence
# (build continued to a later frontend_generation without any consumer).
_MUST_BE_CONSUMED = {
    T.STAGE_WEB_RESEARCH, T.STAGE_VISUAL_INTELLIGENCE,
    T.STAGE_IMAGE_GENERATION, T.STAGE_STOCK_IMAGE_SEARCH,
}


def _truthy(v: Any) -> bool:
    return v is True or v == 1


def _f(v: Any) -> float:
    try:
        return float(v or 0.0)
    except Exception:
        return 0.0


def _i(v: Any) -> int:
    try:
        return int(v or 0)
    except Exception:
        return 0


def _norm_call(c: Dict[str, Any]) -> Dict[str, Any]:
    """Project one raw DB row into the canonical audit shape (stage/agent inferred
    for historical rows). No content ever enters this dict."""
    op = c.get("operation_type")
    stored_stage = c.get("stage")
    stage = T.stage_for(op, stored_stage)
    agent = T.agent_for(op, c.get("agent"))
    generic = T.is_generic_label(op, stored_stage)
    return {
        "call_id": c.get("call_id"),
        "sequence_index": (c.get("sequence_index") if c.get("sequence_index") is not None else None),
        "stage": stage,
        "agent": agent,
        "operation_type": op,
        "generic_label": generic,
        "provider": c.get("provider") or "",
        "model": c.get("model") or "",
        "success": _truthy(c.get("success")),
        "retry_number": _i(c.get("retry_number")),
        "retry_reason": c.get("retry_reason"),
        "input_tokens": _i(c.get("input_tokens")),
        "output_tokens": _i(c.get("output_tokens")),
        "reasoning_tokens": _i(c.get("reasoning_tokens")),
        "cached_tokens": _i(c.get("cached_input_tokens")),
        "context_bytes": _i(c.get("context_bytes")),
        "usage_missing": _truthy(c.get("usage_missing")),
        "cost_usd": round(_f(c.get("total_call_cost_usd")), 6),
        "duration_ms": _i(c.get("duration_ms")),
        "request_id": c.get("request_id"),
        "input_fingerprint": c.get("input_fingerprint") or None,
        "tool_key": c.get("tool_key"),
        # filled by the analysis passes:
        "duplicate_kind": None,
        "duplicate_group": None,
        "output_consumed": "unknown",
        "consumed_by_stage": None,
        "waste_flags": [],
    }


def _order(calls: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Stable execution order: by stored sequence_index when present, else by the
    original list order (store.list_calls already sorts by request time)."""
    def key(pair: Tuple[int, Dict[str, Any]]):
        idx, c = pair
        seq = c.get("sequence_index")
        return (0, int(seq)) if seq is not None else (1, idx)
    ordered = [c for _, c in sorted(enumerate(calls), key=key)]
    for display_seq, c in enumerate(ordered):
        # A stable, gap-free 0-based sequence for display/detection.
        c["sequence"] = display_seq
    return ordered


def _detect_duplicates(calls: List[Dict[str, Any]]) -> None:
    """Assign duplicate_kind / duplicate_group per call (deterministic, in-build).

    exact_input_duplicate  — same stage+agent+model+input_fingerprint as an earlier call
    retry_duplicate        — retry_number>0 AND input_fingerprint unchanged vs an earlier call
    near_duplicate_context — same stage+model, context byte size within tolerance of an earlier call
    """
    seen_exact: Dict[Tuple[str, str, str, str], str] = {}   # key → first call_id (group)
    stage_model_ctx: List[Tuple[str, str, int, Dict[str, Any]]] = []
    stage_fps: Dict[str, List[str]] = {}

    for c in calls:
        fp = c.get("input_fingerprint")
        stage, agent, model = c["stage"], c["agent"], c["model"]
        # exact input duplicate (needs a real fingerprint)
        if fp:
            key = (stage, agent, model, fp)
            if key in seen_exact:
                c["duplicate_kind"] = "exact_input_duplicate"
                c["duplicate_group"] = seen_exact[key]
            else:
                seen_exact[key] = c["call_id"] or f"seq{c['sequence']}"
                c["duplicate_group"] = seen_exact[key]
        # retry with unchanged input
        if c["retry_number"] > 0 and fp and fp in stage_fps.get(stage, []):
            if c["duplicate_kind"] is None:
                c["duplicate_kind"] = "retry_duplicate"
        stage_fps.setdefault(stage, []).append(fp) if fp else None
        # near-duplicate context by size (only if not already an exact dup)
        if c["duplicate_kind"] is None and c["context_bytes"] > 0:
            for pstage, pmodel, pbytes, pc in stage_model_ctx:
                if pstage == stage and pmodel == model and pbytes > 0:
                    hi = max(pbytes, c["context_bytes"])
                    lo = min(pbytes, c["context_bytes"])
                    if hi > 0 and (hi - lo) / hi <= NEAR_DUP_TOLERANCE:
                        c["duplicate_kind"] = "near_duplicate_context"
                        c["duplicate_group"] = pc.get("duplicate_group") or (pc.get("call_id") or f"seq{pc['sequence']}")
                        break
        stage_model_ctx.append((stage, model, c["context_bytes"], c))


def _trace_consumption(calls: List[Dict[str, Any]]) -> None:
    """Prove output consumption from the deterministic stage-dependency model:
    a producer's output is 'yes' when a consumer stage ran at a LATER sequence,
    else 'unknown'. Never 'false' — non-consumption is not guessed."""
    for i, c in enumerate(calls):
        consumers = _STAGE_CONSUMERS.get(c["stage"])
        if not consumers:
            continue
        for later in calls[i + 1:]:
            if later["stage"] in consumers:
                c["output_consumed"] = "yes"
                c["consumed_by_stage"] = later["stage"]
                break


def _percentile_threshold(values: List[int], pct: float) -> float:
    vals = sorted(v for v in values if v > 0)
    if not vals:
        return float("inf")
    if len(vals) == 1:
        return float(vals[0])
    k = (len(vals) - 1) * pct
    lo = int(k)
    hi = min(lo + 1, len(vals) - 1)
    frac = k - lo
    return vals[lo] + (vals[hi] - vals[lo]) * frac


def _flag_waste(calls: List[Dict[str, Any]], total_cost: float) -> None:
    """Assign deterministic per-call waste flags (documented set)."""
    large_ctx_cut = _percentile_threshold([c["context_bytes"] for c in calls], LARGE_PERCENTILE)
    large_out_cut = _percentile_threshold([c["output_tokens"] for c in calls], LARGE_PERCENTILE)
    # stage → distinct models & count of non-retry base calls
    stage_models: Dict[str, set] = {}
    stage_base_calls: Dict[str, int] = {}
    has_later_frontend = any(c["stage"] == T.STAGE_FRONTEND_GENERATION and c["success"] for c in calls)
    for c in calls:
        stage_models.setdefault(c["stage"], set()).add(c["model"] or "")
        if c["retry_number"] == 0:
            stage_base_calls[c["stage"]] = stage_base_calls.get(c["stage"], 0) + 1

    for i, c in enumerate(calls):
        flags: List[str] = []
        if c["duplicate_kind"] == "exact_input_duplicate":
            flags.append("duplicate_call")
        if c["duplicate_kind"] == "retry_duplicate":
            flags.append("retry_without_input_change")
        # repeated stage without a retry/repair reason
        if (c["retry_number"] == 0 and c["stage"] not in _REPEATABLE_STAGES
                and stage_base_calls.get(c["stage"], 0) > 1):
            # flag the 2nd+ base call in that stage
            earlier_same = sum(1 for p in calls[:i]
                               if p["stage"] == c["stage"] and p["retry_number"] == 0)
            if earlier_same >= 1:
                flags.append("repeated_stage_without_reason")
        # large context / output (absolute threshold OR top-10% within build)
        if c["context_bytes"] > 0 and (
                _tokens_from_bytes(c["context_bytes"]) >= LARGE_CONTEXT_TOKENS
                or c["context_bytes"] >= large_ctx_cut):
            flags.append("large_context")
        if c["input_tokens"] >= LARGE_CONTEXT_TOKENS:
            if "large_context" not in flags:
                flags.append("large_context")
        if c["output_tokens"] > 0 and (
                c["output_tokens"] >= LARGE_OUTPUT_TOKENS or c["output_tokens"] >= large_out_cut):
            flags.append("large_output")
        if c["usage_missing"]:
            flags.append("usage_missing")
        if not c["success"] and c["cost_usd"] > 0:
            flags.append("failed_paid_call")
        if c["generic_label"]:
            flags.append("generic_stage_label")
        if total_cost > 0 and c["cost_usd"] / total_cost >= HIGH_COST_SHARE:
            flags.append("high_cost_share")
        if len([m for m in stage_models.get(c["stage"], set()) if m]) > 1:
            flags.append("multiple_models_same_stage")
        # successful_but_unused — conservative: an auxiliary producer that was
        # NOT proven consumed AND the build still reached a later frontend gen.
        if (c["success"] and c["cost_usd"] > 0 and c["stage"] in _MUST_BE_CONSUMED
                and c["output_consumed"] != "yes" and has_later_frontend
                and c["stage"] != T.STAGE_FRONTEND_GENERATION):
            # only when a consumer of this producer never appears anywhere
            consumers = _STAGE_CONSUMERS.get(c["stage"], set())
            if not any(o["stage"] in consumers for o in calls):
                flags.append("successful_but_unused")
        c["waste_flags"] = flags


def _tokens_from_bytes(nbytes: int) -> int:
    """Rough tokens≈bytes/4 heuristic, used ONLY to compare a context byte size
    against a token threshold (never billed, never stored)."""
    return int(nbytes / 4) if nbytes > 0 else 0


def _waste_estimate(calls: List[Dict[str, Any]]) -> Dict[str, Any]:
    """CONSERVATIVE avoidable-cost estimate. Counts ONLY high-confidence,
    provably-avoidable spend: exact input duplicates and unchanged-input retries.
    Unused outputs / large calls are NEVER summed here (consumption can't be
    proven false; a large call may be necessary)."""
    candidates: List[Dict[str, Any]] = []
    total = 0.0
    has_exact = False
    for c in calls:
        if c["duplicate_kind"] == "exact_input_duplicate":
            has_exact = True
            total += c["cost_usd"]
            candidates.append({"callId": c["call_id"], "stage": c["stage"],
                               "kind": "exact_input_duplicate", "costUsd": c["cost_usd"],
                               "confidence": "high"})
        elif c["duplicate_kind"] == "retry_duplicate":
            total += c["cost_usd"]
            candidates.append({"callId": c["call_id"], "stage": c["stage"],
                               "kind": "retry_without_input_change", "costUsd": c["cost_usd"],
                               "confidence": "high"})
    if candidates:
        confidence = "high" if has_exact else "high"  # both counted kinds are high-confidence
    else:
        confidence = "unknown"
    return {"estimateUsd": round(total, 6), "confidence": confidence, "candidates": candidates}


def _recommendations(calls: List[Dict[str, Any]], stages: List[Dict[str, Any]],
                     build: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Deterministic, localizable recommendations (code + params → frontend t()).
    Measured facts only — never a savings claim."""
    recs: List[Dict[str, Any]] = []
    total = build["totalCostUsd"]
    total_in = build["totalInputTokens"]

    fe = next((s for s in stages if s["stage"] == T.STAGE_FRONTEND_GENERATION), None)
    if fe and total > 0 and fe["percentOfBuild"] >= HIGH_COST_SHARE * 100:
        recs.append({"code": "frontend_share", "params": {"percent": round(fe["percentOfBuild"])}})
    if fe and total_in > 0:
        share = round(fe["inputTokens"] * 100.0 / total_in) if total_in else 0
        if share >= 50:
            recs.append({"code": "frontend_input_share", "params": {"percent": share}})

    exact_dupes = [c for c in calls if c["duplicate_kind"] == "exact_input_duplicate"]
    if exact_dupes:
        recs.append({"code": "duplicate_calls",
                     "params": {"count": len(exact_dupes),
                                "usd": round(sum(c["cost_usd"] for c in exact_dupes), 4)}})
    planning_dupes = [c for c in exact_dupes if c["stage"] in
                      (T.STAGE_WEB_BUILD_PLANNING, T.STAGE_PLANNING_REPAIR)]
    if planning_dupes:
        recs.append({"code": "planning_repeated_identical", "params": {"count": len(planning_dupes) + 1}})

    retry_same = [c for c in calls if c["duplicate_kind"] == "retry_duplicate"]
    if retry_same:
        recs.append({"code": "retry_unchanged_input",
                     "params": {"usd": round(sum(c["cost_usd"] for c in retry_same), 4)}})

    unused = [c for c in calls if "successful_but_unused" in c["waste_flags"]]
    for u in unused[:2]:
        recs.append({"code": "output_not_consumed", "params": {"stage": u["stage"]}})

    multi_model = sorted({c["stage"] for c in calls if "multiple_models_same_stage" in c["waste_flags"]})
    for st in multi_model[:2]:
        recs.append({"code": "multiple_models_same_stage", "params": {"stage": st}})

    missing = build["usageMissingCalls"]
    if missing > 0:
        recs.append({"code": "calls_no_usage", "params": {"count": missing}})

    big = next((c for c in calls if "large_context" in c["waste_flags"]), None)
    if big:
        recs.append({"code": "large_context_call",
                     "params": {"stage": big["stage"],
                                "tokens": big["input_tokens"] or _tokens_from_bytes(big["context_bytes"])}})
    return recs


def _stage_rollup(calls: List[Dict[str, Any]], total_cost: float) -> List[Dict[str, Any]]:
    order: List[str] = []
    agg: Dict[str, Dict[str, Any]] = {}
    for c in calls:
        st = c["stage"]
        if st not in agg:
            agg[st] = {"stage": st, "calls": 0, "costUsd": 0.0, "inputTokens": 0,
                       "outputTokens": 0, "reasoningTokens": 0, "cachedTokens": 0,
                       "failedCalls": 0, "retryCalls": 0, "duplicateCalls": 0,
                       "unusedOutputs": 0, "_durs": []}
            order.append(st)
        a = agg[st]
        a["calls"] += 1
        a["costUsd"] += c["cost_usd"]
        a["inputTokens"] += c["input_tokens"]
        a["outputTokens"] += c["output_tokens"]
        a["reasoningTokens"] += c["reasoning_tokens"]
        a["cachedTokens"] += c["cached_tokens"]
        if not c["success"]:
            a["failedCalls"] += 1
        if c["retry_number"] > 0:
            a["retryCalls"] += 1
        if c["duplicate_kind"] in ("exact_input_duplicate", "retry_duplicate"):
            a["duplicateCalls"] += 1
        if "successful_but_unused" in c["waste_flags"]:
            a["unusedOutputs"] += 1
        if c["duration_ms"] > 0:
            a["_durs"].append(c["duration_ms"])
    out = []
    for st in order:
        a = agg[st]
        durs = a.pop("_durs")
        a["costUsd"] = round(a["costUsd"], 6)
        a["percentOfBuild"] = round(a["costUsd"] * 100.0 / total_cost, 2) if total_cost > 0 else 0.0
        a["averageDurationMs"] = int(sum(durs) / len(durs)) if durs else 0
        out.append(a)
    out.sort(key=lambda s: s["costUsd"], reverse=True)
    return out


def build_audit(build_id: str, *, log: bool = True) -> Dict[str, Any]:
    """Full deterministic cost audit for ONE build. Never raises; returns an
    empty-but-valid shape on any error so the owner route stays clean."""
    try:
        raw = store.list_calls(str(build_id))
        row = store.get_build_row(str(build_id)) or {}
    except Exception as exc:
        logger.warning("cost audit read failed for %s: %s", build_id, exc)
        raw, row = [], {}

    calls = _order([_norm_call(c) for c in raw])
    total_cost = round(sum(c["cost_usd"] for c in calls), 6)

    _detect_duplicates(calls)
    _trace_consumption(calls)
    _flag_waste(calls, total_cost)

    # cumulative + percent per call
    cum = 0.0
    for c in calls:
        cum += c["cost_usd"]
        c["cumulative_cost_usd"] = round(cum, 6)
        c["percent_of_build"] = round(c["cost_usd"] * 100.0 / total_cost, 2) if total_cost > 0 else 0.0

    stages = _stage_rollup(calls, total_cost)
    waste = _waste_estimate(calls)

    # build-level roll-up
    total_in = sum(c["input_tokens"] for c in calls)
    total_out = sum(c["output_tokens"] for c in calls)
    fe_cost = sum(c["cost_usd"] for c in calls if c["stage"] == T.STAGE_FRONTEND_GENERATION)
    plan_cost = sum(c["cost_usd"] for c in calls
                    if c["stage"] in (T.STAGE_WEB_BUILD_PLANNING, T.STAGE_PLANNING_REPAIR))
    dup_calls = sum(1 for c in calls if c["duplicate_kind"] in
                    ("exact_input_duplicate", "retry_duplicate"))
    unused = sum(1 for c in calls if "successful_but_unused" in c["waste_flags"])
    retry_cost = sum(c["cost_usd"] for c in calls if c["retry_number"] > 0)
    largest_call = max(calls, key=lambda c: c["cost_usd"], default=None)
    largest_stage = stages[0] if stages else None
    largest_agent = _largest_agent(calls)

    build = {
        "totalCostUsd": total_cost,
        "totalCalls": len(calls),
        "totalInputTokens": total_in,
        "totalOutputTokens": total_out,
        "totalReasoningTokens": sum(c["reasoning_tokens"] for c in calls),
        "totalCachedTokens": sum(c["cached_tokens"] for c in calls),
        "usageMissingCalls": sum(1 for c in calls if c["usage_missing"]),
        "failedPaidCalls": sum(1 for c in calls if not c["success"] and c["cost_usd"] > 0),
        "duplicateCalls": dup_calls,
        "unusedOutputs": unused,
        "largestStage": (largest_stage["stage"] if largest_stage else None),
        "largestAgent": largest_agent,
        "largestCall": ({"callId": largest_call["call_id"], "stage": largest_call["stage"],
                         "costUsd": largest_call["cost_usd"]} if largest_call else None),
        "frontendGenerationShare": round(fe_cost * 100.0 / total_cost, 2) if total_cost > 0 else 0.0,
        "planningShare": round(plan_cost * 100.0 / total_cost, 2) if total_cost > 0 else 0.0,
        "retryCostUsd": round(retry_cost, 6),
        "wasteEstimateUsd": waste["estimateUsd"],
        "wasteEstimateConfidence": waste["confidence"],
    }

    recs = _recommendations(calls, stages, build)
    optimization_candidates = _optimization_candidates(calls, stages, waste)

    payload = {
        "buildId": str(build_id),
        "status": row.get("status", "in_progress"),
        "startedAt": row.get("started_at"),
        "completedAt": row.get("completed_at"),
        "durationSeconds": store._duration_seconds(row.get("started_at"), row.get("completed_at")),
        "build": build,
        "stages": stages,
        "calls": [_public_call(c) for c in calls],
        "optimizationCandidates": optimization_candidates,
        "waste": waste,
        "recommendations": recs,
    }

    if log and calls:
        _log_audit(build_id, build, stages, calls)
    return payload


def _largest_agent(calls: List[Dict[str, Any]]) -> Optional[str]:
    by_agent: Dict[str, float] = {}
    for c in calls:
        by_agent[c["agent"]] = by_agent.get(c["agent"], 0.0) + c["cost_usd"]
    if not by_agent:
        return None
    return max(by_agent.items(), key=lambda kv: kv[1])[0]


def _optimization_candidates(calls: List[Dict[str, Any]], stages: List[Dict[str, Any]],
                             waste: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Ranked, measured candidates (NOT actions taken). Highest measured USD first."""
    out: List[Dict[str, Any]] = []
    for cand in waste["candidates"]:
        out.append({"kind": cand["kind"], "stage": cand["stage"],
                    "costUsd": cand["costUsd"], "confidence": cand["confidence"]})
    # high-cost stage share (measurement, not a directive to cut it)
    for s in stages[:2]:
        if s["percentOfBuild"] >= HIGH_COST_SHARE * 100:
            out.append({"kind": "high_cost_stage", "stage": s["stage"],
                        "costUsd": s["costUsd"], "confidence": "measured",
                        "percentOfBuild": s["percentOfBuild"]})
    out.sort(key=lambda x: x["costUsd"], reverse=True)
    return out[:8]


def _public_call(c: Dict[str, Any]) -> Dict[str, Any]:
    """Owner-facing call shape — NO input_fingerprint, NO content, only metadata."""
    return {
        "sequence": c["sequence"],
        "callId": c["call_id"],
        "stage": c["stage"],
        "agent": c["agent"],
        "operationType": c["operation_type"],
        "provider": c["provider"],
        "model": c["model"],
        "success": c["success"],
        "retryNumber": c["retry_number"],
        "retryReason": c["retry_reason"],
        "inputTokens": c["input_tokens"],
        "outputTokens": c["output_tokens"],
        "reasoningTokens": c["reasoning_tokens"],
        "cachedTokens": c["cached_tokens"],
        "contextBytes": c["context_bytes"],
        "usageMissing": c["usage_missing"],
        "costUsd": c["cost_usd"],
        "percentOfBuild": c["percent_of_build"],
        "cumulativeCostUsd": c["cumulative_cost_usd"],
        "durationMs": c["duration_ms"],
        "duplicateKind": c["duplicate_kind"],
        "duplicateGroup": c["duplicate_group"],
        "outputConsumed": c["output_consumed"],
        "consumedByStage": c["consumed_by_stage"],
        "wasteFlags": c["waste_flags"],
        "requestId": c["request_id"],
        "toolKey": c["tool_key"],
    }


def _log_audit(build_id: str, build: Dict[str, Any], stages: List[Dict[str, Any]],
               calls: List[Dict[str, Any]]) -> None:
    """Bounded audit logs — never a prompt, source, raw response or secret."""
    try:
        top = stages[0]["stage"] if stages else "-"
        logger.info(
            "WEB_BUILD_COST_AUDIT | build_id=%s | total_usd=%.4f | top_stage=%s | "
            "duplicate_calls=%d | retry_cost_usd=%.4f | waste_estimate_usd=%.4f",
            str(build_id), build["totalCostUsd"], top, build["duplicateCalls"],
            build["retryCostUsd"], build["wasteEstimateUsd"],
        )
        for c in calls:
            logger.info(
                "WEB_BUILD_COST_CALL | build_id=%s | seq=%d | stage=%s | model=%s | "
                "usd=%.4f | input=%d | output=%d | retry=%d | duplicate=%s",
                str(build_id), c["sequence"], c["stage"], (c["model"] or "-"),
                c["cost_usd"], c["input_tokens"], c["output_tokens"],
                c["retry_number"], (c["duplicate_kind"] or "-"),
            )
    except Exception:
        pass


__all__ = ["build_audit", "HIGH_COST_SHARE", "LARGE_CONTEXT_TOKENS",
           "LARGE_OUTPUT_TOKENS", "NEAR_DUP_TOLERANCE"]
