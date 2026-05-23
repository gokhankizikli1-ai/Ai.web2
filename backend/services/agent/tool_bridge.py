# coding: utf-8
# Phase A1 — Tool bridge.
#
# Adapts the existing BaseTool registry (Phase 4A) to OpenAI's function-calling
# format and dispatches tool_call payloads back into the tool registry. This
# is the agent's ONLY entry point into tools — every other layer (runtime,
# planner, reflector) speaks the OpenAI tool-call protocol, not BaseTool.
#
# Why a bridge:
#   * The agent loop should not know about BaseTool internals — that lets us
#     swap the substrate (e.g. add MCP-style tools) without changing runtime.
#   * Tool output sizes must be truncated before re-feeding into the LLM.
#   * Some tool names contain characters OpenAI dislikes; we normalize.
import json
import logging
import asyncio
from typing import Any, Optional

from backend.services.tools.tool_orchestrator import _MODE_TOOL_MAP

logger = logging.getLogger(__name__)

# OpenAI cap on tool name + tool result length before truncation.
_MAX_TOOL_RESULT_CHARS = 6000


# ── Tool descriptions surfaced to the model ─────────────────────────────────
#
# We use the tool's `description` attribute when available, otherwise a fallback.
# Parameters schema is intentionally permissive (open object) in A1 so we don't
# need to maintain per-tool schemas yet; the model passes free-form JSON args
# and the tool decides what to do. Tools that want strict args will declare
# `openai_parameters` on themselves in a follow-up PR.

_FALLBACK_DESC = "Run the tool with the supplied free-form arguments."

_DEFAULT_PARAMS_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "query": {
            "type": "string",
            "description": "Free-form query / question for the tool. May be empty.",
        },
        "symbol": {
            "type": "string",
            "description": "Optional asset symbol (e.g. BTCUSDT).",
        },
        "timeframe": {
            "type": "string",
            "description": "Optional candle interval (e.g. 1h, 4h, 1d).",
        },
    },
    "additionalProperties": True,
}


# ── Build OpenAI tool list ──────────────────────────────────────────────────

def tools_for_mode(mode: str) -> list[dict]:
    """
    Return the OpenAI `tools` parameter for a given mode.

    Filters the BaseTool registry by the mode's declared tool list (from
    tool_orchestrator._MODE_TOOL_MAP). Tools that are disabled via env flags
    are EXCLUDED so the model never tries to call something it cannot.
    """
    try:
        from backend.services.tools.tool_registry import get_tool, is_enabled
    except Exception as exc:
        logger.warning("agent.tool_bridge: registry import failed: %s", exc)
        return []

    tool_names = _MODE_TOOL_MAP.get(mode, [])
    out: list[dict] = []
    for name in tool_names:
        if not is_enabled(name):
            continue
        tool = get_tool(name)
        if tool is None:
            continue
        out.append({
            "type": "function",
            "function": {
                "name":        _normalize_tool_name(name),
                "description": getattr(tool, "description", "") or _FALLBACK_DESC,
                "parameters":  getattr(tool, "openai_parameters", None) or _DEFAULT_PARAMS_SCHEMA,
            },
        })
    return out


# ── Phase 3.4 — spec-aware tool list + delegate tool descriptor ─────────────
#
# When the runtime is called with an AgentSpec attached (orchestrator
# path), the tool list comes from spec.allowed_tools — NOT the
# mode→tools table. This is what lets specialist agents have a
# different toolset from the legacy /chat modes without forcing one
# global mapping. The supervisor additionally gets the special
# `delegate` tool when spec.can_delegate=True.

def _delegate_tool_descriptor() -> dict:
    """OpenAI function-call schema for `delegate`. Enum of target ids
    is generated from BUILTIN_AGENT_IDS so adding a new built-in spec
    automatically appears in the supervisor's choices."""
    try:
        from backend.services.agent.specs import BUILTIN_AGENT_IDS
        # supervisor is excluded — it never delegates to itself or to
        # other delegators (Phase 3.3 guard).
        candidates = [aid for aid in BUILTIN_AGENT_IDS if aid != "supervisor"]
    except Exception:
        candidates = ["researcher", "coder", "trader", "marketer", "strategist"]
    return {
        "type": "function",
        "function": {
            "name": "delegate",
            "description": (
                "Hand a scoped task to a specialist sub-agent and return its reply. "
                "Use this when the request needs a specialist's persona or tools. "
                "Make the task self-contained — the sub-agent does NOT see the user's "
                "original message, only what you pass in `task`."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {
                        "type": "string",
                        "enum": candidates,
                        "description": "Which specialist to invoke.",
                    },
                    "task": {
                        "type": "string",
                        "description": (
                            "Scoped task description for the sub-agent. "
                            "Be specific — include any constraints or output format you want."
                        ),
                    },
                    "context_hint": {
                        "type": "string",
                        "description": (
                            "Optional — extra context from prior sub-agents' findings "
                            "or your reasoning so far. Keep under 500 characters."
                        ),
                    },
                },
                "required": ["agent_id", "task"],
                "additionalProperties": False,
            },
        },
    }


def tools_for_spec(spec) -> list[dict]:
    """Build the OpenAI `tools` parameter from an AgentSpec.allowed_tools
    whitelist. Mirrors tools_for_mode's filtering (env-disabled tools
    are dropped) but uses the spec as the source of truth — not the
    legacy mode→tools table.

    Special handling: 'delegate' isn't in the BaseTool registry; it's
    an orchestrator primitive. Included only when spec.can_delegate=True.
    """
    try:
        from backend.services.tools.tool_registry import get_tool, is_enabled
    except Exception as exc:
        logger.warning("agent.tool_bridge: registry import failed: %s", exc)
        return []

    out: list[dict] = []
    for name in (getattr(spec, "allowed_tools", ()) or ()):
        if name == "delegate":
            if getattr(spec, "can_delegate", False):
                out.append(_delegate_tool_descriptor())
            continue
        if not is_enabled(name):
            continue
        tool = get_tool(name)
        if tool is None:
            continue
        out.append({
            "type": "function",
            "function": {
                "name":        _normalize_tool_name(name),
                "description": getattr(tool, "description", "") or _FALLBACK_DESC,
                "parameters":  getattr(tool, "openai_parameters", None) or _DEFAULT_PARAMS_SCHEMA,
            },
        })
    return out


async def dispatch_with_orchestration(
    pending: list[dict],
    *,
    caller_spec_id: str,
    timeout: float = 12.0,
) -> list[dict]:
    """Dispatch a step's pending tool calls, routing `delegate` calls
    through the Phase 3.3 delegate primitive and everything else
    through dispatch_many.

    Preserves the input order: returns results aligned with `pending`.
    `delegate` calls run concurrently with each other AND with the
    regular tool dispatch — same fan-out semantics as dispatch_many.
    """
    if not pending:
        return []

    delegate_indices = [i for i, c in enumerate(pending) if c.get("name") == "delegate"]
    if not delegate_indices:
        # Fast path — no delegation in this step, just use existing dispatcher
        return await dispatch_many(pending, timeout=timeout)

    other_indices = [i for i, c in enumerate(pending) if c.get("name") != "delegate"]
    results: list = [None] * len(pending)

    # Build the delegate tasks
    from backend.services.agent.delegate import delegate as _delegate_fn

    async def _run_delegate(idx: int) -> tuple[int, dict]:
        call = pending[idx]
        args = call.get("args") or {}
        agent_id     = (args.get("agent_id") or "").strip()
        task         = (args.get("task") or "").strip()
        context_hint = (args.get("context_hint") or "").strip()
        if not agent_id or not task:
            return idx, {
                "ok":           False,
                "name":         "delegate",
                "tool_call_id": call.get("tool_call_id"),
                "output":       None,
                "error":        "delegate requires agent_id and task",
                "truncated":    False,
                "raw_chars":    0,
            }
        try:
            envelope = await _delegate_fn(
                agent_id=agent_id,
                task=task,
                context_hint=context_hint,
                caller_spec_id=caller_spec_id,
            )
        except Exception as exc:  # pragma: no cover — delegate is supposed to swallow
            envelope = {"ok": False, "code": "DELEGATE_RAISED",
                         "error": f"{type(exc).__name__}: {exc}"}
        # Translate the delegate envelope into the tool-result shape the
        # runtime loop expects (matches dispatch_many's shape).
        return idx, {
            "ok":           bool(envelope.get("ok")),
            "name":         "delegate",
            "tool_call_id": call.get("tool_call_id"),
            "output":       envelope,
            "error":        envelope.get("error") if not envelope.get("ok") else None,
            "truncated":    False,
            "raw_chars":    len(str(envelope)),
        }

    # Fan out delegate calls + other tool calls in parallel
    import asyncio as _asyncio
    delegate_task = _asyncio.gather(*(_run_delegate(i) for i in delegate_indices)) \
        if delegate_indices else None
    others_task = None
    if other_indices:
        other_pending = [pending[i] for i in other_indices]
        others_task = dispatch_many(other_pending, timeout=timeout)

    if delegate_task is not None:
        for idx, res in await delegate_task:
            results[idx] = res
    if others_task is not None:
        other_results = await others_task
        for i, r in zip(other_indices, other_results):
            results[i] = r

    return results


# ── Dispatch ────────────────────────────────────────────────────────────────

async def dispatch_one(name: str, args: dict, *, timeout: float = 12.0) -> dict:
    """
    Run a single tool by canonical name. Always returns a dict — never raises.

    Returned shape:
      { ok: bool, name: str, output: dict | None, error: str | None,
        truncated: bool, raw_chars: int }
    """
    try:
        from backend.services.tools.tool_registry import get_tool, is_enabled
    except Exception as exc:
        return {"ok": False, "name": name, "output": None, "error": f"registry_import: {exc}",
                "truncated": False, "raw_chars": 0}

    canonical = _denormalize_tool_name(name)
    if not is_enabled(canonical):
        return {"ok": False, "name": canonical, "output": None,
                "error": "tool_disabled (set ENABLE_TOOLS=true + per-tool flag to enable)",
                "truncated": False, "raw_chars": 0}

    tool = get_tool(canonical)
    if tool is None:
        return {"ok": False, "name": canonical, "output": None,
                "error": "tool_not_registered",
                "truncated": False, "raw_chars": 0}

    query   = (args or {}).get("query") or ""
    context = {k: v for k, v in (args or {}).items() if k != "query"}

    # Phase 7b — per-tool timeout. The tool can declare a tighter
    # ceiling via the `timeout_seconds` class attribute on BaseTool;
    # take the smaller of caller-supplied and tool-supplied so the
    # agent's overall budget is still honoured.
    #
    # `is not None` (not truthiness) so a future tool declaring
    # `timeout_seconds = 0` doesn't silently fall through to the
    # caller default. Currently latent — all tools set positive
    # values — but the check should reflect "was a value provided?"
    # not "is the value truthy?" (Bugbot Low).
    tool_timeout = getattr(tool, "timeout_seconds", None)
    effective_timeout = (
        min(timeout, tool_timeout) if tool_timeout is not None else timeout
    )

    try:
        result = await asyncio.wait_for(tool.safe_run(query, context), timeout=effective_timeout)
    except asyncio.TimeoutError:
        return {"ok": False, "name": canonical, "output": None,
                "error": f"tool_timeout_{effective_timeout:.1f}s",
                "truncated": False, "raw_chars": 0}
    except Exception as exc:
        return {"ok": False, "name": canonical, "output": None,
                "error": f"tool_exception: {exc}",
                "truncated": False, "raw_chars": 0}

    # Truncate result to keep prompt size bounded.
    raw = json.dumps(result, default=str)
    if len(raw) > _MAX_TOOL_RESULT_CHARS:
        head = raw[: _MAX_TOOL_RESULT_CHARS - 80]
        truncated = head + "…[truncated]"
        return {
            "ok":        result.get("status") == "available" if isinstance(result, dict) else True,
            "name":      canonical,
            "output":    {"truncated_text": truncated, "_truncated": True},
            "error":     None,
            "truncated": True,
            "raw_chars": len(raw),
        }
    return {
        "ok":        result.get("status") == "available" if isinstance(result, dict) else True,
        "name":      canonical,
        "output":    result if isinstance(result, dict) else {"value": result},
        "error":     None,
        "truncated": False,
        "raw_chars": len(raw),
    }


async def dispatch_many(calls: list[dict], *, timeout: float = 12.0) -> list[dict]:
    """
    Run a list of {name, args, tool_call_id} dicts in parallel. Each result
    carries its original `tool_call_id` so the runtime can attach it to the
    correct OpenAI tool-message reply.
    """
    coros = [dispatch_one(c["name"], c.get("args") or {}, timeout=timeout) for c in calls]
    out = await asyncio.gather(*coros, return_exceptions=False)
    for c, r in zip(calls, out):
        r["tool_call_id"] = c.get("tool_call_id")
    return out


# ── Name normalization (OpenAI allows [a-zA-Z0-9_-], ≤ 64 chars) ────────────

def _normalize_tool_name(name: str) -> str:
    s = "".join(ch if (ch.isalnum() or ch in "_-") else "_" for ch in name)
    return s[:64]


def _denormalize_tool_name(name: str) -> str:
    # Currently a no-op — all our registry names already satisfy the schema.
    # Keep as a layer in case future tools need a translation table.
    return name


__all__ = [
    "tools_for_mode",
    "dispatch_one",
    "dispatch_many",
]
