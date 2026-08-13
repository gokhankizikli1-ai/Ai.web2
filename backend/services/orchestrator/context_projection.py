# coding: utf-8
"""Phase 2 — task-scoped upstream context projection.

THE PROBLEM THIS SOLVES
-----------------------
Before this module, a workflow dependency meant only *ordering*: a
downstream `agent.run` step waited for its upstream steps to complete, but
executed with a payload frozen at run-creation time — it never saw what its
dependencies produced. A "Define the product" task that depends on a
"Research the market" task ran with none of the research findings. (The
in-memory `_task_results` scratch bus on the supervisor-delegation path is a
different code path and is write-only in practice.)

WHAT THIS DOES
--------------
Given a run id and the *direct* dependency node keys of the task about to
execute, build a compact, deterministic, provenance-tagged context block
from the already-persisted `deliverables` table. No new memory store, no
extra model call — it reads the authoritative deliverables the upstream
agents already wrote.

DESIGN CONSTRAINTS (from the Phase 2 spec)
------------------------------------------
  * BOUNDED. Cap the number of dependencies projected, the characters per
    dependency, and the total block size. A huge HTML/code artifact is
    referenced (by kind + deliverable id) and excerpted, never inlined
    whole — that would bloat context and cost.
  * SCOPED. Only deliverables of THIS run (`list_for_run(run_id)`) are
    considered, and only those whose `node_id` is a declared direct
    dependency. Because a run belongs to exactly one project, scoping to
    run_id makes cross-project (and cross-user) leakage structurally
    impossible.
  * TRUTHFUL. Only `completed` deliverables with real content contribute. A
    `failed` / `skipped` / `pending` dependency yields nothing — never a
    fabricated upstream result.
  * PROVENANCE. Each entry is labelled UPSTREAM RESULT with its source node,
    kind, and — when the body was truncated — an artifact reference so the
    receiving agent can tell a real upstream fact from its own assumptions.

This is deterministic metadata projection; it deliberately does NOT call a
model to "select" context (the spec forbids an extra LLM call when
deterministic metadata suffices).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Iterable, List, Optional

logger = logging.getLogger(__name__)

# Bounds. Conservative by design — this block rides on every downstream
# prompt, so it must stay small relative to the task instructions.
MAX_DEPENDENCIES = 4          # project at most this many upstream nodes
MAX_CHARS_PER_DEP = 1200      # per-dependency body budget
TOTAL_CHAR_BUDGET = 4000      # hard cap on the whole injected block

# Deliverable kinds whose content is large source/markup we should
# reference + excerpt rather than inline in full.
_LARGE_ARTIFACT_HINTS = (
    "html", "app_prototype_html", "landing_page_html", "react_component",
    "project_file", "file_tree", "code",
)

_COMPLETED = "completed"


def _summarize_content(content: Any, kind: str, deliverable_id: str,
                       *, char_budget: int) -> str:
    """Extract a bounded, human-meaningful summary from a deliverable's
    opaque content dict. Prefers a text body; for large artifacts emits a
    reference + short excerpt instead of the whole blob."""
    if not isinstance(content, dict):
        text = str(content or "").strip()
        return text[:char_budget]

    # The agent.run handler stores {"text", "agent_id", "node_id",
    # "artifact"}. `text` is the model's prose; for page/code kinds it can
    # be the entire source, so we treat those as "large" and reference them.
    text = str(content.get("text") or "").strip()
    kind_l = (kind or "").lower()
    is_large = any(h in kind_l for h in _LARGE_ARTIFACT_HINTS) or len(text) > char_budget

    if not text:
        # No prose — surface structured fields if present (bounded).
        keys = [k for k in content.keys() if k not in ("text", "artifact")]
        if keys:
            fields = ", ".join(str(k) for k in keys[:12])
            return f"[artifact {kind or 'artifact'} ref={deliverable_id}; fields: {fields}]"
        return f"[artifact {kind or 'artifact'} ref={deliverable_id}]"

    if is_large:
        excerpt = " ".join(text.split())[: max(0, char_budget - 80)]
        return (
            f"[{kind or 'artifact'} artifact — referenced, not inlined; "
            f"ref={deliverable_id}] excerpt: {excerpt}"
        )

    return text[:char_budget]


def build_upstream_context(
    run_id: str,
    depends_on_node_ids: Optional[Iterable[str]],
    *,
    max_dependencies: int = MAX_DEPENDENCIES,
    char_budget_per_dep: int = MAX_CHARS_PER_DEP,
    total_char_budget: int = TOTAL_CHAR_BUDGET,
    deliverables: Optional[List[dict]] = None,
) -> str:
    """Return a compact upstream-context block for a task, or "" when there
    is nothing to project.

    `depends_on_node_ids` are the *node keys* (e.g. "research") of the
    task's DIRECT dependencies. `deliverables` may be injected for testing;
    by default it is read from the deliverables store for `run_id`.

    Never raises — a projection failure degrades to no context (the task
    still runs with its own instructions), never to a broken run.
    """
    deps = [str(d) for d in (depends_on_node_ids or []) if str(d).strip()]
    if not deps or not run_id:
        return ""

    try:
        if deliverables is None:
            from backend.services.orchestrator import deliverables_store as dstore
            deliverables = dstore.list_for_run(str(run_id))
    except Exception as exc:  # pragma: no cover — defensive
        logger.debug("context_projection: deliverables load failed: %s", exc)
        return ""

    # Index completed deliverables by node id. Only real upstream output
    # contributes — a failed/skipped/pending dep is silently absent.
    by_node: Dict[str, dict] = {}
    for d in deliverables or []:
        if not isinstance(d, dict):
            continue
        if str(d.get("status")) != _COMPLETED:
            continue
        node = str(d.get("node_id") or "")
        if node and node not in by_node:
            by_node[node] = d

    # Preserve the caller's declared dependency order; cap the count.
    ordered = [n for n in deps if n in by_node][:max_dependencies]
    if not ordered:
        return ""

    blocks: List[str] = []
    used = 0
    header = (
        "UPSTREAM RESULTS — outputs produced by this task's direct "
        "dependencies. Treat these as established facts to build on, not "
        "as your own assumptions."
    )
    used += len(header)

    for node in ordered:
        d = by_node[node]
        title = str(d.get("title") or node)
        kind = str(d.get("kind") or "artifact")
        did = str(d.get("id") or "")
        remaining = total_char_budget - used
        if remaining <= 120:
            break
        body = _summarize_content(
            d.get("content"), kind, did,
            char_budget=min(char_budget_per_dep, remaining - 100),
        )
        entry = (
            f"[UPSTREAM RESULT] node={node} · kind={kind} · title={title}\n"
            f"{body}"
        )
        blocks.append(entry)
        used += len(entry)

    if not blocks:
        return ""

    return header + "\n\n" + "\n\n".join(blocks)


__all__ = [
    "build_upstream_context",
    "MAX_DEPENDENCIES",
    "MAX_CHARS_PER_DEP",
    "TOTAL_CHAR_BUDGET",
]
