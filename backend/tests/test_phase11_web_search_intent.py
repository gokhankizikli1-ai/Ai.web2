# coding: utf-8
"""
Phase 11 fix — intent-based web search auto-invocation tests.

Covers the gap reported in production: even with ENABLE_WEB_RESEARCH=true
and Tavily configured, prompts that REQUIRED current information
("NVIDIA latest news", "compare universities") fell back to
"İnternetten gerçek zamanlı bilgi arayamıyorum…" because the chat
path never invoked the web_research tool. Same dual-injection
pattern as the github + browser flows.
"""
from __future__ import annotations

from typing import AsyncIterator

import pytest

from backend.services.providers.streaming import (
    ProviderStreamStart, ProviderStreamToken, ProviderStreamDone,
)


# ── Fake provider that captures the augmented system prompt ──────────────

class _Captured:
    def __init__(self) -> None:
        self.requests: list = []
    @property
    def last_system(self) -> str:
        if not self.requests:
            return ""
        for m in self.requests[-1].messages:
            if m.role == "system":
                return m.content if isinstance(m.content, str) else ""
        return ""


@pytest.fixture()
def fake_provider(monkeypatch):
    captured = _Captured()
    class _Fake:
        name = "fake"
        default_model = "fake-model"
        supports_streaming = True
        supports_vision = False
        vision_models: tuple = ()
        def model_supports_vision(self, _m):
            return False
        async def stream_chat_completion(self, req) -> AsyncIterator:
            captured.requests.append(req)
            yield ProviderStreamStart(provider=self.name, model=req.model)
            yield ProviderStreamToken(delta="ok")
            yield ProviderStreamDone(
                finish_reason="stop", model=req.model,
                usage=type("U", (), {"prompt_tokens": 1,
                                     "completion_tokens": 1,
                                     "total_tokens": 2})(),
            )
    fake = _Fake()
    from backend.routes import v2_chat_stream as stream_route
    monkeypatch.setattr(stream_route, "get_provider", lambda _n: fake)
    return captured


# ════════════════════════════════════════════════════════════════════════════
# A) Intent detection
# ════════════════════════════════════════════════════════════════════════════

class TestDetectWebSearchIntent:

    def test_latest_news_triggers(self):
        from backend.services.tool_extraction import detect_web_search_intent
        i = detect_web_search_intent("Tell me the latest NVIDIA news")
        assert i.triggered is True
        # "latest" (temporal) + "news" (domain) → strong signal.
        assert i.confidence >= 0.5
        assert any("latest" in t for t in i.triggers)

    def test_current_information_triggers(self):
        from backend.services.tool_extraction import detect_web_search_intent
        i = detect_web_search_intent("What's the current Tesla stock price?")
        assert i.triggered is True

    def test_explicit_search_phrase_triggers(self):
        from backend.services.tool_extraction import detect_web_search_intent
        i = detect_web_search_intent("Please search the web for AI tools 2026")
        assert i.triggered is True
        assert i.confidence >= 0.9   # explicit phrase = highest weight
        assert any("search the web" in t for t in i.triggers)

    def test_turkish_internetten_arastir(self):
        """Multilingual: the exact phrase from the production bug
        report MUST trigger."""
        from backend.services.tool_extraction import detect_web_search_intent
        i = detect_web_search_intent(
            "İnternetten araştır: en iyi yapay zeka araçları"
        )
        assert i.triggered is True

    def test_compare_universities_triggers(self):
        from backend.services.tool_extraction import detect_web_search_intent
        i = detect_web_search_intent(
            "Compare the top 5 universities for AI research"
        )
        assert i.triggered is True

    def test_competitor_analysis_triggers(self):
        from backend.services.tool_extraction import detect_web_search_intent
        i = detect_web_search_intent(
            "Run a competitor analysis on Stripe vs Adyen"
        )
        assert i.triggered is True

    def test_small_talk_does_not_trigger(self):
        from backend.services.tool_extraction import detect_web_search_intent
        i = detect_web_search_intent("Hello, how are you today?")
        # "today" alone shouldn't fire — temporal signal but no
        # research/domain context.
        assert i.triggered is False

    def test_code_question_does_not_trigger(self):
        from backend.services.tool_extraction import detect_web_search_intent
        i = detect_web_search_intent(
            "Write me a unit test for this function: def add(a, b): return a + b"
        )
        # Negative pattern "unit test" rules this out.
        assert i.triggered is False

    def test_joke_negative_pattern(self):
        from backend.services.tool_extraction import detect_web_search_intent
        # "tell me a joke about today's weather" has temporal signal
        # but the negative pattern short-circuits.
        i = detect_web_search_intent("tell me a joke about today's weather")
        assert i.triggered is False


# ════════════════════════════════════════════════════════════════════════════
# B) Chat stream auto-invocation
# ════════════════════════════════════════════════════════════════════════════

_FAKE_SEARCH_RESULT = {
    "tool": "web_research", "status": "available",
    "data": {
        "query": "NVIDIA latest news",
        "answer": "NVIDIA announced H200 GPUs on May 25, 2026.",
        "citations": [
            {
                "title": "NVIDIA Unveils H200",
                "url": "https://nvidia.com/news/h200",
                "snippet": "Today NVIDIA announced the H200 GPU…",
                "published_date": "2026-05-25",
                "source_type": "news",
                "trust_score": 0.92,
            },
            {
                "title": "H200 Specs Leak",
                "url": "https://example.com/specs",
                "snippet": "Memory bandwidth doubles…",
                "published_date": "2026-05-24",
            },
        ],
        "count": 2,
        "cached": False,
        "elapsed_ms": 850,
    },
    "message": None, "provider": "tavily", "source": "tavily",
    "timestamp": "x", "is_live": True,
}


class TestChatStreamAutoSearch:

    def _patch_web_research(self, monkeypatch, envelope):
        from backend.services.tools import tool_registry as reg
        tool = reg.get_tool("web_research")
        assert tool is not None, "web_research tool not registered"
        async def fake_safe_run(query, context=None):
            return envelope
        monkeypatch.setattr(tool, "safe_run", fake_safe_run, raising=False)

    def test_search_intent_fires_tool_and_block(
        self, client, monkeypatch, fake_provider,
    ):
        monkeypatch.setenv("ENABLE_TOOLS", "true")
        monkeypatch.setenv("ENABLE_WEB_RESEARCH", "true")
        self._patch_web_research(monkeypatch, _FAKE_SEARCH_RESULT)

        r = client.post("/v2/chat/stream", json={
            "user_id": "u-search",
            "messages": [{
                "role": "user",
                "content": "Tell me the latest NVIDIA news",
            }],
        })
        assert r.status_code == 200
        body = r.text
        # SSE events fire for web_research.
        assert "event: tool.started" in body
        assert "event: tool.completed" in body
        assert "web_research" in body

        # Augmented prompt — assertive framing + citations.
        sys_prompt = fake_provider.last_system
        assert "KORVIX WEB SEARCH RESULTS" in sys_prompt
        assert "DO NOT REFUSE" in sys_prompt
        assert "NVIDIA Unveils H200" in sys_prompt
        assert "https://nvidia.com/news/h200" in sys_prompt
        # Synthesised answer is present.
        assert "H200 GPUs" in sys_prompt

        # User message ALSO got the block as a fenced suffix.
        last_user = next(
            (m for m in reversed(fake_provider.requests[-1].messages)
             if m.role == "user"), None,
        )
        assert last_user is not None
        ut = last_user.content if isinstance(last_user.content, str) else ""
        assert "Web search results" in ut
        assert "https://nvidia.com/news/h200" in ut

    def test_turkish_intent_fires(
        self, client, monkeypatch, fake_provider,
    ):
        """The production bug report was specifically in Turkish:
        "internetten gerçek zamanlı bilgi arayamıyorum" was being
        returned. The TR intent triggers MUST fire."""
        monkeypatch.setenv("ENABLE_TOOLS", "true")
        monkeypatch.setenv("ENABLE_WEB_RESEARCH", "true")
        self._patch_web_research(monkeypatch, _FAKE_SEARCH_RESULT)
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-tr",
            "messages": [{
                "role": "user",
                "content": "İnternetten araştır en güncel yapay zeka araçlarını",
            }],
        })
        assert r.status_code == 200
        assert "event: tool.completed" in r.text
        sys_prompt = fake_provider.last_system
        assert "KORVIX WEB SEARCH RESULTS" in sys_prompt

    def test_small_talk_does_not_fire(
        self, client, monkeypatch, fake_provider,
    ):
        monkeypatch.setenv("ENABLE_TOOLS", "true")
        monkeypatch.setenv("ENABLE_WEB_RESEARCH", "true")
        # Should NOT call the tool — patch it to fail loudly if called.
        from backend.services.tools import tool_registry as reg
        tool = reg.get_tool("web_research")
        called = []
        async def fake_safe_run(query, context=None):
            called.append(query)
            return _FAKE_SEARCH_RESULT
        monkeypatch.setattr(tool, "safe_run", fake_safe_run, raising=False)
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-small",
            "messages": [{"role": "user", "content": "hello there"}],
        })
        assert r.status_code == 200
        assert called == [], "web_research should NOT fire for small talk"
        assert "event: tool.started" not in r.text

    def test_url_paste_skips_search(
        self, client, monkeypatch, fake_provider,
    ):
        """When the user pastes a URL, the browser_fetch / github
        paths already produce real context. Don't ALSO run a web
        search — that would burn credits for no extra value."""
        monkeypatch.setenv("ENABLE_TOOLS", "true")
        monkeypatch.setenv("ENABLE_WEB_RESEARCH", "true")
        monkeypatch.setenv("ENABLE_BROWSER_TOOL", "true")
        # Make browser_fetch return canned data (so the route doesn't
        # try to hit the real internet during the test).
        from backend.services.tools import tool_registry as reg
        bf = reg.get_tool("browser_fetch")
        async def fake_bf(query, context=None):
            return {
                "tool": "browser_fetch", "status": "available",
                "data": {"url": query, "final_url": query, "status_code": 200,
                         "content_type": "text/html",
                         "title": "Example",
                         "meta_description": "",
                         "extracted_text": "page content here",
                         "extracted_text_chars": 17, "links": [], "images": [],
                         "truncated": False},
                "message": None, "provider": "urllib", "source": "urllib",
                "timestamp": "x", "is_live": True,
            }
        monkeypatch.setattr(bf, "safe_run", fake_bf, raising=False)
        wr = reg.get_tool("web_research")
        wr_called = []
        async def fake_wr(query, context=None):
            wr_called.append(query)
            return _FAKE_SEARCH_RESULT
        monkeypatch.setattr(wr, "safe_run", fake_wr, raising=False)

        r = client.post("/v2/chat/stream", json={
            "user_id": "u-url",
            "messages": [{
                "role": "user",
                "content": "What are the latest features at https://example.com/news",
            }],
        })
        assert r.status_code == 200
        # browser_fetch fired (URL was in the message).
        assert "browser_fetch" in r.text
        # web_research did NOT fire — URL flow takes precedence.
        assert wr_called == []

    def test_flag_off_no_fire(
        self, client, monkeypatch, fake_provider,
    ):
        monkeypatch.setenv("ENABLE_TOOLS", "true")
        monkeypatch.setenv("ENABLE_WEB_RESEARCH", "false")
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-flag-off",
            "messages": [{
                "role": "user", "content": "Latest NVIDIA news please",
            }],
        })
        assert r.status_code == 200
        assert "event: tool.started" not in r.text

    def test_search_unavailable_chip_red(
        self, client, monkeypatch, fake_provider,
    ):
        """When Tavily is not configured / returns no results, the
        tool.completed event has succeeded=false and the system
        prompt is NOT augmented (the LLM answers from its own
        knowledge, with the failure surfaced in the chip)."""
        monkeypatch.setenv("ENABLE_TOOLS", "true")
        monkeypatch.setenv("ENABLE_WEB_RESEARCH", "true")
        self._patch_web_research(monkeypatch, {
            "tool": "web_research", "status": "unavailable",
            "data": None, "message": "Web research provider not configured.",
            "provider": None, "source": None,
            "timestamp": "x", "is_live": False,
        })
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-unavail",
            "messages": [{
                "role": "user", "content": "Compare top 5 universities",
            }],
        })
        assert r.status_code == 200
        body = r.text
        assert "event: tool.completed" in body
        # succeeded=false surfaced for the FE.
        assert "\"succeeded\": false" in body or "\"succeeded\":false" in body
        # System prompt did NOT receive the (empty) block.
        sys_prompt = fake_provider.last_system
        assert "KORVIX WEB SEARCH RESULTS" not in sys_prompt
