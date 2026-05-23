# coding: utf-8
# Phase 3.4 — Orchestrator HTTP entrypoint.
#
# POST /v2/orchestrate
#   Body:
#     user_id    str        — owning user
#     message    str        — user request handed to the supervisor
#     project_id str?       — optional project namespace for shared
#                             memory injection (Phase 2)
#     agent_id   str?       — root agent (default "supervisor")
#     mode       str?       — optional mode hint surfaced in metadata
#     metadata   dict?      — additive bag, echoed in the run row
#
#   Response (200):
#     run_id        str
#     reply         str
#     agent_id      str         — root agent
#     agents_used   list[str]   — every spec.id touched (root + sub-agents)
#     trace         dict        — compact summary (counts, last error)
#     metadata      dict        — token estimate, budgets used, etc.
#
# Errors are surfaced as HTTPException:
#   503  ENABLE_ORCHESTRATOR is off
#   404  Unknown agent_id
#   422  Validation (Pydantic)
#   500  Orchestrator crash (still records the run row as 'errored')
#
# Gated by ENABLE_ORCHESTRATOR (default false). Project context
# injection is gated by ENABLE_PROJECTS (Phase 2 default). Realtime
# events fire only when ENABLE_REALTIME_EVENTS=true (Phase 3.2 default
# off). Each flag is independent — the orchestrator works with any
# combination.

import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

# Module-level imports so tests can monkeypatch `run_agent` on this
# module without breaking the production import path. The runtime
# itself is cheap to import (no network / no DB).
from backend.services.agent.runtime import run_agent
from backend.services.agent.types import AgentRequest

router = APIRouter(prefix="/v2/orchestrate", tags=["orchestrator"])
logger = logging.getLogger(__name__)


def _enabled() -> bool:
    return os.getenv("ENABLE_ORCHESTRATOR", "false").strip().lower() == "true"


def _ensure_enabled() -> None:
    if not _enabled():
        raise HTTPException(
            status_code=503,
            detail={
                "error":    "orchestrator_disabled",
                "message":  "Orchestrator is disabled. Set ENABLE_ORCHESTRATOR=true to activate.",
                "rollback": "Unset ENABLE_ORCHESTRATOR (or set 'false') to disable again.",
            },
        )


# Bring up runs table once at import time when the flag is on.
if _enabled():
    try:
        from backend.services.orchestrator import init_runs_table as _init_runs
        _init_runs()
        logger.info("orchestrator.runs_table initialized (ENABLE_ORCHESTRATOR=true)")
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("orchestrator.runs_table init failed: %s", exc)


# ── Request / response models ──────────────────────────────────────────

class OrchestrateBody(BaseModel):
    user_id:    str
    message:    str = Field(..., min_length=1, max_length=20_000)
    project_id: Optional[str] = None
    agent_id:   Optional[str] = "supervisor"
    mode:       Optional[str] = None
    metadata:   Optional[Dict[str, Any]] = None


# ── Health ─────────────────────────────────────────────────────────────

@router.get("/health")
def orchestrate_health() -> dict:
    """Always-callable status endpoint — reports flag state + counts."""
    stats: dict = {}
    if _enabled():
        try:
            from backend.services.orchestrator import runs_stats
            stats = runs_stats()
        except Exception as exc:
            stats = {"error": str(exc)}
    return {
        "enabled":  _enabled(),
        "phase":    "3.4 — supervisor + delegate over HTTP",
        "depends_on": {
            "ENABLE_PROJECTS":       os.getenv("ENABLE_PROJECTS", "false"),
            "ENABLE_REALTIME_EVENTS": os.getenv("ENABLE_REALTIME_EVENTS", "false"),
        },
        "limits": {
            "max_depth":          os.getenv("ORCHESTRATOR_MAX_DEPTH", "2"),
            "max_parallel":       os.getenv("ORCHESTRATOR_MAX_PARALLEL", "3"),
            "total_token_budget": os.getenv("ORCHESTRATOR_TOTAL_TOKEN_BUDGET", "40000"),
        },
        "stats":    stats,
    }


# ── Main route ─────────────────────────────────────────────────────────

@router.post("")
async def orchestrate(body: OrchestrateBody) -> dict:
    _ensure_enabled()

    # ── 1. Resolve the root agent spec ─────────────────────────────────
    target_id = (body.agent_id or "supervisor").strip()
    from backend.services.agent.specs import get_spec
    spec = get_spec(target_id)
    if spec is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "agent_not_found", "agent_id": target_id},
        )

    # ── 2. Build project context block (Phase 2 integration) ───────────
    project_block = ""
    project_ctx_token = None
    if body.project_id:
        try:
            from backend.services.projects.context import (
                build_project_context_block, set_current_project_context,
            )
            project_block = build_project_context_block(body.project_id) or ""
            if project_block:
                project_ctx_token = set_current_project_context(project_block)
        except Exception as exc:
            logger.debug("orchestrate | project context skipped (%s)", exc)

    # ── 3. Create the run row ─────────────────────────────────────────
    from backend.services.orchestrator import (
        create_run, finish_run, error_run, init_runs_table,
    )
    # Defensive: ensure table exists (in case the import-time init was skipped)
    try: init_runs_table()
    except Exception: pass

    from backend.services.agent.run_context import start_run, get_current_run
    # Generate a run id up front so we can pin both the DB row and the
    # RunContext to the same id — events / traces / DB stay correlated.
    import uuid as _uuid
    run_id = _uuid.uuid4().hex[:12]

    create_run(
        run_id=run_id,
        user_id=body.user_id,
        project_id=body.project_id,
        agent_id=spec.id,
        metadata={
            "spec_kind": spec.kind,
            "mode_hint": body.mode,
            **(body.metadata or {}),
        },
    )

    # ── 4. Build the AgentRequest. Phase 3.6: if the caller's
    # target is the Supervisor AND a project_id is set, augment the
    # supervisor's system prompt with a list of project-specific
    # agents so the supervisor knows it can delegate to them
    # (their agent_ids resolve via Phase 3.3's get_spec fallback).
    effective_system_prompt = spec.system_prompt
    if spec.id == "supervisor" and body.project_id:
        try:
            from backend.services.projects import list_agents as _list_project_agents
            proj_agents = _list_project_agents(body.project_id)
        except Exception:
            proj_agents = []
        if proj_agents:
            lines = ["", "PROJECT AGENTS AVAILABLE (prefer over built-ins when role matches):"]
            for pa in proj_agents:
                lines.append(f"  - {pa.id}  ({pa.role or pa.name})")
            effective_system_prompt = (
                spec.system_prompt + "\n" + "\n".join(lines) +
                "\n\nCall delegate(agent_id=<id-above>, task=...) using the "
                "exact id listed above to invoke a project agent."
            )

    request = AgentRequest(
        user_message=body.message.strip(),
        mode=(body.mode or spec.id),
        user_id=str(body.user_id),
        model=spec.default_model,
        temperature=spec.temperature,
        max_tokens=2000,
        system_prompt=effective_system_prompt,
        max_steps=spec.max_steps,
        spec=spec,                                     # Phase 3.4 — enables spec-aware path
        metadata_in={
            "orchestrator_entry": True,
            "run_id":             run_id,
            "project_id":         body.project_id,
        },
    )

    # ── 5. Push the RunContext + invoke the runtime ────────────────────
    reply = ""
    response = None
    err_msg: Optional[str] = None
    try:
        with start_run(
            user_id=body.user_id,
            project_id=body.project_id,
            project_context_block=project_block,
            run_id=run_id,
            metadata={
                "entry":   "v2_orchestrate",
                "spec_id": spec.id,
            },
        ):
            response = await run_agent(request)
            reply = response.reply or ""
    except Exception as exc:  # pragma: no cover — runtime swallows internally
        err_msg = f"{type(exc).__name__}: {exc}"
        logger.exception("orchestrate | runtime raised unexpectedly")
    finally:
        # Always release the Phase 2 ContextVar push.
        if project_ctx_token is not None:
            try:
                from backend.services.projects.context import reset_current_project_context
                reset_current_project_context(project_ctx_token)
            except Exception:
                pass

    # ── 6. Read aggregate scratch counters (set by delegate.py) ───────
    # NOTE: the RunContext has been popped at this point — the scratch
    # dict was shared by reference into delegate's child contexts, so
    # we can't easily re-read it. We carry the data out via the
    # response.metadata that delegate populated. For aggregates, use
    # the trace and the response itself.

    agents_used: List[str] = [spec.id]
    delegations: int = 0
    if response is not None:
        # Count delegate steps in the trace to derive agents_used + delegations.
        for step in (response.trace or []):
            if getattr(step, "kind", "") == "tool_call" and getattr(step, "name", "") == "delegate":
                delegations += 1
                # The delegate result envelope was JSON-serialized into the
                # tool message; output.agent_id surfaces the chosen specialist.
                out = getattr(step, "output", None) or {}
                if isinstance(out, dict):
                    sub_id = (out.get("output") or {}).get("agent_id") if isinstance(out.get("output"), dict) else None
                    if sub_id and sub_id not in agents_used:
                        agents_used.append(sub_id)

    # ── 7. Finalize the run row ────────────────────────────────────────
    if err_msg or response is None:
        error_run(run_id, error=err_msg or "no response")
    else:
        finish_run(
            run_id,
            reply_chars=len(reply or ""),
            trace_steps=len(response.trace or []),
            tool_calls=getattr(response, "tool_calls", 0),
            delegations=delegations,
            metadata={
                "elapsed_ms":  getattr(response, "elapsed_ms", 0),
                "partial":     bool(getattr(response, "partial", False)),
                "fallback":    bool(getattr(response, "fallback", False)),
                "steps_used":  getattr(response, "steps_used", 0),
                "agents_used": agents_used,
            },
        )

    # ── 8. Response envelope ───────────────────────────────────────────
    if err_msg:
        raise HTTPException(
            status_code=500,
            detail={
                "error":   "orchestrator_crashed",
                "run_id":  run_id,
                "message": err_msg,
            },
        )

    trace_summary = {
        "steps":       len(response.trace or []) if response else 0,
        "tool_calls":  getattr(response, "tool_calls", 0) if response else 0,
        "delegations": delegations,
        "partial":     bool(getattr(response, "partial", False)) if response else False,
        "fallback":    bool(getattr(response, "fallback", False)) if response else True,
    }

    return {
        "run_id":      run_id,
        "reply":       reply,
        "agent_id":    spec.id,
        "agents_used": agents_used,
        "trace":       trace_summary,
        "metadata": {
            "project_id":         body.project_id,
            "project_context":    bool(project_block),
            "elapsed_ms":         getattr(response, "elapsed_ms", 0) if response else 0,
            "model":              spec.default_model,
            "max_depth":          int(os.getenv("ORCHESTRATOR_MAX_DEPTH", "2")),
            "max_parallel":       int(os.getenv("ORCHESTRATOR_MAX_PARALLEL", "3")),
            "total_token_budget": int(os.getenv("ORCHESTRATOR_TOTAL_TOKEN_BUDGET", "40000")),
        },
    }


# ── Convenience read route — list a project's recent runs ─────────────
# Tiny GET so the frontend can render a "previous orchestrations" list
# in Phase 3.5 without needing a new endpoint then.

@router.get("/runs")
def list_runs_route(
    user_id: Optional[str] = None,
    project_id: Optional[str] = None,
    limit: int = 50,
) -> dict:
    _ensure_enabled()
    from backend.services.orchestrator import list_runs
    rows = list_runs(user_id=user_id, project_id=project_id, limit=limit)
    return {"runs": rows}


@router.get("/runs/{run_id}")
def get_run_route(run_id: str) -> dict:
    _ensure_enabled()
    from backend.services.orchestrator import get_run
    row = get_run(run_id)
    if not row:
        raise HTTPException(status_code=404, detail={"error": "run_not_found"})
    return row
