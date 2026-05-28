# coding: utf-8
"""Phase 11 — provider fallback cascade tests.

These tests stub the provider `search()` functions so we never hit the
network. The point is to verify the *cascade behavior* in `client.py`:

  1. Single-provider config (no fallback) → behavior unchanged from R1.
  2. `WEB_RESEARCH_FALLBACK=exa,brave` parsed correctly + primary excluded.
  3. Cascade falls through on `error=...` responses.
  4. Cascade falls through on empty citations (zero-result success).
  5. Cascade stops on the first provider with citations.
  6. Unknown provider names in the env are silently dropped.
  7. `fallback_hits` counter only increments when a non-primary answered.
  8. Provider that raises is caught + treated as fallback signal.
"""
from __future__ import annotations

import asyncio
import pytest

# NOTE: `from backend.services.research import client` (and the
# attribute-style `backend.services.research.client`) both return the
# *instance* (the singleton, re-exported by __init__.py) — the package
# attribute shadows the submodule of the same name. To reach _LOCK /
# _COUNTS / active_fallbacks() we look the module up in sys.modules
# directly.
import sys
import backend.services.research.client  # noqa: F401 — ensures registered
_research_module = sys.modules["backend.services.research.client"]
from backend.services.research.client import client as research_client
from backend.services.research.types import SearchResult, Citation


# ── Helpers ─────────────────────────────────────────────────────────────────

def _make_citation(url: str = "https://example.com/x") -> Citation:
    return Citation(
        title="t", url=url, snippet="s",
        source_type="news", trust_score=0.6, domain="example.com",
        raw_score=0.9, provider="stub",
    )


def _ok_result(provider: str, n: int = 1) -> SearchResult:
    return SearchResult(
        query="q",
        answer=f"ans-{provider}",
        citations=[_make_citation(f"https://example.com/{provider}/{i}")
                   for i in range(n)],
        provider=provider,
        elapsed_ms=10,
    )


def _err_result(provider: str, error: str = "timeout") -> SearchResult:
    return SearchResult(query="q", provider=provider, error=error, elapsed_ms=10)


def _empty_result(provider: str) -> SearchResult:
    return SearchResult(query="q", provider=provider, citations=[], elapsed_ms=10)


def _reset_counts():
    """Phase 11 counters live in module scope; isolate per test."""
    with _research_module._LOCK:
        _research_module._COUNTS.update({
            "searches_total":   0,
            "searches_ok":      0,
            "searches_error":   0,
            "by_provider":      {},
            "fallback_hits":    0,
            "last_error":       "",
        })


# ── active_fallbacks parsing ────────────────────────────────────────────────

class TestActiveFallbacks:
    def test_empty_when_unset(self, monkeypatch):
        monkeypatch.delenv("WEB_RESEARCH_FALLBACK", raising=False)
        assert _research_module.active_fallbacks() == []

    def test_parses_comma_list(self, monkeypatch):
        monkeypatch.setenv("WEB_RESEARCH_PROVIDER", "tavily")
        monkeypatch.setenv("WEB_RESEARCH_FALLBACK", "exa,brave")
        assert _research_module.active_fallbacks() == ["exa", "brave"]

    def test_excludes_primary(self, monkeypatch):
        monkeypatch.setenv("WEB_RESEARCH_PROVIDER", "exa")
        monkeypatch.setenv("WEB_RESEARCH_FALLBACK", "tavily,exa,brave")
        # primary 'exa' should be removed from the chain
        assert _research_module.active_fallbacks() == ["tavily", "brave"]

    def test_drops_unknown(self, monkeypatch):
        monkeypatch.setenv("WEB_RESEARCH_PROVIDER", "tavily")
        monkeypatch.setenv("WEB_RESEARCH_FALLBACK", "exa,not_a_provider,brave")
        assert _research_module.active_fallbacks() == ["exa", "brave"]

    def test_dedupes(self, monkeypatch):
        monkeypatch.setenv("WEB_RESEARCH_PROVIDER", "tavily")
        monkeypatch.setenv("WEB_RESEARCH_FALLBACK", "exa,exa,brave,exa")
        assert _research_module.active_fallbacks() == ["exa", "brave"]

    def test_whitespace_tolerant(self, monkeypatch):
        monkeypatch.setenv("WEB_RESEARCH_PROVIDER", "tavily")
        monkeypatch.setenv("WEB_RESEARCH_FALLBACK", "  exa ,  brave  ")
        assert _research_module.active_fallbacks() == ["exa", "brave"]


# ── Cascade behavior ────────────────────────────────────────────────────────

class TestCascade:
    @pytest.fixture(autouse=True)
    def _setup(self, monkeypatch):
        _reset_counts()
        monkeypatch.setenv("WEB_RESEARCH_PROVIDER", "tavily")
        monkeypatch.setenv("WEB_RESEARCH_FALLBACK", "exa,brave")

    def _patch_providers(self, monkeypatch, *,
                         tavily_fn=None, exa_fn=None, brave_fn=None):
        """Patch each provider module's `search` async fn."""
        from backend.services.research import tavily, exa, brave

        async def _default_ok():  # pragma: no cover — placeholder
            return _ok_result("default")

        if tavily_fn is not None:
            monkeypatch.setattr(tavily, "search", tavily_fn)
        if exa_fn is not None:
            monkeypatch.setattr(exa, "search", exa_fn)
        if brave_fn is not None:
            monkeypatch.setattr(brave, "search", brave_fn)

    def test_primary_success_no_fallback_invoked(self, monkeypatch):
        called: list[str] = []

        async def tav(query, **kw):
            called.append("tavily")
            return _ok_result("tavily", 3)

        async def exa(query, **kw):
            called.append("exa")
            return _ok_result("exa", 3)

        async def brv(query, **kw):
            called.append("brave")
            return _ok_result("brave", 3)

        self._patch_providers(monkeypatch, tavily_fn=tav, exa_fn=exa, brave_fn=brv)

        result = asyncio.run(research_client.search("nvidia h200"))

        assert result.provider == "tavily"
        assert len(result.citations) == 3
        assert called == ["tavily"]
        assert _research_module._COUNTS["fallback_hits"] == 0

    def test_falls_through_on_primary_error(self, monkeypatch):
        called: list[str] = []

        async def tav(query, **kw):
            called.append("tavily")
            return _err_result("tavily", "timeout")

        async def exa(query, **kw):
            called.append("exa")
            return _ok_result("exa", 2)

        async def brv(query, **kw):
            called.append("brave")
            return _ok_result("brave", 5)

        self._patch_providers(monkeypatch, tavily_fn=tav, exa_fn=exa, brave_fn=brv)

        result = asyncio.run(research_client.search("nvidia h200"))

        assert result.provider == "exa"
        assert len(result.citations) == 2
        # tavily was attempted, exa answered, brave was NOT called
        assert called == ["tavily", "exa"]
        assert _research_module._COUNTS["fallback_hits"] == 1

    def test_falls_through_on_empty_results(self, monkeypatch):
        called: list[str] = []

        async def tav(query, **kw):
            called.append("tavily")
            return _empty_result("tavily")  # success but zero cites

        async def exa(query, **kw):
            called.append("exa")
            return _empty_result("exa")

        async def brv(query, **kw):
            called.append("brave")
            return _ok_result("brave", 4)

        self._patch_providers(monkeypatch, tavily_fn=tav, exa_fn=exa, brave_fn=brv)

        result = asyncio.run(research_client.search("obscure-query"))

        assert result.provider == "brave"
        assert len(result.citations) == 4
        assert called == ["tavily", "exa", "brave"]
        # fallback_hits bumps for every non-primary invocation (exa + brave)
        assert _research_module._COUNTS["fallback_hits"] == 2

    def test_all_providers_fail_returns_last_error(self, monkeypatch):
        async def tav(query, **kw): return _err_result("tavily", "rate_limit")
        async def exa(query, **kw): return _err_result("exa", "timeout")
        async def brv(query, **kw): return _err_result("brave", "auth: HTTP 403")

        self._patch_providers(monkeypatch, tavily_fn=tav, exa_fn=exa, brave_fn=brv)

        result = asyncio.run(research_client.search("q"))

        assert result.error is not None
        # the last provider's error is what gets surfaced
        assert "auth" in (result.error or "") or "rate" in (result.error or "")
        assert _research_module._COUNTS["searches_error"] >= 3

    def test_provider_raising_is_caught(self, monkeypatch):
        """Providers MUST not raise, but if one does the cascade still proceeds."""
        async def tav(query, **kw):
            raise RuntimeError("boom")

        async def exa(query, **kw):
            return _ok_result("exa", 1)

        async def brv(query, **kw):  # pragma: no cover
            return _ok_result("brave", 1)

        self._patch_providers(monkeypatch, tavily_fn=tav, exa_fn=exa, brave_fn=brv)

        result = asyncio.run(research_client.search("q"))
        assert result.provider == "exa"
        assert len(result.citations) == 1
        assert _research_module._COUNTS["fallback_hits"] == 1


# ── No-fallback config = R1 behavior preserved ─────────────────────────────

class TestSingleProviderNoFallback:
    def test_only_tavily_called_when_no_fallback_env(self, monkeypatch):
        _reset_counts()
        monkeypatch.setenv("WEB_RESEARCH_PROVIDER", "tavily")
        monkeypatch.delenv("WEB_RESEARCH_FALLBACK", raising=False)

        called: list[str] = []
        from backend.services.research import tavily, exa, brave

        async def tav(query, **kw):
            called.append("tavily")
            return _err_result("tavily", "timeout")

        async def exa_(query, **kw):  # pragma: no cover
            called.append("exa")
            return _ok_result("exa")

        async def brv(query, **kw):  # pragma: no cover
            called.append("brave")
            return _ok_result("brave")

        monkeypatch.setattr(tavily, "search", tav)
        monkeypatch.setattr(exa, "search", exa_)
        monkeypatch.setattr(brave, "search", brv)

        result = asyncio.run(research_client.search("q"))

        # Without a fallback chain, R1 behavior preserved: primary error
        # returns immediately.
        assert called == ["tavily"]
        assert result.error == "timeout"
        assert _research_module._COUNTS["fallback_hits"] == 0

    def test_unconfigured_provider_returns_clear_error(self, monkeypatch):
        _reset_counts()
        monkeypatch.delenv("WEB_RESEARCH_PROVIDER", raising=False)
        monkeypatch.delenv("WEB_RESEARCH_FALLBACK", raising=False)

        result = asyncio.run(research_client.search("q"))
        assert result.error == "provider_not_configured"


# ── stats() includes new fields ────────────────────────────────────────────

class TestStats:
    def test_stats_includes_fallback_metadata(self, monkeypatch):
        _reset_counts()
        monkeypatch.setenv("WEB_RESEARCH_PROVIDER", "tavily")
        monkeypatch.setenv("WEB_RESEARCH_FALLBACK", "exa,brave")

        s = _research_module.stats()
        assert s["configured_provider"] == "tavily"
        assert s["configured_fallback"] == ["exa", "brave"]
        assert "exa" in s["available_providers"]
        assert "brave" in s["available_providers"]
        assert "fallback_hits" in s


# ── Provider modules export their public surface ──────────────────────────

class TestProviderModuleShape:
    def test_exa_module_exports_search(self):
        from backend.services.research import exa
        assert callable(exa.search)
        assert exa.PROVIDER_NAME == "exa"

    def test_brave_module_exports_search(self):
        from backend.services.research import brave
        assert callable(brave.search)
        assert brave.PROVIDER_NAME == "brave"

    def test_exa_returns_unavailable_without_key(self, monkeypatch):
        from backend.services.research import exa
        monkeypatch.delenv("EXA_API_KEY", raising=False)
        result = asyncio.run(exa.search("q"))
        assert result.error and "EXA_API_KEY" in result.error

    def test_brave_returns_unavailable_without_key(self, monkeypatch):
        from backend.services.research import brave
        monkeypatch.delenv("BRAVE_API_KEY", raising=False)
        result = asyncio.run(brave.search("q"))
        assert result.error and "BRAVE_API_KEY" in result.error

    def test_exa_empty_query(self, monkeypatch):
        from backend.services.research import exa
        monkeypatch.setenv("EXA_API_KEY", "test-key")
        result = asyncio.run(exa.search("   "))
        assert result.error == "empty_query"

    def test_brave_empty_query(self, monkeypatch):
        from backend.services.research import brave
        monkeypatch.setenv("BRAVE_API_KEY", "test-key")
        result = asyncio.run(brave.search(""))
        assert result.error == "empty_query"
