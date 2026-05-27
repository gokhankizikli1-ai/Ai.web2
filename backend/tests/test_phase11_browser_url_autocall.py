# coding: utf-8
"""
Phase 11 — browser URL auto-invocation tests.

Mirrors test_phase10_github_url_autocall.py but for non-GitHub web
URLs flowing through the browser_fetch tool.
"""
from __future__ import annotations

from typing import AsyncIterator
from unittest.mock import patch

import pytest

from backend.services.providers.streaming import (
    ProviderStreamStart, ProviderStreamToken, ProviderStreamDone,
)


# ── Helpers — captures the augmented prompt + supports vision shape ──────

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
# A) Extractor
# ════════════════════════════════════════════════════════════════════════════

class TestExtractWebUrls:

    def test_finds_basic_https_url(self):
        from backend.services.tool_extraction import extract_web_urls
        urls = extract_web_urls("Check https://example.com/path?q=1.")
        assert len(urls) == 1
        # Trailing dot is stripped.
        assert urls[0].url == "https://example.com/path?q=1"
        assert urls[0].host == "example.com"

    def test_skips_github_urls(self):
        """github_urls.py handles those — we don't want to double-fetch
        with weaker context."""
        from backend.services.tool_extraction import extract_web_urls
        urls = extract_web_urls(
            "https://github.com/foo/bar and "
            "https://raw.githubusercontent.com/foo/bar/main/README "
            "and https://example.com",
        )
        hosts = {u.host for u in urls}
        assert "example.com" in hosts
        assert "github.com" not in hosts
        assert "raw.githubusercontent.com" not in hosts

    def test_skips_localhost_and_metadata(self):
        from backend.services.tool_extraction import extract_web_urls
        urls = extract_web_urls(
            "http://localhost:8000/admin "
            "http://127.0.0.1/internal "
            "http://169.254.169.254/latest/meta "
            "https://news.ycombinator.com",
        )
        assert len(urls) == 1
        assert urls[0].host == "news.ycombinator.com"

    def test_skips_private_ranges(self):
        from backend.services.tool_extraction import extract_web_urls
        urls = extract_web_urls(
            "http://10.0.0.1 http://192.168.1.1 http://172.16.0.1 "
            "https://blog.example.com",
        )
        assert len(urls) == 1
        assert urls[0].host == "blog.example.com"

    def test_dedupes(self):
        from backend.services.tool_extraction import extract_web_urls
        urls = extract_web_urls(
            "https://example.com/a and again https://example.com/a",
        )
        assert len(urls) == 1

    def test_caps_at_max(self):
        from backend.services.tool_extraction import extract_web_urls
        text = " ".join(f"https://site{i}.com/x" for i in range(20))
        urls = extract_web_urls(text, max_urls=4)
        assert len(urls) == 4


# ════════════════════════════════════════════════════════════════════════════
# B) Chat stream auto-invocation
# ════════════════════════════════════════════════════════════════════════════

_FAKE_PAGE = {
    "url": "https://example.com/launch",
    "final_url": "https://example.com/launch",
    "status_code": 200,
    "content_type": "text/html",
    "title": "Example Launches Cool Thing",
    "meta_description": "A blog post about the launch.",
    "extracted_text": "We launched Cool Thing today. It does X, Y, Z.",
    "extracted_text_chars": 48,
    "links": [],
    "images": [],
    "truncated": False,
}


class TestChatStreamAutoInvokesBrowser:

    def test_url_in_message_triggers_browser_and_block(
        self, client, monkeypatch, fake_provider,
    ):
        monkeypatch.setenv("ENABLE_TOOLS", "true")
        monkeypatch.setenv("ENABLE_BROWSER_TOOL", "true")
        from backend.services.tools import tool_registry as reg
        tool = reg.get_tool("browser_fetch")
        assert tool is not None

        async def fake_safe_run(query, context=None):
            return {
                "tool": "browser_fetch", "status": "available",
                "data": _FAKE_PAGE, "message": None,
                "provider": "urllib", "source": "urllib",
                "timestamp": "x", "is_live": True,
            }
        monkeypatch.setattr(tool, "safe_run", fake_safe_run, raising=False)

        r = client.post("/v2/chat/stream", json={
            "user_id": "u-web",
            "messages": [{
                "role": "user",
                "content": "Summarise https://example.com/launch please",
            }],
        })
        assert r.status_code == 200
        body = r.text

        # SSE events fire.
        assert "event: tool.started" in body
        assert "event: tool.completed" in body
        assert "browser_fetch" in body

        # System prompt contains the new assertive framing + page data.
        sys_prompt = fake_provider.last_system
        assert "KORVIX BROWSER TOOL OUTPUT" in sys_prompt
        assert "DO NOT REFUSE" in sys_prompt
        assert "example.com" in sys_prompt
        assert "We launched Cool Thing" in sys_prompt

        # User message also got the block as a fenced suffix.
        last_user = next(
            (m for m in reversed(fake_provider.requests[-1].messages)
             if m.role == "user"), None,
        )
        assert last_user is not None
        ut = last_user.content if isinstance(last_user.content, str) else ""
        assert "Web pages the user wants you to use" in ut

    def test_no_url_no_tool_events(
        self, client, monkeypatch, fake_provider,
    ):
        monkeypatch.setenv("ENABLE_TOOLS", "true")
        monkeypatch.setenv("ENABLE_BROWSER_TOOL", "true")
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-noweb",
            "messages": [{"role": "user", "content": "hello there"}],
        })
        assert r.status_code == 200
        body = r.text
        assert "event: tool.started" not in body
        sys_prompt = fake_provider.last_system
        assert "KORVIX BROWSER TOOL OUTPUT" not in sys_prompt

    def test_flag_off_skips(
        self, client, monkeypatch, fake_provider,
    ):
        monkeypatch.setenv("ENABLE_TOOLS", "true")
        monkeypatch.setenv("ENABLE_BROWSER_TOOL", "false")
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-off",
            "messages": [{
                "role": "user",
                "content": "Read https://example.com/news",
            }],
        })
        assert r.status_code == 200
        body = r.text
        assert "event: tool.started" not in body

    def test_fetch_failure_is_honest(
        self, client, monkeypatch, fake_provider,
    ):
        """When browser_fetch returns unavailable / error, the chip
        flips to failed AND the system prompt explains the limitation
        honestly instead of inventing content."""
        monkeypatch.setenv("ENABLE_TOOLS", "true")
        monkeypatch.setenv("ENABLE_BROWSER_TOOL", "true")
        from backend.services.tools import tool_registry as reg
        tool = reg.get_tool("browser_fetch")
        async def fake_safe_run(query, context=None):
            return {
                "tool": "browser_fetch", "status": "error",
                "data": None, "message": "Network error: connection refused",
                "provider": "urllib", "source": "urllib",
                "timestamp": "x", "is_live": False,
            }
        monkeypatch.setattr(tool, "safe_run", fake_safe_run, raising=False)

        r = client.post("/v2/chat/stream", json={
            "user_id": "u-fail",
            "messages": [{
                "role": "user",
                "content": "Read https://example.com",
            }],
        })
        assert r.status_code == 200
        body = r.text
        # tool.completed must STILL fire with succeeded=false.
        assert "event: tool.completed" in body
        assert "\"succeeded\": false" in body or "\"succeeded\":false" in body
        # System prompt explains the failure.
        sys_prompt = fake_provider.last_system
        assert "could not be fetched" in sys_prompt

    def test_concurrent_multi_url(
        self, client, monkeypatch, fake_provider,
    ):
        """3 URLs in one message — all run concurrently, all land in
        the system prompt."""
        monkeypatch.setenv("ENABLE_TOOLS", "true")
        monkeypatch.setenv("ENABLE_BROWSER_TOOL", "true")
        from backend.services.tools import tool_registry as reg
        tool = reg.get_tool("browser_fetch")
        async def fake_safe_run(query, context=None):
            url = (context or {}).get("url") or query
            return {
                "tool": "browser_fetch", "status": "available",
                "data": {**_FAKE_PAGE, "url": url, "final_url": url,
                         "title": f"Title for {url}"},
                "message": None, "provider": "urllib", "source": "urllib",
                "timestamp": "x", "is_live": True,
            }
        monkeypatch.setattr(tool, "safe_run", fake_safe_run, raising=False)

        r = client.post("/v2/chat/stream", json={
            "user_id": "u-multi",
            "messages": [{
                "role": "user",
                "content": (
                    "Compare https://a.example.com and "
                    "https://b.example.com and https://c.example.com please."
                ),
            }],
        })
        assert r.status_code == 200
        body = r.text
        # One tool.started + one tool.completed per URL (started)
        # plus a single completed event summarising all of them.
        started_count = body.count("event: tool.started")
        assert started_count == 3
        sys_prompt = fake_provider.last_system
        for host in ("a.example.com", "b.example.com", "c.example.com"):
            assert host in sys_prompt
