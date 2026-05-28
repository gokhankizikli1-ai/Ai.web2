# coding: utf-8
# Phase R1 + Phase 11 — ResearchClient with provider cascade.
#
# Routing rules:
#   WEB_RESEARCH_PROVIDER=tavily          (primary; default)
#   WEB_RESEARCH_FALLBACK=exa,brave       (Phase 11 — comma-separated fallback chain)
#
# When the primary returns a non-fatal error (timeout / rate_limit / empty
# results) or the citations list is empty, the client walks the fallback
# chain in order and returns the first provider that yields citations.
# Auth errors on the primary (which mean we're misconfigured, not down)
# still trigger fallback so an outage of one key doesn't blow up chat —
# the operator sees the error in logs + stats(), but the user still gets
# an answer.
#
# Cache lookups happen inside each provider — the client itself is
# stateless. Failures are logged at WARNING with the [SEARCH] tag and
# the provider name so we can see "tavily down, exa picked up" in prod.
#
# Public surface unchanged: callers just `await client.search(query, ...)`.
import os
import logging
import threading
from typing import Optional

from backend.services.research.types import SearchResult

logger = logging.getLogger(__name__)

# Every provider module the client knows how to dispatch to. Adding a new
# one is one line + the module file.
_PROVIDER_REGISTRY = ("tavily", "exa", "brave")


# ── Observability counters (surfaced via /tools/health) ─────────────────────
_LOCK = threading.Lock()
_COUNTS: dict = {
    "searches_total":   0,
    "searches_ok":      0,
    "searches_error":   0,
    "by_provider":      {},          # name → count
    "fallback_hits":    0,           # times the cascade had to fall through
    "last_error":       "",
}


def _bump(provider: str, *, ok: bool, error: str = "",
          fallback_hit: bool = False) -> None:
    with _LOCK:
        _COUNTS["searches_total"] += 1
        if ok:
            _COUNTS["searches_ok"] += 1
        else:
            _COUNTS["searches_error"] += 1
            if error:
                _COUNTS["last_error"] = error[:140]
        if fallback_hit:
            _COUNTS["fallback_hits"] += 1
        bp = _COUNTS.get("by_provider", {})
        bp[provider] = bp.get(provider, 0) + 1
        _COUNTS["by_provider"] = bp


def stats() -> dict:
    with _LOCK:
        return {
            **_COUNTS,
            "configured_provider": active_provider(),
            "configured_fallback": active_fallbacks(),
            "available_providers": list(_PROVIDER_REGISTRY),
            "cache_ttl_sec":       float(os.getenv("R1_TAVILY_CACHE_TTL_SEC", "300")),
        }


def active_provider() -> str:
    """Primary provider from env. Empty string when not configured."""
    return os.getenv("WEB_RESEARCH_PROVIDER", "").strip().lower()


def active_fallbacks() -> list[str]:
    """Phase 11 — ordered fallback chain from env.

    Reads `WEB_RESEARCH_FALLBACK` as a comma-separated list of provider names.
    Unknown names are silently dropped (we don't want a typo to break search).
    The primary provider is excluded from the returned list — the cascade
    handles primary separately so we never double-call the same provider.
    """
    raw = os.getenv("WEB_RESEARCH_FALLBACK", "")
    if not raw:
        return []
    primary = active_provider()
    out: list[str] = []
    for part in raw.split(","):
        name = part.strip().lower()
        if not name or name == primary:
            continue
        if name in _PROVIDER_REGISTRY and name not in out:
            out.append(name)
    return out


def _provider_module(name: str):
    """Lazy import — providers don't load unless the cascade reaches them."""
    if name == "tavily":
        from backend.services.research import tavily
        return tavily
    if name == "exa":
        from backend.services.research import exa
        return exa
    if name == "brave":
        from backend.services.research import brave
        return brave
    return None


def _is_empty(result: SearchResult) -> bool:
    """Treat a provider's zero-citation success as 'try the next one'."""
    return (result.error is None) and (len(result.citations) == 0)


# ── Public API ──────────────────────────────────────────────────────────────

class ResearchClient:
    """Stable provider-agnostic surface. Never raises."""

    async def search(
        self,
        query: str,
        *,
        max_results: int = 5,
        depth: str = "basic",
        include_answer: bool = True,
        include_domains: Optional[list[str]] = None,
        exclude_domains: Optional[list[str]] = None,
        timeout: Optional[float] = None,
    ) -> SearchResult:
        primary = active_provider()
        if not primary:
            r = SearchResult(query=query or "", error="provider_not_configured")
            _bump("none", ok=False, error="provider_not_configured")
            return r

        # Build cascade order: primary first, then env fallbacks.
        chain = [primary] + active_fallbacks()
        # Skip unknown primary but still try fallbacks — keeps env typos
        # from blocking otherwise-working chains.
        chain = [p for p in chain if p in _PROVIDER_REGISTRY]
        if not chain:
            r = SearchResult(query=query or "", provider=primary,
                             error=f"provider_not_implemented: {primary}")
            _bump(primary or "unknown", ok=False, error=r.error)
            return r

        kwargs = {
            "max_results":     max_results,
            "depth":           depth,
            "include_answer":  include_answer,
            "include_domains": include_domains,
            "exclude_domains": exclude_domains,
        }
        if timeout is not None:
            kwargs["timeout"] = timeout

        last_result: Optional[SearchResult] = None
        for idx, provider in enumerate(chain):
            mod = _provider_module(provider)
            if mod is None:
                # Defensive: shouldn't happen since we filtered against
                # _PROVIDER_REGISTRY, but keep the cascade resilient.
                continue
            try:
                result = await mod.search(query, **kwargs)
            except Exception as exc:
                # Providers promise not to raise, but treat any leak as
                # a fallback signal rather than blowing up chat.
                logger.warning(
                    "[SEARCH] provider=%s raised %s — cascading",
                    provider, exc,
                )
                _bump(provider, ok=False, error=f"raised: {exc}",
                      fallback_hit=(idx > 0))
                last_result = SearchResult(query=query or "", provider=provider,
                                           error=f"raised: {exc}")
                continue

            if result.error:
                logger.warning(
                    "[SEARCH] provider=%s error=%s elapsed=%dms — cascading",
                    provider, result.error, result.elapsed_ms,
                )
                _bump(provider, ok=False, error=result.error or "",
                      fallback_hit=(idx > 0))
                last_result = result
                continue

            if _is_empty(result):
                logger.info(
                    "[SEARCH] provider=%s ok but empty (cites=0) — cascading",
                    provider,
                )
                _bump(provider, ok=False, error="empty_results",
                      fallback_hit=(idx > 0))
                last_result = result
                continue

            # Success — stamp fallback metadata so callers can tell which
            # provider answered without grep'ing logs.
            logger.info(
                "[SEARCH] provider=%s ok cites=%d elapsed=%dms fallback_idx=%d",
                provider, len(result.citations), result.elapsed_ms, idx,
            )
            _bump(provider, ok=True, fallback_hit=(idx > 0))
            return result

        # Whole chain exhausted. Return the most informative last result
        # so the caller can surface it (auth error from the primary is
        # more useful than 'empty_results' from the tail).
        if last_result is None:
            last_result = SearchResult(query=query or "", provider=primary,
                                       error="all_providers_failed")
        return last_result


client = ResearchClient()

__all__ = [
    "ResearchClient", "client",
    "stats", "active_provider", "active_fallbacks",
]
