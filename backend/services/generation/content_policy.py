# coding: utf-8
# Build-scope content policy.
#
# Korvix Build Studio generates websites and apps for legitimate product
# ideas. A prompt that is sexually explicit or asks for clearly illegal /
# harmful products must NOT be normalised into the closest-matching
# template — the old behavior quietly turned "+18 adult website" into a
# generic dashboard. The gate runs BEFORE template selection, so an
# unsupported request never starts artifact generation at all; the caller
# surfaces a polished, actionable message instead.
#
# Deterministic + rule-based like the rest of the generation layer: no
# LLM, no network — fast, testable, and easy to extend. Patterns are kept
# deliberately narrow so legitimate prompts ("adult education platform",
# "young adult book club site") never trip them.

from __future__ import annotations

import re
from typing import List, Optional, Tuple

_BLOCKED_RULES: List[Tuple[re.Pattern, str]] = [
    # Sexually explicit / adult-entertainment sites. "adult" alone is a
    # legitimate word (adult education, young adult fiction) — it only
    # counts next to a site/content noun or an explicit 18+ marker.
    (re.compile(
        r"(?:\+\s*18|18\s*\+|\bporn\w*|\bnsfw\b|\bxxx\b|\bx-?rated\b|\berotic\w*|"
        r"\bhentai\b|\bonlyfans\b|\bescorts?\b|\bstrip\s*club\b|"
        r"\badult\s*(?:web\s*)?(?:site|website|content|entertainment|video|movie|film|cam|chat|shop|store)\b|"
        r"\bsex\s*(?:cam|chat|site|shop|toy|work)\w*)", re.I),
     "adult or sexually explicit content"),
    # Weapons / drugs marketplaces.
    (re.compile(
        r"\b(?:guns?|firearms?|weapons?|ammunition|ammo|explosives?|silencers?)\s+"
        r"(?:store|shop|market\w*|marketplace|sales?|selling|site|website)\b", re.I),
     "weapons sales"),
    (re.compile(
        r"\b(?:drugs?|narcotics?|cocaine|heroin|meth|fentanyl|mdma)\s+"
        r"(?:store|shop|market\w*|marketplace|sales?|selling|site|website)\b", re.I),
     "illegal drug sales"),
    # Fraud / malicious tooling.
    (re.compile(
        r"\b(?:phishing|malware|ransomware|botnet|carding|card\s*skimm\w*|"
        r"credential\s*stuff\w*|fake\s*ids?|counterfeit\s+(?:money|goods|documents))\b", re.I),
     "fraud or malicious tooling"),
]


def unsupported_reason(user_request: str) -> Optional[str]:
    """Return a short human-readable reason when the request is outside
    the builder's supported scope, else None.

    Only the user's own words are scanned — a trailing DESIGN_BRIEF block
    contains fixed chip labels and is stripped first so the scan stays
    honest about what the user actually asked for."""
    text = user_request or ""
    idx = text.find("\n\nDESIGN_BRIEF:")
    if idx != -1:
        text = text[:idx]
    for pattern, reason in _BLOCKED_RULES:
        if pattern.search(text):
            return reason
    return None


__all__ = ["unsupported_reason"]
