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

import asyncio
import json
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
from backend.utils.sse import sse_event, sse_response

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


# Bring up runs + tasks tables once at import time when the flag is on.
if _enabled():
    try:
        from backend.services.orchestrator import (
            init_runs_table as _init_runs,
            init_tasks_table as _init_tasks,
        )
        _init_runs()
        _init_tasks()     # Phase 5.1 — task graph storage
        logger.info("orchestrator tables initialized (runs + tasks)")
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("orchestrator.runs_table init failed: %s", exc)


# ── Request / response models ──────────────────────────────────────────

class OrchestrateRecentMessage(BaseModel):
    role:    str = Field(..., pattern="^(user|assistant|system)$")
    content: str = Field(..., min_length=1, max_length=8_000)


class OrchestrateBody(BaseModel):
    user_id:         str
    message:         str = Field(..., min_length=1, max_length=20_000)
    project_id:      Optional[str] = None
    agent_id:        Optional[str] = "supervisor"
    mode:            Optional[str] = None
    metadata:        Optional[Dict[str, Any]] = None
    # Phase 4.2 — frontend can pass the last N messages from the
    # project chat so the supervisor + downstream specialists have
    # conversation continuity. Cap is enforced server-side (last 12
    # messages used regardless of how many are sent).
    recent_messages: Optional[List[OrchestrateRecentMessage]] = None


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
            # Phase 4.1 raised defaults to accommodate 5-agent panels
            "max_parallel":       os.getenv("ORCHESTRATOR_MAX_PARALLEL", "5"),
            "total_token_budget": os.getenv("ORCHESTRATOR_TOTAL_TOKEN_BUDGET", "80000"),
        },
        # Phase 4.2 — model routing config so operators can see which
        # tier env vars are configured + which models are effective.
        "model_routing": _routing_summary_safe(),
        "stats":    stats,
    }


def _routing_summary_safe() -> dict:
    """Lazy + defensive — model_routing module is small + side-effect
    free, but isolate the import so /health never errors."""
    try:
        from backend.services.agent.model_routing import routing_summary
        return routing_summary()
    except Exception as exc:
        return {"error": str(exc)}


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
    # Phase 4.2 — model routing for the supervisor. Same resolution as
    # specialists go through inside delegate(), so a Railway operator
    # setting MODEL_ORCHESTRATOR=gpt-4o gets it applied here too.
    from backend.services.agent.model_routing import (
        resolve_model_for_spec, log_model_selection,
    )
    selected_supervisor_model = resolve_model_for_spec(spec)
    log_model_selection(spec, selected_supervisor_model, run_id=run_id)

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

    # Phase 4.2 — recent messages context. When the frontend sends
    # the last N project messages, append them to the supervisor's
    # prompt so it has conversation continuity (mirrors how /chat
    # auto-includes per-user history). Capped at 12 messages /
    # 6k chars total to keep prompt size bounded.
    if body.recent_messages:
        history_lines = ["", "RECENT CONVERSATION (most recent last):"]
        total_chars = 0
        for m in body.recent_messages[-12:]:
            speaker = m.role.upper()
            text = m.content.strip()
            if not text:
                continue
            line = f"  [{speaker}] {text[:600]}"
            if total_chars + len(line) > 6000:
                history_lines.append("  …[truncated]")
                break
            history_lines.append(line)
            total_chars += len(line)
        if len(history_lines) > 2:  # something was actually appended
            effective_system_prompt += "\n" + "\n".join(history_lines)

    request = AgentRequest(
        user_message=body.message.strip(),
        mode=(body.mode or spec.id),
        user_id=str(body.user_id),
        # Phase 4.2 — env-tiered model routing (was spec.default_model).
        model=selected_supervisor_model,
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

    # Phase 5.1 — task graph envelope. Loaded from the persistent
    # tasks_store so the response carries the full per-task lifecycle
    # the frontend can render as a timeline. When no tasks were
    # created (older runs, /chat fallback, or first deploy before
    # tasks_table init), this returns an empty graph — the response
    # shape stays stable so the frontend always gets the field.
    task_graph_envelope: dict = {
        "run_id": run_id, "tasks": [],
        "counts": {}, "total_count": 0, "total_duration_ms": 0,
    }
    try:
        from backend.services.orchestrator import ExecutionGraph
        task_graph_envelope = ExecutionGraph.for_run(run_id).to_envelope()
    except Exception as exc:
        logger.debug("orchestrate | task_graph envelope soft-failed: %s", exc)

    return {
        "run_id":      run_id,
        "reply":       reply,
        "agent_id":    spec.id,
        "agents_used": agents_used,
        "trace":       trace_summary,
        "task_graph":  task_graph_envelope,   # Phase 5.1
        "metadata": {
            "project_id":         body.project_id,
            "project_context":    bool(project_block),
            "elapsed_ms":         getattr(response, "elapsed_ms", 0) if response else 0,
            "model":              spec.default_model,
            "max_depth":          int(os.getenv("ORCHESTRATOR_MAX_DEPTH", "2")),
            "max_parallel":       int(os.getenv("ORCHESTRATOR_MAX_PARALLEL", "5")),
            "total_token_budget": int(os.getenv("ORCHESTRATOR_TOTAL_TOKEN_BUDGET", "80000")),
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


# ── Phase 5.1 — task graph endpoints ──────────────────────────────────

@router.get("/runs/{run_id}/tasks")
def get_run_tasks_route(run_id: str) -> dict:
    """Return the execution graph for a run. Used by the frontend to
    backfill after a tab refresh — the SSE stream only delivers events
    going forward, so on mount the UI fetches the historical task
    list from here."""
    _ensure_enabled()
    from backend.services.orchestrator import ExecutionGraph
    return ExecutionGraph.for_run(run_id).to_envelope()


@router.get("/projects/{project_id}/tasks")
def get_project_tasks_route(project_id: str, limit: int = 100) -> dict:
    """List recent tasks for a project (across all runs). Cap at 500
    to bound payload size; default 100. Sorted newest-first."""
    _ensure_enabled()
    from backend.services.orchestrator import list_tasks_for_project
    rows = list_tasks_for_project(project_id, limit=limit)
    return {"tasks": rows}


# ── Phase 5.2 — streaming orchestration ───────────────────────────────
#
# POST /v2/orchestrate/stream
#   Body: identical to POST /v2/orchestrate (OrchestrateBody).
#   Response: text/event-stream (SSE).
#
# Wire protocol (one event per line):
#
#   event: supervisor_planning
#   data: {"run_id":"...","agent_id":"supervisor","ts":"..."}
#
#   event: task_queued
#   data: {"task_id":"...","agent_id":"researcher","title":"...","depth":1}
#
#   event: task_started
#   data: {"task_id":"...","agent_id":"researcher","provider":"google"}
#
#   event: token_delta
#   data: {"task_id":"...","agent_id":"researcher","delta":"## Key ","seq":0,"provider":"google"}
#
#   event: task_progress
#   data: {"task_id":"...","agent_id":"researcher","chars":420}
#
#   event: task_completed
#   data: {"task_id":"...","agent_id":"researcher","reply_chars":1840,"elapsed_ms":4123}
#
#   event: task_failed
#   data: {"task_id":"...","agent_id":"researcher","error":"..."}
#
#   event: orchestration_completed
#   data: {"run_id":"...","reply":"...","agents_used":[...],"task_graph":{...}}
#
#   : heartbeat                       (idle keep-alive; client ignores)
#
# Cancellation: client disconnects → SSE generator gets cancelled → the
# background orchestration task is also cancelled → provider streams
# receive asyncio.CancelledError on their next await → clean teardown.
#
# Memory safety: the bus subscription queue caps at 256 unconsumed events
# (Phase 3.2 default). If the client falls behind, the bus drops oldest
# events — the orchestration itself is unaffected.
#
# Backwards compat: POST /v2/orchestrate (non-streaming) is untouched.
# /v2/chat and /v2/chat/stream are also untouched.

# Map bus event kinds → SSE event names per the Phase 5.2 brief. Events
# not in this map are dropped (we only surface the user-facing taxonomy).
_BUS_TO_SSE_KIND: Dict[str, str] = {
    "run.started":       "supervisor_planning",
    "task.created":      "task_queued",
    "task.started":      "task_started",
    "agent.token":       "token_delta",
    "task.completed":    "task_completed",
    "task.failed":       "task_failed",
    "delegate.errored":  "task_failed",  # also surface dispatch-time failures
}


@router.post("/stream")
async def orchestrate_stream(body: OrchestrateBody):
    """SSE variant of POST /v2/orchestrate — streams per-task token
    deltas live so the UI can render incremental specialist outputs.

    Implementation: kicks off the same orchestration that POST /
    orchestrate runs, but inside a background asyncio.Task; subscribes
    to the in-process event bus (filtered by run_id); translates the
    canonical bus events into the Phase 5.2 SSE taxonomy; ends with
    one `orchestration_completed` frame carrying the final reply +
    task graph envelope.
    """
    _ensure_enabled()

    # Validate the root spec up-front so a 404 surfaces as JSON (before
    # the SSE response starts), not as a stream error frame.
    target_id = (body.agent_id or "supervisor").strip()
    from backend.services.agent.specs import get_spec
    spec = get_spec(target_id)
    if spec is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "agent_not_found", "agent_id": target_id},
        )

    import uuid as _uuid
    run_id = _uuid.uuid4().hex[:12]

    async def _gen():
        from backend.services.events import bus
        # Subscribe BEFORE kicking off the orchestration so the
        # supervisor_planning -> first task_queued transition isn't a race.
        with bus.subscribe("*") as sub:
            yield sse_event("supervisor_planning", {
                "run_id":   run_id,
                "agent_id": spec.id,
                "ts":       _now_iso(),
            })

            # Per-task chunk counters for task_progress events. The
            # bus emits token deltas as agent.token events with a `seq`
            # counter; we forward each token delta AND occasionally
            # surface a per-task progress snapshot so the UI can render
            # a "X chars so far" indicator without re-reading deltas.
            per_task_chars: Dict[str, int] = {}
            per_task_chunks: Dict[str, int] = {}
            progress_every_n_chunks = 8

            orchestration_task = asyncio.create_task(
                _run_orchestration_streaming(body, spec, run_id),
            )

            # Loop: drain bus events for this run, forward as SSE.
            # Exit on orchestration_task completion (success or error).
            HEARTBEAT_SECONDS = 25.0
            try:
                while True:
                    if orchestration_task.done() and sub.empty():
                        break
                    try:
                        event = await asyncio.wait_for(
                            sub.get(), timeout=min(0.5, HEARTBEAT_SECONDS),
                        )
                    except asyncio.TimeoutError:
                        # Idle period — heartbeat (SSE comment frame)
                        yield ": heartbeat\n\n"
                        continue
                    except asyncio.CancelledError:
                        # Client disconnected — propagate.
                        raise

                    # Filter strictly by run_id — wildcard subscription
                    # would otherwise leak unrelated runs in this process.
                    if event.run_id != run_id:
                        continue

                    mapped_kind = _BUS_TO_SSE_KIND.get(event.kind)
                    if mapped_kind is None:
                        continue

                    payload = dict(event.payload or {})
                    payload.setdefault("agent_id", event.agent_id)
                    payload["ts"] = event.emitted_at

                    if event.kind == "agent.token":
                        # Bump per-task chunk counter + occasionally
                        # emit a task_progress frame so the UI gets a
                        # heartbeat-style "still going" signal even
                        # when the deltas are tiny.
                        tid = (payload.get("task_id") or "").strip()
                        if tid:
                            per_task_chars[tid] = (
                                per_task_chars.get(tid, 0)
                                + len(payload.get("delta") or "")
                            )
                            per_task_chunks[tid] = per_task_chunks.get(tid, 0) + 1
                        yield sse_event(mapped_kind, payload)
                        if tid and per_task_chunks[tid] % progress_every_n_chunks == 0:
                            yield sse_event("task_progress", {
                                "task_id":  tid,
                                "agent_id": payload.get("agent_id"),
                                "chars":    per_task_chars[tid],
                                "chunks":   per_task_chunks[tid],
                            })
                        continue

                    yield sse_event(mapped_kind, payload)

                # Orchestration done — fetch the result + emit final frame.
                try:
                    final = await orchestration_task
                except Exception as exc:
                    logger.exception("orchestrate.stream | runtime crashed")
                    yield sse_event("orchestration_failed", {
                        "run_id": run_id,
                        "error":  f"{type(exc).__name__}: {exc}"[:300],
                    })
                    return

                # Drain any late events the bus delivered after the
                # task completed but before we noticed. This is rare
                # (we wait for sub.empty() above) but safe.
                while not sub.empty():
                    try:
                        event = sub.queue.get_nowait()
                    except Exception:
                        break
                    if event.run_id != run_id:
                        continue
                    mapped_kind = _BUS_TO_SSE_KIND.get(event.kind)
                    if mapped_kind is None:
                        continue
                    payload = dict(event.payload or {})
                    payload.setdefault("agent_id", event.agent_id)
                    payload["ts"] = event.emitted_at
                    yield sse_event(mapped_kind, payload)

                yield sse_event("orchestration_completed", {
                    "run_id":      final.get("run_id"),
                    "reply":       final.get("reply", ""),
                    "agent_id":    final.get("agent_id"),
                    "agents_used": final.get("agents_used", []),
                    "trace":       final.get("trace", {}),
                    "task_graph":  final.get("task_graph", {}),
                    "metadata":    final.get("metadata", {}),
                })
            except asyncio.CancelledError:
                logger.debug("orchestrate.stream | client cancelled run=%s", run_id)
                # Cancel the background orchestration so providers stop.
                if not orchestration_task.done():
                    orchestration_task.cancel()
                    try:
                        await orchestration_task
                    except (asyncio.CancelledError, Exception):
                        pass
                # Don't raise — generator-close drives cleanup.
            finally:
                if not orchestration_task.done():
                    orchestration_task.cancel()
                    try:
                        await orchestration_task
                    except (asyncio.CancelledError, Exception):
                        pass

    return sse_response(_gen())


async def _run_orchestration_streaming(
    body: "OrchestrateBody", spec: Any, run_id: str,
) -> dict:
    """Run the orchestrator with streaming opt-in baked into the
    RunContext.scratch. Shape of the returned dict matches the
    POST /v2/orchestrate envelope so the SSE route can emit a single
    `orchestration_completed` frame at the end.

    Persistence parity: same create_run / finish_run / error_run path
    as the non-streaming route. Tasks land in the same `tasks` table
    so /v2/orchestrate/runs/<id>/tasks works for both flows.
    """
    # Project context build (same as POST /)
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
            logger.debug("orchestrate.stream | project context skipped (%s)", exc)

    from backend.services.orchestrator import (
        create_run, finish_run, error_run, init_runs_table,
    )
    try: init_runs_table()
    except Exception: pass

    from backend.services.agent.run_context import start_run
    create_run(
        run_id=run_id,
        user_id=body.user_id,
        project_id=body.project_id,
        agent_id=spec.id,
        metadata={
            "spec_kind": spec.kind,
            "mode_hint": body.mode,
            "stream":    True,
            **(body.metadata or {}),
        },
    )

    from backend.services.agent.model_routing import (
        resolve_model_for_spec, log_model_selection,
    )
    selected_supervisor_model = resolve_model_for_spec(spec)
    log_model_selection(spec, selected_supervisor_model, run_id=run_id)

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

    if body.recent_messages:
        history_lines = ["", "RECENT CONVERSATION (most recent last):"]
        total_chars = 0
        for m in body.recent_messages[-12:]:
            speaker = m.role.upper()
            text = m.content.strip()
            if not text:
                continue
            line = f"  [{speaker}] {text[:600]}"
            if total_chars + len(line) > 6000:
                history_lines.append("  …[truncated]")
                break
            history_lines.append(line)
            total_chars += len(line)
        if len(history_lines) > 2:
            effective_system_prompt += "\n" + "\n".join(history_lines)

    request = AgentRequest(
        user_message=body.message.strip(),
        mode=(body.mode or spec.id),
        user_id=str(body.user_id),
        model=selected_supervisor_model,
        temperature=spec.temperature,
        max_tokens=2000,
        system_prompt=effective_system_prompt,
        max_steps=spec.max_steps,
        spec=spec,
        metadata_in={
            "orchestrator_entry": True,
            "run_id":             run_id,
            "project_id":         body.project_id,
            "stream":             True,
        },
    )

    reply = ""
    response = None
    err_msg: Optional[str] = None
    try:
        with start_run(
            user_id=body.user_id,
            project_id=body.project_id,
            project_context_block=project_block,
            run_id=run_id,
            scratch={
                # Phase 5.2 — flip streaming on for this run. Delegate
                # inherits this dict by reference into every child
                # context, so each sub-agent picks up the flag.
                "_streaming_enabled": True,
            },
            metadata={
                "entry":   "v2_orchestrate_stream",
                "spec_id": spec.id,
            },
        ):
            response = await run_agent(request)
            reply = response.reply or ""
    except Exception as exc:
        err_msg = f"{type(exc).__name__}: {exc}"
        logger.exception("orchestrate.stream | runtime raised unexpectedly")
    finally:
        if project_ctx_token is not None:
            try:
                from backend.services.projects.context import reset_current_project_context
                reset_current_project_context(project_ctx_token)
            except Exception:
                pass

    agents_used: List[str] = [spec.id]
    delegations: int = 0
    if response is not None:
        for step in (response.trace or []):
            if getattr(step, "kind", "") == "tool_call" and getattr(step, "name", "") == "delegate":
                delegations += 1
                out = getattr(step, "output", None) or {}
                if isinstance(out, dict):
                    sub_id = (out.get("output") or {}).get("agent_id") if isinstance(out.get("output"), dict) else None
                    if sub_id and sub_id not in agents_used:
                        agents_used.append(sub_id)

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
                "stream":      True,
            },
        )

    task_graph_envelope: dict = {
        "run_id": run_id, "tasks": [],
        "counts": {}, "total_count": 0, "total_duration_ms": 0,
    }
    try:
        from backend.services.orchestrator import ExecutionGraph
        task_graph_envelope = ExecutionGraph.for_run(run_id).to_envelope()
    except Exception as exc:
        logger.debug("orchestrate.stream | task_graph envelope soft-failed: %s", exc)

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
        "task_graph":  task_graph_envelope,
        "metadata": {
            "project_id":         body.project_id,
            "project_context":    bool(project_block),
            "elapsed_ms":         getattr(response, "elapsed_ms", 0) if response else 0,
            "model":              spec.default_model,
            "stream":             True,
            "error":              err_msg,
        },
    }


def _now_iso() -> str:
    from datetime import datetime
    return datetime.utcnow().isoformat() + "Z"
