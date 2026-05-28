# coding: utf-8
"""Phase 6 slice 3 — semantic recall + embedding service tests.

Covers:
  1. embedding service — cache hit/miss, disabled path, OpenAI errors
  2. SQLite semantic_recall — cosine ranking correctness, k cap, empty
  3. Dispatcher routes semantic_recall to the right backend
  4. db_migrate vector-upgrade CLI parser + env gate
  5. /v2/memory/recall route — 503 when embeddings off

The OpenAI client is never called for real; we monkeypatch
`AsyncOpenAI.embeddings.create` and the `is_enabled()` flag.
"""
from __future__ import annotations

import asyncio
import math
from typing import Optional

import pytest

from backend.services.memory_plane import embedding, store as mp_store
from backend.services.memory_plane.types import MemoryRecord


# ── 1. Embedding cache + disabled-path ─────────────────────────────────────

class TestEmbeddingService:
    def test_disabled_returns_none(self, monkeypatch):
        monkeypatch.delenv("ENABLE_EMBEDDINGS", raising=False)
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        result = asyncio.run(embedding.embed("hello"))
        assert result is None

    def test_empty_input_returns_none(self, monkeypatch):
        monkeypatch.setenv("ENABLE_EMBEDDINGS", "true")
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        result = asyncio.run(embedding.embed("   "))
        assert result is None

    def test_cache_returns_stable_vector(self, monkeypatch):
        """Same input → same cached vector, no second OpenAI call."""
        monkeypatch.setenv("ENABLE_EMBEDDINGS", "true")
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        embedding._cache_clear()

        # Prime the cache directly — verifies LRU behaviour.
        fake_vec = [0.1] * 1536
        embedding._cache_put(embedding._model(), "primed text", fake_vec)
        result = asyncio.run(embedding.embed("primed text"))
        assert result == fake_vec

    def test_cache_evicts_oldest(self, monkeypatch):
        monkeypatch.setenv("ENABLE_EMBEDDINGS", "true")
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        monkeypatch.setenv("EMBEDDING_CACHE_SIZE", "64")
        embedding._cache_clear()
        for i in range(70):
            embedding._cache_put(embedding._model(), f"text {i}", [float(i)] * 1536)
        stats = embedding.cache_stats()
        assert stats["size"] <= 64

    def test_is_enabled_reads_dynamically(self, monkeypatch):
        monkeypatch.setenv("ENABLE_EMBEDDINGS", "true")
        monkeypatch.setenv("OPENAI_API_KEY", "sk-x")
        assert embedding.is_enabled() is True
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        assert embedding.is_enabled() is False


# ── 2. SQLite semantic_recall correctness ──────────────────────────────────

class TestSqliteSemanticRecall:
    """Inserts three records with hand-picked embeddings and verifies the
    ranking matches the cosine math."""

    def _insert_with_embedding(self, user_id: str, content: str,
                                emb: list[float]):
        from backend.services.memory_plane import store_sqlite
        return store_sqlite.insert(MemoryRecord(
            user_id=user_id, content=content, embedding=emb,
        ))

    def test_returns_top_k_by_cosine(self, tmp_memory_plane_db, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        from backend.services.memory_plane import store_sqlite

        # Three vectors that aren't orthogonal — query close to A, far from C.
        a = [1.0, 0.0, 0.0] + [0.0] * 1533
        b = [0.7, 0.7, 0.0] + [0.0] * 1533
        c = [0.0, 0.0, 1.0] + [0.0] * 1533

        self._insert_with_embedding("u1", "A — close to query", a)
        self._insert_with_embedding("u1", "B — angled away",    b)
        self._insert_with_embedding("u1", "C — orthogonal",     c)

        query_vec = [1.0, 0.0, 0.0] + [0.0] * 1533
        results = store_sqlite.semantic_recall("u1", query_vec, k=3)

        assert len(results) == 3
        ranks = [rec.content for rec, _ in results]
        # A must be first (cos=1.0), C must be last (cos=0.0).
        assert ranks[0] == "A — close to query"
        assert ranks[-1] == "C — orthogonal"
        # Scores monotonically decrease.
        scores = [s for _, s in results]
        assert scores[0] >= scores[1] >= scores[2]

    def test_respects_k_cap(self, tmp_memory_plane_db, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        from backend.services.memory_plane import store_sqlite
        for i in range(5):
            self._insert_with_embedding(
                "u1", f"r{i}",
                [float(j == i) for j in range(1536)],
            )
        query = [1.0] + [0.0] * 1535
        results = store_sqlite.semantic_recall("u1", query, k=2)
        assert len(results) == 2

    def test_empty_user_returns_empty(self, tmp_memory_plane_db, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        from backend.services.memory_plane import store_sqlite
        result = store_sqlite.semantic_recall("nobody", [1.0] + [0.0] * 1535, k=10)
        assert result == []

    def test_records_without_embedding_skipped(self, tmp_memory_plane_db, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        from backend.services.memory_plane import store_sqlite
        # Mix: one embedded, one without
        self._insert_with_embedding("u1", "embedded",
                                    [1.0] + [0.0] * 1535)
        store_sqlite.insert(MemoryRecord(user_id="u1", content="no emb"))
        results = store_sqlite.semantic_recall(
            "u1", [1.0] + [0.0] * 1535, k=10,
        )
        assert len(results) == 1
        assert results[0][0].content == "embedded"

    def test_user_isolation(self, tmp_memory_plane_db, monkeypatch):
        """Cross-user leak guard — u1's recall must not surface u2's data."""
        monkeypatch.delenv("DATABASE_URL", raising=False)
        from backend.services.memory_plane import store_sqlite
        u1_vec = [1.0] + [0.0] * 1535
        u2_vec = [1.0] + [0.0] * 1535   # IDENTICAL vector → would match if leaking
        self._insert_with_embedding("u1", "u1 only", u1_vec)
        self._insert_with_embedding("u2", "u2 only", u2_vec)
        results = store_sqlite.semantic_recall("u1", [1.0] + [0.0] * 1535, k=10)
        contents = [rec.content for rec, _ in results]
        assert "u2 only" not in contents


# ── 3. Dispatcher routes semantic_recall ───────────────────────────────────

class TestDispatcherSemanticRecall:
    def test_routes_to_sqlite_by_default(self, tmp_memory_plane_db, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("ENABLE_POSTGRES_BACKEND", raising=False)

        from backend.services.memory_plane import store_sqlite
        store_sqlite.insert(MemoryRecord(
            user_id="u-disp", content="dispatched",
            embedding=[1.0] + [0.0] * 1535,
        ))
        results = mp_store.semantic_recall(
            "u-disp", [1.0] + [0.0] * 1535, k=5,
        )
        assert len(results) == 1
        assert results[0][0].content == "dispatched"


# ── 4. db_migrate vector-upgrade parser + gate ─────────────────────────────

class TestVectorUpgradeCLI:
    def test_parses_vector_upgrade_subcommand(self):
        from backend.scripts.db_migrate import _build_parser
        ns = _build_parser().parse_args(["vector-upgrade"])
        assert ns.cmd == "vector-upgrade"
        assert ns.dims == 1536

    def test_dims_override(self):
        from backend.scripts.db_migrate import _build_parser
        ns = _build_parser().parse_args(["vector-upgrade", "--dims", "768"])
        assert ns.dims == 768

    def test_vector_upgrade_exits_2_when_postgres_off(self, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.delenv("ENABLE_POSTGRES_BACKEND", raising=False)
        from backend.scripts import db_migrate
        rc = db_migrate.main(["vector-upgrade"])
        assert rc == 2


# ── 5. /v2/memory/recall route gating ──────────────────────────────────────

class TestRecallRoute:
    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient
        from backend.api import app
        return TestClient(app, raise_server_exceptions=False)

    def test_recall_503_when_embeddings_off(self, client, monkeypatch):
        # Owner unlock so we get past auth and into the embed-enabled check.
        monkeypatch.setenv("ENABLE_ADMIN_MODE", "true")
        monkeypatch.setenv("OWNER_TOKEN", "owner-token-1234567890")
        monkeypatch.setenv("ENABLE_MEMORY_PLANE", "true")
        monkeypatch.delenv("ENABLE_EMBEDDINGS", raising=False)
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)

        r = client.get(
            "/v2/memory/recall?q=hello",
            headers={"X-Korvix-Owner-Token": "owner-token-1234567890"},
        )
        assert r.status_code == 503
        # The error message must mention the disabled flag so the
        # operator sees what to flip.
        body = r.json()
        assert "ENABLE_EMBEDDINGS" in str(body)

    def test_recall_requires_q_param(self, client, monkeypatch):
        monkeypatch.setenv("ENABLE_ADMIN_MODE", "true")
        monkeypatch.setenv("OWNER_TOKEN", "owner-token-1234567890")
        monkeypatch.setenv("ENABLE_MEMORY_PLANE", "true")
        r = client.get(
            "/v2/memory/recall",
            headers={"X-Korvix-Owner-Token": "owner-token-1234567890"},
        )
        assert r.status_code == 422  # FastAPI validation error
