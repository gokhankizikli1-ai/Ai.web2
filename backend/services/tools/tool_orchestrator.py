# coding: utf-8
# Phase 4A — Tool Orchestrator
# Routes AI mode requests to the relevant tools.
# Always returns a dict — never raises, never blocks the AI response.
#
# Phase 4A: architecture only, all tools return "disabled" or "unavailable".
# Phase 4B: market_data connects to real provider.
# Phase 4C: ecommerce_research connects to real provider.
# Phase 4D: web_research connects to real provider + agent workflows.
import asyncio
import logging
from typing import Dict, List

logger = logging.getLogger(__name__)

# Maps canonical AI mode names → tool names they may call.
# Add new modes here as tools become available.
_MODE_TOOL_MAP: Dict[str, List[str]] = {
    "trading_analyst":        ["market_data"],
    "marketing_dropshipping": ["ecommerce_research", "web_research"],
    "startup_advisor":        ["web_research"],
    "research":               ["web_research"],
    "deep_think":             ["web_research"],
    # Modes below intentionally have no tools — fast local responses only.
    # "fast": [],
    # "study": [],
    # "coding": [],
    # "website_builder": [],
}


async def run_tools_for_mode(
    mode: str,
    query: str,
    context: dict = None,
) -> Dict[str, dict]:
    """
    Run all tools mapped to a given mode in parallel.
    Returns a dict keyed by tool name — all values are normalized result dicts.
    Safe to call even when ENABLE_TOOLS=false; every tool returns disabled status.
    """
    # Lazy imports to prevent startup crashes.
    try:
        from backend.services.tools.tool_registry import is_enabled, get_tool
    except Exception as exc:
        logger.warning("orchestrator: tool_registry import failed: %s", exc)
        return {}

    tool_names = _MODE_TOOL_MAP.get(mode, [])
    if not tool_names:
        return {}

    async def _call(tool_name: str) -> tuple:
        if not is_enabled(tool_name):
            return tool_name, {
                "tool":    tool_name,
                "status":  "disabled",
                "data":    None,
                "message": (
                    f"{tool_name} is disabled. "
                    f"Set ENABLE_TOOLS=true and ENABLE_{tool_name.upper()}=true to activate."
                ),
                "provider": None,
            }
        tool = get_tool(tool_name)
        if tool is None:
            return tool_name, {
                "tool":    tool_name,
                "status":  "unavailable",
                "data":    None,
                "message": f"{tool_name} is not registered",
                "provider": None,
            }
        result = await tool.safe_run(query, context)
        return tool_name, result

    tasks = [_call(name) for name in tool_names]
    pairs = await asyncio.gather(*tasks, return_exceptions=False)
    return dict(pairs)


def build_tool_context_block(tool_results: Dict[str, dict]) -> str:
    """
    Convert available tool data into a plain-text block for injection into
    the AI system prompt. Returns "" if nothing is available — the AI
    response continues unmodified.

    Phase 4B-D: format will expand as providers supply richer data.
    """
    if not tool_results:
        return ""

    lines = []
    for tool_name, result in tool_results.items():
        if result.get("status") != "available":
            continue
        data = result.get("data")
        if not data:
            continue
        provider = result.get("provider", "")
        lines.append(f"\n[TOOL: {tool_name.upper()}" + (f" via {provider}" if provider else "") + "]")
        if isinstance(data, dict):
            for k, v in data.items():
                lines.append(f"  {k}: {v}")
        else:
            lines.append(f"  {data}")

    return "\n".join(lines) if lines else ""
