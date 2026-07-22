# coding: utf-8
"""
Generation Adaptation — translate intelligence OUTPUTS into generation rules.

This is a pure TRANSLATION layer. It does NOT analyse anything or duplicate any
intelligence logic — it reads the already-computed outputs (a design personality
profile, a Visual Strategy, a Motion Strategy, and Quality Guidelines) and reshapes
them into one compact, actionable ``DESIGN GENERATION RULES`` block the code-generation
model can follow: what kind of website to create, before how to write the code.

It reads every input by duck-typing (object OR its ``to_dict`` dict), never exposes
internal scoring/reasoning (confidence, matched signals, archetype keys), is bounded, and
never raises.
"""
from __future__ import annotations

from typing import Any, List

_MAX_FIELD = 180
_MAX_AVOID = 7
_HEADER = "DESIGN GENERATION RULES"

# personality value → a human "overall feeling" phrase (prose, never the raw enum key).
_FEELING = {
    "trustworthy_premium": "a trustworthy, professional, credible",
    "cinematic_elegant": "a premium, cinematic, editorial",
    "playful": "a friendly, energetic, approachable",
    "natural_editorial": "a warm, authentic, editorial",
    "minimal_modern": "a refined, minimal, intentional",
    "bold_creative": "a bold, expressive, confident",
    "futuristic": "a modern, innovative, forward-looking",
    "approachable_professional": "a clean, modern, approachable",
}

# personality value → layout behaviour guidance (the "shape" of the page).
_LAYOUT = {
    "trustworthy_premium": "Prefer a clear, structured hierarchy and readable sections; avoid flashy hero gimmicks.",
    "cinematic_elegant": "Prefer immersive, full-bleed editorial sections over dense card grids.",
    "playful": "Prefer friendly, rounded, lively sections; keep it approachable, not corporate.",
    "natural_editorial": "Prefer warm, image-led editorial sections with generous breathing room.",
    "minimal_modern": "Prefer generous whitespace and restraint; one clear focus per section.",
    "bold_creative": "Prefer expressive, asymmetric, edge-to-edge composition.",
    "futuristic": "Advanced, dimensional or experimental composition is acceptable when the concept justifies it.",
    "approachable_professional": "Prefer a balanced, uncluttered layout with one clear focal point per section.",
}

# Anti-generic staples — always steer away from lazy defaults (the whole point of the
# personality layer). Phrased so a genuinely futuristic brand is not blocked.
_ANTI_GENERIC = (
    "generic SaaS dashboard styling when it doesn't fit",
    "templated futuristic/neon AI clichés unless the concept truly calls for it",
    "excessive gradients",
)


def _get(source: Any, key: str) -> Any:
    if isinstance(source, dict):
        return source.get(key)
    return getattr(source, key, None)


def _text(value: Any, limit: int = _MAX_FIELD) -> str:
    if value is None:
        return ""
    raw = getattr(value, "value", value)  # unwrap enums
    return " ".join(str(raw).split()).strip()[:limit]


def _humanize(value: Any) -> str:
    return _text(str(getattr(value, "value", value)).replace("_", " "))


def _join(parts: List[str], sep: str = "; ") -> str:
    return sep.join(p for p in (x.strip() for x in parts) if p)


def _overall_feeling(personality_value: str, visual_style: str) -> str:
    feeling = _FEELING.get(personality_value, _FEELING["approachable_professional"])
    return f"Create {feeling} experience" + (f", grounded in a {visual_style} direction." if visual_style else ".")


def _visual_direction(visual: Any) -> str:
    image = _get(visual, "image_strategy") or {}
    pieces = [
        _text(_get(image, "photography_style")),
        _text(_get(visual, "color_direction")),
        _text(_get(visual, "typography_direction")),
    ]
    body = _join([p for p in pieces if p])
    return f"Prioritize {body}." if body else ""


def _motion_behavior(motion: Any) -> str:
    intensity = _humanize(_get(motion, "intensity"))
    style = _humanize(_get(motion, "animation_style"))
    hero = _humanize(_get(motion, "hero_behavior"))
    core = _join([f"{intensity} {style} motion".strip(), (f"{hero} in the hero" if hero else "")], sep=", ")
    line = f"Use {core}." if core.strip() else ""
    if intensity in ("none", "minimal", "subtle"):
        line = (line + " Avoid excessive movement.").strip()
    return line


def _layout_behavior(personality_value: str) -> str:
    return _LAYOUT.get(personality_value, _LAYOUT["approachable_professional"])


def _avoid(personality: Any, visual: Any, motion: Any, quality: Any) -> List[str]:
    image = _get(visual, "image_strategy") or {}
    raw: List[str] = []
    for source, key in (
        (personality, "avoid_list"),
        (motion, "avoided_effects"),
        (image, "avoid_patterns"),
        (quality, "avoid_patterns"),
    ):
        value = _get(source, key)
        if isinstance(value, (list, tuple)):
            raw.extend(str(v) for v in value)
    # Anti-generic staples LEAD (they are the cross-cutting "never generic" rules and must
    # survive the cap), then the intelligence-specific avoids fill the rest.
    out: List[str] = []
    seen: set = set()
    for item in list(_ANTI_GENERIC) + list(raw):
        human = _humanize(item)
        low = human.lower()
        if human and low not in seen:
            seen.add(low)
            out.append(human)
        if len(out) >= _MAX_AVOID:
            break
    return out


def translate(personality: Any, visual: Any, motion: Any, quality: Any) -> str:
    """Reshape the intelligence outputs into the compact DESIGN GENERATION RULES block.
    Returns ``""`` only if nothing usable could be produced. Never raises."""
    try:
        personality_value = str(getattr(_get(personality, "design_personality"), "value",
                                        _get(personality, "design_personality") or "") or "")
        visual_style = _text(_get(visual, "visual_style"), 80)

        lines: List[str] = [_HEADER]
        lines.append(f"- Overall feeling: {_overall_feeling(personality_value, visual_style)}")

        vis = _visual_direction(visual)
        if vis:
            lines.append(f"- Visual direction: {vis}")

        mot = _motion_behavior(motion)
        if mot:
            lines.append(f"- Motion behavior: {mot}")

        lines.append(f"- Layout behavior: {_layout_behavior(personality_value)}")

        avoid = _avoid(personality, visual, motion, quality)
        if avoid:
            lines.append("- Avoid: " + "; ".join(avoid))

        lines.append(
            "Priority: explicit user request > industry/business need > brand personality > "
            "visual direction > quality recommendations > generic defaults. This is guidance for "
            "generation, not a replacement for user requirements; never apply generic futuristic or "
            "neon AI styling unless the context clearly requires it."
        )
        # A block with only the header + priority note (no substance) is not worth adding.
        return "\n".join(lines) if len(lines) > 2 else ""
    except Exception:  # noqa: BLE001 — translation must never break a generation run
        return ""


__all__ = ["translate"]
