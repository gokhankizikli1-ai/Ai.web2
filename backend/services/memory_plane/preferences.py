# coding: utf-8
"""
Phase 6.x — Global preference helpers.

A small layer that surfaces the user's *durable* memories
(preference / style / goal / project_context / agent_context) in a
prompt-ready form. The hydration pipeline uses these to guarantee
that preference recall works regardless of the user's specific
query — i.e. when retrieval-by-text-overlap returns nothing, the
fallback fetches preferences anyway.

Public API:
  top_preferences(user_id, project_id=None, limit=6) -> list[MemoryRecord]
  top_style(user_id, project_id=None, limit=2)       -> list[MemoryRecord]
  top_project_context(user_id, project_id, limit=4)  -> list[MemoryRecord]
  format_preferences_block(records) -> str           prompt-ready
"""
from __future__ import annotations

import logging
from typing import Iterable, Optional

from backend.services.memory_plane.types import MemoryRecord


logger = logging.getLogger(__name__)


# Kinds we treat as "durable identity / preference" memories — these
# get the highest ranking weight and always survive the fallback
# retrieval path (so they're recalled even if the user's query doesn't
# textually match them).
_DURABLE_KINDS: frozenset[str] = frozenset({
    "preference",        # explicit "I prefer X"
    "style",             # formatting / tone
    "goal",              # long-term objective
    "project_context",   # project-scoped facts
    "agent_context",     # agent-scoped facts
})


def _store_list(
    user_id: str,
    *,
    project_id: Optional[str] = None,
    kind: Optional[str] = None,
    limit: int = 50,
) -> list[MemoryRecord]:
    """Thin guard around the client's list_user. Never raises."""
    try:
        from backend.services.memory_plane import client as _mp_client
        return _mp_client.list_user(
            user_id, project_id=project_id, kind=kind, limit=limit,
        ) or []
    except Exception as e:
        logger.warning("preferences._store_list user=%s error: %s", user_id, e)
        return []


def top_preferences(
    user_id: str,
    *,
    project_id: Optional[str] = None,
    limit: int = 6,
) -> list[MemoryRecord]:
    """Return up to `limit` durable preference memories, ordered
    by importance DESC, created_at DESC (the store's default).
    Used as the fallback when text-overlap retrieval returns
    nothing — so "what do I prefer" type questions always have
    something to recall."""
    if not user_id:
        return []
    # Concatenate per-kind lists rather than scanning everything,
    # so we always get a mix even if one kind dominates the table.
    pref     = _store_list(user_id, project_id=project_id, kind="preference",      limit=limit)
    style    = _store_list(user_id, project_id=project_id, kind="style",           limit=max(2, limit // 3))
    goals    = _store_list(user_id, project_id=project_id, kind="goal",            limit=max(2, limit // 3))
    pctx     = _store_list(user_id, project_id=project_id, kind="project_context", limit=max(2, limit // 3))
    actx     = _store_list(user_id, project_id=project_id, kind="agent_context",   limit=max(1, limit // 4))

    # Merge + de-dup by id, preserve importance ordering by
    # interleaving in priority order: style > preference > goal
    # > project_context > agent_context. This implements the
    # spec's ranking ladder.
    out: list[MemoryRecord] = []
    seen: set[str] = set()
    for bucket in (style, pref, goals, pctx, actx):
        for m in bucket:
            rid = str(m.id) if m.id else None
            if rid and rid in seen:
                continue
            if rid:
                seen.add(rid)
            out.append(m)
            if len(out) >= limit:
                return out
    return out


def top_style(
    user_id: str,
    *,
    project_id: Optional[str] = None,
    limit: int = 2,
) -> list[MemoryRecord]:
    """Style-only fetch — used by short-context paths that want to
    inject just the tone/format guidance."""
    if not user_id:
        return []
    return _store_list(user_id, project_id=project_id, kind="style", limit=limit)


def top_project_context(
    user_id: str,
    *,
    project_id: str,
    limit: int = 4,
) -> list[MemoryRecord]:
    """Project-scoped context (typically project_context kind plus
    goal). Empty when user_id or project_id is missing."""
    if not user_id or not project_id:
        return []
    goals = _store_list(user_id, project_id=project_id, kind="goal",            limit=limit)
    pctx  = _store_list(user_id, project_id=project_id, kind="project_context", limit=limit)
    out: list[MemoryRecord] = []
    seen: set[str] = set()
    for bucket in (goals, pctx):
        for m in bucket:
            rid = str(m.id) if m.id else None
            if rid and rid in seen:
                continue
            if rid:
                seen.add(rid)
            out.append(m)
            if len(out) >= limit:
                return out
    return out


def is_durable_kind(kind: Optional[str]) -> bool:
    """Used by the hydration pipeline's ranking — durable kinds get
    a +0.10 importance boost during the merged sort."""
    return (kind or "").strip().lower() in _DURABLE_KINDS


def format_preferences_block(records: Iterable[MemoryRecord]) -> str:
    """Format a list of memories as a compact prompt-ready block.
    Skips empty content; bounds at ~1400 chars so it never blows
    up the prompt."""
    lines: list[str] = []
    char_budget = 1400
    for m in records:
        content = (m.content or "").strip()
        if not content:
            continue
        # Prefix by kind so the model sees the hierarchy.
        prefix = {
            "preference":      "Preference",
            "style":           "Style",
            "goal":            "Goal",
            "project_context": "Project",
            "agent_context":   "Agent",
            "fact":            "Fact",
            "decision":        "Decision",
        }.get(m.kind, "Memory")
        line = f"- [{prefix}] {content[:200]}"
        if char_budget - len(line) - 1 < 0:
            break
        lines.append(line)
        char_budget -= len(line) + 1
    return "\n".join(lines) if lines else ""


__all__ = [
    "top_preferences",
    "top_style",
    "top_project_context",
    "is_durable_kind",
    "format_preferences_block",
]
