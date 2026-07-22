# coding: utf-8
"""
Visual Intelligence — brand archetypes + the resolution layer.

This is where "how should this brand feel?" is answered, WITHOUT a naive
keyword→value table. Each :class:`VisualProfile` describes a coherent visual world
(personality, style, palette/typography direction, and default image + motion
strategies). :func:`resolve_profile` scores EVERY archetype against the full signal
surface (industry, audience, brand descriptors, emotional hint, free prompt) with
weighted lexicons, picks the best-supported one, and reports a confidence — so an
ambiguous input degrades to a neutral profile instead of a wrong-but-confident one.

The archetype only sets the baseline. The analyzer then applies orthogonal
*refinement modifiers* (luxury, playful, minimal, calm, bold) on top — so
"luxury coffee" and "playful coffee" resolve to the same craft archetype but diverge
on realism, motion energy and typography. That composition is what makes this a
reasoning layer rather than a lookup.

Pure and deterministic. No I/O, no randomness, never raises.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Tuple

from backend.services.visual_intelligence.models import (
    ImageStrategy, MotionIntensity, MotionStrategy, RealismLevel,
)


@dataclass(frozen=True)
class VisualProfile:
    """A coherent, reusable visual world an input can resolve to."""

    key: str
    brand_personality: str
    visual_style: str
    color_direction: str
    typography_direction: str
    realism_level: RealismLevel
    image: ImageStrategy
    motion: MotionStrategy
    # Weighted signal lexicons. `strong` terms are decisive (usually the industry
    # itself); `soft` terms are supporting descriptors/audiences.
    strong_signals: Tuple[str, ...] = ()
    soft_signals: Tuple[str, ...] = ()


# ── Archetype library ─────────────────────────────────────────────────────────
# Deliberately compact and composable. New archetypes slot in without touching the
# resolver; refinements (below) layer on top so each stays broad, not brittle.

_PROFILES: Tuple[VisualProfile, ...] = (
    VisualProfile(
        key="luxury_hospitality",
        brand_personality="exclusive, elegant, calm",
        visual_style="cinematic luxury",
        color_direction="deep neutrals, warm stone and champagne, restrained gold accents",
        typography_direction="high-contrast editorial serif headlines, refined sans body",
        realism_level=RealismLevel.CINEMATIC,
        image=ImageStrategy(
            preferred_visual_type="photography",
            photography_style="high-quality architectural and interior photography, natural light",
            composition="wide, considered framing with generous negative space",
            avoid_patterns=["busy collages", "clip-art icons", "oversaturated stock smiles"],
        ),
        motion=MotionStrategy(
            intensity=MotionIntensity.SUBTLE,
            animation_style="slow parallax, subtle reveal on scroll",
            preferred_effects=["gentle parallax", "fade-up reveal", "slow image zoom"],
            avoid_effects=["bright playful animations", "bouncy easing", "confetti"],
        ),
        strong_signals=("luxury", "hotel", "resort", "spa retreat", "fine dining",
                        "jewelry", "yacht", "villa", "premium hospitality", "five star"),
        soft_signals=("elegant", "exclusive", "bespoke", "refined", "discerning", "affluent"),
    ),
    VisualProfile(
        key="artisan_craft",
        brand_personality="warm, authentic, handcrafted",
        visual_style="natural editorial",
        color_direction="warm natural neutrals, cream and clay with deep espresso accents",
        typography_direction="editorial serif with humanist sans, tactile and unhurried",
        realism_level=RealismLevel.NATURAL,
        image=ImageStrategy(
            preferred_visual_type="photography",
            photography_style="real lifestyle photography, hands-at-work, natural light",
            composition="intimate, close detail shots mixed with warm environmental scenes",
            avoid_patterns=["generic brown coffee stock", "corporate posed teams", "flat icon grids"],
        ),
        motion=MotionStrategy(
            intensity=MotionIntensity.SUBTLE,
            animation_style="soft transitions, gentle fades",
            preferred_effects=["soft fade", "slow crossfade", "subtle hover lift"],
            avoid_effects=["mechanical slides", "harsh snapping", "neon glow"],
        ),
        strong_signals=("coffee", "bakery", "roastery", "cafe", "artisan", "handmade",
                        "craft", "ceramics", "brewery", "chocolatier", "florist"),
        soft_signals=("handcrafted", "small batch", "local", "organic", "authentic", "rustic"),
    ),
    VisualProfile(
        key="futuristic_tech",
        brand_personality="innovative, intelligent, trustworthy",
        visual_style="premium futuristic",
        color_direction="deep indigo and slate with a single luminous accent, high clarity",
        typography_direction="precise geometric sans, tight tracking, confident scale",
        realism_level=RealismLevel.ABSTRACT,
        image=ImageStrategy(
            preferred_visual_type="abstract",
            photography_style="abstract digital visuals, gradient meshes and product UI",
            composition="clean product screenshots with layered depth and soft glows",
            avoid_patterns=["generic robot imagery", "humanoid AI clichés", "circuit-board stock"],
        ),
        motion=MotionStrategy(
            intensity=MotionIntensity.MODERATE,
            animation_style="floating interface animations, smooth parallax layers",
            preferred_effects=["floating UI cards", "gradient drift", "scroll-linked reveals"],
            avoid_effects=["skeuomorphic bounce", "cartoonish wobble"],
        ),
        strong_signals=("ai", "saas", "software", "platform", "automation", "analytics",
                        "developer", "api", "cloud", "data", "assistant", "cyber"),
        soft_signals=("intelligent", "smart", "innovative", "next-gen", "productivity", "workflow"),
    ),
    VisualProfile(
        key="wellness_natural",
        brand_personality="calm, nurturing, grounded",
        visual_style="serene natural",
        color_direction="soft earth tones, sage and sand, airy and light",
        typography_direction="calm humanist sans with a light serif accent, generous spacing",
        realism_level=RealismLevel.NATURAL,
        image=ImageStrategy(
            preferred_visual_type="photography",
            photography_style="soft natural-light lifestyle, calm human moments",
            composition="breathable framing, soft focus, plenty of light",
            avoid_patterns=["harsh neon", "high-contrast drama", "clinical stock"],
        ),
        motion=MotionStrategy(
            intensity=MotionIntensity.MINIMAL,
            animation_style="gentle fades, unhurried reveals",
            preferred_effects=["slow fade-in", "breathing scale", "soft parallax"],
            avoid_effects=["fast motion", "aggressive transitions", "flashing"],
        ),
        strong_signals=("wellness", "yoga", "meditation", "spa", "skincare", "therapy",
                        "mindfulness", "nutrition", "holistic", "retreat"),
        soft_signals=("calm", "natural", "gentle", "balance", "serene", "organic", "self-care"),
    ),
    VisualProfile(
        key="bold_creative",
        brand_personality="bold, expressive, confident",
        visual_style="editorial bold",
        color_direction="high-contrast palette with one electric accent, strong blacks",
        typography_direction="oversized display type, dramatic scale contrast",
        realism_level=RealismLevel.STYLIZED,
        image=ImageStrategy(
            preferred_visual_type="photography",
            photography_style="high-contrast editorial photography with graphic crops",
            composition="asymmetric, edge-to-edge, confident negative space",
            avoid_patterns=["timid centered layouts", "muted corporate stock", "safe symmetry"],
        ),
        motion=MotionStrategy(
            intensity=MotionIntensity.EXPRESSIVE,
            animation_style="kinetic reveals, bold scroll-driven motion",
            preferred_effects=["marquee text", "sharp reveals", "parallax scale"],
            avoid_effects=["timid fades only", "static hero"],
        ),
        strong_signals=("agency", "studio", "creative", "fashion", "streetwear", "music",
                        "festival", "portfolio", "gallery", "design"),
        soft_signals=("bold", "edgy", "expressive", "statement", "avant-garde", "vibrant"),
    ),
    VisualProfile(
        key="corporate_trust",
        brand_personality="credible, professional, assured",
        visual_style="refined corporate",
        color_direction="confident blues and slate with a precise accent, high legibility",
        typography_direction="clean grotesque sans, structured hierarchy",
        realism_level=RealismLevel.PHOTOREAL,
        image=ImageStrategy(
            preferred_visual_type="mixed",
            photography_style="clean professional photography with clear data visualization",
            composition="structured grid, precise and uncluttered",
            avoid_patterns=["gimmicky effects", "playful mascots", "low-quality clip art"],
        ),
        motion=MotionStrategy(
            intensity=MotionIntensity.SUBTLE,
            animation_style="restrained, precise reveals",
            preferred_effects=["clean fade-up", "count-up figures", "measured stagger"],
            avoid_effects=["bouncy motion", "playful wobble", "excessive parallax"],
        ),
        strong_signals=("finance", "fintech", "bank", "legal", "law", "consulting",
                        "insurance", "accounting", "enterprise", "b2b", "compliance"),
        soft_signals=("trusted", "secure", "professional", "reliable", "established", "corporate"),
    ),
    VisualProfile(
        key="playful_friendly",
        brand_personality="friendly, cheerful, energetic",
        visual_style="vibrant playful",
        color_direction="bright, warm and saturated with cheerful accents",
        typography_direction="rounded friendly sans, approachable scale",
        realism_level=RealismLevel.STYLIZED,
        image=ImageStrategy(
            preferred_visual_type="mixed",
            photography_style="bright candid lifestyle with playful illustration accents",
            composition="lively, rounded shapes, energetic groupings",
            avoid_patterns=["austere minimalism", "cold corporate tones", "somber imagery"],
        ),
        motion=MotionStrategy(
            intensity=MotionIntensity.DYNAMIC,
            animation_style="bouncy, lively micro-interactions",
            preferred_effects=["spring bounce", "wiggle on hover", "pop-in reveals"],
            avoid_effects=["slow somber fades", "static rigidity"],
        ),
        strong_signals=("kids", "children", "education", "game", "community", "toys",
                        "party", "family", "camp", "playground"),
        soft_signals=("fun", "playful", "friendly", "joyful", "cheerful", "energetic"),
    ),
    VisualProfile(
        key="minimal_modern",
        brand_personality="refined, minimal, intentional",
        visual_style="minimal modern",
        color_direction="restrained monochrome with a single quiet accent",
        typography_direction="precise sans, strong hierarchy, disciplined spacing",
        realism_level=RealismLevel.PHOTOREAL,
        image=ImageStrategy(
            preferred_visual_type="photography",
            photography_style="sparse, high-detail product and object photography",
            composition="lots of negative space, one clear focal element",
            avoid_patterns=["cluttered collages", "decorative noise", "competing focal points"],
        ),
        motion=MotionStrategy(
            intensity=MotionIntensity.MINIMAL,
            animation_style="precise, quiet transitions",
            preferred_effects=["clean fade", "subtle translate", "measured reveal"],
            avoid_effects=["decorative motion", "parallax overload", "bounce"],
        ),
        strong_signals=("minimal", "architecture", "furniture", "product design",
                        "typographic", "portfolio", "studio"),
        soft_signals=("clean", "simple", "modern", "refined", "understated", "essential"),
    ),
    VisualProfile(
        key="retail_ecommerce",
        brand_personality="aspirational, clean, desirable",
        visual_style="clean commercial",
        color_direction="crisp neutrals that let product colour lead",
        typography_direction="modern sans with clear pricing hierarchy",
        realism_level=RealismLevel.PHOTOREAL,
        image=ImageStrategy(
            preferred_visual_type="product-ui",
            photography_style="product-focused commercial photography on clean backdrops",
            composition="centered product hero with consistent lighting",
            avoid_patterns=["noisy backgrounds", "inconsistent lighting", "distracting props"],
        ),
        motion=MotionStrategy(
            intensity=MotionIntensity.MODERATE,
            animation_style="smooth hover reveals, quick add-to-cart feedback",
            preferred_effects=["product hover zoom", "smooth carousel", "cart micro-feedback"],
            avoid_effects=["slow cinematic drift", "distracting background motion"],
        ),
        strong_signals=("store", "shop", "ecommerce", "boutique", "catalog", "marketplace",
                        "clothing", "sneakers", "cosmetics retail"),
        soft_signals=("shopping", "collection", "products", "retail", "checkout"),
    ),
)

# Neutral fallback — a safe, tasteful default when nothing scores.
_NEUTRAL = VisualProfile(
    key="modern_professional",
    brand_personality="modern, professional, approachable",
    visual_style="modern clean",
    color_direction="balanced neutrals with one confident brand accent",
    typography_direction="contemporary sans with clear hierarchy",
    realism_level=RealismLevel.NATURAL,
    image=ImageStrategy(
        preferred_visual_type="photography",
        photography_style="contextual professional photography, natural light",
        composition="balanced, uncluttered, one clear focal point per section",
        avoid_patterns=["generic smiling-team stock", "cluttered layouts", "clip-art icons"],
    ),
    motion=MotionStrategy(
        intensity=MotionIntensity.SUBTLE,
        animation_style="subtle, tasteful reveals on scroll",
        preferred_effects=["fade-up reveal", "subtle hover lift"],
        avoid_effects=["excessive motion", "distracting animation"],
    ),
    strong_signals=(),
    soft_signals=(),
)


def all_profiles() -> Tuple[VisualProfile, ...]:
    return _PROFILES


def neutral_profile() -> VisualProfile:
    return _NEUTRAL


def _matches(term: str, token_set: set, text: str) -> bool:
    return (term in text) if " " in term else (term in token_set)


def _score(profile: VisualProfile, tokens: List[str], text: str,
           industry_tokens: set, industry_text: str) -> float:
    """Weighted support for one profile. The INDUSTRY field is the primary driver of
    archetype choice, so a strong signal found there outweighs the same word appearing
    only in the prompt/brand descriptors — which is what lets tone words (luxury,
    minimal, playful) refine a coffee brand instead of reclassifying it. Every profile
    is scored (not a first-match lookup); the strongest overall support wins."""
    token_set = set(tokens)
    score = 0.0
    for term in profile.strong_signals:
        if industry_text and _matches(term, industry_tokens, industry_text):
            score += 4.0                      # decisive: the business type itself
        elif _matches(term, token_set, text):
            score += 2.0                      # supporting: named elsewhere in the input
    for term in profile.soft_signals:
        if _matches(term, token_set, text):
            score += 1.0                      # descriptor / audience nuance
    return score


def resolve_profile(tokens: List[str], text: str,
                    industry_text: str = "") -> Tuple[VisualProfile, float]:
    """Pick the best-supported archetype and a 0..1 confidence.

    ``tokens`` is the de-duplicated word set of the whole input; ``text`` is the joined
    lower-cased string (for multi-word signals); ``industry_text`` is the business-type
    field alone (weighted highest). Returns the neutral profile with 0.0 confidence when
    nothing meaningful matches — a safe, non-committal default."""
    industry_text = (industry_text or "").strip().lower()
    industry_tokens = set(t for t in industry_text.replace("-", " ").split() if len(t) > 1)
    best = _NEUTRAL
    best_score = 0.0
    for profile in _PROFILES:
        score = _score(profile, tokens, text, industry_tokens, industry_text)
        if score > best_score:
            best, best_score = profile, score
    if best_score <= 0.0:
        return _NEUTRAL, 0.0
    # Monotonic score → confidence; a lone descriptor reads as a soft match, an
    # industry hit as a strong one.
    confidence = min(0.95, 0.4 + 0.1 * best_score)
    return best, round(confidence, 3)


__all__ = ["VisualProfile", "all_profiles", "neutral_profile", "resolve_profile"]
