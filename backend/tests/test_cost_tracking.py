# coding: utf-8
"""
Phase 14M — Web Build AI usage & cost tracking tests (task #10).

Proves that multi-call builds, failed calls, retries, cached tokens and
additional (non-token) tool costs are aggregated correctly, that pricing
is centralized, and that a missing-usage call is flagged rather than
counted as a free (zero) call.

Runs without any network or provider key — it exercises the pure
tracking/pricing/aggregation logic against a temp SQLite file.
"""
from __future__ import annotations

import importlib
import os

import pytest


@pytest.fixture()
def ct(tmp_path, monkeypatch):
    """Fresh cost_tracking stack pointed at an isolated temp DB."""
    db = tmp_path / "cost_tracking_test.db"
    monkeypatch.setenv("COST_TRACKING_DB_PATH", str(db))

    # Re-import store so it recomputes DB_PATH from the patched env, then
    # reload tracker so it binds to the reloaded store.
    from backend.services.cost_tracking import store as _store
    importlib.reload(_store)
    from backend.services.cost_tracking import tracker as _tracker
    importlib.reload(_tracker)
    from backend.services.cost_tracking import pricing as _pricing
    from backend.services.cost_tracking import types as _types

    _store._reset_for_tests()
    return {
        "tracker": _tracker, "store": _store,
        "pricing": _pricing, "types": _types,
    }


# ── Pricing (centralized table, task #5) ─────────────────────────────────────
def test_pricing_is_centralized_and_matches(ct):
    pricing = ct["pricing"]
    price, matched = pricing.resolve_model_price("gpt-4o-mini")
    assert matched is True
    assert price.input == 0.15 and price.output == 0.60

    # longest-prefix match: dated model id resolves to the specific row.
    price2, matched2 = pricing.resolve_model_price("gpt-4o-mini-2024-07-18")
    assert matched2 is True
    assert price2.input == 0.15

    # unknown model → conservative fallback, flagged not-matched.
    _, matched3 = pricing.resolve_model_price("totally-unknown-model")
    assert matched3 is False


def test_ai_guard_delegates_to_central_pricing(ct):
    """The founder-beta guard must compute the same USD as the central table
    (task #5 — one source of truth, no divergent hardcoded prices)."""
    from backend.services.ai_guard import policy as guard_policy
    pricing = ct["pricing"]
    guard_usd = guard_policy.compute_actual_usd("gpt-4o", 1_000_000, 1_000_000)
    bd = pricing.compute_call_cost(provider=None, model="gpt-4o",
                                   input_tokens=1_000_000, output_tokens=1_000_000)
    assert guard_usd == round(bd.input_cost_usd + bd.output_cost_usd, 6)
    # gpt-4o = $5 in + $15 out per 1M.
    assert guard_usd == 20.0


def test_cached_tokens_are_discounted(ct):
    pricing = ct["pricing"]
    # OpenAI semantics: cached is a subset of input, billed at the cheaper rate.
    bd = pricing.compute_call_cost(
        provider="openai", model="gpt-4o",
        input_tokens=1_000_000, output_tokens=0, cached_input_tokens=400_000,
    )
    # 600k uncached * $5/1M = 3.00 ; 400k cached * $2.5/1M = 1.00
    assert bd.input_cost_usd == 3.0
    assert bd.cache_cost_usd == 1.0
    assert bd.total_call_cost_usd == 4.0


def test_anthropic_cache_is_additive_not_subset(ct):
    pricing = ct["pricing"]
    bd = pricing.compute_call_cost(
        provider="anthropic", model="claude-sonnet-4",
        input_tokens=1_000_000, output_tokens=0,
        cached_input_tokens=500_000, cache_creation_tokens=200_000,
    )
    # input billed in full (not subset): 1M * $3 = 3.0
    assert bd.input_cost_usd == 3.0
    # cache read 500k * $0.30 = 0.15 ; cache write 200k * $3.75 = 0.75
    assert bd.cache_cost_usd == round(0.15 + 0.75, 6)


# ── Usage missing (task #9) ──────────────────────────────────────────────────
def test_usage_missing_never_estimated_zero(ct):
    tracker, store, types = ct["tracker"], ct["store"], ct["types"]
    tracker.record_ai_call(
        build_id="b_missing", user_id="u", provider="openai", model="gpt-4o",
        operation_type=types.OP_PLANNING,
        usage=types.TokenUsage(usage_missing=True),
    )
    agg = store.aggregate_build("b_missing")
    assert agg["usage_missing_calls"] == 1
    assert agg["total_input_tokens"] == 0
    assert agg["total_build_cost_usd"] == 0.0
    # But a tool cost on a usage-missing token call is still billed.
    bd = ct["pricing"].compute_call_cost(
        provider="openai", model="gpt-4o", usage_missing=True,
        additional_tool_cost_usd=0.05,
    )
    assert bd.usage_missing is True
    assert bd.total_call_cost_usd == 0.05


# ── Multi-call build aggregation (task #6, #10) ──────────────────────────────
def test_multi_call_build_aggregates(ct):
    tracker, store, types = ct["tracker"], ct["store"], ct["types"]
    U = types.TokenUsage
    bid = tracker.start_build(user_id="u1", build_id="b_multi", label="fitness app")

    # 1) planning — success, with cache
    tracker.record_ai_call(
        build_id=bid, user_id="u1", provider="openai", model="gpt-5.6",
        operation_type=types.OP_PLANNING,
        usage=U(input_tokens=10_000, output_tokens=5_000,
                cached_input_tokens=4_000, reasoning_tokens=2_000, total_tokens=15_000),
    )
    # 2) codegen — FAILED (timeout), only input billed
    tracker.record_ai_call(
        build_id=bid, user_id="u1", provider="openai", model="gpt-5.6",
        operation_type=types.OP_CODEGEN, success=False, error_code="PROVIDER_TIMEOUT",
        usage=U(input_tokens=2_000, output_tokens=0, total_tokens=2_000),
    )
    # 3) codegen RETRY — success
    tracker.record_ai_call(
        build_id=bid, user_id="u1", provider="openai", model="gpt-5.6",
        operation_type=types.OP_CODEGEN_REPAIR, retry_number=1,
        usage=U(input_tokens=2_000, output_tokens=8_000, total_tokens=10_000),
    )
    # 4) a usage-missing chat call
    tracker.record_ai_call(
        build_id=bid, user_id="u1", provider="openai", model="gpt-4o-mini",
        operation_type=types.OP_CHAT, usage=U(usage_missing=True),
    )
    # 5) two generated images + 8 research searches (non-token, task #4)
    tracker.record_tool_cost(build_id=bid, user_id="u1",
                             tool_key="image.gpt-image-1.high", units=2,
                             operation_type=types.OP_IMAGE_GEN)
    tracker.record_tool_cost(build_id=bid, user_id="u1",
                             tool_key="search.tavily", units=8,
                             operation_type=types.OP_WEB_SEARCH)
    tracker.complete_build(build_id=bid)

    agg = store.aggregate_build(bid)
    assert agg["total_ai_calls"] == 6
    assert agg["failed_calls"] == 1
    assert agg["retry_calls"] == 1
    assert agg["usage_missing_calls"] == 1
    assert agg["total_input_tokens"] == 14_000
    assert agg["total_output_tokens"] == 13_000
    assert agg["total_cached_tokens"] == 4_000
    assert agg["total_reasoning_tokens"] == 2_000

    # Token cost:
    #  planning: (10k-4k)/1M*10=0.06 + 5k/1M*30=0.15 + 4k/1M*1.25=0.005 = 0.215
    #  failed:   2k/1M*10 = 0.02
    #  retry:    2k/1M*10=0.02 + 8k/1M*30=0.24 = 0.26
    #  missing:  0
    assert agg["total_token_cost_usd"] == round(0.215 + 0.02 + 0.26, 6)
    # Tool cost: 2 * 0.167 (image high) + 8 * 0.008 (tavily) = 0.334 + 0.064
    assert agg["total_tool_cost_usd"] == round(0.334 + 0.064, 6)
    assert agg["total_build_cost_usd"] == round(0.495 + 0.398, 6)
    # Retry cost = only the retry call's total.
    assert agg["retry_cost_usd"] == 0.26

    # Build view exposes duration + calls list.
    view = tracker.get_build(bid)
    assert view["status"] == "completed"
    assert len(view["calls"]) == 6


def test_build_id_groups_continuations(ct):
    """Two /chat sub-calls sharing the same op-id → one build."""
    tracker, store, types = ct["tracker"], ct["store"], ct["types"]
    U = types.TokenUsage
    op_id = "op_shared_123"
    tracker.record_ai_call(build_id=op_id, user_id="u", provider="openai",
                           model="gpt-4o", operation_type=types.OP_PLANNING,
                           usage=U(input_tokens=1000, output_tokens=1000))
    tracker.record_ai_call(build_id=op_id, user_id="u", provider="openai",
                           model="gpt-4o", operation_type=types.OP_PLANNING_REPAIR,
                           retry_number=1,
                           usage=U(input_tokens=1000, output_tokens=1000))
    agg = store.aggregate_build(op_id)
    assert agg["total_ai_calls"] == 2
    assert agg["retry_calls"] == 1
    # Only one build row exists for the shared id.
    builds = tracker.list_builds()
    assert len([b for b in builds if b["build_id"] == op_id]) == 1


# ── Analytics (task #7) ──────────────────────────────────────────────────────
def _seed_builds(tracker, types, specs):
    """specs: list of (build_id, [call cost via output tokens]). We drive
    cost purely via output tokens on gpt-4o ($15/1M) for predictable math."""
    U = types.TokenUsage
    for bid, out_tokens_list in specs:
        tracker.start_build(user_id="u", build_id=bid)
        for i, ot in enumerate(out_tokens_list):
            tracker.record_ai_call(
                build_id=bid, user_id="u", provider="openai", model="gpt-4o",
                operation_type=types.OP_PLANNING, retry_number=(1 if i > 0 else 0),
                usage=U(input_tokens=0, output_tokens=ot),
            )


def test_analytics_percentiles(ct):
    tracker, types = ct["tracker"], ct["types"]
    # Build totals (output tokens → $15/1M): make 5 builds of 1..5 dollars.
    #   n tokens for $X = X/15 * 1e6
    specs = []
    for x in (1.0, 2.0, 3.0, 4.0, 5.0):
        specs.append((f"b{x}", [int(round(x / 15.0 * 1_000_000))]))
    _seed_builds(tracker, types, specs)

    a = tracker.analytics()
    assert a["build_count"] == 5
    # totals ~ [1,2,3,4,5]
    assert abs(a["average_build_cost_usd"] - 3.0) < 1e-4
    assert abs(a["median_build_cost_usd"] - 3.0) < 1e-4
    # p90 of [1,2,3,4,5] (inclusive interp) = 4.6 ; p95 = 4.8
    assert abs(a["p90_build_cost_usd"] - 4.6) < 1e-3
    assert abs(a["p95_build_cost_usd"] - 4.8) < 1e-3
    assert a["cheapest_build"]["build_id"] == "b1.0"
    assert a["most_expensive_build"]["build_id"] == "b5.0"


def test_analytics_retry_and_by_model_and_operation(ct):
    tracker, types = ct["tracker"], ct["types"]
    U = types.TokenUsage
    bid = tracker.start_build(user_id="u", build_id="b_ana")
    tracker.record_ai_call(build_id=bid, user_id="u", provider="openai",
                           model="gpt-4o", operation_type=types.OP_PLANNING,
                           usage=U(input_tokens=0, output_tokens=1_000_000))  # $15
    tracker.record_ai_call(build_id=bid, user_id="u", provider="openai",
                           model="gpt-4o-mini", operation_type=types.OP_CODEGEN,
                           retry_number=2,
                           usage=U(input_tokens=0, output_tokens=1_000_000))  # $0.60

    a = tracker.analytics()
    # by model
    models = {m["model"]: m for m in a["token_usage_by_model"]}
    assert models["gpt-4o"]["cost_usd"] == 15.0
    assert models["gpt-4o-mini"]["cost_usd"] == 0.6
    # by operation
    ops = {o["operation_type"]: o for o in a["cost_by_operation_type"]}
    assert ops[types.OP_PLANNING]["cost_usd"] == 15.0
    assert ops[types.OP_CODEGEN]["cost_usd"] == 0.6
    # retry cost = only the retry call ($0.60)
    assert a["retry_costs"]["retry_calls"] == 1
    assert a["retry_costs"]["retry_cost_usd"] == 0.6


def test_additional_tool_cost_on_token_call(ct):
    """A single call can carry BOTH token cost and an additional tool cost
    (e.g. an LLM call that also triggered a billable web-search tool)."""
    pricing = ct["pricing"]
    bd = pricing.compute_call_cost(
        provider="openai", model="gpt-4o",
        input_tokens=0, output_tokens=1_000_000,     # $15
        additional_tool_cost_usd=0.25,
    )
    assert bd.output_cost_usd == 15.0
    assert bd.additional_tool_cost_usd == 0.25
    assert bd.total_call_cost_usd == 15.25


def test_tool_cost_pricing_units(ct):
    pricing = ct["pricing"]
    usd, matched = pricing.compute_tool_cost("image.gpt-image-1.high", 3)
    assert matched is True
    assert usd == round(3 * 0.167, 6)
    # coarse namespace fallback
    usd2, matched2 = pricing.compute_tool_cost("image.some-new-provider", 1)
    assert matched2 is True  # falls back to "image"
    # totally unknown namespace → 0 cost, not matched
    usd3, matched3 = pricing.compute_tool_cost("mystery.tool", 5)
    assert matched3 is False
    assert usd3 == 0.0
