# coding: utf-8
# Phase 3.1 — Agent specs registry (public API).
#
# An AgentSpec is the static definition of an agent kind: name, role,
# system prompt, the tools it's allowed to call, default model, and
# step budget. Built-in specs live in `builtins.py`; user-defined
# project agents (rows in `project_agents`) are turned into AgentSpec
# instances on demand by `spec_from_project_agent()`.
#
# This file is intentionally tiny — the registry is just a dict +
# constructor lookup. Adding a new built-in agent is one entry in
# builtins.py; no registration boilerplate.

from backend.services.agent.specs.types import (
    AgentSpec,
    spec_from_project_agent,
)
from backend.services.agent.specs.registry import (
    load_specs,
    get_spec,
    list_specs,
    register_spec,
    BUILTIN_AGENT_IDS,
)

# Eager load so the first /v2/orchestrate request doesn't pay the
# import cost. Idempotent — calling load_specs() again is a no-op.
load_specs()

__all__ = [
    "AgentSpec",
    "load_specs",
    "get_spec",
    "list_specs",
    "register_spec",
    "spec_from_project_agent",
    "BUILTIN_AGENT_IDS",
]
