# coding: utf-8
"""
Workspace classifier — confidence-based, multi-intent.

Reads the registry and scores the user's text against every registered
WorkspaceProfile (keyword + regex signals). Deterministic, no LLM, no
network — fast, free and fully testable. The output is a normalised
confidence distribution so callers can detect multi-intent requests and
unknown requests.

A future LLM-backed classifier can implement the same `classify()` contract
and be swapped in without touching callers.
"""
from __future__ import annotations

import re
from typing import List

from backend.services.product_intelligence.registry import all_workspaces
from backend.services.product_intelligence.types import (
    WorkspaceKind, WorkspaceClassification, WorkspaceScore,
)

# Below this normalised confidence we treat the request as UNKNOWN.
_MIN_CONFIDENCE = 0.18
_CONFIDENCE_CALIBRATION = 4.0
_WORD_RE = re.compile(r"[a-z0-9][a-z0-9\-']*")


def _pattern_signal(match: re.Match[str]) -> str:
    """Return a readable signal for regex hits instead of the raw pattern."""
    groups = [g.strip() for g in match.groups() if g and g.strip()]
    if groups:
        return max(groups, key=len)
    return match.group(0).strip()


def _raw_scores(text: str) -> List[WorkspaceScore]:
    low = (text or "").lower()
    scores: List[WorkspaceScore] = []
    for profile in all_workspaces():
        total = 0.0
        matched: List[str] = []
        # Keyword signals — substring match on word boundaries.
        for kw, weight in profile.keywords.items():
            # word-boundary-ish: surround with non-alphanumeric or string edges
            if re.search(rf"(?<![a-z0-9]){re.escape(kw.lower())}(?![a-z0-9])", low):
                total += weight
                matched.append(kw)
        # Regex/phrase signals.
        for pat, weight in profile.compiled_patterns():
            match = pat.search(low)
            if match:
                total += weight
                matched.append(_pattern_signal(match))
        if total > 0:
            scores.append(WorkspaceScore(
                workspace=profile.kind, confidence=total, matched_signals=matched,
            ))
    return scores


def classify(text: str) -> WorkspaceClassification:
    """Classify text into a confidence-ranked set of workspaces.

    Returns a normalised distribution (confidences sum ~1 across matched
    workspaces). When nothing matches above the floor, primary is UNKNOWN.
    """
    raw = _raw_scores(text)
    if not raw:
        return WorkspaceClassification(
            primary=WorkspaceKind.UNKNOWN, confidence=0.0, scores=[],
        )

    # Normalise without letting a lone weak hit look fully confident.
    grand = sum(s.confidence for s in raw) or 1.0
    scale = max(grand, _CONFIDENCE_CALIBRATION)
    norm = [
        WorkspaceScore(s.workspace, s.confidence / scale, s.matched_signals)
        for s in raw
    ]
    norm.sort(key=lambda s: s.confidence, reverse=True)

    top = norm[0]
    if top.confidence < _MIN_CONFIDENCE:
        # Signal present but too diffuse to be confident — call it GENERAL,
        # not UNKNOWN, since SOMETHING matched.
        return WorkspaceClassification(
            primary=WorkspaceKind.GENERAL, confidence=top.confidence, scores=norm,
        )
    return WorkspaceClassification(
        primary=top.workspace, confidence=top.confidence, scores=norm,
    )


__all__ = ["classify"]
