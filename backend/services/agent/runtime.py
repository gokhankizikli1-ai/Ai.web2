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
from backend.services.agent.tool_bridge import tools_for_mode, dispatch_many

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
    """
    with _LOCK:
        _COUNTS["runs_total"]    += 1
        _COUNTS["last_run_mode"]  = request.mode

    budget = Budget()
    trace:  list[AgentStep] = []

    # Build OpenAI tool list (may be empty when no tool is enabled for this mode)
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

        results = await dispatch_many(pending, timeout=12.0)
        budget.bump_tool_calls(len(results))
        _bump("tool_calls", len(results))

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
