# coding: utf-8
"""
Image Intelligence — color parsing & harmony scoring.

Real color math, not a keyword match. Providers hand us a single dominant color per
photo (Pexels ``avg_color``, Unsplash ``color``). We convert both that color and the
brand palette into HSL and score how well the photo's dominant color sits with the
brand — using classic color-theory relationships (identical / analogous /
complementary / triadic hue offsets) plus a lightness (tone) agreement term.

Everything here is pure and total: an unparseable or missing color yields a neutral
score, never an exception.
"""
from __future__ import annotations

import re
from typing import List, Optional, Tuple

# A small set of named colors so a palette expressed in words ("black", "gold") still
# produces a usable hue/lightness signal without a full CSS color table.
_NAMED_COLORS = {
    "black": "#000000", "white": "#ffffff", "gray": "#808080", "grey": "#808080",
    "silver": "#c0c0c0", "red": "#e11d2f", "crimson": "#dc143c", "orange": "#f97316",
    "amber": "#f59e0b", "gold": "#d4af37", "yellow": "#facc15", "lime": "#84cc16",
    "green": "#16a34a", "emerald": "#10b981", "teal": "#14b8a6", "cyan": "#06b6d4",
    "sky": "#0ea5e9", "blue": "#2563eb", "indigo": "#4f46e5", "violet": "#7c3aed",
    "purple": "#9333ea", "magenta": "#d946ef", "pink": "#ec4899", "rose": "#f43f5e",
    "brown": "#92400e", "beige": "#e8d9b5", "cream": "#f5efe0", "navy": "#0b1f3a",
}

_HEX_RE = re.compile(r"^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$")

# Neutral score returned when no meaningful comparison can be made (missing color,
# missing palette). Deliberately mid-range so color never dominates a decision it
# has no signal for.
NEUTRAL_SCORE = 55.0


def parse_color(value: Optional[str]) -> Optional[Tuple[int, int, int]]:
    """Parse a hex (``#rgb``/``#rrggbb``) or common named color into RGB. None if unusable."""
    if not value:
        return None
    token = str(value).strip().lower()
    token = _NAMED_COLORS.get(token, token)
    match = _HEX_RE.match(token)
    if not match:
        return None
    digits = match.group(1)
    if len(digits) == 3:
        digits = "".join(ch * 2 for ch in digits)
    try:
        return int(digits[0:2], 16), int(digits[2:4], 16), int(digits[4:6], 16)
    except ValueError:
        return None


def rgb_to_hsl(rgb: Tuple[int, int, int]) -> Tuple[float, float, float]:
    """RGB (0-255) → HSL with hue in degrees [0,360), saturation & lightness in [0,1]."""
    r, g, b = (channel / 255.0 for channel in rgb)
    high, low = max(r, g, b), min(r, g, b)
    lightness = (high + low) / 2.0
    if high == low:
        return 0.0, 0.0, lightness  # achromatic
    delta = high - low
    saturation = delta / (2.0 - high - low) if lightness > 0.5 else delta / (high + low)
    if high == r:
        hue = (g - b) / delta + (6.0 if g < b else 0.0)
    elif high == g:
        hue = (b - r) / delta + 2.0
    else:
        hue = (r - g) / delta + 4.0
    return (hue / 6.0) * 360.0, saturation, lightness


def _hue_distance(a: float, b: float) -> float:
    """Smallest distance between two hues on the color wheel, in degrees [0,180]."""
    diff = abs(a - b) % 360.0
    return 360.0 - diff if diff > 180.0 else diff


def _hue_relationship_score(distance: float) -> float:
    """Reward classic harmonic relationships; penalize the awkward in-between angles.

    Peaks at monochromatic (0°), analogous (~30°), complementary (~180°) and triadic
    (~120°); troughs around the clashing ~60°/~90° offsets.
    """
    anchors = ((0.0, 100.0), (30.0, 90.0), (120.0, 82.0), (180.0, 88.0))
    best = 40.0  # baseline for an offset near none of the harmonic anchors
    for angle, peak in anchors:
        # Triangular falloff over a 45° window around each harmonic anchor.
        proximity = max(0.0, 1.0 - _hue_distance(distance, angle) / 45.0)
        best = max(best, 40.0 + (peak - 40.0) * proximity)
    return best


def harmony_score(image_color: Optional[str], palette: List[str]) -> float:
    """Score (0-100) how well a photo's dominant color harmonizes with the brand palette.

    Combines the best hue relationship across the palette with a tone (lightness)
    agreement term. Returns :data:`NEUTRAL_SCORE` when either side has no usable color.
    """
    image_rgb = parse_color(image_color)
    palette_rgb = [c for c in (parse_color(p) for p in (palette or [])) if c is not None]
    if image_rgb is None or not palette_rgb:
        return NEUTRAL_SCORE

    img_h, img_s, img_l = rgb_to_hsl(image_rgb)
    best = 0.0
    for swatch in palette_rgb:
        sw_h, sw_s, sw_l = rgb_to_hsl(swatch)
        # Near-greyscale colors have no meaningful hue — score them on tone alone so a
        # dark/light photo still reads as matching a dark/light brand.
        if img_s < 0.12 or sw_s < 0.12:
            hue_term = 62.0
        else:
            hue_term = _hue_relationship_score(_hue_distance(img_h, sw_h))
        tone_term = 100.0 * (1.0 - abs(img_l - sw_l))
        best = max(best, 0.72 * hue_term + 0.28 * tone_term)
    return round(max(0.0, min(100.0, best)), 2)


def is_dark(image_color: Optional[str]) -> Optional[bool]:
    """True if the color reads as dark, False if light, None if unknown."""
    rgb = parse_color(image_color)
    if rgb is None:
        return None
    _, _, lightness = rgb_to_hsl(rgb)
    return lightness < 0.5


__all__ = ["parse_color", "rgb_to_hsl", "harmony_score", "is_dark", "NEUTRAL_SCORE"]
