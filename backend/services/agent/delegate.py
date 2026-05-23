# coding: utf-8
# Phase 3.3 — Supervisor's `delegate` tool.
#
# delegate(agent_id, task, context_hint) spawns a sub-agent run with
# inherited context (run_id, project_id, project memory block, shared
# scratchpad). Only specs with can_delegate=True (Supervisor today)
# may call this. All other specs get a permission error.
#
# Safety primitives:
#   - Caller can_delegate check          (policy)
#   - Target spec exists                 (defensive lookup)
#   - Target spec MUST be can_delegate=False  (blocks recursive supervisors)
#   - ORCHESTRATOR_MAX_DEPTH             (depth cap; defends against any
#                                         future misconfig where a
#                                         specialist has can_delegate=True)
#   - ORCHESTRATOR_MAX_PARALLEL          (concurrent sub-agents in this run)
#   - ORCHESTRATOR_TOTAL_TOKEN_BUDGET    (cumulative estimate per run)
#
# Events emitted (when ENABLE_REALTIME_EVENTS=true):
#   - delegate.started
#   - delegate.returned    (on success)
#   - delegate.errored     (on any of: policy reject, exception, budget)
#
# Phase 3.3 does NOT register delegate as a tool in the tool_registry.
# It is callable as a Python function only. Phase 3.4 (/v2/orchestrate)
# wires it into the OpenAI tool-call surface for the Supervisor spec.

import asyncio
import logging
import os
from typing import Any, Dict, Optional

from backend.services.agent.run_context import (
    RunContext, start_run, get_current_run,
)
from backend.services.agent.specs import get_spec

logger = logging.getLogger(__name__)


# ── Configuration (env-overridable) ─────────────────────────────────────

def _max_depth() -> int:
    try:
        return max(1, int(os.getenv("ORCHESTRATOR_MAX_DEPTH", "2")))
    except ValueError:
        return 2


def _max_parallel() -> int:
    """Phase 4.1 — bumped from 3 → 5 to support the new autonomous panel
    (researcher + product_strategist + ux + brand + copywriter +
    coder/frontend = up to 6 specialists fanning out concurrently).
    Override via ORCHESTRATOR_MAX_PARALLEL if you need to throttle."""
    try:
        return max(1, int(os.getenv("ORCHESTRATOR_MAX_PARALLEL", "5")))
    except ValueError:
        return 5


def _total_token_budget() -> int:
    """Phase 4.1 — bumped from 40k → 80k. A 5-agent panel + supervisor
    planning + supervisor synthesis is ~7 LLM calls; 80k headroom keeps
    a complex 'build my SaaS landing page' run from hitting the cap
    mid-execution. Architecture quality > token optimization, per the
    Phase 4.1 brief."""
    try:
        return max(1000, int(os.getenv("ORCHESTRATOR_TOTAL_TOKEN_BUDGET", "80000")))
    except ValueError:
        return 80000


# Shared-scratch keys used by delegate to track per-run aggregates.
# All start with "_" so user/agent code is unlikely to collide.
_SCRATCH_IN_FLIGHT       = "_delegate_in_flight"
_SCRATCH_TOKENS_USED     = "_delegate_tokens_used"
_SCRATCH_DELEGATION_LOG  = "_delegate_history"


# ── Error envelopes ─────────────────────────────────────────────────────
#
# delegate returns a dict in EVERY case (success or failure). The
# orchestrator surfaces the dict back to the LLM as a tool result, so
# the LLM can read `ok` and recover. Never raises.

def _err(code: str, message: str, **extra) -> Dict[str, Any]:
    return {"ok": False, "code": code, "error": message[:300], **extra}


def _ok(*, reply: str, agent_id: str, run_id: str, **extra) -> Dict[str, Any]:
    return {
        "ok":       True,
        "reply":    reply,
        "agent_id": agent_id,
        "run_id":   run_id,
        **extra,
    }


# ── Token estimation (cheap heuristic) ──────────────────────────────────

def _estimate_tokens(text: str) -> int:
    """~4 chars/token rule of thumb. Good enough to enforce a soft
    cap; precise accounting happens upstream when we have provider
    `usage` plumbing (Phase 4-ish)."""
    return max(1, len(text or "") // 4)


# ── Event emission ──────────────────────────────────────────────────────

def _emit(kind: str, *, ctx: Optional[RunContext], payload: Dict[str, Any]) -> None:
    """Phase 3.2 emit helper, scoped to the parent run."""
    try:
        from backend.services.events import emit
        emit(
            kind,
            run_id=(ctx.run_id if ctx else None),
            project_id=(ctx.project_id if ctx else None),
            user_id=(ctx.user_id if ctx else None),
            payload=payload,
        )
    except Exception:
        pass


# ── Public API ──────────────────────────────────────────────────────────

def _build_ephemeral_spec(role: str, persona_summary: str) -> "AgentSpec":
    """Phase 4.1 — build a temporary AgentSpec for a role that isn't in
    the built-in registry and wasn't pre-created as a project agent.

    The spec inherits the closest matching role template (via
    default_system_prompt_for_role) and prepends the supervisor's
    persona summary on top. Lives only for the current orchestration
    run — never persisted to disk or to the spec registry.
    """
    from backend.services.agent.specs.types import AgentSpec
    from backend.services.agent.specs.role_templates import default_system_prompt_for_role
    import uuid as _uuid

    base_prompt = default_system_prompt_for_role(role)
    persona_summary = (persona_summary or "").strip()
    if persona_summary:
        composed_prompt = (
            f"PERSONA HINT (from Supervisor): {persona_summary}\n\n"
            f"You take that persona AND follow the role contract below verbatim:\n\n"
            f"{base_prompt}"
        )
    else:
        composed_prompt = base_prompt

    return AgentSpec(
        id=f"ephemeral-{role}-{_uuid.uuid4().hex[:8]}",
        name=(persona_summary[:50] or role.replace("_", " ").title() or "Specialist"),
        role=role,
        system_prompt=composed_prompt,
        allowed_tools=(),                # no tools for ephemeral by default
        default_model="gpt-4o-mini",
        max_steps=3,
        can_delegate=False,
        temperature=0.4,
        kind="ephemeral",
    )


async def spawn_and_delegate(
    *,
    role: str,
    persona_summary: str,
    task: str,
    context_hint: str = "",
    caller_spec_id: str = "supervisor",
    _run_agent_fn=None,
) -> Dict[str, Any]:
    """Phase 4.1 — autonomously spawn a temporary specialist for a role
    that isn't in the built-in roster, then delegate `task` to it.

    Uses the SAME execution pipeline as delegate() — caller authz,
    depth check, parallel check, token budget, event emissions, the
    works — so all the safety invariants apply identically.

    Returns the same envelope shape as delegate() so the calling LLM
    can treat both tools symmetrically.
    """
    parent_ctx = get_current_run()
    # Caller authorisation (must be can_delegate=True, same rule as delegate)
    caller_spec = get_spec(caller_spec_id) if caller_spec_id else None
    if caller_spec is None or not caller_spec.can_delegate:
        result = _err(
            "DELEGATE_FORBIDDEN",
            f"Caller {caller_spec_id!r} is not allowed to spawn specialists.",
        )
        _emit("delegate.errored", ctx=parent_ctx, payload={
            "caller": caller_spec_id, "agent_id": f"ephemeral:{role}",
            "code": result["code"], "error": result["error"],
        })
        return result

    target_spec = _build_ephemeral_spec(role, persona_summary)
    return await _execute_delegation(
        target_spec=target_spec,
        task=task,
        context_hint=context_hint,
        caller_spec_id=caller_spec_id,
        _run_agent_fn=_run_agent_fn,
    )


async def delegate(
    *,
    agent_id: str,
    task: str,
    context_hint: str = "",
    caller_spec_id: str = "supervisor",
    _run_agent_fn=None,
) -> Dict[str, Any]:
    """Spawn a sub-agent run for `agent_id` with `task` as the input.

    Args:
        agent_id:        target spec id (resolved via specs registry).
        task:            user-visible task description handed to the
                         sub-agent as its user_message.
        context_hint:    optional extra context appended to the task
                         (e.g. "previous researcher findings: …").
        caller_spec_id:  the spec id of the caller. Used to enforce
                         the can_delegate policy. Defaults to
                         "supervisor" — the only built-in spec
                         allowed to delegate.
        _run_agent_fn:   test-only override for the agent runtime.
                         Real callers leave this unset; it defaults to
                         backend.services.agent.runtime.run_agent.

    Returns a dict — never raises. On success:
        {"ok": True, "reply": str, "agent_id": str, "run_id": str,
         "steps_used": int, "tool_calls": int, "elapsed_ms": int}

    On policy/budget failure:
        {"ok": False, "code": str, "error": str}
    """
    parent_ctx = get_current_run()

    # ── 1. Caller authorisation ────────────────────────────────────────
    caller_spec = get_spec(caller_spec_id) if caller_spec_id else None
    if caller_spec is None or not caller_spec.can_delegate:
        result = _err(
            "DELEGATE_FORBIDDEN",
            f"Caller {caller_spec_id!r} is not allowed to delegate.",
        )
        _emit("delegate.errored", ctx=parent_ctx, payload={
            "caller": caller_spec_id, "agent_id": agent_id,
            "code": result["code"], "error": result["error"],
        })
        return result

    # ── 2. Target spec lookup ──────────────────────────────────────────
    target_spec = get_spec((agent_id or "").strip())
    if target_spec is None:
        result = _err(
            "AGENT_NOT_FOUND",
            f"Unknown agent_id {agent_id!r}.",
        )
        _emit("delegate.errored", ctx=parent_ctx, payload={
            "caller": caller_spec_id, "agent_id": agent_id,
            "code": result["code"], "error": result["error"],
        })
        return result

    # ── 3-8. Shared execution pipeline ────────────────────────────────
    return await _execute_delegation(
        target_spec=target_spec,
        task=task,
        context_hint=context_hint,
        caller_spec_id=caller_spec_id,
        _run_agent_fn=_run_agent_fn,
    )


async def _execute_delegation(
    *,
    target_spec,
    task: str,
    context_hint: str,
    caller_spec_id: str,
    _run_agent_fn,
) -> Dict[str, Any]:
    """Phase 4.1 — shared execution body for delegate() and
    spawn_and_delegate(). Takes a fully-resolved AgentSpec and runs
    the recursion / depth / parallel / budget checks before spawning
    the child run. Extracted so ephemeral and registered specs share
    the same safety invariants.
    """
    parent_ctx = get_current_run()
    agent_id = target_spec.id

    # ── 3. Recursion guard ─────────────────────────────────────────────
    # Sub-agent specs MUST NOT can_delegate. Today only Supervisor
    # has can_delegate=True; if a hypothetical 'sub-supervisor' ever
    # exists, the depth check below also fires.
    if target_spec.can_delegate:
        result = _err(
            "DELEGATE_TO_DELEGATOR_BLOCKED",
            f"Target {agent_id!r} is a delegating agent; "
            f"recursive supervisors are not allowed.",
        )
        _emit("delegate.errored", ctx=parent_ctx, payload={
            "caller": caller_spec_id, "agent_id": agent_id,
            "code": result["code"], "error": result["error"],
        })
        return result

    # ── 4. Depth check ────────────────────────────────────────────────
    parent_depth = parent_ctx.depth if parent_ctx else 0
    child_depth  = parent_depth + 1
    max_depth    = _max_depth()
    if child_depth > max_depth:
        result = _err(
            "DEPTH_LIMIT_EXCEEDED",
            f"Delegation would exceed max depth (have depth={parent_depth}, "
            f"child would be depth={child_depth}, ORCHESTRATOR_MAX_DEPTH={max_depth}).",
        )
        _emit("delegate.errored", ctx=parent_ctx, payload={
            "caller": caller_spec_id, "agent_id": agent_id,
            "code": result["code"], "error": result["error"],
            "depth": parent_depth, "max_depth": max_depth,
        })
        return result

    # ── 5. Parallel / token-budget check (shared scratch) ──────────────
    shared_scratch: Dict[str, Any] = (
        parent_ctx.scratch if parent_ctx else {}
    )
    in_flight = int(shared_scratch.get(_SCRATCH_IN_FLIGHT, 0))
    max_parallel = _max_parallel()
    if in_flight >= max_parallel:
        result = _err(
            "PARALLEL_LIMIT_EXCEEDED",
            f"Already {in_flight} sub-agents in flight; "
            f"ORCHESTRATOR_MAX_PARALLEL={max_parallel}.",
        )
        _emit("delegate.errored", ctx=parent_ctx, payload={
            "caller": caller_spec_id, "agent_id": agent_id,
            "code": result["code"], "error": result["error"],
            "in_flight": in_flight, "max_parallel": max_parallel,
        })
        return result

    tokens_used = int(shared_scratch.get(_SCRATCH_TOKENS_USED, 0))
    budget      = _total_token_budget()
    if tokens_used >= budget:
        result = _err(
            "TOKEN_BUDGET_EXCEEDED",
            f"Used ~{tokens_used} tokens; "
            f"ORCHESTRATOR_TOTAL_TOKEN_BUDGET={budget}.",
        )
        _emit("delegate.errored", ctx=parent_ctx, payload={
            "caller": caller_spec_id, "agent_id": agent_id,
            "code": result["code"], "error": result["error"],
            "tokens_used": tokens_used, "token_budget": budget,
        })
        return result

    # ── 6. Build the sub-agent request ─────────────────────────────────
    composed_message = task.strip()
    if context_hint:
        composed_message += f"\n\n[Context from supervisor]\n{context_hint.strip()}"

    # Lazy import to avoid a circular dependency: runtime → events →
    # (no agent imports) but agent.delegate → runtime is fine because
    # tests can stub via _run_agent_fn.
    if _run_agent_fn is None:
        from backend.services.agent.runtime import run_agent as _real_run
        run_agent = _real_run
    else:
        run_agent = _run_agent_fn

    from backend.services.agent.types import AgentRequest

    sub_request = AgentRequest(
        user_message=composed_message,
        # mode=spec.id is intentional: when tools_for_mode() (tool_bridge.py)
        # doesn't recognize the spec.id it returns []. Specialists are
        # therefore LLM-only in Phase 3.3 — they reason from their
        # persona + the project context. Per-spec tool whitelisting
        # lands in Phase 3.4 (/v2/orchestrate) where spec.allowed_tools
        # plugs into the tool registry path.
        mode=target_spec.id,
        user_id=(parent_ctx.user_id if parent_ctx else ""),
        model=target_spec.default_model,
        temperature=target_spec.temperature,
        max_tokens=1200,
        system_prompt=target_spec.system_prompt,
        max_steps=target_spec.max_steps,
        metadata_in={
            "delegated_from":  caller_spec_id,
            "spec_kind":       target_spec.kind,
        },
    )

    # ── 7. Reserve a parallel slot + spawn ─────────────────────────────
    shared_scratch[_SCRATCH_IN_FLIGHT] = in_flight + 1
    history_entry = {
        "from":     caller_spec_id,
        "to":       target_spec.id,
        "task":     composed_message[:200],
        "depth":    child_depth,
    }
    shared_scratch.setdefault(_SCRATCH_DELEGATION_LOG, []).append(history_entry)

    _emit("delegate.started", ctx=parent_ctx, payload={
        "caller":   caller_spec_id,
        "agent_id": target_spec.id,
        "depth":    child_depth,
        "task":     composed_message[:200],
    })

    try:
        # Push a child RunContext that INHERITS parent's run_id, project_id,
        # project_context_block, AND the same scratch dict (by reference)
        # but has parent_agent=caller and depth=child_depth.
        if parent_ctx is None:
            # No parent run — caller is invoking delegate from outside an
            # orchestration (typically a test). Synthesize a root-ish
            # context anchored to the sub-agent's run.
            handle = start_run(
                user_id=sub_request.user_id or "",
                project_id=None,
                parent_agent=caller_spec_id,
                depth=child_depth,
                scratch=shared_scratch,
                metadata={"entry": "delegate", "target": target_spec.id},
            )
        else:
            handle = start_run(
                user_id=parent_ctx.user_id,
                project_id=parent_ctx.project_id,
                parent_agent=caller_spec_id,
                run_id=parent_ctx.run_id,
                project_context_block=parent_ctx.project_context_block,
                depth=child_depth,
                scratch=shared_scratch,
                metadata={"entry": "delegate", "target": target_spec.id},
            )

        try:
            response = await run_agent(sub_request)
        finally:
            handle.close()

    except Exception as exc:  # pragma: no cover — runtime is supposed to swallow
        logger.exception("delegate runtime raised unexpectedly: %s", exc)
        shared_scratch[_SCRATCH_IN_FLIGHT] = max(0, in_flight)
        result = _err(
            "SUBAGENT_EXCEPTION",
            f"{type(exc).__name__}: {exc}",
        )
        _emit("delegate.errored", ctx=parent_ctx, payload={
            "caller": caller_spec_id, "agent_id": target_spec.id,
            "code": result["code"], "error": result["error"],
        })
        return result
    finally:
        # Release the parallel slot — even if budget bookkeeping fails.
        shared_scratch[_SCRATCH_IN_FLIGHT] = max(0, in_flight)

    # ── 8. Update token estimate + emit success ────────────────────────
    delta = _estimate_tokens(composed_message) + _estimate_tokens(response.reply or "")
    shared_scratch[_SCRATCH_TOKENS_USED] = tokens_used + delta

    payload_meta = {
        "caller":      caller_spec_id,
        "agent_id":    target_spec.id,
        "depth":       child_depth,
        "reply_chars": len(response.reply or ""),
        "steps_used":  getattr(response, "steps_used", 0),
        "tool_calls":  getattr(response, "tool_calls", 0),
        "elapsed_ms":  getattr(response, "elapsed_ms", 0),
        "tokens_estimate": delta,
    }
    _emit("delegate.returned", ctx=parent_ctx, payload=payload_meta)

    return _ok(
        reply=response.reply or "",
        agent_id=target_spec.id,
        run_id=(parent_ctx.run_id if parent_ctx else "-"),
        steps_used=getattr(response, "steps_used", 0),
        tool_calls=getattr(response, "tool_calls", 0),
        elapsed_ms=getattr(response, "elapsed_ms", 0),
        depth=child_depth,
    )


__all__ = [
    "delegate",
]
