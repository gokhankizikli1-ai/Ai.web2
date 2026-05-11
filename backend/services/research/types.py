# coding: utf-8
# Phase R1 — Research service typed payloads.
#
# These dataclasses are the contract every research caller speaks. Providers
# (Tavily today, Serper/Brave/Exa later) normalize their native responses into
# this shape so the agent / frontend never sees provider-specific fields.
from dataclasses import dataclass, field, asdict
from typing import Optional


# ── Citation ────────────────────────────────────────────────────────────────

# Heuristic source-type buckets, surfaced for trust-score weighting.
SOURCE_TYPES = (
    "news",        # established news sites
    "academic",    # .edu / arxiv / scholarly publishers
    "government",  # .gov / .gov.uk / official bodies
    "corporate",   # company-owned domains
    "forum",       # reddit / hacker news / stackexchange
    "blog",        # personal / corporate blogs
    "video",       # youtube / vimeo
    "social",      # twitter / x / linkedin posts
    "wiki",        # wikipedia / community wikis
    "unknown",     # fallback
)


@dataclass
class Citation:
    """One normalized search citation."""
    title:       str
    url:         str
    snippet:     str = ""
    date:        Optional[str] = None       # ISO-8601 if available
    source_type: str = "unknown"            # from SOURCE_TYPES
    trust_score: float = 0.5                # 0.0 – 1.0, provider+heuristic
    domain:      Optional[str] = None
    raw_score:   Optional[float] = None     # provider's native relevance score
    provider:    Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


# ── Search result ───────────────────────────────────────────────────────────

@dataclass
class SearchResult:
    """One end-to-end query result."""
    query:         str
    answer:        Optional[str] = None         # provider's synthesized answer (if any)
    citations:     list[Citation] = field(default_factory=list)
    provider:      str = ""
    cached:        bool = False
    elapsed_ms:    int = 0
    truncated:     bool = False
    error:         Optional[str] = None

    def to_dict(self) -> dict:
        d = asdict(self)
        d["citations"] = [c.to_dict() if isinstance(c, Citation) else c for c in self.citations]
        return d


__all__ = ["Citation", "SearchResult", "SOURCE_TYPES"]
