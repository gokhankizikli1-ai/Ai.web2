# coding: utf-8
"""Regression: contract-aware repair budget + reasoning, AND the initial-generation latency/cost
optimization.

Two production concerns are locked here:

  1. Contract-aware quality-repair (unchanged by the optimization): a quality-repair whose EXPLICIT
     response contract is frontend-delta-v1 is sized at 16,000 with LOW reasoning, while a full re-emit
     (frontend-files-v1) and any missing/unknown signal stay 30,000.

  2. Initial-generation latency/cost optimization: a ~12-minute in_progress frontend generation on
     gpt-5.6 was driven by MEDIUM reasoning + a 30,000 output ceiling. Initial generation only
     IMPLEMENTS the authoritative upstream spec (it does not re-plan), so it now uses LOW reasoning and
     a dedicated 24,000 ceiling (materially below 30k, still 2× the previously-insufficient 12k).
     contract-repair, revision, reviews and unknown are UNCHANGED.

`_frontend_repair_contract` / `frontend_task_max_output_tokens` / `_frontend_reasoning_effort` /
`_frontend_task_kind` / `_frontend_client_workflow_budget_ms` are pure functions; `ai_client` imports
provider SDKs at load, so skip cleanly in a minimal sandbox rather than fail collection.
"""
from __future__ import annotations

import pytest

ai_client = pytest.importorskip("ai_client")
_frontend_repair_contract = ai_client._frontend_repair_contract
frontend_task_max_output_tokens = ai_client.frontend_task_max_output_tokens
_frontend_reasoning_effort = ai_client._frontend_reasoning_effort
_frontend_task_kind = ai_client._frontend_task_kind
_frontend_client_workflow_budget_ms = ai_client._frontend_client_workflow_budget_ms
FRONTEND_FULL_SOURCE_MAX_OUTPUT_TOKENS = ai_client.FRONTEND_FULL_SOURCE_MAX_OUTPUT_TOKENS
FRONTEND_DELTA_REPAIR_MAX_OUTPUT_TOKENS = ai_client.FRONTEND_DELTA_REPAIR_MAX_OUTPUT_TOKENS
FRONTEND_INITIAL_GENERATION_MAX_OUTPUT_TOKENS = ai_client.FRONTEND_INITIAL_GENERATION_MAX_OUTPUT_TOKENS

_BUILDER = "[FRONTEND BUILDER REQUEST]"
_REPAIR = "[FRONTEND REPAIR REQUEST]"
_C_FILES = "[FRONTEND REPAIR CONTRACT: frontend-files-v1]"
_C_DELTA = "[FRONTEND REPAIR CONTRACT: frontend-delta-v1]"
_REGISTERED = 12_000  # the frontend_builder registered review budget (unchanged path)


def _delta_repair_msg() -> str:
    return f"{_BUILDER}\n{_REPAIR}\n{_C_DELTA}\nTask: apply the bounded review fixes …\n"


def _full_repair_msg() -> str:
    return f"{_BUILDER}\n{_REPAIR}\n{_C_FILES}\nTask: return the COMPLETE repaired project …\n"


def _legacy_repair_msg() -> str:
    # A repair request with NO contract marker (pre-Phase-2 / old client).
    return f"{_BUILDER}\n{_REPAIR}\nTask: apply the bounded review fixes …\n"


def _generation_msg() -> str:
    return f"{_BUILDER}\nBEGIN_FRONTEND_BUILD_SPEC_JSON\n{{}}\nEND_FRONTEND_BUILD_SPEC_JSON\n"


def _review_msg() -> str:
    return f"{_BUILDER}\n[FRONTEND REVIEW REQUEST]\nTask: static design-quality review (stage: initial).\n"


# ── constants + parser ──────────────────────────────────────────────────────────────────────

def test_delta_budget_constant_is_16k():
    assert FRONTEND_DELTA_REPAIR_MAX_OUTPUT_TOKENS == 16_000


def test_full_source_budget_constant_unchanged_30k():
    assert FRONTEND_FULL_SOURCE_MAX_OUTPUT_TOKENS == 30_000


def test_initial_generation_budget_constant_is_24k():
    # New dedicated ceiling: materially below 30k, still 2× the previously-insufficient 12k.
    assert FRONTEND_INITIAL_GENERATION_MAX_OUTPUT_TOKENS == 24_000
    assert 12_000 < FRONTEND_INITIAL_GENERATION_MAX_OUTPUT_TOKENS < FRONTEND_FULL_SOURCE_MAX_OUTPUT_TOKENS


def test_repair_contract_parser():
    assert _frontend_repair_contract(_delta_repair_msg()) == "frontend-delta-v1"
    assert _frontend_repair_contract(_full_repair_msg()) == "frontend-files-v1"
    assert _frontend_repair_contract(_legacy_repair_msg()) is None
    assert _frontend_repair_contract("garbage [FRONTEND REPAIR CONTRACT: something-else]") is None
    # files-v1 takes PRECEDENCE so an ambiguous/injected signal can never downgrade a full re-emit.
    both = f"{_C_DELTA}\n{_C_FILES}"
    assert _frontend_repair_contract(both) == "frontend-files-v1"


# ── A–E: token resolver ─────────────────────────────────────────────────────────────────────

def test_A_quality_repair_delta_is_16k():
    assert frontend_task_max_output_tokens("quality-repair", _REGISTERED, "frontend-delta-v1") == 16_000


def test_B_quality_repair_files_is_30k():
    assert frontend_task_max_output_tokens("quality-repair", _REGISTERED, "frontend-files-v1") == 30_000


def test_C_quality_repair_missing_contract_is_30k():
    assert frontend_task_max_output_tokens("quality-repair", _REGISTERED, None) == 30_000
    # default arg (no contract passed) is also the conservative 30k
    assert frontend_task_max_output_tokens("quality-repair", _REGISTERED) == 30_000


def test_D_quality_repair_unknown_contract_is_30k():
    assert frontend_task_max_output_tokens("quality-repair", _REGISTERED, "totally-unknown") == 30_000
    assert frontend_task_max_output_tokens("quality-repair", _REGISTERED, "frontend-files-v2") == 30_000


def test_E_initial_generation_is_24k_regardless_of_contract():
    # Optimization: initial-generation now has its OWN dedicated 24k ceiling (was 30k).
    assert frontend_task_max_output_tokens("initial-generation", _REGISTERED) == 24_000
    # only quality-repair is contract-scoped, so a (nonsensical) delta contract does not change it.
    assert frontend_task_max_output_tokens("initial-generation", _REGISTERED, "frontend-delta-v1") == 24_000
    # and it must NEVER regress to the previously-insufficient 12k registered budget.
    assert frontend_task_max_output_tokens("initial-generation", _REGISTERED) != _REGISTERED


def test_other_full_source_tasks_unchanged_30k():
    # contract-repair and revision are background full-source → unchanged 30k (never delta-scoped,
    # never affected by the initial-generation optimization).
    assert frontend_task_max_output_tokens("contract-repair", _REGISTERED, "frontend-delta-v1") == 30_000
    assert frontend_task_max_output_tokens("revision", _REGISTERED, "frontend-delta-v1") == 30_000
    assert frontend_task_max_output_tokens("contract-repair", _REGISTERED) == 30_000
    assert frontend_task_max_output_tokens("revision", _REGISTERED) == 30_000


def test_reviews_and_unknown_keep_registered_budget():
    # Non-background kinds keep the registered budget (review path unchanged).
    assert frontend_task_max_output_tokens("initial-review", _REGISTERED) == _REGISTERED
    assert frontend_task_max_output_tokens("final-review", _REGISTERED) == _REGISTERED
    assert frontend_task_max_output_tokens("unknown", _REGISTERED) == _REGISTERED


# ── F–G: reasoning effort ───────────────────────────────────────────────────────────────────

def test_F_quality_repair_reasoning_is_low_for_both_contracts():
    assert _frontend_reasoning_effort(_delta_repair_msg()) == "low"
    assert _frontend_reasoning_effort(_full_repair_msg()) == "low"
    assert _frontend_reasoning_effort(_legacy_repair_msg()) == "low"  # kind-based, marker not required


def test_G_initial_generation_reasoning_is_low():
    # Optimization: initial-generation now uses LOW reasoning (was medium) — it implements the
    # authoritative spec rather than re-planning. (Not none/minimal — a conservative first step.)
    assert _frontend_reasoning_effort(_generation_msg()) == "low"


def test_review_reasoning_unchanged_low():
    assert _frontend_reasoning_effort(_review_msg()) == "low"


def test_contract_repair_and_revision_reasoning_unchanged_medium():
    # These are NOT quality-repair or initial-generation; their reasoning must remain medium (unchanged).
    assert _frontend_reasoning_effort(f"{_BUILDER}\n[FRONTEND CONTRACT REPAIR REQUEST]\n") == "medium"
    assert _frontend_reasoning_effort(f"{_BUILDER}\n[FRONTEND REVISION REQUEST]\n") == "medium"


def test_unknown_marker_reasoning_is_medium_fail_safe():
    # An unrecognized / non-builder prompt keeps the conservative MEDIUM default (existing safe behavior).
    assert _frontend_reasoning_effort("no markers here at all") == "medium"
    assert _frontend_task_kind("no markers here at all") == "unknown"


# ── client workflow-budget diagnostic mirror (numbers only; does NOT change any real deadline) ──

def test_client_workflow_budget_mirror():
    # Full-project kinds mirror the extended 720s browser budget; every other kind the 540s default.
    assert _frontend_client_workflow_budget_ms("initial-generation") == 720_000
    assert _frontend_client_workflow_budget_ms("quality-repair") == 720_000
    assert _frontend_client_workflow_budget_ms("contract-repair") == 540_000
    assert _frontend_client_workflow_budget_ms("revision") == 540_000
    assert _frontend_client_workflow_budget_ms("unknown") == 540_000


# ── classification is not perturbed by the new contract marker ──────────────────────────────

def test_contract_marker_does_not_change_task_classification():
    # Both repair messages still classify as quality-repair (the contract marker must not be mistaken
    # for the contract-repair marker or drop the quality-repair classification).
    assert _frontend_task_kind(_delta_repair_msg()) == "quality-repair"
    assert _frontend_task_kind(_full_repair_msg()) == "quality-repair"
