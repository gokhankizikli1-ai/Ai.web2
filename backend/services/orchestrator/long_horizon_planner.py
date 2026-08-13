# coding: utf-8
"""Phase 6 — long-horizon project planner.

WHAT IT IS (and is NOT)
-----------------------
For a PROJECT-SCALE goal, this turns the goal into a bounded, persistent,
capability-backed task DAG. It is NOT a replacement for the cheap rule-based
`coordinator` (which stays the fast router / simple-task fast path) and it is
NOT an autonomous agent swarm:

  * exactly ONE planning call — `_planner_fn(goal, context)` is invoked once,
    no loops, no planner↔agent conversations;
  * the default planner is DETERMINISTIC (free) — a real LLM planner can be
    plugged in via `set_planner`, but the contract stays "one bounded call";
  * plans may only reference REAL registered capabilities (unknown / future
    capabilities are emitted truthfully as `blocked` tasks, never runnable);
  * the plan is PERSISTED with stable task ids, and re-planning invalidates
    approvals for any task whose fingerprint materially changed.

OUTPUT
------
A structured Plan: goal + tasks, each task carrying capability, title,
dependencies, deliverable expectation, risk, availability, and approval
requirement (derived from the execution policy + capability registry).
"""
from __future__ import annotations

import logging
import re
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Dict, List, Optional

from backend.services.orchestrator import (
    capability_registry as capabilities,
    execution_policy,
)

logger = logging.getLogger(__name__)


@dataclass
class PlannedTask:
    id: str
    capability: str
    title: str
    depends_on: List[str] = field(default_factory=list)
    deliverable_kind: str = ""
    risk: str = "low"
    available: bool = True
    status: str = "planned"           # planned | blocked | not_supported
    approval_required: bool = False


@dataclass
class Plan:
    goal: str
    tasks: List[PlannedTask] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {"goal": self.goal, "tasks": [asdict(t) for t in self.tasks]}


# ── Deterministic default planner ────────────────────────────────────────

_APP_RE = re.compile(r"\b(app|mobile|ios|android|screen|dashboard app)\b", re.I)
_WEB_RE = re.compile(r"\b(web ?site|landing|marketing site|web app|web)\b", re.I)
_SAAS_RE = re.compile(r"\b(saas|platform|product|startup|business|tool)\b", re.I)


def _stable_id(prefix: str, index: int) -> str:
    return f"{prefix}{index}"


def _finalize_task(pt: PlannedTask) -> PlannedTask:
    """Fill availability / approval / deliverable from the registry so a
    plan never claims an unavailable capability is runnable."""
    cap = capabilities.get(pt.capability)
    if cap is None:
        pt.available = False
        pt.status = "not_supported"
        pt.approval_required = False
        return pt
    pt.available = cap.available
    pt.deliverable_kind = pt.deliverable_kind or cap.deliverable_kind
    pt.approval_required = cap.approval_required
    if not cap.available:
        pt.status = "blocked"
    return pt


def _default_planner(goal: str, context: Optional[dict]) -> Plan:
    """Rule-based, free decomposition. Bounded: emits a small DAG
    (research → product → build[s] → qa) sized to the goal. Deterministic —
    the same goal always yields the same plan."""
    g = goal or ""
    wants_app = bool(_APP_RE.search(g))
    wants_web = bool(_WEB_RE.search(g))
    is_project = bool(_SAAS_RE.search(g)) or wants_app or wants_web

    tasks: List[PlannedTask] = []

    # Simple / non-project goal → a single research task (cheap).
    if not is_project:
        tasks.append(PlannedTask(id=_stable_id("t", 1), capability="research",
                                 title=f"Research: {g[:80]}", risk="low"))
        return Plan(goal=g, tasks=[_finalize_task(t) for t in tasks])

    # Project-scale goal → research → product → build(s) → qa.
    research = PlannedTask(id="t1", capability="research",
                           title="Research the market and domain")
    product = PlannedTask(id="t2", capability="product",
                          title="Define the product", depends_on=["t1"])
    tasks += [research, product]

    build_ids: List[str] = []
    idx = 3
    if wants_app or (not wants_web and is_project):
        app = PlannedTask(id=f"t{idx}", capability="app_build",
                          title="Production App Build", depends_on=["t2"],
                          risk="medium")
        tasks.append(app)
        build_ids.append(app.id)
        idx += 1
    if wants_web or (not wants_app and is_project):
        web = PlannedTask(id=f"t{idx}", capability="web_build",
                          title="Production Web Build", depends_on=["t2"],
                          risk="medium")
        tasks.append(web)
        build_ids.append(web.id)
        idx += 1

    # QA depends on the builds — declared but truthfully blocked (not yet
    # available), so the plan is honest about the roadmap.
    qa = PlannedTask(id=f"t{idx}", capability="qa",
                     title="QA the generated product", depends_on=build_ids or ["t2"])
    tasks.append(qa)

    return Plan(goal=g, tasks=[_finalize_task(t) for t in tasks])


# The single pluggable planner function. Default deterministic; a real LLM
# planner may replace it (still called exactly once per plan_goal).
_planner_fn: Callable[[str, Optional[dict]], Plan] = _default_planner


def set_planner(fn: Callable[[str, Optional[dict]], Plan]) -> None:
    global _planner_fn
    _planner_fn = fn


def reset_planner() -> None:
    global _planner_fn
    _planner_fn = _default_planner


def _fingerprints(plan: Plan) -> Dict[str, str]:
    """Per-task operation fingerprint keyed by task id — used to detect
    which tasks materially changed between plan versions."""
    out: Dict[str, str] = {}
    for t in plan.tasks:
        spec = {"title": t.title, "depends_on": sorted(t.depends_on),
                "deliverable_kind": t.deliverable_kind}
        out[t.id] = execution_policy.operation_fingerprint(t.capability, spec)
    return out


def plan_goal(
    goal: str,
    *,
    user_id: str,
    project_id: Optional[str] = None,
    context: Optional[dict] = None,
    persist: bool = True,
    plan_id: Optional[str] = None,
    goal_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Produce (and optionally persist) a bounded, capability-backed plan for
    a goal. The planner function is invoked EXACTLY ONCE.

    When replacing an existing plan (`plan_id`), any task whose fingerprint
    materially changed has its capability's approvals revoked, so a changed
    plan can never execute under a stale approval.

    `goal_id` optionally links the persisted plan to a durable Business Brain
    goal, so the planned work is traceable to the outcome it serves. The
    planner remains the planning authority — the goal hierarchy sits ABOVE it,
    it is not a second planner.
    """
    plan = _planner_fn(goal, context)
    # Defensive: re-finalize against the registry even if a custom planner
    # forgot to, so availability/approval flags are always truthful.
    plan.tasks = [_finalize_task(t) for t in plan.tasks]

    result: Dict[str, Any] = plan.to_dict()

    if not persist:
        return result

    from backend.services.orchestrator import plans_store, approvals_store

    prior = plans_store.get_plan(plan_id) if plan_id else None
    saved_id = plans_store.save_plan(
        user_id=user_id, goal=goal, tasks=result["tasks"],
        project_id=project_id, plan_id=plan_id, goal_id=goal_id,
    )
    result["plan_id"] = saved_id
    if goal_id:
        result["goal_id"] = goal_id

    # Invalidate approvals for materially-changed paid tasks.
    if prior:
        try:
            prior_fps = {
                t.get("id"): execution_policy.operation_fingerprint(
                    t.get("capability", ""),
                    {"title": t.get("title", ""),
                     "depends_on": sorted(t.get("depends_on", []) or []),
                     "deliverable_kind": t.get("deliverable_kind", "")},
                )
                for t in (prior.get("tasks") or [])
            }
            new_fps = _fingerprints(plan)
            changed_caps = set()
            by_id = {t.id: t for t in plan.tasks}
            for tid, fp in new_fps.items():
                if prior_fps.get(tid) not in (None, fp):
                    cap = by_id[tid].capability
                    if by_id[tid].approval_required:
                        changed_caps.add(cap)
            for cap in changed_caps:
                approvals_store.revoke_for_capability(
                    user_id=user_id, capability=cap, project_id=project_id,
                )
                result.setdefault("invalidated_approvals", []).append(cap)
        except Exception as exc:  # pragma: no cover — invalidation is best-effort
            logger.debug("plan approval invalidation soft-failed: %s", exc)

    return result


__all__ = [
    "PlannedTask", "Plan", "plan_goal", "set_planner", "reset_planner",
]
