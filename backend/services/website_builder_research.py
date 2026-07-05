# coding: utf-8
# Web Build research pre-pass.
#
# For a FRESH website build, before the final website_builder generation call,
# run a REAL, DEEP, MULTI-ANGLE web-research pass so the design strategy is
# grounded in current, live sources instead of the model's static priors. This
# reuses the existing, credit-counted, provider-cascading web_research path
# (build_web_search_context_block → Tavily/Exa/Brave cascade) — no new provider
# client code, no direct coupling to one vendor.
#
# Depth (all env-configurable, sane defaults):
#   WEB_BUILD_RESEARCH_MAX_QUERIES     (default 8)  — multi-angle queries
#   WEB_BUILD_RESEARCH_MAX_RAW_RESULTS (default 24) — raw citations collected
#   WEB_BUILD_RESEARCH_MAX_SOURCES     (default 14) — best sources kept for synthesis
#   WEB_BUILD_RESEARCH_TIMEOUT_SEC     (default 25) — hard wall-clock cap
# The UI only ever SHOWS a small capped set; synthesis uses the deeper set.
#
# Observability contract — research must NEVER silently fail. Every call returns
# a rich `meta` (status / provider / attempted / counts / angles / fallback
# reason) so the frontend + owner debug can distinguish ran / disabled / failed /
# no-sources.
#
# Honesty contract:
#   - did_research=True + sources ONLY when a real tool returned real http URLs.
#   - Never fabricate sources, URLs, providers, or "researched" claims.
#   - Never log API keys or secrets — only provider names, booleans, counts,
#     and error type/messages.
#
# Every query is DERIVED DYNAMICALLY from the user's idea (no per-niche
# templates, no example-prompt special cases).
import asyncio
import logging
import os
import re
from typing import Optional
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

# Status values surfaced in meta["status"].
STATUS_USED = "used_sources"
STATUS_DISABLED = "disabled"
STATUS_FAILED = "failed"
STATUS_NO_SOURCES = "no_sources"


# ── Env-configurable depth budget ────────────────────────────────────────────
def _int_env(key: str, default: int, lo: int, hi: int) -> int:
    try:
        v = int(str(os.getenv(key, "")).strip())
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def _float_env(key: str, default: float, lo: float, hi: float) -> float:
    try:
        v = float(str(os.getenv(key, "")).strip())
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, v))


def _budget() -> dict:
    """Resolve the depth budget dynamically so a Railway flip is live next build."""
    return {
        "max_queries": _int_env("WEB_BUILD_RESEARCH_MAX_QUERIES", 8, 1, 12),
        "max_raw":     _int_env("WEB_BUILD_RESEARCH_MAX_RAW_RESULTS", 24, 4, 60),
        "max_sources": _int_env("WEB_BUILD_RESEARCH_MAX_SOURCES", 14, 3, 30),
        "timeout":     _float_env("WEB_BUILD_RESEARCH_TIMEOUT_SEC", 25.0, 6.0, 90.0),
        # How many real sources the UI shows (synthesis still uses the full set).
        "ui_sources":  _int_env("WEB_BUILD_RESEARCH_UI_SOURCES", 8, 3, 16),
        # At most this many sources from one domain — forces diversity.
        "per_domain":  _int_env("WEB_BUILD_RESEARCH_PER_DOMAIN", 2, 1, 4),
    }


def _meta(
    *,
    status: str,
    did_research: bool = False,
    queries: Optional[list] = None,
    angles: Optional[list] = None,
    provider: Optional[str] = None,
    attempted: Optional[list] = None,
    sources: Optional[list] = None,
    selected_count: int = 0,
    fallback_reason: Optional[str] = None,
) -> dict:
    """Build the canonical research meta dict. Every field always present."""
    srcs = sources or []
    return {
        "did_research":         bool(did_research),
        "status":               status,
        "provider":             provider,
        "attempted_providers":  list(attempted or []),
        "queries":              list(queries or []),
        "query_count":          len(queries or []),
        "angles":               list(angles or []),
        "sources":              srcs,
        # source_count reflects the REAL usable sources selected for synthesis,
        # which may be larger than the capped UI list.
        "source_count":         selected_count or len(srcs),
        "fallback_reason":      fallback_reason,
    }


def _extract_idea(message: str) -> str:
    """Pull the raw idea out of the [WEB BUILD REQUEST] wrapper. Never raises."""
    if not message:
        return ""
    text = message
    m = re.search(r"(?im)^\s*Idea:\s*(.+)\s*$", text)
    if m:
        return m.group(1).strip()[:240]
    lines = [
        ln.strip() for ln in text.splitlines()
        if ln.strip()
        and not ln.strip().startswith(("[", "#", "-", "STEP", "BUILD CONTEXT", "RESEARCH", "MOTION", "COPY"))
    ]
    if lines:
        return max(lines, key=len)[:240]
    return text.strip()[:240]


# ── Multi-angle query generation (dynamic; no example-prompt cases) ──────────
# Each angle is a neutral research DIMENSION applied to the user's own idea, so
# any website concept gets category + audience + conversion + competitor +
# design + trust + model + atmosphere + structure coverage.
_ANGLES: list[tuple[str, str]] = [
    ("category",     "{core}"),
    ("audience",     "{core} target audience needs and expectations"),
    ("conversion",   "{core} landing page conversion best practices"),
    ("competitors",  "{core} competitors and product examples"),
    ("design",       "{core} website design inspiration"),
    ("trust",        "{core} trust signals customers look for"),
    ("model",        "{core} pricing membership booking or signup model"),
    ("atmosphere",   "{core} brand visual style and mood"),
    ("structure",    "{core} website sections and page structure"),
    ("content",      "{core} content and messaging examples"),
]


def _build_queries(idea: str, max_queries: int) -> list[tuple[str, str]]:
    """Return [(angle, query)] — the idea itself plus neutral research dimensions.
    Long ideas get fewer expansions (they're already specific)."""
    core = (idea or "").strip()
    if not core:
        return []
    # Very long prompts are already specific — lean on fewer, broader angles.
    angles = _ANGLES if len(core) <= 90 else _ANGLES[:5]
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for angle, tmpl in angles:
        q = tmpl.format(core=core).strip()
        k = q.lower()
        if k and k not in seen:
            seen.add(k)
            out.append((angle, q))
        if len(out) >= max_queries:
            break
    return out


def _domain(url: str) -> str:
    try:
        host = urlparse(url).netloc.lower()
        return host[4:] if host.startswith("www.") else host
    except Exception:  # noqa: BLE001
        return ""


def _norm_citation(c, angle: str) -> Optional[dict]:
    """Normalize a provider citation to {title,url,snippet,domain,angle}. Drop
    entries without a real http(s) URL so we never surface a fake/empty source."""
    if not isinstance(c, dict):
        return None
    url = (c.get("url") or "").strip()
    if not re.match(r"^https?://", url, re.I):
        return None
    title = (c.get("title") or c.get("name") or url).strip()
    snippet = (c.get("snippet") or c.get("content") or c.get("answer") or "").strip()
    return {
        "title": title[:160],
        "url": url,
        "snippet": snippet[:280],
        "domain": _domain(url),
        "angle": angle,
    }


_TOKEN_RE = re.compile(r"[a-z0-9]{3,}", re.I)
# Signal vocab — a source that speaks the product/conversion/design language is
# more useful than a generic result. Kept neutral (no niche words).
_SIGNAL_WORDS = (
    "pricing", "plan", "signup", "sign up", "book", "reserve", "trial", "demo",
    "feature", "benefit", "customer", "review", "testimonial", "trust", "secure",
    "design", "layout", "hero", "landing", "ux", "typography", "palette", "brand",
    "conversion", "cta", "audience", "example", "template", "inspiration",
)


def _tokens(s: str) -> set:
    return set(t.lower() for t in _TOKEN_RE.findall(s or ""))


def _title_sim(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    return inter / float(len(a | b))


def _score(src: dict, idea_tokens: set) -> float:
    """Usefulness score: relevance to the idea + specificity + product/design
    signal language. Diversity is handled separately in selection."""
    txt = f"{src.get('title','')} {src.get('snippet','')}"
    toks = _tokens(txt)
    relevance = len(toks & idea_tokens)
    specificity = min(len(src.get("snippet") or ""), 240) / 240.0
    low = txt.lower()
    signal = sum(1 for w in _SIGNAL_WORDS if w in low)
    return relevance * 2.0 + signal * 1.2 + specificity


def _dedupe_and_rank(cands: list[dict], idea_tokens: set, *, max_sources: int, per_domain: int) -> list[dict]:
    """Deduplicate by URL + near-duplicate title, cap per domain for diversity,
    then keep the best `max_sources` by score while spreading across angles."""
    # 1) Exact URL dedupe.
    by_url: dict = {}
    for c in cands:
        by_url.setdefault(c["url"], c)
    uniq = list(by_url.values())

    # 2) Near-duplicate title dedupe (keep the higher-scored one).
    scored = sorted(uniq, key=lambda c: _score(c, idea_tokens), reverse=True)
    kept: list[dict] = []
    kept_tok: list[set] = []
    for c in scored:
        tk = _tokens(c["title"])
        if any(_title_sim(tk, kt) >= 0.8 for kt in kept_tok):
            continue
        kept.append(c)
        kept_tok.append(tk)

    # 3) Domain cap + angle spread — prefer a diverse set over 10 near-identical.
    domain_count: dict = {}
    angle_seen: set = set()
    primary: list[dict] = []
    overflow: list[dict] = []
    for c in kept:  # already score-desc
        d = c.get("domain") or ""
        if domain_count.get(d, 0) >= per_domain:
            continue
        # First pass prefers one-per-new-angle for maximum diversity.
        if c.get("angle") not in angle_seen:
            angle_seen.add(c["angle"])
            domain_count[d] = domain_count.get(d, 0) + 1
            primary.append(c)
        else:
            overflow.append(c)
        if len(primary) >= max_sources:
            break
    # Fill any remaining budget from the score-ranked overflow.
    for c in overflow:
        if len(primary) >= max_sources:
            break
        d = c.get("domain") or ""
        if domain_count.get(d, 0) >= per_domain:
            continue
        domain_count[d] = domain_count.get(d, 0) + 1
        primary.append(c)
    return primary


def _preflight() -> tuple[bool, Optional[str], list[str], bool]:
    """Inspect env + config WITHOUT calling a provider. Returns
    (enabled, disabled_reason, attempted_providers, via_celery)."""
    try:
        from backend.services.tools.tool_registry import _flag, is_enabled
    except Exception as e:  # noqa: BLE001
        return False, f"tool registry import failed: {e}", [], False

    if not _flag("ENABLE_TOOLS"):
        return False, "ENABLE_TOOLS is off", [], False
    if not _flag("ENABLE_WEB_RESEARCH"):
        return False, "ENABLE_WEB_RESEARCH is off", [], False
    if not is_enabled("web_research"):
        return False, "web_research tool is not enabled", [], False

    try:
        from backend.services.research.client import active_provider, active_fallbacks
        primary = active_provider()
        fallbacks = active_fallbacks()
    except Exception as e:  # noqa: BLE001
        return False, f"research client import failed: {e}", [], False

    chain = ([primary] if primary else []) + list(fallbacks)
    if not primary:
        return False, "WEB_RESEARCH_PROVIDER is not set", chain, False

    try:
        from backend.services.tool_extraction.web_search_intent import _route_research_via_celery
        via_celery = bool(_route_research_via_celery())
    except Exception:  # noqa: BLE001
        via_celery = False

    return True, None, chain, via_celery


async def run_web_build_research(*, user_id: Optional[str], idea: str) -> tuple[Optional[str], dict]:
    """Run the DEEP research pre-pass. Returns (context_block, meta).

    `context_block` is a system-prompt Build Intelligence block of REAL sources
    to inject, or None. `meta` is the canonical research dict — ALWAYS populated.
    Never raises — on any failure returns (None, <meta with status/reason>).
    """
    budget = _budget()
    idea_text = _extract_idea(idea)
    angle_queries = _build_queries(idea_text, budget["max_queries"])
    queries = [q for _, q in angle_queries]
    if not queries:
        logger.info("web_build_research | uid=%s | no idea text to research", user_id)
        return None, _meta(status=STATUS_NO_SOURCES, fallback_reason="no idea text to research")

    enabled, disabled_reason, attempted, via_celery = _preflight()
    logger.info(
        "web_build_research | uid=%s | enabled=%s | via_celery=%s | attempted=%s "
        "| queries=%d | budget=%s | reason=%s",
        user_id, enabled, via_celery, attempted, len(queries),
        {k: budget[k] for k in ("max_raw", "max_sources", "timeout")},
        disabled_reason or "-",
    )
    if not enabled:
        return None, _meta(
            status=STATUS_DISABLED, queries=queries,
            angles=[a for a, _ in angle_queries], attempted=attempted,
            fallback_reason=disabled_reason or "web research disabled",
        )

    try:
        from backend.services.tool_extraction import build_web_search_context_block
    except Exception as e:  # noqa: BLE001
        logger.warning("web_build_research | uid=%s | import failed: %s", user_id, e)
        return None, _meta(
            status=STATUS_FAILED, queries=queries, angles=[a for a, _ in angle_queries],
            attempted=attempted, fallback_reason=f"search import failed: {type(e).__name__}",
        )

    async def _one(angle: str, q: str) -> dict:
        try:
            _block, payload = await build_web_search_context_block(
                user_id=user_id, query=q, triggers=("website_builder_research",),
            )
            p = payload or {}
            p["_angle"] = angle
            return p
        except Exception as ex:  # noqa: BLE001 — research must never break a build
            logger.info("web_build_research | uid=%s | query failed (%s): %s", user_id, q[:50], ex)
            return {"error": f"{type(ex).__name__}: {ex}", "_angle": angle}

    # Run all angle queries concurrently, but cap wall-clock — preserve whatever
    # finished within the timeout rather than losing everything on a slow tail.
    tasks = [asyncio.ensure_future(_one(a, q)) for a, q in angle_queries]
    results: list = []
    try:
        done, pending = await asyncio.wait(tasks, timeout=budget["timeout"])
        for t in done:
            try:
                results.append(t.result())
            except Exception:  # noqa: BLE001
                pass
        for t in pending:
            t.cancel()
        if pending:
            logger.info("web_build_research | uid=%s | %d queries timed out (kept %d)",
                        user_id, len(pending), len(done))
    except Exception as ex:  # noqa: BLE001
        for t in tasks:
            t.cancel()
        logger.warning("web_build_research | uid=%s | gather failed: %s", user_id, ex)

    # Collect raw citations (capped), remember provider + failures.
    cands: list[dict] = []
    answered_provider: Optional[str] = None
    errors: list[str] = []
    for r in results:
        if not isinstance(r, dict):
            continue
        angle = r.get("_angle") or "category"
        if r.get("provider") and not answered_provider:
            answered_provider = str(r.get("provider"))
        err = r.get("error") or r.get("reason")
        if err:
            errors.append(str(err)[:120])
        for c in (r.get("citations") or []):
            nc = _norm_citation(c, angle)
            if nc:
                cands.append(nc)
            if len(cands) >= budget["max_raw"]:
                break
        if len(cands) >= budget["max_raw"]:
            break

    if not cands:
        reason = errors[0] if errors else "providers returned no usable sources"
        status = STATUS_FAILED if errors else STATUS_NO_SOURCES
        logger.info("web_build_research | uid=%s | did_research=false | status=%s | reason=%s",
                    user_id, status, reason)
        return None, _meta(
            status=status, queries=queries, angles=[a for a, _ in angle_queries],
            provider=answered_provider, attempted=attempted, fallback_reason=reason,
        )

    idea_tokens = _tokens(idea_text)
    selected = _dedupe_and_rank(
        cands, idea_tokens,
        max_sources=budget["max_sources"], per_domain=budget["per_domain"],
    )
    angles_covered = sorted({s["angle"] for s in selected})

    # Build the injection block — a structured BUILD INTELLIGENCE brief the final
    # generation must USE, grounded in the FULL selected set (deeper than UI).
    lines = [
        "[BUILD INTELLIGENCE — GROUNDED IN DEEP MULTI-ANGLE WEB RESEARCH]",
        f"I ran REAL web research across {len(queries)} angles "
        f"({', '.join(angles_covered)}) and selected {len(selected)} diverse, deduped",
        "sources. SYNTHESIZE them into a structured Build Intelligence brief FIRST,",
        "then let it drive EVERY decision — research must visibly shape the product,",
        "not decorate it.",
        "",
        "Derive and USE these fields (skip any that don't apply; never invent facts):",
        "  • sourceBackedInsights  • usefulPatterns  • categoryLanguage",
        "  • audienceExpectations  • conversionPatterns  • trustSignals",
        "  • visualAtmosphere  • designReferences  • differentiationOpportunities",
        "  • contentAngles  • risksToAvoid  • componentPlan  • sectionPlan",
        "",
        "Then BUILD so that: sections come from sectionPlan + conversionPatterns;",
        "visuals from visualAtmosphere + designReferences; copy uses categoryLanguage",
        "+ audienceExpectations; the CTA reflects conversionPatterns; trust blocks",
        "reflect trustSignals; components/files reflect componentPlan. Do NOT default",
        "to a centered hero + generic cards unless the strategy explicitly supports it.",
        "Rules: dedupe overlapping findings; prefer diverse useful patterns over",
        "generic facts; never copy source wording or layouts; cite a URL in Build Plan",
        "ONLY if it appears below.",
        "",
        "Real sources:",
    ]
    for i, s in enumerate(selected, 1):
        lines.append(f"{i}. [{s['angle']}] {s['title']} — {s['url']}")
        if s["snippet"]:
            lines.append(f"   {s['snippet']}")
    lines.append("")
    lines.append("Fold the synthesis into 'Research insight' in Build Plan, and let it shape")
    lines.append("the sections, copy, CTA hierarchy, trust signals, visual system and motion.")

    # UI gets a capped, clean subset (real URLs only); synthesis used the full set.
    ui_sources = [
        {"title": s["title"], "url": s["url"], "snippet": s["snippet"]}
        for s in selected[: budget["ui_sources"]]
    ]
    logger.info(
        "web_build_research | uid=%s | did_research=true | provider=%s | raw=%d | "
        "selected=%d | angles=%s",
        user_id, answered_provider or "-", len(cands), len(selected), angles_covered,
    )
    return "\n".join(lines), _meta(
        status=STATUS_USED, did_research=True, queries=queries,
        angles=angles_covered, provider=answered_provider, attempted=attempted,
        sources=ui_sources, selected_count=len(selected),
    )
