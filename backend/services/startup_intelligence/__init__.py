# coding: utf-8
# Startup Market Intelligence — Market Complaint Radar engine.
#
# Pure library (no HTTP): backend/routes/v2_startup.py exposes it over
# HTTP, backend/services/tools/startup_complaints_tool.py exposes it to
# the startup_advisor chat mode.
#
# Pipeline (all deterministic — the LLM never generates "data" here):
#   1. collect_all()          — fan-out to configured public sources
#   2. extract_complaints()   — keyword-based complaint detection (EN+TR)
#   3. cluster_complaints()   — topic-term grouping into 3-8 themes
#   4. score_cluster()        — pain/severity/recency/WTP/saturation 0-100
#   5. extract_market_signals() + build_recommendations()
#
# Honesty rules baked in:
#   * unconfigured/failed sources are reported in data_freshness, never faked
#   * empty result → clean report with message, never invented clusters
#   * cached reports carry cached=true
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from backend.services.startup_intelligence import cache as intel_cache
from backend.services.startup_intelligence.analyzer import (
    build_cluster, cluster_complaints, extract_complaints,
    extract_market_signals,
)
from backend.services.startup_intelligence.collectors import collect_all
from backend.services.startup_intelligence.scoring import (
    confidence_level, opportunity_score, score_cluster,
)
from backend.services.startup_intelligence.types import (
    SOURCES, STATUS_AVAILABLE,
    MarketComplaintReport, MarketSignals, Recommendations, ReportCitation,
)

logger = logging.getLogger(__name__)

DEFAULT_SOURCES = ["web", "hackernews", "gdelt", "reddit", "producthunt"]


def _build_recommendations(
    query: str,
    clusters,
    signals: MarketSignals,
) -> Recommendations:
    """Deterministic founder-grade baseline recommendations. Every line
    references an observed cluster/signal — no invented market facts."""
    rec = Recommendations()
    if not clusters:
        return rec

    top = clusters[0]
    second = clusters[1] if len(clusters) > 1 else None

    rec.startup_angles.append(
        f'Attack the highest-pain theme "{top.label}" (pain {top.pain_score}/100, '
        f"{top.frequency} complaint signals) with a product whose core promise "
        f"is fixing exactly that."
    )
    if second:
        rec.startup_angles.append(
            f'Bundle the #2 theme "{second.label}" (pain {second.pain_score}/100) '
            f"as the expansion wedge once the first theme converts."
        )
    if signals.competitors_mentioned:
        rec.startup_angles.append(
            f"Position against {', '.join(signals.competitors_mentioned[:3])} — "
            f"users in the evidence are already naming them while complaining."
        )

    rec.mvp_wedge.append(
        f'Ship the smallest tool that removes "{top.label}" end-to-end for one '
        f"segment — nothing else in v1."
    )
    if signals.common_workarounds:
        rec.mvp_wedge.append(
            f"Replace the observed workarounds ({', '.join(signals.common_workarounds[:3])}) "
            f"with a one-click flow; workaround usage is proof of unmet demand."
        )
    if top.willingness_to_pay_signal >= 40:
        rec.mvp_wedge.append(
            "Charge from day one — pricing/budget language appears in the "
            "complaint evidence, so a paid pilot is testable immediately."
        )

    if signals.underserved_segments:
        rec.first_100_customers.append(
            f"Recruit from the segments named in the complaints: "
            f"{', '.join(signals.underserved_segments[:3])}."
        )
    rec.first_100_customers.append(
        "Reply directly in the evidence threads (see citations) with a "
        "concierge offer — the complainers ARE the waitlist."
    )
    if second:
        rec.first_100_customers.append(
            f'Run a 7-day validation: 20 outreach conversations anchored on '
            f'"{top.label}" vs "{second.label}" and keep whichever books more demos.'
        )

    rec.landing_page_angles.append(
        f'Hero headline mirrors the top complaint theme: the fix for "{top.label}".'
    )
    if signals.trending_keywords:
        rec.landing_page_angles.append(
            f"Use the market's own vocabulary in copy: "
            f"{', '.join(signals.trending_keywords[:5])}."
        )
    if top.willingness_to_pay_signal >= 40:
        rec.landing_page_angles.append(
            "Show pricing openly — cost complaints in the evidence mean price "
            "transparency is itself a differentiator."
        )

    if top.saturation_risk >= 50:
        rec.risks.append(
            f"Saturation risk {top.saturation_risk}/100 — several competitors are "
            f"named in the evidence; a thin feature-level wedge will get copied."
        )
    if top.recency < 40:
        rec.risks.append(
            "Much of the evidence is old within the selected window — re-run with "
            "a shorter timeframe before betting on this pain being current."
        )
    if top.frequency < 4:
        rec.risks.append(
            f"Top cluster has only {top.frequency} signals — treat this as a "
            f"hypothesis, not proof. Validate with direct customer conversations."
        )
    if not rec.risks:
        rec.risks.append(
            "Evidence is directional, not statistically representative — the "
            "riskiest assumption is that these complainers pay; test that first."
        )
    return rec


async def analyze_market_complaints(
    query: str,
    *,
    industry: str = "",
    region: str = "global",
    timeframe_days: int = 30,
    sources: list[str] | None = None,
    max_items: int = 80,
) -> dict:
    """Run the full radar pipeline and return the response-shaped dict.
    Never raises for source failures — partial data is returned honestly
    with per-source status in data_freshness."""
    query = " ".join((query or "").split())[:200]
    timeframe_days = max(1, min(90, int(timeframe_days)))
    max_items = max(10, min(120, int(max_items)))
    requested = [s for s in (sources or DEFAULT_SOURCES) if s in SOURCES] or list(DEFAULT_SOURCES)
    search_query = f"{query} {industry}".strip() if industry else query

    cache_key = intel_cache.build_key(search_query, timeframe_days, region, requested)
    cached = intel_cache.get_report(cache_key)
    if isinstance(cached, dict):
        return {**cached, "cached": True}

    collected = await collect_all(search_query, timeframe_days, requested, max_items)
    data_freshness = {s: collected[s].status for s in SOURCES}
    all_signals = [sig for r in collected.values() for sig in r.signals]
    available_sources = sum(1 for r in collected.values() if r.status == STATUS_AVAILABLE)
    unavailable_notes = [
        f"{r.source}: {r.note}" for r in collected.values()
        if r.status != STATUS_AVAILABLE and r.note
    ]

    report = MarketComplaintReport(
        query=query,
        generated_at=datetime.now(timezone.utc).isoformat(),
        timeframe_days=timeframe_days,
        data_freshness=data_freshness,
    )

    if not all_signals:
        report.summary = {
            "top_complaint_area": "",
            "opportunity_score": 0,
            "confidence": "low",
            "total_sources": 0,
            "total_items_analyzed": 0,
        }
        report.message = (
            "No configured source returned usable data for this query. "
            + " | ".join(unavailable_notes[:3])
        ).strip()
        result = report.to_dict()
        intel_cache.set_report(cache_key, result, has_data=False)
        return result

    # Deterministic analysis.
    hits = extract_complaints(all_signals, search_query)
    grouped = cluster_complaints(hits)
    query_token_count = len(re.findall(r"\w+", query))

    # Evidence quality telemetry — feeds score/confidence calibration and
    # the honest broad-web warning. Uses complaint-hit effective quality
    # when hits exist, otherwise the raw collector base quality.
    if hits:
        avg_quality = sum(h.quality for h in hits) / len(hits)
    else:
        avg_quality = sum(s.quality for s in all_signals) / len(all_signals)
    direct_total = sum(1 for h in hits if h.is_direct)

    signals_summary = extract_market_signals(all_signals, search_query)
    competitor_mentions = len(signals_summary.competitors_mentioned)
    largest = max((len(m) for _, m in grouped), default=0)

    clusters = []
    for idx, (label, members) in enumerate(grouped):
        cluster = build_cluster(f"cluster_{idx + 1}", label, members)
        score_cluster(
            cluster, members,
            timeframe_days=timeframe_days,
            total_complaints=len(hits),
            largest_cluster_size=largest,
            competitor_mentions=competitor_mentions,
            query_token_count=query_token_count,
        )
        clusters.append(cluster)

    # Competitor weakness association — for each mentioned competitor,
    # find the complaint cluster whose evidence text actually contains
    # the name. Runs BEFORE the pain-score sort so `clusters` and
    # `grouped` stay index-aligned. No hit → no entry (never inferred).
    for comp in signals_summary.competitors_mentioned:
        comp_l = comp.lower()
        best_count = 0
        best_cluster = None
        for cluster, (_label, members) in zip(clusters, grouped):
            count = sum(
                1 for m in members
                if comp_l in m.signal.combined_text().lower()
            )
            if count > best_count:
                best_count, best_cluster = count, cluster
        if best_cluster is not None:
            signals_summary.competitor_weaknesses.append({
                "competitor": comp,
                "cluster_id": best_cluster.id,
                "cluster_label": best_cluster.label,
                "evidence_count": best_count,
            })

    clusters.sort(key=lambda c: c.pain_score, reverse=True)
    report.complaint_clusters = clusters
    report.market_signals = signals_summary
    report.recommendations = _build_recommendations(query, clusters, signals_summary)

    # Citations: every item that contributed, capped and deduped. Each
    # carries its observed evidence role for the frontend research trail.
    direct_urls = {h.signal.url for h in hits if h.is_direct and h.signal.url}
    complaint_urls = {h.signal.url for h in hits if h.signal.url}
    seen_urls: set[str] = set()
    for sig in all_signals:
        if not sig.url or sig.url in seen_urls:
            continue
        seen_urls.add(sig.url)
        if sig.url in direct_urls:
            role = "direct"
        elif sig.url in complaint_urls:
            role = "complaint"
        elif sig.quality < 0.45:
            role = "broad"
        else:
            role = "context"
        report.citations.append(ReportCitation(
            title=sig.title or sig.url,
            url=sig.url,
            source=sig.source,
            published_at=sig.published_at,
            evidence_role=role,
        ))
        if len(report.citations) >= 40:
            break

    confidence = confidence_level(
        available_sources=available_sources,
        cluster_count=len(clusters),
        citation_count=len(report.citations),
        complaint_count=len(hits),
        direct_complaints=direct_total,
        avg_quality=avg_quality,
    )
    report.summary = {
        "top_complaint_area": clusters[0].label if clusters else "",
        "opportunity_score": opportunity_score(
            clusters, available_sources=available_sources,
            total_items=len(all_signals), avg_quality=avg_quality,
        ),
        "confidence": confidence,
        "total_sources": available_sources,
        "total_items_analyzed": len(all_signals),
        # Additive quality telemetry for the UI.
        "evidence_quality": int(max(0, min(100, round(avg_quality * 100)))),
        "direct_complaints": direct_total,
    }
    messages: list[str] = []
    if not clusters:
        messages.append(
            "Sources returned market items but none contained clear complaint "
            "language — try a more specific niche or a longer timeframe."
        )
    else:
        if avg_quality < 0.45:
            messages.append(
                "Evidence is mostly broad web content; validate with direct "
                "user conversations."
            )
        if unavailable_notes:
            messages.append("Partial data: " + " | ".join(unavailable_notes[:3]))
    report.message = " ".join(messages)

    result = report.to_dict()
    intel_cache.set_report(cache_key, result, has_data=bool(clusters))
    return result


__all__ = ["analyze_market_complaints", "DEFAULT_SOURCES"]
