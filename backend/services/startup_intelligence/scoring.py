# coding: utf-8
# Startup Market Intelligence — deterministic scoring.
#
# pain_score = weighted(frequency, severity, recency, engagement,
#              willingness_to_pay) − saturation_penalty, clamped 0-100.
#
# Every sub-score is also clamped 0-100 and returned on the cluster so
# the UI can show WHY something ranks high — nothing is a black box.
from __future__ import annotations

from datetime import datetime, timezone

from backend.services.startup_intelligence.analyzer import ComplaintHit
from backend.services.startup_intelligence.types import ComplaintCluster


def _clamp(v: float) -> int:
    return int(max(0, min(100, round(v))))


def _recency_score(published_at: str | None, timeframe_days: int) -> float:
    """1.0 for right-now, linearly down to 0.2 at the timeframe edge.
    Unknown dates get a neutral-low 0.4 — never a bonus."""
    if not published_at:
        return 0.4
    try:
        dt = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    except Exception:
        return 0.4
    age_days = max(0.0, (datetime.now(timezone.utc) - dt).total_seconds() / 86400.0)
    horizon = max(1.0, float(timeframe_days))
    return max(0.2, 1.0 - 0.8 * min(1.0, age_days / horizon))


def score_cluster(
    cluster: ComplaintCluster,
    members: list[ComplaintHit],
    *,
    timeframe_days: int,
    total_complaints: int,
    largest_cluster_size: int,
    competitor_mentions: int,
    query_token_count: int,
) -> ComplaintCluster:
    """Fill the cluster's score fields in place and return it."""
    n = len(members)
    if n == 0:
        return cluster

    # frequency: relative to the largest cluster, floor-boosted by
    # absolute count so a 6-item cluster never scores like a 1-item one.
    freq = 100.0 * n / max(1, largest_cluster_size)
    freq = max(freq, min(100.0, n * 12.0)) if n >= 2 else min(freq, 30.0)

    # severity: average of the strongest complaint term per item (1-3).
    severity = 100.0 * (sum(m.max_severity for m in members) / n) / 3.0

    # recency: average per-item freshness within the requested window.
    recency = 100.0 * sum(
        _recency_score(m.signal.published_at, timeframe_days) for m in members
    ) / n

    # engagement: log-ish scale on points/comments (public forums only).
    eng_raw = sum(max(0, m.signal.engagement) for m in members) / n
    engagement = min(100.0, eng_raw * 2.0)

    # willingness to pay: share of items with price/budget talk.
    wtp = 100.0 * sum(1 for m in members if m.has_wtp) / n

    # urgency: share of items actively seeking a replacement, blended
    # with severity so "broken + hunting for alternative" tops the list.
    urgency = _clamp(
        70.0 * (sum(1 for m in members if m.has_urgency) / n) + 0.3 * severity
    )

    # saturation risk: many named competitors → crowded space; a very
    # short generic query (1 token) also raises the risk of a weak wedge.
    saturation = min(100.0, competitor_mentions * 12.0)
    if query_token_count <= 1:
        saturation = min(100.0, saturation + 20.0)

    pain = (
        0.30 * freq
        + 0.25 * severity
        + 0.15 * recency
        + 0.10 * engagement
        + 0.20 * wtp
        - 0.15 * saturation
    )

    cluster.pain_score = _clamp(pain)
    cluster.severity = _clamp(severity)
    cluster.recency = _clamp(recency)
    cluster.urgency = urgency
    cluster.willingness_to_pay_signal = _clamp(wtp)
    cluster.saturation_risk = _clamp(saturation)
    return cluster


def confidence_level(
    *,
    available_sources: int,
    cluster_count: int,
    citation_count: int,
    complaint_count: int,
) -> str:
    """high = multiple sources + multiple clusters + real citations;
    medium = some sources + enough snippets; low = everything else."""
    if available_sources >= 2 and cluster_count >= 2 and citation_count >= 8 \
            and complaint_count >= 6:
        return "high"
    if available_sources >= 1 and (cluster_count >= 1 and citation_count >= 4):
        return "medium"
    return "low"


def opportunity_score(
    clusters: list[ComplaintCluster],
    *,
    available_sources: int,
    total_items: int,
) -> int:
    """Blend of top-cluster pain, source diversity, and evidence volume."""
    if not clusters:
        return 0
    top_pain = max(c.pain_score for c in clusters)
    diversity = min(100.0, available_sources * 25.0)
    volume = min(100.0, total_items * 2.0)
    return _clamp(0.6 * top_pain + 0.2 * diversity + 0.2 * volume)


__all__ = ["score_cluster", "confidence_level", "opportunity_score"]
