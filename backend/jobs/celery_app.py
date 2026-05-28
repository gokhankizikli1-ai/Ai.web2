# coding: utf-8
"""
Phase 7 — Celery app placeholder.

This file is the canonical entry point a future Railway worker
service will use:

    celery -A backend.jobs.celery_app worker --loglevel=info

For Phase 7, Celery is OPTIONAL. The default execution backend is
`InlineJobRunner` (in-process asyncio task pool), which requires no
Celery / Redis dependency. This module exposes a `build_celery()`
factory that imports celery LAZILY so the API process boots cleanly
regardless of whether the dep is installed.

Required env vars when JOB_QUEUE_MODE=celery (Phase 14+):
    REDIS_URL                 — broker + result backend
    JOB_QUEUE_MODE=celery     — switch the runner
    ENABLE_JOB_QUEUE=true     — master kill-switch

For Phase 7 dev/prod, leave JOB_QUEUE_MODE=inline (default). The
worker service is not needed.
"""
from __future__ import annotations

import logging
import os


logger = logging.getLogger(__name__)


def build_celery():
    """Return a configured Celery app. Lazy import so the API process
    doesn't break when celery isn't installed.

    Returns None when celery is not available — caller can decide
    whether to raise or fall back.
    """
    try:
        from celery import Celery
    except ImportError:
        logger.warning("celery_app: celery package not installed — returning None")
        return None

    redis_url = os.getenv("REDIS_URL", "")
    if not redis_url:
        logger.warning("celery_app: REDIS_URL is not set — Celery cannot connect")
        # Still build the app (Celery doesn't crash on construction)
        # but it won't be functional until REDIS_URL is provided.
    app = Celery(
        "korvix_jobs",
        broker=         redis_url or "memory://",
        backend=        redis_url or "cache+memory://",
    )
    # Phase 7 slice 1 — production-ish defaults:
    # * task_acks_late      worker acks AFTER the task succeeds, so a
    #                       crash mid-task requeues rather than drops
    # * prefetch_multiplier=1  pick one task at a time → fair scheduling
    # * track_started       lets the SSE bridge surface STARTED
    # * task_time_limit     hard cap so a runaway can't pin a worker
    # * task_soft_time_limit fires SoftTimeLimitExceeded inside the
    #                       task with enough headroom to checkpoint
    # * result_expires      Redis result rows auto-evict in 24h
    app.conf.update(
        task_default_queue="korvix.default",
        task_queues=[
            # Per-domain queues for routing + per-queue worker scaling
            # later. Slice 1 lets every queue exist; slice 2 picks
            # which kind goes where via _queue_for_record.
            {"name": "korvix.default"},
            {"name": "korvix.research"},
            {"name": "korvix.vision"},
            {"name": "korvix.embeddings"},
            {"name": "korvix.orchestration"},
            {"name": "korvix.maintenance"},
        ],
        task_acks_late=True,
        worker_prefetch_multiplier=1,
        task_track_started=True,
        task_time_limit=900,            # 15 min hard cap
        task_soft_time_limit=840,       # 14 min soft (let handlers checkpoint)
        result_expires=60 * 60 * 24,    # 24h
        broker_connection_retry_on_startup=True,
        broker_pool_limit=10,
    )
    return app


# Module-level convenience — built lazily on first attribute access.
# Most code should call `build_celery()` directly.
_app = None


def get_app():
    global _app
    if _app is None:
        _app = build_celery()
    return _app


__all__ = ["build_celery", "get_app"]
