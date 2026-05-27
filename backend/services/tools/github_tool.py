# coding: utf-8
"""Phase 10 — GitHub read-only tool.

Resolves a `<owner>/<repo>` (or a github.com URL) into:
  - canonical metadata (full_name, description, default_branch,
    stars, forks, primary_language, topics, license)
  - the README rendered as text (max 16 KB to keep prompts bounded)
  - the latest 10 commits on the default branch

Uses the public GitHub REST API. No auth required for public repos;
GITHUB_TOKEN (if set) raises the rate limit from 60/hour → 5000/hour
and is used silently. The token is NEVER returned in the tool output.

NOT implemented in this PR (explicit deferral):
  - file tree / file content fetch (next PR — needs path traversal
    guards and content-size budgets)
  - issue / PR reading
  - code search across multiple repos
  - per-user GitHub OAuth connection (the brief calls for it; that's
    its own OAuth scope and consent flow PR)

Safety:
  - public-only by default (no token → only public reads work; with
    token, repo access still respects the token's permissions)
  - 6s wall-clock cap
  - 200 KB body cap per request
  - URL parsing rejects anything outside the github.com domain
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import re
import urllib.error
import urllib.request
from typing import Optional

from backend.services.tools.base_tool import BaseTool


logger = logging.getLogger(__name__)


_API_BASE   = "https://api.github.com"
_TIMEOUT_S  = 6.0
_MAX_BYTES  = 200 * 1024
_README_MAX = 16 * 1024
_UA = "Mozilla/5.0 (compatible; KorvixAI-Github/1.0)"


def _token() -> Optional[str]:
    """Read GITHUB_TOKEN dynamically — flag flips don't need a restart."""
    t = (os.getenv("GITHUB_TOKEN") or "").strip()
    return t or None


# ── Owner/repo normalisation ───────────────────────────────────────────────

_OWNER_REPO_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.\-]{0,38}/[A-Za-z0-9][A-Za-z0-9_.\-]{0,99}$")


def _parse_owner_repo(query: str) -> Optional[tuple[str, str]]:
    """Accept either a github.com URL or a `<owner>/<repo>` string and
    return (owner, repo). Returns None on anything else — keeps the
    attack surface narrow."""
    s = (query or "").strip()
    if not s:
        return None
    if s.startswith(("http://", "https://")):
        m = re.match(
            r"^https?://(?:www\.)?github\.com/([A-Za-z0-9][A-Za-z0-9_.\-]+)/([A-Za-z0-9][A-Za-z0-9_.\-]+)(?:[/?#].*)?$",
            s,
        )
        if not m:
            return None
        return m.group(1), re.sub(r"\.git$", "", m.group(2))
    if _OWNER_REPO_RE.match(s):
        owner, repo = s.split("/", 1)
        return owner, repo
    return None


# ── HTTP ───────────────────────────────────────────────────────────────────

class _GitHubError(Exception):
    def __init__(self, message: str, *, status: Optional[int] = None,
                 rate_limited: bool = False):
        super().__init__(message)
        self.status = status
        self.rate_limited = rate_limited


def _request(path: str) -> tuple[int, dict | list | str]:
    """Blocking GitHub API GET. Returns (status, parsed_body)."""
    url = f"{_API_BASE}{path}"
    headers = {
        "User-Agent": _UA,
        "Accept":     "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    tok = _token()
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:
            status = getattr(resp, "status", 200)
            body = resp.read(_MAX_BYTES + 1)
            if len(body) > _MAX_BYTES:
                raise _GitHubError(
                    f"Response exceeded {_MAX_BYTES // 1024} KB cap for {path}",
                    status=status,
                )
            content_type = (resp.headers.get("Content-Type") or "").lower()
            if "application/json" in content_type:
                try:
                    parsed = json.loads(body.decode("utf-8", errors="replace"))
                except Exception:
                    parsed = {}
                return status, parsed
            return status, body.decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        # 403 with "rate limit exceeded" — surface separately so the
        # caller can mark the execution as rate_limited (vs. failed).
        rate_limited = False
        if e.code in (403, 429):
            try:
                txt = e.read().decode("utf-8", errors="replace")
                rate_limited = "rate limit" in txt.lower()
            except Exception:
                pass
        raise _GitHubError(f"GitHub HTTP {e.code}: {e.reason}",
                           status=e.code, rate_limited=rate_limited)
    except urllib.error.URLError as e:
        raise _GitHubError(f"Network error: {e.reason}")


# ── Tool ───────────────────────────────────────────────────────────────────

class GithubRepoTool(BaseTool):
    """`<owner>/<repo>` → metadata + README + recent commits.

    Registered as `github_repo`. The agent runtime invokes via the
    existing `tool_bridge.dispatch_one` path; the public /v2/github
    routes call the tool's `run()` directly through the execution
    log instrumentation.
    """

    name = "github_repo"
    description = (
        "Resolve a public GitHub repository (e.g. \"openai/openai-python\" "
        "or a github.com URL) into its metadata, README text, and the "
        "latest 10 commits on the default branch."
    )
    timeout_seconds = _TIMEOUT_S
    category = "code"
    icon = "github"
    execution_mode = "sync"
    requires_auth = True
    cost_estimate = 0.0
    input_schema = {
        "type": "object",
        "properties": {
            "repo": {
                "type": "string",
                "description": "<owner>/<repo> or a github.com URL.",
            },
        },
        "required": ["repo"],
    }
    output_schema = {
        "type": "object",
        "properties": {
            "owner":            {"type": "string"},
            "repo":             {"type": "string"},
            "full_name":        {"type": "string"},
            "description":      {"type": "string"},
            "default_branch":   {"type": "string"},
            "stars":            {"type": "integer"},
            "forks":            {"type": "integer"},
            "open_issues":      {"type": "integer"},
            "primary_language": {"type": "string"},
            "topics":           {"type": "array", "items": {"type": "string"}},
            "license":          {"type": "string"},
            "homepage":         {"type": "string"},
            "html_url":         {"type": "string"},
            "readme_text":      {"type": "string"},
            "recent_commits":   {"type": "array"},
        },
    }

    async def run(self, query: str, context: dict = None) -> dict:
        repo_str = (context or {}).get("repo") or query or ""
        parsed = _parse_owner_repo(repo_str)
        if parsed is None:
            return self._error("Provide a `<owner>/<repo>` or a github.com URL.")
        owner, repo = parsed
        try:
            meta = await asyncio.to_thread(_request, f"/repos/{owner}/{repo}")
            commits = await asyncio.to_thread(
                _request, f"/repos/{owner}/{repo}/commits?per_page=10",
            )
            readme = await asyncio.to_thread(
                _request, f"/repos/{owner}/{repo}/readme",
            )
        except _GitHubError as exc:
            if exc.rate_limited:
                # Use _unavailable so the agent knows to back off, not
                # treat it as a hard tool failure.
                return self._unavailable(
                    "GitHub rate limit reached. Set GITHUB_TOKEN to lift "
                    "the per-hour limit, or try again later.",
                )
            if exc.status == 404:
                return self._error(f"Repository '{owner}/{repo}' not found.")
            return self._error(str(exc))
        except Exception as exc:
            logger.warning("github_repo unexpected error for %s/%s: %s",
                           owner, repo, exc)
            return self._error(str(exc) or "Unexpected GitHub error.")

        meta_status, meta_body = meta
        commits_status, commits_body = commits
        readme_status, readme_body = readme
        if meta_status >= 400 or not isinstance(meta_body, dict):
            return self._error(f"GitHub returned HTTP {meta_status} for repo metadata.")

        # ── Compose ───────────────────────────────────────────────────────
        readme_text = ""
        if (readme_status == 200 and isinstance(readme_body, dict)
                and readme_body.get("encoding") == "base64"
                and isinstance(readme_body.get("content"), str)):
            try:
                raw = base64.b64decode(readme_body["content"])
                readme_text = raw.decode("utf-8", errors="replace")[:_README_MAX]
            except Exception:
                readme_text = ""

        license_name = ""
        if isinstance(meta_body.get("license"), dict):
            license_name = (meta_body["license"].get("name") or "").strip()

        recent_commits = []
        if commits_status == 200 and isinstance(commits_body, list):
            for c in commits_body[:10]:
                if not isinstance(c, dict):
                    continue
                commit = c.get("commit") or {}
                author = (commit.get("author") or {}) if isinstance(commit, dict) else {}
                recent_commits.append({
                    "sha":     (c.get("sha") or "")[:12],
                    "message": (commit.get("message") or "").split("\n", 1)[0][:200],
                    "author":  author.get("name") or "",
                    "date":    author.get("date") or "",
                    "url":     c.get("html_url") or "",
                })

        result = {
            "owner":            owner,
            "repo":             repo,
            "full_name":        meta_body.get("full_name") or f"{owner}/{repo}",
            "description":      meta_body.get("description") or "",
            "default_branch":   meta_body.get("default_branch") or "main",
            "stars":            int(meta_body.get("stargazers_count") or 0),
            "forks":            int(meta_body.get("forks_count") or 0),
            "open_issues":      int(meta_body.get("open_issues_count") or 0),
            "primary_language": meta_body.get("language") or "",
            "topics":           list(meta_body.get("topics") or []),
            "license":          license_name,
            "homepage":         meta_body.get("homepage") or "",
            "html_url":         meta_body.get("html_url") or f"https://github.com/{owner}/{repo}",
            "readme_text":      readme_text,
            "readme_truncated": len(readme_text) >= _README_MAX,
            "recent_commits":   recent_commits,
        }
        return self._ok(result, provider="github")


__all__ = ["GithubRepoTool"]
