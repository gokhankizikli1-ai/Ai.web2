# coding: utf-8
"""Phase 6 — SQL dialect adapter.

Lets a store write ONE query string that works on both SQLite and
Postgres. The differences we paper over here are intentionally narrow:

  1. Parameter placeholders:  SQLite uses ``?``;  Postgres uses ``$1, $2, …``.
  2. Boolean literals:        SQLite stores ``INTEGER`` (0/1); Postgres
                              has ``BOOLEAN`` — we use ``TRUE``/``FALSE``.
  3. UPSERT idiom:            SQLite supports ``INSERT … ON CONFLICT``
                              (since 3.24); Postgres has the same syntax.
                              No translation needed today; helper kept
                              for future divergence.
  4. Timestamp default:       both accept ISO-8601 strings, but Postgres
                              also has ``timestamptz``. Stores keep
                              writing ISO strings — schema choice is
                              local to the store's own bootstrap SQL.

NOT a query builder — we are NOT introducing an ORM in this slice.
This module is ~50 lines of small helpers a store imports when it
needs to be portable. Most stores will still write dialect-specific
SQL until they're individually ported.
"""
from __future__ import annotations

from typing import Iterable


def placeholder(idx: int, *, backend: str) -> str:
    """Return the parameter placeholder for parameter index `idx`
    (1-based to match Postgres semantics). On SQLite the index is
    ignored — it always uses ``?``."""
    if backend == "postgres":
        return f"${idx}"
    if backend == "sqlite":
        return "?"
    raise ValueError(f"unknown backend: {backend}")


def placeholders(n: int, *, backend: str, start: int = 1) -> str:
    """Comma-separated placeholders for an `n`-column INSERT."""
    return ", ".join(placeholder(i, backend=backend) for i in range(start, start + n))


def quote_ident(name: str) -> str:
    """Conservative identifier quoter — both SQLite and Postgres
    accept double-quoted identifiers per SQL standard. Escapes embedded
    double quotes by doubling them. Use this for any column/table name
    that comes from data (never for trusted literals)."""
    return '"' + name.replace('"', '""') + '"'


def bool_literal(value: bool, *, backend: str) -> str:
    """Backend-specific TRUE/FALSE literal for use in a hardcoded SQL
    fragment (NEVER for parameterised queries — pass real booleans for
    those)."""
    if backend == "postgres":
        return "TRUE" if value else "FALSE"
    return "1" if value else "0"


__all__ = [
    "placeholder", "placeholders", "quote_ident", "bool_literal",
]
