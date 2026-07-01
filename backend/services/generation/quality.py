# coding: utf-8
# EPIC 2 — Internal quality review.
#
# A deterministic heuristic that scores generated HTML on the signals
# the milestone cares about (design system, semantics, responsiveness,
# dark mode, hierarchy, no placeholder junk). The engine uses it to
# decide whether to accept LLM output or fall back to the deterministic
# premium renderer — i.e. the "refinement pass" gate.

from __future__ import annotations

import re
from typing import List, Tuple

QUALITY_THRESHOLD = 70

# Phrases that betray a beginner template / placeholder output.
_PLACEHOLDERS = [
    r"\bmy app\b", r"\byour app\b", r"\bfeature\s*\d\b", r"lorem ipsum",
    r"\bplaceholder\b(?!\s*=)", r"example\.com", r"\bcard\s*\d\b", r"\bitem\s*\d\b",
    r"\btitle goes here\b", r"\bsection\s*\d\b", r"\btodo[:!]",
]

# Generic marketing filler that reads as templated rather than written for
# THIS product — model output leaning on these is a strong "not premium"
# signal even when it otherwise looks structurally fine. "Everything you
# need" is only flagged BARE — "...for reports"/"...to know" are legitimate,
# page-specific completions the deterministic renderer itself uses.
_GENERIC_COPY = [
    r"a clearer way forward", r"everything you need\b(?!\s+(?:for|to\s+know)\b)",
    r"this tool transformed our business", r"real-time data\b",
]

# A hardcoded copyright YEAR ("© 2023", "(c) 2024 Acme Inc") is a dead
# giveaway of stale boilerplate, except when the year is the first token of
# the deterministic renderer's brand footer ("© {brand} · ...").
_STALE_COPYRIGHT_RE = re.compile(
    r"(?:©|\(c\))\s*(?:19|20)\d{2}(?![^<]*·\s*(?:crafted with korvix|all systems operational))",
    re.I,
)

# The design system is CSS/SVG-only by contract (the preview CSP only
# allows `img-src data:`) — any <img> tag in model output renders as a
# broken image in the sandboxed iframe, exactly the "broken product mockup"
# failure mode this guards against.
_IMG_TAG_RE = re.compile(r"<img[\s>]", re.I)


def has_placeholders(html: str) -> bool:
    h = (html or "").lower()
    if any(re.search(p, h) for p in _PLACEHOLDERS):
        return True
    if any(re.search(p, h) for p in _GENERIC_COPY):
        return True
    if _STALE_COPYRIGHT_RE.search(h):
        return True
    if _IMG_TAG_RE.search(h):
        return True
    return False


def score(html: str) -> Tuple[int, List[str]]:
    """Return (0-100 quality score, list of issues). Higher is better."""
    h = html or ""
    low = h.lower()
    issues: List[str] = []
    pts = 0

    # Substance (20) — real length AND actual structural depth. Raw
    # character count alone can be gamed by verbose CSS on a single flat
    # section; a genuinely premium page reads as several distinct
    # sections (hero, features, proof, CTA, ...), so multi-section depth
    # is required for full marks, not just byte count.
    section_count = len(re.findall(r"<section[\s>]", low))
    if len(h) >= 1200 and section_count >= 3: pts += 20
    elif len(h) >= 1200 or section_count >= 2: pts += 12
    elif len(h) >= 600: pts += 6
    else: issues.append("too short / thin content")
    if 0 < section_count < 3:
        issues.append("thin section depth (fewer than 3 distinct sections)")

    # Design system / real CSS (20)
    if "var(--" in h or "ds-" in h: pts += 20
    elif "<style" in low or "tailwind" in low or 'class="' in low: pts += 10
    else: issues.append("no cohesive design system / styling")

    # Semantic structure (15)
    if re.search(r"<(header|main|section|footer|nav)[\s>]", low): pts += 15
    else: issues.append("no semantic structure")

    # Responsiveness (15)
    if "viewport" in low and ("@media" in low or "minmax(" in low or "grid-template" in low):
        pts += 15
    else: issues.append("not responsive (missing viewport / media queries)")

    # Dark mode / theming (10)
    if "--bg" in h or "prefers-color-scheme" in low or ".light" in h or "dark" in low:
        pts += 10
    else: issues.append("no dark/light theming")

    # Motion / polish (10)
    if "transition" in low or "@keyframes" in low or "animation" in low: pts += 10
    else: issues.append("no transitions / micro-animations")

    # Hierarchy (10)
    if re.search(r"<h1[\s>]", low) and re.search(r"<h2[\s>]", low): pts += 10
    else: issues.append("weak visual hierarchy")

    # Placeholder penalty
    if has_placeholders(h):
        pts = max(0, pts - 40)
        issues.append("contains placeholder copy")

    return min(100, pts), issues


def is_premium(html: str) -> bool:
    s, _ = score(html)
    return s >= QUALITY_THRESHOLD and not has_placeholders(html)


__all__ = ["QUALITY_THRESHOLD", "score", "is_premium", "has_placeholders"]
