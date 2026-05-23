# coding: utf-8
# Phase 3.1 — AgentSpec dataclass + helpers.
#
# AgentSpec is FROZEN so a spec can be shared across concurrent
# orchestration runs without defensive copying. Per-run mutable state
# lives in RunContext (see backend/services/agent/run_context.py),
# never on the spec itself.

from dataclasses import dataclass, field
from typing import Optional, Tuple


@dataclass(frozen=True)
class AgentSpec:
    """Static definition of an agent kind.

    Attributes:
        id:             stable string id ("supervisor", "researcher", …).
                        Built-ins listed in builtins.BUILTIN_AGENT_IDS;
                        project-defined agents use their DB row id.
        name:           display name surfaced in traces and the UI.
        role:           short human-readable role label.
        system_prompt:  base persona prompt. Combined with project
                        context (Phase 2) and mode-specific suffix at
                        runtime — this is the static portion only.
        allowed_tools:  whitelist of tool names from the tools registry.
                        Empty tuple = no tools (pure LLM call).
        default_model:  model id used when the caller doesn't override.
        max_steps:      tool-call budget when this spec is the active
                        agent. The orchestrator caps sub-agents at
                        this number regardless of caller intent.
        can_delegate:   True only for orchestrator-class agents — the
                        `delegate` tool is restricted to specs where
                        this is True (Phase 3.3 wires the tool itself;
                        this flag is declared now so Phase 3.1 tests
                        can verify the policy).
        temperature:    default sampling temperature for this spec.
        kind:           "builtin" | "custom"  — populated at construction.
                        Lets observability distinguish first-party
                        agents from user-created project agents.
    """
    id:             str
    name:           str
    role:           str
    system_prompt:  str
    allowed_tools:  Tuple[str, ...] = field(default_factory=tuple)
    default_model:  str = "gpt-4o-mini"
    max_steps:      int = 4
    can_delegate:   bool = False
    temperature:    float = 0.4
    kind:           str = "builtin"


def spec_from_project_agent(row: dict) -> AgentSpec:
    """Build an AgentSpec from a `project_agents` table row.

    Used at orchestration time so a user-defined project agent can be
    invoked just like a built-in. The DB row's `system_prompt` becomes
    the spec persona; the role/icon/colour are preserved in the spec
    for trace UX. Tool allowlist defaults to a safe subset until we
    add a UI for the user to pick tools (Phase 4 follow-up).

    Phase 3.6: when the stored system_prompt is empty (the historical
    default before the frontend started populating it), we fall back
    to a role-based template. This is the root cause fix for
    "Frontend Agent suggests Wix" — without a strong persona prompt
    a project agent acts like a generic LLM.

    Required keys: id, name, project_id.
    Optional:      role, system_prompt, model_hint, metadata.
    """
    stored_prompt = str(row.get("system_prompt") or "").strip()
    role_label = str(row.get("role") or "specialist")
    if not stored_prompt:
        # Lazy import to avoid a circular dep — role_templates may
        # in future read from the registry, which imports types.
        from backend.services.agent.specs.role_templates import (
            default_system_prompt_for_role,
        )
        stored_prompt = default_system_prompt_for_role(role_label)

    return AgentSpec(
        id=str(row["id"]),
        name=str(row.get("name") or "Project Agent"),
        role=role_label,
        system_prompt=stored_prompt,
        allowed_tools=tuple(
            (row.get("metadata") or {}).get("allowed_tools") or ()
        ),
        default_model=str(row.get("model_hint") or "gpt-4o-mini"),
        max_steps=int((row.get("metadata") or {}).get("max_steps") or 4),
        can_delegate=False,   # project agents never delegate by default
        temperature=float((row.get("metadata") or {}).get("temperature") or 0.4),
        kind="custom",
    )


__all__ = ["AgentSpec", "spec_from_project_agent"]
