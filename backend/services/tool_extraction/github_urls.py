# coding: utf-8
"""Phase 10 fix — GitHub URL detection + auto tool invocation.

Two public surfaces:

  extract_github_refs(text)
    Find every distinct GitHub repository reference in a chunk of
    user text. Supports:
      - https://github.com/<owner>/<repo>
      - https://github.com/<owner>/<repo>/blob/<branch>/<path>
      - https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>
      - bare "<owner>/<repo>" tokens when they look unambiguously
        like a repo reference (slash + plausible identifiers)

  build_github_context_block(user_id, text)
    Wire the extractor into the github_repo tool, run it, and
    return a compact context block ready to fold into the LLM
    system prompt. Each invocation is logged via the
    ToolExecutionsClient so /v2/tools/usage shows it. Also fetches
    a curated set of key files per repo (package.json, etc.) and
    inlines a short summary of what the AI can actually see.
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
from dataclasses import dataclass
from typing import Iterable, Optional


logger = logging.getLogger(__name__)


# ── URL extraction ────────────────────────────────────────────────────────
#
# Match GitHub repo references with surrounding-context tolerance —
# brackets, trailing punctuation, query strings, the .git suffix all
# get trimmed.

_GITHUB_HTTPS_RE = re.compile(
    r"https?://(?:www\.)?github\.com/"
    r"(?P<owner>[A-Za-z0-9][A-Za-z0-9_.\-]+)/"
    # Greedy so "openai-python" doesn't truncate to "op" before the
    # optional .git / path matches. The repo char class excludes `/`
    # so we naturally stop at the next path segment.
    r"(?P<repo>[A-Za-z0-9][A-Za-z0-9_\-]*(?:\.[A-Za-z0-9_\-]+)*)"
    r"(?:\.git)?(?:[/?#][^\s)>]*)?",
    re.IGNORECASE,
)

_RAW_HTTPS_RE = re.compile(
    r"https?://raw\.githubusercontent\.com/"
    r"(?P<owner>[A-Za-z0-9][A-Za-z0-9_.\-]+)/"
    r"(?P<repo>[A-Za-z0-9][A-Za-z0-9_.\-]+)"
    r"/[^/\s]+/[^\s]+",
    re.IGNORECASE,
)

# Bare "owner/repo" — only matched when both sides look like real
# identifiers AND the surrounding context is "repo-like" (the word
# "github", "repo", "repository" within ~40 chars). Without that
# guard we'd false-positive on every "key/value" or "path/file"
# the user typed.
_OWNER_REPO_TOKEN_RE = re.compile(
    r"(?<![\w/])"
    r"(?P<owner>[A-Za-z0-9][A-Za-z0-9_.\-]{1,38})"
    r"/"
    r"(?P<repo>[A-Za-z0-9][A-Za-z0-9_.\-]{1,99})"
    r"(?![\w/])"
)


@dataclass(frozen=True)
class GitHubRef:
    owner: str
    repo:  str
    @property
    def full_name(self) -> str:
        return f"{self.owner}/{self.repo}"


def _normalize_repo_name(repo: str) -> str:
    # Strip a trailing .git or surrounding punctuation that snuck past
    # the regex.
    r = (repo or "").strip().rstrip(".,;:!?)>]>")
    if r.endswith(".git"):
        r = r[:-4]
    return r


def extract_github_refs(text: str, *, max_refs: int = 5) -> list[GitHubRef]:
    """Return a list of unique GitHub references found in `text`.

    Order-preserving — the first match in the message comes first.
    Capped at `max_refs` so a pasted README full of links can't fan
    out a hundred API calls.
    """
    if not text:
        return []
    out: list[GitHubRef] = []
    seen: set[str] = set()

    def _add(owner: str, repo: str) -> None:
        o = (owner or "").strip()
        r = _normalize_repo_name(repo)
        if not (o and r):
            return
        key = f"{o.lower()}/{r.lower()}"
        if key in seen:
            return
        seen.add(key)
        out.append(GitHubRef(owner=o, repo=r))

    # 1) Explicit https URLs (github.com + raw.githubusercontent.com).
    for m in _GITHUB_HTTPS_RE.finditer(text):
        _add(m.group("owner"), m.group("repo"))
        if len(out) >= max_refs:
            return out
    for m in _RAW_HTTPS_RE.finditer(text):
        _add(m.group("owner"), m.group("repo"))
        if len(out) >= max_refs:
            return out

    # 2) Bare "owner/repo" — only when the word "github" or "repo"
    #    is in the message AND only over text with URLs stripped out
    #    (otherwise we'd double-extract "github.com/owner" tokens
    #    from inside the URL itself).
    text_no_urls = re.sub(r"https?://\S+", " ", text)
    if re.search(r"\b(github|repo(?:sitory)?)\b", text, flags=re.IGNORECASE):
        for m in _OWNER_REPO_TOKEN_RE.finditer(text_no_urls):
            owner = m.group("owner")
            repo = _normalize_repo_name(m.group("repo"))
            # Skip obvious path-like noise — "src/components",
            # "tests/data", etc. Heuristic: at least one side must
            # contain a digit OR a dot OR an uppercase letter, OR
            # both sides are longer than 3 chars and look identifier-y.
            looks_like_repo = (
                any(c.isdigit() or c == "." or c.isupper() for c in owner + repo)
                or (len(owner) >= 3 and len(repo) >= 3)
            )
            if not looks_like_repo:
                continue
            # Filter known false-positive owners.
            if owner.lower() in {
                "src", "tests", "docs", "lib", "node_modules", "components",
                "pages", "hooks", "utils", "services", "build", "dist",
                "app", "public", "scripts", "package", "json", "yaml",
            }:
                continue
            _add(owner, repo)
            if len(out) >= max_refs:
                return out

    return out


# ── Curated key files ─────────────────────────────────────────────────────
#
# These are the files an architecture analysis usually needs. We fetch
# them in addition to the standard metadata + README + commits the
# github_repo tool already returns. Capped at 8 KB per file so the
# prompt doesn't blow past the model's context window.

_KEY_FILES: tuple[str, ...] = (
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "Pipfile",
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    "vite.config.ts",
    "vite.config.js",
    "next.config.js",
    "next.config.mjs",
    "tsconfig.json",
    "go.mod",
    "Cargo.toml",
    ".github/workflows/ci.yml",
    ".github/workflows/main.yml",
)

_KEY_FILE_MAX_BYTES = 8 * 1024
_API_BASE = "https://api.github.com"
_FETCH_TIMEOUT_S = 6.0
_UA = "Mozilla/5.0 (compatible; KorvixAI-Github/1.0)"


def _gh_token() -> Optional[str]:
    t = (os.getenv("GITHUB_TOKEN") or "").strip()
    return t or None


def _fetch_file_sync(owner: str, repo: str, path: str) -> Optional[dict]:
    """Sync GET /repos/{owner}/{repo}/contents/{path}. Returns
    {path, bytes, content, truncated} or None on any failure.

    Wrapped in to_thread by the caller so the bus loop isn't blocked.
    """
    url = f"{_API_BASE}/repos/{owner}/{repo}/contents/{path}"
    headers = {
        "User-Agent": _UA,
        "Accept":     "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    tok = _gh_token()
    if tok:
        headers["Authorization"] = f"Bearer {tok}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=_FETCH_TIMEOUT_S) as resp:
            body = resp.read(64 * 1024)   # 64 KB JSON envelope cap
            parsed = json.loads(body.decode("utf-8", errors="replace"))
    except urllib.error.HTTPError:
        return None
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    if parsed.get("encoding") != "base64":
        return None
    content_b64 = parsed.get("content") or ""
    try:
        raw = base64.b64decode(content_b64)
    except Exception:
        return None
    truncated = len(raw) > _KEY_FILE_MAX_BYTES
    text = raw[:_KEY_FILE_MAX_BYTES].decode("utf-8", errors="replace")
    return {
        "path":      path,
        "size":      len(raw),
        "content":   text,
        "truncated": truncated,
    }


async def _fetch_key_files(owner: str, repo: str) -> list[dict]:
    """Fetch every file in _KEY_FILES that exists on the default
    branch. Concurrent — capped at ~16 simultaneous outbound calls
    via asyncio.gather; per-file 6s timeout."""
    async def _one(path: str):
        try:
            return await asyncio.wait_for(
                asyncio.to_thread(_fetch_file_sync, owner, repo, path),
                timeout=_FETCH_TIMEOUT_S,
            )
        except asyncio.TimeoutError:
            return None
        except Exception:
            return None
    results = await asyncio.gather(*[_one(p) for p in _KEY_FILES])
    return [r for r in results if r]


# ── Block builder ─────────────────────────────────────────────────────────

# Single-call cap so a "compare these 5 repos" query doesn't fan into
# 40+ outbound GitHub API hits.
_PER_REPO_KEY_FILE_BUDGET = 6
_TOTAL_CONTEXT_CHAR_CAP   = 24_000   # ~6k tokens — leaves room for the rest of the prompt


async def build_github_context_block(
    *,
    user_id:        Optional[str],
    text:           str,
    panel_id:       Optional[str] = None,
    project_id:     Optional[str] = None,
    correlation_id: Optional[str] = None,
    owner_debug:    bool = False,
) -> tuple[Optional[str], list[dict]]:
    """Detect GitHub references in `text`, invoke the github_repo tool
    for each, optionally fetch a curated set of key files, and return
    `(block_text, raw_payloads)`.

    `raw_payloads` is the structured payload the owner-debug surface
    exposes. Non-owners get only `block_text` (the LLM-prompt block).

    Returns `(None, [])` when:
      - no GitHub references detected
      - GitHub tool not enabled
      - all invocations failed
    """
    if not text:
        return None, []
    refs = extract_github_refs(text)
    if not refs:
        return None, []

    # Lazy imports — keep this module cheap to import even when the
    # GitHub tool is off.
    try:
        from backend.services.tools.tool_registry import is_enabled, get_tool
        from backend.services.tool_executions import client as exec_client
    except Exception as e:
        logger.warning("github_url: import failed: %s", e)
        return None, []

    if not is_enabled("github_repo"):
        return None, []

    tool = get_tool("github_repo")
    if tool is None:
        return None, []

    raw_payloads: list[dict] = []
    blocks:       list[str]  = []
    char_budget = _TOTAL_CONTEXT_CHAR_CAP

    for ref in refs:
        if char_budget <= 0:
            break
        # 1) Run the canonical tool through the execution log so
        #    /v2/tools/usage and the FE timeline both see it.
        envelope: dict = {}
        with exec_client.record_run(
            user_id=        user_id or "anonymous",
            tool_id=        "github_repo",
            input_summary=  f"repo: {ref.full_name}",
            input_payload=  {"repo": ref.full_name, "caller": "chat_auto"},
            caller=         "system",
            panel_id=       panel_id,
            project_id=     project_id,
            correlation_id= correlation_id,
        ) as run:
            try:
                envelope = await tool.safe_run(ref.full_name, {"repo": ref.full_name})
            except Exception as exc:
                run.failure("TOOL_RAISED", str(exc) or "tool raised unexpectedly")
                continue
            status = (envelope or {}).get("status") or "error"
            if status == "available":
                run.success(output=envelope, provider="github",
                            cost_estimate=float(getattr(tool, "cost_estimate", 0.0)))
            elif status == "unavailable":
                run.failure("TOOL_UNAVAILABLE",
                            (envelope or {}).get("message") or "unavailable",
                            provider="github")
            else:
                run.failure("TOOL_ERROR",
                            (envelope or {}).get("message") or "error",
                            provider="github")

        data = (envelope or {}).get("data") or {}
        if not data:
            # Tool returned a non-available envelope — surface it in the
            # context block honestly so the LLM tells the user why.
            msg = (envelope or {}).get("message") or "Repository unavailable."
            block = (
                f"[Repository {ref.full_name}] could not be inspected — {msg}\n"
                f"  → The assistant should explain this limitation honestly "
                f"instead of guessing about the repository's contents."
            )
            blocks.append(block)
            raw_payloads.append({
                "ref": ref.full_name,
                "envelope": envelope,
                "inspected": False,
            })
            char_budget -= len(block)
            continue

        # 2) Optional curated key-file fetch. Skipped silently on rate
        #    limit / token absence — the metadata block is still useful.
        key_files: list[dict] = []
        try:
            files = await _fetch_key_files(ref.owner, ref.repo)
            key_files = files[:_PER_REPO_KEY_FILE_BUDGET]
        except Exception as e:
            logger.debug("github_url: key-file fetch failed for %s: %s",
                         ref.full_name, e)

        # 3) Compose the block. Honest about truncation.
        sections: list[str] = []
        sections.append(
            f"[Repository {data.get('full_name') or ref.full_name}] "
            f"{data.get('description') or '(no description)'}"
        )
        meta_line = (
            f"  stars={data.get('stars', 0)}  forks={data.get('forks', 0)}  "
            f"open_issues={data.get('open_issues', 0)}  "
            f"primary_language={data.get('primary_language') or 'unknown'}  "
            f"license={data.get('license') or 'unknown'}"
        )
        sections.append(meta_line)
        topics = data.get("topics") or []
        if topics:
            sections.append(f"  topics: {', '.join(str(t) for t in topics[:12])}")
        readme = (data.get("readme_text") or "").strip()
        if readme:
            sections.append("  README (first ~6KB):")
            sections.append("    " + readme[:6000].replace("\n", "\n    "))
            if data.get("readme_truncated"):
                sections.append("    [README truncated — caller may fetch in full]")
        commits = data.get("recent_commits") or []
        if commits:
            sections.append("  Recent commits:")
            for c in commits[:6]:
                msg = (c.get("message") or "").strip().replace("\n", " ")[:140]
                sections.append(
                    f"    - {c.get('sha', '')[:8]} "
                    f"({c.get('author') or 'unknown'}, {c.get('date') or '?'}): {msg}"
                )
        if key_files:
            sections.append("  Key files (truncated to 8KB each):")
            for kf in key_files:
                sections.append(
                    f"    --- {kf['path']} ({kf['size']} bytes"
                    f"{', truncated' if kf['truncated'] else ''}) ---"
                )
                # Indent file contents so the prompt is unambiguously
                # structured.
                indented = kf["content"].replace("\n", "\n      ")
                sections.append("      " + indented)

        block = "\n".join(sections)
        if len(block) > char_budget:
            block = block[:char_budget] + "\n  [block truncated by context budget]"
        blocks.append(block)
        char_budget -= len(block)

        raw_payloads.append({
            "ref":       ref.full_name,
            "inspected": True,
            "envelope":  envelope if owner_debug else {"status": (envelope or {}).get("status")},
            "key_files": key_files if owner_debug else [
                {"path": kf["path"], "size": kf["size"], "truncated": kf["truncated"]}
                for kf in key_files
            ],
        })

    if not blocks:
        return None, raw_payloads

    # Header is intentionally assertive — production observations
    # showed that GPT-4o has a strong reflex to refuse questions
    # containing github.com URLs with "I cannot directly inspect
    # GitHub repositories" even when grounding data is provided.
    # Making the framing forceful + first-person stops the refusal
    # pattern. Tested on gpt-4o / gpt-4o-mini / claude-3.5-sonnet.
    header = (
        "═══════════════════════════════════════════════════════════════\n"
        "KORVIX GITHUB TOOL OUTPUT — REAL DATA — DO NOT REFUSE\n"
        "═══════════════════════════════════════════════════════════════\n"
        "I (KorvixAI) just ran my GitHub tool against the repository "
        "URL(s) the user mentioned. The verbatim API response is below. "
        "I DO have access to this data — it was fetched seconds ago. \n\n"
        "DO NOT say \"I cannot directly inspect GitHub repositories\" — "
        "the inspection has already been done and the results are here.\n\n"
        "Analyse the data below as my primary source. Cite the actual "
        "stars / language / README / commits / key-file contents I "
        "fetched. If something is missing from this block (e.g. a "
        "specific file the user asked about), say so honestly — but "
        "do NOT pretend the whole repository is inaccessible."
    )
    full_block = header + "\n\n" + "\n\n".join(blocks)
    return full_block, raw_payloads


__all__ = [
    "GitHubRef",
    "extract_github_refs",
    "build_github_context_block",
]
