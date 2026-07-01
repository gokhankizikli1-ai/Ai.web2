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
from typing import Dict, List, Optional, Tuple

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
# giveaway of stale boilerplate — the deterministic renderer's own footer
# never emits one (it reads "© {brand} · ..."), so any occurrence here can
# only have come from generic/templated model output.
_STALE_COPYRIGHT_RE = re.compile(r"(?:©|\(c\))\s*(?:19|20)\d{2}", re.I)

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


def reflects_spec(html: str, spec_name: str = "", spec_metrics: Optional[List[Dict[str, str]]] = None) -> bool:
    """True when the reply is demonstrably ABOUT this product, not a
    generic template that would read the same for any prompt in the same
    category. The deterministic spec's brand name and metric VALUES
    ($482K, 4.2x, AUM figures, ...) are product-specific numbers an LLM
    free-writing a generic reply won't coincidentally reproduce — so
    requiring most of them to appear verbatim is a strong, cheap proxy for
    "this is the real thing, not old fallback copy that ignores the
    user's actual prompt." Called with no spec context (the common case
    for direct is_premium() callers/tests), it's a no-op that always
    passes — fully backward compatible."""
    if not spec_name and not spec_metrics:
        return True
    h = html or ""
    if spec_name and spec_name.lower() not in h.lower():
        return False
    values = [str(m.get("value", "")).strip() for m in (spec_metrics or []) if m.get("value")]
    if not values:
        return True
    hits = sum(1 for v in values if v and v in h)
    return hits >= max(1, len(values) // 2)


def is_premium(html: str, *, spec_name: str = "", spec_metrics: Optional[List[Dict[str, str]]] = None) -> bool:
    s, _ = score(html)
    if not (s >= QUALITY_THRESHOLD and not has_placeholders(html)):
        return False
    return reflects_spec(html, spec_name, spec_metrics)


__all__ = ["QUALITY_THRESHOLD", "score", "is_premium", "has_placeholders", "reflects_spec"]
