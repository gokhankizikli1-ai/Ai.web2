# coding: utf-8
"""
Current-time tool — returns the system clock in UTC by default, or in any
IANA timezone the caller names. No I/O, no network. Safe by construction.

Activate: ENABLE_TOOLS=true ENABLE_CURRENT_TIME=true
"""
from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from backend.services.tools.base_tool import BaseTool


class CurrentTimeTool(BaseTool):
    name = "current_time"
    description = (
        "Return the current date and time. Defaults to UTC. Accepts an "
        "optional IANA timezone name (e.g. 'America/New_York', "
        "'Europe/Istanbul', 'Asia/Tokyo', 'UTC')."
    )

    openai_parameters = {
        "type": "object",
        "properties": {
            "timezone": {
                "type": "string",
                "description": "Optional IANA timezone name. Defaults to UTC.",
            },
        },
        "additionalProperties": True,
    }

    async def run(self, query: str = "", context: dict = None) -> dict:
        ctx = context or {}
        tz_name = (ctx.get("timezone") or query or "UTC").strip() or "UTC"

        try:
            tz = ZoneInfo(tz_name)
        except (ZoneInfoNotFoundError, ValueError):
            return self._error(f"unknown timezone: {tz_name!r}")

        now_utc = datetime.now(timezone.utc)
        now_tz  = now_utc.astimezone(tz)
        return self._ok(
            {
                "timezone":      tz_name,
                "iso":           now_tz.isoformat(),
                "iso_utc":       now_utc.isoformat(),
                "epoch_seconds": int(now_utc.timestamp()),
                "year":          now_tz.year,
                "month":         now_tz.month,
                "day":           now_tz.day,
                "hour":          now_tz.hour,
                "minute":        now_tz.minute,
                "second":        now_tz.second,
                "weekday":       now_tz.strftime("%A"),
                "utc_offset":    now_tz.strftime("%z"),
            },
            provider="builtin",
        )


__all__ = ["CurrentTimeTool"]
