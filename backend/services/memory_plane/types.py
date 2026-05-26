# coding: utf-8
"""
Phase 6 — Memory Plane typed payloads.

These dataclasses are the contract every Memory Plane layer (store →
retriever → manager → API) speaks. Adding a new field is the ONLY
place the schema evolves; the store + API derive their shapes from
here.

Kept deliberately Pydantic-free so the data classes are cheap to
instantiate inside hot paths (retrieval injection on every agent
turn) and trivial to JSON-serialise via `to_dict()`.

Future-proofing notes:
  - `embedding` is typed as `Optional[list[float]]`. M1 SQLite stores
    it as JSON-encoded TEXT. When Postgres + pgvector lands, the same
    shape maps onto `vector(1536)` with zero callsite churn.
  - `metadata` is a free-form dict. Use it for agent-specific fields
    (e.g. {"sentiment": "positive", "topic": "trading"}) without
    bloating the table schema.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Optional


# ── Memory kinds ─────────────────────────────────────────────────────────────
#
# The five Phase 6 kinds called out in PROJECT_ROADMAP.md, plus a small
# tail of additional kinds we already need for downstream phases (panel
# scratchpads in Phase 9, etc.). New kinds may be added at any time —
# unknown kinds are coerced to "fact" via `normalize_kind` so old
# clients never crash on new data.
MEMORY_KINDS: tuple[str, ...] = (
    "fact",            # generic user-asserted statement
    "preference",      # explicit preference ("I prefer formal tone")
    "decision",        # a recorded decision ("we picked Vercel for FE")
    "task_outcome",    # outcome of an agent task ("scraped 42 SKUs")
    "relationship",    # social / collaboration fact ("Ali is the CFO")
    # Reserved for future phases. Stored fine today; just not produced
    # by the heuristic extractor yet.
    "summary",         # rolling thread summary (Phase 9 panel scratchpad)
    "thesis",          # trading / decision thesis
    "artifact_ref",    # pointer to a file / document
)

DEFAULT_KIND = "fact"


def normalize_kind(kind: Optional[str]) -> str:
    """Coerce unknown kinds to `fact` so callers can pass through user
    input without try/except. Lowercases + trims. Never raises."""
    if not kind:
        return DEFAULT_KIND
    k = str(kind).lower().strip()
    return k if k in MEMORY_KINDS else DEFAULT_KIND


# ── Importance ───────────────────────────────────────────────────────────────
#
# A single float in [0.0, 1.0]. Stored on every row so the retriever
# can rank/filter without a second lookup. Higher = more durable; the
# TTL evictor + summariser preferentially keep high-importance rows.
#
# We expose named tiers for callsites that want readable code:
#     manager.create(..., importance=IMPORTANCE_HIGH)
# but the column itself is a continuous float so future ML scoring
# slots in with no schema change.

IMPORTANCE_TRIVIAL  = 0.10
IMPORTANCE_LOW      = 0.30
IMPORTANCE_DEFAULT  = 0.50
IMPORTANCE_HIGH     = 0.75
IMPORTANCE_CRITICAL = 0.95


def clamp_importance(value: Optional[float]) -> float:
    """Clamp into [0.0, 1.0]. None / invalid → DEFAULT. Never raises."""
    if value is None:
        return IMPORTANCE_DEFAULT
    try:
        v = float(value)
    except (TypeError, ValueError):
        return IMPORTANCE_DEFAULT
    if v != v:           # NaN
        return IMPORTANCE_DEFAULT
    if v < 0.0:
        return 0.0
    if v > 1.0:
        return 1.0
    return v


# ── Sources ──────────────────────────────────────────────────────────────────
#
# Where a memory came from. Free-form string so agents can write
# `source="agent:trading-analyst"` without us shipping new code, but the
# common values are constants here for callsite ergonomics.

SOURCE_MANUAL = "manual"   # user typed it / API created directly
SOURCE_AUTO   = "auto"     # heuristic extractor
SOURCE_AGENT  = "agent"    # extracted by an agent run
SOURCE_IMPORT = "import"   # bulk-imported from a file or another system


# ── Memory record ────────────────────────────────────────────────────────────

@dataclass
class MemoryRecord:
    """A single Memory Plane row.

    `id`, `created_at`, `updated_at` are set by the store on first
    insert. `project_id` and `agent_id` are optional — NULL means the
    memory is scoped only to the user (i.e. "global to this user").
    `expires_at` is precomputed from `ttl_seconds` so the eviction
    query stays cheap (no row-wise arithmetic in WHERE).
    """
    user_id:      str
    content:      str
    kind:         str = DEFAULT_KIND
    project_id:   Optional[str] = None
    agent_id:     Optional[str] = None
    importance:   float = IMPORTANCE_DEFAULT
    ttl_seconds:  Optional[int] = None
    expires_at:   Optional[str] = None
    source:       str = SOURCE_MANUAL
    embedding:    Optional[list[float]] = None
    metadata:     dict = field(default_factory=dict)
    # Server-populated — leave None on insert, the store fills these in.
    id:           Optional[str] = None
    created_at:   Optional[str] = None
    updated_at:   Optional[str] = None
    deleted_at:   Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        """API-safe projection. Excludes soft-delete tombstones."""
        d = asdict(self)
        # `deleted_at` is internal-only; the API never returns deleted rows
        # in the first place so dropping the key keeps responses clean.
        d.pop("deleted_at", None)
        return d


# ── Search query DTO ─────────────────────────────────────────────────────────

@dataclass
class MemoryQuery:
    """Structured search request. The retriever consumes this; the API
    layer maps query-string params onto it. Keeping it a dataclass
    means the retriever signature stays a single positional arg even
    as we add filters in future phases (importance_floor, time window,
    semantic threshold, etc.)."""
    user_id:           str
    query:             Optional[str] = None       # free-text; None = list-only
    project_id:        Optional[str] = None
    agent_id:          Optional[str] = None
    kind:              Optional[str] = None
    importance_floor:  Optional[float] = None     # only return importance >= this
    include_expired:   bool = False
    limit:             int = 20
    offset:            int = 0


__all__ = [
    "MEMORY_KINDS", "DEFAULT_KIND", "normalize_kind",
    "IMPORTANCE_TRIVIAL", "IMPORTANCE_LOW", "IMPORTANCE_DEFAULT",
    "IMPORTANCE_HIGH", "IMPORTANCE_CRITICAL", "clamp_importance",
    "SOURCE_MANUAL", "SOURCE_AUTO", "SOURCE_AGENT", "SOURCE_IMPORT",
    "MemoryRecord", "MemoryQuery",
]
