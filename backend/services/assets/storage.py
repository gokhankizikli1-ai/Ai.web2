# coding: utf-8
"""
Phase 8 — Asset storage backend abstraction.

Single-class interface (`AssetStorage`) with one concrete impl today
(`LocalAssetStorage`). Adding R2 / S3 / Supabase later is a new
subclass + one config-string branch in `build_storage()` — no other
file changes anywhere.

Design rules:
  * Storage keys are caller-opaque strings. The caller hands the
    storage layer bytes + a SHORT logical name; the storage layer
    returns a key. The DB row stores ONLY the key.
  * `public_url(key)` is the one place URL composition happens.
    Local backend serves via a route mounted in api.py; R2/S3
    return signed URLs.
  * `read(key)` returns bytes — used by the vision pipeline. Optional
    on every backend (the API doesn't expose raw bytes to clients
    directly; the FE always goes through public_url).
  * Every operation that touches disk raises AssetStorageError on
    OSError so the caller branches on the typed exception.
"""
from __future__ import annotations

import hashlib
import logging
import os
import secrets
from pathlib import Path
from typing import Optional, Protocol

from backend.services.assets.errors import AssetStorageError


logger = logging.getLogger(__name__)


# ── Storage interface ───────────────────────────────────────────────────────

class AssetStorage(Protocol):
    backend_name: str

    def write(self, *, user_id: str, filename: str, data: bytes) -> str:
        """Persist bytes under a deterministic key derived from
        (user_id, filename, content-hash). Returns the storage key
        that goes into the DB row's storage_path."""
        ...

    def read(self, key: str) -> bytes:
        """Return the bytes at the given key. Raises AssetStorageError
        if the key doesn't resolve."""
        ...

    def delete(self, key: str) -> bool:
        """Remove the object. Returns True on success, False when the
        key is unknown (idempotent)."""
        ...

    def public_url(self, key: str) -> str:
        """Return a URL the FE can use to render/download. For the
        local backend this is a route on the API; for cloud backends
        a (possibly signed) CDN URL."""
        ...

    def stats(self) -> dict:
        """Cheap snapshot for /v2/assets/health/diagnostic."""
        ...


# ── Local filesystem backend ────────────────────────────────────────────────

class LocalAssetStorage:
    """Writes to a directory under cwd (ASSETS_STORAGE_LOCAL_ROOT).

    Layout:
        <root>/<user-prefix>/<hash>__<safe-filename>

    The hash gives us de-duplication for free (same bytes by same user
    return the same key); the original filename is preserved in the
    key so a download via `public_url` reveals the human-readable
    name in the URL tail.

    Production note: Railway's default filesystem is ephemeral — mount
    a persistent volume at the configured root path for durability.
    For Phase 8 this is sufficient as a starting foundation; an R2 /
    S3 adapter ships in a follow-up.
    """

    backend_name = "local"

    def __init__(self, root: str = "uploads") -> None:
        self._root = Path(root).resolve()
        try:
            self._root.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            logger.warning("LocalAssetStorage: cannot create root %s: %s", self._root, e)

    # ── Private helpers ───────────────────────────────────────────────────

    def _key_for(self, *, user_id: str, filename: str, data: bytes) -> str:
        h = hashlib.sha256(data).hexdigest()[:24]
        safe = "".join(c if c.isalnum() or c in ".-_" else "_" for c in (filename or "asset"))[:80]
        prefix = (user_id or "anon")[:24]
        return f"{prefix}/{h}__{safe}"

    def _full_path(self, key: str) -> Path:
        # Defence: refuse keys that try to escape the root via "../".
        # Path resolution does the rest.
        p = (self._root / key).resolve()
        if not str(p).startswith(str(self._root)):
            raise AssetStorageError(
                "invalid storage key (path escape attempted)",
                details={"key": key},
            )
        return p

    # ── Interface ─────────────────────────────────────────────────────────

    def write(self, *, user_id: str, filename: str, data: bytes) -> str:
        if not isinstance(data, (bytes, bytearray)) or not data:
            raise AssetStorageError("empty or non-bytes payload",
                                    code="ASSET_STORAGE_EMPTY")
        key = self._key_for(user_id=user_id, filename=filename, data=bytes(data))
        path = self._full_path(key)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            # Idempotent — if the same bytes were already written, do nothing.
            if not path.exists():
                # tmp + rename so a partial write never leaves a corrupt file.
                tmp = path.with_suffix(path.suffix + f".tmp-{secrets.token_hex(4)}")
                tmp.write_bytes(bytes(data))
                tmp.replace(path)
        except OSError as e:
            raise AssetStorageError(f"failed to write asset: {e}") from e
        return key

    def read(self, key: str) -> bytes:
        path = self._full_path(key)
        try:
            return path.read_bytes()
        except FileNotFoundError as e:
            raise AssetStorageError("asset bytes missing", details={"key": key}) from e
        except OSError as e:
            raise AssetStorageError(f"failed to read asset: {e}") from e

    def delete(self, key: str) -> bool:
        try:
            path = self._full_path(key)
            if path.exists():
                path.unlink()
                return True
            return False
        except OSError as e:
            logger.warning("LocalAssetStorage.delete %s: %s", key, e)
            return False

    def public_url(self, key: str) -> str:
        # Mounted at /v2/assets/blob/<key> by the route layer.
        # Keys are url-safe enough (path-style with alnum/dash/dot/underscore).
        return f"/v2/assets/blob/{key}"

    def stats(self) -> dict:
        try:
            n = sum(1 for _ in self._root.rglob("*") if _.is_file())
        except OSError:
            n = -1
        return {
            "backend":    self.backend_name,
            "root":       str(self._root),
            "file_count": n,
        }


# ── Factory ─────────────────────────────────────────────────────────────────

def build_storage() -> AssetStorage:
    """Pick the storage backend from env. Defaults to local."""
    backend = os.getenv("ASSETS_STORAGE_BACKEND", "local").strip().lower()
    if backend == "local":
        root = os.getenv("ASSETS_STORAGE_LOCAL_ROOT", "uploads")
        return LocalAssetStorage(root=root)
    # Future: R2, S3, Supabase — each one new class + branch.
    logger.warning(
        "Unknown ASSETS_STORAGE_BACKEND=%r; falling back to local",
        backend,
    )
    return LocalAssetStorage()


__all__ = ["AssetStorage", "LocalAssetStorage", "build_storage"]
