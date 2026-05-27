# coding: utf-8
"""
Phase 8 — Vision analyzers.

Three analyzers behind one dispatch function:

  ImageAnalyzer   — basic metadata + (when configured) external
                    vision-model call. The Phase 8 default returns
                    HONEST metadata only (dimensions if `pillow` is
                    available, MIME, size) — never a hallucinated
                    description. The structured shape is ready for
                    the vision model to fill in design_notes / colors
                    / typography / layout_structure in a follow-up.

  DocumentAnalyzer — text extraction.
                    * .pdf → pypdf (when installed) → first 4000 chars
                    * .txt / .md / .csv / .json → decode + first 4000 chars
                    * everything else → metadata-only

  VideoAnalyzer    — explicitly marks the asset as
                    `warnings=["video frame extraction not supported"]`
                    so the chat-context builder surfaces a graceful
                    "we can describe the filename only" note instead
                    of pretending to have analysed the content.

Adding a real vision-model call later is one method on ImageAnalyzer:
`def _call_vision_model(image_bytes) -> dict` — the rest of the
pipeline (cache write, status flip, chat-context fold) stays the same.
"""
from __future__ import annotations

import logging
from typing import Optional

from backend.services.assets import client as _assets_client
from backend.services.assets.types import (
    AssetRecord, ASSET_TYPE_IMAGE, ASSET_TYPE_PDF,
    ASSET_TYPE_DOCUMENT, ASSET_TYPE_VIDEO, ASSET_TYPE_DATA,
    STATUS_READY, STATUS_PROCESSING, STATUS_FAILED,
)
from backend.services.vision.types import AnalysisResult, _now


logger = logging.getLogger(__name__)


# Cap for text extraction so we never inject a multi-megabyte chunk
# into a system prompt. ~4000 chars is the right ballpark for the
# context-window cost on a single chat turn.
_MAX_EXTRACTED_TEXT_CHARS = 4000


# ── Image ────────────────────────────────────────────────────────────────────

def _try_image_dimensions(data: bytes) -> Optional[tuple[int, int]]:
    """Best-effort image dimensions using `pillow` if available.
    Returns None when pillow isn't installed or the bytes don't
    decode as an image — no exception leaks out."""
    try:
        from PIL import Image          # type: ignore
        import io
        with Image.open(io.BytesIO(data)) as im:
            return im.size
    except Exception:
        return None


def analyze_image(record: AssetRecord, data: Optional[bytes]) -> AnalysisResult:
    """Return a HONEST analysis. Real vision-model call lands in a
    future PR; today we surface only metadata we actually know."""
    width = height = None
    if data:
        dims = _try_image_dimensions(data)
        if dims:
            width, height = dims
    summary = (
        f"Image asset {record.filename!r} ({record.mime_type}, "
        f"{record.size_bytes:,} bytes"
        f"{f', {width}×{height}px' if width else ''})."
    )
    metadata: dict = {
        "filename":   record.filename,
        "mime_type":  record.mime_type,
        "size_bytes": record.size_bytes,
    }
    if width and height:
        metadata["width"] = width
        metadata["height"] = height
    warnings: list[str] = []
    if data is None:
        warnings.append("bytes not available; metadata-only analysis")
    return AnalysisResult(
        asset_id=      record.id or "",
        detected_type= ASSET_TYPE_IMAGE,
        summary=       summary,
        metadata=      metadata,
        warnings=      warnings or None,
        created_at=    _now(),
    )


# ── PDF / document ───────────────────────────────────────────────────────────

def _try_pdf_text(data: bytes) -> Optional[str]:
    """Best-effort PDF → text via pypdf. Returns None when the lib
    isn't installed or the file isn't a parseable PDF."""
    try:
        import io
        from pypdf import PdfReader     # type: ignore
        reader = PdfReader(io.BytesIO(data))
        chunks: list[str] = []
        for page in reader.pages[:50]:  # cap pages so a giant PDF doesn't OOM
            try:
                txt = page.extract_text() or ""
                if txt:
                    chunks.append(txt)
            except Exception:
                continue
        out = "\n\n".join(chunks).strip()
        return out or None
    except Exception:
        return None


def _try_text_decode(data: bytes) -> Optional[str]:
    """Decode plain-text payloads. Tries utf-8 first, falls back to
    latin-1 (always succeeds) so we never raise on weird encodings."""
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("latin-1", errors="replace")
    except Exception:
        return None


def analyze_pdf(record: AssetRecord, data: Optional[bytes]) -> AnalysisResult:
    extracted: Optional[str] = None
    warnings: list[str] = []
    if data:
        extracted = _try_pdf_text(data)
        if extracted is None:
            warnings.append("pypdf not installed or document not parseable; metadata-only")
        else:
            if len(extracted) > _MAX_EXTRACTED_TEXT_CHARS:
                extracted = extracted[:_MAX_EXTRACTED_TEXT_CHARS] + "…"
    else:
        warnings.append("bytes not available; metadata-only analysis")
    summary = (
        f"PDF document {record.filename!r} ({record.size_bytes:,} bytes)."
        + (f" Text extracted ({len(extracted)} chars)." if extracted else "")
    )
    return AnalysisResult(
        asset_id=       record.id or "",
        detected_type=  ASSET_TYPE_PDF,
        summary=        summary,
        extracted_text= extracted,
        metadata={
            "filename": record.filename,
            "mime_type": record.mime_type,
            "size_bytes": record.size_bytes,
        },
        warnings=       warnings or None,
        created_at=     _now(),
    )


def analyze_document(record: AssetRecord, data: Optional[bytes]) -> AnalysisResult:
    extracted: Optional[str] = None
    if data:
        extracted = _try_text_decode(data)
        if extracted and len(extracted) > _MAX_EXTRACTED_TEXT_CHARS:
            extracted = extracted[:_MAX_EXTRACTED_TEXT_CHARS] + "…"
    summary = (
        f"Document {record.filename!r} ({record.mime_type}, "
        f"{record.size_bytes:,} bytes)."
        + (f" Text loaded ({len(extracted)} chars)." if extracted else "")
    )
    return AnalysisResult(
        asset_id=       record.id or "",
        detected_type=  ASSET_TYPE_DOCUMENT,
        summary=        summary,
        extracted_text= extracted,
        metadata={
            "filename": record.filename,
            "mime_type": record.mime_type,
            "size_bytes": record.size_bytes,
        },
        created_at=     _now(),
    )


# ── Video ────────────────────────────────────────────────────────────────────

def analyze_video(record: AssetRecord, data: Optional[bytes]) -> AnalysisResult:
    """Video frame extraction needs ffmpeg + a vision model and a
    proper job pipeline — not Phase 8 scope. We return a structured
    "not supported" so the chat-context builder shows a graceful
    note instead of pretending we understand the content."""
    return AnalysisResult(
        asset_id=      record.id or "",
        detected_type= ASSET_TYPE_VIDEO,
        summary= (
            f"Video upload {record.filename!r} ({record.size_bytes:,} bytes). "
            f"Frame extraction is not enabled in Phase 8 — only filename + "
            f"size are visible to the assistant."
        ),
        metadata={
            "filename": record.filename,
            "mime_type": record.mime_type,
            "size_bytes": record.size_bytes,
            "processing_not_supported": True,
        },
        warnings=["Video frame extraction not enabled; metadata-only"],
        created_at=_now(),
    )


# ── Dispatch ─────────────────────────────────────────────────────────────────

def analyze(record: AssetRecord, *, data: Optional[bytes] = None) -> AnalysisResult:
    """Pick the right analyzer for the asset's type. If `data` is None
    the manager will try to fetch it via the storage backend — the
    individual analyzers degrade to metadata-only in that case."""
    bytes_payload = data
    if bytes_payload is None and record.id:
        try:
            bytes_payload = _assets_client.read_bytes(record.id, user_id=record.user_id)
        except Exception:
            bytes_payload = None
    at = record.asset_type
    if at == ASSET_TYPE_IMAGE:
        return analyze_image(record, bytes_payload)
    if at == ASSET_TYPE_PDF:
        return analyze_pdf(record, bytes_payload)
    if at == ASSET_TYPE_DOCUMENT or at == ASSET_TYPE_DATA:
        return analyze_document(record, bytes_payload)
    if at == ASSET_TYPE_VIDEO:
        return analyze_video(record, bytes_payload)
    # Unknown — metadata only.
    return AnalysisResult(
        asset_id=      record.id or "",
        detected_type= at,
        summary=       f"Asset {record.filename!r} — type {at!r} not analyzed.",
        metadata={
            "filename": record.filename,
            "mime_type": record.mime_type,
            "size_bytes": record.size_bytes,
        },
        warnings=      [f"asset_type {at!r} is not analyzed in Phase 8"],
        created_at=    _now(),
    )


__all__ = [
    "analyze",
    "analyze_image", "analyze_pdf", "analyze_document", "analyze_video",
]
