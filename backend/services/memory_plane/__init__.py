# coding: utf-8
"""
Phase 6 — Memory Plane.

Persistent, queryable, project- and agent-scoped memory for the
KorvixAI AI Operating System. The roadmap entry is in
PROJECT_ROADMAP.md > Phase 6.

Public API:
    from backend.services.memory_plane import (
        client,                # MemoryPlaneClient singleton
        MemoryRecord,
        MemoryQuery,
        is_enabled,
    )

Internal modules — DO NOT import from these directly. Go through
`client` so future swaps (Postgres + pgvector in Phase 14) don't
break callsites.

    types.py        dataclasses + kind / importance / source taxonomy
    store.py        SQLite adapter (memory_plane.db by default)
    retriever.py    semantic-ready search abstraction
    manager.py      high-level orchestration (dedup, TTL, importance)
    extractor.py    heuristic candidate extraction + secret redaction
    client.py       MemoryPlaneClient — the stable public surface
    hooks.py        chat / agent integration hooks (no-op by default)

Feature flag:
    ENABLE_MEMORY_PLANE=true   → routes + hooks become live
    default / unset / "false"  → all client methods are no-ops; routes 503

Rollback:
    1. ENABLE_MEMORY_PLANE=false  (instant; no restart)
    2. (optional) rm memory_plane.db  (forgets everything; nothing else moves)

This package is a SIBLING of the existing `backend.services.memory`
(Phase M1, legacy-wrapping) and `backend.services.memory_intelligence`
(v1 in-process). Phase 6 does NOT touch either of those — they
continue serving their current callers unchanged.
"""
from backend.services.memory_plane.client import (
    MemoryPlaneClient,
    client,
    is_enabled,
    score_importance,
)
# Phase 6.x stabilization layer — cache + hydration pipeline + preferences.
from backend.services.memory_plane import cache as _cache  # noqa: F401
from backend.services.memory_plane.hydration import (
    HydratedSnapshot, hydrate_for_chat,
)
from backend.services.memory_plane.preferences import (
    top_preferences, top_style, top_project_context,
    format_preferences_block,
)
from backend.services.memory_plane.types import (
    MemoryRecord, MemoryQuery,
    MEMORY_KINDS, DEFAULT_KIND, normalize_kind,
    IMPORTANCE_DEFAULT, IMPORTANCE_HIGH, IMPORTANCE_LOW,
    IMPORTANCE_CRITICAL, IMPORTANCE_TRIVIAL, clamp_importance,
    SOURCE_MANUAL, SOURCE_AUTO, SOURCE_AGENT, SOURCE_IMPORT,
)
from backend.services.memory_plane.extractor import (
    ExtractionCandidate, contains_secret_content,
)


__all__ = [
    # Public client
    "MemoryPlaneClient", "client", "is_enabled", "score_importance",
    # Hydration pipeline + preferences (Phase 6.x stabilization)
    "HydratedSnapshot", "hydrate_for_chat",
    "top_preferences", "top_style", "top_project_context",
    "format_preferences_block",
    # Types
    "MemoryRecord", "MemoryQuery",
    "MEMORY_KINDS", "DEFAULT_KIND", "normalize_kind",
    "IMPORTANCE_DEFAULT", "IMPORTANCE_HIGH", "IMPORTANCE_LOW",
    "IMPORTANCE_CRITICAL", "IMPORTANCE_TRIVIAL", "clamp_importance",
    "SOURCE_MANUAL", "SOURCE_AUTO", "SOURCE_AGENT", "SOURCE_IMPORT",
    # Extraction
    "ExtractionCandidate", "contains_secret_content",
]
