# coding: utf-8
"""
Build-task provider routing — types (Phase 1: decision-only shadow mode).

A small, centralized, SERVER-AUTHORITATIVE routing policy for the KorvixAI
Web Build and App Build execution paths. This module defines only the stable
typed structure of a routing DECISION plus the string vocabularies; the policy
logic and the (decision-only) shadow seams live in `policy.py`.

House style (matches backend/services/billing/credits/types.py and
backend/services/providers/router.py): module-level string constants used as an
enum surrogate + a frozen dataclass carrying a `to_dict()`. No enum.Enum, no new
dependency.

IMPORTANT — Phase 1 is DECISION-ONLY:
  * A `BuildRoutingDecision` records what the policy WOULD select if provider
    routing were active. It NEVER switches execution and NEVER triggers an
    Anthropic call. `executed_provider` / `executed_model` record what actually
    ran (always OpenAI in this PR), kept DISTINCT from the shadow target
    (`selected_provider` / `selected_model`) so an observer can never mistake a
    shadow selection for a real Claude execution.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict


# ── Providers ─────────────────────────────────────────────────────────────────
PROVIDER_OPENAI = "openai"
PROVIDER_ANTHROPIC = "anthropic"


# ── Routing modes ─────────────────────────────────────────────────────────────
# disabled: exact current behavior — OpenAI stays selected, nothing computed or
#           logged. shadow: compute + log the decision only; execution unchanged;
#           zero Anthropic calls. owner_only: the ONLY mode that may execute real
#           Anthropic traffic, and ONLY for `web_build.planning` when the request
#           is a backend-verified owner — every other user, task and mode stays on
#           the existing OpenAI path. There is intentionally NO global
#           active/cutover mode.
MODE_DISABLED = "disabled"
MODE_SHADOW = "shadow"
MODE_OWNER_ONLY = "owner_only"
VALID_MODES = frozenset({MODE_DISABLED, MODE_SHADOW, MODE_OWNER_ONLY})


# ── Task kinds ────────────────────────────────────────────────────────────────
# Explicit, backend-owned task identities. These are the ONLY values a routing
# decision keys on; they are derived from internal, deterministic task markers
# (canonical mode + frontend task marker for Web Build; spec id + deliverable
# kind for App Build) — never from arbitrary user prose or a client request body.
TASK_WEB_PLANNING = "web_build.planning"
TASK_WEB_CODEGEN = "web_build.codegen"
TASK_WEB_CONTRACT_REPAIR = "web_build.contract_repair"
TASK_WEB_QUALITY_REPAIR = "web_build.quality_repair"
TASK_WEB_STATIC_REVIEW = "web_build.static_review"

TASK_APP_PLANNING = "app_build.planning"
TASK_APP_CODEGEN = "app_build.codegen"
TASK_APP_REPAIR = "app_build.repair"
TASK_APP_REVIEW = "app_build.review"

WEB_BUILD_TASK_KINDS = frozenset({
    TASK_WEB_PLANNING, TASK_WEB_CODEGEN, TASK_WEB_CONTRACT_REPAIR,
    TASK_WEB_QUALITY_REPAIR, TASK_WEB_STATIC_REVIEW,
})
APP_BUILD_TASK_KINDS = frozenset({
    TASK_APP_PLANNING, TASK_APP_CODEGEN, TASK_APP_REPAIR, TASK_APP_REVIEW,
})
VALID_TASK_KINDS = WEB_BUILD_TASK_KINDS | APP_BUILD_TASK_KINDS


# ── Decision reason codes (bounded, non-secret) ───────────────────────────────
REASON_PREFERS_CLAUDE = "prefers_claude"              # policy would route this task to Claude
REASON_REVIEW_RETAINED_OPENAI = "review_retained_on_openai"  # static review deliberately kept on OpenAI
REASON_UNROUTED = "unrouted"                          # task kind not covered by the policy (kept on OpenAI)


# ── Policy version ────────────────────────────────────────────────────────────
# Bump when the mapping (task kind → provider/model) changes so shadow logs and
# the readiness view are attributable to a specific policy revision.
POLICY_VERSION = "build-routing-1"


@dataclass(frozen=True)
class BuildRoutingDecision:
    """One immutable routing decision.

    `selected_*` is the SHADOW target (what the policy would use). `executed_*`
    is what actually ran this request — always OpenAI in Phase 1. They are kept
    separate on purpose so a decision can never be read as "Claude executed".
    `fallback_*` is the safety target if the selected provider were unavailable
    in a future active mode (always the current OpenAI path here).
    """
    task_kind: str
    selected_provider: str
    selected_model: str
    fallback_provider: str
    fallback_model: str
    routing_mode: str
    decision_reason: str
    policy_version: str
    executed_provider: str
    executed_model: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "task_kind": self.task_kind,
            "selected_provider": self.selected_provider,
            "selected_model": self.selected_model,
            "fallback_provider": self.fallback_provider,
            "fallback_model": self.fallback_model,
            "routing_mode": self.routing_mode,
            "decision_reason": self.decision_reason,
            "policy_version": self.policy_version,
            "executed_provider": self.executed_provider,
            "executed_model": self.executed_model,
        }


__all__ = [
    "PROVIDER_OPENAI", "PROVIDER_ANTHROPIC",
    "MODE_DISABLED", "MODE_SHADOW", "MODE_OWNER_ONLY", "VALID_MODES",
    "TASK_WEB_PLANNING", "TASK_WEB_CODEGEN", "TASK_WEB_CONTRACT_REPAIR",
    "TASK_WEB_QUALITY_REPAIR", "TASK_WEB_STATIC_REVIEW",
    "TASK_APP_PLANNING", "TASK_APP_CODEGEN", "TASK_APP_REPAIR", "TASK_APP_REVIEW",
    "WEB_BUILD_TASK_KINDS", "APP_BUILD_TASK_KINDS", "VALID_TASK_KINDS",
    "REASON_PREFERS_CLAUDE", "REASON_REVIEW_RETAINED_OPENAI", "REASON_UNROUTED",
    "POLICY_VERSION", "BuildRoutingDecision",
]
