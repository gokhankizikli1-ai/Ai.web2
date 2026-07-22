# coding: utf-8
"""
Web Quality Guard — the guidelines formatter.

Renders :class:`QualityGuidelines` into a compact, model-facing ``QUALITY GUIDELINES``
block. It is design guidance only — never JSON, never internal fields (site_category /
source), never the user's prompt, never technical implementation instructions. Empty
sections are omitted and the whole block is hard-bounded well under ~300 tokens.

Pure and total: reads the guidelines by duck-typing (object OR its ``to_dict`` dict) and
never raises.
"""
from __future__ import annotations

from typing import Any, List, Tuple

_HEADER = "QUALITY GUIDELINES:"
_MAX_BULLETS = 3          # per section — keeps the block tight
_MAX_BULLET_CHARS = 60
_MAX_TOTAL = 1100         # ~275 tokens at ~4 chars/token — safely under the 300 cap


def _get(source: Any, key: str) -> Any:
    if isinstance(source, dict):
        return source.get(key)
    return getattr(source, key, None)


def _bullets(source: Any, key: str) -> List[str]:
    value = _get(source, key)
    if not isinstance(value, (list, tuple)):
        return []
    out: List[str] = []
    seen: set = set()
    for item in value:
        text = " ".join(str(item).split()).strip()[:_MAX_BULLET_CHARS]
        low = text.lower()
        if text and low not in seen:
            seen.add(low)
            out.append(text)
        if len(out) >= _MAX_BULLETS:
            break
    return out


def format_guidelines(guidelines: Any) -> str:
    """Render the compact QUALITY GUIDELINES block, or ``""`` when there is nothing to
    say. Sections with no bullets are omitted; the block is bounded on both bullets and
    total length."""
    if guidelines is None:
        return ""

    # (heading, source-key) in priority order — later sections drop first if trimmed.
    sections: Tuple[Tuple[str, str], ...] = (
        ("Layout", "layout_principles"),
        ("UX", "ux_principles"),
        ("Visual", "visual_principles"),
        ("Conversion", "conversion_principles"),
        ("Craft", "code_quality_principles"),
        ("Avoid", "avoid_patterns"),
    )

    lines: List[str] = [_HEADER]
    total = len(_HEADER)
    for heading, key in sections:
        bullets = _bullets(guidelines, key)
        if not bullets:
            continue
        block = [f"{heading}:"] + [f"- {b}" for b in bullets]
        block_len = sum(len(x) + 1 for x in block)
        if total + block_len > _MAX_TOTAL:
            break  # keep the whole block bounded
        lines.extend(block)
        total += block_len

    return "\n".join(lines) if len(lines) > 1 else ""


__all__ = ["format_guidelines"]
