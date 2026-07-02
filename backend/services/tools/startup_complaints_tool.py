# coding: utf-8
# Startup Complaints Tool — exposes the Market Complaint Radar to the
# startup_advisor chat mode.
#
# Activation chain:
#   ENABLE_TOOLS=true
#   ENABLE_STARTUP_MARKET_INTEL=true   (same flag as /v2/startup routes —
#                                       one switch controls the feature)
#
# The tool runs a reduced-scope radar (web + HN + GDELT, small item cap)
# so a chat turn stays fast; the shared TTL cache means a user who just
# ran the radar in the Startup Hub gets an instant cache hit here. When
# no source yields data the tool reports `unavailable` — the advisor is
# prompted to say the data is missing, never to invent it.
import logging
import re

from backend.services.tools.base_tool import BaseTool

logger = logging.getLogger(__name__)

# Chat messages can be long structured prompts. The radar wants the
# market/niche, so we search with the first line, trimmed.
_MAX_QUERY_CHARS = 140

# "Market: X" / "Idea: X" style label prefix (Startup Hub → Advisor
# handoff uses "Market:"). Word-only match so a pasted URL's "https:"
# is never treated as a label.
_LABEL_PREFIX_RE = re.compile(r"^[A-Za-zÇĞİÖŞÜçğıöşü ]{2,12}:\s*(?!//)")


def _radar_query(message: str) -> str:
    stripped = (message or "").strip()
    first_line = stripped.splitlines()[0] if stripped else ""
    first_line = _LABEL_PREFIX_RE.sub("", first_line)
    return " ".join(first_line.split())[:_MAX_QUERY_CHARS]


class StartupComplaintsTool(BaseTool):
    name = "startup_complaints"
    description = (
        "Scan current public discussions (web research, Hacker News, GDELT) "
        "for complaints about a market/niche, cluster them into ranked pain "
        "themes with evidence URLs, and surface market signals (competitors "
        "mentioned, workarounds, underserved segments). Use for startup idea "
        "validation and market-gap questions."
    )
    category = "research"
    icon = "radar"
    # Fans out to multiple public APIs — allow more than the 12s default.
    timeout_seconds = 20.0

    async def run(self, query: str, context: dict = None) -> dict:
        ctx = context or {}
        q = _radar_query(query or ctx.get("query") or "")
        if len(q) < 4:
            return self._unavailable("query too short for market complaint analysis")

        try:
            from backend.services.startup_intelligence import analyze_market_complaints
        except Exception as exc:
            return self._unavailable(f"startup_intelligence package unavailable: {exc}")

        try:
            report = await analyze_market_complaints(
                q,
                timeframe_days=int(ctx.get("timeframe_days", 30)),
                # keyless/public + web provider only — reddit/PH stay on the
                # explicit Startup Hub path where the user selects sources.
                sources=["web", "hackernews", "gdelt"],
                max_items=45,
            )
        except Exception as exc:
            logger.warning("startup_complaints: radar exception: %s", exc)
            return self._error(f"radar_exception: {exc}")

        clusters = report.get("complaint_clusters") or []
        summary = report.get("summary") or {}
        if not clusters:
            return self._unavailable(
                report.get("message")
                or "no complaint signals found in configured sources"
            )

        # Compact payload — the orchestrator's formatter turns this into
        # the [TOOL: STARTUP_COMPLAINTS] prompt block.
        return self._ok(
            {
                "query": report.get("query", q),
                "generated_at": report.get("generated_at", ""),
                "timeframe_days": report.get("timeframe_days"),
                "data_freshness": report.get("data_freshness") or {},
                "confidence": summary.get("confidence", "low"),
                "opportunity_score": summary.get("opportunity_score", 0),
                "total_items_analyzed": summary.get("total_items_analyzed", 0),
                "clusters": [
                    {
                        "label": c.get("label", ""),
                        "pain_score": c.get("pain_score", 0),
                        "frequency": c.get("frequency", 0),
                        "willingness_to_pay_signal": c.get("willingness_to_pay_signal", 0),
                        "sample_quote": (c.get("sample_quotes") or [{}])[0].get("text", ""),
                        "evidence_url": (c.get("evidence_urls") or [""])[0],
                    }
                    for c in clusters[:5]
                ],
                "market_signals": report.get("market_signals") or {},
                "limitations": report.get("message", ""),
                "cached": bool(report.get("cached")),
            },
            provider="startup_intelligence",
            # cached radar results are still real fetched data, but flag
            # honestly so consumers can distinguish live from cached.
            is_live=not bool(report.get("cached")),
        )
