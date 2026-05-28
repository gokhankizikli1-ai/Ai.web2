# coding: utf-8
"""Phase 6 slice 3 — Embedding service for semantic memory.

Generates 1536-dim vectors via OpenAI's `text-embedding-3-small`. Used
by the memory_plane manager (auto-embed on insert when enabled) and by
the recall route (embed the query, then cosine-search against stored
vectors via pgvector).

Surface:
    from backend.services.memory_plane.embedding import (
        is_enabled, embed, embed_many, EMBEDDING_DIMS,
    )

Failure semantic:
    Functions NEVER raise. On any error (missing API key, network,
    quota, malformed input) they return None / [] and log a WARNING.
    The caller falls back to text search or skips embedding. Never
    blocks the write path.

Cache:
    Lightweight in-process LRU cache keyed by (model, text). Same query
    embedded twice in one process is free. NOT a cross-process cache —
    Redis layer is out of scope for this slice.

Env:
    ENABLE_EMBEDDINGS=true       master kill-switch (default: false)
    OPENAI_API_KEY=<key>         required when enabled
    EMBEDDING_MODEL=text-embedding-3-small   override the model
    EMBEDDING_CACHE_SIZE=4096    LRU cap
    EMBEDDING_TIMEOUT_SEC=8      per-call wall-clock cap
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import threading
from collections import OrderedDict
from typing import Optional


logger = logging.getLogger(__name__)


# text-embedding-3-small is 1536 dims. The vector(N) column type is fixed
# at create-time, so we hardcode the expected dimensionality here — a
# different model needs a schema migration, NOT a runtime swap.
EMBEDDING_DIMS = 1536

_DEFAULT_MODEL = "text-embedding-3-small"


def _flag(key: str) -> bool:
    return os.getenv(key, "false").strip().lower() == "true"


def is_enabled() -> bool:
    """True when the embedding service should run. Read dynamically so
    a Railway env flip is live without a restart."""
    return _flag("ENABLE_EMBEDDINGS") and bool(os.getenv("OPENAI_API_KEY", "").strip())


def _model() -> str:
    return (os.getenv("EMBEDDING_MODEL") or _DEFAULT_MODEL).strip() or _DEFAULT_MODEL


def _cache_size() -> int:
    try:
        return max(64, min(int(os.getenv("EMBEDDING_CACHE_SIZE", "4096") or 4096), 100_000))
    except Exception:
        return 4096


def _timeout() -> float:
    try:
        return max(1.0, min(float(os.getenv("EMBEDDING_TIMEOUT_SEC", "8") or 8.0), 60.0))
    except Exception:
        return 8.0


# ── LRU cache ──────────────────────────────────────────────────────────────

_CACHE_LOCK = threading.Lock()
_CACHE: "OrderedDict[str, list[float]]" = OrderedDict()


def _cache_key(model: str, text: str) -> str:
    h = hashlib.sha256(f"{model}:{text}".encode("utf-8")).hexdigest()
    return h


def _cache_get(model: str, text: str) -> Optional[list[float]]:
    k = _cache_key(model, text)
    with _CACHE_LOCK:
        v = _CACHE.get(k)
        if v is not None:
            _CACHE.move_to_end(k)
            return list(v)
    return None


def _cache_put(model: str, text: str, vec: list[float]) -> None:
    k = _cache_key(model, text)
    with _CACHE_LOCK:
        _CACHE[k] = list(vec)
        _CACHE.move_to_end(k)
        while len(_CACHE) > _cache_size():
            _CACHE.popitem(last=False)


def _cache_clear() -> None:
    """Test helper."""
    with _CACHE_LOCK:
        _CACHE.clear()


def cache_stats() -> dict:
    """Public health-style snapshot."""
    with _CACHE_LOCK:
        return {
            "size":     len(_CACHE),
            "capacity": _cache_size(),
            "model":    _model(),
            "enabled":  is_enabled(),
        }


# ── Public API ─────────────────────────────────────────────────────────────

async def embed(text: str) -> Optional[list[float]]:
    """Return a 1536-dim embedding for `text`, or None on any failure
    (including the service being disabled). Never raises.

    Cached: the same `text` returns the cached vector for the lifetime
    of the process (LRU-capped).
    """
    if not is_enabled():
        return None
    cleaned = (text or "").strip()
    if not cleaned:
        return None
    # OpenAI has an 8191-token cap for text-embedding-3-*. We don't
    # tokenize here — we just clip to a generous character budget that
    # stays well under the limit for any plausible memory snippet.
    cleaned = cleaned[:8000]

    model = _model()
    cached = _cache_get(model, cleaned)
    if cached is not None:
        return cached

    try:
        from openai import AsyncOpenAI         # noqa: PLC0415 — lazy
    except ImportError:
        logger.warning("embedding: openai SDK not installed")
        return None

    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key:
        return None

    try:
        client = AsyncOpenAI(api_key=api_key)
        resp = await asyncio.wait_for(
            client.embeddings.create(model=model, input=cleaned),
            timeout=_timeout(),
        )
        data = resp.data or []
        if not data:
            logger.warning("embedding: empty data from OpenAI")
            return None
        vec = list(data[0].embedding or [])
        if not vec:
            return None
        if len(vec) != EMBEDDING_DIMS:
            logger.warning(
                "embedding: dim mismatch: got %d, expected %d (model=%s)",
                len(vec), EMBEDDING_DIMS, model,
            )
            return None
        _cache_put(model, cleaned, vec)
        return vec
    except asyncio.TimeoutError:
        logger.warning("embedding: timeout after %.1fs", _timeout())
        return None
    except Exception as exc:
        logger.warning("embedding: %s", exc)
        return None


async def embed_many(texts: list[str]) -> list[Optional[list[float]]]:
    """Batch embed. Returns a list the same length as `texts`; each
    element is either a 1536-dim vector or None on per-item failure.

    Uses OpenAI's batched embeddings input — one HTTP call for N
    inputs — when more than 1 text is provided AND none are cached.
    Cached inputs short-circuit. NEVER raises.
    """
    if not is_enabled() or not texts:
        return [None] * len(texts)

    model = _model()
    out: list[Optional[list[float]]] = [None] * len(texts)
    pending_idx: list[int] = []
    pending_texts: list[str] = []
    for i, raw in enumerate(texts):
        cleaned = (raw or "").strip()[:8000]
        if not cleaned:
            continue
        cached = _cache_get(model, cleaned)
        if cached is not None:
            out[i] = cached
            continue
        pending_idx.append(i)
        pending_texts.append(cleaned)

    if not pending_texts:
        return out

    try:
        from openai import AsyncOpenAI         # noqa: PLC0415
    except ImportError:
        return out

    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key:
        return out

    try:
        client = AsyncOpenAI(api_key=api_key)
        resp = await asyncio.wait_for(
            client.embeddings.create(model=model, input=pending_texts),
            timeout=_timeout() * 2,    # batch needs a bit more
        )
        data = resp.data or []
        for slot, item in zip(pending_idx, data):
            vec = list(item.embedding or [])
            if vec and len(vec) == EMBEDDING_DIMS:
                _cache_put(model, pending_texts[pending_idx.index(slot)], vec)
                out[slot] = vec
    except Exception as exc:
        logger.warning("embedding.batch: %s", exc)

    return out


__all__ = [
    "EMBEDDING_DIMS",
    "is_enabled",
    "embed",
    "embed_many",
    "cache_stats",
    "_cache_clear",
]
