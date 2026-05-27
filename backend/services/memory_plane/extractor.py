# coding: utf-8
"""
Phase 6 — Memory Plane heuristic extractor.

Lightweight, pure-logic candidate extractor that runs on user
messages (and optionally assistant outputs). Returns 0..N
`ExtractionCandidate`s ready to be persisted via `MemoryManager.create`.

This is intentionally NOT an LLM call. Phase 6 ships a pattern-based
extractor so we can:
  * Keep cost predictable (zero tokens per turn)
  * Run inline on every message without blocking the response
  * Stay deterministic + testable

When Phase 7 lands the job queue, we'll add an `LLMExtractor` that
runs async against the queue. The interface is the same — every
extractor returns `list[ExtractionCandidate]` — so swapping in or
combining the two won't touch any caller.

Pipeline behaviour:
  1. Secret-redaction guard. ANY match → return [] (better to miss a
     memory than to persist a credential).
  2. Run each pattern. Each pattern produces (kind, content,
     importance, metadata). Patterns are conservative — they only
     fire on high-signal phrases.
  3. Deduplicate within the same message so e.g. mentioning KorvixAI
     twice produces one candidate, not two.

Patterns ship today:
  - "I'm building / working on / developing X" (EN) → fact/project
  - "kendi AI / yapay zeka / projem" (TR)         → fact/project
  - "KorvixAI" mention                            → fact/project (HIGH)
  - "I prefer / I like / use ... tone/format"     → preference
  - "we decided / picked / chose ..."             → decision
  - "<Name> is the <Role>" / "<Name> works at"    → relationship
  - Numbered or "I finished" task outcome cues    → task_outcome
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from backend.services.memory_plane.types import (
    DEFAULT_KIND,
    IMPORTANCE_DEFAULT, IMPORTANCE_HIGH, IMPORTANCE_LOW,
)


# Hard caps to keep extraction bounded under abuse / huge prompts.
_MAX_INPUT_CHARS  = 6_000
_MAX_CANDIDATES   = 8     # never produce more than this from one message
_MIN_SNIPPET_LEN  = 3
_MAX_SNIPPET_LEN  = 240


# ── Secret-redaction patterns ────────────────────────────────────────────────
#
# A superset of the memory_intelligence patterns + extras the audit
# called out (JWT-like, AWS access keys, GitHub PATs, OpenAI/Anthropic
# keys). Any single match short-circuits the extractor.

_SECRET_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bpassword\s*[:=]",            re.IGNORECASE),
    re.compile(r"\bparola\s*[:=]",              re.IGNORECASE),
    re.compile(r"\bsifre\s*[:=]",               re.IGNORECASE),
    re.compile(r"\bapi[_\-\s]?key\b",           re.IGNORECASE),
    re.compile(r"\bsecret[_\-\s]?key\b",        re.IGNORECASE),
    re.compile(r"\baccess[_\-\s]?token\b",      re.IGNORECASE),
    re.compile(r"\bauthorization\s*[:=]",       re.IGNORECASE),
    re.compile(r"\bbearer\s+[A-Za-z0-9._\-]{8,}", re.IGNORECASE),
    # Provider-specific key shapes
    re.compile(r"\bsk-[A-Za-z0-9_\-]{16,}"),                # OpenAI
    re.compile(r"\bsk-ant-[A-Za-z0-9_\-]{16,}"),            # Anthropic
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{16,}"),            # GitHub PAT
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),                    # AWS access key
    re.compile(r"\bAIza[0-9A-Za-z_\-]{30,}"),               # Google API key
    # JWT-shaped (header.payload.signature)
    re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}"),
    # Email + card-ish — we don't store them auto-extracted
    re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"),
    re.compile(r"\b\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}\b"),
]


def contains_secret_content(text: str) -> bool:
    """Public guard — any module that's about to persist user content
    can call this to defensively short-circuit. The manager.create
    path uses it as a hard block."""
    if not text:
        return False
    return any(p.search(text) for p in _SECRET_PATTERNS)


# ── Pattern matchers ─────────────────────────────────────────────────────────

# KorvixAI mention — strongest project signal. HIGH importance.
_RE_KORVIXAI = re.compile(r"\bkorvix\s*[a-z]*\s*ai\b", re.IGNORECASE)

# Turkish: "kendi (ai|yapay zeka|projem)"
_RE_TR_OWN_AI = re.compile(
    r"\bkendi\s+(?:ai\b|yapay\s+zeka|ai\W*projem|ai\W*mi|projem)",
    re.IGNORECASE,
)

# English: "I'm building / working on / developing / making / creating X"
_RE_EN_BUILDING = re.compile(
    r"\b(?:i'?m|i\s+am|we'?re|we\s+are)\s+"
    r"(?:building|working\s+on|developing|making|creating)\s+"
    r"([^.!?\n]{2,80})",
    re.IGNORECASE,
)

# Preference: "I prefer / I like / use X (tone|format|style)"
_RE_PREFERENCE = re.compile(
    r"\b(?:i\s+(?:prefer|like|want|need)|please\s+use|always\s+use)\s+"
    r"([^.!?\n]{3,100})",
    re.IGNORECASE,
)

# Turkish preference: "Ben X tercih ediyorum / tercih ederim"
# Common shapes:
#   - "Ben kısa cevaplar tercih ediyorum"     → kısa cevaplar
#   - "Kısa ve net yanıtlar tercih ederim"    → Kısa ve net yanıtlar
#   - "Resmî dil tercih ediyorum"             → Resmî dil
# We allow the optional "Ben " prefix and capture everything up to
# "tercih". The lookbehind keeps the matched object usable as the
# stored preference verbatim.
_RE_TR_PREFERENCE = re.compile(
    r"(?:\bben\s+)?([^.!?\n]{3,100}?)\s+tercih\s+ed(?:iyorum|erim|iyoruz|eriz)\b",
    re.IGNORECASE,
)

# Turkish "I want / I need" — broader preference signal.
#   - "Kısa cevaplar istiyorum"
#   - "Net yanıtlar istiyorum"
_RE_TR_WANT = re.compile(
    r"\b([^.!?\n]{3,100}?)\s+isti(?:yorum|yoruz)\b",
    re.IGNORECASE,
)

# Phase 6.x — Turkish "I love/like" patterns. The user reported
# "Ben kısa cevaplar seviyorum" in production; that wasn't caught
# by any previous regex, so the LLM hallucinated a save ack and
# nothing was persisted. Captures the noun phrase before
# "seviyorum / severim / seviyoruz / severiz".
_RE_TR_LIKE = re.compile(
    r"(?:\bben\s+)?([^.!?\n]{3,100}?)\s+sev(?:iyorum|erim|iyoruz|eriz)\b",
    re.IGNORECASE,
)

# Decision: "we (decided|picked|chose|going with) X"
_RE_DECISION = re.compile(
    r"\b(?:we|i)\s+(?:decided\s+(?:to|on)|picked|chose|went\s+with|"
    r"are\s+going\s+with)\s+([^.!?\n]{2,120})",
    re.IGNORECASE,
)

# Relationship: "<Name> is the <Role>" / "<Name> works at <Org>"
# Conservative: requires a capitalized first token to avoid eating
# sentences like "this is the cool way".
_RE_RELATIONSHIP_IS = re.compile(
    r"\b([A-Z][a-zA-ZçğıöşüÇĞİÖŞÜ]{1,30}(?:\s[A-Z][a-zA-ZçğıöşüÇĞİÖŞÜ]{1,30})?)\s+"
    r"is\s+(?:the|our|my)\s+([a-zA-Z][a-zA-Z\s\-]{2,60})"
)
_RE_RELATIONSHIP_AT = re.compile(
    r"\b([A-Z][a-zA-ZçğıöşüÇĞİÖŞÜ]{1,30}(?:\s[A-Z][a-zA-ZçğıöşüÇĞİÖŞÜ]{1,30})?)\s+"
    r"works?\s+at\s+([A-Z][a-zA-Z0-9\s&\.\-]{1,60})"
)

# Task outcome: "I finished / completed / shipped / launched X"
_RE_TASK_OUTCOME = re.compile(
    r"\b(?:i|we)\s+(?:finished|completed|shipped|launched|deployed)\s+"
    r"([^.!?\n]{2,120})",
    re.IGNORECASE,
)


# ── Extraction DTO ───────────────────────────────────────────────────────────

@dataclass
class ExtractionCandidate:
    """One memory candidate produced by a single pattern. The caller
    can pass these straight into `MemoryManager.create()` — the field
    names line up with the kwargs.

    `importance` is a *suggested* value; the manager may override
    (e.g. dedup fold bumps it post-insert).
    """
    kind:       str
    content:    str
    importance: float = IMPORTANCE_DEFAULT
    source:     str = "auto"
    metadata:   dict = field(default_factory=dict)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _clean(snippet: str) -> str:
    s = snippet.strip().strip(",.;:")
    s = re.sub(r"\s+", " ", s)
    return s[:_MAX_SNIPPET_LEN]


def _add(out: list[ExtractionCandidate], cand: ExtractionCandidate, seen: set[str]) -> None:
    """Dedup within-message: same kind+content twice ⇒ one entry."""
    if len(out) >= _MAX_CANDIDATES:
        return
    if len(cand.content) < _MIN_SNIPPET_LEN:
        return
    key = f"{cand.kind}::{cand.content.lower()}"
    if key in seen:
        return
    seen.add(key)
    out.append(cand)


# ── Public extraction ────────────────────────────────────────────────────────

def extract(
    message: str,
    *,
    role: str = "user",
) -> list[ExtractionCandidate]:
    """Run every pattern against the message; return a deduped list of
    candidates.

    Empty list when:
      * message is empty / wrong type / too long
      * message contains a redacted secret
      * no pattern matches

    `role` is forwarded into the candidate metadata so downstream code
    knows whether the memory came from a user message or an assistant
    reply (assistant-extracted memories tend to have lower importance —
    we're recording what the assistant claimed, not what the user said).
    """
    if not isinstance(message, str):
        return []
    text = message.strip()
    if not text or len(text) > _MAX_INPUT_CHARS:
        return []
    if contains_secret_content(text):
        return []

    out:  list[ExtractionCandidate] = []
    seen: set[str] = set()

    role_meta = {"role": role} if role else {}

    # 1) KorvixAI — high-importance project signal.
    if _RE_KORVIXAI.search(text):
        _add(out, ExtractionCandidate(
            kind="fact",
            content="User is working on KorvixAI",
            importance=IMPORTANCE_HIGH,
            metadata={**role_meta, "pattern": "korvixai"},
        ), seen)

    # 2) Turkish "kendi AI / yapay zeka / projem".
    if _RE_TR_OWN_AI.search(text):
        _add(out, ExtractionCandidate(
            kind="fact",
            content="User is building their own AI project",
            importance=IMPORTANCE_DEFAULT,
            metadata={**role_meta, "pattern": "tr_own_ai"},
        ), seen)

    # 3) English "I'm building X".
    m = _RE_EN_BUILDING.search(text)
    if m:
        target = _clean(m.group(1))
        if target:
            _add(out, ExtractionCandidate(
                kind="fact",
                content=f"User is building '{target}'",
                importance=IMPORTANCE_DEFAULT,
                metadata={**role_meta, "pattern": "en_building", "target": target},
            ), seen)

    # 4) Preferences (English).
    m = _RE_PREFERENCE.search(text)
    if m:
        pref = _clean(m.group(1))
        if pref and len(pref) >= 5:
            _add(out, ExtractionCandidate(
                kind="preference",
                content=f"User preference: {pref}",
                # Preferences are HIGH importance — they shape every
                # subsequent reply, so the retriever should surface
                # them at the top of the context block reliably.
                importance=IMPORTANCE_HIGH,
                metadata={**role_meta, "pattern": "preference"},
            ), seen)

    # 4b) Turkish preference — "X tercih ediyorum / ederim".
    m = _RE_TR_PREFERENCE.search(text)
    if m:
        pref = _clean(m.group(1))
        if pref and len(pref) >= 5:
            _add(out, ExtractionCandidate(
                kind="preference",
                content=f"Kullanıcı tercihi: {pref}",
                importance=IMPORTANCE_HIGH,
                metadata={**role_meta, "pattern": "tr_preference"},
            ), seen)

    # 4c) Turkish "I want" — broader preference signal.
    m = _RE_TR_WANT.search(text)
    if m:
        pref = _clean(m.group(1))
        if pref and len(pref) >= 5:
            _add(out, ExtractionCandidate(
                kind="preference",
                content=f"Kullanıcı isteği: {pref}",
                # Lower than explicit "tercih ederim" since "istiyorum"
                # is also used for one-shot requests, not just persistent
                # preferences.
                importance=IMPORTANCE_DEFAULT,
                metadata={**role_meta, "pattern": "tr_want"},
            ), seen)

    # 4d) Phase 6.x — Turkish "I love/like" pattern. Catches
    # "Ben kısa cevaplar seviyorum" / "Türkçe severim" / etc.
    m = _RE_TR_LIKE.search(text)
    if m:
        pref = _clean(m.group(1))
        if pref and len(pref) >= 5:
            _add(out, ExtractionCandidate(
                kind="preference",
                content=f"Kullanıcı tercihi: {pref}",
                # HIGH because "X seviyorum" is a durable preference
                # (the user expressed a recurring affinity), not a
                # one-shot request.
                importance=IMPORTANCE_HIGH,
                metadata={**role_meta, "pattern": "tr_like"},
            ), seen)

    # 5) Decisions — only when the user explicitly framed it as a decision.
    m = _RE_DECISION.search(text)
    if m:
        d = _clean(m.group(1))
        if d:
            _add(out, ExtractionCandidate(
                kind="decision",
                content=f"Decision: {d}",
                importance=IMPORTANCE_HIGH,
                metadata={**role_meta, "pattern": "decision"},
            ), seen)

    # 6) Relationships.
    m = _RE_RELATIONSHIP_IS.search(text)
    if m:
        name, role_ = _clean(m.group(1)), _clean(m.group(2))
        if name and role_:
            _add(out, ExtractionCandidate(
                kind="relationship",
                content=f"{name} is the {role_}",
                importance=IMPORTANCE_DEFAULT,
                metadata={**role_meta, "pattern": "relationship_is",
                          "name": name, "role": role_},
            ), seen)
    m = _RE_RELATIONSHIP_AT.search(text)
    if m:
        name, org = _clean(m.group(1)), _clean(m.group(2))
        if name and org:
            _add(out, ExtractionCandidate(
                kind="relationship",
                content=f"{name} works at {org}",
                importance=IMPORTANCE_DEFAULT,
                metadata={**role_meta, "pattern": "relationship_at",
                          "name": name, "org": org},
            ), seen)

    # 7) Task outcomes — typically lower importance unless user-stated.
    m = _RE_TASK_OUTCOME.search(text)
    if m:
        outcome = _clean(m.group(1))
        if outcome:
            _add(out, ExtractionCandidate(
                kind="task_outcome",
                content=f"Completed: {outcome}",
                importance=IMPORTANCE_LOW if role == "assistant" else IMPORTANCE_DEFAULT,
                metadata={**role_meta, "pattern": "task_outcome"},
            ), seen)

    return out


# ── Importance scoring (independent of patterns) ─────────────────────────────

def score_importance(content: str, *, default: float = IMPORTANCE_DEFAULT) -> float:
    """Heuristic importance score for arbitrary content. Used by
    callers that don't go through `extract()` (e.g. agent-supplied
    memories where the agent decided what to remember).

    Bumps:
      + 0.15  contains "important", "critical", "remember"
      + 0.10  contains a project / KorvixAI mention
      + 0.05  references a decision or outcome
      - 0.20  trivial-looking content (acks, fillers)
    Clamped into [0,1]."""
    if not content:
        return default
    txt = content.lower()
    score = float(default)
    if any(w in txt for w in ("important", "critical", "remember", "must")):
        score += 0.15
    if _RE_KORVIXAI.search(txt) or "korvix" in txt or "kendi ai" in txt:
        score += 0.10
    if any(w in txt for w in ("decided", "picked", "shipped", "launched", "deployed")):
        score += 0.05
    if any(txt.strip() == ack for ack in ("ok", "okay", "thanks", "tamam", "evet", "hayır")):
        score -= 0.20
    if score < 0.0:
        return 0.0
    if score > 1.0:
        return 1.0
    return score


__all__ = [
    "ExtractionCandidate",
    "extract",
    "contains_secret_content",
    "score_importance",
]
