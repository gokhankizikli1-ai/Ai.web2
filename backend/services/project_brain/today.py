# coding: utf-8
"""Project Workspace — TODAY: "what should I care about right now?"

WHAT THIS IS
------------
A PURE, zero-I/O projection over state the workspace read model has already
assembled. Given the ranked Needs-Attention list, the project's own tasks and
its active goals, it answers two questions at the top of the Project page:

    the single most urgent real problem       → `attention`
    the single most useful next move          → `recommendation`

and nothing else. There is no health score, no percentage, no confidence, no
"you are 68% on track", no invented deadline and no "everything looks great".
Every field is either a value that came from an authority verbatim or a stable
code the frontend renders through the shipped locale dictionaries.

WHY IT IS NOT THE BUSINESS BRAIN'S PRIORITIZER
----------------------------------------------
`action_prioritizer` ranks CANDIDATE ACTIONS, and a candidate action only
exists after `candidate_synthesis` has WRITTEN one. Opening a project page must
never write, so the workspace cannot go down that path without turning a page
load into a Business Brain mutation. This module is therefore the same kind of
thing `attention.py` already is: a small, documented, deterministic
PRESENTATION ranking over authoritative state — explicitly not a second
recommendation engine, and explicitly not an entrance to execution.

A RECOMMENDATION AUTHORIZES NOTHING
-----------------------------------
It is a sentence and, at most, two buttons. Rendering one starts no run,
creates no task, records no candidate action and calls no model or provider.
The only way anything happens is the person pressing "Create task" or "Ask
Korvix", both of which are ordinary explicit user actions.

THE LADDER (first match wins, fully deterministic)
--------------------------------------------------
  1. The top-ranked OPEN attention signal. Something the user owns is broken,
     time-sensitive or waiting — that outranks every plan.
  2. A task in `doing`, then `todo`, then `waiting`, in the task store's own
     canonical order (priority DESC, created_at ASC). What you already started
     outranks what you have not.
  3. The highest-priority active goal.
  4. Nothing. A project with no signal, no task and no goal gets NO
     recommendation — the page says so honestly rather than inventing one.

COST: pure functions. ZERO model tokens, ZERO network, ZERO writes.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

from backend.services.project_brain import attention as attention_mod
from backend.services.projects import tasks_store

# ── Recommendation reason codes. STABLE identifiers, never user-facing prose.
RECO_INVESTIGATE_DEPLOY = "investigate_failed_deploy"
RECO_INVESTIGATE_PREVIEW_DEPLOY = "investigate_failed_preview_deploy"
RECO_FIX_CHECKS = "fix_failing_checks"
RECO_FIX_BUILD = "fix_failed_build"
RECO_REVIEW_PR = "review_open_pull_request"
RECO_PREPARE_MEETING = "prepare_for_meeting"
RECO_REVIEW_CALENDAR = "review_calendar_change"
RECO_REVIEW_SIGNAL = "review_signal"
RECO_CONTINUE_TASK = "continue_task"
RECO_START_TASK = "start_task"
RECO_UNBLOCK_TASK = "unblock_task"
RECO_CONTINUE_GOAL = "continue_goal"

#: Where a recommendation came from. Also tells the frontend which id space
#: `ref_id` lives in.
SOURCE_ATTENTION = "attention"
SOURCE_TASK = "task"
SOURCE_GOAL = "goal"

# ── Action codes. Each names an affordance that ALREADY exists on the page, so
#    a recommendation can never render a button that does nothing.
ACTION_ASK = "ask_korvix"        # opens a project chat seeded with a question
ACTION_CREATE_TASK = "create_task"  # opens the task composer, prefilled
ACTION_OPEN_TASKS = "open_tasks"    # switches to the Tasks view

#: Attention reason → recommendation reason. An attention reason this table
#: does not know still produces a recommendation, just a generic one — the
#: signal is real either way, and dropping it would be worse than saying
#: "worth a look".
_ATTENTION_TO_RECOMMENDATION: Dict[str, str] = {
    attention_mod.REASON_DEPLOY_FAILED:         RECO_INVESTIGATE_DEPLOY,
    attention_mod.REASON_PREVIEW_DEPLOY_FAILED: RECO_INVESTIGATE_PREVIEW_DEPLOY,
    attention_mod.REASON_CI_FAILED:             RECO_FIX_CHECKS,
    attention_mod.REASON_BUILD_FAILED:          RECO_FIX_BUILD,
    attention_mod.REASON_PR_AWAITING:           RECO_REVIEW_PR,
    attention_mod.REASON_MEETING_SOON:          RECO_PREPARE_MEETING,
    attention_mod.REASON_MEETING_CANCELLED:     RECO_REVIEW_CALENDAR,
}

#: Task status → recommendation reason, in ladder order.
_TASK_LADDER = (
    (tasks_store.STATUS_DOING,   RECO_CONTINUE_TASK),
    (tasks_store.STATUS_TODO,    RECO_START_TASK),
    (tasks_store.STATUS_WAITING, RECO_UNBLOCK_TASK),
)


def _s(value: Any, limit: int = 240) -> str:
    out = "" if value is None else str(value)
    return out[:limit]


def _recommendation(*, reason: str, source: str, ref_id: str, title: str,
                    context: str, actions: Sequence[str]) -> Dict[str, Any]:
    return {
        "reason":  reason,
        "source":  source,
        "ref_id":  _s(ref_id, 64),
        "title":   _s(title),
        "context": _s(context, 160),
        "actions": list(actions),
    }


def _from_attention(item: Dict[str, Any]) -> Dict[str, Any]:
    reason = _ATTENTION_TO_RECOMMENDATION.get(
        _s(item.get("reason"), 60), RECO_REVIEW_SIGNAL)
    return _recommendation(
        reason=reason, source=SOURCE_ATTENTION,
        ref_id=_s(item.get("id"), 64), title=_s(item.get("title")),
        context=_s(item.get("context"), 160),
        # "Create task" turns a signal into something the user tracks; it does
        # NOT act on the signal. Nothing here can start a run.
        actions=(ACTION_ASK, ACTION_CREATE_TASK),
    )


def _from_task(task: Dict[str, Any], reason: str) -> Dict[str, Any]:
    return _recommendation(
        reason=reason, source=SOURCE_TASK, ref_id=_s(task.get("id"), 64),
        title=_s(task.get("title")), context="",
        actions=(ACTION_OPEN_TASKS, ACTION_ASK),
    )


def _from_goal(goal: Dict[str, Any]) -> Dict[str, Any]:
    return _recommendation(
        reason=RECO_CONTINUE_GOAL, source=SOURCE_GOAL,
        ref_id=_s(goal.get("id"), 64), title=_s(goal.get("title")), context="",
        actions=(ACTION_CREATE_TASK, ACTION_ASK),
    )


def build_today(
    *,
    attention: Sequence[Dict[str, Any]] = (),
    tasks: Sequence[Dict[str, Any]] = (),
    goals: Sequence[Dict[str, Any]] = (),
) -> Dict[str, Any]:
    """The Today block. `attention` must already be ranked by
    `attention.rank_attention` and `tasks` by `tasks_store.list_tasks` — this
    function re-ranks nothing, it only chooses.

    Returns `{"attention": item|None, "recommendation": {...}|None}`. Both may
    be None; that is the truthful state of a quiet, empty project."""
    top_attention: Optional[Dict[str, Any]] = None
    for item in attention or []:
        if isinstance(item, dict):
            top_attention = item
            break

    recommendation: Optional[Dict[str, Any]] = None
    if top_attention is not None:
        recommendation = _from_attention(top_attention)
    else:
        by_status: Dict[str, List[Dict[str, Any]]] = {}
        for task in tasks or []:
            if not isinstance(task, dict):
                continue
            by_status.setdefault(_s(task.get("status"), 40), []).append(task)
        for status, reason in _TASK_LADDER:
            candidates = by_status.get(status) or []
            if candidates:
                recommendation = _from_task(candidates[0], reason)
                break
        if recommendation is None:
            for goal in goals or []:
                if isinstance(goal, dict) and _s(goal.get("title")).strip():
                    recommendation = _from_goal(goal)
                    break

    return {"attention": top_attention, "recommendation": recommendation}


__all__ = [
    "RECO_INVESTIGATE_DEPLOY", "RECO_INVESTIGATE_PREVIEW_DEPLOY",
    "RECO_FIX_CHECKS", "RECO_FIX_BUILD", "RECO_REVIEW_PR",
    "RECO_PREPARE_MEETING", "RECO_REVIEW_CALENDAR", "RECO_REVIEW_SIGNAL",
    "RECO_CONTINUE_TASK", "RECO_START_TASK", "RECO_UNBLOCK_TASK",
    "RECO_CONTINUE_GOAL",
    "SOURCE_ATTENTION", "SOURCE_TASK", "SOURCE_GOAL",
    "ACTION_ASK", "ACTION_CREATE_TASK", "ACTION_OPEN_TASKS",
    "build_today",
]
