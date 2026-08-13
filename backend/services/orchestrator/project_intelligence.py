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
MAX_GOALS = 5
MAX_KNOWLEDGE = 8
SECTION_CHAR_BUDGET = 1600
TOTAL_CHAR_BUDGET = 6000

# Which sections each capability receives. Order = render order.
#   goals      → durable active-goal hierarchy (Business Brain Phase 1)
#   knowledge  → typed business knowledge / learnings (Business Brain Phase 3)
_ALL = ("goal", "goals", "constraints", "decisions", "upstream", "facts",
        "knowledge", "artifacts")
SECTIONS_BY_CAPABILITY: Dict[str, tuple] = {
    "research":  ("goal", "goals", "constraints", "knowledge", "facts"),
    "product":   ("goal", "goals", "constraints", "decisions", "upstream", "knowledge", "facts"),
    "web_build": ("goal", "goals", "decisions", "upstream", "facts", "artifacts", "constraints"),
    "app_build": ("goal", "goals", "decisions", "upstream", "facts", "artifacts", "constraints"),
    "qa":        ("goal", "goals", "decisions", "artifacts"),
    "launch":    ("goal", "goals", "decisions", "knowledge", "artifacts"),
    "growth":    ("goal", "goals", "decisions", "knowledge", "artifacts"),
}


def _clip(text: str, budget: int) -> str:
    text = " ".join(str(text or "").split())
    return text[:budget]


def _section_goal(ctx: dict) -> Optional[str]:
    goal = _clip(ctx.get("user_goal") or "", 400)
    return f"[PROJECT GOAL]\n{goal}" if goal else None


def _fmt_criterion(crit: dict) -> str:
    if not isinstance(crit, dict):
        return ""
    if crit.get("metric"):
        target = crit.get("target")
        op = crit.get("op") or ""
        unit = crit.get("unit") or ""
        return _clip(f"{crit.get('metric')} {op} {target} {unit}".strip(), 80)
    return _clip(str(crit.get("text") or ""), 80)


def _section_goals(ctx: dict) -> Optional[str]:
    """Durable ACTIVE goals (Business Brain Phase 1) — the "why" behind the
    work, with any structured success criteria. Bounded + provenance-free
    (goals are user/business objectives, not sourced facts)."""
    lines = []
    for g in ctx.get("_goals", [])[:MAX_GOALS]:
        crit = [c for c in (_fmt_criterion(c) for c in (g.get("success_criteria") or [])[:3]) if c]
        suffix = (" — success: " + "; ".join(crit)) if crit else ""
        lines.append(f"[GOAL] {_clip(g.get('title') or '', 160)}{suffix}")
    if not lines:
        return None
    header = ("ACTIVE GOALS — the outcomes this work serves. Prefer actions "
              "that advance these; explain how the work aligns.")
    return (header + "\n" + "\n".join(lines))[:SECTION_CHAR_BUDGET]


def _section_knowledge(ctx: dict) -> Optional[str]:
    """Typed business knowledge + learnings (Business Brain Phase 3), each
    with its domain, source and (when external/time-sensitive) an observed
    date so a stale competitor fact is never read as timeless truth."""
    lines = []
    for k in ctx.get("_knowledge", [])[:MAX_KNOWLEDGE]:
        domain = str(k.get("domain") or "knowledge").upper()
        src = str(k.get("source") or "SYSTEM").upper()
        when = k.get("observed_at") or ""
        when_txt = f" (observed {when[:10]})" if when else ""
        lines.append(f"[{domain} · {src}] {_clip(k.get('summary') or '', 220)}{when_txt}")
    if not lines:
        return None
    header = ("BUSINESS KNOWLEDGE & LEARNINGS — accumulated, provenance-tagged, "
              "time-aware. External facts may be stale; weigh by recency.")
    return (header + "\n" + "\n".join(lines))[:SECTION_CHAR_BUDGET]


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
    "goals": _section_goals,
    "constraints": _section_constraints,
    "decisions": _section_decisions,
    "upstream": _section_upstream,
    "facts": _section_facts,
    "knowledge": _section_knowledge,
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
    user_id: Optional[str] = None,
    deliverables: Optional[List[dict]] = None,
    decisions: Optional[List[dict]] = None,
    upstream_block: Optional[str] = None,
    goals: Optional[List[dict]] = None,
    knowledge: Optional[List[dict]] = None,
) -> str:
    """Return a bounded, capability-aware project-intelligence context block,
    or "" when there is nothing to project. Never raises. Injectable inputs
    (deliverables/decisions/upstream_block/goals/knowledge) support
    deterministic tests; by default they are read from the stores scoped to
    `run_id`/`project_id` (so cross-project/user leakage is structurally
    impossible)."""
    cap = (capability or "").strip().lower()
    sections = SECTIONS_BY_CAPABILITY.get(cap, _ALL)

    try:
        if deliverables is None:
            from backend.services.orchestrator import deliverables_store as dstore
            deliverables = dstore.list_for_run(str(run_id or ""))
        if decisions is None and project_id:
            from backend.services.orchestrator import decisions_store as dec
            decisions = dec.active_decisions(str(project_id))
        if goals is None and project_id:
            from backend.services.orchestrator import goals_store
            goals = goals_store.active_goals(str(project_id), limit=MAX_GOALS)
        if knowledge is None and project_id and user_id and "knowledge" in sections:
            # Only pay the Memory Plane read when this capability actually
            # renders a knowledge section (research/product/launch/growth) AND
            # we have the owning user_id (Memory Plane is user+project scoped,
            # so a missing user_id means we simply don't project knowledge —
            # never a cross-user read).
            from backend.services.orchestrator import business_knowledge as bk
            knowledge = bk.knowledge_for_capability(
                user_id=str(user_id), project_id=str(project_id),
                capability=cap, limit=MAX_KNOWLEDGE)
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
        "_goals": goals or [],
        "_knowledge": knowledge or [],
    }

    # The header + the "\n\n" separators are part of the FINAL serialized
    # packet, so they MUST count against TOTAL_CHAR_BUDGET — otherwise a run of
    # near-cap sections plus the header could push the assembled string over
    # the bound even though the raw block-sum is under it. We charge the header
    # up-front and each separator as its block is admitted, so the returned
    # string is <= TOTAL_CHAR_BUDGET BY CONSTRUCTION, dropping only the
    # lowest-priority overflow sections (order = priority) and never cutting a
    # section mid-line.
    header = (
        f"PROJECT INTELLIGENCE for the {cap or 'task'} capability — the "
        f"relevant accumulated project knowledge. Build on it as established "
        f"truth; it is a bounded projection, not the full history."
    )
    _SEP = "\n\n"
    blocks: List[str] = []
    used = len(header)                      # header is always prepended
    for name in sections:
        fn = _SECTION_FN.get(name)
        if fn is None:
            continue
        block = fn(ctx)
        if not block:
            continue
        cost = len(_SEP) + len(block)        # this block plus its joiner
        if used + cost > TOTAL_CHAR_BUDGET:
            break
        blocks.append(block)
        used += cost

    if not blocks:
        return ""
    packet = header + _SEP + _SEP.join(blocks)
    # Defensive guarantee (should never trigger given the accounting above):
    # never return more than the canonical bound.
    return packet[:TOTAL_CHAR_BUDGET]


def packet_size(packet: str) -> int:
    return len(packet or "")


__all__ = [
    "SECTIONS_BY_CAPABILITY", "build_intelligence_packet", "packet_size",
    "MAX_DECISIONS", "MAX_FACTS", "MAX_ARTIFACTS", "TOTAL_CHAR_BUDGET",
]
