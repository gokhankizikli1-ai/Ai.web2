# coding: utf-8
"""Business Brain — Phase 3: typed BUSINESS KNOWLEDGE on the Memory Plane.

WHY THIS IS AN ADAPTER, NOT A NEW STORE
---------------------------------------
The existing Memory Plane (`backend.services.memory_plane`) already is the
durable, project/user-scoped, importance-ranked, TTL-expiring, semantic-recall
memory authority. Business knowledge (a competitor's price, a customer pain, a
learning from an experiment) is just typed memory — so this module is a THIN
typed adapter over the Memory Plane MANAGER, not a second memory database.

  * One new Memory Plane kind — `business_knowledge` — carries every business
    domain; the DOMAIN (business/product/customer/competitor/experiment/
    metric/failure/learning) lives in `metadata["bb_domain"]`.
  * DECISIONS stay owned by `decisions_store`; ARTIFACTS stay owned by the
    deliverables/build authorities. This module never records those.
  * We go through `memory_plane.manager` (the business-rules layer: dedup,
    secret redaction, TTL) rather than the flag-gated `client`, because
    business knowledge is a first-class orchestrator concern, not part of the
    chat-memory rollout that `ENABLE_MEMORY_PLANE` gates. Storage is durable
    regardless of that flag; the flag only gates the chat hooks.

TEMPORAL SEMANTICS (mandatory)
------------------------------
A stale external fact must never read as timeless truth. We distinguish:
  * CURRENT FACT           — no expiry (internal, durable).
  * TIME-STAMPED OBSERVATION — `observed_at` recorded in metadata.
  * OLD / EXPIRED          — `ttl_seconds` → the Memory Plane precomputes
                             `expires_at` and excludes it from default reads.
External facts (competitor/*) SHOULD be given a TTL so staleness is enforced
deterministically by the Memory Plane's own eviction, not by us re-implementing
time math.

COST
----
Recording knowledge invokes ZERO model tokens by default — the Memory Plane
only auto-embeds when its (separately flagged, off-by-default) embedding
service is enabled. We never force an embedding here.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from backend.services.memory_plane.manager import manager as _mp_manager
from backend.services.memory_plane import store as _mp_store
from backend.services.memory_plane.types import (
    MemoryRecord, MemoryQuery,
    IMPORTANCE_DEFAULT, IMPORTANCE_HIGH, clamp_importance,
    SOURCE_AGENT,
)

logger = logging.getLogger(__name__)

# The single Memory Plane kind every business-knowledge row uses.
KIND = "business_knowledge"

# ── Domains (stored in metadata["bb_domain"]) ────────────────────────────
DOMAIN_BUSINESS = "business"
DOMAIN_PRODUCT = "product"
DOMAIN_CUSTOMER = "customer"
DOMAIN_COMPETITOR = "competitor"
DOMAIN_EXPERIMENT = "experiment"
DOMAIN_METRIC = "metric"
DOMAIN_FAILURE = "failure"
DOMAIN_LEARNING = "learning"
DOMAINS = (
    DOMAIN_BUSINESS, DOMAIN_PRODUCT, DOMAIN_CUSTOMER, DOMAIN_COMPETITOR,
    DOMAIN_EXPERIMENT, DOMAIN_METRIC, DOMAIN_FAILURE, DOMAIN_LEARNING,
)

# Domains that are EXTERNAL / time-sensitive by nature. If a caller records one
# of these without an explicit TTL, we apply a conservative default so the fact
# ages out rather than being treated as current forever.
_EXTERNAL_DOMAINS = frozenset({DOMAIN_COMPETITOR, DOMAIN_METRIC})
_DEFAULT_EXTERNAL_TTL_S = 90 * 24 * 3600   # 90 days

# Which knowledge domains each capability should receive (Project
# Intelligence projection). Kept conservative + bounded.
_DOMAINS_BY_CAPABILITY: Dict[str, tuple] = {
    "research": (DOMAIN_COMPETITOR, DOMAIN_CUSTOMER, DOMAIN_LEARNING, DOMAIN_BUSINESS),
    "product":  (DOMAIN_CUSTOMER, DOMAIN_BUSINESS, DOMAIN_LEARNING, DOMAIN_PRODUCT),
    "launch":   (DOMAIN_PRODUCT, DOMAIN_CUSTOMER, DOMAIN_LEARNING),
    "growth":   (DOMAIN_METRIC, DOMAIN_EXPERIMENT, DOMAIN_CUSTOMER, DOMAIN_LEARNING),
}


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def normalize_domain(domain: Optional[str]) -> str:
    d = (domain or "").strip().lower()
    return d if d in DOMAINS else DOMAIN_BUSINESS


def record_knowledge(
    *,
    user_id: str,
    project_id: str,
    domain: str,
    summary: str,
    source: str = "SYSTEM",
    source_ref: Optional[str] = None,
    confidence: Optional[float] = None,
    observed_at: Optional[str] = None,
    ttl_seconds: Optional[int] = None,
    importance: Optional[float] = None,
    external: Optional[bool] = None,
    extra_metadata: Optional[dict] = None,
    dedup: bool = True,
) -> Optional[str]:
    """Persist one typed business-knowledge entry to the Memory Plane.

    Returns the Memory Plane record id, or None when the input is rejected
    (empty summary / secret-looking content — the Memory Plane's own guard).

    `external` marks a fact that came from outside the system (competitor
    price, third-party metric); such facts get a default TTL when none is
    given so they age out. `observed_at` timestamps when the fact was true;
    it defaults to now. Zero model tokens (no forced embedding)."""
    if not (user_id and project_id and (summary or "").strip()):
        return None
    dom = normalize_domain(domain)
    is_external = bool(external) if external is not None else (dom in _EXTERNAL_DOMAINS)
    if ttl_seconds is None and is_external:
        ttl_seconds = _DEFAULT_EXTERNAL_TTL_S

    meta: Dict[str, Any] = {
        "bb_domain": dom,
        "bb_source": str(source or "SYSTEM").upper()[:40],
        "observed_at": observed_at or _now(),
        "external": is_external,
    }
    if source_ref:
        meta["source_ref"] = str(source_ref)[:300]
    if confidence is not None:
        meta["confidence"] = clamp_importance(confidence)
    if isinstance(extra_metadata, dict):
        for k, v in list(extra_metadata.items())[:20]:
            if k not in meta:
                meta[k] = v

    imp = clamp_importance(importance) if importance is not None else (
        IMPORTANCE_HIGH if dom == DOMAIN_LEARNING else IMPORTANCE_DEFAULT)

    rec = _mp_manager.create(
        user_id=str(user_id),
        content=str(summary).strip(),
        kind=KIND,
        project_id=str(project_id),
        importance=imp,
        ttl_seconds=ttl_seconds,
        source=SOURCE_AGENT,
        metadata=meta,
        embedding=None,        # never force an embed — zero model cost
        dedup=dedup,
    )
    return rec.id if rec is not None else None


def record_learning(
    *,
    user_id: str,
    project_id: str,
    summary: str,
    source: str = "EXPERIMENT",
    source_ref: Optional[str] = None,
    confidence: Optional[float] = None,
    extra_metadata: Optional[dict] = None,
) -> Optional[str]:
    """Convenience: persist a durable LEARNING (Phase 6 feeds this). Learnings
    are internal, durable (no TTL) and default to HIGH importance."""
    return record_knowledge(
        user_id=user_id, project_id=project_id, domain=DOMAIN_LEARNING,
        summary=summary, source=source, source_ref=source_ref,
        confidence=confidence, external=False, extra_metadata=extra_metadata,
    )


def _to_public(rec: MemoryRecord) -> dict:
    meta = rec.metadata or {}
    return {
        "id": rec.id,
        "domain": str(meta.get("bb_domain") or DOMAIN_BUSINESS),
        "summary": rec.content,
        "source": str(meta.get("bb_source") or "SYSTEM"),
        "source_ref": meta.get("source_ref"),
        "observed_at": meta.get("observed_at") or rec.created_at,
        "external": bool(meta.get("external")),
        "confidence": meta.get("confidence"),
        "importance": rec.importance,
        "created_at": rec.created_at,
        "expires_at": rec.expires_at,
    }


def list_knowledge(
    *,
    user_id: str,
    project_id: str,
    domains: Optional[List[str]] = None,
    include_expired: bool = False,
    limit: int = 50,
) -> List[dict]:
    """Return business-knowledge entries for a (user, project), newest first,
    optionally filtered to a set of domains. Expired external facts are
    excluded by default (Memory Plane enforces expiry) so stale competitor
    facts don't resurface as current. Cross-user/project isolation is
    structural — the Memory Plane scopes every read by user_id + project_id."""
    if not (user_id and project_id):
        return []
    want = {normalize_domain(d) for d in domains} if domains else None
    try:
        rows = _mp_store.list_for_user(
            str(user_id), project_id=str(project_id), kind=KIND,
            include_expired=include_expired, limit=max(1, min(int(limit or 50), 200)),
        )
    except Exception as exc:  # pragma: no cover — never block a read
        logger.debug("business_knowledge.list failed: %s", exc)
        return []
    out: List[dict] = []
    for r in rows:
        pub = _to_public(r)
        if want is not None and pub["domain"] not in want:
            continue
        out.append(pub)
    return out


def knowledge_for_capability(
    *,
    user_id: str,
    project_id: str,
    capability: str,
    limit: int = 8,
) -> List[dict]:
    """Bounded, capability-relevant knowledge slice for Project Intelligence.
    Deterministic metadata filtering (by domain) BEFORE any semantic recall,
    per the cost rule. Returns [] for capabilities with no mapped domains."""
    cap = (capability or "").strip().lower()
    domains = _DOMAINS_BY_CAPABILITY.get(cap)
    if not domains:
        return []
    entries = list_knowledge(
        user_id=user_id, project_id=project_id, domains=list(domains),
        limit=max(limit * 3, 24))
    # Rank: importance desc, then recency (observed_at desc). Deterministic.
    entries.sort(
        key=lambda e: (float(e.get("importance") or 0.0),
                       str(e.get("observed_at") or "")),
        reverse=True)
    return entries[:max(1, int(limit or 8))]


def recall_knowledge(
    *,
    user_id: str,
    project_id: str,
    query: str,
    domains: Optional[List[str]] = None,
    limit: int = 8,
) -> List[dict]:
    """Text/semantic recall over business knowledge, scoped to (user,
    project) and kind. Deterministic metadata (domain) filter is applied
    after recall. Reuses the Memory Plane retriever — no new search engine."""
    if not (user_id and project_id and (query or "").strip()):
        return []
    want = {normalize_domain(d) for d in domains} if domains else None
    try:
        rows = _mp_store.search_text(MemoryQuery(
            user_id=str(user_id), query=str(query), project_id=str(project_id),
            kind=KIND, limit=max(1, min(int(limit or 8) * 3, 60))))
    except Exception as exc:  # pragma: no cover
        logger.debug("business_knowledge.recall failed: %s", exc)
        return []
    out: List[dict] = []
    for r in rows:
        pub = _to_public(r)
        if want is not None and pub["domain"] not in want:
            continue
        out.append(pub)
        if len(out) >= int(limit or 8):
            break
    return out


__all__ = [
    "KIND",
    "DOMAIN_BUSINESS", "DOMAIN_PRODUCT", "DOMAIN_CUSTOMER", "DOMAIN_COMPETITOR",
    "DOMAIN_EXPERIMENT", "DOMAIN_METRIC", "DOMAIN_FAILURE", "DOMAIN_LEARNING",
    "DOMAINS", "normalize_domain",
    "record_knowledge", "record_learning", "list_knowledge",
    "knowledge_for_capability", "recall_knowledge",
]
