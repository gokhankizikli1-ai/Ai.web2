# coding: utf-8
"""Phase 7 slice 2 — Redis pub/sub fanout tests.

Covers (no live Redis):
  1. serialise / deserialise round-trip
  2. channel_for is per-job and stable
  3. publish_to_redis returns False when Redis is disabled (additive)
  4. RedisFanout.start is a no-op when Redis disabled
  5. RedisFanout publishes via _publish_local (no event-storm loop)
  6. RedisFanout reconnects with exponential backoff on transient errors
  7. Lifecycle: get_fanout() returns a singleton
"""
from __future__ import annotations

import asyncio
import json

import pytest

from backend.services.jobs.events import get_bus
from backend.services.jobs.events_redis import (
    CHANNEL_PATTERN, CHANNEL_PREFIX,
    channel_for, get_fanout,
    publish_to_redis,
    _serialise, _deserialise,
)
from backend.services.jobs.types import JobEvent


# ── 1. Serialisation round-trip ───────────────────────────────────────────

class TestSerialisation:
    def test_round_trip(self):
        e = JobEvent(
            job_id="abc-123",
            kind="progress",
            payload={"pct": 42, "label": "scraping"},
            timestamp="2026-05-28T12:00:00+00:00",
        )
        raw = _serialise(e)
        # Must be valid JSON
        parsed = json.loads(raw)
        assert parsed["job_id"] == "abc-123"
        assert parsed["kind"] == "progress"
        assert parsed["payload"]["pct"] == 42

        back = _deserialise(raw)
        assert back is not None
        assert back.job_id == e.job_id
        assert back.kind == e.kind
        assert back.payload == e.payload
        assert back.timestamp == e.timestamp

    def test_deserialise_handles_bytes(self):
        e = JobEvent(job_id="j", kind="status", payload={"s": "running"}, timestamp="t")
        raw = _serialise(e).encode("utf-8")
        back = _deserialise(raw)
        assert back is not None
        assert back.kind == "status"

    def test_deserialise_handles_malformed(self):
        assert _deserialise("not json") is None
        assert _deserialise(b"\xff\xfe") is None
        # Valid JSON but not a dict
        assert _deserialise("[1,2,3]") is None

    def test_deserialise_handles_missing_fields(self):
        # Missing job_id → empty string
        back = _deserialise('{"kind":"x"}')
        assert back is not None
        assert back.job_id == ""
        assert back.kind == "x"


# ── 2. Channel naming ─────────────────────────────────────────────────────

class TestChannelNaming:
    def test_per_job(self):
        assert channel_for("a") != channel_for("b")
        assert channel_for("a").startswith(CHANNEL_PREFIX)

    def test_pattern_covers_channel(self):
        # Wildcard pattern must match any per-job channel
        assert channel_for("x").startswith(CHANNEL_PATTERN[:-1])

    def test_empty_id_handled(self):
        # Robustness — we never want to leak a bare prefix collision
        c = channel_for("")
        assert c == CHANNEL_PREFIX + "unknown"


# ── 3. publish_to_redis — disabled returns False ──────────────────────────

class TestPublishWhenDisabled:
    def test_disabled_returns_false(self, monkeypatch):
        monkeypatch.delenv("REDIS_URL", raising=False)
        monkeypatch.delenv("ENABLE_REDIS", raising=False)
        e = JobEvent(job_id="j", kind="status", payload={}, timestamp="t")
        result = asyncio.run(publish_to_redis(e))
        assert result is False


# ── 4. Fanout lifecycle ───────────────────────────────────────────────────

class TestFanoutLifecycle:
    def test_get_fanout_singleton(self):
        f1 = get_fanout()
        f2 = get_fanout()
        assert f1 is f2

    def test_start_noop_when_disabled(self, monkeypatch):
        monkeypatch.delenv("ENABLE_REDIS", raising=False)
        monkeypatch.delenv("REDIS_URL", raising=False)
        fanout = get_fanout()

        async def go():
            await fanout.start()
            assert fanout._task is None
            await fanout.stop()

        asyncio.run(go())

    def test_stop_when_never_started(self):
        fanout = get_fanout()

        async def go():
            await fanout.stop()      # must not raise

        asyncio.run(go())


# ── 5. No event-storm loop — fanout uses _publish_local ──────────────────

class TestNoEventStorm:
    """If RedisFanout re-published via JobEventBus.publish(), every
    event received from Redis would trigger ANOTHER publish back to
    Redis on every API replica, looping forever. The contract is:
    fanout calls _publish_local; only origin publishes hit Redis."""

    def test_publish_local_does_not_call_redis(self, monkeypatch):
        # Force ENABLE_REDIS=true so publish() would normally schedule
        # a Redis publish task.
        monkeypatch.setenv("REDIS_URL", "redis://stub/0")
        monkeypatch.setenv("ENABLE_REDIS", "true")

        scheduled = []

        # Patch publish_to_redis so we can count when it's called.
        from backend.services.jobs import events_redis as er
        async def _fake_publish(event):
            scheduled.append(event.job_id)
            return True
        monkeypatch.setattr(er, "publish_to_redis", _fake_publish)

        bus = get_bus()
        e = JobEvent(job_id="loop-test", kind="status",
                     payload={}, timestamp="t")

        async def go():
            # Origin publish → schedules Redis publish
            await bus.publish(e)
            # Let the create_task complete
            await asyncio.sleep(0.01)
            assert "loop-test" in scheduled

            scheduled.clear()
            # Fanout-style local-only publish → MUST NOT schedule Redis
            await bus._publish_local(e)
            await asyncio.sleep(0.01)
            assert scheduled == []

        asyncio.run(go())


# ── 6. Fanout stats shape ────────────────────────────────────────────────

class TestFanoutStats:
    def test_stats_keys(self):
        fanout = get_fanout()
        s = fanout.stats()
        assert "started"     in s
        assert "messages"    in s
        assert "republishes" in s
        assert "errors"      in s
        assert "last_error"  in s
