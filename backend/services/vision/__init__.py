# coding: utf-8
"""
Phase 8 — Vision / File Understanding Layer.

Foundation only. The analyzer produces structured `AnalysisResult`s
suitable for chat-context injection. When no real vision model is
configured (Phase 8 default), the image analyzer returns a HONEST
structured placeholder containing only the metadata we actually know
(dimensions, mime, size) — never a hallucinated description.

PDF text extraction uses `pypdf` when available; otherwise returns
a metadata-only result.

Hooks:
    from backend.services.vision import client as vision_client
    result = vision_client.analyze(asset_record)
"""
from backend.services.vision.client import VisionClient, client, is_enabled
from backend.services.vision.types import AnalysisResult


__all__ = ["VisionClient", "client", "is_enabled", "AnalysisResult"]
