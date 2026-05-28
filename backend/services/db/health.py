# coding: utf-8
"""Phase 6 — DB health probe.

Returns a small, owner-safe dict the diagnostic endpoint can render
without leaking the DSN. Never raises — even a totally broken Postgres
returns `{ok: false, error: "…"}`.
"""
from __future__ import annotations

import logging
import time
from typing import Any

from backend.services.db.engine import (
    acquire, current_backend, is_enabled,
)
from backend.services.db.errors import DBConfigError, DBUnavailable
from backend.services.db.pgvector import is_pgvector_available


logger = logging.getLogger(__name__)


async def health_check() -> dict[str, Any]:
    """Probe the configured backend. Returns:

      {
        "backend":  "postgres" | "sqlite",
        "enabled":  bool,                       # postgres switched on
        "ok":       bool,                       # connection works (postgres) or n/a
        "latency_ms": int,                      # connect + SELECT 1
        "server_version": "PostgreSQL 16.…",    # populated on postgres ok
        "pgvector_available": bool,             # whether the extension is present
        "error":    "…",                        # populated when ok=false
      }
    """
    backend = current_backend()
    out: dict[str, Any] = {
        "backend":  backend,
        "enabled":  is_enabled(),
        "ok":       False,
        "latency_ms": 0,
        "server_version": None,
        "pgvector_available": False,
        "error":    None,
    }

    if backend == "sqlite":
        # SQLite stores are self-contained — there's nothing for THIS
        # foundation to probe. The legacy per-store health endpoints
        # cover that. We surface "ok=True" so the diagnostic UI shows
        # the system as healthy when Postgres is intentionally off.
        out["ok"] = True
        return out

    t0 = time.monotonic()
    try:
        async with acquire() as conn:
            row = await conn.fetchrow("SELECT version() AS v")
            out["server_version"] = (row and row["v"]) or "unknown"
        out["pgvector_available"] = await is_pgvector_available()
        out["ok"] = True
    except DBConfigError as exc:
        out["error"] = f"config: {exc}"
    except DBUnavailable as exc:
        out["error"] = f"unavailable: {exc}"
    except Exception as exc:                              # pragma: no cover
        logger.warning("db health probe failed unexpectedly: %s", exc)
        out["error"] = f"probe: {exc}"
    finally:
        out["latency_ms"] = int((time.monotonic() - t0) * 1000)

    return out


__all__ = ["health_check"]
