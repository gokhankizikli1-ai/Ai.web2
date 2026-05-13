# coding: utf-8
"""
Phase 6d — current_time tool unit tests.

Coverage:
  - Default behaviour: UTC, ISO 8601, weekday string, numeric fields
  - Named IANA timezone (e.g. 'America/New_York') resolves
  - Unknown timezone returns _error
  - Output envelope shape matches BaseTool contract
"""
from __future__ import annotations

import asyncio
import re

from backend.services.tools.current_time_tool import CurrentTimeTool


def _run(query: str = "", **context) -> dict:
    return asyncio.run(CurrentTimeTool().run(query, context))


def test_default_is_utc():
    r = _run()
    assert r["status"] == "available"
    d = r["data"]
    assert d["timezone"] == "UTC"
    # Both iso and iso_utc should serialize with offset.
    assert re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", d["iso"])
    assert d["iso_utc"].endswith("+00:00")
    assert d["utc_offset"] in {"+0000", ""}  # ZoneInfo("UTC") yields "+0000"


def test_named_timezone():
    r = _run(timezone="America/New_York")
    d = r["data"]
    assert d["timezone"] == "America/New_York"
    # NY offset is -0400 (EDT) or -0500 (EST). Match either.
    assert d["utc_offset"] in {"-0400", "-0500"}


def test_weekday_field_is_english_name():
    r = _run()
    weekdays = {"Monday", "Tuesday", "Wednesday", "Thursday",
                "Friday", "Saturday", "Sunday"}
    assert r["data"]["weekday"] in weekdays


def test_numeric_fields_are_sensible():
    r = _run()
    d = r["data"]
    assert 1 <= d["month"] <= 12
    assert 1 <= d["day"] <= 31
    assert 0 <= d["hour"] <= 23
    assert 0 <= d["minute"] <= 59
    assert 0 <= d["second"] <= 60   # leap seconds
    # 2024-01-01 is epoch 1704067200; allow a wide future buffer.
    assert d["epoch_seconds"] > 1_700_000_000


def test_unknown_timezone_is_error():
    r = _run(timezone="Mars/Olympus_Mons")
    assert r["status"] == "error"
    assert "Mars/Olympus_Mons" in r["message"]


def test_query_argument_used_as_tz():
    # If only positional query is given, it is treated as a tz name.
    r = asyncio.run(CurrentTimeTool().run("UTC", {}))
    assert r["status"] == "available"
    assert r["data"]["timezone"] == "UTC"


def test_envelope_shape():
    r = _run()
    assert r["tool"] == "current_time"
    assert r["provider"] == "builtin"
    assert r["status"] == "available"
    assert r["message"] is None
    assert "timestamp" in r
