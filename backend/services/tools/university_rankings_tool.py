# coding: utf-8
"""Phase 11 — University rankings tool.

Structured extractor for global university rankings (QS, THE, ARWU,
US News, Forbes, etc.). The tool fetches Wikipedia's well-maintained
ranking pages and parses the live HTML table to return clean
{rank, name, country, score}-shaped rows.

Why Wikipedia and not the official ranking sites?

QS (topuniversities.com), THE (timeshighereducation.com), ARWU
(shanghairanking.com) all serve their rankings via JavaScript-rendered
SPAs. KorvixAI's browser_fetch tool is pure stdlib — no headless
browser, no JS execution — so the official pages return mostly empty
text. Wikipedia mirrors every major ranking inside server-rendered
`<table class="wikitable">` blocks that we CAN parse reliably with
html.parser, and the Wikipedia editorial process keeps the data
honest (citations required; vandalism reverted within minutes for
high-traffic articles).

Output is NEVER guessed — if the table can't be parsed or the
requested ranking page can't be reached, we surface `_unavailable`
with a clear reason so the assistant explains the limit honestly
rather than hallucinating ranks.

Activation chain (all flags ship off):
  ENABLE_TOOLS=true
  ENABLE_UNIVERSITY_RANKINGS=true  (new — registered in tool_registry)
"""
from __future__ import annotations

import asyncio
import logging
import re
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from typing import Optional

from backend.services.tools.base_tool import BaseTool


logger = logging.getLogger(__name__)


# ── Source registry ───────────────────────────────────────────────────────
#
# Each entry maps a normalised ranking key to the Wikipedia article that
# carries the most recent year's table. The wiki article titles are
# stable across years — Wikipedia keeps the "latest" table at the top
# of each article. Adding a ranking later is a one-line table addition.
_SOURCES: dict[str, dict] = {
    "qs": {
        "page": "QS_World_University_Rankings",
        "label": "QS World University Rankings",
    },
    "the": {
        "page": "Times_Higher_Education_World_University_Rankings",
        "label": "Times Higher Education World University Rankings",
    },
    "arwu": {
        "page": "Academic_Ranking_of_World_Universities",
        "label": "Academic Ranking of World Universities (Shanghai)",
    },
    "us_news": {
        "page": "U.S._News_%26_World_Report_Best_Global_Universities_Ranking",
        "label": "U.S. News Best Global Universities Ranking",
    },
    "cwur": {
        "page": "Center_for_World_University_Rankings",
        "label": "Center for World University Rankings",
    },
}


_WIKIPEDIA_BASE = "https://en.wikipedia.org/wiki/"
_TIMEOUT_S = 8.0
_MAX_BYTES = 3 * 1024 * 1024   # 3 MB cap — Wikipedia ranking pages are ~1.5 MB
_UA = "Mozilla/5.0 (compatible; KorvixAI-Rankings/1.0)"


# ── HTML table parser ─────────────────────────────────────────────────────
#
# Scans Wikipedia pages for the first <table class="wikitable …">
# whose header row looks like a ranking table (contains "Rank" or
# "Name" or "University"). Captures rows as lists of cells.

class _WikitableExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self._in_table = False
        self._is_wikitable = False
        self._current_table: list[list[str]] = []
        self._in_row = False
        self._current_row: list[str] = []
        self._in_cell = False
        self._current_cell_chunks: list[str] = []
        self._depth_in_cell = 0

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag == "table":
            classes = dict(attrs).get("class", "") or ""
            if "wikitable" in classes.lower():
                self._in_table = True
                self._is_wikitable = True
                self._current_table = []
            else:
                # Nested non-wikitable table inside a wikitable cell —
                # treat content as cell text but don't open a new row
                # scope.
                if self._in_cell:
                    self._depth_in_cell += 1
        elif tag == "tr" and self._in_table:
            self._in_row = True
            self._current_row = []
        elif tag in ("td", "th") and self._in_row:
            self._in_cell = True
            self._current_cell_chunks = []
        elif tag == "br" and self._in_cell:
            self._current_cell_chunks.append(" ")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag == "table" and self._in_table:
            if self._depth_in_cell > 0:
                self._depth_in_cell -= 1
                return
            if self._current_table:
                self.tables.append(self._current_table)
            self._in_table = False
            self._is_wikitable = False
            self._current_table = []
        elif tag == "tr" and self._in_row:
            if self._current_row:
                self._current_table.append(self._current_row)
            self._in_row = False
            self._current_row = []
        elif tag in ("td", "th") and self._in_cell:
            cell_text = "".join(self._current_cell_chunks).strip()
            # Collapse whitespace, drop wiki citation markers like [1]
            # so they don't pollute scores like "100 [1]".
            cell_text = re.sub(r"\[\d+\]", "", cell_text)
            cell_text = re.sub(r"\s+", " ", cell_text).strip()
            self._current_row.append(cell_text)
            self._in_cell = False

    def handle_data(self, data):
        if self._in_cell:
            self._current_cell_chunks.append(data)


# ── Output normalisation ──────────────────────────────────────────────────
#
# Wikipedia ranking tables typically have these column shapes (year
# to year minor drift):
#   QS:   Rank | Name | Country | Score
#   THE:  Rank | Name | Country | Overall
#   ARWU: Rank | Name | Country | Score | (then per-criterion scores)
# We identify columns by header text, not position, so a minor schema
# drift doesn't break the parser.

_RANK_HEADERS    = ("rank", "no", "no.", "position")
_NAME_HEADERS    = ("name", "institution", "university", "school")
_COUNTRY_HEADERS = ("country", "location", "region", "nation")
_SCORE_HEADERS   = ("score", "overall", "total", "total score")


def _norm_header(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def _classify_columns(header_row: list[str]) -> dict[str, Optional[int]]:
    out: dict[str, Optional[int]] = {
        "rank": None, "name": None, "country": None, "score": None,
    }
    for i, h in enumerate(header_row):
        nh = _norm_header(h)
        if out["rank"] is None and any(nh == _norm_header(k) for k in _RANK_HEADERS):
            out["rank"] = i
        elif out["name"] is None and any(nh == _norm_header(k) for k in _NAME_HEADERS):
            out["name"] = i
        elif out["country"] is None and any(nh == _norm_header(k) for k in _COUNTRY_HEADERS):
            out["country"] = i
        elif out["score"] is None and any(nh == _norm_header(k) for k in _SCORE_HEADERS):
            out["score"] = i
    return out


def _parse_rank(s: str) -> Optional[int]:
    # Handle tied ranks ("=10", "=10th"), ranges ("11-20"), Roman.
    if not s:
        return None
    s = s.strip()
    s = re.sub(r"^[=≤<]+\s*", "", s)
    m = re.match(r"^(\d+)", s)
    if m:
        return int(m.group(1))
    return None


def _parse_score(s: str) -> Optional[float]:
    if not s:
        return None
    s = s.strip()
    m = re.match(r"^([\d.]+)", s)
    if not m:
        return None
    try:
        return float(m.group(1))
    except ValueError:
        return None


def _extract_rows(table: list[list[str]]) -> tuple[list[str], list[dict]]:
    """Find the header row and return (label_header_row, parsed_rows)."""
    if not table:
        return [], []
    # First row is almost always the header in wikitables. Defensive:
    # if row 0 has fewer than 3 cells, scan a few rows for one that
    # looks like a header.
    header_idx = 0
    for i, r in enumerate(table[:3]):
        if len(r) >= 3 and any(_norm_header(c) in
                               {_norm_header(h) for h in
                                (*_RANK_HEADERS, *_NAME_HEADERS, *_COUNTRY_HEADERS)}
                               for c in r):
            header_idx = i
            break
    header = table[header_idx]
    cols = _classify_columns(header)
    if cols["name"] is None or cols["rank"] is None:
        # Not a ranking table.
        return [], []

    rows: list[dict] = []
    for r in table[header_idx + 1:]:
        if len(r) < max(c for c in cols.values() if c is not None) + 1:
            continue
        rank    = _parse_rank(r[cols["rank"]]) if cols["rank"] is not None else None
        name    = (r[cols["name"]] if cols["name"] is not None else "").strip()
        country = (r[cols["country"]] if cols["country"] is not None else "").strip()
        score   = (_parse_score(r[cols["score"]]) if cols["score"] is not None else None)
        # Skip rows that aren't real entries (footer, summary).
        if not name or rank is None:
            continue
        rows.append({
            "rank":    rank,
            "name":    name,
            "country": country,
            "score":   score,
        })
    return header, rows


# ── Fetch (sync — wrapped in to_thread) ───────────────────────────────────

class _RankingFetchError(Exception):
    pass


def _fetch_wiki(page: str) -> str:
    url = f"{_WIKIPEDIA_BASE}{page}"
    req = urllib.request.Request(url, headers={
        "User-Agent": _UA,
        "Accept":     "text/html",
    })
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT_S) as resp:
            ct = (resp.headers.get("Content-Type") or "").lower()
            if "text/html" not in ct:
                raise _RankingFetchError(f"non-HTML content-type: {ct}")
            body = resp.read(_MAX_BYTES + 1)
            if len(body) > _MAX_BYTES:
                raise _RankingFetchError("Wikipedia page exceeded 3 MB cap")
            return body.decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        raise _RankingFetchError(f"HTTP {e.code}: {e.reason}")
    except urllib.error.URLError as e:
        raise _RankingFetchError(f"Network error: {e.reason}")


# ── Tool ──────────────────────────────────────────────────────────────────

class UniversityRankingsTool(BaseTool):
    """Structured extractor for global university rankings.

    Usage from the agent / route layer:
        envelope = await tool.safe_run(
            "qs",                            # ranking key
            {"limit": 10, "country": "USA"}, # optional filters
        )

    The route's intent-based auto-invocation (see
    services/tool_extraction/ranking_intent.py) picks the ranking key
    from the user's message and forwards the limit/country filters
    parsed from the same message.
    """

    name = "university_rankings"
    description = (
        "Look up structured global university rankings (QS, THE, ARWU, "
        "US News, CWUR) from Wikipedia's maintained tables. Returns "
        "{rank, name, country, score} for the top N. NEVER guesses "
        "ranks — surfaces unavailable when the page can't be parsed."
    )
    timeout_seconds = 10.0
    category = "research"
    icon = "graduation-cap"
    execution_mode = "sync"
    requires_auth = True
    cost_estimate = 0.0
    input_schema = {
        "type": "object",
        "properties": {
            "ranking": {
                "type": "string",
                "description": "qs | the | arwu | us_news | cwur",
                "enum": list(_SOURCES.keys()),
            },
            "limit":   {"type": "integer", "minimum": 1, "maximum": 200,
                        "description": "Max rows returned (default 10)."},
            "country": {"type": "string",
                        "description": "Optional country filter (case-insensitive substring match)."},
        },
        "required": ["ranking"],
    }
    output_schema = {
        "type": "object",
        "properties": {
            "ranking":     {"type": "string"},
            "source_url":  {"type": "string"},
            "source_label":{"type": "string"},
            "total_rows":  {"type": "integer"},
            "returned":    {"type": "integer"},
            "rows": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "rank":    {"type": "integer"},
                        "name":    {"type": "string"},
                        "country": {"type": "string"},
                        "score":   {"type": ["number", "null"]},
                    },
                },
            },
        },
    }

    async def run(self, query: str, context: dict = None) -> dict:
        ctx = context or {}
        # The "query" string is the ranking key for back-compat with
        # BaseTool's run(query, context) shape. Context can override.
        ranking_key = (ctx.get("ranking") or query or "").strip().lower()
        ranking_key = re.sub(r"[^a-z_]", "", ranking_key)
        if ranking_key not in _SOURCES:
            return self._error(
                f"Unknown ranking key '{ranking_key}'. "
                f"Known: {', '.join(_SOURCES.keys())}."
            )

        source = _SOURCES[ranking_key]
        limit  = max(1, min(int(ctx.get("limit") or 10), 200))
        country_filter = (ctx.get("country") or "").strip().lower()

        try:
            html = await asyncio.wait_for(
                asyncio.to_thread(_fetch_wiki, source["page"]),
                timeout=_TIMEOUT_S,
            )
        except asyncio.TimeoutError:
            return self._unavailable(
                f"Wikipedia page for {source['label']} timed out after "
                f"{_TIMEOUT_S:.0f}s. Try again shortly."
            )
        except _RankingFetchError as exc:
            return self._unavailable(
                f"Could not fetch Wikipedia page for {source['label']}: {exc}"
            )
        except Exception as exc:
            logger.warning("university_rankings unexpected fetch error: %s", exc)
            return self._error(str(exc) or "unexpected fetch error")

        # Parse — find the FIRST wikitable that looks like a ranking
        # table. Wikipedia ranking articles put the most-recent year's
        # table first; older years follow further down.
        parser = _WikitableExtractor()
        try:
            parser.feed(html)
        except Exception as exc:
            # html.parser can raise on truly malformed input; surface
            # honestly rather than guessing.
            logger.warning("university_rankings parser error: %s", exc)
            return self._error("Could not parse Wikipedia ranking table.")

        chosen_rows: list[dict] = []
        chosen_header: list[str] = []
        for table in parser.tables:
            header, rows = _extract_rows(table)
            if rows:
                chosen_header = header
                chosen_rows = rows
                break

        if not chosen_rows:
            return self._unavailable(
                f"Wikipedia page for {source['label']} returned no "
                f"parseable ranking table. The page schema may have "
                f"changed; a maintainer should review the parser."
            )

        # Country filter (case-insensitive substring match).
        if country_filter:
            chosen_rows = [
                r for r in chosen_rows
                if country_filter in (r.get("country") or "").lower()
            ]

        # De-dup by rank — Wikipedia tables sometimes include a
        # "previous year" column we mistook for rank; keep only one
        # entry per rank.
        seen_ranks: set[int] = set()
        deduped: list[dict] = []
        for r in chosen_rows:
            rk = r["rank"]
            if rk in seen_ranks:
                continue
            seen_ranks.add(rk)
            deduped.append(r)

        # Sort by rank ascending; trim to limit.
        deduped.sort(key=lambda r: (r["rank"], r["name"]))
        returned = deduped[:limit]

        return self._ok(
            {
                "ranking":      ranking_key,
                "source_url":   f"{_WIKIPEDIA_BASE}{source['page']}",
                "source_label": source["label"],
                "header":       chosen_header,
                "total_rows":   len(chosen_rows),
                "returned":     len(returned),
                "rows":         returned,
                "country_filter": country_filter or None,
            },
            provider="wikipedia",
        )


__all__ = ["UniversityRankingsTool"]
