# coding: utf-8
"""Phase 8 — Project Brain typed payloads."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Optional


@dataclass
class ProjectBrain:
    """Aggregated project state. Each field is bounded — at most a
    handful of items — so the full structure fits inside a single
    chat system-prompt without bloating tokens."""
    project_id:         str
    user_id:            str
    project_summary:    str = ""
    current_goals:      list[str]  = field(default_factory=list)
    important_context:  list[str]  = field(default_factory=list)
    linked_assets:      list[dict] = field(default_factory=list)   # [{id, filename, type, summary?}]
    recent_decisions:   list[str]  = field(default_factory=list)
    agent_notes:        list[str]  = field(default_factory=list)
    workflow_state:     list[dict] = field(default_factory=list)   # [{id, type, status, progress}]
    connector_signals:  list[dict] = field(default_factory=list)   # [{source, kind, summary, observed_at, importance, external_id}]
    products:           list[dict] = field(default_factory=list)   # [{build_type, title, status, artifact_ref, build_ref, run_id, node_id, updated_at}]
    linked_chats:       list[dict] = field(default_factory=list)   # [{thread_id, title, mode, updated_at, last_message}]
    # Correlated project state — the SYNTHESIS of the connector signals above,
    # produced by the `project_intelligence` projection. Bounded, derived, and
    # never persisted: these are operational readings ("the payment webhook
    # looks fixed"), not durable knowledge. See `project_intelligence` for the
    # operational-vs-durable boundary.
    intelligence:       list[dict] = field(default_factory=list)   # [{id, subject, state, confidence, sources, understanding, ...}]
    # The PROJECT-LEVEL reading of those subjects — what they add up to, what
    # is open/uncertain/blocking, and what Korvix does NOT know. Produced by
    # `project_intelligence.synthesize` from the SAME rows as `intelligence`,
    # in the same instant, so the two can never disagree. Bounded, derived,
    # never persisted; `{}` when there is nothing to read.
    understanding:      dict       = field(default_factory=dict)
    # The EXISTING deterministic Needs-Attention ranking
    # (`project_brain.attention`), surfaced so a project chat can answer "what
    # should I focus on?" from the authority that already owns that question
    # instead of the model inventing an order. Read-only passthrough — nothing
    # here re-ranks it.
    attention:          list[dict] = field(default_factory=list)   # [{id, severity, reason, source, kind, title, context, observed_at}]
    # WHY IT MATTERS NOW — `orchestrator.decision_context` applied to the same
    # subjects as `intelligence`: the single leading concern, its evidence-
    # backed reasons, what would make the reading wrong, and whether resolving
    # it is Korvix's to do or a person's. It is NOT a second ranking: it is the
    # identical tier ladder `action_prioritizer` uses on the Business Brain's
    # candidates, so chat and the Business Brain give one answer. Derived,
    # bounded, never persisted; `{}` when there is nothing pressing.
    focus:              dict       = field(default_factory=dict)
    # Typed BUSINESS KNOWLEDGE from the existing Memory Plane adapter
    # (`orchestrator.business_knowledge`) — durable, provenance-tagged,
    # TTL-aware facts and learnings. Read-only here; the brain has never been
    # a knowledge store and still is not one.
    business_knowledge: list[dict] = field(default_factory=list)   # [{domain, summary, source, observed_at, ...}]
    # EVIDENCE GROUNDING — what this project's evidence establishes, and, more
    # to the point, what it does NOT. Produced by
    # `project_intelligence.ground_claims` from the SAME observations as
    # `intelligence`/`understanding` plus the goals, decisions and durable
    # knowledge already read above, so it costs no query and can never
    # disagree with them. It ranks nothing and stores nothing: it exists so a
    # reader meets "no evidence here bears on whether anyone used this" as an
    # explicit statement rather than as silence to fill in.
    grounding:          dict       = field(default_factory=dict)   # {claims: [...], sources, single_source_project}
    counts:             dict       = field(default_factory=dict)   # health snapshot

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ProjectContextBlock:
    """The prompt-ready string + metadata. The chat-context builder
    folds `text` into the system prompt and surfaces `metadata` for
    debug overlays."""
    text:     str
    metadata: dict = field(default_factory=dict)


__all__ = ["ProjectBrain", "ProjectContextBlock"]
