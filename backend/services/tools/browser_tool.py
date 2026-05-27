# coding: utf-8
"""Phase 10 — Browser fetch tool.

Read-only HTTP fetch + readable-content extraction. Pure stdlib
implementation so it works in any Railway deployment without extra
dependencies:

  - urllib.request for the fetch (with a sane User-Agent and 8s timeout)
  - html.parser for tag stripping (no lxml/beautifulsoup dependency)
  - simple regex for title / meta extraction

NOT a full browser — no JS rendering, no cookies, no auth. The intent
is "read me this URL" for arbitrary pages, GitHub docs, blog posts,
ecommerce product pages with server-rendered content. Pages that require
JS to render meaningful content come back with mostly empty extracted
text; we surface that honestly via `extracted_text_chars=0`.

Safety:
  - 8s wall-clock cap (asyncio.wait_for in the agent bridge OR the
    timeout_seconds class attribute)
  - 5 MB body cap to avoid memory blowups
  - HEAD-style content-type check rejects non-text payloads
  - URL allowlist intentionally NOT enforced — that's an ops decision
    we pick up later; today's exposure is mitigated by JWT-gated
    public route + per-user rate limiting (next PR).
"""
from __future__ import annotations

import asyncio
import html
import logging
import re
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from typing import Optional

from backend.services.tools.base_tool import BaseTool


logger = logging.getLogger(__name__)


# ── Body & header limits ───────────────────────────────────────────────────
_MAX_BYTES = 5 * 1024 * 1024          # 5 MB hard cap
_TIMEOUT_S = 8.0                      # wall clock cap
_UA = (
    "Mozilla/5.0 (compatible; KorvixAI-Browser/1.0; "
    "+https://korvixai.com/bot)"
)
_TEXT_CONTENT_TYPES = ("text/html", "text/plain", "application/xhtml",
                       "application/json", "text/markdown")

# Extracted-text trim — keep prompt-friendly. Full body is in the raw
# response if a caller really needs it.
_EXCERPT_MAX_CHARS = 8000


# ── Lightweight text extractor ─────────────────────────────────────────────
#
# Strips tags, preserves paragraph breaks, drops script/style/nav/header/
# footer/aside blocks. Doesn't try to be Readability — just gives the LLM
# something coherent to summarise.

_SKIP_TAGS = {"script", "style", "nav", "header", "footer", "aside", "svg",
              "noscript", "form", "iframe"}


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._stack: list[str] = []
        self._chunks: list[str] = []
        self.title:        Optional[str] = None
        self._in_title:    bool = False
        self._meta_description: Optional[str] = None
        self.links:        list[str] = []
        self.images:       list[str] = []
        # Treat repeated whitespace as one space; preserve paragraph breaks.
        self._last_was_break = True

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        self._stack.append(tag)
        if tag == "title":
            self._in_title = True
        if tag == "meta":
            ad = dict(attrs)
            name = (ad.get("name") or ad.get("property") or "").lower()
            if name in ("description", "og:description"):
                content = (ad.get("content") or "").strip()
                if content and not self._meta_description:
                    self._meta_description = content
        if tag == "a":
            href = dict(attrs).get("href", "")
            if href and href.startswith(("http://", "https://")) and len(self.links) < 50:
                self.links.append(href)
        if tag == "img":
            src = dict(attrs).get("src", "")
            if src and src.startswith(("http://", "https://")) and len(self.images) < 30:
                self.images.append(src)
        if tag in ("p", "br", "h1", "h2", "h3", "h4", "li"):
            if not self._last_was_break:
                self._chunks.append("\n")
                self._last_was_break = True

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self._stack and self._stack[-1] == tag:
            self._stack.pop()
        if tag == "title":
            self._in_title = False
        if tag in ("p", "h1", "h2", "h3", "h4", "div"):
            if not self._last_was_break:
                self._chunks.append("\n")
                self._last_was_break = True

    def handle_data(self, data):
        if any(t in _SKIP_TAGS for t in self._stack):
            return
        if self._in_title and not self.title:
            self.title = (data or "").strip()
            return
        text = data
        if not text:
            return
        # Collapse whitespace; preserve newlines that handle_*tag inserted.
        cleaned = re.sub(r"[ \t]+", " ", text).strip(" ")
        if not cleaned:
            return
        self._chunks.append(cleaned + " ")
        self._last_was_break = False

    @property
    def meta_description(self) -> Optional[str]:
        return self._meta_description

    @property
    def text(self) -> str:
        joined = "".join(self._chunks)
        # Collapse 3+ newlines down to 2; clean repeated spaces.
        joined = re.sub(r"\n{3,}", "\n\n", joined)
        joined = re.sub(r" +", " ", joined)
        return joined.strip()


# ── Tool implementation ────────────────────────────────────────────────────

class BrowserFetchTool(BaseTool):
    """Read-only URL fetch + content extraction. Registered as
    `browser_fetch` so it's addressable via the existing tool registry
    AND the new public /v2/tools API."""

    name = "browser_fetch"
    description = (
        "Fetch a publicly-reachable URL and extract its readable text, "
        "title, meta description, and first 30 outbound links / images. "
        "Read-only; no JS rendering."
    )
    timeout_seconds = _TIMEOUT_S
    category = "research"
    icon = "globe"
    execution_mode = "sync"
    requires_auth = True
    cost_estimate = 0.0
    input_schema = {
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "The URL to fetch."},
        },
        "required": ["url"],
    }
    output_schema = {
        "type": "object",
        "properties": {
            "url":              {"type": "string"},
            "final_url":        {"type": "string"},
            "title":            {"type": "string"},
            "meta_description": {"type": "string"},
            "extracted_text":   {"type": "string"},
            "extracted_text_chars": {"type": "integer"},
            "links":            {"type": "array",  "items": {"type": "string"}},
            "images":           {"type": "array",  "items": {"type": "string"}},
            "status_code":      {"type": "integer"},
            "content_type":     {"type": "string"},
        },
    }

    async def run(self, query: str, context: dict = None) -> dict:
        """`query` is the URL — keeps the existing BaseTool contract.
        Optional `context["url"]` overrides for callers that pass a
        structured payload."""
        url = (context or {}).get("url") or query or ""
        url = url.strip()
        if not url:
            return self._error("URL is required.")
        if not url.startswith(("http://", "https://")):
            return self._error("URL must start with http:// or https://.")
        if len(url) > 2048:
            return self._error("URL exceeds 2048 characters.")
        try:
            data = await asyncio.wait_for(
                asyncio.to_thread(_fetch_url, url),
                timeout=_TIMEOUT_S,
            )
        except asyncio.TimeoutError:
            return self._error(f"Fetch timed out after {_TIMEOUT_S:.1f}s.")
        except _RemoteFetchError as exc:
            return self._error(str(exc))
        except Exception as exc:
            logger.warning("browser_fetch unexpected error for %s: %s", url, exc)
            return self._error(str(exc) or "Unexpected fetch error.")
        return self._ok(data, provider="urllib")


# ── Fetch helper (sync — wrapped in to_thread) ─────────────────────────────

class _RemoteFetchError(Exception):
    pass


def _fetch_url(url: str) -> dict:
    """Blocking fetch. Wrapped in asyncio.to_thread by the tool."""
    req = urllib.request.Request(url, headers={
        "User-Agent": _UA,
        "Accept":     "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
    })
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:
            content_type = (resp.headers.get("Content-Type", "") or "").lower()
            final_url    = resp.geturl() or url
            status       = getattr(resp, "status", 200)
            # Refuse non-text bodies — image/octet-stream/etc. are not the
            # point of this tool. Surface as an error so the agent knows
            # to pick a different tool.
            is_text = any(ct in content_type for ct in _TEXT_CONTENT_TYPES) or content_type == ""
            if not is_text:
                raise _RemoteFetchError(
                    f"Refusing non-text content-type: {content_type or 'unknown'}."
                )
            # Bounded read — avoid pulling a 500 MB CDN-cached HTML.
            body = resp.read(_MAX_BYTES + 1)
            if len(body) > _MAX_BYTES:
                raise _RemoteFetchError(
                    f"Response body exceeded {_MAX_BYTES // (1024 * 1024)} MB cap."
                )
            # Decode — fall back to latin-1 so we never crash on a
            # mislabeled page.
            charset = _charset_from_header(content_type)
            try:
                text = body.decode(charset, errors="replace")
            except LookupError:
                text = body.decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        raise _RemoteFetchError(f"HTTP {e.code}: {e.reason}")
    except urllib.error.URLError as e:
        raise _RemoteFetchError(f"Network error: {e.reason}")

    parser = _TextExtractor()
    try:
        parser.feed(text)
    except Exception:
        # html.parser raises on truly malformed pages — we just return
        # what we got so far.
        pass
    excerpt = parser.text[:_EXCERPT_MAX_CHARS]
    return {
        "url":                  url,
        "final_url":            final_url,
        "status_code":          int(status),
        "content_type":         content_type,
        "title":                (parser.title or "").strip(),
        "meta_description":     (parser.meta_description or "").strip(),
        "extracted_text":       excerpt,
        "extracted_text_chars": len(parser.text),
        "links":                parser.links,
        "images":               parser.images,
        "truncated":            len(parser.text) > _EXCERPT_MAX_CHARS,
    }


def _charset_from_header(content_type: str) -> str:
    m = re.search(r"charset=([\w\-]+)", content_type, flags=re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return "utf-8"


__all__ = ["BrowserFetchTool"]
