# coding: utf-8
# Phase 3.1 — Agent specs registry.
#
# A flat dict keyed by spec.id. Built-ins are registered at module-load
# via load_specs(). External callers go through get_spec() / list_specs()
# / register_spec().
#
# Custom (per-project) specs are NOT pre-loaded here — they're built
# from the project_agents table at orchestration time via
# spec_from_project_agent(). get_spec() consults the registry first,
# then falls back to a one-shot DB lookup so the orchestrator can resolve
# either built-in or project-defined ids with the same call.

import logging
import os
from typing import Dict, List, Optional, Tuple

from backend.services.agent.specs.types import AgentSpec, spec_from_project_agent

logger = logging.getLogger(__name__)

# Registered specs by id. Populated by load_specs().
_REGISTRY: Dict[str, AgentSpec] = {}

# Order-preserving id list — used by /v2/orchestrate/agents (when wired
# in Phase 3.4) to render a consistent agent catalogue in the UI.
#
# Phase 4.1 adds 4 panel specialists (ux/brand/copywriter/product) so the
# Supervisor has real coverage for multi-domain build requests like
# "create my SaaS landing page" without manual agent creation.
BUILTIN_AGENT_IDS: Tuple[str, ...] = (
    "supervisor",
    "researcher",
    "coder",
    "trader",
    "marketer",
    "strategist",
    # Phase 4.1 — autonomous panel specialists
    "ux_designer",
    "brand_designer",
    "copywriter",
    "product_strategist",
)

_LOADED = False


def load_specs() -> None:
    """Register all built-in specs. Idempotent."""
    global _LOADED
    if _LOADED:
        return
    # Imported lazily to keep the package import side-effect-free until
    # someone actually uses an agent spec. Tests can import the module
    # without paying the prompt-string compile cost.
    from backend.services.agent.specs import builtins as _b
    for spec in (
        _b.SUPERVISOR_SPEC,
        _b.RESEARCHER_SPEC,
        _b.CODER_SPEC,
        _b.TRADER_SPEC,
        _b.MARKETER_SPEC,
        _b.STRATEGIST_SPEC,
        # Phase 4.1 — autonomous panel specialists
        _b.UX_DESIGNER_SPEC,
        _b.BRAND_DESIGNER_SPEC,
        _b.COPYWRITER_SPEC,
        _b.PRODUCT_STRATEGIST_SPEC,
    ):
        _REGISTRY[spec.id] = spec
        logger.info(
            "agent_spec_loaded | id=%s | name=%s | role=%s | tools=%d | can_delegate=%s",
            spec.id, spec.name, spec.role, len(spec.allowed_tools), spec.can_delegate,
        )
    _LOADED = True


def register_spec(spec: AgentSpec, *, overwrite: bool = False) -> None:
    """Manually register a spec. Used by tests and future plugins."""
    if not overwrite and spec.id in _REGISTRY:
        raise ValueError(f"spec {spec.id!r} is already registered")
    _REGISTRY[spec.id] = spec
    logger.info(
        "agent_spec_loaded | id=%s | name=%s | role=%s | overwrite=%s",
        spec.id, spec.name, spec.role, overwrite,
    )


def list_specs(*, include_custom: bool = False) -> List[AgentSpec]:
    """List registered specs in BUILTIN_AGENT_IDS order, then the rest."""
    in_order = [_REGISTRY[i] for i in BUILTIN_AGENT_IDS if i in _REGISTRY]
    extras = [s for sid, s in _REGISTRY.items() if sid not in BUILTIN_AGENT_IDS]
    if include_custom:
        return in_order + extras
    return in_order


def get_spec(agent_id: str) -> Optional[AgentSpec]:
    """Resolve an agent id to a spec.

    Lookup order:
      1. In-memory registry (built-ins + previously-cached custom).
      2. project_agents table (when ENABLE_PROJECTS=true). Falls
         back to None on any DB error so the orchestrator can decide
         how to surface "unknown agent" to the user.

    Returns None when the id is unknown. Callers must handle None —
    never raises so a single bad lookup can't crash an orchestration run.
    """
    if not agent_id:
        return None
    if agent_id in _REGISTRY:
        return _REGISTRY[agent_id]
    # Custom (project-defined) agent fallback. Gated on ENABLE_PROJECTS
    # so the projects.db isn't touched when the feature is off.
    if os.getenv("ENABLE_PROJECTS", "false").strip().lower() != "true":
        return None
    try:
        from backend.services.projects.store import _conn  # type: ignore[attr-defined]
        with _conn() as c:
            row = c.execute(
                "SELECT id, project_id, name, role, system_prompt, model_hint, metadata_json "
                "FROM project_agents WHERE id = ?",
                (agent_id,),
            ).fetchone()
        if not row:
            return None
        import json
        try:
            meta = json.loads(row["metadata_json"] or "{}")
            if not isinstance(meta, dict):
                meta = {}
        except Exception:
            meta = {}
        return spec_from_project_agent({
            "id":            row["id"],
            "project_id":    row["project_id"],
            "name":          row["name"],
            "role":          row["role"],
            "system_prompt": row["system_prompt"],
            "model_hint":    row["model_hint"],
            "metadata":      meta,
        })
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("get_spec custom lookup failed for %r: %s", agent_id, exc)
        return None


__all__ = [
    "BUILTIN_AGENT_IDS",
    "load_specs",
    "register_spec",
    "list_specs",
    "get_spec",
]
