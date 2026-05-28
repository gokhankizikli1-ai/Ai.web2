# coding: utf-8
"""Phase 11 hang-fix — shared safe_run-with-hard-timeout helper.

Every context-builder in this package (github_urls, web_urls,
web_search_intent) calls `tool.safe_run(...)` directly to invoke the
underlying BaseTool. Each tool declares a `timeout_seconds` class
attribute intended to be honoured by the agent.tool_bridge — but our
direct invocations don't go through the bridge, so the timeout was
advisory only. Production observation: when Tavily / urllib /
GitHub silently never returns, the SSE stream hangs forever and the
FE never sees a `done` event ("Bir dakikanızı alacak…" stuck).

This helper enforces a HARD wall-clock ceiling around every direct
tool invocation using asyncio.wait_for. On timeout we emit a clean
`_unavailable` envelope so callers continue with their existing
"tool returned no data" branches — the stream always reaches `done`.

`grace_seconds` is added to the tool's own ceiling so a tool that
times out internally has a moment to surface its own envelope before
the outer guard fires.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional


logger = logging.getLogger(__name__)


_DEFAULT_GRACE_SECONDS = 2.0
# Absolute floor — even if a tool says timeout_seconds=2, give it 4s
# total so first-byte latency on a healthy connection doesn't cause
# spurious failures.
_MIN_TIMEOUT_SECONDS = 4.0


async def safe_run_with_timeout(
    tool: Any,
    query: str,
    context: Optional[dict] = None,
    *,
    grace_seconds: float = _DEFAULT_GRACE_SECONDS,
    override_timeout: Optional[float] = None,
) -> dict:
    """Run `tool.safe_run(query, context)` with a hard timeout.

    Returns a normalised envelope no matter what:
      - tool returned an envelope → that envelope
      - tool raised → `_error` (envelope from BaseTool.safe_run already
        catches; defence in depth here)
      - tool exceeded the ceiling → `_unavailable` envelope with
        reason="<tool> timed out after Xs"
    """
    base_timeout = float(getattr(tool, "timeout_seconds", 8.0) or 8.0)
    if override_timeout is not None:
        base_timeout = float(override_timeout)
    deadline = max(_MIN_TIMEOUT_SECONDS, base_timeout + grace_seconds)
    tool_name = getattr(tool, "name", "tool")

    try:
        return await asyncio.wait_for(
            tool.safe_run(query, context or {}),
            timeout=deadline,
        )
    except asyncio.TimeoutError:
        logger.warning(
            "[TOOL_TIMEOUT] tool=%s | deadline=%.1fs | "
            "query=%s — emitting _unavailable envelope",
            tool_name, deadline, (query or "")[:120],
        )
        # Reuse the tool's own envelope shape so consumers don't need
        # to handle a new error type.
        if hasattr(tool, "_unavailable"):
            return tool._unavailable(
                f"{tool_name} timed out after {deadline:.1f}s",
            )
        # Defensive fallback if a tool doesn't subclass BaseTool.
        return {
            "tool":      tool_name,
            "status":    "unavailable",
            "data":      None,
            "message":   f"{tool_name} timed out after {deadline:.1f}s",
            "provider":  None,
            "source":    None,
            "timestamp": None,
            "is_live":   False,
        }
    except Exception as exc:
        # safe_run() itself shouldn't raise — but defence in depth.
        logger.warning(
            "[TOOL_RAISED] tool=%s | err=%s", tool_name, exc,
        )
        if hasattr(tool, "_error"):
            return tool._error(str(exc) or "tool raised unexpectedly")
        return {
            "tool":      tool_name,
            "status":    "error",
            "data":      None,
            "message":   str(exc) or "tool raised unexpectedly",
            "provider":  None,
            "source":    None,
            "timestamp": None,
            "is_live":   False,
        }


__all__ = ["safe_run_with_timeout"]
