# coding: utf-8
# Phase A1 — Agent runtime package.
#
# Public API:
#   from backend.services.agent import run_agent, AgentRequest, AgentResponse, is_enabled, stats
#
# Internal modules:
#   types.py        # dataclasses (AgentRequest, AgentResponse, AgentStep)
#   budget.py       # Budget tracker (steps, wall-clock, parallelism)
#   tool_bridge.py  # BaseTool registry ↔ OpenAI function-calling
#   runtime.py      # run_agent — the LLM-pass + tool-call loop
#
# Feature flag (read by ai_service.process_chat and by /tools/health):
#   ENABLE_AGENT=true   → ai_service routes `mode=research` through the agent
#   default / false     → legacy single-shot path runs unchanged
#
# Hard budgets (all env-overridable):
#   AGENT_MAX_STEPS=6
#   AGENT_MAX_WALL_SECONDS=25
#   AGENT_MAX_PARALLEL_TOOLS=3
from backend.services.agent.types   import AgentRequest, AgentResponse, AgentStep, STEP_KINDS
from backend.services.agent.budget  import Budget
from backend.services.agent.runtime import run_agent, stats, is_enabled

__all__ = [
    "run_agent",
    "stats",
    "is_enabled",
    "AgentRequest",
    "AgentResponse",
    "AgentStep",
    "STEP_KINDS",
    "Budget",
]
