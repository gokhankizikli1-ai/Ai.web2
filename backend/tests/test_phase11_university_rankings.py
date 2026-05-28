# coding: utf-8
"""
Phase 11 — university rankings tool + intent detection + chat
auto-invocation tests.

Covers:
  A) Wikipedia table parser produces correct {rank, name, country,
     score} rows
  B) Intent detector identifies QS / THE / ARWU / generic queries
  C) Chat stream fires the university_rankings tool BEFORE
     web_search for ranking queries
  D) Tool surfaces honest unavailable when the page can't be parsed
"""
from __future__ import annotations

import asyncio
from typing import AsyncIterator
from unittest.mock import patch

import pytest

from backend.services.providers.streaming import (
    ProviderStreamStart, ProviderStreamToken, ProviderStreamDone,
)


# Minimal Wikipedia-ish HTML — a wikitable with the exact column shape
# the parser expects to handle. Real Wikipedia QS pages are much
# bigger but the column structure is the same.
_SAMPLE_WIKITABLE_HTML = """
<!doctype html><html><body>
<table class="wikitable">
  <tr>
    <th>Rank</th><th>Name</th><th>Country</th><th>Score</th>
  </tr>
  <tr>
    <td>1</td>
    <td>Massachusetts Institute of Technology</td>
    <td>United States</td>
    <td>100.0 [1]</td>
  </tr>
  <tr>
    <td>2</td>
    <td>Stanford University</td>
    <td>United States</td>
    <td>98.4</td>
  </tr>
  <tr>
    <td>=3</td>
    <td>University of Cambridge</td>
    <td>United Kingdom</td>
    <td>97.7</td>
  </tr>
  <tr>
    <td>=3</td>
    <td>University of Oxford</td>
    <td>United Kingdom</td>
    <td>97.7</td>
  </tr>
  <tr>
    <td>5</td>
    <td>Harvard University</td>
    <td>United States</td>
    <td>96.8</td>
  </tr>
  <tr>
    <td>6</td>
    <td>Imperial College London</td>
    <td>United Kingdom</td>
    <td>95.1</td>
  </tr>
</table>
</body></html>
"""


# ════════════════════════════════════════════════════════════════════════════
# A) Tool — Wikipedia parser
# ════════════════════════════════════════════════════════════════════════════

class TestRankingsTool:

    def test_parses_wikitable_into_rows(self, monkeypatch):
        from backend.services.tools.university_rankings_tool import (
            UniversityRankingsTool, _fetch_wiki,
        )
        # Mock the sync HTTP fetch.
        monkeypatch.setattr(
            "backend.services.tools.university_rankings_tool._fetch_wiki",
            lambda page: _SAMPLE_WIKITABLE_HTML,
        )
        tool = UniversityRankingsTool()
        env = asyncio.run(tool.run("qs", {"ranking": "qs", "limit": 10}))
        assert env["status"] == "available"
        data = env["data"]
        assert data["ranking"] == "qs"
        assert data["returned"] >= 5
        rows = data["rows"]
        # First row is the unambiguous rank-1 entry.
        assert rows[0]["rank"] == 1
        assert "Massachusetts Institute of Technology" in rows[0]["name"]
        assert rows[0]["country"] == "United States"
        # Score parsed cleanly — citation marker [1] stripped.
        assert rows[0]["score"] == 100.0
        # Tied rank ("=3") parsed as 3.
        assert any(r["rank"] == 3 and "Cambridge" in r["name"] for r in rows)
        # source_url + label populated.
        assert "QS" in data["source_label"]
        assert data["source_url"].startswith("https://en.wikipedia.org/wiki/")

    def test_limit_caps_returned(self, monkeypatch):
        from backend.services.tools.university_rankings_tool import UniversityRankingsTool
        monkeypatch.setattr(
            "backend.services.tools.university_rankings_tool._fetch_wiki",
            lambda page: _SAMPLE_WIKITABLE_HTML,
        )
        env = asyncio.run(UniversityRankingsTool().run(
            "qs", {"ranking": "qs", "limit": 3},
        ))
        assert env["status"] == "available"
        assert env["data"]["returned"] <= 3

    def test_country_filter(self, monkeypatch):
        from backend.services.tools.university_rankings_tool import UniversityRankingsTool
        monkeypatch.setattr(
            "backend.services.tools.university_rankings_tool._fetch_wiki",
            lambda page: _SAMPLE_WIKITABLE_HTML,
        )
        env = asyncio.run(UniversityRankingsTool().run(
            "qs", {"ranking": "qs", "limit": 10, "country": "United Kingdom"},
        ))
        rows = env["data"]["rows"]
        assert len(rows) >= 1
        for r in rows:
            assert "United Kingdom" in r["country"]

    def test_unknown_ranking_key_errors(self):
        from backend.services.tools.university_rankings_tool import UniversityRankingsTool
        env = asyncio.run(UniversityRankingsTool().run("forbes_global_500"))
        assert env["status"] == "error"

    def test_fetch_failure_surfaces_unavailable(self, monkeypatch):
        from backend.services.tools.university_rankings_tool import (
            UniversityRankingsTool, _RankingFetchError,
        )
        def bad_fetch(page):
            raise _RankingFetchError("HTTP 503: bad gateway")
        monkeypatch.setattr(
            "backend.services.tools.university_rankings_tool._fetch_wiki",
            bad_fetch,
        )
        env = asyncio.run(UniversityRankingsTool().run("qs"))
        # Honest unavailable — NOT guessed data.
        assert env["status"] == "unavailable"
        assert "HTTP 503" in env["message"]

    def test_empty_html_returns_unavailable(self, monkeypatch):
        from backend.services.tools.university_rankings_tool import UniversityRankingsTool
        # Page with no wikitable — parser finds no rows, NOT a crash.
        monkeypatch.setattr(
            "backend.services.tools.university_rankings_tool._fetch_wiki",
            lambda page: "<!doctype html><html><body><p>No table here</p></body></html>",
        )
        env = asyncio.run(UniversityRankingsTool().run("qs"))
        assert env["status"] == "unavailable"


# ════════════════════════════════════════════════════════════════════════════
# B) Intent detection
# ════════════════════════════════════════════════════════════════════════════

class TestRankingIntent:

    @pytest.mark.parametrize("prompt,system", [
        ("Show me the QS World University Rankings 2026", "qs"),
        ("Top 10 universities by QS ranking", "qs"),
        ("Times Higher Education world university ranking",   "the"),
        ("THE world university rankings",                     "the"),
        ("ARWU top 50 universities",                          "arwu"),
        ("Shanghai ranking top 20",                           "arwu"),
        ("CWUR top universities",                             "cwur"),
        ("Best universities in the world",                    "qs"),
        ("Dünyanın en iyi 10 üniversitesi",                   "qs"),
        ("Üniversite sıralaması ver",                         "qs"),
    ])
    def test_triggers_with_correct_system(self, prompt, system):
        from backend.services.tool_extraction import detect_ranking_intent
        ri = detect_ranking_intent(prompt)
        assert ri is not None, f"prompt did not trigger: {prompt!r}"
        assert ri.triggered is True
        assert ri.system == system

    def test_extracts_top_N(self):
        from backend.services.tool_extraction import detect_ranking_intent
        ri = detect_ranking_intent("Top 25 universities by QS")
        assert ri.limit == 25

    def test_extracts_top_N_turkish(self):
        from backend.services.tool_extraction import detect_ranking_intent
        ri = detect_ranking_intent("İlk 5 üniversite QS sıralamasına göre")
        assert ri.limit == 5

    def test_extracts_country_filter(self):
        from backend.services.tool_extraction import detect_ranking_intent
        ri = detect_ranking_intent("Top 10 universities in USA by QS")
        assert ri.country == "United States"

    def test_negative_specific_university_query(self):
        from backend.services.tool_extraction import detect_ranking_intent
        ri = detect_ranking_intent("Which university did Albert Einstein attend?")
        assert ri is None

    def test_random_question_no_trigger(self):
        from backend.services.tool_extraction import detect_ranking_intent
        ri = detect_ranking_intent("Hello, how are you?")
        assert ri is None


# ════════════════════════════════════════════════════════════════════════════
# C) Chat stream auto-invocation
# ════════════════════════════════════════════════════════════════════════════

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


class TestChatAutoInvokesRankings:

    def test_ranking_query_fires_tool(
        self, client, monkeypatch, fake_provider,
    ):
        monkeypatch.setenv("ENABLE_TOOLS", "true")
        monkeypatch.setenv("ENABLE_UNIVERSITY_RANKINGS", "true")
        # Mock the wiki fetcher so the test runs offline.
        monkeypatch.setattr(
            "backend.services.tools.university_rankings_tool._fetch_wiki",
            lambda page: _SAMPLE_WIKITABLE_HTML,
        )

        r = client.post("/v2/chat/stream", json={
            "user_id": "u-rank",
            "messages": [{
                "role": "user",
                "content": "Show me the QS World University Rankings top 5",
            }],
        })
        assert r.status_code == 200
        body = r.text
        assert "event: tool.started" in body
        assert "university_rankings" in body
        assert "event: tool.completed" in body
        # System prompt contains the structured table block.
        sys_prompt = fake_provider.last_system
        assert "KORVIX RANKINGS TOOL" in sys_prompt
        assert "Massachusetts Institute of Technology" in sys_prompt
        # The markdown table separator confirms the structured format.
        assert "| Rank |" in sys_prompt

    def test_ranking_query_skips_web_search(
        self, client, monkeypatch, fake_provider,
    ):
        """A ranking query should fire `university_rankings` and NOT
        the more-general `web_research` tool — structured tables
        beat snippets."""
        monkeypatch.setenv("ENABLE_TOOLS", "true")
        monkeypatch.setenv("ENABLE_UNIVERSITY_RANKINGS", "true")
        monkeypatch.setenv("ENABLE_WEB_RESEARCH", "true")
        monkeypatch.setattr(
            "backend.services.tools.university_rankings_tool._fetch_wiki",
            lambda page: _SAMPLE_WIKITABLE_HTML,
        )
        # If web_research fires we want the test to scream.
        from backend.services.tools import tool_registry as reg
        wr = reg.get_tool("web_research")
        wr_calls = []
        async def fake_wr(query, context=None):
            wr_calls.append(query)
            return {"status": "available", "data": {"answer": "x", "citations": []},
                    "tool": "web_research", "message": None,
                    "provider": "tavily", "source": "tavily",
                    "timestamp": "x", "is_live": True}
        monkeypatch.setattr(wr, "safe_run", fake_wr, raising=False)

        r = client.post("/v2/chat/stream", json={
            "user_id": "u-rank-skip",
            "messages": [{
                "role": "user",
                "content": "Top 10 universities by QS ranking",
            }],
        })
        assert r.status_code == 200
        # university_rankings fired.
        assert "university_rankings" in r.text
        # web_research did NOT fire — ranking flow takes precedence.
        assert wr_calls == [], "web_research should NOT fire for ranking queries"

    def test_flag_off_skips_rankings(
        self, client, monkeypatch, fake_provider,
    ):
        monkeypatch.setenv("ENABLE_TOOLS", "true")
        monkeypatch.delenv("ENABLE_UNIVERSITY_RANKINGS", raising=False)
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-rank-off",
            "messages": [{
                "role": "user",
                "content": "QS world university rankings top 10",
            }],
        })
        assert r.status_code == 200
        assert "university_rankings" not in r.text

    def test_unavailable_surfaces_honestly(
        self, client, monkeypatch, fake_provider,
    ):
        """When the wikipedia fetch fails, the chip flips red AND the
        system prompt does NOT contain a fabricated table — the
        honest "tool attempted, no data" path takes over."""
        monkeypatch.setenv("ENABLE_TOOLS", "true")
        monkeypatch.setenv("ENABLE_UNIVERSITY_RANKINGS", "true")
        from backend.services.tools.university_rankings_tool import _RankingFetchError
        def bad_fetch(page):
            raise _RankingFetchError("HTTP 503")
        monkeypatch.setattr(
            "backend.services.tools.university_rankings_tool._fetch_wiki",
            bad_fetch,
        )
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-rank-fail",
            "messages": [{
                "role": "user",
                "content": "Show me the QS World University Rankings top 5",
            }],
        })
        assert r.status_code == 200
        body = r.text
        assert "event: tool.completed" in body
        # succeeded=false present.
        assert "\"succeeded\": false" in body or "\"succeeded\":false" in body
        # No fabricated table in the system prompt.
        sys_prompt = fake_provider.last_system
        assert "KORVIX RANKINGS TOOL — STRUCTURED DATA FROM WIKIPEDIA" not in sys_prompt
