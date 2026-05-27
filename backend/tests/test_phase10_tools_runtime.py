# coding: utf-8
"""
Phase 10 — tool runtime + browser + github + execution log + API tests.

Covers the focused subset shipped in this PR:
  A) Tool execution log (ToolExecutionsClient)
  B) Public /v2/tools API (list, execute, executions, usage)
  C) Browser fetch tool (mocked network)
  D) GitHub repo tool (mocked network)
"""
from __future__ import annotations

import asyncio
import json
from unittest.mock import patch

import pytest


# ════════════════════════════════════════════════════════════════════════════
# A) Tool execution log
# ════════════════════════════════════════════════════════════════════════════

class TestToolExecutionsLog:

    def test_disabled_by_default(self, monkeypatch):
        monkeypatch.delenv("ENABLE_TOOLS_RUNTIME", raising=False)
        from backend.services.tool_executions import client as ex
        assert ex.is_enabled() is False
        assert ex.create(user_id="u", tool_id="t") is None
        assert ex.list_user(user_id="u") == []

    def test_create_then_get(self, tmp_tool_executions_db):
        from backend.services.tool_executions import client as ex
        row = ex.create(
            user_id="u1", tool_id="web_search",
            input_summary="tesla competitors",
            input_json='{"query":"tesla competitors"}',
            caller="user", panel_id="P1",
        )
        assert row is not None
        assert row.status == "queued"
        # Round-trip ownership.
        same = ex.get(row.id, user_id="u1")
        assert same is not None
        assert same.tool_id == "web_search"
        # Cross-user isolation.
        assert ex.get(row.id, user_id="u2") is None

    def test_mark_terminal_writes_payload(self, tmp_tool_executions_db):
        from backend.services.tool_executions import client as ex
        row = ex.create(
            user_id="u", tool_id="browser_fetch", input_summary="x",
        )
        updated = ex.mark_terminal(
            row.id, user_id="u",
            status="completed",
            output_json='{"ok": true}',
            provider="urllib",
            latency_ms=123,
        )
        assert updated.status == "completed"
        assert updated.latency_ms == 123
        assert updated.output_json == '{"ok": true}'
        # to_dict() parses output_json for the FE consumer.
        d = updated.to_dict()
        assert d["output_json"] == {"ok": True}

    def test_record_run_context_manager_success(self, tmp_tool_executions_db):
        from backend.services.tool_executions import client as ex
        with ex.record_run(
            user_id="u", tool_id="web_search",
            input_summary="hello", input_payload={"q": "hello"},
        ) as h:
            assert h.execution_id is not None
            # Caller is responsible for marking success / failure.
            h.success(output={"results": []}, provider="tavily")
        row = ex.get(h.execution_id, user_id="u")
        assert row.status == "completed"
        assert row.provider == "tavily"
        assert row.latency_ms is not None and row.latency_ms >= 0

    def test_record_run_context_manager_failure(self, tmp_tool_executions_db):
        from backend.services.tool_executions import client as ex
        with ex.record_run(
            user_id="u", tool_id="web_search",
            input_summary="bad", input_payload={"q": "x"},
        ) as h:
            h.failure("RATE_LIMITED", "Provider 429", rate_limited=True)
        row = ex.get(h.execution_id, user_id="u")
        assert row.status == "rate_limited"
        assert row.error_code == "RATE_LIMITED"

    def test_record_run_records_raised_exception(self, tmp_tool_executions_db):
        from backend.services.tool_executions import client as ex
        captured_id = None
        with pytest.raises(RuntimeError):
            with ex.record_run(
                user_id="u", tool_id="boom", input_summary="x",
            ) as h:
                captured_id = h.execution_id
                raise RuntimeError("kaboom")
        row = ex.get(captured_id, user_id="u")
        assert row.status == "failed"
        assert row.error_code == "RuntimeError"
        assert "kaboom" in (row.error_message or "")

    def test_usage_summary_aggregates(self, tmp_tool_executions_db):
        from backend.services.tool_executions import client as ex
        for _ in range(3):
            with ex.record_run(user_id="u", tool_id="web_search",
                                       input_summary="q") as h:
                h.success(output={}, provider="tavily")
        with ex.record_run(user_id="u", tool_id="github_repo",
                                   input_summary="r") as h:
            h.failure("HTTP_404", "Not found")
        summary = ex.usage_summary(user_id="u")
        assert summary["total"] == 4
        assert summary["completed"] == 3
        assert summary["failed"] == 1
        by_tool = {row["tool_id"]: row["n"] for row in summary["by_tool"]}
        assert by_tool["web_search"] == 3
        assert by_tool["github_repo"] == 1


# ════════════════════════════════════════════════════════════════════════════
# B) Tools metadata + execute route
# ════════════════════════════════════════════════════════════════════════════

class TestToolsRoutes:

    def _override_user(self, app):
        from backend.core.deps import current_user
        from backend.services.auth.identity import User
        app.dependency_overrides[current_user] = lambda: User(
            id="u-rt", kind="email",
            external_id="email:rt@example.com", display_name="RT",
        )

    def test_list_tools_returns_metadata(self, client, monkeypatch, app):
        # Enable the master toggle + one per-tool flag so the catalogue
        # has at least one entry.
        monkeypatch.setenv("ENABLE_TOOLS", "true")
        monkeypatch.setenv("ENABLE_CALCULATOR", "true")
        self._override_user(app)
        try:
            r = client.get("/v2/tools")
            assert r.status_code == 200, r.text
            tools = r.json()["data"]["tools"]
            assert isinstance(tools, list)
            ids = [t["id"] for t in tools]
            assert "calculator" in ids
            cal = next(t for t in tools if t["id"] == "calculator")
            # Public metadata shape covers the new Phase 10 fields.
            for key in ("category", "icon", "execution_mode",
                        "requires_auth", "cost_estimate", "timeout_seconds"):
                assert key in cal
        finally:
            app.dependency_overrides.pop(__import__(
                "backend.core.deps", fromlist=["current_user"]
            ).current_user, None)

    def test_list_tools_empty_when_master_off(self, client, monkeypatch, app):
        monkeypatch.delenv("ENABLE_TOOLS", raising=False)
        self._override_user(app)
        try:
            r = client.get("/v2/tools")
            assert r.status_code == 200
            assert r.json()["data"]["tools"] == []
        finally:
            app.dependency_overrides.pop(__import__(
                "backend.core.deps", fromlist=["current_user"]
            ).current_user, None)

    def test_execute_disabled_tool_returns_404(self, client, monkeypatch, app):
        monkeypatch.delenv("ENABLE_TOOLS", raising=False)
        self._override_user(app)
        try:
            r = client.post("/v2/tools/execute", json={
                "tool_id": "calculator", "query": "2 + 2",
            })
            assert r.status_code == 404
            assert r.json()["detail"]["code"] == "TOOL_DISABLED_OR_UNKNOWN"
        finally:
            app.dependency_overrides.pop(__import__(
                "backend.core.deps", fromlist=["current_user"]
            ).current_user, None)

    def test_execute_calculator_round_trips(
        self, client, monkeypatch, app, tmp_tool_executions_db,
    ):
        monkeypatch.setenv("ENABLE_TOOLS", "true")
        monkeypatch.setenv("ENABLE_CALCULATOR", "true")
        self._override_user(app)
        try:
            r = client.post("/v2/tools/execute", json={
                "tool_id": "calculator", "query": "2 + 2",
            })
            assert r.status_code == 200, r.text
            body = r.json()["data"]
            assert body["tool"] == "calculator"
            assert body["execution_id"]
            # The execution log row exists for the same user.
            r2 = client.get(f"/v2/tools/executions/{body['execution_id']}")
            assert r2.status_code == 200
            row = r2.json()["data"]["execution"]
            assert row["tool_id"] == "calculator"
            assert row["status"] in ("completed", "failed", "rate_limited")
        finally:
            app.dependency_overrides.pop(__import__(
                "backend.core.deps", fromlist=["current_user"]
            ).current_user, None)


# ════════════════════════════════════════════════════════════════════════════
# C) Browser tool
# ════════════════════════════════════════════════════════════════════════════

class _FakeResponse:
    """Minimal urlopen replacement used to mock network in tests."""
    def __init__(self, body: bytes, *, status=200, content_type="text/html; charset=utf-8",
                 final_url=None):
        self._body = body
        self.status = status
        self.headers = {"Content-Type": content_type}
        self._final_url = final_url
    def read(self, n=None):
        if n is None or n >= len(self._body):
            return self._body
        return self._body[:n]
    def geturl(self):
        return self._final_url
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False


_SAMPLE_HTML = b"""
<!doctype html><html><head>
<title>KorvixAI Docs</title>
<meta name="description" content="An overview of the platform.">
</head>
<body>
<nav>nav links should be skipped</nav>
<h1>Welcome to KorvixAI</h1>
<p>This is the <strong>introduction</strong> paragraph.</p>
<p>And a <a href="https://example.com/inner">link</a> to follow.</p>
<script>alert('skip me')</script>
</body></html>
"""


class TestBrowserTool:

    def test_fetch_extracts_title_and_text(self):
        from backend.services.tools.browser_tool import BrowserFetchTool
        tool = BrowserFetchTool()
        with patch("backend.services.tools.browser_tool.urllib.request.urlopen",
                   return_value=_FakeResponse(_SAMPLE_HTML,
                                              final_url="https://example.com/docs")):
            envelope = asyncio.run(tool.run("https://example.com/docs"))
        assert envelope["status"] == "available"
        data = envelope["data"]
        assert data["title"] == "KorvixAI Docs"
        assert "Welcome to KorvixAI" in data["extracted_text"]
        # nav text dropped; script content dropped.
        assert "nav links" not in data["extracted_text"]
        assert "alert(" not in data["extracted_text"]
        assert "https://example.com/inner" in data["links"]

    def test_fetch_rejects_non_http(self):
        from backend.services.tools.browser_tool import BrowserFetchTool
        tool = BrowserFetchTool()
        envelope = asyncio.run(tool.run("ftp://example.com/file"))
        assert envelope["status"] == "error"
        assert "http" in envelope["message"].lower()

    def test_fetch_rejects_non_text_content(self):
        from backend.services.tools.browser_tool import BrowserFetchTool
        tool = BrowserFetchTool()
        with patch("backend.services.tools.browser_tool.urllib.request.urlopen",
                   return_value=_FakeResponse(b"\x00\x00binary",
                                              content_type="application/octet-stream",
                                              final_url="https://example.com/x")):
            envelope = asyncio.run(tool.run("https://example.com/x"))
        assert envelope["status"] == "error"
        assert "non-text" in (envelope["message"] or "").lower()


# ════════════════════════════════════════════════════════════════════════════
# D) GitHub tool
# ════════════════════════════════════════════════════════════════════════════

_GH_META = {
    "full_name": "openai/openai-python",
    "description": "The official Python library for the OpenAI API.",
    "default_branch": "main",
    "stargazers_count": 22000,
    "forks_count": 3100,
    "open_issues_count": 120,
    "language": "Python",
    "topics": ["openai", "sdk"],
    "license": {"name": "Apache-2.0"},
    "homepage": "https://github.com/openai/openai-python",
    "html_url": "https://github.com/openai/openai-python",
}

_GH_COMMITS = [
    {"sha": "abc123def456ghi", "html_url": "https://github.com/openai/openai-python/commit/abc",
     "commit": {"message": "Fix: handle 429 retries\n\nlong body", "author": {"name": "Alice", "date": "2026-05-01T10:00:00Z"}}},
    {"sha": "def456abc", "html_url": "",
     "commit": {"message": "Docs typo", "author": {"name": "Bob", "date": "2026-05-02T10:00:00Z"}}},
]

import base64 as _b64
_GH_README = {
    "encoding": "base64",
    "content": _b64.b64encode(b"# openai-python\n\nReadme body here.").decode("ascii"),
}


class TestGithubTool:

    def test_parses_owner_repo_string(self):
        from backend.services.tools.github_tool import _parse_owner_repo
        assert _parse_owner_repo("openai/openai-python") == ("openai", "openai-python")
        assert _parse_owner_repo("https://github.com/openai/openai-python") == ("openai", "openai-python")
        assert _parse_owner_repo("https://github.com/openai/openai-python.git") == ("openai", "openai-python")
        assert _parse_owner_repo("not-a-repo") is None
        assert _parse_owner_repo("") is None
        assert _parse_owner_repo("/leading-slash/repo") is None

    def test_fetches_repo_metadata_and_readme(self):
        from backend.services.tools.github_tool import GithubRepoTool, _request
        tool = GithubRepoTool()
        calls: list[str] = []
        def fake_request(path):
            calls.append(path)
            if path.endswith("/openai-python"):
                return (200, _GH_META)
            if "/commits" in path:
                return (200, _GH_COMMITS)
            if path.endswith("/readme"):
                return (200, _GH_README)
            return (404, {})
        with patch("backend.services.tools.github_tool._request", side_effect=fake_request):
            envelope = asyncio.run(tool.run("openai/openai-python"))
        assert envelope["status"] == "available"
        data = envelope["data"]
        assert data["full_name"] == "openai/openai-python"
        assert data["stars"] == 22000
        assert data["license"] == "Apache-2.0"
        assert "Readme body here." in data["readme_text"]
        assert len(data["recent_commits"]) == 2
        assert data["recent_commits"][0]["author"] == "Alice"
        # SHA truncated to 12 chars; message truncated to first line.
        assert len(data["recent_commits"][0]["sha"]) <= 12
        assert "\n" not in data["recent_commits"][0]["message"]

    def test_404_is_error(self):
        from backend.services.tools.github_tool import GithubRepoTool, _GitHubError
        tool = GithubRepoTool()
        def fake_request(path):
            raise _GitHubError("HTTP 404: Not Found", status=404)
        with patch("backend.services.tools.github_tool._request", side_effect=fake_request):
            envelope = asyncio.run(tool.run("nonexistent/repo"))
        assert envelope["status"] == "error"

    def test_rate_limit_marks_unavailable(self):
        from backend.services.tools.github_tool import GithubRepoTool, _GitHubError
        tool = GithubRepoTool()
        def fake_request(path):
            raise _GitHubError("HTTP 403: rate limit exceeded", status=403, rate_limited=True)
        with patch("backend.services.tools.github_tool._request", side_effect=fake_request):
            envelope = asyncio.run(tool.run("openai/openai-python"))
        # Rate-limit is surfaced as `unavailable` so the agent retries
        # via a different path instead of treating it as a hard failure.
        assert envelope["status"] == "unavailable"

    def test_invalid_input_returns_error(self):
        from backend.services.tools.github_tool import GithubRepoTool
        tool = GithubRepoTool()
        envelope = asyncio.run(tool.run("not a valid repo string"))
        assert envelope["status"] == "error"
