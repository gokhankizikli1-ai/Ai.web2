# coding: utf-8
"""
Conservative, Unicode-safe validation/normalization for a user-editable display name.

Used by the authenticated display-name update route. Pure (no I/O), so it is unit-testable
and reused identically on read-back. It NEVER decides authorization and NEVER touches email,
role, plan or any identity field — only the visible name string.

Rules (Turkish and general Unicode fully supported; ASCII is NOT required):
  * input must be a string
  * strip Unicode control/format/surrogate characters (category starting with "C")
  * collapse internal whitespace runs to a single space and trim the ends
  * require at least 1 visible character (reject empty / whitespace-only)
  * enforce a sensible maximum length (MAX_DISPLAY_NAME_CHARS)
"""
from __future__ import annotations

import unicodedata
from typing import Tuple

# Sensible cap for an editable display name — within the 120-char storage column,
# comfortably above real names, and small enough to keep every UI label tidy.
MAX_DISPLAY_NAME_CHARS = 80


def normalize_display_name(raw: object) -> Tuple[bool, str]:
    """Return (True, cleaned_name) on success, or (False, error_code) on rejection.

    error_code is one of: 'invalid' (not a string), 'empty' (no visible character),
    'too_long' (exceeds MAX_DISPLAY_NAME_CHARS after normalization).
    """
    if not isinstance(raw, str):
        return False, "invalid"
    # Drop control/format/surrogate/private-use/unassigned chars (Unicode category C*),
    # which also removes newlines/tabs/zero-width joiners. Letters (incl. Turkish
    # İ/ı/ş/ğ/ç/ö/ü), marks, numbers, punctuation and spaces are preserved.
    kept = [ch for ch in raw if not unicodedata.category(ch).startswith("C")]
    # Collapse any whitespace (incl. Unicode spaces) to single ASCII spaces and trim.
    cleaned = " ".join("".join(kept).split())
    if len(cleaned) < 1:
        return False, "empty"
    if len(cleaned) > MAX_DISPLAY_NAME_CHARS:
        return False, "too_long"
    return True, cleaned


__all__ = ["normalize_display_name", "MAX_DISPLAY_NAME_CHARS"]
