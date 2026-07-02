# coding: utf-8
# Startup Market Intelligence — deterministic complaint extraction and
# clustering. NO LLM here: everything is keyword/frequency based so the
# same inputs always produce the same clusters, and nothing can be
# hallucinated. The LLM (Startup Advisor) only ever synthesizes ON TOP
# of this structured output.
#
# Quality-pass design:
#   * Clusters are keyed on founder-readable complaint THEMES (pricing,
#     reliability, alternatives-seeking, ...) instead of raw token pairs,
#     so labels read like market intelligence, not keyword soup.
#   * Signals with first-person complaint phrasing ("I hate…", "we
#     struggle with…") are flagged `is_direct` and preferred everywhere:
#     quotes, scoring, confidence.
#   * Competitor extraction requires a product-looking proper noun near
#     a switching/comparison trigger AND corroboration (repeat mention or
#     a discussion-source mention) — generic words never pass.
from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Optional

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
    "frustrating": 2, "frustrated": 2,
    # English — mild
    "complaint": 1, "problem": 1, "issue": 1, "missing": 1,
    "manual": 1, "wish there was": 1,
    # Quality pass — complaint phrasings the theme layer relies on.
    "fails to resolve": 3, "can't resolve": 3, "cant resolve": 3,
    "wrong answer": 2, "inaccurate": 2, "hallucinat": 2,
    "no response": 2, "hidden fees": 2, "not worth": 2,
    "unintuitive": 2, "takes forever": 2, "stopped working": 3,
    "doesn't support": 1, "doesnt support": 1, "no way to": 1,
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

# First-person / concrete user-pain phrasing. These mark an item as a
# DIRECT complaint — the strongest evidence class the radar has.
DIRECT_COMPLAINT_PHRASES: tuple[str, ...] = (
    # English
    "i hate", "i can't stand", "i cant stand", "i'm frustrated",
    "im frustrated", "we struggle", "i struggle", "i switched",
    "we switched", "i stopped using", "we stopped using", "i gave up",
    "i ended up", "customers complain", "clients complain",
    "our customers", "our clients", "my customers", "i'm paying",
    "im paying", "i would pay", "i'd pay", "doesn't work for me",
    "doesnt work for me", "waste of my", "bot failed",
    "pricing is confusing", "drives me crazy", "so annoying",
    # Turkish
    "nefret ediyorum", "kullanmayi biraktim", "kullanmayı bıraktım",
    "memnun degilim", "memnun değilim", "cok pahali geliyor",
    "çok pahalı geliyor", "vazgectim", "vazgeçtim",
)

# ── Complaint themes (founder-readable cluster labels) ─────────────────────
# Ordered — the FIRST matching theme claims the signal. Specific,
# high-intent themes come before broad ones.
COMPLAINT_THEMES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("Users actively seeking alternatives", (
        "switched from", "switching from", "looking for alternative",
        "alternative to", "need a replacement", "stopped using",
        "moving away from", "churned", "any alternatives",
        "alternatif ariyorum", "alternatif arıyorum",
    )),
    ("Customers demand human handoff", (
        "human handoff", "talk to a human", "speak to a human",
        "real person", "human agent", "reach a human", "human support",
        "actual human", "gerçek insan", "gercek insan",
    )),
    ("Fails to resolve real issues", (
        "fails to resolve", "can't resolve", "cant resolve", "unresolved",
        "didn't solve", "didnt solve", "doesn't answer", "doesnt answer",
        "wrong answer", "inaccurate", "hallucinat", "incorrect",
        "useless answer", "çözemedi", "cozemedi",
    )),
    ("Pricing and value complaints", (
        "expensive", "overpriced", "pricing", "price increase",
        "too costly", "cost too much", "billing", "hidden fees",
        "not worth", "pahali", "pahalı", "fiyat çok", "fiyat cok",
    )),
    ("Reliability and bugs", (
        "broken", "buggy", "doesn't work", "doesnt work", "crash",
        "outage", "keeps failing", "stopped working", "downtime",
        "bozuk", "calismiyor", "çalışmıyor",
    )),
    ("Support and escalation frustration", (
        "bad support", "no response", "support ticket", "refund",
        "escalation", "customer service", "support is terrible",
        "kotu destek", "kötü destek",
    )),
    ("Confusing or hard to use", (
        "confusing", "hard to use", "complicated", "steep learning",
        "unintuitive", "hard to set up", "kafa karistirici",
        "kafa karıştırıcı", "kullanmasi zor", "kullanması zor",
    )),
    ("Slow performance", (
        "too slow", "slow", "laggy", "takes forever", "yavas", "yavaş",
    )),
    ("Missing features and limitations", (
        "missing", "wish there was", "lacks", "no way to", "limitation",
        "feature request", "doesn't support", "doesnt support",
        "eksik", "keske", "keşke",
    )),
    ("Setup and integration friction", (
        "integration", "integrate with", "setup", "onboarding",
        "api access", "sync", "migration",
    )),
    ("Manual work and workarounds", (
        "manually", "manual", "spreadsheet", "workaround", "by hand",
        "copy paste", "copy-paste", "manuel",
    )),
)

FALLBACK_CLUSTER_LABEL = "Unclear complaint pattern"

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

# Stopwords excluded from fallback cluster topic terms (EN + TR + generic
# web-copy words that produced junk labels like "Points · Don").
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
best data building real center point points thing things actually getting
going doing making look looking help helps better easy easily year years
don dont doesn didn isn wasn aren hasn haven won wont cant couldn wouldn
shouldn ain gonna
http https www com
bir ve veya ama icin için ile gibi daha cok çok bu su şu o ben sen biz siz
onlar ne neden nasil nasıl mi mı mu mü da de ki var yok olan olarak
""".split())

_TOKEN_RE = re.compile(r"[a-zçğıöşü0-9][a-zçğıöşü0-9\-']*", re.IGNORECASE)


@dataclass
class ComplaintHit:
    """One signal that contains complaint evidence."""
    signal: RawSignal
    terms: list[str] = field(default_factory=list)      # matched complaint terms
    max_severity: int = 1
    topic_tokens: list[str] = field(default_factory=list)
    has_wtp: bool = False
    has_urgency: bool = False
    theme: Optional[str] = None       # matched COMPLAINT_THEMES label
    is_direct: bool = False           # first-person complaint phrasing
    quality: float = 0.5              # effective evidence quality 0-1


def _normalize(text: str) -> str:
    # Curly apostrophes broke tokenization ("don’t" → "don" + "t", which
    # then leaked into cluster labels) — normalize before anything else.
    text = (text or "").replace("’", "'").replace("‘", "'")
    return " ".join(text.lower().split())


def _tokens(text: str) -> list[str]:
    return [m.group(0) for m in _TOKEN_RE.finditer(text)]


def _match_theme(norm: str) -> Optional[str]:
    for label, triggers in COMPLAINT_THEMES:
        if any(t in norm for t in triggers):
            return label
    return None


def _clamp01(v: float) -> float:
    return max(0.05, min(1.0, v))


def extract_complaints(signals: list[RawSignal], query: str) -> list[ComplaintHit]:
    """Deterministic pass 1 — keep signals with complaint evidence
    (complaint terms, a complaint theme, or direct first-person pain)
    and annotate them with theme + quality for clustering/scoring."""
    query_tokens = {t.lower() for t in _tokens(query)}
    hits: list[ComplaintHit] = []

    for sig in signals:
        norm = _normalize(sig.combined_text())
        if not norm:
            continue
        matched: list[str] = []
        severity = 0
        for term, weight in COMPLAINT_TERMS.items():
            if " " in term or "'" in term:
                found = term in norm
            else:
                found = re.search(rf"\b{re.escape(term)}\b", norm) is not None
            if found:
                matched.append(term)
                severity = max(severity, weight)

        is_direct = any(p in norm for p in DIRECT_COMPLAINT_PHRASES)
        # Gate on actual complaint language (or direct first-person pain).
        # Themes only LABEL gated items — a neutral theme trigger like
        # "integration" or "pricing" in a news headline must not turn a
        # non-complaint into evidence.
        if not matched and not is_direct:
            continue
        theme = _match_theme(norm)

        # Topic tokens: only used for the fallback (non-theme) clusters.
        toks = []
        for tok in _tokens(norm):
            t = tok.strip("-'")
            if len(t) < 4 or t.isdigit() or t in _STOPWORDS or t in query_tokens:
                continue
            if t in COMPLAINT_TERMS:
                continue
            toks.append(t)

        # Effective quality = collector base + complaint-language bonuses.
        quality = _clamp01(
            sig.quality
            + (0.15 if is_direct else 0.0)
            + (0.05 if matched else 0.0)
        )

        hits.append(ComplaintHit(
            signal=sig,
            terms=matched,
            max_severity=severity or 1,
            topic_tokens=toks,
            has_wtp=any(t in norm for t in WTP_TERMS),
            has_urgency=any(t in norm for t in URGENCY_TERMS),
            theme=theme,
            is_direct=is_direct,
            quality=quality,
        ))
    return hits


def cluster_complaints(hits: list[ComplaintHit], max_clusters: int = 8) -> list[tuple[str, list[ComplaintHit]]]:
    """Deterministic pass 2 — theme-first grouping.

    1. Signals matching a COMPLAINT_THEMES entry group under that
       founder-readable label.
    2. Leftovers group by a strong shared topic token (freq ≥ 3) under
       'Complaints around "<token>"'.
    3. Anything still ungrouped folds into one honest fallback bucket.
    Returns [(label, hits)] sorted by cluster size, capped."""
    if not hits:
        return []

    theme_buckets: dict[str, list[ComplaintHit]] = defaultdict(list)
    leftovers: list[ComplaintHit] = []
    for h in hits:
        if h.theme:
            theme_buckets[h.theme].append(h)
        else:
            leftovers.append(h)

    clusters: list[tuple[str, list[ComplaintHit]]] = [
        (label, members) for label, members in theme_buckets.items()
    ]

    # Token fallback for leftovers — only strong, clean seeds make a
    # named cluster; weak seeds would recreate the old junk labels.
    if leftovers:
        term_freq: Counter = Counter()
        for h in leftovers:
            term_freq.update(set(h.topic_tokens))
        seeds = [t for t, n in term_freq.most_common(12) if n >= 3 and len(t) >= 4][:3]

        unassigned: list[ComplaintHit] = []
        seed_buckets: dict[str, list[ComplaintHit]] = defaultdict(list)
        for h in leftovers:
            assigned = next((s for s in seeds if s in h.topic_tokens), None)
            if assigned:
                seed_buckets[assigned].append(h)
            else:
                unassigned.append(h)
        for seed, members in seed_buckets.items():
            clusters.append((f'Complaints around "{seed}"', members))

        # The honest bucket — never a fabricated label. Only shown when
        # it has real volume or is the only evidence at all.
        if unassigned and (len(unassigned) >= 2 or not clusters):
            clusters.append((FALLBACK_CLUSTER_LABEL, unassigned))

    clusters.sort(key=lambda c: len(c[1]), reverse=True)
    return clusters[:max_clusters]


def build_cluster(cluster_id: str, label: str, members: list[ComplaintHit]) -> ComplaintCluster:
    """Assemble the response-shaped cluster (scores are filled by scoring.py)."""
    source_mix = {s: 0 for s in SOURCES}
    quotes: list[SampleQuote] = []
    urls: list[str] = []
    # Direct, high-quality complaints first so sample quotes show real
    # user pain instead of SEO article titles.
    ordered = sorted(
        members,
        key=lambda m: (m.is_direct, m.quality, m.max_severity, m.signal.engagement),
        reverse=True,
    )
    for h in ordered:
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


# ── Competitor extraction ───────────────────────────────────────────────────

# Product-looking proper noun right after a switching/comparison trigger.
# Requires an uppercase start on the ORIGINAL (non-normalized) text.
_COMPETITOR_TRIGGER_RE = re.compile(
    r"(?:switched from|switching from|alternative to|instead of|"
    r"migrating from|moved from|moving from|replaced|compared to|vs\.?)\s+"
    r"([A-Z][A-Za-z0-9][A-Za-z0-9\.\-]{1,22})"
)

# Generic words that are never competitors, no matter the context.
_COMPETITOR_BLOCKLIST = set("""
spending data agents agent best customers customer building support center
human resolution points users tools tool platform platforms software
service services company companies product products system systems
the a an this that these those our their your my his her its it them us
one another other others something anything everything nothing someone
using being having most more all any everyone people team teams business
ai chatbot chatbots bot bots app apps website web internet online
excel email
""".split())

# Sources where a name appearing near a trigger is genuinely product
# discussion (vs. broad web copy).
_DISCUSSION_SOURCES = {"hackernews", "reddit", "producthunt"}


def _extract_competitors(signals: list[RawSignal], query_tokens: set[str]) -> list[str]:
    """Competitor candidates must (a) look like a product name (uppercase
    proper noun near a switching trigger, not blocklisted) AND (b) be
    corroborated — mentioned in ≥2 different items OR at least once in a
    discussion source. Weak candidates are dropped entirely."""
    mention_items: dict[str, set[int]] = defaultdict(set)
    discussion_hit: dict[str, bool] = defaultdict(bool)
    display: dict[str, str] = {}

    for idx, sig in enumerate(signals):
        text = (sig.combined_text() or "").replace("’", "'")
        for m in _COMPETITOR_TRIGGER_RE.finditer(text):
            name = m.group(1).strip(".-")
            key = name.lower()
            if (len(key) < 2 or key in _COMPETITOR_BLOCKLIST
                    or key in _STOPWORDS or key in query_tokens
                    or key in COMPLAINT_TERMS):
                continue
            mention_items[key].add(idx)
            display.setdefault(key, name)
            if sig.source in _DISCUSSION_SOURCES:
                discussion_hit[key] = True

    accepted: list[tuple[str, int]] = []
    for key, items in mention_items.items():
        if len(items) >= 2 or discussion_hit[key]:
            accepted.append((display[key], len(items)))
    accepted.sort(key=lambda x: x[1], reverse=True)
    return [name for name, _ in accepted[:8]]


def extract_market_signals(signals: list[RawSignal], query: str) -> MarketSignals:
    """Deterministic market-signal extraction across ALL fetched items
    (not just complaint-bearing ones)."""
    query_tokens = {t.lower() for t in _tokens(query)}
    all_norm = [_normalize(s.combined_text()) for s in signals]

    competitors = _extract_competitors(signals, query_tokens)

    # Trending keywords: most frequent meaningful tokens across the corpus.
    kw: Counter = Counter()
    for norm in all_norm:
        for tok in set(_tokens(norm)):
            t = tok.strip("-'")
            if (len(t) < 4 or t.isdigit() or t in _STOPWORDS
                    or t in query_tokens or t in COMPLAINT_TERMS):
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
        competitors_mentioned=competitors,
        trending_keywords=trending,
        underserved_segments=segments[:6],
        common_workarounds=workarounds[:6],
    )


__all__ = [
    "ComplaintHit", "COMPLAINT_TERMS", "COMPLAINT_THEMES",
    "DIRECT_COMPLAINT_PHRASES", "FALLBACK_CLUSTER_LABEL",
    "WTP_TERMS", "URGENCY_TERMS",
    "extract_complaints", "cluster_complaints", "build_cluster",
    "extract_market_signals",
]
