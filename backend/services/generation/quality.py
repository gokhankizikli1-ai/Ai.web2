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
    r"\bplaceholder\b", r"example\.com", r"\bcard\s*\d\b", r"\bitem\s*\d\b",
    r"\btitle goes here\b", r"\bsection\s*\d\b", r"\btodo\b",
]


def has_placeholders(html: str) -> bool:
    h = (html or "").lower()
    return any(re.search(p, h) for p in _PLACEHOLDERS)


def score(html: str) -> Tuple[int, List[str]]:
    """Return (0-100 quality score, list of issues). Higher is better."""
    h = html or ""
    low = h.lower()
    issues: List[str] = []
    pts = 0

    # Substance (20)
    if len(h) >= 1200: pts += 20
    elif len(h) >= 600: pts += 10
    else: issues.append("too short / thin content")

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
