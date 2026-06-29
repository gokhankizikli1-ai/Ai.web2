# coding: utf-8
# Phase A.2 — `agent.run` job kind.
#
# The Project Orchestrator builds a workflow whose steps dispatch to the
# Job Queue (Phase 7). This module registers the ONE job kind those
# steps use: `agent.run`. It is the bridge between the workflow DAG
# runner (which only knows how to start a job + poll it to terminal)
# and the agent runtime (which actually runs a specialist).
#
# Why jobs and not agent_tasks: the InlineJobRunner is a real execution
# engine — it runs the handler to a terminal state and the workflow
# runner already polls job status to advance the DAG. The agent_tasks
# store is observability-only (nothing completes its rows), so steps of
# kind `agent_task` would never finish. Routing execution through a job
# kind reuses the proven Phase-7 path end-to-end.
#
# `run_agent` is imported at MODULE level (not inside the handler) so
# tests can monkeypatch `agent_run_kind.run_agent` with a fake — exactly
# the pattern v2_orchestrate.py uses.

from __future__ import annotations

import logging
from typing import Optional

from backend.services.agent.runtime import run_agent          # noqa: F401 (monkeypatch target)
from backend.services.agent.types import AgentRequest
from backend.services.jobs.registry import JobContext, is_registered, register_job

logger = logging.getLogger(__name__)

AGENT_RUN_KIND = "agent.run"


def _mark_deliverable(deliverable_id: Optional[str], status: str,
                      *, content: Optional[dict] = None,
                      error: Optional[str] = None) -> None:
    """Best-effort deliverable state update. Never raises — a broken
    deliverable write must not fail the agent's job."""
    if not deliverable_id:
        return
    try:
        from backend.services.orchestrator import deliverables_store as dstore
        if content is not None:
            dstore.set_content(deliverable_id, content, status=status)
        else:
            dstore.set_status(deliverable_id, status, error=error)
    except Exception as exc:  # pragma: no cover — defensive
        logger.debug("agent.run | deliverable update soft-failed: %s", exc)


def _mark_task(task_id: Optional[str], phase: str,
               *, result_summary: str = "", error: str = "") -> None:
    """Best-effort Phase-5.1 task-graph state update. Never raises."""
    if not task_id:
        return
    try:
        from backend.services.orchestrator import tasks_store as tstore
        if phase == "started":
            tstore.mark_started(task_id)
        elif phase == "completed":
            tstore.mark_completed(task_id, result_summary=result_summary)
        elif phase == "failed":
            tstore.mark_failed(task_id, error=error)
    except Exception as exc:  # pragma: no cover — defensive
        logger.debug("agent.run | task update soft-failed: %s", exc)


async def _agent_run_handler(ctx: JobContext) -> dict:
    """Run one specialist agent and persist its output as a deliverable.

    Payload (set by the orchestrator on the workflow step):
      assigned_agent_id  str  — spec id to run (falls back to supervisor)
      task_description   str  — the agent's user message
      run_id             str  — orchestrator run id (for correlation)
      node_id            str  — template node key
      deliverable_id     str  — deliverable row to update
      task_id            str  — Phase-5.1 task-graph row to update
      project_id         str? — project namespace
    """
    payload = ctx.record.payload or {}
    assigned       = str(payload.get("assigned_agent_id") or "supervisor")
    task_desc      = str(payload.get("task_description") or "").strip()
    run_id         = payload.get("run_id")
    deliverable_id = payload.get("deliverable_id")
    task_id        = payload.get("task_id")
    user_id        = str(ctx.record.user_id)

    # Resolve the spec. Unknown id → supervisor (never block the run).
    from backend.services.agent.specs import get_spec
    spec = get_spec(assigned) or get_spec("supervisor")
    if spec is None:
        _mark_task(task_id, "failed", error="no resolvable agent spec")
        _mark_deliverable(deliverable_id, "failed", error="no resolvable agent spec")
        raise RuntimeError(f"agent.run: cannot resolve spec for {assigned!r}")

    _mark_task(task_id, "started")
    _mark_deliverable(deliverable_id, "in_progress")
    await ctx.report_progress(15, f"running {spec.id}")

    # Model selection for the project-run path.
    #
    # The agent runtime is OpenAI-only (openai.AsyncOpenAI →
    # chat.completions.create). The cross-provider router
    # (model_routing.resolve_model_for_spec) resolves some specialists to
    # NON-OpenAI ids — e.g. researcher → "gemini-2.5-pro", frontend →
    # "claude-sonnet-*" — which the OpenAI client rejects with a 400, so
    # the agent returns an empty/fallback reply and the deliverable fails.
    # We therefore pin a known-good OpenAI model here and do NOT consult
    # the router on this path (provider=openai, base_url=OpenAI default,
    # key=OPENAI_API_KEY). gpt-4o-mini is valid, cheap, and sufficient
    # for the M2 artifact generators.
    model = "gpt-4o-mini"

    # EPIC 2 — expand the prompt via the generation engine (planning +
    # invisible prompt expansion + component selection + design
    # directives). Orchestration-independent; falls back to the raw task
    # instructions if the engine is unavailable.
    user_message = task_desc or "Proceed with your assigned task."
    try:
        from backend.services.generation import build_prompt as _build_prompt
        user_message = _build_prompt(
            deliverable_kind=str(payload.get("deliverable_kind") or ""),
            node_role=spec.id,
            base_instructions=task_desc or "",
            user_request=str(payload.get("user_request") or ""),
        )
    except Exception as exc:  # pragma: no cover — never block a run
        logger.debug("generation.build_prompt soft-failed: %s", exc)

    request = AgentRequest(
        user_message=user_message,
        mode=spec.id,
        user_id=user_id,
        model=model,
        temperature=getattr(spec, "temperature", 0.7),
        max_tokens=2000,
        system_prompt=spec.system_prompt,
        max_steps=getattr(spec, "max_steps", 6),
        spec=spec,
        # Tool calling is disabled for the project-run path until the
        # runtime's tool-call message loop is hardened (truncated
        # tool_calls violate OpenAI's "assistant tool_calls must be
        # followed by matching tool messages" contract). Agents produce
        # their deliverable from the model directly — non-empty + valid.
        allow_tools=False,
        metadata_in={
            "orchestrator_agent_run": True,
            "run_id":   run_id,
            "node_id":  payload.get("node_id"),
            "project_id": payload.get("project_id"),
        },
    )

    try:
        response = await run_agent(request)
    except Exception as exc:
        _mark_task(task_id, "failed", error=f"{type(exc).__name__}: {exc}")
        _mark_deliverable(deliverable_id, "failed", error=str(exc)[:300])
        raise

    reply = (getattr(response, "reply", "") or "").strip()

    # Fail loudly when the agent produced no usable output. The agent
    # runtime is OpenAI-only and degrades to an EMPTY, `fallback=True`
    # response when it can't reach the model (missing OPENAI_API_KEY, a
    # non-OpenAI MODEL_* id routed to the OpenAI client, a timeout, ...).
    # Marking that "completed" yields a green run with blank deliverables
    # — a silent fake-success. Instead, fail the step with an actionable
    # reason so the run surfaces the real problem (and the workflow's
    # failure handling skips the downstream steps).
    is_fallback = bool(getattr(response, "fallback", False))
    if is_fallback or not reply:
        meta = getattr(response, "metadata", None) or {}
        reason = meta.get("fallback_reason") or "agent returned no content"
        detail = (
            f"agent '{spec.id}' produced no output ({reason}). "
            "Check OPENAI_API_KEY and that MODEL_* routing resolves to an "
            "OpenAI model id."
        )
        _mark_task(task_id, "failed", error=detail)
        _mark_deliverable(deliverable_id, "failed", error=detail[:300])
        raise RuntimeError(detail)

    await ctx.report_progress(90, "persisting deliverable")

    # EPIC 1 / M2 — turn the raw reply into a typed, previewable artifact
    # (html → iframe, react_component / project_file → code, file_tree →
    # tree, else markdown). `text` is preserved for back-compat.
    # EPIC 2 — finalize through the generation engine (visual polish +
    # design-system enforcement + accessibility + internal quality review
    # + one deterministic premium-refinement pass + metadata). Falls back
    # to the base artifact builder if the engine is unavailable.
    kind = str(payload.get("deliverable_kind") or "")
    title = str(payload.get("node_title") or payload.get("node_id") or "artifact")
    try:
        from backend.services.generation import finalize_artifact as _finalize
        artifact = _finalize(
            deliverable_kind=kind, node_title=title, raw_reply=reply,
            user_request=str(payload.get("user_request") or ""),
        )
    except Exception as exc:  # pragma: no cover — never block a run
        logger.debug("generation.finalize_artifact soft-failed: %s", exc)
        from backend.services.orchestrator.artifacts import build_artifact
        artifact = build_artifact(kind=kind, title=title, text=reply)
    content = {
        "text":     reply,
        "agent_id": spec.id,
        "node_id":  payload.get("node_id"),
        "artifact": artifact,
    }
    _mark_deliverable(deliverable_id, "completed", content=content)

    from backend.services.orchestrator.execution_graph import truncate_for_summary
    _mark_task(task_id, "completed", result_summary=truncate_for_summary(reply))

    return {
        "agent_id":       spec.id,
        "run_id":         run_id,
        "node_id":        payload.get("node_id"),
        "deliverable_id": deliverable_id,
        "reply_chars":    len(reply),
    }


def ensure_registered() -> None:
    """Idempotently register the `agent.run` job kind.

    `register_job` raises on a duplicate kind, so we guard on
    `is_registered`. This makes the module safe to import repeatedly and
    safe against the test harness's registry resets (a test that clears
    the registry can call this to put the kind back)."""
    if not is_registered(AGENT_RUN_KIND):
        register_job(AGENT_RUN_KIND)(_agent_run_handler)


# Register on import so any code path that imports the orchestrator
# service (which imports this module) makes the kind available.
ensure_registered()


__all__ = ["AGENT_RUN_KIND", "ensure_registered"]
