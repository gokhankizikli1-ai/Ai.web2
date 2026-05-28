# coding: utf-8
"""Phase 6 — pgvector helpers.

pgvector is a Postgres extension that adds a `vector(N)` column type
plus distance operators (`<->` Euclidean, `<#>` negative inner product,
`<=>` cosine). We use it for semantic memory recall in the next slice.

This module is the seam every caller goes through. We DON'T pin the
extension to a specific version — we just attempt to CREATE EXTENSION
IF NOT EXISTS and report success. If the Postgres deployment doesn't
ship the extension binary (managed hosts that don't allow it), we
surface that honestly via `is_pgvector_available()` so the recall
endpoint can return 503 instead of crashing on first query.

Vector encoding:
  pgvector accepts vectors as a string literal: '[0.1,0.2,...]'
  When binding via asyncpg we register a codec OR pass the string
  representation directly. For Phase 6 slice 1 we expose stateless
  helpers that callers use today; the codec wires up in slice 3
  (semantic recall) once we have a real column to bind to.
"""
from __future__ import annotations

import logging
from typing import Sequence

from backend.services.db.engine import acquire


logger = logging.getLogger(__name__)


# Vectors larger than this are clamped — text-embedding-3-small is 1536
# dims, large is 3072. Keeping the cap generous; the per-row size still
# matters for index build time so callers should pick the right model.
_MAX_DIMS = 4096


async def is_pgvector_available() -> bool:
    """True when the running Postgres has the pgvector extension
    installed (whether or not we've enabled it in this database).

    Cheap query — one row from `pg_available_extensions`. Returns False
    on any error rather than raising; callers want a boolean for the
    health check.
    """
    try:
        async with acquire() as conn:
            row = await conn.fetchrow(
                "SELECT name, default_version, installed_version "
                "FROM pg_available_extensions WHERE name = 'vector'"
            )
            return bool(row)
    except Exception as exc:
        logger.debug("pgvector availability probe failed: %s", exc)
        return False


async def ensure_pgvector() -> bool:
    """Idempotent CREATE EXTENSION. True when the extension is installed
    AND enabled afterwards.

    No-op when already enabled. Raises only on the kind of error that
    the operator must see (e.g. permissions) — callers can let it
    propagate to surface in the health response.
    """
    async with acquire() as conn:
        # CREATE EXTENSION requires superuser on stock Postgres but
        # managed providers (Neon / Supabase / Railway PG) allow it
        # for the role they hand you. If permissions deny, asyncpg
        # raises and we log + re-raise.
        await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
        row = await conn.fetchrow(
            "SELECT installed_version FROM pg_available_extensions WHERE name = 'vector'"
        )
        ok = bool(row and row["installed_version"])
        logger.info(
            "[DB] pgvector ensure: installed_version=%s",
            (row and row["installed_version"]) or "missing",
        )
        return ok


def encode_vector(values: Sequence[float]) -> str:
    """Serialize a Python sequence of floats into the literal string
    form pgvector expects: '[0.1,0.2,...]'. Clamps oversized vectors
    and rejects non-numeric entries early so binding errors land here
    with a useful message instead of inside asyncpg's parser."""
    if not values:
        raise ValueError("encode_vector: empty sequence")
    if len(values) > _MAX_DIMS:
        raise ValueError(
            f"encode_vector: {len(values)} dims > max {_MAX_DIMS}"
        )
    parts: list[str] = []
    for i, v in enumerate(values):
        if not isinstance(v, (int, float)):
            raise TypeError(
                f"encode_vector: index {i} not a number: {type(v).__name__}"
            )
        # repr() preserves precision for floats — `str(0.1)` loses it on
        # some Python builds, repr() round-trips.
        parts.append(repr(float(v)))
    return "[" + ",".join(parts) + "]"


def decode_vector(raw: str | None) -> list[float]:
    """Parse pgvector's text form back into a Python list. Tolerant of
    None (returns []), whitespace, and trailing/leading brackets the
    server emits."""
    if raw is None:
        return []
    if isinstance(raw, list):                         # already a list
        return [float(x) for x in raw]
    s = raw.strip()
    if not s:
        return []
    if s.startswith("[") and s.endswith("]"):
        s = s[1:-1]
    if not s:
        return []
    return [float(x) for x in s.split(",")]


__all__ = [
    "is_pgvector_available", "ensure_pgvector",
    "encode_vector", "decode_vector",
]
