# coding: utf-8
"""Phase 8 — VisionClient public surface."""
from __future__ import annotations

import logging
import os
from typing import Optional

from backend.services.assets import client as assets_client
from backend.services.vision import store
from backend.services.vision.analyzer import analyze as _analyze
from backend.services.vision.types import AnalysisResult


logger = logging.getLogger(__name__)


def is_enabled() -> bool:
    """Read ENABLE_VISION_PIPELINE dynamically. Default OFF — when off,
    analysis routes return cached results (if any) but never run the
    analyzer; new uploads stay status='uploaded' until the flag flips."""
    return os.getenv("ENABLE_VISION_PIPELINE", "false").strip().lower() == "true"


class VisionClient:

    def init(self) -> None:
        store.init()

    def is_enabled(self) -> bool:
        return is_enabled()

    def analyze(self, asset_id: str, *, user_id: Optional[str] = None,
                force: bool = False) -> Optional[AnalysisResult]:
        """Analyze one asset. Ownership-checked via assets_client.get.
        Returns None when the asset is missing OR vision is disabled
        AND no cached result exists."""
        rec = assets_client.get(asset_id, user_id=user_id)
        if rec is None:
            return None
        # Use the cached result unless force=True.
        if not force:
            cached = store.get(asset_id)
            if cached:
                return _hydrate(cached)
        if not is_enabled():
            # Disabled — return None so the route surfaces a 503-style
            # "analysis not run" body. The asset itself stays usable
            # via metadata-only.
            return None
        try:
            assets_client.mark_status(asset_id, "processing")
            result = _analyze(rec)
            store.upsert(result)
            assets_client.mark_status(asset_id, "ready",
                                      metadata={**(rec.metadata or {}),
                                                "analyzed_at": result.created_at})
            return result
        except Exception as e:
            logger.warning("vision.analyze %s error: %s", asset_id, e)
            assets_client.mark_status(asset_id, "failed",
                                      metadata={**(rec.metadata or {}),
                                                "analysis_error": str(e)[:200]})
            return None

    def get_cached(self, asset_id: str) -> Optional[dict]:
        """Read-only — returns whatever's in the cache, no analysis."""
        return store.get(asset_id)

    def stats(self) -> dict:
        return {
            "enabled":   is_enabled(),
            "tables":    store.table_counts(),
        }


def _hydrate(cached: dict) -> AnalysisResult:
    """Re-build an AnalysisResult from the cached JSON dict."""
    return AnalysisResult(
        asset_id=         cached.get("asset_id", ""),
        detected_type=    cached.get("detected_type", "unknown"),
        summary=          cached.get("summary"),
        extracted_text=   cached.get("extracted_text"),
        design_notes=     cached.get("design_notes"),
        colors=           cached.get("colors"),
        typography=       cached.get("typography"),
        layout_structure= cached.get("layout_structure"),
        warnings=         cached.get("warnings"),
        metadata=         cached.get("metadata", {}) or {},
        created_at=       cached.get("created_at", ""),
    )


client: VisionClient = VisionClient()

try:
    client.init()
except Exception as _e:
    logger.warning("vision.client: init failed: %s", _e)


__all__ = ["VisionClient", "client", "is_enabled"]
