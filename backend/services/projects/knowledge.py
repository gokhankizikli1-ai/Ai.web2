# coding: utf-8
"""Project Workspace — PROJECT KNOWLEDGE: durable project facts, visible.

THE PROBLEM THIS SOLVES
-----------------------
Chat history is not durable project knowledge. "Launch will initially be free"
said in a conversation three weeks ago is, for practical purposes, gone: it
survives only as a message in a stream nobody re-reads. Project Knowledge is
the surface where the few statements that must outlive the conversation live —
decisions, requirements, constraints and plain facts.

THIS MODULE IS A PROJECTION + A WRITE DISPATCHER, NOT A STORE
--------------------------------------------------------------
There is no `project_knowledge` table, and there must not be: Korvix already
has authorities for both halves of this concept, and a third one would make
"what did we decide?" answerable in two places that could disagree.

    DECISIONS       →  `orchestrator.decisions_store` (project_decisions)
                       The canonical durable decision authority. It is already
                       read by Project Intelligence, the Project Supervisor,
                       the Project Brain and the build context projection, so a
                       decision the USER records here reaches the same places a
                       decision a build derived does. It supersedes by `topic`,
                       which is exactly the "the newest answer wins" semantics a
                       decision needs.

    REQUIREMENTS,   →  `projects.store` (project_memory)
    CONSTRAINTS,       The projects module's own curated per-project knowledge
    FACTS, NOTES       table, consumed by `projects.context`. It already had
                       `note` / `fact`; `constraint` and `requirement` were
                       added to its kind vocabulary (purely additive — both
                       words previously normalized to `note`).

Neither is the Memory Plane, and the Memory Plane is deliberately untouched: it
is user-scoped and flag-gated (`ENABLE_MEMORY_PLANE`), so knowledge stored
there would disappear from a project when a flag flips. No second memory plane
is created here.

IDs
---
Because two authorities back one list, an item's id is namespaced —
`decision:<id>` or `memory:<id>`. That is the whole reason it exists: a delete
must dispatch to the authority that owns the row, deterministically, without
guessing. The underlying ids are Korvix's own row ids; no provider identifier,
credential or opaque external id is ever part of a knowledge item.

EXPLICIT USER ACTION ONLY
-------------------------
Nothing here runs automatically. No chat message is promoted to knowledge, no
observation becomes a fact, no model is asked what is worth remembering.
Knowledge appears because a person typed it and pressed a button, and the only
writes are that button and its removal counterpart.

COST: pure SQLite. ZERO model tokens, ZERO network.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── The knowledge vocabulary. Stable identifiers, never user-facing prose —
#    the frontend renders each through the shipped locale dictionaries.
KIND_DECISION = "decision"
KIND_REQUIREMENT = "requirement"
KIND_CONSTRAINT = "constraint"
KIND_FACT = "fact"
KIND_NOTE = "note"
#: Order is meaningful: it is the display order of the kind filter, strongest
#: (most binding on the project) first.
VALID_KINDS = (KIND_DECISION, KIND_REQUIREMENT, KIND_CONSTRAINT, KIND_FACT,
               KIND_NOTE)

#: The kinds the Overview's compact "Key knowledge" block shows. Notes and
#: loose facts are real knowledge but they are not what someone scanning a
#: project needs first, so they live in the Knowledge view only.
HEADLINE_KINDS = (KIND_DECISION, KIND_REQUIREMENT, KIND_CONSTRAINT)

MAX_TEXT = 600
MAX_LIMIT = 100

#: Topics for user-recorded decisions are derived from the decision's own text
#: and namespaced with this prefix, so a person writing "pricing is $19" can
#: never silently supersede the semantic `pricing` topic a build capability
#: recorded. Two identical user statements DO collapse onto one topic, which is
#: the correct behaviour: re-stating a decision restates it, it does not
#: duplicate it.
_USER_TOPIC_PREFIX = "user:"

_ID_DECISION = "decision"
_ID_MEMORY = "memory"


def normalize_kind(value: Any, *, default: str = "") -> str:
    k = str(value or "").strip().lower()
    return k if k in VALID_KINDS else default


def _s(value: Any, limit: int = MAX_TEXT) -> str:
    out = "" if value is None else str(value)
    return out[:limit]


def user_topic_for(text: str) -> str:
    """The deterministic supersession key for a USER-recorded decision.

    Lowercased, punctuation-stripped, whitespace-collapsed and prefixed. Pure —
    the same statement always yields the same topic, and no model is involved
    in deciding what a decision is 'about'."""
    slug = re.sub(r"[^\w\s]+", " ", str(text or "").lower(), flags=re.UNICODE)
    slug = re.sub(r"\s+", " ", slug).strip()
    return f"{_USER_TOPIC_PREFIX}{slug}"[:120]


def item_id(authority: str, row_id: str) -> str:
    return f"{authority}:{row_id}"


def _split_id(value: str) -> tuple[str, str]:
    raw = str(value or "")
    authority, _, row_id = raw.partition(":")
    return authority, row_id


def _owns(project_id: str, user_id: str) -> bool:
    """Does this user own this project, per the canonical `projects` record?

    The routes already gate on exactly this, so in production it is a second
    check of the same fact. It is here anyway because the two write paths are
    NOT symmetric: `project_decisions` carries a `user_id` column that scopes
    the retire, but `project_memory` is project-scoped only and has no owner
    column of its own. Without this, `remove_knowledge` would accept a
    `user_id` argument for a memory row and silently ignore it — a function
    that looks owner-scoped but is not is exactly how the next caller
    introduces a cross-account bug. Fail closed on any store error."""
    if not (project_id and user_id):
        return False
    try:
        from backend.services.projects import store as projects_store
        project = projects_store.get_project(str(project_id))
    except Exception as exc:   # pragma: no cover — defensive
        logger.debug("project_knowledge: projects store unavailable: %s", exc)
        return False
    return project is not None and str(project.owner_user_id) == str(user_id)


# ── read ─────────────────────────────────────────────────────────────────────

def _decision_items(project_id: str) -> List[Dict[str, Any]]:
    """ACTIVE decisions, projected onto the knowledge shape.

    Deliberately NOT filtered by user id. A project has exactly one owner and
    the caller has already been gated on that record, while decisions recorded
    during a run carry the identity that ran it — filtering here would silently
    hide the project's own build-derived decisions from its owner."""
    out: List[Dict[str, Any]] = []
    try:
        from backend.services.orchestrator import decisions_store as dec
        rows = dec.active_decisions(str(project_id), limit=MAX_LIMIT)
    except Exception as exc:
        logger.debug("project_knowledge: decisions unavailable: %s", exc)
        return out
    for row in rows:
        value = _s(row.get("value")).strip()
        if not value:
            continue
        topic = _s(row.get("topic"), 120).strip()
        source = _s(row.get("source"), 40).strip().upper()
        out.append({
            "id":         item_id(_ID_DECISION, _s(row.get("id"), 64)),
            "kind":       KIND_DECISION,
            "text":       value,
            # A build/research decision's topic is a real heading ("pricing").
            # A user decision's topic is derived from its own text, so showing
            # it would just echo the sentence back — omit it instead.
            "label":      "" if topic.startswith(_USER_TOPIC_PREFIX) else topic,
            "source":     source or "SYSTEM",
            "created_at": _s(row.get("created_at"), 64),
            # Only what the user recorded here may be removed here. Retiring a
            # build-derived decision would change what a later build is told.
            "removable":  source == "USER",
        })
    return out


def _memory_items(project_id: str) -> List[Dict[str, Any]]:
    """Curated project memory rows whose kind is part of the knowledge
    vocabulary. Agent notes, file summaries and system rows are deliberately
    excluded — they are context, not statements the user authored."""
    out: List[Dict[str, Any]] = []
    try:
        from backend.services.projects import store as projects_store
        rows = projects_store.list_memory(str(project_id), limit=MAX_LIMIT,
                                          newest_first=True)
    except Exception as exc:
        logger.debug("project_knowledge: project memory unavailable: %s", exc)
        return out
    for row in rows:
        kind = normalize_kind(getattr(row, "kind", ""))
        if not kind:
            continue
        text = _s(getattr(row, "content", "")).strip()
        if not text:
            continue
        source = _s(getattr(row, "source", ""), 40).strip().lower() or "user"
        out.append({
            "id":         item_id(_ID_MEMORY, _s(getattr(row, "id", ""), 64)),
            "kind":       kind,
            "text":       text,
            "label":      "",
            "source":     source,
            "created_at": _s(getattr(row, "created_at", ""), 64),
            "removable":  source == "user",
        })
    return out


def _sort_key(item: Dict[str, Any]):
    """created_at DESC, then id ASC — total and stable across both authorities,
    so the merged list has one deterministic order rather than an interleaving
    that depends on which store answered first."""
    return (str(item.get("created_at") or ""), str(item.get("id") or ""))


def list_knowledge(project_id: str, *, kinds: Optional[List[str]] = None,
                   limit: int = 50) -> List[Dict[str, Any]]:
    """The project's durable knowledge, newest first, bounded.

    Ownership is the CALLER's job: this is only ever reached after the project
    has been resolved through the canonical `projects` record."""
    if not project_id:
        return []
    wanted = None
    if kinds:
        wanted = {normalize_kind(k) for k in kinds}
        wanted.discard("")
        if not wanted:
            return []
    items = _decision_items(project_id) + _memory_items(project_id)
    if wanted is not None:
        items = [i for i in items if i["kind"] in wanted]
    items.sort(key=_sort_key, reverse=True)
    return items[:max(1, min(int(limit or 50), MAX_LIMIT))]


def count_items(items: List[Dict[str, Any]]) -> Dict[str, int]:
    """Counts per kind over an ALREADY-READ list. Pure.

    This exists so a caller that has just listed knowledge does not read both
    authorities a second time purely to count what it is already holding —
    which is exactly the hidden double-read the workspace projection and the
    Knowledge route would otherwise each perform. Every kind is present (0 when
    empty) so the frontend never has to guess a missing key."""
    counts = {k: 0 for k in VALID_KINDS}
    counts["total"] = 0
    for item in items or []:
        kind = str(item.get("kind") or "")
        if kind not in counts:
            continue
        counts[kind] += 1
        counts["total"] += 1
    return counts


def count_by_kind(project_id: str) -> Dict[str, int]:
    """Counts per kind for a project. Prefer `count_items` when you already
    hold the list — this convenience form performs the read itself."""
    return count_items(list_knowledge(project_id, limit=MAX_LIMIT))


# ── write (explicit user action only) ────────────────────────────────────────

def add_knowledge(*, project_id: str, user_id: str, kind: str,
                  text: str) -> Optional[Dict[str, Any]]:
    """Record ONE knowledge item, routed to the authority that owns its kind.
    Returns the stored item in the projected shape, or None on invalid input,
    a write failure, or a project this user does not own — the route renders
    all of those as the same refusal, so nothing about another account's
    project is revealed by which one it was."""
    kind = normalize_kind(kind)
    text = _s(text).strip()
    if not (project_id and user_id and kind and text):
        return None
    if not _owns(project_id, user_id):
        return None

    if kind == KIND_DECISION:
        try:
            from backend.services.orchestrator import decisions_store as dec
            did = dec.record_decision(
                project_id=str(project_id), user_id=str(user_id),
                topic=user_topic_for(text), value=text, source=dec.SOURCE_USER,
            )
        except Exception as exc:
            logger.warning("project_knowledge: decision write failed: %s", exc)
            return None
        if not did:
            return None
        for item in _decision_items(project_id):
            if item["id"] == item_id(_ID_DECISION, did):
                return item
        return None

    try:
        from backend.services.projects import store as projects_store
        rec = projects_store.add_memory(str(project_id), content=text,
                                        kind=kind, source="user")
    except Exception as exc:
        logger.warning("project_knowledge: memory write failed: %s", exc)
        return None
    if rec is None:
        return None
    return {
        "id":         item_id(_ID_MEMORY, _s(rec.id, 64)),
        "kind":       normalize_kind(rec.kind, default=KIND_NOTE),
        "text":       _s(rec.content).strip(),
        "label":      "",
        "source":     _s(rec.source, 40) or "user",
        "created_at": _s(rec.created_at, 64),
        "removable":  True,
    }


def remove_knowledge(*, project_id: str, user_id: str, knowledge_id: str) -> bool:
    """Remove ONE knowledge item the caller recorded. False when the id is
    unknown, belongs to another project, or names an item the user did not
    author — the route renders all three as the same 404, so a foreign item's
    existence is never revealed.

    A decision is RETIRED (status → superseded) rather than deleted, keeping its
    topic history intact; a memory row is deleted, scoped to the project."""
    authority, row_id = _split_id(knowledge_id)
    if not (project_id and user_id and row_id):
        return False
    if not _owns(project_id, user_id):
        return False

    if authority == _ID_DECISION:
        try:
            from backend.services.orchestrator import decisions_store as dec
            return dec.retire_decision(row_id, project_id=str(project_id),
                                       user_id=str(user_id),
                                       source=dec.SOURCE_USER)
        except Exception as exc:
            logger.warning("project_knowledge: decision retire failed: %s", exc)
            return False

    if authority == _ID_MEMORY:
        try:
            from backend.services.projects import store as projects_store
            row = projects_store.get_memory(row_id, project_id=str(project_id))
            if row is None:
                return False
            if str(getattr(row, "source", "")).lower() != "user":
                return False   # agent/system/tool authored — not the user's to remove
            if not normalize_kind(getattr(row, "kind", "")):
                return False   # not a knowledge row at all
            return projects_store.delete_memory(row_id, project_id=str(project_id))
        except Exception as exc:
            logger.warning("project_knowledge: memory delete failed: %s", exc)
            return False

    return False


__all__ = [
    "KIND_DECISION", "KIND_REQUIREMENT", "KIND_CONSTRAINT", "KIND_FACT",
    "KIND_NOTE", "VALID_KINDS", "HEADLINE_KINDS", "MAX_TEXT", "MAX_LIMIT",
    "normalize_kind", "user_topic_for", "item_id",
    "list_knowledge", "count_items", "count_by_kind", "add_knowledge",
    "remove_knowledge",
]
