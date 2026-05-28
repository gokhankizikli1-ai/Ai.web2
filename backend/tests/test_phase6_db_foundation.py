# coding: utf-8
"""Phase 6 — DB foundation tests.

These tests do NOT touch a real Postgres. They exercise the foundation
package: env-driven backend selection, dialect adapter, vector
encoding, the health-check error paths, and the diagnostic route's
auth gate. Real Postgres connectivity is verified manually in the
Railway smoke test recorded in the PR description.
"""
from __future__ import annotations

import asyncio
import pytest

from backend.services.db import dialect
from backend.services.db.errors import DBConfigError, DBUnavailable
from backend.services.db.pgvector import encode_vector, decode_vector


# ── Dialect adapter ────────────────────────────────────────────────────────

class TestDialect:
    def test_placeholder_sqlite(self):
        assert dialect.placeholder(1, backend="sqlite") == "?"
        assert dialect.placeholder(7, backend="sqlite") == "?"

    def test_placeholder_postgres(self):
        assert dialect.placeholder(1, backend="postgres") == "$1"
        assert dialect.placeholder(7, backend="postgres") == "$7"

    def test_placeholder_unknown_backend(self):
        with pytest.raises(ValueError):
            dialect.placeholder(1, backend="mongodb")

    def test_placeholders_n(self):
        assert dialect.placeholders(3, backend="sqlite")   == "?, ?, ?"
        assert dialect.placeholders(3, backend="postgres") == "$1, $2, $3"
        assert dialect.placeholders(2, backend="postgres", start=5) == "$5, $6"

    def test_bool_literal(self):
        assert dialect.bool_literal(True,  backend="postgres") == "TRUE"
        assert dialect.bool_literal(False, backend="postgres") == "FALSE"
        assert dialect.bool_literal(True,  backend="sqlite")   == "1"
        assert dialect.bool_literal(False, backend="sqlite")   == "0"

    def test_quote_ident_basic(self):
        assert dialect.quote_ident("memories") == '"memories"'

    def test_quote_ident_escapes_internal_quotes(self):
        # Defends against an attacker-supplied identifier that contains
        # a double quote. The standard escape is to double it.
        assert dialect.quote_ident('weird"name') == '"weird""name"'


# ── Vector encoding ────────────────────────────────────────────────────────

class TestVectorEncoding:
    def test_encode_simple(self):
        assert encode_vector([0.1, 0.2, 0.3]).startswith("[")
        assert encode_vector([1, 2, 3]).endswith("]")
        s = encode_vector([0.5, -0.25])
        # repr() preserves float precision and the ordering is preserved
        assert "0.5" in s and "-0.25" in s

    def test_encode_rejects_empty(self):
        with pytest.raises(ValueError):
            encode_vector([])

    def test_encode_rejects_oversize(self):
        with pytest.raises(ValueError):
            encode_vector([0.1] * 5000)

    def test_encode_rejects_non_numeric(self):
        with pytest.raises(TypeError):
            encode_vector([0.1, "bad", 0.3])  # type: ignore[list-item]

    def test_decode_round_trip(self):
        vec = [0.1, 0.2, -0.5, 1.0]
        s = encode_vector(vec)
        assert decode_vector(s) == vec

    def test_decode_handles_none(self):
        assert decode_vector(None) == []
        assert decode_vector("") == []
        assert decode_vector("[]") == []

    def test_decode_handles_no_brackets(self):
        # Some pgvector wire forms may not include the brackets.
        assert decode_vector("0.1,0.2,0.3") == [0.1, 0.2, 0.3]

    def test_decode_handles_list_passthrough(self):
        # asyncpg may already deserialize the vector into a list when
        # a codec is registered. Helper should be idempotent.
        assert decode_vector([1.0, 2.0]) == [1.0, 2.0]  # type: ignore[arg-type]


# ── Engine env handling ────────────────────────────────────────────────────

class TestEngineEnv:
    def test_disabled_by_default(self, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("ENABLE_POSTGRES_BACKEND", raising=False)
        from backend.services.db import engine
        assert engine.is_enabled() is False
        assert engine.current_backend() == "sqlite"

    def test_enabled_requires_both_env_vars(self, monkeypatch):
        from backend.services.db import engine

        monkeypatch.setenv("DATABASE_URL", "postgresql://x@host/db")
        monkeypatch.delenv("ENABLE_POSTGRES_BACKEND", raising=False)
        assert engine.is_enabled() is False

        monkeypatch.setenv("ENABLE_POSTGRES_BACKEND", "true")
        assert engine.is_enabled() is True
        assert engine.current_backend() == "postgres"

        monkeypatch.delenv("DATABASE_URL", raising=False)
        assert engine.is_enabled() is False

    def test_postgres_url_normalized(self, monkeypatch):
        from backend.services.db import engine
        # Heroku-style `postgres://` should be rewritten to
        # `postgresql://` for asyncpg.
        monkeypatch.setenv("DATABASE_URL", "postgres://u:p@h/db")
        normalised = engine._database_url()
        assert normalised.startswith("postgresql://")
        assert normalised.endswith("@h/db")

    def test_get_pool_raises_config_when_disabled(self, monkeypatch):
        from backend.services.db import engine
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("ENABLE_POSTGRES_BACKEND", raising=False)
        # Reset module cache so any previous test pool doesn't leak.
        engine._POOL = None
        with pytest.raises(DBConfigError):
            asyncio.run(engine.get_pool())


# ── Health check error paths ───────────────────────────────────────────────

class TestHealth:
    def test_sqlite_backend_reports_ok(self, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("ENABLE_POSTGRES_BACKEND", raising=False)
        from backend.services.db.health import health_check
        out = asyncio.run(health_check())
        assert out["backend"] == "sqlite"
        assert out["ok"] is True
        assert out["enabled"] is False
        assert out["error"] is None

    def test_postgres_unreachable_reports_error(self, monkeypatch):
        # Postgres "enabled" but the address is bogus — health probe
        # should surface DBUnavailable without raising.
        monkeypatch.setenv("DATABASE_URL", "postgresql://nobody@127.0.0.1:1/none")
        monkeypatch.setenv("ENABLE_POSTGRES_BACKEND", "true")
        monkeypatch.setenv("DB_POOL_TIMEOUT_SEC", "1")  # fail fast in tests
        from backend.services.db import engine
        engine._POOL = None
        from backend.services.db.health import health_check
        out = asyncio.run(health_check())
        assert out["backend"] == "postgres"
        assert out["enabled"] is True
        assert out["ok"] is False
        assert out["error"] is not None
        # The probe didn't crash — that's the contract.


# ── Route auth gate ────────────────────────────────────────────────────────

class TestDbHealthRoute:
    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient
        from backend.api import app
        # raise_server_exceptions=False so MissingTokenError / UnauthorizedError
        # surface as 4xx via the app's exception handlers rather than
        # blowing up the test runner.
        return TestClient(app, raise_server_exceptions=False)

    _TEST_TOKEN = "test-owner-token-1234567890"   # 16+ chars, required by match_owner_token

    def test_non_owner_rejected(self, client, monkeypatch):
        # Guest with no token must NOT get the diagnostic. Exact status
        # code depends on the app's MissingTokenError handler — we just
        # require it isn't 200.
        monkeypatch.setenv("ENABLE_ADMIN_MODE", "true")
        monkeypatch.setenv("OWNER_TOKEN", self._TEST_TOKEN)
        r = client.get("/v2/db/health")
        assert r.status_code != 200

    def test_owner_via_token_gets_envelope(self, client, monkeypatch):
        monkeypatch.setenv("ENABLE_ADMIN_MODE", "true")
        monkeypatch.setenv("OWNER_TOKEN", self._TEST_TOKEN)
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("ENABLE_POSTGRES_BACKEND", raising=False)

        r = client.get(
            "/v2/db/health",
            headers={"X-Korvix-Owner-Token": self._TEST_TOKEN},
        )
        # SQLite path returns ok=true via envelope_ok → 200
        assert r.status_code == 200
        body = r.json()
        assert body["success"] is True
        assert body["data"]["backend"] == "sqlite"
        assert body["data"]["ok"] is True
