# coding: utf-8
"""Phase 4 (connected brain) — capability-aware Project Intelligence packet.

Every specialist should understand the PROJECT, not merely its direct upstream
task. This module builds a small, DETERMINISTIC, provenance-tagged, bounded
context packet tailored to the executing capability, assembled from the
EXISTING authorities — it does NOT create a second memory/context system:

  * context_projection.build_upstream_context  → DIRECT UPSTREAM RESULTS
  * decisions_store.active_decisions           → ACTIVE (non-superseded) DECISIONS
  * deliverables_store (this run)              → RELEVANT FACTS + ARTIFACT REFS
  * the goal passed in by the orchestrator     → PROJECT GOAL

CAPABILITY-AWARE
----------------
Different specialists need different slices (Research needs goal+constraints;
Web/App Build need product decisions + brand + relevant research + artifact
refs). `SECTIONS_BY_CAPABILITY` controls which sections a capability receives —
so a build never drowns in raw research prose, and research never sees build
artifacts it can't use.

BUDGETED + PROVENANCE + SUPERSESSION
------------------------------------
Hard caps on entries per section and total characters. Superseded decisions
are excluded (decisions_store only returns actives), so a later Web Build sees
"pricing = $19" not both $9 and $19. Every line is tagged with its source
(USER / RESEARCH / PRODUCT / BUILD / SYSTEM). No model call — pure metadata
projection.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── Bounds ───────────────────────────────────────────────────────────────
MAX_DECISIONS = 12
MAX_FACTS = 10
MAX_ARTIFACTS = 6
SECTION_CHAR_BUDGET = 1600
TOTAL_CHAR_BUDGET = 6000

# Which sections each capability receives. Order = render order.
_ALL = ("goal", "constraints", "decisions", "upstream", "facts", "artifacts")
SECTIONS_BY_CAPABILITY: Dict[str, tuple] = {
    "research":  ("goal", "constraints", "facts"),
    "product":   ("goal", "constraints", "decisions", "upstream", "facts"),
    "web_build": ("goal", "decisions", "upstream", "facts", "artifacts", "constraints"),
    "app_build": ("goal", "decisions", "upstream", "facts", "artifacts", "constraints"),
    "qa":        ("goal", "decisions", "artifacts"),
    "launch":    ("goal", "decisions", "artifacts"),
    "growth":    ("goal", "decisions", "artifacts"),
}


def _clip(text: str, budget: int) -> str:
    text = " ".join(str(text or "").split())
    return text[:budget]


def _section_goal(ctx: dict) -> Optional[str]:
    goal = _clip(ctx.get("user_goal") or "", 400)
    return f"[PROJECT GOAL]\n{goal}" if goal else None


def _section_constraints(ctx: dict) -> Optional[str]:
    # USER-sourced decisions are treated as constraints/preferences.
    lines = []
    for d in ctx.get("_decisions", []):
        if str(d.get("source")) == "USER":
            lines.append(f"[USER CONSTRAINT] {d.get('topic')}: {d.get('value')}")
    if not lines:
        return None
    return "\n".join(lines[:MAX_DECISIONS])[:SECTION_CHAR_BUDGET]


def _section_decisions(ctx: dict) -> Optional[str]:
    lines = []
    for d in ctx.get("_decisions", [])[:MAX_DECISIONS]:
        src = str(d.get("source") or "SYSTEM")
        if src == "USER":
            continue  # rendered under constraints
        lines.append(f"[DECISION · {src}] {d.get('topic')}: {d.get('value')}")
    if not lines:
        return None
    header = ("ACTIVE PROJECT DECISIONS — current authoritative choices "
              "(superseded ones are excluded; treat these as binding).")
    return (header + "\n" + "\n".join(lines))[:SECTION_CHAR_BUDGET]


def _section_upstream(ctx: dict) -> Optional[str]:
    block = ctx.get("_upstream") or ""
    return block[:SECTION_CHAR_BUDGET] if block else None


def _section_facts(ctx: dict) -> Optional[str]:
    lines = []
    for f in ctx.get("_facts", [])[:MAX_FACTS]:
        lines.append(f"[FACT · {f.get('source', 'SYSTEM')}] {f.get('text')}")
    if not lines:
        return None
    return ("RELEVANT PROJECT FACTS\n" + "\n".join(lines))[:SECTION_CHAR_BUDGET]


def _section_artifacts(ctx: dict) -> Optional[str]:
    lines = []
    for a in ctx.get("_artifacts", [])[:MAX_ARTIFACTS]:
        lines.append(
            f"[ARTIFACT · {a.get('build_type')}] status={a.get('build_status')} "
            f"ref={a.get('artifact_ref')} (deliverable={a.get('deliverable_id')})")
    if not lines:
        return None
    return ("PROJECT ARTIFACTS — references only, not source.\n"
            + "\n".join(lines))[:SECTION_CHAR_BUDGET]


_SECTION_FN = {
    "goal": _section_goal,
    "constraints": _section_constraints,
    "decisions": _section_decisions,
    "upstream": _section_upstream,
    "facts": _section_facts,
    "artifacts": _section_artifacts,
}


def _gather_facts(deliverables: List[dict]) -> List[dict]:
    """Deterministically extract structured facts from completed deliverables'
    content (`facts: [str|{text}]`). Provenance = the node's kind/agent."""
    out: List[dict] = []
    for d in deliverables or []:
        if str(d.get("status")) != "completed":
            continue
        content = d.get("content") or {}
        if not isinstance(content, dict):
            continue
        raw = content.get("facts")
        if not isinstance(raw, list):
            continue
        src = str(content.get("source") or (d.get("agent_id") or "SYSTEM")).upper()
        for item in raw:
            text = item.get("text") if isinstance(item, dict) else item
            text = _clip(text or "", 240)
            if text:
                out.append({"text": text, "source": src,
                            "deliverable_id": d.get("id")})
    return out


def _gather_artifacts(deliverables: List[dict]) -> List[dict]:
    out: List[dict] = []
    for d in deliverables or []:
        if d.get("kind") not in ("web_build", "app_build"):
            continue
        content = d.get("content") or {}
        if not isinstance(content, dict):
            continue
        if content.get("build_status") in ("completed", "handoff") and content.get("artifact_ref"):
            out.append({
                "build_type": content.get("build_type"),
                "build_status": content.get("build_status"),
                "artifact_ref": content.get("artifact_ref"),
                "deliverable_id": d.get("id"),
            })
    return out


def build_intelligence_packet(
    *,
    capability: str,
    run_id: str,
    project_id: Optional[str],
    depends_on: Optional[List[str]] = None,
    user_goal: str = "",
    deliverables: Optional[List[dict]] = None,
    decisions: Optional[List[dict]] = None,
    upstream_block: Optional[str] = None,
) -> str:
    """Return a bounded, capability-aware project-intelligence context block,
    or "" when there is nothing to project. Never raises. Injectable inputs
    (deliverables/decisions/upstream_block) support deterministic tests; by
    default they are read from the stores scoped to `run_id`/`project_id`
    (so cross-project/user leakage is structurally impossible)."""
    cap = (capability or "").strip().lower()
    sections = SECTIONS_BY_CAPABILITY.get(cap, _ALL)

    try:
        if deliverables is None:
            from backend.services.orchestrator import deliverables_store as dstore
            deliverables = dstore.list_for_run(str(run_id or ""))
        if decisions is None and project_id:
            from backend.services.orchestrator import decisions_store as dec
            decisions = dec.active_decisions(str(project_id))
        if upstream_block is None:
            from backend.services.orchestrator.context_projection import (
                build_upstream_context,
            )
            upstream_block = build_upstream_context(
                str(run_id or ""), depends_on or [])
    except Exception as exc:  # pragma: no cover — never block a run
        logger.debug("project_intelligence load failed: %s", exc)
        deliverables = deliverables or []
        decisions = decisions or []
        upstream_block = upstream_block or ""

    ctx = {
        "user_goal": user_goal,
        "_decisions": decisions or [],
        "_upstream": upstream_block or "",
        "_facts": _gather_facts(deliverables or []),
        "_artifacts": _gather_artifacts(deliverables or []),
    }

    blocks: List[str] = []
    used = 0
    for name in sections:
        fn = _SECTION_FN.get(name)
        if fn is None:
            continue
        block = fn(ctx)
        if not block:
            continue
        if used + len(block) > TOTAL_CHAR_BUDGET:
            break
        blocks.append(block)
        used += len(block)

    if not blocks:
        return ""
    header = (
        f"PROJECT INTELLIGENCE for the {cap or 'task'} capability — the "
        f"relevant accumulated project knowledge. Build on it as established "
        f"truth; it is a bounded projection, not the full history."
    )
    return header + "\n\n" + "\n\n".join(blocks)


def packet_size(packet: str) -> int:
    return len(packet or "")


__all__ = [
    "SECTIONS_BY_CAPABILITY", "build_intelligence_packet", "packet_size",
    "MAX_DECISIONS", "MAX_FACTS", "MAX_ARTIFACTS", "TOTAL_CHAR_BUDGET",
]
