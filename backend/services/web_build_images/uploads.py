# coding: utf-8
"""
Web Build — device image upload validation (Phase 14K.6).

Strict, dependency-free validation for user-uploaded images that will REPLACE an
auto-sourced example image in a generated project. There is no image-processing
library in this backend, so validation is done from the file signature + a small
header parser (never trusting the filename or the declared MIME alone):

  • magic-byte signature must be a real JPEG / PNG / WebP (SVG, GIF, HTML, PDF,
    executables and renamed non-images are rejected);
  • the declared MIME, when present, must agree with the detected format;
  • dimensions are parsed from the header to enforce min/max size + a total
    pixel cap (a cheap decompression-bomb guard) BEFORE anything is stored.

AVIF is intentionally NOT accepted yet: without a decoder we cannot safely bound
its decoded dimensions, so it is deferred (documented) rather than trusted.

Nothing here logs image bytes or original filenames. The validated bytes are
handed to the existing asset system for storage; this module never touches disk.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Optional, Tuple

MAX_BYTES = 10 * 1024 * 1024          # 10 MB source cap
MIN_SIDE = 200                        # reject tiny / accidental crops
MAX_SIDE = 12000                      # reject absurd single dimensions
MAX_PIXELS = 100_000_000             # ~100 MP total — decompression-bomb guard

# detected format → (canonical mime, extension)
_FORMAT = {
    "jpeg": ("image/jpeg", "jpg"),
    "png": ("image/png", "png"),
    "webp": ("image/webp", "webp"),
}


class ImageUploadError(Exception):
    """Structured, client-safe validation failure (never a raw exception)."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class ValidatedImage:
    fmt: str          # 'jpeg' | 'png' | 'webp'
    mime: str
    ext: str
    width: int
    height: int
    size_bytes: int


def _detect_format(data: bytes) -> Optional[str]:
    """Return the real image format from magic bytes, or None if unsupported."""
    if len(data) < 16:
        return None
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def _png_dimensions(data: bytes) -> Optional[Tuple[int, int]]:
    # IHDR is the first chunk: length(4) 'IHDR'(4) width(4) height(4) at offset 8.
    if len(data) >= 24 and data[12:16] == b"IHDR":
        w, h = struct.unpack(">II", data[16:24])
        return int(w), int(h)
    return None


def _jpeg_dimensions(data: bytes) -> Optional[Tuple[int, int]]:
    # Walk the marker segments until a Start-Of-Frame (SOFn) carries the size.
    i, n = 2, len(data)
    while i + 9 < n:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        # Standalone markers (no length) — skip.
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        seg_len = struct.unpack(">H", data[i + 2:i + 4])[0]
        # SOF0..SOF15 except DHT(C4) / JPG(C8) / DAC(CC) carry frame dimensions.
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            if i + 9 <= n:
                h, w = struct.unpack(">HH", data[i + 5:i + 9])
                return int(w), int(h)
            return None
        i += 2 + seg_len
    return None


def _webp_dimensions(data: bytes) -> Optional[Tuple[int, int]]:
    fourcc = data[12:16]
    try:
        if fourcc == b"VP8 ":                       # lossy
            w = struct.unpack("<H", data[26:28])[0] & 0x3FFF
            h = struct.unpack("<H", data[28:30])[0] & 0x3FFF
            return int(w), int(h)
        if fourcc == b"VP8L":                        # lossless
            b0, b1, b2, b3 = data[21], data[22], data[23], data[24]
            w = ((b1 & 0x3F) << 8 | b0) + 1
            h = ((b3 & 0x0F) << 10 | b2 << 2 | (b1 & 0xC0) >> 6) + 1
            return int(w), int(h)
        if fourcc == b"VP8X":                        # extended
            w = (data[24] | data[25] << 8 | data[26] << 16) + 1
            h = (data[27] | data[28] << 8 | data[29] << 16) + 1
            return int(w), int(h)
    except (IndexError, struct.error):
        return None
    return None


def _dimensions(fmt: str, data: bytes) -> Optional[Tuple[int, int]]:
    if fmt == "png":
        return _png_dimensions(data)
    if fmt == "jpeg":
        return _jpeg_dimensions(data)
    if fmt == "webp":
        return _webp_dimensions(data)
    return None


def validate_image(data: bytes, *, declared_mime: Optional[str]) -> ValidatedImage:
    """Validate raw bytes as a safe, replaceable web image. Raises ImageUploadError."""
    size = len(data or b"")
    if size == 0:
        raise ImageUploadError("empty", "The image file is empty.")
    if size > MAX_BYTES:
        raise ImageUploadError("too_large", "The image is too large.")

    fmt = _detect_format(data)
    if fmt is None:
        raise ImageUploadError("unsupported_format", "Unsupported image format.")

    mime, ext = _FORMAT[fmt]
    dm = (declared_mime or "").split(";")[0].strip().lower()
    # If the client declared a MIME, it must agree with the real signature
    # (jpg/jpeg synonyms allowed) — a mismatch means a renamed/mislabeled file.
    if dm and dm != mime and not (fmt == "jpeg" and dm in ("image/jpg", "image/jpeg")):
        raise ImageUploadError("mime_mismatch", "Unsupported image format.")

    dims = _dimensions(fmt, data)
    if dims is None:
        # A real signature but an unreadable header — refuse rather than guess.
        raise ImageUploadError("corrupt", "The image could not be read.")
    w, h = dims
    if w <= 0 or h <= 0 or w > MAX_SIDE or h > MAX_SIDE:
        raise ImageUploadError("bad_dimensions", "The image dimensions are not supported.")
    if w < MIN_SIDE or h < MIN_SIDE:
        raise ImageUploadError("too_small", "The image is too small.")
    if w * h > MAX_PIXELS:
        raise ImageUploadError("too_many_pixels", "The image dimensions are not supported.")

    return ValidatedImage(fmt=fmt, mime=mime, ext=ext, width=w, height=h, size_bytes=size)


__all__ = ["validate_image", "ValidatedImage", "ImageUploadError",
           "MAX_BYTES", "MIN_SIDE", "MAX_SIDE", "MAX_PIXELS"]
