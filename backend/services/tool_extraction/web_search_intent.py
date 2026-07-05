# coding: utf-8
"""Phase 11 fix — intent-based web search auto-invocation.

When the user asks a question that REQUIRES current information
(latest news, today's prices, competitor research, etc.) but doesn't
paste a URL, the existing browser_fetch path doesn't fire and the
LLM falls back to "I can't access the internet" templates.

This module fixes that by detecting search-INTENT in the user's
message and auto-invoking the `web_research` tool (Tavily-backed)
BEFORE the LLM stream opens. Results are folded into the prompt
with the same assertive framing + dual-injection pattern that
made the GitHub and browser fixes work.

Activation chain (any link missing → no-op, LLM behaves as before):
  ENABLE_TOOLS=true            (master)
  ENABLE_WEB_RESEARCH=true     (per-tool flag from Phase 4D)
  WEB_RESEARCH_PROVIDER=tavily (provider selection)
  TAVILY_API_KEY=<key>         (provider auth)

Intent detection is regex+keyword based, multilingual (EN + TR).
Designed to be CONSERVATIVE — false negatives (treating a
search-worthy query as plain chat) are cheaper than false
positives (burning Tavily credits on small talk).
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Optional


logger = logging.getLogger(__name__)


# ── Intent signals ────────────────────────────────────────────────────────
#
# Three families:
#   - TEMPORAL  →  "current", "today", "latest", "right now" etc.
#                  Almost always implies fresh-data need.
#   - RESEARCH  →  "compare", "research", "analyze", "find me",
#                  "what's the price", "trends in".
#   - DOMAIN    →  "stock", "news", "competitor", "university",
#                  "pricing", "startup", "trend report" — domain
#                  cues that typically need external sources.
#
# Multilingual: every English signal has its TR / common transliterated
# counterpart so a Turkish-speaking user gets the same auto-invocation.

_TEMPORAL_SIGNALS: tuple[str, ...] = (
    # English
    "latest", "today", "today's", "current", "currently", "right now",
    "this week", "this month", "this year",
    "recently", "recent", "live", "happening now", "breaking",
    "as of", "right now", "real-time", "real time", "realtime",
    # Turkish
    "bugün", "bugünkü", "şu an", "şu anki", "şimdi", "şimdiki",
    "güncel", "günümüzdeki", "son", "son durum", "en son",
    "geçen hafta", "bu hafta", "bu ay", "bu yıl",
    "anlık", "canlı", "gerçek zamanlı", "yakın zamanda",
)

# Phrases that EXPLICITLY ask the assistant to search the web. Highest
# weight — these alone should trigger regardless of other signals.
_EXPLICIT_SEARCH_PHRASES: tuple[str, ...] = (
    # English
    "search the web", "search online", "look up online", "look up on the web",
    "google it", "google for", "find online", "search for",
    "browse the web", "check online",
    # Nav-cleanup phase — Research tab removed; these direct asks must
    # fire from normal Chat.
    "research this", "look this up", "look it up", "look that up",
    "find current data", "find current info", "with sources",
    "show sources", "cite sources",
    # Turkish
    "internetten araştır", "webden bul", "webde ara", "internetten ara",
    "online araştır", "googleda ara", "google'da ara",
    "internetten bilgi", "internetten kontrol et",
    # Nav-cleanup phase — TR direct asks. "kaynaklı" alone is ambiguous
    # ("stres kaynaklı" = "caused by stress"), so only paired forms.
    "internetten bak", "webden bak", "webe bak",
    "kaynaklı araştır", "kaynaklı bak", "kaynak göster", "kaynak ver",
    "güncel kaynak", "haberleri araştır",
)

# Research / analysis verbs.
_RESEARCH_SIGNALS: tuple[str, ...] = (
    "compare", "comparison", "vs", "versus",
    "research", "analyze", "analysis", "analyse",
    "trends in", "trend report", "market analysis", "market trends",
    "competitor analysis", "competitor research", "competitors of",
    "industry overview", "industry analysis",
    "best ", "top 10 ", "top 5 ", "top 3 ",
    "review of", "reviews of",
    # Phase 11 final — production-observed phrasings the user listed.
    "startup research", "company research", "company analysis",
    "website analysis", "site analysis", "site audit",
    "ecommerce trends", "saas trends", "ai tools",
    "ai startup", "ai startups", "university comparison",
    "pricing research", "pricing analysis", "stock analysis",
    "find the best", "what are the best", "which is the best",
    "summarise", "summarize", "summary of", "tldr of",
    # Turkish
    "karşılaştır", "kıyasla", "karşılaştırma",
    "araştır", "araştırma", "analiz et", "analiz",
    "rapor", "raporu",
    "rakip", "rakipler", "rakip analiz",
    "trend", "trendler", "pazar analiz", "pazar trend",
    "en iyi ", "ilk 10", "ilk 5", "ilk 3",
    "şirket araştırması", "üniversite karşılaştırması",
    "fiyat analizi", "pazar araştırması",
    # University / admissions — current requirements benefit from live data.
    "başvuru şartları", "basvuru sartlari", "başvuru koşulları",
    "başvuru gereksinimleri", "kabul şartları", "kabul koşulları",
    "kabul oranı", "kontenjan",
    "admission requirements", "admission criteria", "application requirements",
    "acceptance rate", "how to apply", "requirements for",
)

# Domain words that almost always imply external sources.
_DOMAIN_SIGNALS: tuple[str, ...] = (
    "news", "headlines", "breaking news", "press release",
    "stock price", "share price", "market cap", "earnings",
    "pricing", "price of", "how much does", "how much is",
    "competitor", "competitors",
    "university", "universities", "college ranking",
    "startup", "saas tools", "ai tools", "best tools",
    "documentation", "docs for",
    "weather", "forecast",
    # Phase 11 final — common domain words the user listed.
    "company", "industry", "market", "sector",
    "saas", "platform", "service", "vendor",
    "website", "landing page",
    # Turkish
    "haber", "haberler", "manşet",
    "hisse", "borsa", "piyasa değeri", "kâr açıklaması",
    "fiyat", "ne kadar", "kaç tl", "kaç para",
    "üniversite", "üniversiteler",
    "girişim", "yapay zeka aracı", "ai aracı",
    "dokümantasyon", "doküman",
    "hava durumu",
    "şirket", "sektör", "pazar",
    "web sitesi", "site",
)


# ── Finance / current-price signals (mandatory live data) ──────────────────
#
# Any current price / market / stock / crypto / FX / commodity question must
# ALWAYS hit the live layer — never be answered from model memory. The general
# scorer above missed these: "NVDA kaç dolar" has no temporal/research word and
# "kaç dolar" wasn't a domain cue (only "kaç tl" was), so it scored 0. This
# block is a dedicated, high-confidence detector that force-triggers.

# Unambiguous finance phrases — fire on their own.
_FINANCE_STRONG: tuple[str, ...] = (
    "market cap", "market capitalization", "piyasa değeri", "piyasa degeri",
    "stock price", "share price", "hisse fiyatı", "hisse fiyati", "hisse senedi fiyat",
    "coin fiyatı", "coin fiyati", "coin price", "crypto price", "kripto fiyat",
    "güncel fiyat", "guncel fiyat", "anlık fiyat", "anlik fiyat", "current price",
    "spot price", "spot fiyat", "trading at", "exchange rate", "döviz kuru", "doviz kuru",
    "borsada ne kadar", "borsada kaç", "hisse fiyatı ne", "coin fiyatı ne",
)

# Price-question phrases — count as finance ONLY with an asset present.
_FINANCE_PRICE_PHRASES: tuple[str, ...] = (
    "kaç dolar", "kac dolar", "kaç usd", "kac usd", "kaç tl", "kac tl", "kaç lira",
    "kac lira", "kaç ₺", "kaç euro", "kac euro", "kaç €", "kaç sterlin", "kac sterlin",
    "kaç yen", "kaç para", "kac para", "kaça", "kaçta", "kacta", "kaçtan", "kactan",
    "fiyatı ne", "fiyati ne", "fiyatı kaç", "fiyati kac", "fiyatı nedir", "fiyati nedir",
    "fiyatı", "fiyati", "ne kadar", "kaç dolardan",
    "price of", "how much is", "how much does", "how much for", "worth", "how much",
)

# Asset context — fx, crypto, commodities, equities/market words.
_FINANCE_ASSETS: tuple[str, ...] = (
    # fiat / fx
    "dolar", "usd", "euro", "eur", "sterlin", "gbp", "pound", "yen", "jpy",
    "try", "lira", "döviz", "doviz",
    # crypto (names + a few common tickers as words)
    "bitcoin", "btc", "ethereum", "eth", "solana", "ripple", "xrp", "dogecoin",
    "doge", "cardano", "avax", "tether", "usdt", "kripto", "crypto", "coin", "altcoin",
    # commodities
    "altın", "altin", "gram altın", "gram altin", "gümüş", "gumus", "silver",
    "gold", "petrol", "brent", "oil", "ons altın", "ons",
    # equities / market
    "hisse", "hisseleri", "hissesi", "borsa", "borsada", "stock", "shares", "share",
    "nasdaq", "nyse", "bist", "endeks", "temettü", "dividend", "piyasa",
)

# Well-known equity + crypto + index tickers. Matched as UPPERCASE standalone
# tokens in the ORIGINAL text (so lowercase words like TR "sol"/"ada"/"for"
# don't false-match). Also used as the fuzzy-correction target set.
_KNOWN_TICKERS: frozenset[str] = frozenset({
    # US equities
    "NVDA", "TSLA", "AAPL", "MSFT", "AMZN", "GOOGL", "GOOG", "META", "AMD", "INTC",
    "NFLX", "DIS", "BABA", "PYPL", "UBER", "COIN", "PLTR", "SOFI", "NIO", "BAC",
    "JPM", "ORCL", "CRM", "ADBE", "QCOM", "MU", "AVGO", "ARM", "SNAP", "SHOP",
    "ABNB", "SPOT", "RBLX", "GME", "AMC", "BA", "KO", "PEP", "XOM", "CVX", "WMT",
    "NKE", "MRNA", "PFE",
    # crypto
    "BTC", "ETH", "SOL", "XRP", "DOGE", "BNB", "ADA", "AVAX", "DOT", "MATIC",
    "LTC", "LINK", "TRX", "SHIB", "USDT", "USDC",
    # indices / etf
    "SPY", "QQQ", "VOO", "DIA", "IWM",
})

# Company names that imply a stock-price question when paired with price/asset.
_COMPANY_STOCK_NAMES: tuple[str, ...] = (
    "nvidia", "tesla", "apple", "microsoft", "amazon", "google", "alphabet",
    "meta", "facebook", "netflix", "intel", "alibaba", "paypal", "coinbase",
    "palantir", "oracle", "salesforce", "adobe", "qualcomm", "broadcom",
    "spotify", "roblox", "shopify", "airbnb", "disney",
)


def _levenshtein_le1(a: str, b: str) -> bool:
    """True if edit distance(a, b) <= 1. Cheap early-exit variant — enough for
    single-typo ticker correction ('ncda' → 'NVDA')."""
    if a == b:
        return True
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    if la == lb:  # one substitution allowed
        return sum(1 for x, y in zip(a, b) if x != y) == 1
    # one insertion/deletion — make `a` the shorter
    if la > lb:
        a, b, la, lb = b, a, lb, la
    i = j = 0
    edited = False
    while i < la and j < lb:
        if a[i] == b[j]:
            i += 1
            j += 1
        else:
            if edited:
                return False
            edited = True
            j += 1  # skip one char in the longer string
    return True


def _fuzzy_ticker(token: str) -> Optional[str]:
    """Return the known ticker a 2-5 char alpha token likely means (edit
    distance <= 1), else None. Used for finance typo recovery."""
    t = token.upper()
    if not (2 <= len(t) <= 5) or not t.isalpha():
        return None
    if t in _KNOWN_TICKERS:
        return t
    for known in _KNOWN_TICKERS:
        if len(known) == len(t) and _levenshtein_le1(t, known):
            return known
    return None


def detect_finance_intent(text: str, lower: str) -> Optional[tuple[str, str, list[str]]]:
    """Detect a current-price / market / stock / crypto / FX / commodity query.

    Returns (corrected_query, matched_ticker_or_empty, hits) when the message is
    a finance/price question that MUST use live data, else None. `corrected_query`
    has any obvious ticker typo fixed (e.g. 'ncda kaç dolar' → 'NVDA kaç dolar')
    so the live search is well-formed. Never guesses a price — only routing.
    """
    hits: list[str] = []

    strong = _contains_any(lower, _FINANCE_STRONG)
    price  = _contains_any(lower, _FINANCE_PRICE_PHRASES)
    asset  = _contains_any(lower, _FINANCE_ASSETS)
    company = _contains_any(lower, _COMPANY_STOCK_NAMES)

    # Exact uppercase ticker as a standalone token in the ORIGINAL text.
    exact_ticker = ""
    for tok in re.findall(r"\b[A-Za-z]{2,5}\b", text):
        if tok.upper() in _KNOWN_TICKERS and (tok.isupper() or tok.upper() in _FINANCE_ASSETS):
            exact_ticker = tok.upper()
            break

    # Fuzzy ticker (typo) — only when there's price/asset context, so a random
    # word can't get "corrected" into a stock lookup.
    fuzzy_ticker = ""
    corrected_query = text
    if not exact_ticker and (price or asset or strong):
        for tok in re.findall(r"\b[A-Za-z]{2,5}\b", text):
            if tok.upper() in _KNOWN_TICKERS:
                continue
            cand = _fuzzy_ticker(tok)
            if cand:
                fuzzy_ticker = cand
                # Rewrite the typo'd token to the corrected ticker for search.
                corrected_query = re.sub(
                    rf"\b{re.escape(tok)}\b", cand, text, count=1,
                )
                break

    ticker = exact_ticker or fuzzy_ticker

    is_finance = bool(
        strong
        or (price and (asset or company or ticker))
        or (ticker and (price or asset))
    )
    if not is_finance:
        return None

    hits.extend(strong[:1] or price[:1] or [])
    if ticker:
        hits.append(f"ticker:{ticker}")
    if asset:
        hits.append(f"asset:{asset[0]}")
    if company:
        hits.append(f"company:{company[0]}")
    return corrected_query, ticker, (hits or ["finance"])


# Phrases that NEGATE the intent — when present, even strong temporal
# signals shouldn't fire (e.g. "tell me a joke about today's weather"
# is small talk, not research).
_NEGATIVE_PATTERNS: tuple[str, ...] = (
    r"\btell me a joke\b",
    r"\bwrite (?:a |me )?(?:poem|story|haiku|essay)\b",
    r"\bunit test\b",          # likely a coding question, not research
    r"\bbir şaka\b",           # TR "a joke"
    # Phase 11 final — after threshold dropped to 0.4, short
    # "Hello, how are you today?" started false-firing. Greetings
    # ending in a question mark with < 8 words are chitchat.
    r"^\s*(hello|hi|hey|merhaba|selam|good morning|good afternoon|"
    r"good evening|günaydın|iyi günler|iyi akşamlar)[,!.\s]",
)


# ── Result ────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class WebSearchIntent:
    triggered:   bool
    confidence:  float       # 0-1; >= 0.5 triggers auto-invocation
    triggers:    tuple[str, ...]  # which signals fired (for logging)
    query:       str         # cleaned query to send to web_research
    reason:      str         # short human-readable explanation


def _contains_any(text_lower: str, phrases: tuple[str, ...]) -> list[str]:
    return [p for p in phrases if p in text_lower]


def detect_web_search_intent(user_message: str) -> WebSearchIntent:
    """Decide whether to auto-invoke web_research for this turn.

    Returns a WebSearchIntent with `triggered=True` when the signal
    is strong enough. Conservative — when in doubt, don't fire.
    """
    if not user_message or not user_message.strip():
        return WebSearchIntent(False, 0.0, (), "", "empty message")
    text = user_message.strip()
    # Turkish-aware lowering. Python's default `.lower()` of the
    # Turkish capital İ produces "i + COMBINING DOT ABOVE" instead of
    # plain "i", which would break exact-string matches against our
    # trigger list ("internetten araştır" wouldn't fire on
    # "İnternetten araştır"). Normalising the combining sequence
    # restores the match.
    lower = text.lower().replace("i̇", "i")

    # Negative patterns short-circuit — "tell me a joke about today" is
    # not a research request.
    for neg in _NEGATIVE_PATTERNS:
        if re.search(neg, lower, flags=re.IGNORECASE):
            return WebSearchIntent(False, 0.0, (), text,
                                   f"negative pattern: {neg}")

    # Explicit search phrases are the strongest signal.
    explicit_hits = _contains_any(lower, _EXPLICIT_SEARCH_PHRASES)
    if explicit_hits:
        return WebSearchIntent(
            True, 0.95, tuple(explicit_hits[:3]),
            text, f"explicit search phrase: {explicit_hits[0]}",
        )

    # Finance / current-price queries — MANDATORY live data. Force-trigger at
    # high confidence with a typo-corrected query. Current prices/quotes must
    # never come from model memory (the whole point of this fix).
    finance = detect_finance_intent(text, lower)
    if finance is not None:
        corrected_query, ticker, fin_hits = finance
        logger.info(
            "[INTENT] finance | requires_live_data=True | ticker=%s | hits=%s",
            ticker or "-", ",".join(fin_hits[:4]),
        )
        return WebSearchIntent(
            triggered=  True,
            confidence= 0.9,
            triggers=   tuple(["finance", *fin_hits][:6]),
            query=      corrected_query,
            reason=(
                "finance/current-price query — mandatory live data"
                + (f"; ticker={ticker}" if ticker else "")
                + (f"; corrected='{corrected_query}'" if corrected_query != text else "")
            ),
        )

    # Score: temporal + research + domain signals each add weight.
    temporal = _contains_any(lower, _TEMPORAL_SIGNALS)
    research = _contains_any(lower, _RESEARCH_SIGNALS)
    domain   = _contains_any(lower, _DOMAIN_SIGNALS)

    score = 0.0
    triggers: list[str] = []
    if temporal:
        score += 0.45
        triggers.extend(temporal[:2])
    if research:
        score += 0.40
        triggers.extend(research[:2])
    if domain:
        score += 0.30
        triggers.extend(domain[:2])

    # Length bonus — a 20+ word question is more likely to be a real
    # research request than chit-chat. Length alone never triggers.
    word_count = len(re.findall(r"\S+", text))
    if word_count >= 20:
        score += 0.10

    # Phase 11 final — lowered from 0.5 to 0.4 after production
    # observation that prompts like "ai tools 2026" / "company
    # research on Stripe" scored exactly 0.30-0.40 from a single
    # domain hit. False positives are still cheap (one Tavily call)
    # compared to false negatives (LLM returns the bad fallback
    # template).
    triggered = score >= 0.4
    return WebSearchIntent(
        triggered=  triggered,
        confidence= min(1.0, round(score, 2)),
        triggers=   tuple(triggers[:6]),
        query=      text,
        reason=(
            f"score={score:.2f} "
            f"(temporal={len(temporal)}, research={len(research)}, "
            f"domain={len(domain)}, words={word_count})"
        ),
    )


def requires_live_data(user_message: str) -> bool:
    """Central 'should this use the live web/research layer?' rule.

    One source of truth for every chat surface (normal chat, business/startup
    handoffs, trading follow-ups) and every session kind (guest / signed-in /
    owner). True whenever the message is a finance/current-price query OR the
    general intent detector would auto-invoke web_research. Finance always
    qualifies — current prices must never be answered from memory.
    """
    if not user_message or not user_message.strip():
        return False
    lower = user_message.strip().lower().replace("i̇", "i")
    if detect_finance_intent(user_message.strip(), lower) is not None:
        return True
    return detect_web_search_intent(user_message).triggered


# ── Block builder ─────────────────────────────────────────────────────────

# Aggregate budget; web_research returns up to 10 citations + an
# answer string. Trim to fit the prompt.
_TOTAL_CHAR_CAP = 14_000
_DEFAULT_MAX_RESULTS = 5


# ── Phase 7 closure — shadow-job for inline path ───────────────────────────
#
# Diagnosis (production fix #157 was not enough): when the operator
# left WEB_RESEARCH_VIA_CELERY=false OR one of the routing flags was
# off, the inline path served the chat answer but no row landed in
# jobs_store. AdminPanel showed count=0 even though research had run.
#
# The fix: AT THE END of the inline path (after a result exists), we
# record a "shadow" job — status=succeeded, no runner dispatch — so
# every research request shows up in /v2/jobs/all regardless of the
# routing flag. The Jobs panel becomes a faithful record of research
# activity rather than a routing-flag-conditional view.
#
# Distinguishable from real Celery jobs by metadata.shadow=True.

def _record_inline_research_job(
    *,
    user_id:     Optional[str],
    query:       str,
    triggers:    tuple[str, ...],
    citations:   list,
    answer:      str,
    provider:    str,
    project_id:  Optional[str] = None,
    correlation_id: Optional[str] = None,
    caller:      str = "chat_inline",
) -> None:
    """Persist a status=succeeded job row directly to jobs_store. NO
    runner dispatch — the work is already done. Adds metadata.shadow
    so operators can distinguish post-hoc records from real queued
    jobs.

    The `caller` param distinguishes invocation paths so the operator
    can tell where the chat invoked web_research from:
      * chat_inline  — build_web_search_context_block intent path
      * chat_tool    — tool_orchestrator.run_tools_for_mode (mode-based)
      * chat_func    — LLM function-calling path
      * (future)     — any new caller adds itself here

    Hard runtime proof (PR #159 requirement):
    Three tagged log lines fire so the operator can see the full chain
    in Railway logs:
      [JOB][SHADOW] before insert
      [JOB][SHADOW] after insert with job_id
      [JOB][SHADOW_VERIFY] immediate re-read of jobs_store row count
    If SHADOW_VERIFY count > 0 but /v2/jobs/all returns count = 0,
    DB/session mismatch is the cause.
    If SHADOW never appears, the chat is bypassing the helper.

    Never raises — logs at WARNING and returns. The chat response
    is unaffected by any failure here.
    """
    try:
        from backend.services.jobs import store as jobs_store
        from backend.services.jobs.types import JobRecord, STATUS_SUCCEEDED
        from datetime import datetime, timezone

        logger.info(
            "[JOB][SHADOW] before-insert caller=%s user_id=%s "
            "query=%s citations=%d provider=%s",
            caller, user_id or "anonymous",
            query[:80], len(citations or []), provider,
        )

        now = datetime.now(timezone.utc).isoformat()
        # Compact result mirrors the research.deep handler's return
        # shape so the FE doesn't need to special-case shadow jobs.
        result = {
            "query":     query,
            "answer":    answer or "",
            "citations": citations or [],
            "count":     len(citations or []),
            "provider":  provider or "inline",
            "cached":    False,
            "elapsed_ms": 0,
        }
        rec = jobs_store.insert(JobRecord(
            kind=        "research.deep",
            user_id=     str(user_id or "anonymous"),
            project_id=  project_id,
            status=      STATUS_SUCCEEDED,
            payload={
                "query": query, "max_results": _DEFAULT_MAX_RESULTS,
                "depth": "basic",
            },
            result=      result,
            progress=    100,
            started_at=  now,
            finished_at= now,
            metadata={
                "caller":         caller,
                "shadow":         True,
                "triggers":       list(triggers),
                "correlation_id": correlation_id,
            },
        ))
        logger.info(
            "[JOB][SHADOW] after-insert id=%s kind=research.deep caller=%s "
            "user_id=%s db_path=%s",
            rec.id, caller, user_id or "anonymous",
            _jobs_db_path(),
        )

        # IMMEDIATE re-read on the same store — proves the row landed
        # in the SAME database that /v2/jobs/all reads from. If this
        # number > 0 but /v2/jobs/all still returns 0, the operator
        # knows it's a DB-path / multi-instance / SQLite-file mismatch.
        try:
            verify_rec = jobs_store.get(rec.id)
            total = jobs_store.table_counts()
            logger.info(
                "[JOB][SHADOW_VERIFY] id=%s found=%s db_path=%s "
                "total_rows=%s",
                rec.id, verify_rec is not None,
                _jobs_db_path(), total,
            )
        except Exception as ver_exc:                          # pragma: no cover
            logger.warning(
                "[JOB][SHADOW_VERIFY] re-read failed id=%s err=%s",
                rec.id, ver_exc,
            )
    except Exception as exc:                                  # pragma: no cover
        logger.warning(
            "[JOB][SHADOW] insert failed user_id=%s err=%s",
            user_id, exc,
        )


def _jobs_db_path() -> str:
    """Return the jobs_store DB path the API process is using. Lets
    the operator visually compare the writer's path against the
    reader's — a mismatch (different files / different containers)
    is the most likely explanation when SHADOW_VERIFY shows rows but
    /v2/jobs/all returns zero."""
    import os
    return os.getenv("JOBS_DB_PATH") or "(unset → ./jobs.db)"


# ── Phase 7 closure — Celery dispatch for chat-triggered research ──────────
#
# Bypass diagnosis: prior to this fix the chat stream called the
# web_research tool INLINE (the entire research request ran in the
# API process). Jobs panel stayed empty, worker logs never saw a
# task. The `research.deep` Celery handler shipped in slice 3 was
# orphaned — no caller dispatched to it.
#
# The fix: when WEB_RESEARCH_VIA_CELERY=true, build_web_search_context_block
# creates a research.deep job and waits on the in-process JobEventBus
# for the terminal event. On any failure (queue off, dispatch raises,
# wait times out), we fall back to the inline path — chat must NEVER
# be broken because Celery is down.

# How long we wait for the job to complete before falling back. The
# inline path's hard cap is 12-15s; we give Celery similar headroom
# plus a small buffer for the worker pick-up.
_CELERY_WAIT_TIMEOUT_S = 25.0


def _route_research_via_celery() -> bool:
    """True when the env flag is on AND the job queue is enabled.

    Read dynamically so a Railway env flip is live on the next request.
    All three flags accept any common truthy spelling (true/1/yes/on) so a
    value like `WEB_RESEARCH_VIA_CELERY=1` behaves the same as `=true`.
    """
    import os
    from backend.services.tools.tool_registry import env_truthy
    if not env_truthy(os.getenv("WEB_RESEARCH_VIA_CELERY")):
        return False
    if not env_truthy(os.getenv("ENABLE_JOB_QUEUE")):
        return False
    if not env_truthy(os.getenv("JOB_QUEUE_RESEARCH")):
        return False
    return True


async def _run_research_via_celery(
    *,
    user_id:        Optional[str],
    query:          str,
    project_id:     Optional[str],
    correlation_id: Optional[str],
) -> Optional[dict]:
    """Submit a `research.deep` job + await its terminal event.

    Returns the SAME envelope shape that the inline tool produces:
      {"status": "available", "data": {citations, answer, provider, ...},
       "provider": "..."}
    OR None when the queue path failed (caller falls back to inline).
    """
    try:
        from backend.services.jobs import client as jobs_client
        from backend.services.jobs.errors import JobQueueDisabled
        from backend.services.jobs.events import get_bus
        from backend.services.jobs.types import (
            STATUS_SUCCEEDED, STATUS_FAILED, STATUS_FAILED_DLQ,
            STATUS_CANCELLED,
        )
    except Exception as exc:                                  # pragma: no cover
        logger.warning("[CELERY_DISPATCH] imports failed: %s", exc)
        return None

    # 1) Create the job. JobQueueDisabled is the operator-visible
    # "queue off" signal — we honour it by returning None so the
    # caller falls back to inline.
    try:
        job = await jobs_client.create(
            user_id=        user_id or "anonymous",
            kind=           "research.deep",
            payload={
                "query":       query,
                "max_results": _DEFAULT_MAX_RESULTS,
                "depth":       "basic",
            },
            project_id=     project_id,
            metadata={
                "caller":         "chat_auto",
                "correlation_id": correlation_id,
            },
        )
    except JobQueueDisabled:
        return None
    except Exception as exc:
        logger.warning("[CELERY_DISPATCH] create failed: %s", exc)
        return None

    logger.info(
        "[JOB][CREATE] id=%s kind=research.deep user_id=%s query=%s",
        job.id, user_id or "anonymous", query[:80],
    )

    # 2) Subscribe to the job event bus + wait for the terminal frame.
    # Workers publish to Redis → fanout re-emits to the in-process
    # bus → our consume() picks it up. Timeout falls through to
    # inline.
    bus = get_bus()
    deadline_event = None
    try:
        import asyncio
        async def _wait_for_terminal():
            async for event in bus.consume(job.id, heartbeat_s=5.0):
                if event.kind in {"done", "error"}:
                    return event
                # Other kinds (status / progress / heartbeat) keep us
                # waiting but reset the heartbeat clock implicitly.
        deadline_event = await asyncio.wait_for(
            _wait_for_terminal(), timeout=_CELERY_WAIT_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        logger.warning(
            "[CELERY_DISPATCH] timeout waiting for job_id=%s — fall back inline",
            job.id,
        )
        return None
    except Exception as exc:                                  # pragma: no cover
        logger.warning("[CELERY_DISPATCH] bus consume raised: %s", exc)
        return None

    if deadline_event is None:                                # pragma: no cover
        return None

    # 3) Re-read the row to get the result + final status. The bus
    # event carries the result but the DB is authoritative.
    rec = None
    try:
        rec = jobs_client.get(job.id, user_id=user_id)
    except Exception:                                         # pragma: no cover
        pass

    if rec is None or rec.status not in {STATUS_SUCCEEDED}:
        if rec is not None and rec.status in {
            STATUS_FAILED, STATUS_FAILED_DLQ, STATUS_CANCELLED,
        }:
            # Job ran but failed — surface as inline-compatible
            # unavailable envelope.
            err_msg = (
                (rec.error or {}).get("message") if isinstance(rec.error, dict)
                else None
            ) or "research.deep failed"
            return {"status": "unavailable", "message": err_msg}
        return None

    result = rec.result or {}
    return {
        "status":   "available",
        "provider": result.get("provider") or "celery",
        "data": {
            "query":      result.get("query"),
            "answer":     result.get("answer"),
            "citations":  result.get("citations") or [],
            "count":      result.get("count") or 0,
            "cached":     bool(result.get("cached")),
            "elapsed_ms": int(result.get("elapsed_ms") or 0),
        },
    }


def _format_envelope_to_block(
    *,
    envelope:    dict,
    query:       str,
    triggers:    tuple[str, ...],
    owner_debug: bool,
) -> tuple[Optional[str], dict]:
    """Re-use the existing envelope-to-block formatter.

    Pulled out here so both the inline path (further down) and the
    Celery path (above) share one source of truth for the prompt
    block + raw_payload shape.
    """
    data = envelope.get("data") or {}
    citations = data.get("citations") or []
    answer    = (data.get("answer") or "").strip()
    provider  = envelope.get("provider") or "unknown"

    if not citations and not answer:
        return None, {
            "triggered": True,
            "fetched":   False,
            "query":     query,
            "triggers":  list(triggers),
            "error":     "no results returned",
        }

    block, raw = _envelope_to_chat_block(
        query=query, triggers=triggers,
        citations=citations, answer=answer, provider=provider,
        owner_debug=owner_debug,
    )
    return block, raw


async def build_web_search_context_block(
    *,
    user_id:        Optional[str],
    query:          str,
    triggers:       tuple[str, ...],
    panel_id:       Optional[str] = None,
    project_id:     Optional[str] = None,
    correlation_id: Optional[str] = None,
    owner_debug:    bool = False,
) -> tuple[Optional[str], dict]:
    """Invoke web_research and return `(block, raw_payload)`.

    `raw_payload` carries:
      { triggered: True, query, citations: [...], answer,
        provider, fetched: bool, error?: str }

    Returns `(None, {triggered: False, ...})` when:
      - web_research tool not enabled,
      - provider not configured (no TAVILY_API_KEY),
      - search returned no usable results.

    Phase 7 closure fix — when `WEB_RESEARCH_VIA_CELERY=true` AND the
    job queue is on, dispatch through `research.deep` job + await the
    bus instead of running the tool inline. Same return shape so the
    chat path doesn't change. Falls back to inline transparently when
    the queue is off, dispatch fails, or the wait times out — chat
    must never break because Celery is down.
    """
    if not query:
        return None, {"triggered": False, "reason": "empty query"}

    # ── Phase 7 closure — Celery dispatch path ───────────────────────────
    # [JOB][CHAT_ROUTE] diagnostic — surface the routing decision so
    # operators can confirm WEB_RESEARCH_VIA_CELERY is actually being
    # read at runtime. The trio of flags is dumped explicitly so a
    # "False" trace is self-explanatory.
    import os as _os
    _via_celery = _route_research_via_celery()
    logger.info(
        "[JOB][CHAT_ROUTE] uid=%s | via_celery=%s "
        "| WEB_RESEARCH_VIA_CELERY=%s | ENABLE_JOB_QUEUE=%s | JOB_QUEUE_RESEARCH=%s",
        user_id, _via_celery,
        _os.getenv("WEB_RESEARCH_VIA_CELERY", "false"),
        _os.getenv("ENABLE_JOB_QUEUE", "false"),
        _os.getenv("JOB_QUEUE_RESEARCH", "false"),
    )

    if _via_celery:
        envelope = await _run_research_via_celery(
            user_id=user_id, query=query,
            project_id=project_id, correlation_id=correlation_id,
        )
        if envelope is not None and envelope.get("status") == "available":
            return _format_envelope_to_block(
                envelope=envelope, query=query, triggers=triggers,
                owner_debug=owner_debug,
            )
        # Fall through to inline on Celery failure — chat must serve
        # the response even when the queue is offline.
        logger.info(
            "web_search.celery fallback to inline | uid=%s | reason=%s",
            user_id,
            (envelope or {}).get("message") or "no envelope",
        )

    try:
        from backend.services.tools.tool_registry import is_enabled, get_tool
        from backend.services.tool_executions import client as exec_client
    except Exception as e:
        logger.warning("web_search: import failed: %s", e)
        return None, {"triggered": False, "reason": f"import error: {e}"}

    if not is_enabled("web_research"):
        return None, {"triggered": False, "reason": "ENABLE_WEB_RESEARCH=false"}

    tool = get_tool("web_research")
    if tool is None:
        return None, {"triggered": False, "reason": "web_research tool not registered"}

    envelope: dict = {}
    # 1) Initial call, logged through the execution layer.
    with exec_client.record_run(
        user_id=        user_id or "anonymous",
        tool_id=        "web_research",
        input_summary=  f"search: {query[:120]}",
        input_payload=  {"query": query, "caller": "chat_auto",
                         "triggers": list(triggers)},
        caller=         "system",
        panel_id=       panel_id,
        project_id=     project_id,
        correlation_id= correlation_id,
    ) as run:
        try:
            from backend.services.tool_extraction._safe_run import safe_run_with_timeout
            envelope = await safe_run_with_timeout(
                tool, query, {
                    "query": query,
                    "max_results": _DEFAULT_MAX_RESULTS,
                    "depth": "basic",
                },
                # web_research can be slow on the "advanced" path —
                # extra grace beyond the tool's own timeout so we don't
                # truncate a real Tavily fetch.
                override_timeout=12.0,
            )
        except Exception as exc:
            run.failure("TOOL_RAISED", str(exc) or "web_research raised")
            envelope = {}
        status = (envelope or {}).get("status") or "error"
        provider = (envelope or {}).get("provider")
        if status == "available":
            run.success(output=envelope, provider=provider,
                        cost_estimate=float(getattr(tool, "cost_estimate", 0.0)))
        elif status == "unavailable":
            run.failure("TOOL_UNAVAILABLE",
                        (envelope or {}).get("message") or "unavailable",
                        provider=provider)
        else:
            run.failure("TOOL_ERROR",
                        (envelope or {}).get("message") or "error",
                        provider=provider)

    # 2) Single retry — same query, different depth — only when the
    #    first call failed with a transient-looking error.
    if envelope.get("status") not in ("available",):
        first_message = (envelope or {}).get("message") or ""
        is_transient = any(s in first_message.lower() for s in (
            "timeout", "timed out", "network", "connection", "temporarily",
        ))
        if is_transient:
            logger.info(
                "web_search.retry | uid=%s | reason=transient: %s",
                user_id, first_message[:120],
            )
            with exec_client.record_run(
                user_id=        user_id or "anonymous",
                tool_id=        "web_research",
                input_summary=  f"retry: {query[:120]}",
                input_payload=  {"query": query, "caller": "chat_auto_retry",
                                 "triggers": list(triggers)},
                caller=         "system",
                panel_id=       panel_id,
                project_id=     project_id,
                correlation_id= correlation_id,
            ) as run:
                try:
                    envelope = await safe_run_with_timeout(
                        tool, query, {
                            "query": query,
                            "max_results": _DEFAULT_MAX_RESULTS,
                            "depth": "advanced",
                        },
                        # Retries pay extra latency budget on a known
                        # slow path; still hard-capped so we can never
                        # hang the SSE stream.
                        override_timeout=15.0,
                    )
                except Exception as exc:
                    run.failure("TOOL_RAISED", str(exc) or "retry raised")
                    envelope = {}
                status = (envelope or {}).get("status") or "error"
                provider = (envelope or {}).get("provider")
                if status == "available":
                    run.success(output=envelope, provider=provider)
                elif status == "unavailable":
                    run.failure("TOOL_UNAVAILABLE",
                                (envelope or {}).get("message") or "unavailable",
                                provider=provider)
                else:
                    run.failure("TOOL_ERROR",
                                (envelope or {}).get("message") or "error",
                                provider=provider)

    if envelope.get("status") != "available":
        msg = envelope.get("message") or "web_research returned no data"
        return None, {
            "triggered": True,
            "fetched":   False,
            "query":     query,
            "triggers":  list(triggers),
            "error":     msg,
        }

    # Phase 7 closure — record a shadow job so the AdminPanel Jobs
    # tab shows the research request regardless of the routing flag.
    # We reach this point only on the INLINE path; the Celery path
    # early-returned with a real job already created. Extract the
    # citations + answer from the envelope to mirror what the
    # research.deep handler would persist.
    _inline_data = envelope.get("data") or {}
    _record_inline_research_job(
        user_id=        user_id,
        query=          query,
        triggers=       triggers,
        citations=      _inline_data.get("citations") or [],
        answer=         (_inline_data.get("answer") or ""),
        provider=       envelope.get("provider") or "unknown",
        project_id=     project_id,
        correlation_id= correlation_id,
    )

    return _format_envelope_to_block(
        envelope=envelope, query=query, triggers=triggers,
        owner_debug=owner_debug,
    )


def _envelope_to_chat_block(
    *,
    query:       str,
    triggers:    tuple[str, ...],
    citations:   list,
    answer:      str,
    provider:    str,
    owner_debug: bool,
) -> tuple[str, dict]:
    """Format a list of citations + answer into the assertive prompt
    block + raw_payload pair. Pulled out so both inline and Celery
    paths share one source of truth for the prompt shape."""
    header = (
        "═══════════════════════════════════════════════════════════════\n"
        "KORVIX WEB SEARCH RESULTS — REAL DATA FETCHED NOW — DO NOT REFUSE\n"
        "═══════════════════════════════════════════════════════════════\n"
        "I (KorvixAI) just ran a web search for the user's question. "
        "The results below were fetched seconds ago from real sources. "
        "I DO have access to current information — the search has "
        "already been done and the results are here.\n\n"
        "DO NOT say \"I cannot search the internet\" or \"İnternetten "
        "gerçek zamanlı bilgi arayamıyorum\" — the search has been "
        "performed.\n\n"
        "Use the citations below as my primary source. ALWAYS cite "
        "specific sources by name and URL. If the user asks in "
        "Turkish, reply in Turkish but keep source URLs intact."
    )

    parts: list[str] = [header, ""]
    parts.append(f"Query: {query}")
    parts.append(f"Provider: {provider}")
    if answer:
        parts.append(f"\nSynthesised answer:\n{answer[:2000]}")
    parts.append(f"\nCitations ({len(citations)}):")
    char_budget = _TOTAL_CHAR_CAP - sum(len(p) for p in parts)

    for i, c in enumerate(citations[:_DEFAULT_MAX_RESULTS]):
        if not isinstance(c, dict):
            continue
        title   = (c.get("title") or "").strip()[:200]
        url     = (c.get("url") or "").strip()[:300]
        snippet = (c.get("snippet") or c.get("content") or "").strip()
        date    = (c.get("published_date") or c.get("date") or "")
        if not (title or url):
            continue
        # Per-citation budget — ~2 KB each.
        if len(snippet) > 1500:
            snippet = snippet[:1500] + "…"
        line = (
            f"\n  [{i + 1}] {title}\n"
            f"      url: {url}\n"
            f"      date: {date}\n"
            f"      excerpt: {snippet}"
        )
        if len(line) > char_budget:
            parts.append("\n  [...remaining citations truncated by context budget]")
            break
        parts.append(line)
        char_budget -= len(line)

    block = "\n".join(parts)

    raw_payload = {
        "triggered": True,
        "fetched":   True,
        "query":     query,
        "triggers":  list(triggers),
        "provider":  provider,
        "answer":    answer if owner_debug else (answer[:200] + ("…" if len(answer) > 200 else "")),
        "citations": (
            citations if owner_debug
            else [{"title": c.get("title"), "url": c.get("url"),
                   "date":  c.get("published_date") or c.get("date")}
                  for c in citations if isinstance(c, dict)]
        ),
        "count": len(citations),
    }

    logger.info(
        "web_search.build | query=%s | citations=%d | "
        "provider=%s | block_chars=%d",
        query[:80], len(citations), provider, len(block),
    )
    return block, raw_payload


__all__ = [
    "WebSearchIntent",
    "detect_web_search_intent",
    "build_web_search_context_block",
]
