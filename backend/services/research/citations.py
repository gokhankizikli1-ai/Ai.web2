# coding: utf-8
# Phase R1 — Citation normalization + trust scoring.
#
# Pure functions. No I/O. Every provider funnels its results through
# `normalize_citation()` so the agent and frontend see one stable shape.
#
# Trust score heuristic:
#   1. Provider's own relevance score (when present) contributes up to 50%.
#   2. Domain class adds a fixed base:
#        government / academic    +0.30
#        established news + wiki  +0.20
#        forums (qa-style)        +0.10
#        blogs / social / unknown +0.00
#   3. Recency: results dated within the last 30 days get +0.05.
#   4. Clamped to [0.0, 1.0].
#
# These weights are intentionally simple — refine later once we have real
# user feedback on which sources the LLM cites best.
import re
from urllib.parse import urlparse
from typing import Optional

from backend.services.research.types import Citation


# ── Domain → source_type heuristics ─────────────────────────────────────────
# Order matters; first match wins. Lists are short and curated — the goal is
# *correct buckets for the obvious cases*, not exhaustive coverage.

_GOV_TLDS = (".gov", ".gov.uk", ".gov.au", ".gov.ca", ".gc.ca")
_ACADEMIC_TLDS = (".edu", ".ac.uk", ".ac.jp")
_ACADEMIC_DOMAINS = {
    "arxiv.org", "ssrn.com", "nature.com", "science.org",
    "sciencedirect.com", "springer.com", "ieee.org", "acm.org",
    "pubmed.ncbi.nlm.nih.gov", "biorxiv.org",
}
_NEWS_DOMAINS = {
    "nytimes.com", "wsj.com", "ft.com", "bloomberg.com", "reuters.com",
    "apnews.com", "bbc.com", "bbc.co.uk", "theguardian.com", "economist.com",
    "cnbc.com", "techcrunch.com", "axios.com", "politico.com",
    "washingtonpost.com", "npr.org", "aljazeera.com",
    "haberturk.com", "hurriyet.com.tr", "milliyet.com.tr", "sabah.com.tr",
    "ntv.com.tr", "cnn.com", "foxnews.com",
}
_WIKI_DOMAINS = {"wikipedia.org", "wikimedia.org"}
_VIDEO_DOMAINS = {"youtube.com", "youtu.be", "vimeo.com", "dailymotion.com"}
_FORUM_DOMAINS = {
    "reddit.com", "news.ycombinator.com", "stackoverflow.com",
    "stackexchange.com", "quora.com", "discord.com",
}
_SOCIAL_DOMAINS = {
    "twitter.com", "x.com", "linkedin.com", "facebook.com",
    "instagram.com", "threads.net", "mastodon.social",
}
_BLOG_DOMAIN_SUFFIXES = (".medium.com", ".substack.com", ".blogspot.com", ".wordpress.com")
_BLOG_DOMAINS         = {"medium.com", "substack.com", "blogspot.com", "wordpress.com", "dev.to", "hashnode.dev"}


def detect_source_type(url: str) -> tuple[str, str]:
    """
    Return (source_type, domain) for a URL. Always returns; never raises.
    """
    if not url:
        return "unknown", ""
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
    except Exception:
        return "unknown", ""

    if not host:
        return "unknown", ""

    if any(host.endswith(t) for t in _GOV_TLDS):
        return "government", host
    if any(host.endswith(t) for t in _ACADEMIC_TLDS) or host in _ACADEMIC_DOMAINS:
        return "academic", host

    # Strip leading "www." for membership checks.
    bare = host[4:] if host.startswith("www.") else host

    if bare in _NEWS_DOMAINS or any(bare.endswith("." + d) for d in _NEWS_DOMAINS):
        return "news", host
    if bare in _WIKI_DOMAINS or any(bare.endswith("." + d) for d in _WIKI_DOMAINS):
        return "wiki", host
    if bare in _VIDEO_DOMAINS:
        return "video", host
    if bare in _FORUM_DOMAINS:
        return "forum", host
    if bare in _SOCIAL_DOMAINS:
        return "social", host
    if bare in _BLOG_DOMAINS or any(host.endswith(s) for s in _BLOG_DOMAIN_SUFFIXES):
        return "blog", host

    # Heuristic: corporate-looking single-level domains (e.g. company.com) when
    # nothing else matched. Could be blog or corporate — pick "corporate".
    if host.count(".") >= 1 and not _looks_like_personal(bare):
        return "corporate", host
    return "unknown", host


def _looks_like_personal(host: str) -> bool:
    """Tiny heuristic: hosts containing 'blog' or single-word .me/.io often personal."""
    return "blog" in host or host.endswith(".me") or host.endswith(".dev")


# ── Trust score ─────────────────────────────────────────────────────────────

_TYPE_TRUST_BASE = {
    "government": 0.30,
    "academic":   0.30,
    "news":       0.20,
    "wiki":       0.20,
    "forum":      0.10,
    "video":      0.05,
    "corporate":  0.05,
    "blog":       0.00,
    "social":     0.00,
    "unknown":    0.00,
}

# Tavily score is roughly 0..1; weight it at 50%
_PROVIDER_SCORE_WEIGHT = 0.50


def trust_score(
    source_type: str,
    provider_score: Optional[float] = None,
    date_iso: Optional[str] = None,
) -> float:
    """0.0 – 1.0 heuristic. Always returns; never raises."""
    base = 0.50  # neutral floor
    base += _TYPE_TRUST_BASE.get(source_type, 0.0)
    if isinstance(provider_score, (int, float)):
        # provider_score in [0,1] → up to +0.5
        base += max(0.0, min(1.0, float(provider_score))) * _PROVIDER_SCORE_WEIGHT - 0.25
    if date_iso and _is_recent(date_iso, days=30):
        base += 0.05
    return max(0.0, min(1.0, round(base, 3)))


_DATE_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")


def _is_recent(date_iso: str, *, days: int) -> bool:
    """True if the date matches YYYY-MM-DD and is within the last `days` days."""
    if not date_iso:
        return False
    m = _DATE_RE.match(str(date_iso))
    if not m:
        return False
    try:
        from datetime import date, timedelta
        y, mo, d = (int(x) for x in m.groups())
        when = date(y, mo, d)
        return (date.today() - when) <= timedelta(days=days)
    except Exception:
        return False


# ── Citation builder ────────────────────────────────────────────────────────

def normalize_citation(
    *,
    title:       str,
    url:         str,
    snippet:     str = "",
    date:        Optional[str] = None,
    raw_score:   Optional[float] = None,
    provider:    Optional[str] = None,
) -> Citation:
    """Build a fully-populated Citation from raw provider fields."""
    source_type, domain = detect_source_type(url)
    return Citation(
        title=(title or "").strip()[:240] or "(no title)",
        url=url,
        snippet=(snippet or "").strip()[:480],
        date=date,
        source_type=source_type,
        trust_score=trust_score(source_type, raw_score, date),
        domain=domain,
        raw_score=raw_score,
        provider=provider,
    )


def dedupe_citations(citations: list[Citation]) -> list[Citation]:
    """Drop duplicates by canonical URL, preserve order."""
    seen: set[str] = set()
    out: list[Citation] = []
    for c in citations:
        key = (c.url or "").strip().rstrip("/").lower()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(c)
    return out


__all__ = [
    "detect_source_type",
    "trust_score",
    "normalize_citation",
    "dedupe_citations",
]
