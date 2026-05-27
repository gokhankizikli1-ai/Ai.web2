# coding: utf-8
"""
Phase 8 — AssetsClient public surface.

Same flag-gated pattern as JobsClient / MemoryPlaneClient: all writes
raise AssetSystemDisabled when the flag is off; all reads return
None / [] silently. The /v2/assets routes translate the disabled
exception into a structured 503 envelope.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

from backend.services.assets import store
from backend.services.assets.errors import AssetSystemDisabled
from backend.services.assets.manager import manager as _manager
from backend.services.assets.storage import build_storage
from backend.services.assets.types import AssetRecord


logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    """Read ENABLE_ASSET_SYSTEM dynamically so Railway flag flips
    take effect on the next request without a restart."""
    return os.getenv("ENABLE_ASSET_SYSTEM", "false").strip().lower() == "true"


class AssetsClient:

    def init(self) -> None:
        store.init()

    def is_enabled(self) -> bool:
        return is_enabled()

    # ── Upload + mutate (require flag ON) ──────────────────────────────────

    def upload(
        self, *, user_id: str, filename: str, mime_type: Optional[str],
        data: bytes, project_id: Optional[str] = None,
        chat_id: Optional[str] = None, message_id: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> AssetRecord:
        if not is_enabled():
            raise AssetSystemDisabled(
                "Asset system is disabled. Set ENABLE_ASSET_SYSTEM=true to activate."
            )
        return _manager.upload(
            user_id=user_id, filename=filename, mime_type=mime_type, data=data,
            project_id=project_id, chat_id=chat_id, message_id=message_id,
            metadata=metadata,
        )

    def attach_to_message(self, asset_id: str, *, user_id: str, message_id: str) -> Optional[AssetRecord]:
        if not is_enabled():
            raise AssetSystemDisabled("Asset system is disabled.")
        return _manager.attach_to_message(asset_id, user_id=user_id, message_id=message_id)

    def delete(self, asset_id: str, *, user_id: str) -> bool:
        if not is_enabled():
            raise AssetSystemDisabled("Asset system is disabled.")
        return _manager.delete(asset_id, user_id=user_id)

    def mark_status(self, asset_id: str, status: str, *,
                    metadata: Optional[dict] = None) -> Optional[AssetRecord]:
        if not is_enabled():
            return None
        return _manager.mark_status(asset_id, status, metadata=metadata)

    # ── Reads (no-op when disabled) ────────────────────────────────────────

    def get(self, asset_id: str, *, user_id: Optional[str] = None) -> Optional[AssetRecord]:
        if not is_enabled():
            return None
        return _manager.get(asset_id, user_id=user_id)

    def list_user(
        self, user_id: str, *,
        project_id: Optional[str] = None,
        chat_id: Optional[str] = None,
        asset_type: Optional[str] = None,
        limit: int = 50, offset: int = 0,
    ) -> list[AssetRecord]:
        if not is_enabled():
            return []
        return _manager.list_user(
            user_id, project_id=project_id, chat_id=chat_id,
            asset_type=asset_type, limit=limit, offset=offset,
        )

    def list_by_ids(self, user_id: str, ids: list[str]) -> list[AssetRecord]:
        if not is_enabled():
            return []
        return _manager.list_by_ids(user_id, ids)

    def list_for_message(self, user_id: str, message_id: str) -> list[AssetRecord]:
        if not is_enabled():
            return []
        return _manager.list_for_message(user_id, message_id)

    # ── Bytes (used by the blob route + vision pipeline) ───────────────────

    def read_bytes(self, asset_id: str, *, user_id: Optional[str] = None) -> Optional[bytes]:
        rec = self.get(asset_id, user_id=user_id)
        if rec is None or not rec.storage_path:
            return None
        try:
            return _manager._get_storage().read(rec.storage_path)
        except Exception as e:
            logger.warning("assets.client.read_bytes %s error: %s", asset_id, e)
            return None

    def public_url(self, asset_id: str, *, user_id: Optional[str] = None) -> Optional[str]:
        rec = self.get(asset_id, user_id=user_id)
        if rec is None or not rec.storage_path:
            return None
        try:
            return _manager._get_storage().public_url(rec.storage_path)
        except Exception:
            return None

    # ── Observability ──────────────────────────────────────────────────────

    def stats(self) -> dict:
        out: dict = {
            "enabled":  is_enabled(),
            "store":    store.store_stats(),
            "tables":   store.table_counts(),
        }
        try:
            if _manager._storage is not None:
                out["storage"] = _manager._storage.stats()
            else:
                out["storage"] = build_storage().stats()
        except Exception as e:
            out["storage_error"] = str(e)[:140]
        return out


client: AssetsClient = AssetsClient()


try:
    client.init()
except Exception as _e:
    logger.warning("assets.client: init failed: %s", _e)


__all__ = ["AssetsClient", "client", "is_enabled"]
