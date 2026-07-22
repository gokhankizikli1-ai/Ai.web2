# coding: utf-8
"""
Web Build context — the Design Intelligence formatter.

Turns a Visual Strategy + Motion Strategy into a COMPACT, human-readable text block the
website-generating model can act on. It is deliberately not JSON and never leaks
internal model fields (archetype / confidence / source / realism enums / flags) — only
the design decisions a designer would brief. Empty fields are omitted, values are
truncated, and the whole block is hard-bounded so it stays well under ~500 extra tokens.

Pure and total: it reads the strategies by duck-typing (object OR its ``to_dict`` dict),
never mutates them, and never raises.
"""
from __future__ import annotations

from typing import Any, List, Optional, Tuple

# Per-field + total character bounds (a conservative ~4 chars/token keeps the whole
# block comfortably under the <500-token target).
_MAX_VALUE = 90
_MAX_AVOID_ITEMS = 6
_MAX_TOTAL = 1200
_HEADER = "DESIGN INTELLIGENCE:"


def _get(source: Any, key: str) -> Any:
    if isinstance(source, dict):
        return source.get(key)
    return getattr(source, key, None)


def _text(value: Any) -> str:
    """Coerce a value (incl. a str-Enum) to a bounded, single-line string."""
    if value is None:
        return ""
    raw = getattr(value, "value", value)  # unwrap enums
    return " ".join(str(raw).split()).strip()[:_MAX_VALUE]


def _humanize(value: Any) -> str:
    return _text(str(getattr(value, "value", value)).replace("_", " "))


def _list(source: Any, key: str) -> List[str]:
    value = _get(source, key)
    return [str(v) for v in value if str(v).strip()] if isinstance(value, (list, tuple)) else []


def build_design_context(visual_strategy: Any, motion_strategy: Any) -> str:
    """Render the compact DESIGN INTELLIGENCE block, or ``""`` when there is nothing
    meaningful to say. Sections with no value are omitted entirely."""
    visual = visual_strategy or {}
    motion = motion_strategy or {}

    image = _get(visual, "image_strategy") or {}
    intensity = _humanize(_get(motion, "intensity"))
    animation = _humanize(_get(motion, "animation_style"))
    motion_direction = " ".join(p for p in (intensity, animation) if p).strip()

    # Combine what BOTH layers say to avoid, humanized + de-duplicated.
    avoid_raw = _list(motion, "avoided_effects") + _list(image, "avoid_patterns")
    avoid: List[str] = []
    seen = set()
    for item in avoid_raw:
        human = _humanize(item)
        if human and human.lower() not in seen:
            seen.add(human.lower())
            avoid.append(human)
        if len(avoid) >= _MAX_AVOID_ITEMS:
            break

    # (label, value) in priority order — later ones drop first if the block is trimmed.
    sections: List[Tuple[str, str]] = [
        ("Brand feeling", _text(_get(visual, "brand_personality"))),
        ("Visual direction", _text(_get(visual, "visual_style"))),
        ("Color direction", _text(_get(visual, "color_direction"))),
        ("Image direction", _text(_get(image, "photography_style"))),
        ("Motion direction", motion_direction),
        ("Hero behavior", _humanize(_get(motion, "hero_behavior"))),
        ("Interaction", _humanize(_get(motion, "interaction_style"))),
        ("Avoid", ", ".join(avoid)),
    ]

    lines: List[str] = []
    for label, value in sections:
        if not value:
            continue  # never emit an empty section
        candidate = f"{label}: {value}"
        # Keep the block bounded; stop before exceeding the total budget.
        projected = len(_HEADER) + 1 + sum(len(x) + 1 for x in lines) + len(candidate) + 1
        if projected > _MAX_TOTAL:
            break
        lines.append(candidate)

    if not lines:
        return ""
    return f"{_HEADER}\n" + "\n".join(lines)


__all__ = ["build_design_context"]
