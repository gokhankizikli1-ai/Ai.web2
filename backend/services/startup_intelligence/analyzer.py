# coding: utf-8
# Startup Market Intelligence — deterministic complaint extraction and
# clustering. NO LLM here: everything is keyword/frequency based so the
# same inputs always produce the same clusters, and nothing can be
# hallucinated. The LLM (Startup Advisor) only ever synthesizes ON TOP
# of this structured output.
from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from backend.services.startup_intelligence.types import (
    RawSignal, ComplaintCluster, SampleQuote, MarketSignals, SOURCES,
)

# ── Complaint vocabulary ────────────────────────────────────────────────────
# term → severity weight (1 mild, 2 medium, 3 strong). Multi-word terms
# are matched as substrings on normalized text; single words on token
# boundaries. English + Turkish per product requirements.
COMPLAINT_TERMS: dict[str, int] = {
    # English — strong
    "hate": 3, "broken": 3, "waste of time": 3, "doesn't work": 3,
    "doesnt work": 3, "churned because": 3, "switched from": 3,
    "looking for alternative": 3, "bad support": 3,
    # English — medium
    "expensive": 2, "overpriced": 2, "slow": 2, "buggy": 2,
    "confusing": 2, "hard to use": 2, "annoying": 2, "pain": 2,
    # English — mild
    "complaint": 1, "problem": 1, "issue": 1, "missing": 1,
    "manual": 1, "wish there was": 1,
    # Turkish — strong
    "nefret": 3, "bozuk": 3, "calismiyor": 3, "çalışmıyor": 3,
    "zaman kaybi": 3, "zaman kaybı": 3, "alternatif ariyorum": 3,
    "alternatif arıyorum": 3, "kotu destek": 3, "kötü destek": 3,
    # Turkish — medium
    "pahali": 2, "pahalı": 2, "cok pahali": 2, "çok pahalı": 2,
    "yavas": 2, "yavaş": 2, "sinir bozucu": 2, "kafa karistirici": 2,
    "kafa karıştırıcı": 2, "kullanmasi zor": 2, "kullanması zor": 2,
    "zor": 2,
    # Turkish — mild
    "sikayet": 1, "şikayet": 1, "sorun": 1, "eksik": 1,
    "manuel": 1, "keske": 1, "keşke": 1,
}

# Willingness-to-pay markers — price/budget/paid-alternative talk.
WTP_TERMS = (
    "would pay", "i'd pay", "worth paying", "pricing", "subscription",
    "paid plan", "budget", "per month", "per seat", "$", "€", "£",
    "odemeye hazirim", "ödemeye hazırım", "fiyat", "abonelik", "ücret",
)

# Urgency markers — actively seeking a replacement right now.
URGENCY_TERMS = (
    "looking for alternative", "switched from", "churned because",
    "need a replacement", "any recommendations", "urgently",
    "alternatif ariyorum", "alternatif arıyorum", "acil",
)

# Common workaround tools people mention when no product fits.
WORKAROUND_TERMS = (
    "spreadsheet", "excel", "google sheets", "manually", "by hand",
    "zapier", "notion", "airtable", "email", "whatsapp", "pen and paper",
    "custom script", "elle", "manuel olarak",
)

# Segment words for underserved-segment detection.
SEGMENT_TERMS = (
    "small business", "smb", "solo founder", "solopreneur", "freelancer",
    "agency", "agencies", "startup", "enterprise", "student", "students",
    "teacher", "non-technical", "indie", "creator", "restaurant",
    "e-commerce", "ecommerce", "kucuk isletme", "küçük işletme", "ogrenci",
    "öğrenci",
)

# Stopwords excluded from cluster topic terms (EN + TR + complaint terms).
_STOPWORDS = set("""
the a an and or but for with without from into onto this that these those
there here what when where which who whom whose why how all any both each
few more most other some such only own same so than too very can will just
should now not have has had was were are is be been being do does did doing
would could must may might about after again against because before below
between during out over under then once you your yours they them their it
its we our ours i me my mine he she his her him us if then else use using
used user users get got make makes made need needs want wants really also
one two like still even much many way ways good great bad new app apps tool
tools product products software service services company companies
bir ve veya ama icin için ile gibi daha cok çok bu su şu o ben sen biz siz
onlar ne neden nasil nasıl mi mı mu mü da de ki var yok olan olarak
""".split())

_TOKEN_RE = re.compile(r"[a-zçğıöşü0-9][a-zçğıöşü0-9\-']*", re.IGNORECASE)


@dataclass
class ComplaintHit:
    """One signal that contains at least one complaint marker."""
    signal: RawSignal
    terms: list[str] = field(default_factory=list)      # matched complaint terms
    max_severity: int = 1
    topic_tokens: list[str] = field(default_factory=list)
    has_wtp: bool = False
    has_urgency: bool = False


def _normalize(text: str) -> str:
    return " ".join((text or "").lower().split())


def _tokens(text: str) -> list[str]:
    return [m.group(0) for m in _TOKEN_RE.finditer(text)]


def extract_complaints(signals: list[RawSignal], query: str) -> list[ComplaintHit]:
    """Deterministic pass 1 — keep only signals with complaint markers and
    annotate them with topic tokens (candidate cluster keys)."""
    query_tokens = {t.lower() for t in _tokens(query)}
    hits: list[ComplaintHit] = []

    for sig in signals:
        norm = _normalize(sig.combined_text())
        if not norm:
            continue
        matched: list[str] = []
        severity = 0
        for term, weight in COMPLAINT_TERMS.items():
            if " " in term or "'" in term or "$" in term:
                found = term in norm
            else:
                found = re.search(rf"\b{re.escape(term)}\b", norm) is not None
            if found:
                matched.append(term)
                severity = max(severity, weight)
        if not matched:
            continue

        # Topic tokens: meaningful words in the text, minus stopwords,
        # minus the query's own words, minus the complaint vocabulary.
        toks = []
        for tok in _tokens(norm):
            t = tok.strip("-'")
            if len(t) < 3 or t in _STOPWORDS or t in query_tokens:
                continue
            if t in COMPLAINT_TERMS:
                continue
            toks.append(t)

        hits.append(ComplaintHit(
            signal=sig,
            terms=matched,
            max_severity=severity or 1,
            topic_tokens=toks,
            has_wtp=any(t in norm for t in WTP_TERMS),
            has_urgency=any(t in norm for t in URGENCY_TERMS),
        ))
    return hits


def cluster_complaints(hits: list[ComplaintHit], max_clusters: int = 8) -> list[tuple[str, list[ComplaintHit]]]:
    """Deterministic pass 2 — group complaints by their most frequent
    shared topic term. Returns [(label, hits)] sorted by cluster size.
    Produces 0..max_clusters clusters; unmatched items fold into a
    general bucket so detected complaints are never hidden."""
    if not hits:
        return []

    term_freq: Counter = Counter()
    for h in hits:
        term_freq.update(set(h.topic_tokens))

    # Seed terms: appear in ≥2 different complaint items.
    seeds = [t for t, n in term_freq.most_common(24) if n >= 2][:max_clusters]

    buckets: dict[str, list[ComplaintHit]] = defaultdict(list)
    leftovers: list[ComplaintHit] = []
    for h in hits:
        assigned = next((s for s in seeds if s in h.topic_tokens), None)
        if assigned:
            buckets[assigned].append(h)
        else:
            leftovers.append(h)

    clusters: list[tuple[str, list[ComplaintHit]]] = []
    for seed in seeds:
        members = buckets.get(seed) or []
        if not members:
            continue
        # Label = seed + its strongest co-occurring topic term, so the
        # cluster reads like a theme ("pricing · billing"), not a token.
        co = Counter()
        for m in members:
            co.update(t for t in set(m.topic_tokens) if t != seed)
        second = next((t for t, _ in co.most_common(3) if t != seed), None)
        label = f"{seed} · {second}" if second else seed
        clusters.append((label, members))

    # Small datasets: every unmatched complaint still becomes one honest bucket.
    if leftovers:
        clusters.append(("other complaint signals", leftovers))

    clusters.sort(key=lambda c: len(c[1]), reverse=True)
    return clusters[:max_clusters]


def build_cluster(cluster_id: str, label: str, members: list[ComplaintHit]) -> ComplaintCluster:
    """Assemble the response-shaped cluster (scores are filled by scoring.py)."""
    source_mix = {s: 0 for s in SOURCES}
    quotes: list[SampleQuote] = []
    urls: list[str] = []
    # Strongest complaints first so sample quotes show real pain.
    for h in sorted(members, key=lambda m: (m.max_severity, m.signal.engagement), reverse=True):
        source_mix[h.signal.source] = source_mix.get(h.signal.source, 0) + 1
        if h.signal.url and h.signal.url not in urls:
            urls.append(h.signal.url)
        if len(quotes) < 3:
            text = _normalize(h.signal.combined_text())[:220]
            if text:
                quotes.append(SampleQuote(text=text, source=h.signal.source,
                                          url=h.signal.url))
    return ComplaintCluster(
        id=cluster_id,
        label=label,
        frequency=len(members),
        source_mix=source_mix,
        sample_quotes=quotes,
        evidence_urls=urls[:8],
    )


def extract_market_signals(signals: list[RawSignal], query: str) -> MarketSignals:
    """Deterministic market-signal extraction across ALL fetched items
    (not just complaint-bearing ones)."""
    query_tokens = {t.lower() for t in _tokens(query)}
    all_norm = [_normalize(s.combined_text()) for s in signals]

    # Competitors: "switched from X", "alternative to X", "X alternative".
    competitor_re = re.compile(
        r"(?:switched from|alternative to|instead of|migrating from|moved from)\s+"
        r"([A-Za-z][A-Za-z0-9\.\-]{2,24})",
        re.IGNORECASE,
    )
    competitors: Counter = Counter()
    for s in signals:
        for m in competitor_re.finditer(s.combined_text()):
            name = m.group(1).strip(".-")
            if name.lower() not in _STOPWORDS and name.lower() not in query_tokens:
                competitors[name.lower()] += 1

    # Trending keywords: most frequent meaningful tokens across the corpus.
    kw: Counter = Counter()
    for norm in all_norm:
        for tok in set(_tokens(norm)):
            t = tok.strip("-'")
            if len(t) < 4 or t in _STOPWORDS or t in query_tokens or t in COMPLAINT_TERMS:
                continue
            kw[t] += 1
    trending = [t for t, n in kw.most_common(20) if n >= 2][:8]

    segments = []
    for seg in SEGMENT_TERMS:
        if any(seg in norm for norm in all_norm) and seg not in segments:
            segments.append(seg)

    workarounds = []
    for w in WORKAROUND_TERMS:
        if any(w in norm for norm in all_norm) and w not in workarounds:
            workarounds.append(w)

    return MarketSignals(
        competitors_mentioned=[c for c, _ in competitors.most_common(8)],
        trending_keywords=trending,
        underserved_segments=segments[:6],
        common_workarounds=workarounds[:6],
    )


__all__ = [
    "ComplaintHit", "COMPLAINT_TERMS", "WTP_TERMS", "URGENCY_TERMS",
    "extract_complaints", "cluster_complaints", "build_cluster",
    "extract_market_signals",
]
