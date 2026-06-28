# coding: utf-8
"""Phase A.1 — Typed Step dataclass + JSON parser + cycle detection.

Storage stays in the existing `workflows.steps_json TEXT` column; this
module evolves the CONTENT shape from plain `list[str]` to a typed
`list[dict]` without an `ALTER TABLE`. The parser auto-promotes legacy
rows so pre-PR data keeps working.

Step kinds:
  - `noop`       — completes immediately on dispatch (legacy promotion
                   target; useful for manual / placeholder steps)
  - `job`        — dispatches a row in the `jobs` queue via JobsClient
  - `agent_task` — dispatches a row in `agent_tasks` via AgentTasksClient

Step statuses:
  pending → dispatched → running → (completed | failed | skipped)

`skipped` is set on remaining-eligible steps when a prior step `failed`
and the workflow is transitioning to a terminal `failed` state.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field, asdict
from typing import Any, Iterable, Optional


logger = logging.getLogger(__name__)


# ── Step taxonomy ───────────────────────────────────────────────────────────

STEP_KINDS: frozenset[str] = frozenset({"noop", "job", "agent_task"})

STEP_STATUS_PENDING    = "pending"
STEP_STATUS_DISPATCHED = "dispatched"
STEP_STATUS_RUNNING    = "running"
STEP_STATUS_COMPLETED  = "completed"
STEP_STATUS_FAILED     = "failed"
STEP_STATUS_SKIPPED    = "skipped"

STEP_STATUSES: frozenset[str] = frozenset({
    STEP_STATUS_PENDING, STEP_STATUS_DISPATCHED, STEP_STATUS_RUNNING,
    STEP_STATUS_COMPLETED, STEP_STATUS_FAILED, STEP_STATUS_SKIPPED,
})

TERMINAL_STEP_STATUSES: frozenset[str] = frozenset({
    STEP_STATUS_COMPLETED, STEP_STATUS_FAILED, STEP_STATUS_SKIPPED,
})

IN_FLIGHT_STEP_STATUSES: frozenset[str] = frozenset({
    STEP_STATUS_DISPATCHED, STEP_STATUS_RUNNING,
})


# ── Bounds (env-overridable inside the runner; defaults here are
# conservative because the runner inherits them on construction). ──────────

MAX_STEPS_HARD_CAP             = 64
MAX_PARALLEL_PER_RUN_HARD_CAP  = 8


# ── Errors ──────────────────────────────────────────────────────────────────

class StepsParseError(ValueError):
    """Raised when steps_json cannot be promoted to a valid step list.

    Carries a stable `code` the route handler maps to the v2 envelope
    error code (`workflow_steps_invalid`).
    """
    code = "workflow_steps_invalid"


# ── Dataclass ───────────────────────────────────────────────────────────────

@dataclass
class Step:
    """One executable node in a workflow's DAG.

    Persistence: serialised inline in `workflows.steps_json` as part of
    a `list[dict]`. The order of entries in the list is preserved (it
    is the natural read order); dependencies are explicit by id so the
    runner does NOT rely on list position for execution order.

    `label` defaults to "" so tests and runner internals can construct
    Step objects with just an id. Production callers (`parse_steps`)
    always populate label from the persisted JSON.
    """
    id:             str
    label:          str  = ""
    kind:           str  = "noop"
    payload:        dict = field(default_factory=dict)
    dependencies:   list[str] = field(default_factory=list)
    status:         str  = STEP_STATUS_PENDING
    dispatched_id:  Optional[str] = None
    started_at:     Optional[str] = None
    finished_at:    Optional[str] = None
    result:         Optional[dict] = None
    error:          Optional[str]  = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @property
    def is_terminal(self) -> bool:
        return self.status in TERMINAL_STEP_STATUSES

    @property
    def is_in_flight(self) -> bool:
        return self.status in IN_FLIGHT_STEP_STATUSES


# ── Parsing ─────────────────────────────────────────────────────────────────

def _new_step_id() -> str:
    return uuid.uuid4().hex


def _promote_legacy_strings(labels: list[str]) -> list[Step]:
    """Promote a legacy `list[str]` steps payload to typed Steps.

    Each label becomes a `noop` step. Sequential dependency (each step
    depends on the previous one) so legacy workflows preserve their
    ordered execution model — the runner will complete them in series
    without dispatching any real work.

    This is the back-compat path that lets pre-PR workflows continue
    to start-and-finish cleanly without manual migration.
    """
    steps: list[Step] = []
    prev_id: Optional[str] = None
    for label in labels:
        sid = _new_step_id()
        deps = [prev_id] if prev_id else []
        steps.append(Step(
            id=sid,
            label=str(label) if label is not None else "",
            kind="noop",
            dependencies=deps,
        ))
        prev_id = sid
    return steps


def _validate_typed_step_dict(raw: Any, idx: int) -> Step:
    """Validate one already-typed step dict, returning a Step.

    Tolerant defaults (status defaults to `pending`, missing optional
    fields default to None / []) — but REJECTS fundamental shape
    errors (non-dict entry, missing id, unknown kind, non-string
    label/kind, dependencies that aren't a list of strings).
    """
    if not isinstance(raw, dict):
        raise StepsParseError(f"step #{idx} is not an object")
    sid = raw.get("id")
    if not isinstance(sid, str) or not sid:
        raise StepsParseError(f"step #{idx} missing string `id`")
    label = raw.get("label", "")
    if label is None:
        label = ""
    if not isinstance(label, str):
        raise StepsParseError(f"step #{idx} `label` must be string")
    kind = raw.get("kind", "noop") or "noop"
    if kind not in STEP_KINDS:
        raise StepsParseError(
            f"step #{idx} unknown kind {kind!r} "
            f"(allowed: {sorted(STEP_KINDS)})"
        )
    deps = raw.get("dependencies", []) or []
    if not isinstance(deps, list) or any(not isinstance(d, str) for d in deps):
        raise StepsParseError(
            f"step #{idx} `dependencies` must be list[str]"
        )
    status = raw.get("status", STEP_STATUS_PENDING) or STEP_STATUS_PENDING
    if status not in STEP_STATUSES:
        # Tolerate unknown statuses by clamping to pending — never
        # crash on slightly-divergent persisted data.
        status = STEP_STATUS_PENDING
    payload = raw.get("payload") or {}
    if not isinstance(payload, dict):
        raise StepsParseError(f"step #{idx} `payload` must be object")
    return Step(
        id=            sid,
        label=         label,
        kind=          kind,
        payload=       payload,
        dependencies=  list(deps),
        status=        status,
        dispatched_id= raw.get("dispatched_id"),
        started_at=    raw.get("started_at"),
        finished_at=   raw.get("finished_at"),
        result=        raw.get("result"),
        error=         raw.get("error"),
    )


def parse_steps(raw: Any) -> list[Step]:
    """Parse a `steps_json`-shaped value into a typed list of Steps.

    Accepts three input shapes:
      - `list[str]`  → legacy. Auto-promoted via `_promote_legacy_strings`.
      - `list[dict]` → typed. Validated per-entry.
      - `None` / empty list → empty list (no steps, runner completes
        the workflow immediately).

    Raises `StepsParseError` on malformed entries OR if a dependency
    references an unknown step id. Cycle detection is separate
    (`detect_cycle`) because callers sometimes want to parse without
    running the topo check (e.g. read-only inspection).
    """
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise StepsParseError("steps must be a list")
    if not raw:
        return []
    # Legacy: every entry is a string → promote.
    if all(isinstance(s, str) for s in raw):
        return _promote_legacy_strings(raw)
    # Typed path: each entry must be a dict.
    steps = [_validate_typed_step_dict(s, i) for i, s in enumerate(raw)]
    known_ids = {s.id for s in steps}
    if len(known_ids) != len(steps):
        raise StepsParseError("duplicate step id")
    for s in steps:
        for d in s.dependencies:
            if d not in known_ids:
                raise StepsParseError(
                    f"step {s.id} depends on unknown id {d!r}"
                )
            if d == s.id:
                raise StepsParseError(
                    f"step {s.id} cannot depend on itself"
                )
    return steps


def steps_to_json(steps: Iterable[Step]) -> list[dict[str, Any]]:
    """Serialise a list of Steps to the JSON-ready dict shape we
    persist in `workflows.steps_json`. Symmetric with `parse_steps`."""
    return [s.to_dict() for s in steps]


# ── Cycle detection (Kahn's topological sort) ──────────────────────────────

def detect_cycle(steps: list[Step]) -> Optional[list[str]]:
    """Run Kahn's algorithm. Returns `None` if the DAG is acyclic;
    returns a list of step ids involved in a cycle when one exists.

    Used at `start_run` time to reject malformed graphs with a
    deterministic error instead of letting the runner hang waiting
    for dependencies that will never resolve.
    """
    if not steps:
        return None
    in_degree: dict[str, int] = {s.id: 0 for s in steps}
    forward: dict[str, list[str]] = {s.id: [] for s in steps}
    for s in steps:
        for dep in s.dependencies:
            # parse_steps already validated dep exists in the set, but
            # be defensive: a missing dep here would skew counts.
            if dep in in_degree:
                in_degree[s.id] += 1
                forward[dep].append(s.id)
    ready = [sid for sid, deg in in_degree.items() if deg == 0]
    visited = 0
    while ready:
        sid = ready.pop()
        visited += 1
        for child in forward[sid]:
            in_degree[child] -= 1
            if in_degree[child] == 0:
                ready.append(child)
    if visited == len(steps):
        return None
    # Cycle present — report nodes whose in-degree never reached zero.
    return sorted(sid for sid, deg in in_degree.items() if deg > 0)


def validate_for_run(
    steps: list[Step],
    *,
    max_steps: int = MAX_STEPS_HARD_CAP,
) -> None:
    """Pre-run sanity. Raises `StepsParseError` (which the route maps
    to a 400 `workflow_steps_invalid`) when the graph is too large
    or contains a cycle. Caller is expected to have already run
    `parse_steps` so per-entry shape is valid by this point.
    """
    if len(steps) > max_steps:
        raise StepsParseError(
            f"workflow has {len(steps)} steps; maximum is {max_steps}"
        )
    cyc = detect_cycle(steps)
    if cyc is not None:
        raise StepsParseError(
            f"workflow steps contain a dependency cycle involving: "
            f"{', '.join(cyc)}"
        )


# ── Eligibility resolver ────────────────────────────────────────────────────

def eligible_step_ids(steps: list[Step]) -> list[str]:
    """Return the ids of steps that are PENDING and whose dependencies
    are ALL completed. Returns [] when nothing is eligible right now
    (either because in-flight work hasn't finished, or because the
    workflow is in a terminal state).

    Pure function — no side effects. The runner calls this after every
    state change to find new work to dispatch.

    Steps whose dependencies include a FAILED ancestor are NOT
    eligible; they will be marked `skipped` by the runner when it
    transitions the workflow to its terminal `failed` state.
    """
    status_by_id = {s.id: s.status for s in steps}
    eligible: list[str] = []
    for s in steps:
        if s.status != STEP_STATUS_PENDING:
            continue
        deps_ok = True
        for d in s.dependencies:
            dep_status = status_by_id.get(d)
            if dep_status != STEP_STATUS_COMPLETED:
                deps_ok = False
                break
        if deps_ok:
            eligible.append(s.id)
    return eligible


__all__ = [
    "Step",
    "STEP_KINDS",
    "STEP_STATUS_PENDING", "STEP_STATUS_DISPATCHED", "STEP_STATUS_RUNNING",
    "STEP_STATUS_COMPLETED", "STEP_STATUS_FAILED", "STEP_STATUS_SKIPPED",
    "STEP_STATUSES", "TERMINAL_STEP_STATUSES", "IN_FLIGHT_STEP_STATUSES",
    "MAX_STEPS_HARD_CAP", "MAX_PARALLEL_PER_RUN_HARD_CAP",
    "StepsParseError",
    "parse_steps", "steps_to_json",
    "detect_cycle", "validate_for_run", "eligible_step_ids",
]
