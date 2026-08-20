# coding: utf-8
"""Phase 6 (connected brain) — deterministic project supervisor.

Evaluates a run's CURRENT state (from the durable snapshot + decisions) and
returns a structured assessment + a single recommended next action. It is
DETERMINISTIC — no model call, no agent↔agent loop. The Workflow Runner
remains the execution authority; this only reads state and recommends.

It surfaces partial-completion truthfully (a failed App Build never discards a
completed Web Build) and marks artifacts STALE when a newer authoritative
decision post-dates the artifact — without triggering any automatic rebuild.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

# Recommended next actions (stable codes).
NA_RESOLVE_RUNNER = "resolve_runner_error"
NA_APPROVE = "approve_pending_operation"
NA_RETRY_FAILED = "retry_failed_task"
NA_RUN_CANDIDATE = "act_on_candidate_action"   # Business Brain (Phase 2/7)
NA_UPDATE_STALE = "update_stale_artifact"
NA_REVIEW = "review_deliverables"
NA_REVIEW_CANCELLED = "review_cancelled"
NA_WAIT = "wait_for_run"

# ── Autonomy levels (Phase 7) — a product-facing projection of the EXISTING
# execution policy tiers. We do NOT build a second approval system; we map
# the policy's AUTO / APPROVAL_REQUIRED / DENIED onto the three product
# concepts. A high-priority RESTRICTED action still cannot auto-execute.
AUTONOMY_AUTONOMOUS = "AUTONOMOUS"   # policy AUTO — safe/reversible/internal
AUTONOMY_REVIEW = "REVIEW"           # policy APPROVAL_REQUIRED — prepare, need approval
AUTONOMY_RESTRICTED = "RESTRICTED"   # policy DENIED — user must explicitly initiate


def autonomy_for_capability(capability: Optional[str]) -> str:
    """Map a capability onto its autonomy level via the EXISTING execution
    policy. Unknown/empty capability → REVIEW (conservative: never assume a
    recommended action is safe to auto-run)."""
    if not capability:
        return AUTONOMY_REVIEW
    try:
        from backend.services.orchestrator import execution_policy as ep
        tier = ep.classify_capability(str(capability))
        if tier == ep.POLICY_AUTO:
            return AUTONOMY_AUTONOMOUS
        if tier == ep.POLICY_DENIED:
            return AUTONOMY_RESTRICTED
        return AUTONOMY_REVIEW
    except Exception:  # pragma: no cover — fail conservative
        return AUTONOMY_REVIEW


def _stale_artifacts(snapshot: dict, decisions: List[dict]) -> List[dict]:
    """An artifact is stale when an ACTIVE decision was recorded AFTER the
    artifact deliverable was last updated. Deterministic (timestamp compare);
    never rebuilds — just flags."""
    if not decisions:
        return []
    latest_decision = max((str(d.get("created_at") or "") for d in decisions),
                          default="")
    if not latest_decision:
        return []
    stale = []
    for d in snapshot.get("deliverables") or []:
        content = d.get("content") or {}
        if not isinstance(content, dict):
            continue
        if d.get("kind") in ("web_build", "app_build") and \
                content.get("build_status") in ("completed", "handoff"):
            updated = str(d.get("updated_at") or "")
            if updated and latest_decision > updated:
                stale.append({
                    "deliverable_id": d.get("id"),
                    "build_type": content.get("build_type"),
                    "artifact_ref": content.get("artifact_ref"),
                    "reason": "a newer project decision post-dates this artifact",
                })
    return stale


def evaluate_run(
    snapshot: Optional[dict], *, decisions: Optional[List[dict]] = None,
) -> Dict[str, Any]:
    """Return a deterministic assessment of a run snapshot."""
    if not snapshot:
        return {"status": "unknown", "recommended_next_action": NA_WAIT,
                "tasks": {}, "awaiting_approval": [], "failed": [],
                "completed": [], "blocked": [], "stale_artifacts": [],
                "partial": False}

    status = snapshot.get("status")
    obs = snapshot.get("observability") or {}
    tasks = (snapshot.get("task_graph") or {}).get("tasks") or []

    by_status: Dict[str, List[dict]] = {}
    for t in tasks:
        by_status.setdefault(str(t.get("status")), []).append(
            {"id": t.get("id"), "title": t.get("title"),
             "capability": t.get("assigned_agent")})

    completed = by_status.get("completed", [])
    failed = by_status.get("failed", [])
    # Blocked = a task not started whose deps aren't all complete, or an
    # unavailable capability (skipped).
    blocked = by_status.get("skipped", []) + by_status.get("waiting", [])

    # Partial: at least one completed AND at least one failed/blocked branch.
    partial = bool(completed) and bool(failed or blocked)

    if decisions is None:
        # Resolve project_id from the run row for a durable staleness read.
        pid = ((snapshot.get("run") or {}).get("project_id"))
        if pid:
            try:
                from backend.services.orchestrator import decisions_store as dec
                decisions = dec.active_decisions(str(pid))
            except Exception:
                decisions = []
        else:
            decisions = []
    stale = _stale_artifacts(snapshot, decisions or [])

    # Recommended next action — deterministic priority order.
    if snapshot.get("runner_error"):
        nxt = NA_RESOLVE_RUNNER
    elif obs.get("pending_approvals"):
        nxt = NA_APPROVE
    elif failed:
        nxt = NA_RETRY_FAILED
    elif stale:
        nxt = NA_UPDATE_STALE
    elif status == "cancelled":
        nxt = NA_REVIEW_CANCELLED
    elif status in ("completed", "finished"):
        nxt = NA_REVIEW
    else:
        nxt = NA_WAIT

    return {
        "status": status,
        "recommended_next_action": nxt,
        "tasks": {k: len(v) for k, v in by_status.items()},
        "awaiting_approval": obs.get("pending_approvals") or [],
        "failed": failed,
        "completed": completed,
        "blocked": blocked,
        "stale_artifacts": stale,
        "partial": partial,
        "build_artifacts": obs.get("build_artifacts") or [],
    }


def _significant_metric_changes(project_id: str) -> List[dict]:
    """Deterministic, bounded scan for meaningful metric movement across a
    project's tracked metric keys. Cause-free (Phase 5 rule). Never raises."""
    try:
        from backend.services.orchestrator import metrics_store as ms
    except Exception:  # pragma: no cover
        return []
    out: List[dict] = []
    try:
        for key in ms.metric_keys(project_id)[:25]:   # bounded scan
            change = ms.detect_change(project_id, key)
            if change and change.get("significant"):
                out.append(change)
    except Exception:  # pragma: no cover — never block assessment
        return out
    return out


#: Observations READ for the assessment. The correlation that produces the
#: decision context has to SEE the related rows to relate them, so the read is
#: the same bounded slice `candidate_synthesis` and the workspace use. What is
#: RETURNED to the caller stays at the original small slice — this is one
#: query either way, and the payload does not grow six-fold to feed a
#: projection that consumes the rows in-process.
_MAX_OBSERVATIONS_READ = 60
_MAX_OBSERVATIONS_RETURNED = 10
#: Subjects named in the assessment's own focus block.
_MAX_FOCUS_SUBJECTS = 3


def _is_connector_row(row: Any) -> bool:
    """Whether an observation came from a CONNECTOR.

    The observation store is deliberately connector-neutral and other
    subsystems record rows in it, so the correlation slice is filtered to the
    canonical `CONNECTOR_SOURCES` registry — the same filter the workspace and
    the Project Brain apply. Filtered IN MEMORY, out of the rows this
    assessment already read, so honouring it costs no second query and the
    non-connector rows this function returns to the caller are unaffected."""
    if not isinstance(row, dict):
        return False
    try:
        from backend.services.orchestrator.observations_store import CONNECTOR_SOURCES
    except Exception:  # pragma: no cover — defensive
        return True
    return str(row.get("source") or "").strip().lower() in CONNECTOR_SOURCES


def _plan_from(ranked: List[dict]) -> Dict[str, Any]:
    """WHAT KORVIX CAN DO ITSELF vs WHAT NEEDS A PERSON — the split the Brain
    was never able to state.

    Every ranked candidate already carries its capability (hence its EXISTING
    execution-policy tier) and, when it came from correlated evidence, whether
    resolving the underlying problem needs a change in a system Korvix reads
    but cannot write. Both are reported as bounded lists of ids so a surface
    can say "Korvix will investigate; the deploy itself is yours" instead of
    implying the whole thing is automatic.

    This decides NOTHING and starts NOTHING. It is a projection of the ranking
    the one prioritization authority already produced."""
    automatic: List[dict] = []
    approval: List[dict] = []
    human: List[dict] = []
    for cand in ranked[:_MAX_FOCUS_SUBJECTS * 2]:
        explanation = cand.get("priority_explanation") or {}
        actionability = explanation.get("actionability") or {}
        row = {"candidate_id": cand.get("id"),
               "capability": cand.get("recommended_capability"),
               "autonomy": autonomy_for_capability(cand.get("recommended_capability"))}
        # The RESOLUTION question comes first: an action Korvix may run
        # automatically that cannot actually finish the job belongs on the
        # human list, or the split would flatter the tool.
        if str(actionability.get("resolution") or "") == "human_external":
            row["external_providers"] = list(actionability.get("external_providers") or [])
            human.append(row)
        elif row["autonomy"] == AUTONOMY_AUTONOMOUS:
            automatic.append(row)
        else:
            approval.append(row)
    return {"korvix_can_do": automatic, "needs_approval": approval,
            "needs_human": human}


def assess_business_brain(
    snapshot: Optional[dict], *,
    project_id: Optional[str] = None,
    user_id: Optional[str] = None,
    decisions: Optional[List[dict]] = None,
    goals: Optional[List[dict]] = None,
    candidate_actions: Optional[List[dict]] = None,
    observations: Optional[List[dict]] = None,
    metric_changes: Optional[List[dict]] = None,
    learnings: Optional[List[dict]] = None,
    decision_bundle: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """The Business Brain assessment — answers "WHAT MATTERS NOW?".

    Composes the EXISTING deterministic operational assessment (`evaluate_run`)
    with the Business Brain layer (active goals, recent observations, meaningful
    metric changes, prioritized candidate actions, recent decisions/learnings)
    and produces a single recommended next action.

    OPERATIONAL PRIORITY IS PRESERVED. Execution health always wins: a runner
    error / required approval / failed task is recommended BEFORE any business
    action. Business recommendations slot in AFTER those blockers and BEFORE
    stale-artifact / review. It is fully DETERMINISTIC — no model call, no
    supervisor↔agent loop. Injectable inputs support tests; by default every
    slice is read from its own authority, scoped to (user, project).

    ONE RANKING AUTHORITY, BETTER FED
    ---------------------------------
    The Brain does NOT rank. It never did, and it still does not: ordering is
    `action_prioritizer`'s, verbatim, and `top_candidate` is `ranked[0]`. What
    changed is what that authority is given — the project's DECISION CONTEXT
    (`decision_context.build`), computed once here from observations this
    assessment already reads, so the ranking can finally see production
    evidence, corroboration across independent humans, a launch tomorrow and
    whether Korvix can actually resolve the thing.

    `decision_bundle` lets a caller that already built that projection hand it
    over (see the assessment route) rather than paying for a second
    correlation of the same rows inside one request."""
    # Resolve scope from the snapshot when not passed explicitly.
    run = (snapshot or {}).get("run") or {}
    if project_id is None:
        project_id = run.get("project_id")
    if user_id is None:
        user_id = run.get("user_id")
    pid = str(project_id) if project_id else ""
    uid = str(user_id) if user_id else ""

    # ── Load the Business Brain slices (bounded, fail-soft) ──────────────
    try:
        if decisions is None and pid:
            from backend.services.orchestrator import decisions_store as dec
            decisions = dec.active_decisions(pid, limit=10)
        if goals is None and pid:
            from backend.services.orchestrator import goals_store
            goals = goals_store.active_goals(pid, limit=10)
        if candidate_actions is None and pid:
            from backend.services.orchestrator import candidate_actions_store as cas
            candidate_actions = cas.list_candidate_actions(pid, open_only=True, limit=50)
        if observations is None and pid:
            from backend.services.orchestrator import observations_store as obs
            # Owner-scoped, like the learnings read below and like every other
            # (user, project) authority. This assessment RETURNS these rows to
            # the caller, and the docstring above already promises (user,
            # project) scoping — without `user_id` the observation slice was the
            # one that did not keep that promise, so a row recorded against this
            # project by a previous/other owner could surface. Defense in depth:
            # the route's ownership gate still runs first.
            observations = obs.recent_observations(
                pid, user_id=uid, limit=_MAX_OBSERVATIONS_READ) if uid else []
        if metric_changes is None and pid:
            metric_changes = _significant_metric_changes(pid)
        if learnings is None and pid and uid:
            from backend.services.orchestrator import business_knowledge as bk
            learnings = bk.list_knowledge(
                user_id=uid, project_id=pid,
                domains=[bk.DOMAIN_LEARNING], limit=8)
    except Exception:  # pragma: no cover — never block assessment
        pass

    # Operational assessment reuses the decisions we already loaded (single read).
    operational = evaluate_run(snapshot, decisions=decisions)

    goals = goals or []
    candidate_actions = candidate_actions or []
    observations = observations or []
    metric_changes = metric_changes or []
    decisions = decisions or []
    learnings = learnings or []

    # ── The project's DECISION CONTEXT — computed ONCE, here ─────────────
    # Pure projection over the observations just read: no query, no provider
    # call, no model call, no write. It is what lets the ONE ranking authority
    # below see evidence instead of constants. Fail-soft: without it the
    # ranking degrades to exactly its previous behaviour.
    if decision_bundle is None:
        try:
            from backend.services.orchestrator import decision_context as dc
            decision_bundle = dc.build(
                [o for o in observations if _is_connector_row(o)],
                goals=goals, decisions=decisions)
        except Exception:  # pragma: no cover — never block the assessment
            decision_bundle = {}
    decision_bundle = decision_bundle or {}

    # ── Prioritize candidate actions deterministically ──────────────────
    ranked: List[dict] = []
    top: Optional[dict] = None
    try:
        from backend.services.orchestrator import action_prioritizer as ap
        ranked = ap.rank_candidates(
            candidate_actions, active_goals=goals,
            decision_contexts=decision_bundle.get("by_dedup_key") or {})
        top = ranked[0] if ranked else None
    except Exception:  # pragma: no cover
        ranked = list(candidate_actions)

    # ── Recommended next action — operational blockers ALWAYS win ────────
    op_na = operational.get("recommended_next_action")
    recommendation: Dict[str, Any] = {"type": "operational", "detail": op_na}

    # A genuinely in-flight run (a real snapshot whose deterministic next
    # action is WAIT) is a HOLD: we must not tell the user to start new
    # business work while the current run is still executing. `evaluate_run`
    # also returns WAIT for a None snapshot (no run at all) — that is NOT a
    # hold, so business recommendations proceed for a connector-driven or
    # reopened project with no active run.
    run_in_flight = (snapshot is not None) and (op_na == NA_WAIT)

    if op_na in (NA_RESOLVE_RUNNER, NA_APPROVE, NA_RETRY_FAILED):
        # Execution health / safety blocker — never hide it behind business.
        next_action = op_na
    elif run_in_flight:
        # Healthy run still executing — wait for it, but keep candidates surfaced.
        next_action = NA_WAIT
    elif top is not None:
        next_action = NA_RUN_CANDIDATE
        cap = top.get("recommended_capability")
        recommendation = {
            "type": "candidate_action",
            "candidate_id": top.get("id"),
            "title": top.get("title"),
            "capability": cap,
            "autonomy": autonomy_for_capability(cap),
            "goal_id": top.get("goal_id"),
            "aligned_to_goal": (top.get("priority_breakdown") or {}).get("aligned_to_goal", False),
            "priority_score": top.get("priority_score"),
            "priority_breakdown": top.get("priority_breakdown"),
            "evidence_refs": top.get("evidence_refs") or [],
            "confidence": top.get("confidence"),
            # WHY this one, in stable codes — the ranking authority's own
            # explanation, passed through rather than re-derived. It carries
            # the tier basis, the why-now reasons, the caveats, and the
            # honest split between what Korvix can do and what a person must
            # do in a system Korvix cannot write to.
            "priority_tier": top.get("priority_tier"),
            "priority_explanation": top.get("priority_explanation") or {},
        }
    elif op_na == NA_UPDATE_STALE:
        next_action = NA_UPDATE_STALE
    else:
        next_action = op_na  # review / review_cancelled / wait

    synthesis = decision_bundle.get("synthesis") or {}
    focus = decision_bundle.get("focus") or {}
    return {
        "status": operational.get("status"),
        "operational": operational,
        "recommended_next_action": next_action,
        "recommendation": recommendation,
        "goals": goals,
        # The bounded slice a caller renders. The wider list above was read
        # for the correlation and consumed in-process.
        "observations": observations[:_MAX_OBSERVATIONS_RETURNED],
        "metric_changes": metric_changes,
        "candidate_actions": ranked,
        "top_candidate": top,
        "decisions": decisions,
        "learnings": learnings,
        "pending_approvals": operational.get("awaiting_approval") or [],
        "stale_artifacts": operational.get("stale_artifacts") or [],
        # ── OBSERVE → PRIORITIZE → PLAN, as three distinguishable answers ──
        # `project_understanding` is what happened and what is unresolved
        # (`project_intelligence`'s synthesis, passed through); `focus` is why
        # it matters now (`decision_context`); `plan` is who can act
        # (`execution_policy`, through the ranking). Not one of them is
        # computed here — this is the Brain CONSUMING its authorities, which
        # is the only job the audit left it.
        "project_understanding": synthesis,
        "focus": focus,
        "plan": _plan_from(ranked),
    }


__all__ = [
    "evaluate_run", "assess_business_brain", "autonomy_for_capability",
    "NA_RESOLVE_RUNNER", "NA_APPROVE", "NA_RETRY_FAILED", "NA_RUN_CANDIDATE",
    "NA_UPDATE_STALE", "NA_REVIEW", "NA_REVIEW_CANCELLED", "NA_WAIT",
    "AUTONOMY_AUTONOMOUS", "AUTONOMY_REVIEW", "AUTONOMY_RESTRICTED",
]
