# coding: utf-8
"""Phase 7 — Redis client errors. Same shape as services/db/errors."""
from __future__ import annotations


class RedisError(RuntimeError):
    pass


class RedisUnavailable(RedisError):
    """Redis is configured but unreachable. Surface as 503; transient."""


class RedisConfigError(RedisError):
    """Redis is requested but env is misconfigured. Surface as 500."""


__all__ = ["RedisError", "RedisUnavailable", "RedisConfigError"]
