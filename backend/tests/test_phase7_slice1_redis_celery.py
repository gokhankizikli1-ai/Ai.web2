# coding: utf-8
"""Phase 7 slice 1 — Redis foundation + CeleryJobRunner tests.

Covers (no live Redis, no live Celery — everything monkeypatched):
  1. Redis client env handling + lazy import
  2. Redis health probe (enabled vs disabled paths)
  3. Redis URL credentials are stripped in `current_url_safe`
  4. CeleryJobRunner gates on celery + redis availability
  5. CeleryJobRunner.submit publishes to the right queue
  6. CeleryJobRunner submit counter bumps + last_error captured
  7. build_runner returns Celery when JOB_QUEUE_MODE=celery
  8. Health endpoint composite includes redis block
"""
from __future__ import annotations

import asyncio
import sys
import types

import pytest

from backend.services.redis_client import client as redis_client_mod
from backend.services.redis_client import metrics as redis_metrics
from backend.services.redis_client.errors import (
    RedisConfigError, RedisUnavailable,
)


# ── 1. Redis client env handling ──────────────────────────────────────────

class TestRedisClientEnv:
    def test_disabled_by_default(self, monkeypatch):
        monkeypatch.delenv("REDIS_URL", raising=False)
        monkeypatch.delenv("ENABLE_REDIS", raising=False)
        assert redis_client_mod.is_enabled() is False

    def test_requires_both_url_and_flag(self, monkeypatch):
        monkeypatch.setenv("REDIS_URL", "redis://x@host/0")
        monkeypatch.delenv("ENABLE_REDIS", raising=False)
        assert redis_client_mod.is_enabled() is False

        monkeypatch.setenv("ENABLE_REDIS", "true")
        assert redis_client_mod.is_enabled() is True

        monkeypatch.delenv("REDIS_URL", raising=False)
        assert redis_client_mod.is_enabled() is False

    def test_get_client_raises_config_when_disabled(self, monkeypatch):
        monkeypatch.delenv("REDIS_URL", raising=False)
        monkeypatch.delenv("ENABLE_REDIS", raising=False)
        # Reset module cache so any prior pool doesn't leak.
        redis_client_mod._SYNC_CLIENT = None
        with pytest.raises(RedisConfigError):
            redis_client_mod.get_client()

    def test_current_url_safe_strips_credentials(self, monkeypatch):
        monkeypatch.setenv(
            "REDIS_URL",
            "rediss://default:supersecretpassword@upstash.io:6380/0",
        )
        safe = redis_client_mod.current_url_safe()
        assert "supersecret" not in safe
        assert "upstash.io" in safe
        assert "6380" in safe

    def test_current_url_safe_empty_when_unset(self, monkeypatch):
        monkeypatch.delenv("REDIS_URL", raising=False)
        assert redis_client_mod.current_url_safe() == ""


# ── 2. Redis health probe ─────────────────────────────────────────────────

class TestRedisHealth:
    def test_disabled_reports_ok_true(self, monkeypatch):
        monkeypatch.delenv("REDIS_URL", raising=False)
        monkeypatch.delenv("ENABLE_REDIS", raising=False)
        from backend.services.redis_client.health import health_check
        out = asyncio.run(health_check())
        assert out["enabled"] is False
        # When Redis is intentionally off we surface ok=True so the
        # composite /v2/db/health doesn't go red on a system that
        # doesn't even use Redis.
        assert out["ok"] is True

    def test_unreachable_reports_error(self, monkeypatch):
        monkeypatch.setenv("REDIS_URL", "redis://nobody@127.0.0.1:1/0")
        monkeypatch.setenv("ENABLE_REDIS", "true")
        monkeypatch.setenv("REDIS_TIMEOUT_SEC", "1")
        redis_client_mod._ASYNC_CLIENT = None
        from backend.services.redis_client.health import health_check
        out = asyncio.run(health_check())
        assert out["enabled"] is True
        # If `redis` package isn't installed: error mentions config.
        # If it IS installed: error mentions unavailable. Either is OK.
        assert out["ok"] is False
        assert out["error"] is not None


# ── 3. CeleryJobRunner gating ─────────────────────────────────────────────

class TestCeleryJobRunnerGating:
    def test_no_celery_installed_makes_submit_raise(self, monkeypatch):
        # Pretend celery isn't importable.
        monkeypatch.setitem(sys.modules, "celery", None)
        from backend.services.jobs.runner import CeleryJobRunner
        runner = CeleryJobRunner()
        with pytest.raises(NotImplementedError, match="celery"):
            asyncio.run(runner.submit("rec-1"))

    def test_no_redis_makes_submit_raise(self, monkeypatch):
        monkeypatch.delenv("ENABLE_REDIS", raising=False)
        monkeypatch.delenv("REDIS_URL", raising=False)
        # Fake the celery package import so it doesn't fail on the
        # availability check.
        fake_celery = types.ModuleType("celery")
        monkeypatch.setitem(sys.modules, "celery", fake_celery)
        from backend.services.jobs.runner import CeleryJobRunner
        runner = CeleryJobRunner()
        with pytest.raises(NotImplementedError, match="Redis"):
            asyncio.run(runner.submit("rec-1"))


class TestCeleryJobRunnerSubmit:
    def _setup_celery_and_redis_env(self, monkeypatch):
        monkeypatch.setenv("REDIS_URL", "redis://stub@host/0")
        monkeypatch.setenv("ENABLE_REDIS", "true")
        fake_celery = types.ModuleType("celery")
        monkeypatch.setitem(sys.modules, "celery", fake_celery)

    def test_submit_publishes_to_default_queue(self, monkeypatch):
        self._setup_celery_and_redis_env(monkeypatch)

        captured = {}

        class _FakeApp:
            def send_task(self, name, args=None, queue=None, **_kw):
                captured["name"] = name
                captured["args"] = args
                captured["queue"] = queue

        # Patch get_app to return our fake app
        import backend.jobs.celery_app as celery_app_mod
        monkeypatch.setattr(celery_app_mod, "get_app", lambda: _FakeApp())

        from backend.services.jobs.runner import CeleryJobRunner
        runner = CeleryJobRunner()
        asyncio.run(runner.submit("rec-1"))

        assert captured["name"] == "korvix.jobs.dispatch"
        assert captured["args"] == ["rec-1"]
        assert captured["queue"] == "korvix.default"

        stats = runner.stats()
        assert stats["submits"] == 1
        assert stats["submit_failed"] == 0

    def test_submit_app_none_raises(self, monkeypatch):
        self._setup_celery_and_redis_env(monkeypatch)
        import backend.jobs.celery_app as celery_app_mod
        monkeypatch.setattr(celery_app_mod, "get_app", lambda: None)

        from backend.services.jobs.runner import CeleryJobRunner
        runner = CeleryJobRunner()
        with pytest.raises(NotImplementedError, match="(?i)celery app"):
            asyncio.run(runner.submit("rec-2"))

        assert runner.stats()["submit_failed"] == 1

    def test_submit_send_failure_captured(self, monkeypatch):
        self._setup_celery_and_redis_env(monkeypatch)

        class _FlakyApp:
            def send_task(self, *args, **kwargs):
                raise RuntimeError("broker down")

        import backend.jobs.celery_app as celery_app_mod
        monkeypatch.setattr(celery_app_mod, "get_app", lambda: _FlakyApp())

        from backend.services.jobs.runner import CeleryJobRunner
        runner = CeleryJobRunner()
        with pytest.raises(RuntimeError, match="broker down"):
            asyncio.run(runner.submit("rec-3"))

        stats = runner.stats()
        assert stats["submit_failed"] == 1
        assert "broker down" in stats["last_error"]


# ── 4. build_runner switches on JOB_QUEUE_MODE ────────────────────────────

class TestBuildRunner:
    def test_inline_is_default(self, monkeypatch):
        monkeypatch.delenv("JOB_QUEUE_MODE", raising=False)
        from backend.services.jobs.runner import build_runner, InlineJobRunner
        assert isinstance(build_runner(), InlineJobRunner)

    def test_celery_mode_returns_celery_runner(self, monkeypatch):
        monkeypatch.setenv("JOB_QUEUE_MODE", "celery")
        from backend.services.jobs.runner import build_runner, CeleryJobRunner
        assert isinstance(build_runner(), CeleryJobRunner)

    def test_unknown_mode_falls_back_to_inline(self, monkeypatch):
        monkeypatch.setenv("JOB_QUEUE_MODE", "kafka")
        from backend.services.jobs.runner import build_runner, InlineJobRunner
        assert isinstance(build_runner(), InlineJobRunner)


# ── 5. Composite health endpoint includes redis ───────────────────────────

class TestCompositeHealthIncludesRedis:
    def test_db_health_includes_redis_block(self, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("ENABLE_POSTGRES_BACKEND", raising=False)
        monkeypatch.delenv("REDIS_URL", raising=False)
        monkeypatch.delenv("ENABLE_REDIS", raising=False)
        from backend.services.db.health import health_check
        out = asyncio.run(health_check())
        assert "redis" in out
        assert out["redis"]["ok"] is True       # disabled → ok=true
        assert out["redis"]["enabled"] is False


# ── 6. Redis metrics ──────────────────────────────────────────────────────

class TestRedisMetrics:
    def setup_method(self):
        redis_metrics.reset()

    def test_command_recorded(self):
        redis_metrics.command_recorded(ok=True)
        redis_metrics.command_recorded(ok=False, error="boom")
        snap = redis_metrics.snapshot()
        assert snap["commands_total"] == 2
        assert snap["commands_failed"] == 1
        assert "boom" in snap["last_error"]

    def test_ping_recorded(self):
        redis_metrics.ping_recorded(ok=True)
        redis_metrics.ping_recorded(ok=False)
        snap = redis_metrics.snapshot()
        assert snap["pings_total"] == 2
        assert snap["pings_failed"] == 1
