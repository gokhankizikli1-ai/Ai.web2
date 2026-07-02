# coding: utf-8
# Startup Market Intelligence — typed payloads.
#
# These dataclasses are the contract between the collectors, the
# deterministic analyzer/scorer, the /v2/startup route, and the
# startup_complaints chat tool. Everything serializes with to_dict()
# so the HTTP layer and the prompt formatter never touch dataclass
# internals.
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional


# Canonical source ids — the ONLY values allowed in data_freshness,
# source_mix, and RawSignal.source. Order matters for display.
SOURCES = ("web", "hackernews", "gdelt", "reddit", "producthunt")

# Source status values surfaced in data_freshness. "skipped" means the
# caller didn't request the source OR it is intentionally not configured;
# "unavailable" means it was requested but not configured / failed.
STATUS_AVAILABLE = "available"
STATUS_UNAVAILABLE = "unavailable"
STATUS_SKIPPED = "skipped"


@dataclass
class RawSignal:
    """One normalized item fetched from a public source."""
    source: str                       # one of SOURCES
    title: str = ""
    text: str = ""                    # body / snippet / comment text
    url: str = ""
    published_at: Optional[str] = None  # ISO-8601 when the source provides it
    engagement: int = 0               # points + comments / votes when available
    # Evidence quality 0-1 — set by the collector from source kind and
    # metadata (forum/discussion > blog/SEO/news), refined by the analyzer
    # with complaint-language bonuses. Weights clustering, scoring, and
    # confidence so broad web content can't masquerade as direct pain.
    quality: float = 0.5

    def combined_text(self) -> str:
        return f"{self.title}\n{self.text}".strip()


@dataclass
class CollectorResult:
    """What each source collector returns. Never raises upward."""
    source: str
    status: str                       # available | unavailable | skipped
    signals: list[RawSignal] = field(default_factory=list)
    note: str = ""                    # honest reason for unavailable/skipped


@dataclass
class SampleQuote:
    text: str
    source: str
    url: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ComplaintCluster:
    id: str
    label: str
    pain_score: int = 0
    frequency: int = 0                # raw item count in the cluster
    severity: int = 0                 # 0-100
    urgency: int = 0                  # 0-100
    recency: int = 0                  # 0-100
    willingness_to_pay_signal: int = 0  # 0-100
    saturation_risk: int = 0          # 0-100
    source_mix: dict = field(default_factory=dict)   # source id → item count
    sample_quotes: list[SampleQuote] = field(default_factory=list)
    evidence_urls: list[str] = field(default_factory=list)
    # Quality telemetry (additive) — how trustworthy this cluster's
    # evidence is. evidence_quality 0-100 (avg item quality);
    # direct_complaints = items with first-person complaint phrasing.
    evidence_quality: int = 0
    direct_complaints: int = 0

    def to_dict(self) -> dict:
        d = asdict(self)
        d["sample_quotes"] = [q.to_dict() if isinstance(q, SampleQuote) else q
                              for q in self.sample_quotes]
        return d


@dataclass
class MarketSignals:
    competitors_mentioned: list[str] = field(default_factory=list)
    trending_keywords: list[str] = field(default_factory=list)
    underserved_segments: list[str] = field(default_factory=list)
    common_workarounds: list[str] = field(default_factory=list)
    # Competitor → complaint-cluster association, computed from the full
    # evidence text (which the frontend never sees in full). Each entry:
    #   { competitor, cluster_id, cluster_label, evidence_count }
    # Only populated when a competitor name actually appears inside a
    # cluster's evidence — never inferred.
    competitor_weaknesses: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Recommendations:
    startup_angles: list[str] = field(default_factory=list)
    mvp_wedge: list[str] = field(default_factory=list)
    first_100_customers: list[str] = field(default_factory=list)
    landing_page_angles: list[str] = field(default_factory=list)
    risks: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class ReportCitation:
    title: str
    url: str
    source: str
    published_at: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class MarketComplaintReport:
    """Full response payload for POST /v2/startup/market-complaints."""
    query: str
    generated_at: str
    timeframe_days: int
    data_freshness: dict = field(default_factory=dict)  # source id → status
    summary: dict = field(default_factory=dict)
    complaint_clusters: list[ComplaintCluster] = field(default_factory=list)
    market_signals: MarketSignals = field(default_factory=MarketSignals)
    recommendations: Recommendations = field(default_factory=Recommendations)
    citations: list[ReportCitation] = field(default_factory=list)
    # Honest operator-facing note when data is thin ("no source returned
    # usable data", "reddit not configured", ...). Empty when all good.
    message: str = ""
    cached: bool = False

    def to_dict(self) -> dict:
        return {
            "query": self.query,
            "generated_at": self.generated_at,
            "timeframe_days": self.timeframe_days,
            "data_freshness": dict(self.data_freshness),
            "summary": dict(self.summary),
            "complaint_clusters": [c.to_dict() for c in self.complaint_clusters],
            "market_signals": self.market_signals.to_dict(),
            "recommendations": self.recommendations.to_dict(),
            "citations": [c.to_dict() for c in self.citations],
            "message": self.message,
            "cached": self.cached,
        }


__all__ = [
    "SOURCES",
    "STATUS_AVAILABLE", "STATUS_UNAVAILABLE", "STATUS_SKIPPED",
    "RawSignal", "CollectorResult", "SampleQuote", "ComplaintCluster",
    "MarketSignals", "Recommendations", "ReportCitation",
    "MarketComplaintReport",
]
