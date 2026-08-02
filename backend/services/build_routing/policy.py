# coding: utf-8
"""
Build-task provider routing — policy + decision-only shadow seams (Phase 1).

Deterministic, server-controlled mapping from an internal build TASK KIND to the
provider/model the policy WOULD select, plus the safe shadow seams the real
Web Build and App Build execution paths call.

Phase-1 guarantees (verify statically):
  * Default OFF. `BUILD_PROVIDER_ROUTING_MODE` missing/invalid → `disabled`.
  * `disabled` mode is a complete no-op: nothing is computed or logged, so
    behavior and output are byte-identical to today.
  * `shadow` mode computes the decision and records bounded, sanitized metadata
    ONLY. It makes ZERO Anthropic (or any network) calls — the selected Claude
    model is read from configuration (`settings.MODEL_ANTHROPIC`), never from a
    provider request. Execution continues on the existing OpenAI path unchanged.
  * The routing decision is NEVER derived from a client request body — only from
    backend config + internal task markers (canonical mode, frontend task
    marker, orchestrator spec id / deliverable kind).
  * Every seam is fully guarded: a router/config import or decision failure can
    never raise into — or alter — a build.

There is NO active/cutover mode here. The App Build agent runtime is OpenAI-only
(it parses OpenAI chat-completions tool-call shapes), so a real Claude execution
is out of scope for this PR; the decision is observability only.
"""
from __future__ import annotations

import logging
import os
import threading
from typing import Dict, Optional

from backend.services.build_routing.types import (
    BuildRoutingDecision,
    PROVIDER_OPENAI, PROVIDER_ANTHROPIC,
    MODE_DISABLED, MODE_SHADOW, VALID_MODES,
    TASK_WEB_PLANNING, TASK_WEB_CODEGEN, TASK_WEB_CONTRACT_REPAIR,
    TASK_WEB_QUALITY_REPAIR, TASK_WEB_STATIC_REVIEW,
    TASK_APP_PLANNING, TASK_APP_CODEGEN, TASK_APP_REVIEW,
    VALID_TASK_KINDS,
    REASON_PREFERS_CLAUDE, REASON_REVIEW_RETAINED_OPENAI, REASON_UNROUTED,
    POLICY_VERSION,
)

logger = logging.getLogger(__name__)


# ── Mode (read dynamically for live Railway flips; invalid → disabled) ─────────
#
# Read on each call (mirrors backend/services/providers/router.py::_flag_on and
# the STARTER_CREDIT_ABUSE_MODE shadow precedent) so a mode flip takes effect
# without a restart. The canonical env var is also registered on
# backend.core.config.Config for discoverability; the runtime source of truth is
# this normalizing reader, which fails safe to `disabled`.
_ENV_MODE = "BUILD_PROVIDER_ROUTING_MODE"


def routing_mode() -> str:
    """Return the active routing mode: `disabled` (default) or `shadow`.

    Missing, blank, or unrecognized values resolve to `disabled` so a
    misconfiguration can never silently activate routing. Never raises."""
    try:
        raw = (os.getenv(_ENV_MODE, MODE_DISABLED) or "").strip().lower()
    except Exception:  # pragma: no cover — env access must never break a build
        return MODE_DISABLED
    return raw if raw in VALID_MODES else MODE_DISABLED


def _configured_claude_model() -> str:
    """The configured Claude model id from backend config — NO network call, NO
    provider request. Falls back to a safe default label if config is
    unavailable so the decision is always well-formed."""
    try:
        from backend.core.config import settings
        model = (getattr(settings, "MODEL_ANTHROPIC", "") or "").strip()
        return model or "claude-sonnet-4-6"
    except Exception:  # pragma: no cover — config import must never break a build
        return "claude-sonnet-4-6"


def _anthropic_provider_configured() -> bool:
    """True when an Anthropic API key is configured (bool only — the key value is
    never read out or logged). Advisory for the readiness view; the shadow
    decision does not depend on it."""
    try:
        from backend.core.config import settings
        return bool((getattr(settings, "ANTHROPIC_API_KEY", "") or "").strip())
    except Exception:  # pragma: no cover
        return False


# ── Deterministic policy ──────────────────────────────────────────────────────

def decide(task_kind: str, *, executed_model: str, routing_mode: str) -> BuildRoutingDecision:
    """Compute the routing decision for `task_kind`. Pure + total (no I/O beyond
    a config read). `executed_model` is the model the current OpenAI path is
    actually using — recorded as executed_* and reused as the fallback target.

    Target policy: Web Build planning/codegen/repairs and ALL App Build tasks
    would route to Claude; Web Build static review is deliberately kept on OpenAI
    (its structured-review contract is OpenAI-shaped). Execution is unaffected in
    Phase 1 regardless of what this returns."""
    executed_model = (executed_model or "").strip() or "unknown"

    if task_kind == TASK_WEB_STATIC_REVIEW:
        selected_provider = PROVIDER_OPENAI
        selected_model = executed_model
        reason = REASON_REVIEW_RETAINED_OPENAI
    elif task_kind in VALID_TASK_KINDS:
        selected_provider = PROVIDER_ANTHROPIC
        selected_model = _configured_claude_model()
        reason = REASON_PREFERS_CLAUDE
    else:
        # Defensive: callers only pass known kinds, but decide() stays total.
        selected_provider = PROVIDER_OPENAI
        selected_model = executed_model
        reason = REASON_UNROUTED

    return BuildRoutingDecision(
        task_kind=task_kind,
        selected_provider=selected_provider,
        selected_model=selected_model,
        fallback_provider=PROVIDER_OPENAI,
        fallback_model=executed_model,
        routing_mode=routing_mode,
        decision_reason=reason,
        policy_version=POLICY_VERSION,
        executed_provider=PROVIDER_OPENAI,
        executed_model=executed_model,
    )


# ── Task-kind classifiers (internal markers only — never user prose) ──────────

# The frontend task marker vocabulary emitted by
# backend.services.ai_client._frontend_task_kind(). Full-source generation and
# revision are code generation; the two repair markers map to their explicit
# repair kinds; both review markers map to static review. `unknown` is NOT a
# build task (no marker present) and is intentionally not routed.
_FRONTEND_KIND_TO_TASK: Dict[str, str] = {
    "initial-generation": TASK_WEB_CODEGEN,
    "revision": TASK_WEB_CODEGEN,
    "contract-repair": TASK_WEB_CONTRACT_REPAIR,
    "quality-repair": TASK_WEB_QUALITY_REPAIR,
    "initial-review": TASK_WEB_STATIC_REVIEW,
    "final-review": TASK_WEB_STATIC_REVIEW,
}


def web_task_from_frontend_kind(frontend_kind: Optional[str]) -> Optional[str]:
    """Map a `_frontend_task_kind()` value to a web_build task kind, or None when
    it is not a routable build task (`unknown` / absent marker)."""
    if not frontend_kind:
        return None
    return _FRONTEND_KIND_TO_TASK.get(str(frontend_kind).strip().lower())


# Orchestrator per-node `deliverable_kind` → app_build task kind. These mirror
# backend.services.generation.engine.PAGE_KINDS (renderable code pages) plus the
# file-scaffold and final-assembly kinds, kept as a LOCAL copy so this package
# has no import dependency on the generation engine (import safety). Any other
# content/strategy/design/research node is treated as planning. The orchestrator
# DAG has no dedicated repair node today, so TASK_APP_REPAIR is defined for
# policy completeness but is not currently emitted on this path.
_APP_CODE_DELIVERABLE_KINDS = frozenset({
    "landing_page_html", "app_prototype_html", "html", "web_page", "file_list",
})
_APP_REVIEW_DELIVERABLE_KINDS = frozenset({"final_package"})


def app_task_from_markers(spec_id: Optional[str], deliverable_kind: Optional[str]) -> str:
    """Map orchestrator internal markers (deliverable kind, spec id) to an
    app_build task kind. Deterministic; defaults to planning for non-code,
    non-assembly content nodes. Never raises."""
    kind = (deliverable_kind or "").strip().lower()
    if kind in _APP_CODE_DELIVERABLE_KINDS:
        return TASK_APP_CODEGEN
    if kind in _APP_REVIEW_DELIVERABLE_KINDS:
        return TASK_APP_REVIEW
    if kind:
        # A known content/strategy/design/research artifact → planning.
        return TASK_APP_PLANNING
    # No deliverable kind on the node — fall back to the spec role.
    return TASK_APP_CODEGEN if (spec_id or "").strip().lower() == "coder" else TASK_APP_PLANNING


# ── Bounded in-memory observability (owner diagnostics) ───────────────────────
#
# Fixed-shape counters keyed by (task_kind, selected_provider); bounded by the
# finite task-kind vocabulary so this can never grow unbounded. Process-local
# and best-effort — purely diagnostic, never authoritative.
_COUNTS_LOCK = threading.Lock()
_COUNTS: Dict[str, int] = {}
_LAST: Dict[str, str] = {}


def _record(decision: BuildRoutingDecision) -> None:
    key = f"{decision.task_kind}|{decision.selected_provider}"
    with _COUNTS_LOCK:
        _COUNTS[key] = _COUNTS.get(key, 0) + 1
        # Last decision snapshot (sanitized, non-secret) for the readiness view.
        _LAST.clear()
        _LAST.update({
            "task_kind": decision.task_kind,
            "selected_provider": decision.selected_provider,
            "selected_model": decision.selected_model,
            "executed_provider": decision.executed_provider,
            "executed_model": decision.executed_model,
            "decision_reason": decision.decision_reason,
        })


def _counters_snapshot() -> dict:
    with _COUNTS_LOCK:
        return {"by_task_provider": dict(_COUNTS), "last": dict(_LAST)}


def _log(decision: BuildRoutingDecision) -> None:
    """Bounded, sanitized shadow log. ONLY the allowed fields — never a prompt,
    user message, generated code, user id, project content, secret or header."""
    logger.info(
        "BUILD_ROUTING shadow | task_kind=%s | routing_mode=%s | shadow_provider=%s "
        "| shadow_model=%s | executed_provider=%s | executed_model=%s | decision_reason=%s "
        "| policy_version=%s",
        decision.task_kind, decision.routing_mode,
        decision.selected_provider, decision.selected_model,
        decision.executed_provider, decision.executed_model,
        decision.decision_reason, decision.policy_version,
    )


def _shadow(task_kind: Optional[str], executed_model: str) -> None:
    """Core decision-only seam. In `disabled` mode this is a complete no-op
    (nothing computed or logged). In `shadow` mode it computes the decision,
    records bounded metadata and emits one sanitized log line — and NOTHING
    else: no Anthropic call, no execution change, no return value the caller
    could act on. Never raises."""
    try:
        if not task_kind:
            return
        mode = routing_mode()
        if mode != MODE_SHADOW:
            return  # disabled (or any non-shadow) → exact current behavior
        decision = decide(task_kind, executed_model=executed_model, routing_mode=mode)
        _record(decision)
        _log(decision)
    except Exception:  # pragma: no cover — a shadow decision must never affect a build
        try:
            logger.debug("BUILD_ROUTING shadow decision soft-failed", exc_info=False)
        except Exception:
            pass


# ── Public seams called from the real execution paths (decision-only) ─────────

def note_web_build_frontend_task(frontend_kind: Optional[str], *, executed_model: str) -> None:
    """Web Build frontend sub-task (codegen / contract-repair / quality-repair /
    revision / static review). Decision-only; execution stays on OpenAI."""
    _shadow(web_task_from_frontend_kind(frontend_kind), executed_model)


def note_web_build_planning(*, executed_model: str, is_repair: bool = False) -> None:
    """Web Build website planning (initial or planning/design-plan repair — both
    map to web_build.planning). Decision-only; execution stays on OpenAI.
    `is_repair` is accepted for call-site clarity and does not change the
    task kind or the routing target."""
    _shadow(TASK_WEB_PLANNING, executed_model)


def note_app_build_agent_run(*, spec_id: Optional[str], deliverable_kind: Optional[str],
                             executed_model: str) -> None:
    """App Build / project-orchestrator agent.run node. Decision-only; execution
    stays on the pinned OpenAI model (gpt-4o-mini)."""
    _shadow(app_task_from_markers(spec_id, deliverable_kind), executed_model)


# ── Owner-only, read-only readiness view (no secrets / PII / network) ─────────

def describe_readiness() -> dict:
    """Sanitized snapshot of the routing policy for owner diagnostics. Pure +
    read-only: makes NO network/provider call and mutates nothing. Contains no
    secrets (the Anthropic key is reported only as a boolean), no PII, no
    prompts and no generated content."""
    mode = routing_mode()
    targets = {}
    for tk in sorted(VALID_TASK_KINDS):
        d = decide(tk, executed_model="(current-openai-model)", routing_mode=mode)
        targets[tk] = {
            "selected_provider": d.selected_provider,
            "selected_model": d.selected_model,
            "fallback_provider": d.fallback_provider,
            "decision_reason": d.decision_reason,
        }
    return {
        "policy_version": POLICY_VERSION,
        "routing_mode": mode,
        # Phase-1 invariants, surfaced so an operator can confirm safety:
        "shadow_only": True,
        "executes_anthropic": False,
        "active_mode_available": False,
        "anthropic_provider_configured": _anthropic_provider_configured(),
        "configured_claude_model": _configured_claude_model(),
        "supported_task_kinds": sorted(VALID_TASK_KINDS),
        "targets": targets,
        "counters": _counters_snapshot(),
    }


__all__ = [
    "routing_mode", "decide",
    "web_task_from_frontend_kind", "app_task_from_markers",
    "note_web_build_frontend_task", "note_web_build_planning", "note_app_build_agent_run",
    "describe_readiness",
]
