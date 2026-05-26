# coding: utf-8
"""
Phase 7 — Manager + flag-gating tests.

Covers the JobsClient feature-flag contract + registry behaviour.
The route layer's 503 behaviour is covered in test_jobs_api.py.

No pytest-asyncio in the test env; async helpers use asyncio.run.
"""
from __future__ import annotations

import asyncio
from importlib import reload

import pytest

from backend.services.jobs import client as jobs_client
from backend.services.jobs.errors import JobQueueDisabled
from backend.services.jobs.registry import known_kinds, _reset_for_tests as _registry_reset


# ── Flag contract ────────────────────────────────────────────────────────────

def test_create_flag_off_raises_disabled(monkeypatch):
    monkeypatch.setenv("ENABLE_JOB_QUEUE", "false")
    async def _drive():
        with pytest.raises(JobQueueDisabled):
            await jobs_client.create(user_id="u1", kind="echo")
    asyncio.run(_drive())


def test_list_user_flag_off_returns_empty(monkeypatch):
    monkeypatch.setenv("ENABLE_JOB_QUEUE", "false")
    assert jobs_client.list_user("u1") == []


def test_get_flag_off_returns_none(monkeypatch):
    monkeypatch.setenv("ENABLE_JOB_QUEUE", "false")
    assert jobs_client.get("anything") is None


def test_cancel_flag_off_raises_disabled(monkeypatch):
    monkeypatch.setenv("ENABLE_JOB_QUEUE", "false")
    async def _drive():
        with pytest.raises(JobQueueDisabled):
            await jobs_client.cancel("nope", user_id="u1")
    asyncio.run(_drive())


def test_retry_flag_off_raises_disabled(monkeypatch):
    monkeypatch.setenv("ENABLE_JOB_QUEUE", "false")
    async def _drive():
        with pytest.raises(JobQueueDisabled):
            await jobs_client.retry("nope", user_id="u1")
    asyncio.run(_drive())


def test_stats_works_when_disabled(monkeypatch):
    monkeypatch.setenv("ENABLE_JOB_QUEUE", "false")
    s = jobs_client.stats()
    assert s["enabled"] is False
    assert "store" in s
    assert "tables" in s


def test_is_enabled_reads_env_dynamically(monkeypatch):
    monkeypatch.setenv("ENABLE_JOB_QUEUE", "true")
    assert jobs_client.is_enabled() is True
    monkeypatch.setenv("ENABLE_JOB_QUEUE", "false")
    assert jobs_client.is_enabled() is False


# ── Registry ─────────────────────────────────────────────────────────────────

def test_builtin_kinds_registered():
    _registry_reset()
    from backend.services.jobs import kinds as _builtin_kinds
    reload(_builtin_kinds)
    ks = known_kinds()
    assert "echo" in ks
    assert "sleep_progress" in ks
    assert "memory_consolidation_stub" in ks


def test_duplicate_registration_raises():
    _registry_reset()
    from backend.services.jobs import kinds as _builtin_kinds
    reload(_builtin_kinds)

    from backend.services.jobs.registry import register_job

    @register_job("test_dup_check")
    async def _a(ctx):
        return {}

    with pytest.raises(RuntimeError):
        @register_job("test_dup_check")
        async def _b(ctx):
            return {}


def test_sync_handler_rejected():
    _registry_reset()
    from backend.services.jobs.registry import register_job

    with pytest.raises(TypeError) as e:
        @register_job("test_sync_handler")
        def _sync(ctx):
            return {}
    assert "async def" in str(e.value)
