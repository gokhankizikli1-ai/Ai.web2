# coding: utf-8
"""Phase 9 — Shared scratchpad: typed records.

The scratchpad is the missing primitive called out in `agent/delegate.py`
and `agent/run_context.py` comments as the place where agents working
on the same project share notes, findings, decisions, and references.
Until now the design existed; this module materialises it as a real
append-only, project-scoped, agent-attributed store.

Why a separate service (not project_memory)?
  - project_memory is curated, summarised, search-ranked context that
    feeds the LLM system prompt. Writing 30 raw "agent thinking…" notes
    there would dilute the relevance signal.
  - The scratchpad is the raw, append-only journal — verbose,
    timestamped, agent-attributed. The Coordinator + FE viewer read
    it directly; project_memory pulls only summary-worthy entries.

Schema is intentionally narrow — kind + content + attribution + a tiny
metadata blob. Higher-level structure (decisions vs findings vs plans)
is encoded in `kind`, not in column proliferation.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Optional


# ── Entry kinds ────────────────────────────────────────────────────────────
#
# Open set — callers can add new kinds without a migration; we just keep
# the canonical ones documented here. The FE viewer styles unknown kinds
# with the default "note" badge.
SCRATCHPAD_KINDS: tuple[str, ...] = (
    "note",        # generic free-form text (default)
    "finding",     # research result / fact discovered during the run
    "decision",    # explicit decision the agent made (and rationale)
    "plan",        # multi-step plan the agent intends to follow
    "question",    # blocker / clarification an agent is asking peers
    "answer",      # response to a question another agent posted
    "reference",   # URL / asset_id / external pointer worth keeping
    "output",      # generated artefact the agent is publishing for peers
    # Phase 9 part 2 — coordinator-level kinds.
    "analysis",    # an agent's interpretation / synthesis of inputs
    "task",        # a subtask emitted by the coordinator
    "result",      # a completed subtask outcome
    "proposal",    # a non-binding suggestion (matches messenger MSG_PROPOSE)
    "error",       # a failure the agent wants peers to see
)

KIND_NOTE      = "note"
KIND_FINDING   = "finding"
KIND_DECISION  = "decision"
KIND_PLAN      = "plan"
KIND_QUESTION  = "question"
KIND_ANSWER    = "answer"
KIND_REFERENCE = "reference"
KIND_OUTPUT    = "output"
KIND_ANALYSIS  = "analysis"
KIND_TASK      = "task"
KIND_RESULT    = "result"
KIND_PROPOSAL  = "proposal"
KIND_ERROR     = "error"


# ── Entry statuses ────────────────────────────────────────────────────────
#
# Coordinator can mark entries to weed out noise or flag contradictions.
# Default is "active"; the FE filters or grays out the rest.
SCRATCHPAD_STATUSES: tuple[str, ...] = (
    "active",       # default — entry is live and consulted
    "accepted",     # coordinator endorsed this finding / decision
    "rejected",     # coordinator dismissed this entry (kept for audit)
    "superseded",   # a newer entry replaces this one — see supersedes_id
)

STATUS_ACTIVE     = "active"
STATUS_ACCEPTED   = "accepted"
STATUS_REJECTED   = "rejected"
STATUS_SUPERSEDED = "superseded"


def normalize_status(s: Optional[str]) -> str:
    if not s:
        return STATUS_ACTIVE
    n = str(s).strip().lower()
    return n if n in SCRATCHPAD_STATUSES else STATUS_ACTIVE


def normalize_kind(k: Optional[str]) -> str:
    """Canonical lower-stripped kind, defaulting to "note" for anything
    we don't recognise. Open-set on purpose — callers shouldn't have to
    coordinate a schema migration to add a new label."""
    if not k:
        return KIND_NOTE
    s = str(k).strip().lower()
    return s or KIND_NOTE


@dataclass
class ScratchpadEntry:
    """One row in the per-project shared scratchpad.

    Attribution: `agent_id` identifies which agent (or "user" / "system")
    posted the entry. `correlation_id` (optional) lets the FE / a peer
    agent thread a question + answer pair, or link a chain of findings
    from one workflow run.

    Phase 9 part 2 — `panel_id` groups entries written during one
    coordinated task; `references` is an open-set list of related ids
    (asset_id, scratchpad_entry_id, message_id) the FE can resolve into
    cross-links; `supersedes_id` lets a later entry replace an earlier
    one (coordinator marks the earlier as "superseded"); `status`
    tracks coordinator review (active / accepted / rejected /
    superseded).
    """
    project_id:     str
    user_id:        str                       # owner of the project, for ownership checks
    agent_id:       str                       # writer attribution — "researcher" | "supervisor" | "user" | "system" | "<spec_id>"
    kind:           str = KIND_NOTE
    content:        str = ""
    workflow_id:    Optional[str] = None      # links to a workflows row when written during a run
    job_id:         Optional[str] = None      # links to the jobs row, when applicable
    parent_id:      Optional[str] = None      # threading — e.g. an answer's parent is the question's id
    correlation_id: Optional[str] = None      # free-form group tag (run_id / task_id / etc.)
    metadata:       dict = field(default_factory=dict)
    # Phase 9 part 2 additions.
    panel_id:       Optional[str] = None
    references:     list = field(default_factory=list)
    supersedes_id:  Optional[str] = None
    status:         str = STATUS_ACTIVE
    id:             Optional[str] = None
    created_at:     Optional[str] = None      # ISO-8601, set by store

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


__all__ = [
    "ScratchpadEntry",
    "SCRATCHPAD_KINDS",
    "normalize_kind",
    "KIND_NOTE", "KIND_FINDING", "KIND_DECISION", "KIND_PLAN",
    "KIND_QUESTION", "KIND_ANSWER", "KIND_REFERENCE", "KIND_OUTPUT",
    "KIND_ANALYSIS", "KIND_TASK", "KIND_RESULT", "KIND_PROPOSAL", "KIND_ERROR",
    "SCRATCHPAD_STATUSES", "normalize_status",
    "STATUS_ACTIVE", "STATUS_ACCEPTED", "STATUS_REJECTED", "STATUS_SUPERSEDED",
]
