# coding: utf-8
# Phase A1 — Agent runtime.
#
# Implements the loop sketched in KORVIX_OS_ROADMAP.md § 8.2:
#
#   AgentRequest → LLM pass → (no tool calls? → reply, done)
#                          → (tool calls?    → dispatch in parallel, append
#                                              tool results, loop)
#   On budget exhaust → one final "summarize what you found" LLM pass with
#                       partial=true.
#
# OpenAI tool-calling does the planning natively — there is no bespoke planner.
# The LLM IS the planner. The reflector is "did the model emit tool_calls?"
# The executor is the dispatch_many call.
#
# Returns AgentResponse — never raises. Failures inside the loop produce a
# fallback AgentResponse with `fallback=True` so the caller can decide
# whether to fall back to the legacy path.
import os
import time
import json
import logging
import asyncio
import threading
from typing import Any, Optional

from backend.services.agent.types import AgentRequest, AgentResponse, AgentStep
from backend.services.agent.budget import Budget
from backend.services.agent.tool_bridge import (
    tools_for_mode, dispatch_many,
    tools_for_spec, dispatch_with_orchestration,
)
from backend.services.agent.run_context import start_run, get_current_run

logger = logging.getLogger(__name__)


# ── Observability counters (surfaced via /tools/health) ─────────────────────
_LOCK   = threading.Lock()
_COUNTS = {
    "runs_total":      0,
    "runs_partial":    0,
    "runs_fallback":   0,
    "runs_errored":    0,
    "tool_calls":      0,
    "llm_passes":      0,
    "last_error":      "",
    "last_run_mode":   "",
}


def _bump(k: str, n: int = 1, msg: str = "") -> None:
    with _LOCK:
        _COUNTS[k] = _COUNTS.get(k, 0) + n
        if msg:
            _COUNTS["last_error"] = msg[:140]


def stats() -> dict:
    with _LOCK:
        return {
            **_COUNTS,
            "max_steps":         int(os.getenv("AGENT_MAX_STEPS", "6")),
            "max_wall_seconds":  float(os.getenv("AGENT_MAX_WALL_SECONDS", "25")),
            "max_parallel_tools": int(os.getenv("AGENT_MAX_PARALLEL_TOOLS", "3")),
            "enabled":           is_enabled(),
        }


def is_enabled() -> bool:
    return os.getenv("ENABLE_AGENT", "false").strip().lower() == "true"


# ── Public entry point ──────────────────────────────────────────────────────

async def run_agent(request: AgentRequest) -> AgentResponse:
    """
    Run one agent invocation end-to-end. Returns an AgentResponse — never raises.

    When ENABLE_AGENT=false this still runs (so unit tests work); callers gate
    on the flag themselves (ai_service does this).

    Phase 3.1 — wrapped so a RunContext is pushed onto the ContextVar for
    the duration of this run UNLESS one is already active (the
    orchestrator, when wired in Phase 3.3, owns the outer context and
    delegates spawn nested run_agent calls that should INHERIT, not
    overwrite, the parent's run_id / project_id / scratchpad). The
    wrap is a thin shim — the existing body lives in _run_agent_body
    unchanged so the behavior is byte-identical when no orchestrator
    is active.
    """
    if get_current_run() is not None:
        # Already inside an orchestration run — sub-agent path.
        # Inherit; don't push a new context.
        return await _run_agent_body(request)
    with start_run(
        user_id=request.user_id,
        metadata={
            "mode":  request.mode,
            "model": request.model,
            "entry": "run_agent",
        },
    ):
        return await _run_agent_body(request)


async def _run_agent_body(request: AgentRequest) -> AgentResponse:
    """The pre-Phase-3.1 run_agent body. Kept unchanged — every code
    path inside still works because RunContext threading is opt-in and
    read-only from this function's perspective.

    Phase 3.2 — emits `agent.started` at entry and `agent.finished` at
    exit (via a final-emit shim around the inner body). Emissions are
    no-ops when ENABLE_REALTIME_EVENTS=false."""
    _emit_agent_started(request)
    try:
        result = await _run_agent_inner(request)
    except Exception:
        # The pre-existing body catches everything internally — this
        # branch is a defensive last resort. We still want agent.finished
        # to fire so subscribers see the lifecycle terminate.
        _emit_agent_finished(request, None)
        raise
    _emit_agent_finished(request, result)
    return result


def _emit_agent_started(request: AgentRequest) -> None:
    """Phase 3.2 — emit agent.started. Reads run_id / project_id from
    the active RunContext when present so events carry full context."""
    try:
        from backend.services.events import emit
        ctx = get_current_run()
        emit(
            "agent.started",
            run_id=(ctx.run_id if ctx else None),
            project_id=(ctx.project_id if ctx else None),
            user_id=(ctx.user_id if ctx else request.user_id),
            agent_id=request.mode,  # mode is the closest stable id today
            payload={
                "mode":   request.mode,
                "model":  request.model,
                "msg_chars": len(request.user_message or ""),
            },
        )
    except Exception:
        pass


def _emit_agent_finished(request: AgentRequest, response: Optional[AgentResponse]) -> None:
    try:
        from backend.services.events import emit
        ctx = get_current_run()
        emit(
            "agent.finished",
            run_id=(ctx.run_id if ctx else None),
            project_id=(ctx.project_id if ctx else None),
            user_id=(ctx.user_id if ctx else request.user_id),
            agent_id=request.mode,
            payload={
                "mode":         request.mode,
                "model":        request.model,
                "reply_chars":  len(response.reply) if response and response.reply else 0,
                "steps_used":   response.steps_used if response else 0,
                "tool_calls":   response.tool_calls if response else 0,
                "elapsed_ms":   response.elapsed_ms if response else 0,
                "partial":      bool(response.partial) if response else False,
                "fallback":     bool(response.fallback) if response else True,
            },
        )
    except Exception:
        pass


def _emit_tool_called(call: dict) -> None:
    """Phase 3.2 — emit tool.called for a single tool invocation."""
    try:
        from backend.services.events import emit
        ctx = get_current_run()
        emit(
            "tool.called",
            run_id=(ctx.run_id if ctx else None),
            project_id=(ctx.project_id if ctx else None),
            user_id=(ctx.user_id if ctx else None),
            payload={
                "tool":          call.get("name"),
                "tool_call_id":  call.get("tool_call_id"),
                "args_summary":  _summarize_args(call.get("args") or {}),
            },
        )
    except Exception:
        pass


def _emit_tool_result(call: dict, result: dict) -> None:
    """Phase 3.2 — emit tool.completed or tool.errored based on result.ok."""
    try:
        from backend.services.events import emit
        ctx = get_current_run()
        ok = bool(result.get("ok"))
        emit(
            "tool.completed" if ok else "tool.errored",
            run_id=(ctx.run_id if ctx else None),
            project_id=(ctx.project_id if ctx else None),
            user_id=(ctx.user_id if ctx else None),
            payload={
                "tool":         result.get("name") or call.get("name"),
                "tool_call_id": result.get("tool_call_id") or call.get("tool_call_id"),
                "ok":           ok,
                "error":        (result.get("error") or "")[:200] if not ok else None,
            },
        )
    except Exception:
        pass


def _summarize_args(args: dict) -> dict:
    """Truncate noisy arg values so event payloads stay small."""
    out = {}
    for k, v in list(args.items())[:8]:
        if isinstance(v, str):
            out[k] = v[:80] + ("…" if len(v) > 80 else "")
        elif isinstance(v, (int, float, bool)) or v is None:
            out[k] = v
        elif isinstance(v, (list, tuple)):
            out[k] = f"<list[{len(v)}]>"
        elif isinstance(v, dict):
            out[k] = f"<dict[{len(v)}]>"
        else:
            out[k] = f"<{type(v).__name__}>"
    return out


async def _run_agent_inner(request: AgentRequest) -> AgentResponse:
    """The original run_agent body. Pulled out so _run_agent_body can
    bracket it with Phase 3.2 agent.started/finished emissions without
    re-indenting every return path."""
    with _LOCK:
        _COUNTS["runs_total"]    += 1
        _COUNTS["last_run_mode"]  = request.mode

    # Phase 7c — honour per-request max_steps when provided. Uses
    # `is not None` (matching tool_bridge's per-tool timeout fix in
    # the same PR) so a future explicit max_steps=0 is passed through
    # rather than silently falling back. Budget's own API treats 0
    # as "use AGENT_MAX_STEPS env"; we forward the caller's intent
    # at this layer to keep the semantics consistent.
    budget = Budget(
        max_steps=request.max_steps if request.max_steps is not None else 0,
    )
    trace:  list[AgentStep] = []

    # Build OpenAI tool list. Phase 3.4 — when the caller attached an
    # AgentSpec to the request (orchestrator path), the spec's
    # allowed_tools whitelist drives the tool list. Otherwise we fall
    # back to the legacy mode→tools mapping so /chat behaviour is
    # byte-identical.
    _spec = getattr(request, "spec", None)
    if not getattr(request, "allow_tools", True):
        # Tool calling explicitly disabled for this request (project-run
        # path). No tools exposed → no tool_calls → single LLM pass.
        tools = []
    elif _spec is not None:
        tools = tools_for_spec(_spec)
    else:
        tools = tools_for_mode(request.mode)

    # Compose messages list
    messages: list[dict] = []
    if request.system_prompt:
        messages.append({"role": "system", "content": request.system_prompt})
    for r, c in (request.history or []):
        # history is a list of (role, content) tuples per ai_client convention
        if r in ("user", "assistant", "system"):
            messages.append({"role": r, "content": c})
    messages.append({"role": "user", "content": request.user_message})

    try:
        client = _openai_client()
    except Exception as exc:
        _bump("runs_errored", msg=f"openai_client: {exc}")
        return _fallback_response(request, trace, budget, reason=f"openai_client: {exc}")

    # ── Main loop ───────────────────────────────────────────────────────────
    while not budget.exhausted():
        # llm_pass
        step_started = time.monotonic()
        try:
            completion = await asyncio.wait_for(
                client.chat.completions.create(
                    model=request.model,
                    messages=messages,
                    temperature=request.temperature,
                    max_tokens=request.max_tokens,
                    tools=tools or None,
                    tool_choice=("auto" if tools else None),
                ),
                timeout=max(2.0, budget.remaining_seconds() - 0.5),
            )
        except asyncio.TimeoutError:
            trace.append(AgentStep(
                kind="llm_pass", started_at=step_started,
                duration_ms=int((time.monotonic() - step_started) * 1000),
                ok=False, error="llm_timeout",
            ))
            _bump("runs_errored", msg="llm_timeout")
            break
        except Exception as exc:
            trace.append(AgentStep(
                kind="llm_pass", started_at=step_started,
                duration_ms=int((time.monotonic() - step_started) * 1000),
                ok=False, error=f"llm_exception: {exc}",
            ))
            _bump("runs_errored", msg=f"llm_exception: {exc}")
            break

        budget.bump_step(1)
        _bump("llm_passes")

        choice  = completion.choices[0]
        message = choice.message
        tool_calls = getattr(message, "tool_calls", None) or []

        # Record the llm_pass step
        trace.append(AgentStep(
            kind="llm_pass",
            started_at=step_started,
            duration_ms=int((time.monotonic() - step_started) * 1000),
            output={
                "finish_reason": getattr(choice, "finish_reason", None),
                "tool_calls":    len(tool_calls),
                "reply_chars":   len(message.content or "") if not tool_calls else 0,
            },
            ok=True,
        ))

        # No tool calls → final reply
        if not tool_calls:
            reply = (message.content or "").strip() or "(no reply)"
            return AgentResponse(
                reply=reply,
                mode=request.mode,
                model=request.model,
                provider="openai",
                trace=trace,
                steps_used=budget.steps_used,
                elapsed_ms=budget.elapsed_ms(),
                tool_calls=budget.tool_calls,
            )

        # Tool calls → dispatch
        # Append the assistant message with its tool_calls so OpenAI sees the round
        messages.append(_dump_assistant_message(message))

        # Cap parallelism per step
        pending = []
        for tc in tool_calls:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except Exception:
                args = {}
            pending.append({
                "tool_call_id": tc.id,
                "name":         tc.function.name,
                "args":         args,
            })
        pending = budget.cap_parallel(pending)

        # Reserve step budget for the tool calls (each counts as one step)
        if budget.remaining_steps() < len(pending):
            pending = pending[: budget.remaining_steps()]
            if not pending:
                # No room left for any more tool calls — break and let the
                # final-summary pass handle it.
                break

        # Phase 3.2 — emit tool.called for each pending tool invocation
        # BEFORE dispatch so subscribers see "I started X" without
        # waiting for the result. Emit is a no-op when the flag is off.
        for _pc in pending:
            _emit_tool_called(_pc)

        # Phase 3.4 — when running with a spec (orchestrator path), use
        # dispatch_with_orchestration so any `delegate` tool_calls route
        # through the Phase 3.3 delegate primitive. Without a spec
        # (legacy /chat agent path), the regular dispatch_many runs —
        # behaviour is byte-identical to pre-3.4.
        if _spec is not None:
            results = await dispatch_with_orchestration(
                pending,
                caller_spec_id=getattr(_spec, "id", ""),
                timeout=12.0,
            )
        else:
            results = await dispatch_many(pending, timeout=12.0)
        budget.bump_tool_calls(len(results))
        _bump("tool_calls", len(results))

        # Phase 3.2 — emit tool.completed (ok=true) or tool.errored
        # (ok=false) for each result. Mirrors the pending iteration so
        # subscribers can pair started → completed by tool_call_id.
        for _pc, _r in zip(pending, results):
            _emit_tool_result(_pc, _r)

        for tc, r in zip(pending, results):
            trace.append(AgentStep(
                kind="tool_call",
                name=r["name"],
                args=tc.get("args"),
                output=_truncated_output_for_trace(r),
                ok=r["ok"],
                error=r.get("error"),
            ))
            # Append a tool message reply so the next loop iteration sees it.
            content = json.dumps(r.get("output") or {"error": r.get("error")}, default=str)
            messages.append({
                "role":         "tool",
                "tool_call_id": r["tool_call_id"],
                "content":      content,
            })

        # If we have no budget for another LLM pass, break and emit final summary
        if budget.remaining_steps() <= 0 or budget.remaining_seconds() <= 1.0:
            break

    # ── Budget exhausted mid-loop — final summary pass ──────────────────────
    try:
        messages.append({
            "role": "user",
            "content": (
                "Summarize what you've found so far in a final user-facing answer. "
                "Do not call any more tools."
            ),
        })
        final = await asyncio.wait_for(
            client.chat.completions.create(
                model=request.model,
                messages=messages,
                temperature=max(0.0, request.temperature - 0.1),
                max_tokens=request.max_tokens,
            ),
            timeout=max(2.0, min(8.0, budget.remaining_seconds() + 5.0)),
        )
        reply = (final.choices[0].message.content or "").strip() or "(no final reply)"
        trace.append(AgentStep(
            kind="llm_pass",
            output={"final_summary": True, "reply_chars": len(reply)},
            ok=True,
        ))
        _bump("runs_partial")
        return AgentResponse(
            reply=reply,
            mode=request.mode,
            model=request.model,
            provider="openai",
            trace=trace,
            steps_used=budget.steps_used + 1,
            elapsed_ms=budget.elapsed_ms(),
            partial=True,
            tool_calls=budget.tool_calls,
        )
    except Exception as exc:
        _bump("runs_errored", msg=f"final_summary: {exc}")
        return _fallback_response(request, trace, budget, reason=f"final_summary: {exc}")


# ── Helpers ─────────────────────────────────────────────────────────────────

def _openai_client():
    """Lazy openai.AsyncOpenAI client — same pattern as ai_client.py."""
    import openai  # noqa: PLC0415
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("OPENAI_API_KEY missing")
    return openai.AsyncOpenAI(api_key=key)


def _dump_assistant_message(msg) -> dict:
    """Serialize an OpenAI assistant message (with tool_calls) for re-posting."""
    out: dict[str, Any] = {"role": "assistant", "content": msg.content or ""}
    tcs = []
    for tc in (getattr(msg, "tool_calls", None) or []):
        tcs.append({
            "id":   tc.id,
            "type": "function",
            "function": {
                "name":      tc.function.name,
                "arguments": tc.function.arguments,
            },
        })
    if tcs:
        out["tool_calls"] = tcs
    return out


def _truncated_output_for_trace(result: dict) -> dict:
    """Shrink tool result for the trace payload (keeps response light)."""
    o = result.get("output") or {}
    return {
        "ok":        result.get("ok"),
        "truncated": result.get("truncated", False),
        "raw_chars": result.get("raw_chars", 0),
        "keys":      sorted(list(o.keys()))[:12] if isinstance(o, dict) else [],
    }


def _fallback_response(
    request: AgentRequest,
    trace: list[AgentStep],
    budget: Budget,
    *,
    reason: str,
) -> AgentResponse:
    trace.append(AgentStep(kind="fallback", ok=False, error=reason))
    _bump("runs_fallback")
    return AgentResponse(
        reply="",   # empty so the caller knows to use the legacy reply
        mode=request.mode,
        model=request.model,
        provider="openai",
        trace=trace,
        steps_used=budget.steps_used,
        elapsed_ms=budget.elapsed_ms(),
        fallback=True,
        tool_calls=budget.tool_calls,
        metadata={"fallback_reason": reason},
    )


__all__ = ["run_agent", "stats", "is_enabled"]
