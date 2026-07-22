# coding: utf-8
"""
Design Personality Intelligence — weighted signals + direction library.

The whole point is to NOT hardcode "AI = futuristic". Instead every personality accrues
a WEIGHTED score across the request, and the strongest overall support wins:

  • DOMAIN signals (a real business/audience the design must serve — banking, kids,
    luxury, restaurants) are PRIMARY and weigh most; found in an explicit industry field
    they weigh even more.
  • TECH signals (ai, saas, software, dashboard) push "futuristic" but only WEAKLY, so a
    domain personality overrides them — an AI *banking* app resolves trustworthy, an AI
    *toy* resolves playful, while a plain "AI analytics dashboard" (no competing domain)
    stays futuristic.
  • TONE words nudge.

Every personality is scored (never a first-match lookup); ties break deterministically by
declaration order. Pure, deterministic and total — never raises.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Tuple

from backend.services.design_personality.models import DesignPersonality as P


@dataclass(frozen=True)
class PersonalityDefinition:
    """A personality's weighted signals and the directions it implies."""

    key: P
    visual_direction: str
    motion_direction: str
    avoid_list: Tuple[str, ...]
    # primary = decisive domain/audience terms; weak = supporting (e.g. tech) terms;
    # tone = descriptor nudges.
    primary_signals: Tuple[str, ...] = ()
    weak_signals: Tuple[str, ...] = ()
    tone_signals: Tuple[str, ...] = ()


# Ordered by priority for deterministic tie-breaks. FUTURISTIC deliberately carries NO
# primary signals — only weak tech ones — so it never outranks a matched domain.
_DEFINITIONS: Tuple[PersonalityDefinition, ...] = (
    PersonalityDefinition(
        key=P.TRUSTWORTHY_PREMIUM,
        visual_direction="refined & credible — structured grid, confident blues and neutrals, clear data",
        motion_direction="restrained, precise reveals, low energy",
        avoid_list=("gimmicky effects", "playful wobble", "flashy gradients", "unsubstantiated claims"),
        primary_signals=("finance", "fintech", "bank", "banking", "insurance", "investment",
                         "invest", "legal", "law firm", "lawyer", "accounting", "compliance",
                         "medical", "healthcare", "clinic", "security", "enterprise", "b2b",
                         "consulting", "payroll", "tax", "wealth"),
        tone_signals=("trustworthy", "secure", "reliable", "credible", "professional", "premium", "assured"),
    ),
    PersonalityDefinition(
        key=P.CINEMATIC_ELEGANT,
        visual_direction="cinematic luxury — editorial serif, restrained palette, architectural imagery",
        motion_direction="slow parallax, subtle reveals, understated",
        avoid_list=("bright playful animation", "neon", "busy layouts", "cheap stock"),
        primary_signals=("luxury", "luxurious", "resort", "jewelry", "jeweller", "couture",
                         "fine dining", "five star", "5 star", "yacht", "boutique hotel",
                         "high-end", "designer brand", "haute"),
        tone_signals=("elegant", "exclusive", "sophisticated", "refined", "cinematic", "opulent", "timeless"),
    ),
    PersonalityDefinition(
        key=P.PLAYFUL,
        visual_direction="vibrant & friendly — rounded shapes, warm saturated color, candid imagery",
        motion_direction="lively, bouncy micro-interactions, energetic",
        avoid_list=("austere minimalism", "somber tone", "corporate stiffness", "cold palette"),
        primary_signals=("kids", "kid", "children", "child", "toy", "toys", "cartoon", "candy",
                         "playground", "daycare", "nursery", "preschool", "comic", "mascot"),
        tone_signals=("playful", "fun", "vibrant", "cheerful", "whimsical", "joyful", "friendly"),
    ),
    PersonalityDefinition(
        key=P.NATURAL_EDITORIAL,
        visual_direction="natural editorial — warm neutrals, real lifestyle photography, tactile type",
        motion_direction="soft transitions, gentle fades",
        avoid_list=("cold corporate stock", "harsh neon", "mechanical motion", "sterile layouts"),
        primary_signals=("restaurant", "cafe", "coffee", "bakery", "roastery", "artisan", "organic",
                         "farm", "craft", "brewery", "wellness", "spa", "yoga", "handmade",
                         "florist", "ceramics", "botanical"),
        tone_signals=("warm", "authentic", "natural", "handcrafted", "rustic", "cozy", "earthy"),
    ),
    PersonalityDefinition(
        key=P.BOLD_CREATIVE,
        visual_direction="bold editorial — oversized type, high contrast, expressive crops",
        motion_direction="kinetic, expressive, scroll-driven",
        avoid_list=("timid centered layouts", "muted safe palette", "generic stock"),
        primary_signals=("creative agency", "design agency", "music", "band", "festival",
                         "streetwear", "art gallery", "photographer", "photography studio",
                         "record label", "fashion label"),
        tone_signals=("bold", "edgy", "expressive", "statement", "avant-garde", "daring"),
    ),
    PersonalityDefinition(
        key=P.MINIMAL_MODERN,
        visual_direction="minimal modern — generous whitespace, monochrome plus one accent, precise type",
        motion_direction="quiet, precise, minimal",
        avoid_list=("decorative clutter", "parallax overload", "loud color", "busy backgrounds"),
        primary_signals=("portfolio", "architecture", "architect", "furniture", "product design",
                         "industrial design", "typographic"),
        weak_signals=("minimalist",),
        tone_signals=("minimal", "clean", "understated", "monochrome", "essential"),
    ),
    PersonalityDefinition(
        key=P.FUTURISTIC,
        visual_direction="premium futuristic — clean product UI, gradient depth, luminous accents",
        motion_direction="smooth floating-interface motion, medium energy",
        avoid_list=("generic robot imagery", "childish bounce", "cluttered ornamentation"),
        # NO primary signals — only weak tech ones, so a domain personality always wins.
        weak_signals=("ai", "artificial intelligence", "saas", "software", "platform", "tech",
                      "automation", "developer", "api", "cloud", "dashboard", "analytics",
                      "machine learning", "web3", "startup"),
        tone_signals=("futuristic", "cutting-edge", "next-gen", "innovative", "high-tech", "sci-fi"),
    ),
)

# Safe neutral default when nothing scores.
_DEFAULT = PersonalityDefinition(
    key=P.APPROACHABLE_PROFESSIONAL,
    visual_direction="modern & approachable — clean layout, balanced neutrals plus one accent",
    motion_direction="subtle, tasteful reveals",
    avoid_list=("generic templates", "excessive animation", "random cards", "walls of equal boxes"),
)

# Weights per signal tier. Primary in an explicit industry field is decisive.
_W_PRIMARY_INDUSTRY = 4.0
_W_PRIMARY = 3.0
_W_WEAK = 2.0
_W_TONE = 1.0


def definitions() -> Tuple[PersonalityDefinition, ...]:
    return _DEFINITIONS


def default_definition() -> PersonalityDefinition:
    return _DEFAULT


def _tokens(text: str) -> List[str]:
    return [t for t in "".join(c.lower() if (c.isalnum() or c.isspace()) else " " for c in (text or "")).split() if len(t) > 1]


def _matches(signal: str, tokens: set, text: str) -> bool:
    # Multi-word / hyphenated signals match the raw text; single tokens match the token
    # set so short terms ("ai") never false-match inside another word ("email").
    if (" " in signal) or ("-" in signal):
        return signal in text
    return signal in tokens


def _score(defn: PersonalityDefinition, tokens: set, text: str,
           industry_tokens: set, industry_text: str) -> Tuple[float, List[str]]:
    score = 0.0
    hits: List[str] = []
    for term in defn.primary_signals:
        if industry_text and _matches(term, industry_tokens, industry_text):
            score += _W_PRIMARY_INDUSTRY
            hits.append(term)
        elif _matches(term, tokens, text):
            score += _W_PRIMARY
            hits.append(term)
    for term in defn.weak_signals:
        if _matches(term, tokens, text):
            score += _W_WEAK
            hits.append(term)
    for term in defn.tone_signals:
        if _matches(term, tokens, text):
            score += _W_TONE
            hits.append(term)
    return score, hits


def resolve(text: str, industry_text: str = "") -> Tuple[PersonalityDefinition, float, List[str]]:
    """Resolve the best-supported personality with a 0..1 confidence and matched signals.

    ``text`` is the full request (prompt + any fields); ``industry_text`` is the industry/
    audience field alone (weighted highest). Returns the neutral default at 0.0 confidence
    when nothing meaningful matches."""
    text = (text or "").lower()
    tokens = set(_tokens(text))
    industry_text = (industry_text or "").lower()
    industry_tokens = set(_tokens(industry_text))

    best = _DEFAULT
    best_score = 0.0
    best_hits: List[str] = []
    for defn in _DEFINITIONS:
        score, hits = _score(defn, tokens, text, industry_tokens, industry_text)
        if score > best_score:
            best, best_score, best_hits = defn, score, hits

    if best_score <= 0.0:
        return _DEFAULT, 0.0, []
    confidence = min(0.95, 0.4 + 0.1 * best_score)
    return best, round(confidence, 3), best_hits


__all__ = ["PersonalityDefinition", "definitions", "default_definition", "resolve"]
