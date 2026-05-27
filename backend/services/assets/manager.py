# coding: utf-8
"""
Phase 8 — Asset manager.

Validates → writes bytes → persists DB row → returns AssetRecord.
The one place upload orchestration lives.
"""
from __future__ import annotations

import logging
from typing import Optional

from backend.services.assets import store
from backend.services.assets.errors import (
    AssetAccessDenied, AssetNotFound, AssetValidationError,
)
from backend.services.assets.storage import AssetStorage, build_storage
from backend.services.assets.types import (
    AssetRecord, STATUS_UPLOADED, STATUS_READY,
    STATUS_PROCESSING, STATUS_FAILED, ASSET_TYPE_VIDEO,
)
from backend.services.assets.validator import validate_upload


logger = logging.getLogger(__name__)


class AssetManager:
    """Stateful — owns the storage backend singleton. Construct once
    per process; the module-level `manager` is the canonical instance."""

    def __init__(self, storage: Optional[AssetStorage] = None) -> None:
        self._storage: Optional[AssetStorage] = storage

    def _get_storage(self) -> AssetStorage:
        if self._storage is None:
            self._storage = build_storage()
        return self._storage

    # ── Upload ─────────────────────────────────────────────────────────────

    def upload(
        self,
        *,
        user_id: str,
        filename: str,
        mime_type: Optional[str],
        data: bytes,
        project_id: Optional[str] = None,
        chat_id: Optional[str] = None,
        message_id: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> AssetRecord:
        """One-shot upload — validate, persist bytes, write the DB row.
        Raises AssetValidationError on bad input."""
        if not user_id:
            raise AssetValidationError("user_id is required",
                                       code="ASSET_USER_REQUIRED")
        outcome = validate_upload(
            filename=filename, mime_type=mime_type, size_bytes=len(data or b""),
        )
        # Bytes first — if persistence fails we don't write a half DB row.
        storage = self._get_storage()
        key = storage.write(user_id=user_id, filename=filename, data=data)
        # Initial status:
        #   image / pdf / document / data → "uploaded" (ready for analysis)
        #   video                         → "ready" (no analysis on Phase 8)
        # The vision pipeline flips uploaded → processing → ready/failed.
        initial_status = (
            STATUS_READY if outcome.asset_type == ASSET_TYPE_VIDEO
            else STATUS_UPLOADED
        )
        # Stash a flag on video assets so the chat-context builder
        # surfaces a graceful "video processing not supported yet" note.
        md = dict(metadata or {})
        if outcome.asset_type == ASSET_TYPE_VIDEO:
            md.setdefault("processing_not_supported", True)
            md.setdefault("note", "Video frame extraction not enabled in Phase 8.")
        record = AssetRecord(
            user_id=      str(user_id),
            project_id=   project_id,
            chat_id=      chat_id,
            message_id=   message_id,
            filename=     filename,
            mime_type=    outcome.mime_type,
            size_bytes=   len(data),
            storage_path= key,
            asset_type=   outcome.asset_type,
            status=       initial_status,
            metadata=     md,
        )
        return store.insert(record)

    # ── Read ───────────────────────────────────────────────────────────────

    def get(self, asset_id: str, *, user_id: Optional[str] = None) -> Optional[AssetRecord]:
        """Fetch one with ownership guard. Returns None on cross-user
        so the route surfaces 404 (existence hidden)."""
        rec = store.get(asset_id)
        if rec is None:
            return None
        if user_id is not None and rec.user_id != str(user_id):
            return None
        return rec

    def list_user(
        self,
        user_id: str,
        *,
        project_id: Optional[str] = None,
        chat_id: Optional[str] = None,
        asset_type: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[AssetRecord]:
        return store.list_for_user(
            user_id, project_id=project_id, chat_id=chat_id,
            asset_type=asset_type, limit=limit, offset=offset,
        )

    def list_for_message(self, user_id: str, message_id: str) -> list[AssetRecord]:
        return store.list_for_message(user_id, message_id)

    def list_by_ids(self, user_id: str, ids: list[str]) -> list[AssetRecord]:
        """Look up multiple assets by id — ownership-checked. Used by
        chat-context builder when the chat request carries asset_ids."""
        return store.list_by_ids(user_id, ids)

    # ── Mutate ─────────────────────────────────────────────────────────────

    def attach_to_message(
        self, asset_id: str, *, user_id: str, message_id: str,
    ) -> Optional[AssetRecord]:
        """Link an existing asset to a chat message. Ownership-checked."""
        rec = self.get(asset_id, user_id=user_id)
        if rec is None:
            raise AssetAccessDenied(
                "asset not found", details={"asset_id": asset_id},
            )
        return store.update(asset_id, message_id=message_id)

    def mark_status(
        self, asset_id: str, status: str, *,
        metadata: Optional[dict] = None,
    ) -> Optional[AssetRecord]:
        """Used by the vision pipeline to flip uploaded → processing → ready/failed."""
        kwargs: dict = {"status": status}
        if metadata is not None:
            kwargs["metadata"] = metadata
        return store.update(asset_id, **kwargs)

    # ── Delete ─────────────────────────────────────────────────────────────

    def delete(self, asset_id: str, *, user_id: str) -> bool:
        """Soft-delete the row. The bytes stay on disk until a future
        sweep — fine because the public URL no longer resolves to a
        live row (the blob route checks the DB)."""
        return store.soft_delete(asset_id, user_id=str(user_id))


# Module-level singleton.
manager: AssetManager = AssetManager()


def _reset_for_tests() -> None:
    """Test helper — drop storage state so the next call rebuilds it
    from the current env vars."""
    manager._storage = None


__all__ = ["AssetManager", "manager", "_reset_for_tests"]
