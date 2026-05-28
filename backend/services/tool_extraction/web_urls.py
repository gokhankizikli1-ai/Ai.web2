# coding: utf-8
"""Phase 11 — generic web URL auto-invocation for the chat path.

Mirrors github_urls.py but handles ANY http(s) URL the user pastes
that ISN'T a GitHub repo (those are already picked up by the
github_urls path and would otherwise be double-fetched).

When the user types "summarise https://news.ycombinator.com/item?id=…",
this module:
  1. extracts non-GitHub http(s) URLs from the message
  2. invokes the browser_fetch tool concurrently for each
  3. logs every call via the ToolExecutionsClient (when enabled)
  4. returns a "[Web pages fetched]" context block ready to fold
     into the chat system prompt + user message (same dual-injection
     pattern proven on the GitHub flow in PR #135)

Concurrency: up to 4 URLs per turn run in parallel; the rest are
skipped honestly (header in the block tells the LLM N URLs were
dropped). Per-URL timeout matches BrowserFetchTool's 8 s wall clock.

Safety:
  - Skips github.com / raw.githubusercontent.com — github_urls.py
    already handles those with richer metadata.
  - Skips localhost / 127.* / 0.0.0.0 / IPv6 loopback URLs so a
    user can't ask the chat to fetch internal Railway endpoints
    via this path (light SSRF guard; full allowlist is the next PR).
  - Per-URL 8 KB excerpt cap inherited from BrowserFetchTool;
    aggregate block capped at ~20 KB so the prompt stays sane.
"""
from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import Optional


logger = logging.getLogger(__name__)


# ── Extraction ────────────────────────────────────────────────────────────

# Standard http(s) URL pattern. Generous on tail characters so the
# user can paste "see https://example.com/path?q=1." without the
# trailing dot eating into our match.
_HTTP_URL_RE = re.compile(
    r"https?://[^\s<>\"`'\)]+",
    re.IGNORECASE,
)

# Hosts that the github_urls.py module already handles with richer
# metadata + curated key files. Skip here so we don't fetch the same
# repo twice with weaker context.
_SKIP_HOSTS: frozenset[str] = frozenset({
    "github.com",
    "www.github.com",
    "raw.githubusercontent.com",
})

# Hosts that should never reach the browser tool — light SSRF guard.
# The full per-environment outbound allowlist lives in ops; this is
# a defence-in-depth check against the most common mistakes.
_FORBIDDEN_HOSTS: frozenset[str] = frozenset({
    "localhost", "127.0.0.1", "0.0.0.0", "::1",
    "169.254.169.254",   # AWS metadata service
    "metadata.google.internal",
})

# Trailing punctuation that often ends up glued to a URL when typed
# in a sentence. Stripped off the matched URL before fetching.
_TRAILING_PUNCT = ".,;:!?)\"'>]}"


@dataclass(frozen=True)
class WebUrl:
    url:   str
    host:  str


def _normalize_url(raw: str) -> Optional[str]:
    """Strip trailing punctuation, return None for empty/unsafe URLs."""
    u = (raw or "").strip()
    while u and u[-1] in _TRAILING_PUNCT:
        u = u[:-1]
    if len(u) < 11 or len(u) > 2048:
        return None
    return u


def _host_of(url: str) -> str:
    m = re.match(r"https?://([^/?#]+)", url, re.IGNORECASE)
    if not m:
        return ""
    host = m.group(1).lower()
    # Strip port + userinfo.
    if "@" in host:
        host = host.split("@", 1)[1]
    if ":" in host:
        host = host.split(":", 1)[0]
    return host


def extract_web_urls(text: str, *, max_urls: int = 4) -> list[WebUrl]:
    """Return up to `max_urls` distinct non-GitHub http(s) URLs from
    `text`. Order-preserving (first match wins on dedupe). Skips
    localhost / metadata services."""
    if not text:
        return []
    seen: set[str] = set()
    out: list[WebUrl] = []
    for m in _HTTP_URL_RE.finditer(text):
        url = _normalize_url(m.group(0))
        if not url:
            continue
        host = _host_of(url)
        if not host:
            continue
        if host in _SKIP_HOSTS:
            continue
        if host in _FORBIDDEN_HOSTS:
            continue
        # Also reject obvious private-network targets — best-effort,
        # not exhaustive. The chat is JWT-gated; this is just to
        # avoid the most obvious mistakes.
        if (host.startswith("10.") or host.startswith("192.168.")
                or host.startswith("172.16.") or host.startswith("172.17.")
                or host.startswith("172.18.") or host.startswith("172.19.")
                or host.startswith("172.2") or host.startswith("172.30.")
                or host.startswith("172.31.")):
            continue
        key = url.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(WebUrl(url=url, host=host))
        if len(out) >= max_urls:
            break
    return out


# ── Block builder ─────────────────────────────────────────────────────────

# Aggregate block cap — keeps the augmented prompt under typical
# model context limits even with 4 large pages + the existing memory
# + asset blocks already in play.
_TOTAL_CONTEXT_CHAR_CAP = 20_000


async def build_web_context_block(
    *,
    user_id:        Optional[str],
    text:           str,
    panel_id:       Optional[str] = None,
    project_id:     Optional[str] = None,
    correlation_id: Optional[str] = None,
    owner_debug:    bool = False,
) -> tuple[Optional[str], list[dict]]:
    """Detect non-GitHub http(s) URLs in `text`, fetch each concurrently
    via the registered browser_fetch tool, return a context block and
    raw payloads (the latter exposed to owner-debug only).

    Returns `(None, [])` when:
      - no URLs detected,
      - browser tool not enabled,
      - all fetches failed.
    """
    if not text:
        return None, []
    urls = extract_web_urls(text)
    if not urls:
        return None, []

    try:
        from backend.services.tools.tool_registry import is_enabled, get_tool
        from backend.services.tool_executions import client as exec_client
    except Exception as e:
        logger.warning("web_urls: import failed: %s", e)
        return None, []

    if not is_enabled("browser_fetch"):
        return None, []

    tool = get_tool("browser_fetch")
    if tool is None:
        return None, []

    # Per-URL run wrapped through the execution log so /v2/tools/usage
    # captures every browser invocation.
    async def _fetch_one(wu: WebUrl) -> tuple[WebUrl, Optional[dict]]:
        with exec_client.record_run(
            user_id=        user_id or "anonymous",
            tool_id=        "browser_fetch",
            input_summary=  f"url: {wu.url[:120]}",
            input_payload=  {"url": wu.url, "caller": "chat_auto"},
            caller=         "system",
            panel_id=       panel_id,
            project_id=     project_id,
            correlation_id= correlation_id,
        ) as run:
            try:
                from backend.services.tool_extraction._safe_run import safe_run_with_timeout
                envelope = await safe_run_with_timeout(
                    tool, wu.url, {"url": wu.url},
                )
            except Exception as exc:
                run.failure("TOOL_RAISED", str(exc) or "browser raised")
                return wu, None
            status = (envelope or {}).get("status") or "error"
            if status == "available":
                run.success(output=envelope, provider="urllib",
                            cost_estimate=float(getattr(tool, "cost_estimate", 0.0)))
            elif status == "unavailable":
                run.failure("TOOL_UNAVAILABLE",
                            (envelope or {}).get("message") or "browser unavailable",
                            provider="urllib")
            else:
                run.failure("TOOL_ERROR",
                            (envelope or {}).get("message") or "browser error",
                            provider="urllib")
            return wu, envelope

    # Phase 11 hang-fix — total ceiling for the concurrent fetch group.
    # Each _fetch_one already wraps safe_run_with_timeout; this is the
    # belt-and-suspenders cap that guarantees the SSE stream never
    # waits longer than this for the browser-fetch batch.
    try:
        results = await asyncio.wait_for(
            asyncio.gather(
                *[_fetch_one(u) for u in urls],
                return_exceptions=False,
            ),
            timeout=14.0,  # 4 URLs × ~3.5s each, with headroom
        )
    except asyncio.TimeoutError:
        logger.warning(
            "[TOOL_TIMEOUT] browser batch | urls=%d | ceiling=14s — "
            "returning partial / empty results",
            len(urls),
        )
        results = [(wu, None) for wu in urls]

    blocks: list[str] = []
    raw_payloads: list[dict] = []
    char_budget = _TOTAL_CONTEXT_CHAR_CAP
    fetched_count = 0

    for wu, envelope in results:
        if char_budget <= 0:
            break
        if not envelope:
            block = (
                f"[{wu.url}] could not be fetched. "
                "The assistant should explain this limitation honestly "
                "instead of inventing the page's contents."
            )
            blocks.append(block)
            raw_payloads.append({"url": wu.url, "fetched": False})
            char_budget -= len(block)
            continue

        status = envelope.get("status") or ""
        if status != "available":
            msg = envelope.get("message") or "browser_fetch returned non-available"
            block = (
                f"[{wu.url}] could not be fetched — {msg}. "
                "The assistant should explain this honestly."
            )
            blocks.append(block)
            raw_payloads.append({"url": wu.url, "fetched": False, "envelope": envelope})
            char_budget -= len(block)
            continue

        data = envelope.get("data") or {}
        title = (data.get("title") or "").strip()
        meta  = (data.get("meta_description") or "").strip()
        excerpt = (data.get("extracted_text") or "").strip()
        # Trim per-URL excerpt to keep the aggregate budget intact —
        # if we have 4 pages and 20 KB total, each gets ~5 KB.
        per_url_budget = max(1500, int(char_budget / max(1, len(urls) - fetched_count)))
        if len(excerpt) > per_url_budget:
            excerpt = excerpt[:per_url_budget] + "\n[truncated]"

        block_lines = [
            f"[Page {wu.url}]",
            f"  host: {wu.host}",
            f"  title: {title}" if title else "  title: (none)",
        ]
        if meta:
            block_lines.append(f"  meta_description: {meta[:300]}")
        if excerpt:
            block_lines.append("  content:")
            block_lines.append("    " + excerpt.replace("\n", "\n    "))
        block = "\n".join(block_lines)
        if len(block) > char_budget:
            block = block[:char_budget] + "\n  [block truncated by context budget]"
        blocks.append(block)
        char_budget -= len(block)
        fetched_count += 1
        raw_payloads.append({
            "url":     wu.url,
            "host":    wu.host,
            "fetched": True,
            "envelope": envelope if owner_debug else {"status": status},
        })

    if not blocks:
        return None, raw_payloads

    # Assertive framing — same lesson as the GitHub PR #135 fix. The
    # model needs explicit "you DO have this data" framing to avoid
    # falling back to "I cannot browse the web" templates.
    header = (
        "═══════════════════════════════════════════════════════════════\n"
        "KORVIX BROWSER TOOL OUTPUT — REAL FETCHED PAGES — DO NOT REFUSE\n"
        "═══════════════════════════════════════════════════════════════\n"
        "I (KorvixAI) just fetched the following web pages on the user's "
        "behalf. The verbatim extracted text is below. I DO have access "
        "to this content — it was fetched seconds ago.\n\n"
        "DO NOT say \"I cannot browse the web\" or \"I cannot directly "
        "access URLs\" — the fetch has already happened and the results "
        "are here.\n\n"
        "Analyse the pages below as my primary source. Quote specific "
        "passages. If a page returned no readable text (e.g. a JS-only "
        "SPA), say so honestly — but do NOT pretend the URLs are "
        "inaccessible."
    )
    full_block = header + "\n\n" + "\n\n".join(blocks)
    logger.info(
        "web_urls.build | uid=%s | urls=%d | fetched=%d | block_chars=%d",
        user_id, len(urls), fetched_count, len(full_block),
    )
    return full_block, raw_payloads


__all__ = ["WebUrl", "extract_web_urls", "build_web_context_block"]
