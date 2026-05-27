# coding: utf-8
"""
Phase 10 fix — GitHub URL auto-invocation tests.

Covers the missing link between `github_repo` tool registration and
the chat path actually using it. The original Phase 10 PR shipped
the tool but the chat stream never called it, so the LLM produced
generic "I cannot directly inspect GitHub repositories" responses.

Tests:
  A) Extractor — finds URLs, dedupes, filters path-like noise
  B) Chat stream — when ENABLE_GITHUB_TOOL is on AND the user pastes
     a github.com URL, the route emits tool.started + tool.completed
     SSE events AND folds the tool result into the system prompt.
  C) Chat stream — when the tool is OFF, no tool events fire and the
     existing chat flow is byte-identical to before this PR.
"""
from __future__ import annotations

from typing import AsyncIterator
from unittest.mock import patch

import pytest

from backend.services.providers.streaming import (
    ProviderStreamStart, ProviderStreamToken, ProviderStreamDone,
)


# ════════════════════════════════════════════════════════════════════════════
# Helpers — fake provider that captures the augmented system prompt
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
def fake_provider_with_vision(monkeypatch):
    captured = _Captured()

    class _Fake:
        name = "fake-stream"
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

class TestExtractGithubRefs:

    def test_finds_https_url(self):
        from backend.services.tool_extraction import extract_github_refs
        refs = extract_github_refs(
            "Please analyze https://github.com/gokhankizikli1-ai/Ai.web2",
        )
        assert len(refs) == 1
        assert refs[0].owner == "gokhankizikli1-ai"
        assert refs[0].repo  == "Ai.web2"

    def test_strips_dot_git_and_path(self):
        from backend.services.tool_extraction import extract_github_refs
        refs = extract_github_refs(
            "look at https://github.com/openai/openai-python.git/blob/main/README.md",
        )
        assert len(refs) == 1
        assert refs[0].full_name == "openai/openai-python"

    def test_handles_raw_githubusercontent(self):
        from backend.services.tool_extraction import extract_github_refs
        refs = extract_github_refs(
            "fetch https://raw.githubusercontent.com/torvalds/linux/master/README",
        )
        assert len(refs) == 1
        assert refs[0].full_name == "torvalds/linux"

    def test_dedupes(self):
        from backend.services.tool_extraction import extract_github_refs
        refs = extract_github_refs(
            "https://github.com/openai/openai-python and again "
            "https://github.com/openai/openai-python/blob/main/README.md",
        )
        assert len(refs) == 1

    def test_ignores_path_like_tokens_without_github_context(self):
        """No 'github' / 'repo' / 'repository' in the message → bare
        owner/repo tokens are NOT picked up. Avoids false positives on
        'src/components', 'tests/data', etc."""
        from backend.services.tool_extraction import extract_github_refs
        refs = extract_github_refs("The src/components dir holds buttons.")
        assert refs == []

    def test_picks_up_bare_token_with_repo_context(self):
        from backend.services.tool_extraction import extract_github_refs
        refs = extract_github_refs(
            "What does the openai/openai-python repository do?",
        )
        assert len(refs) == 1
        assert refs[0].full_name == "openai/openai-python"

    def test_caps_at_max_refs(self):
        from backend.services.tool_extraction import extract_github_refs
        msg = " ".join([
            f"https://github.com/o{i}/repo{i}" for i in range(20)
        ])
        refs = extract_github_refs(msg, max_refs=3)
        assert len(refs) == 3


# ════════════════════════════════════════════════════════════════════════════
# B) Chat stream auto-invocation
# ════════════════════════════════════════════════════════════════════════════

# Sample envelope the github_repo tool returns when invoked. We patch
# tool.safe_run to return this so the test doesn't hit the real
# GitHub API.
_FAKE_GH_DATA = {
    "owner": "gokhankizikli1-ai",
    "repo": "Ai.web2",
    "full_name": "gokhankizikli1-ai/Ai.web2",
    "description": "KorvixAI monorepo.",
    "default_branch": "main",
    "stars": 1, "forks": 0, "open_issues": 5,
    "primary_language": "Python",
    "topics": ["ai", "agents"],
    "license": "MIT",
    "homepage": "",
    "html_url": "https://github.com/gokhankizikli1-ai/Ai.web2",
    "readme_text": "# Ai.web2\n\nMulti-agent OS.",
    "readme_truncated": False,
    "recent_commits": [
        {"sha": "abc", "message": "feat: tools", "author": "A", "date": "2026-05-27T10:00:00Z", "url": ""},
    ],
}


class TestChatStreamAutoInvokesGithub:

    def test_url_in_message_triggers_tool_and_block(
        self, client, monkeypatch, fake_provider_with_vision,
    ):
        monkeypatch.setenv("ENABLE_TOOLS", "true")
        monkeypatch.setenv("ENABLE_GITHUB_TOOL", "true")

        # Patch the github_repo tool's safe_run so the test runs offline.
        from backend.services.tools import tool_registry as reg
        gh_tool = reg.get_tool("github_repo")
        assert gh_tool is not None, "github_repo tool not registered"

        async def fake_safe_run(query, context=None):
            return {
                "tool": "github_repo", "status": "available",
                "data": _FAKE_GH_DATA, "message": None,
                "provider": "github", "source": "github",
                "timestamp": "2026-05-27T10:00:00Z", "is_live": True,
            }
        monkeypatch.setattr(gh_tool, "safe_run", fake_safe_run, raising=False)

        # Patch the key-file fetcher so we don't make any outbound
        # network calls in this test — it returns an empty list.
        async def fake_key_files(owner, repo):
            return []
        monkeypatch.setattr(
            "backend.services.tool_extraction.github_urls._fetch_key_files",
            fake_key_files,
        )

        r = client.post("/v2/chat/stream", json={
            "user_id": "u-gh",
            "messages": [{
                "role": "user",
                "content": "Please analyze https://github.com/gokhankizikli1-ai/Ai.web2",
            }],
        })
        assert r.status_code == 200
        body = r.text

        # ── SSE event contract ─────────────────────────────────────────
        # tool.started and tool.completed must fire (the FE renders
        # "Analyzing repository …" off these).
        assert "event: tool.started" in body
        assert "event: tool.completed" in body
        assert "github_repo" in body
        # tool.debug only fires for confirmed owners — not this user.
        assert "event: tool.debug" not in body

        # ── System-prompt augmentation ─────────────────────────────────
        # The augmented system prompt the LLM actually sees must
        # contain the repo metadata block.
        sys_prompt = fake_provider_with_vision.last_system
        assert "Repository inspection" in sys_prompt
        assert "Ai.web2" in sys_prompt
        assert "Multi-agent OS." in sys_prompt
        # And the canonical KorvixAI "ground truth" framing.
        assert "ground truth" in sys_prompt.lower()

    def test_no_url_in_message_no_tool_events(
        self, client, monkeypatch, fake_provider_with_vision,
    ):
        """A normal chat message produces zero tool events — the
        existing flow is byte-identical."""
        monkeypatch.setenv("ENABLE_TOOLS", "true")
        monkeypatch.setenv("ENABLE_GITHUB_TOOL", "true")
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-plain",
            "messages": [{"role": "user", "content": "hello, what's the weather?"}],
        })
        assert r.status_code == 200
        body = r.text
        assert "event: tool.started" not in body
        assert "event: tool.completed" not in body
        # The system prompt does NOT contain the github header.
        sys_prompt = fake_provider_with_vision.last_system
        assert "Repository inspection" not in sys_prompt

    def test_flag_off_does_not_invoke(
        self, client, monkeypatch, fake_provider_with_vision,
    ):
        """ENABLE_GITHUB_TOOL=false → URL is ignored, no tool events,
        no augmentation. Honest fallback — the LLM gets the message
        as-is and may correctly say "I cannot inspect repos here.\""""
        monkeypatch.setenv("ENABLE_TOOLS", "true")
        monkeypatch.setenv("ENABLE_GITHUB_TOOL", "false")
        r = client.post("/v2/chat/stream", json={
            "user_id": "u-off",
            "messages": [{
                "role": "user",
                "content": "Analyze https://github.com/openai/openai-python",
            }],
        })
        assert r.status_code == 200
        body = r.text
        assert "event: tool.started" not in body
        assert "event: tool.completed" not in body
        sys_prompt = fake_provider_with_vision.last_system
        assert "Repository inspection" not in sys_prompt

    def test_tool_unavailable_surfaces_in_block(
        self, client, monkeypatch, fake_provider_with_vision,
    ):
        """When the tool returns an unavailable envelope (rate
        limited, network down), the system prompt gets an HONEST
        block telling the LLM the repo couldn't be inspected — so
        the assistant doesn't hallucinate."""
        monkeypatch.setenv("ENABLE_TOOLS", "true")
        monkeypatch.setenv("ENABLE_GITHUB_TOOL", "true")
        from backend.services.tools import tool_registry as reg
        gh_tool = reg.get_tool("github_repo")
        async def fake_safe_run(query, context=None):
            return {
                "tool": "github_repo", "status": "unavailable",
                "data": None,
                "message": "GitHub rate limit reached.",
                "provider": "github", "source": "github",
                "timestamp": "x", "is_live": False,
            }
        monkeypatch.setattr(gh_tool, "safe_run", fake_safe_run, raising=False)

        r = client.post("/v2/chat/stream", json={
            "user_id": "u-rl",
            "messages": [{
                "role": "user",
                "content": "Analyze https://github.com/openai/openai-python",
            }],
        })
        assert r.status_code == 200
        body = r.text
        # tool.completed must still fire (succeeded=False).
        assert "event: tool.completed" in body
        assert "\"succeeded\": false" in body or "\"succeeded\":false" in body
        # System prompt explains the limitation honestly.
        sys_prompt = fake_provider_with_vision.last_system
        assert "could not be inspected" in sys_prompt
        assert "rate limit" in sys_prompt.lower()
