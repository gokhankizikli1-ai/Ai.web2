# coding: utf-8
"""Phase 3 — production Web Build / App Build capability bridge.

WHAT THIS IS
------------
Two new orchestrator job kinds — `web_build.run` and `app_build.run` —
that let a Project Orchestrator workflow step trigger a REAL production Web
Build or App Build, without duplicating (or rewriting) those pipelines.

WHY IT LOOKS LIKE THIS
----------------------
The Phase 3 audit established that the production Web/App build ORCHESTRATION
loop (planning → generation → review → single bounded repair → acceptance →
preview → persistence) lives in the **frontend TypeScript spine**
(`src/lib/webBuild*.ts`, `ChatWebBuild.tsx`). The Python backend is a
stateless transport. There is deliberately no second copy of the builder
intelligence in Python, and this module does NOT create one.

So the architectural contract (from the spec) is:

    Orchestrator  →  PLANS · ROUTES · TRACKS
    Builder       →  GENERATES · VALIDATES · REVIEWS · REPAIRS · ACCEPTS

This module is the thin ADAPTER that sits at the seam. It:
  * accepts a BOUNDED, structured executor input (ids, goal, product spec,
    brand, projected upstream context, build type, approval metadata) —
    never the whole project history;
  * calls a PLUGGABLE executor for the build type;
  * persists only a compact deliverable REFERENCE (build status + artifact
    ref + build ref + summary + cost ref) — never a giant source tree copied
    into a task row.

THE EXECUTOR SEAM
-----------------
`register_build_executor("web"|"app", fn)` is where a real executor plugs
in — the client-orchestrated spine, or a future staged run backend
(`POST /v2/web-build/runs` + SSE, which the TS code already anticipates).
The executor is where the (paid) model work happens; this module never makes
a model/provider call itself. Tests register a MOCK executor, so the whole
adapter is verified with zero paid builds.

When NO real executor is registered, the default executor returns a durable
HANDOFF record (status="handoff") — an honest "this build is routed and
awaiting the production builder", never a fabricated "completed" with fake
source. That keeps the run truthful instead of showing a green build with no
artifact.

LEGACY SEPARATION
-----------------
This is entirely distinct from the legacy `app_prototype` single-file-HTML
orchestrator template (`templates/app.py`). `app_build.run` must NEVER route
into that legacy flow. It is the production App Build capability.
"""
from __future__ import annotations

import inspect
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, Optional, Union

from backend.services.jobs.registry import JobContext, is_registered, register_job

logger = logging.getLogger(__name__)

WEB_BUILD_KIND = "web_build.run"
APP_BUILD_KIND = "app_build.run"

BUILD_TYPE_WEB = "web"
BUILD_TYPE_APP = "app"

# Deliverable kinds — deliberately distinct from the legacy
# `app_prototype_html` / page kinds the agent.run path uses.
DELIVERABLE_KIND = {BUILD_TYPE_WEB: "web_build", BUILD_TYPE_APP: "app_build"}


# ── Executor contract ────────────────────────────────────────────────────

@dataclass
class BuildExecutorInput:
    """The bounded, structured input a build executor receives. No full
    project history — just what a build needs."""
    build_type: str
    user_id: str
    project_id: Optional[str]
    run_id: Optional[str]
    task_id: Optional[str]
    deliverable_id: Optional[str]
    node_id: Optional[str]
    user_goal: str
    product_spec: Dict[str, Any] = field(default_factory=dict)
    brand: Dict[str, Any] = field(default_factory=dict)
    upstream_context: str = ""
    approval: Dict[str, Any] = field(default_factory=dict)


@dataclass
class BuildExecutorResult:
    """The compact result a build executor returns. References, not blobs."""
    status: str                       # "completed" | "handoff" | "failed"
    artifact_ref: str = ""            # reference to the produced artifact
    build_ref: str = ""               # e.g. web-build run id / project build id
    summary: str = ""                 # compact, human-readable
    cost_ref: Optional[Dict[str, Any]] = None
    detail: str = ""


BuildExecutor = Callable[
    [BuildExecutorInput],
    Union[BuildExecutorResult, Awaitable[BuildExecutorResult]],
]

_EXECUTORS: Dict[str, BuildExecutor] = {}


def register_build_executor(build_type: str, fn: BuildExecutor) -> None:
    """Register the real executor for a build type. Overwrites any prior
    registration (idempotent re-register is fine)."""
    _EXECUTORS[str(build_type)] = fn


def unregister_build_executor(build_type: str) -> None:
    _EXECUTORS.pop(str(build_type), None)


def _default_executor(inp: BuildExecutorInput) -> BuildExecutorResult:
    """No real builder wired in this process → durable handoff record.

    Deterministic, zero-cost, no model call. The artifact_ref is a stable
    build-request handle the production builder (client spine / staged
    backend) can fulfil. Truthful: status is "handoff", not "completed"."""
    ref = f"buildreq:{inp.build_type}:{inp.run_id or '-'}:{inp.task_id or inp.node_id or '-'}"
    return BuildExecutorResult(
        status="handoff",
        artifact_ref=ref,
        build_ref="",
        summary=(
            f"{inp.build_type} build routed and tracked (handoff — awaiting "
            f"the production builder)"
        ),
        cost_ref=None,
        detail="no backend build executor registered; handed off to the production builder",
    )


# ── Node-state helpers (reuse the existing stores; never raise) ──────────

def _mark_deliverable(deliverable_id: Optional[str], status: str, *,
                      content: Optional[dict] = None,
                      error: Optional[str] = None) -> None:
    if not deliverable_id:
        return
    try:
        from backend.services.orchestrator import deliverables_store as dstore
        if content is not None:
            dstore.set_content(deliverable_id, content, status=status)
        else:
            dstore.set_status(deliverable_id, status, error=error)
    except Exception as exc:  # pragma: no cover — defensive
        logger.debug("build_capability | deliverable update soft-failed: %s", exc)


def _mark_task(task_id: Optional[str], phase: str, *,
               result_summary: str = "", error: str = "") -> None:
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
        logger.debug("build_capability | task update soft-failed: %s", exc)


def _bounded_input(build_type: str, ctx: JobContext) -> BuildExecutorInput:
    """Assemble the bounded executor input from the step payload + the
    Phase-2 upstream context projection. Never the whole project history."""
    payload = ctx.record.payload or {}
    run_id = payload.get("run_id")

    # Phase 4 — capability-aware Project Intelligence packet (product
    # decisions + brand + relevant research + artifact refs + direct upstream),
    # tailored to the build capability. Bounded + deterministic; fail-open.
    upstream = ""
    try:
        from backend.services.orchestrator.project_intelligence import (
            build_intelligence_packet,
        )
        upstream = build_intelligence_packet(
            capability=f"{build_type}_build",
            run_id=str(run_id or ""),
            project_id=payload.get("project_id"),
            depends_on=payload.get("depends_on") or [],
            user_goal=str(payload.get("user_request") or payload.get("task_description") or ""),
            user_id=str(ctx.record.user_id),
        )
    except Exception:  # pragma: no cover — never block a build
        upstream = ""

    def _as_dict(v: Any) -> dict:
        return v if isinstance(v, dict) else {}

    return BuildExecutorInput(
        build_type=build_type,
        user_id=str(ctx.record.user_id),
        project_id=payload.get("project_id"),
        run_id=run_id,
        task_id=payload.get("task_id"),
        deliverable_id=payload.get("deliverable_id"),
        node_id=payload.get("node_id"),
        user_goal=str(payload.get("user_request") or payload.get("task_description") or "")[:4000],
        product_spec=_as_dict(payload.get("product_spec") or payload.get("blueprint")),
        brand=_as_dict(payload.get("brand")),
        upstream_context=upstream,
        approval=_as_dict(payload.get("approval")),
    )


async def _run_build(build_type: str, ctx: JobContext) -> dict:
    payload = ctx.record.payload or {}
    task_id = payload.get("task_id")
    deliverable_id = payload.get("deliverable_id")

    inp = _bounded_input(build_type, ctx)
    capability = f"{build_type}_build"

    # Phase 5 — execution policy gate. A paid build is APPROVAL_REQUIRED;
    # when enforcement is on (ENABLE_EXECUTION_APPROVAL) it must have a
    # durable approval bound to this operation's fingerprint, and pass the
    # global-spend + credit gates, before ANY (paid) executor work. Dormant
    # by default → allowed, so behaviour is unchanged until enforcement is
    # switched on.
    from backend.services.orchestrator import execution_policy
    decision = execution_policy.authorize(
        user_id=inp.user_id, capability=capability, spec=inp.product_spec,
        project_id=inp.project_id,
        inline_approval=bool((inp.approval or {}).get("inline")),
        approved_by=str((inp.approval or {}).get("by", "")),
    )
    if not decision.allowed:
        detail = (
            f"{capability} not authorized: {decision.code} — {decision.detail}"
        )
        _mark_deliverable(deliverable_id, "failed", content={
            "build_type":        build_type,
            "build_status":      "blocked",
            "policy_code":       decision.code,
            "requires_approval": decision.code == execution_policy.CODE_APPROVAL_REQUIRED,
            "fingerprint":       decision.fingerprint,
            "summary":           detail,
            "node_id":           payload.get("node_id"),
        }, error=detail[:300])
        _mark_task(task_id, "failed", error=detail)
        raise RuntimeError(detail)

    _mark_task(task_id, "started")
    _mark_deliverable(deliverable_id, "in_progress")
    await ctx.report_progress(15, f"routing {build_type} build")

    executor = _EXECUTORS.get(build_type, _default_executor)

    try:
        _call = getattr(executor, "__call__", executor)
        if inspect.iscoroutinefunction(executor) or inspect.iscoroutinefunction(_call):
            result = await executor(inp)
        else:
            # A SYNC executor (e.g. NodeBuildExecutor's blocking subprocess)
            # must not run on the event loop — offload the CALL to a worker
            # thread so the inline job path never blocks the loop for the
            # build's timeout window.
            import asyncio
            result = await asyncio.to_thread(executor, inp)
    except Exception as exc:
        detail = f"{build_type} build executor error: {type(exc).__name__}: {exc}"
        _mark_task(task_id, "failed", error=detail)
        _mark_deliverable(deliverable_id, "failed", error=detail[:300])
        raise RuntimeError(detail) from exc

    if not isinstance(result, BuildExecutorResult):
        detail = f"{build_type} build executor returned an invalid result"
        _mark_task(task_id, "failed", error=detail)
        _mark_deliverable(deliverable_id, "failed", error=detail[:300])
        raise RuntimeError(detail)

    await ctx.report_progress(90, "persisting build reference")

    # Store ONLY a compact reference — never a source tree.
    content = {
        "build_type":   build_type,
        "build_status": result.status,
        "artifact_ref": result.artifact_ref,
        "build_ref":    result.build_ref,
        "summary":      result.summary,
        "cost_ref":     result.cost_ref,
        "node_id":      payload.get("node_id"),
    }

    if result.status == "failed":
        _mark_task(task_id, "failed", error=result.detail or "build failed")
        _mark_deliverable(deliverable_id, "failed", content=content,
                          error=(result.detail or "build failed")[:300])
        raise RuntimeError(result.detail or f"{build_type} build failed")

    # Phase 5 — idempotent charging. Only a REAL completed build (not a
    # handoff) settles a charge, and the reference is the stable step
    # idempotency key (`wf:...:step:...`), so a retried dispatch charges at
    # most once. No-op while the credits ledger is dormant.
    if result.status == "completed":
        try:
            ref = getattr(ctx.record, "idempotency_key", None) or (
                f"{build_type}_build:{payload.get('run_id')}:{payload.get('task_id')}"
            )
            execution_policy.settle_charge(
                user_id=inp.user_id, capability=capability, reference=str(ref),
                reason=f"{build_type} build",
            )
        except Exception:  # pragma: no cover — charging must not fail a done build
            pass

    # "completed" (real artifact) or "handoff" (routed, awaiting builder) —
    # both are a truthful terminal state for the capability (routing +
    # tracking succeeded). The deliverable content records which.
    _mark_deliverable(deliverable_id, "completed", content=content)
    _mark_task(task_id, "completed",
               result_summary=(result.summary or f"{build_type} build routed")[:600])

    return {
        "build_type":     build_type,
        "build_status":   result.status,
        "artifact_ref":   result.artifact_ref,
        "build_ref":      result.build_ref,
        "deliverable_id": deliverable_id,
        "run_id":         payload.get("run_id"),
        "node_id":        payload.get("node_id"),
    }


async def _web_build_handler(ctx: JobContext) -> dict:
    return await _run_build(BUILD_TYPE_WEB, ctx)


async def _app_build_handler(ctx: JobContext) -> dict:
    # NOTE: production App Build — NOT the legacy app_prototype template.
    return await _run_build(BUILD_TYPE_APP, ctx)


# ── Phase 2 — pre-dispatch approval gate ─────────────────────────────────

def _capability_for_kind(job_kind: Optional[str]) -> Optional[str]:
    if job_kind == WEB_BUILD_KIND:
        return f"{BUILD_TYPE_WEB}_build"
    if job_kind == APP_BUILD_KIND:
        return f"{BUILD_TYPE_APP}_build"
    return None


def build_step_gate(step, user_id: str, project_id: Optional[str]):
    """Runner pre-dispatch gate: a paid build step that requires approval
    PAUSES (awaiting_approval) instead of dispatching + failing. Returns a
    StepGateDecision or None (proceed). When approval enforcement is off,
    `authorize` returns allowed → None → normal dispatch (unchanged)."""
    if getattr(step, "kind", None) != "job":
        return None
    payload = getattr(step, "payload", None) or {}
    capability = _capability_for_kind(payload.get("kind"))
    if capability is None:
        return None

    inp = payload.get("input") or {}
    spec = inp.get("product_spec") or inp.get("blueprint") or {}
    from backend.services.orchestrator import execution_policy
    decision = execution_policy.authorize(
        user_id=user_id, capability=capability, spec=spec, project_id=project_id,
        inline_approval=bool((inp.get("approval") or {}).get("inline")),
    )
    if decision.allowed:
        return None

    from backend.services.workflows.runner import StepGateDecision
    if decision.code == execution_policy.CODE_APPROVAL_REQUIRED:
        # Surface the pending approval on the deliverable (non-terminal) so
        # the observability/workspace layer can render "awaiting approval".
        _mark_deliverable(inp.get("deliverable_id"), "pending", content={
            "build_type":        capability.split("_")[0],
            "capability":        capability,
            "build_status":      "awaiting_approval",
            "requires_approval": True,
            "fingerprint":       decision.fingerprint,
            "node_id":           inp.get("node_id"),
        })
        return StepGateDecision(
            action="await_approval", code=decision.code, reason=decision.detail,
            fingerprint=decision.fingerprint, capability=capability,
        )
    # DENIED / credit / spend at gate time → deny (fail), not a pause.
    return StepGateDecision(
        action="deny", code=decision.code, reason=decision.detail,
        fingerprint=decision.fingerprint, capability=capability,
    )


def ensure_registered() -> None:
    """Idempotently register both build capability kinds + the approval gate."""
    if not is_registered(WEB_BUILD_KIND):
        register_job(WEB_BUILD_KIND)(_web_build_handler)
    if not is_registered(APP_BUILD_KIND):
        register_job(APP_BUILD_KIND)(_app_build_handler)
    # Register the pre-dispatch approval gate with the workflow runner.
    try:
        from backend.services.workflows.runner import register_step_gate
        register_step_gate(build_step_gate)
    except Exception:  # pragma: no cover — runner optional at import
        pass


ensure_registered()


__all__ = [
    "WEB_BUILD_KIND", "APP_BUILD_KIND",
    "BUILD_TYPE_WEB", "BUILD_TYPE_APP", "DELIVERABLE_KIND",
    "BuildExecutorInput", "BuildExecutorResult",
    "register_build_executor", "unregister_build_executor",
    "ensure_registered",
]
