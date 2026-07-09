/**
 * Strategy-driven design system for Web Build.
 *
 * A build's look must be derived from its STRATEGY (the model's stated visual
 * mood, color/motion direction, layout logic, typography direction) — not from a
 * fixed template. `deriveDesignSystemFromStrategy` turns those strategy fields
 * into a concrete, reusable token set: palette, typography, radius, density,
 * motion level, card style and section rhythm. The palette itself comes from the
 * existing `designTokensForBrief` engine (already strategy/industry-aware), so
 * two different ideas produce genuinely different systems.
 *
 * Industry archetypes are only a safety net inside `designTokensForBrief`; the
 * primary signal is always the model's own strategy words. Nothing here is tied
 * to a specific example prompt.
 */
import { designTokensForBrief, type DesignTokens } from '@/lib/webBuildBrief';
import type { WebBuildBrief } from '@/lib/webBuildApi';

export type Density = 'compact' | 'comfortable' | 'spacious';
export type MotionLevel = 'minimal' | 'subtle' | 'expressive';
export type CardStyle = 'glass' | 'solid' | 'outline';
export type SectionRhythm = 'even' | 'alternating' | 'editorial';

/** A high-level layout blueprint chosen from the strategy — it guides hero
 *  composition, section rhythm, visual modules and content density WITHOUT being
 *  a fixed template. The actual output is still generated from the real idea. */
export type LayoutArchetype =
  | 'editorial' | 'dashboard' | 'marketplace' | 'membership' | 'hospitality'
  | 'data-platform' | 'archive' | 'luxury-service' | 'community' | 'event'
  | 'portfolio' | 'technical' | 'standard';

export interface WebBuildDesignSystem extends DesignTokens {
  /** Vertical spacing scale for section padding. */
  density: Density;
  /** How much animation the build leans on. */
  motion: MotionLevel;
  /** The dominant surface treatment for cards/panels. */
  cardStyle: CardStyle;
  /** How sections are paced down the page. */
  sectionRhythm: SectionRhythm;
  /** The layout blueprint guiding hero/rhythm/modules (not a fixed template). */
  archetype: LayoutArchetype;
  /** Section vertical padding class, derived from density. */
  sectionPad: string;
  /** The chosen palette family (Phase 7B) — the anti-sameness color decision. */
  paletteFamily: PaletteFamily;
}

/* ── Palette families (Phase 7B) — deliberate visual variety ────────────────
 * A curated set of DISTINCT palette families so different ideas (and even the
 * SAME idea across builds) resolve to genuinely different looks — instead of the
 * default dark + gold/indigo + dashboard template every time. Backgrounds are
 * kept dark-SAFE (the current preview is a dark surface — a true light theme is a
 * later phase) but deliberately CALMER than the old near-black, and accents are
 * restrained (never high-saturation gold/neon) to relieve the "same color, hurts
 * my eyes" problem. The `light` flag is reserved for a future light-mode preview;
 * every family currently resolves to a readable dark surface. Nothing here is
 * tied to one example prompt. */
export type PaletteFamily =
  | 'midnight-blue' | 'graphite-cyan' | 'slate-violet' | 'porcelain-blue'
  | 'warm-neutral-green' | 'ink-lime' | 'black-white-red' | 'editorial-cream'
  | 'archive-sepia' | 'botanical-sage' | 'automotive-silver' | 'hospitality-amber';

export interface PaletteFamilySpec {
  /** Page background. */ bg: string;
  /** Restrained primary accent. */ accent: string;
  /** Secondary accent. */ accent2: string;
  /** Prefer serif headings for this family. */ headingSerif: boolean;
  /** True when the background is light (relieves eye-strain / breaks dark-only). */
  light: boolean;
  /** One-line mood label for diagnostics + candidate descriptions. */ mood: string;
}

export const PALETTE_FAMILIES: Record<PaletteFamily, PaletteFamilySpec> = {
  'midnight-blue':     { bg: '#0a1122', accent: '#3b82f6', accent2: '#38bdf8', headingSerif: false, light: false, mood: 'calm, trustworthy deep blue' },
  'graphite-cyan':     { bg: '#0d1117', accent: '#22d3ee', accent2: '#7dd3fc', headingSerif: false, light: false, mood: 'restrained graphite with a cool cyan edge' },
  'slate-violet':      { bg: '#12111f', accent: '#8b5cf6', accent2: '#a78bfa', headingSerif: false, light: false, mood: 'quiet, considered violet' },
  'porcelain-blue':    { bg: '#0e1420', accent: '#60a5fa', accent2: '#38bdf8', headingSerif: false, light: false, mood: 'cool, clean, calm porcelain-blue' },
  'warm-neutral-green':{ bg: '#0f1512', accent: '#10b981', accent2: '#84cc16', headingSerif: false, light: false, mood: 'warm neutral with a natural green' },
  'ink-lime':          { bg: '#0b0d0a', accent: '#a3e635', accent2: '#65a30d', headingSerif: false, light: false, mood: 'ink black with a sharp lime signal' },
  'black-white-red':   { bg: '#0a0a0a', accent: '#ef4444', accent2: '#e5e5e5', headingSerif: false, light: false, mood: 'stark black-and-white with one red' },
  'editorial-cream':   { bg: '#14110c', accent: '#d8c9a8', accent2: '#b45309', headingSerif: true,  light: false, mood: 'editorial ink with a warm cream accent' },
  'archive-sepia':     { bg: '#1a140d', accent: '#c9a875', accent2: '#8a6d4b', headingSerif: true,  light: false, mood: 'document/archive sepia, collection feel' },
  'botanical-sage':    { bg: '#111710', accent: '#6b9e78', accent2: '#a3b18a', headingSerif: true,  light: false, mood: 'organic botanical sage' },
  'automotive-silver': { bg: '#0b0d10', accent: '#cbd5e1', accent2: '#ef4444', headingSerif: false, light: false, mood: 'brushed silver with a performance red' },
  'hospitality-amber': { bg: '#150f09', accent: '#e0a35b', accent2: '#b45309', headingSerif: true,  light: false, mood: 'warm hospitality amber, inviting' },
};

/** Deterministic small hash (no Date/Math.random — resume-safe). Used only to
 *  rotate among equally-appropriate families so the SAME idea is not always
 *  identical, while a given prompt is always stable. */
function stableHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const pickRotating = (list: PaletteFamily[], seed: string): PaletteFamily =>
  list[stableHash(seed) % list.length] || list[0];

/**
 * Select a palette family from the concept/vertical/mood — NOT a fixed default.
 * AI/SaaS deliberately rotates across restrained cool families (never always
 * gold/indigo). Verticals (archive, landscaping, hospitality, automotive,
 * marketplace) trend to their own families so nothing looks like an AI dashboard.
 * An explicit family (from the model / a chosen visual candidate) always wins.
 */
export function selectPaletteFamily(input: {
  explicit?: string;
  prompt?: string;
  concept?: string;
  vertical?: string;
  visualMood?: string;
}): PaletteFamily {
  const explicit = (input.explicit || '').trim().toLowerCase();
  if (explicit && explicit in PALETTE_FAMILIES) return explicit as PaletteFamily;

  const seed = `${input.prompt || ''} ${input.concept || ''} ${input.vertical || ''}`.trim() || 'seed';
  const hay = `${input.prompt || ''} ${input.concept || ''} ${input.vertical || ''} ${input.visualMood || ''}`.toLowerCase();

  // Explicit mood/keyword signals first (most specific).
  if (/(kimi|restrained|monochrome|minimal|calm|clinical|quiet|understated)/.test(hay)) {
    return pickRotating(['graphite-cyan', 'slate-violet', 'porcelain-blue', 'midnight-blue'], seed);
  }
  if (/(archive|library|museum|collection|document|catalog of works|index of|editorial|magazine|journal)/.test(hay)) {
    return pickRotating(['archive-sepia', 'editorial-cream'], seed);
  }
  if (/(landscap|garden|botanic|nature|forest|peyzaj|organic|\beco|plant|green)/.test(hay)) {
    return pickRotating(['botanical-sage', 'warm-neutral-green'], seed);
  }
  if (/(car|auto|automotive|vehicle|motor|racing|dealership|garage)/.test(hay)) {
    return pickRotating(['automotive-silver', 'black-white-red'], seed);
  }
  if (/(restaurant|hotel|cafe|dining|hospitality|menu|reservation|stay|resort)/.test(hay)) {
    return pickRotating(['hospitality-amber', 'editorial-cream'], seed);
  }
  if (/(marketplace|catalog|catalogue|inventory|listings|storefront|shop|ecommerce|store)/.test(hay)) {
    return pickRotating(['porcelain-blue', 'warm-neutral-green', 'editorial-cream'], seed);
  }
  if (/(luxur|premium|bespoke|boutique|atelier|heritage|high-end)/.test(hay)) {
    return pickRotating(['editorial-cream', 'archive-sepia', 'slate-violet'], seed);
  }
  // AI / SaaS / dashboard / platform → restrained COOL families, rotating.
  // Deliberately excludes gold/amber so AI is not always gold/dark.
  if (/(\bai\b|artificial|assistant|chatbot|chat bot|\bsaas\b|dashboard|analytics|platform|automation|software|api|\bml\b|machine learning)/.test(hay)) {
    return pickRotating(['midnight-blue', 'graphite-cyan', 'slate-violet', 'porcelain-blue'], seed);
  }
  // Generic fallback — still varied, still restrained.
  return pickRotating(['midnight-blue', 'graphite-cyan', 'porcelain-blue', 'slate-violet', 'warm-neutral-green'], seed);
}

/** Keyword → archetype, most specific first. Driven by the strategy words, not
 *  the raw prompt, so it stays general across any idea. */
const ARCHETYPE_RULES: Array<[LayoutArchetype, RegExp]> = [
  ['dashboard',     /(dashboard|analytics|admin|metrics|control panel|saas app|data app)/],
  ['data-platform', /(data platform|research platform|api|developer|infrastructure|intelligence|dataset)/],
  ['marketplace',   /(marketplace|catalog|catalogue|inventory|listings|storefront|shop|ecommerce|products grid)/],
  ['membership',    /(membership|subscription|application|apply|enroll|portal|access|members only|community platform)/],
  ['hospitality',   /(reservation|booking|restaurant|hotel|cafe|dining|hospitality|menu|table|stay)/],
  ['event',         /(event|conference|festival|summit|experience|launch|ticket|schedule|lineup)/],
  ['luxury-service',/(luxury|premium service|bespoke|boutique|atelier|concierge|high-end|exclusive)/],
  ['archive',       /(archive|collection|library|gallery|museum|catalog of works|index of)/],
  ['portfolio',     /(portfolio|case stud|selected work|showcase|photographer|designer)/],
  ['community',     /(community|forum|network|social|members|creators|collective)/],
  ['technical',     /(technical|engineering|open source|protocol|framework|cli|documentation)/],
  ['editorial',     /(editorial|magazine|story|narrative|journal|essay|long-form|manifesto)/],
];

function deriveArchetype(words: string): LayoutArchetype {
  for (const [arch, re] of ARCHETYPE_RULES) if (re.test(words)) return arch;
  return 'standard';
}

const PAD: Record<Density, string> = {
  compact: 'py-14 sm:py-16',
  comfortable: 'py-20 sm:py-24',
  spacious: 'py-24 sm:py-32',
};

const test = (re: RegExp, s: string) => re.test(s);

/**
 * Derive a concrete design system from the parsed strategy brief. Every choice
 * is driven by the model's own strategy words; a neutral premium default is used
 * only when the strategy is silent on a dimension.
 */
export function deriveDesignSystemFromStrategy(brief: WebBuildBrief | undefined): WebBuildDesignSystem {
  const tokens = designTokensForBrief(brief);
  const b = brief || {};
  const words = [
    b.visualMood, b.motionDirection, b.layoutLogic, b.typographyDirection,
    b.colorDirection, b.visualMetaphor, b.style, b.type, b.strategyInsight,
  ].filter(Boolean).join(' ').toLowerCase();

  const motion: MotionLevel =
    test(/(still|calm|minimal|quiet|clinical|restrained|understated|editorial|refined)/, words) ? 'minimal'
    : test(/(bold|energetic|dynamic|kinetic|playful|expressive|animated|vibrant|lively|immersive)/, words) ? 'expressive'
    : 'subtle';

  const density: Density =
    test(/(editorial|luxury|luxe|spacious|airy|premium|calm|gallery|boutique|architectural)/, words) ? 'spacious'
    : test(/(dense|data|dashboard|compact|utility|analytics|enterprise|technical)/, words) ? 'compact'
    : 'comfortable';

  const cardStyle: CardStyle =
    test(/(solid|opaque|brutalist|flat|blocky|matte)/, words) ? 'solid'
    : test(/(outline|line|wireframe|thin|minimal|mono|stark)/, words) ? 'outline'
    : 'glass';

  const sectionRhythm: SectionRhythm =
    test(/(editorial|magazine|story|narrative|scroll)/, words) ? 'editorial'
    : test(/(alternating|zigzag|split|asymmetr)/, words) ? 'alternating'
    : 'even';

  // Archetype reads a wider signal — include the concept type/goal so the
  // blueprint reflects what the site IS, not just its mood.
  const archetypeWords = [
    words, b.type, b.goal, b.audience, b.conversionStrategy, b.coreIdea,
  ].filter(Boolean).join(' ').toLowerCase();

  // Palette family (Phase 7B) — the anti-sameness color decision. An explicit
  // family (from a chosen visual candidate) wins; otherwise it is selected from
  // the concept/vertical/mood so AI/SaaS is NOT always the same dark/gold look.
  const paletteFamily = selectPaletteFamily({
    explicit: b.paletteFamily,
    prompt: [b.coreIdea, b.type, b.goal].filter(Boolean).join(' '),
    concept: b.artDesignArchetype,
    vertical: b.audience,
    visualMood: [b.visualMood, b.style, b.colorDirection].filter(Boolean).join(' '),
  });
  const fam = PALETTE_FAMILIES[paletteFamily];
  // The family sets bg/accents ONLY when the model / Art Director did not already
  // pin an explicit palette (artAccent/artBg win — Art Direction stays in control).
  const modelPinnedColor = !!(b.artAccent || b.artBg);
  const familyTokens: DesignTokens = modelPinnedColor ? tokens : {
    ...tokens,
    bg: fam.bg,
    accent: fam.accent,
    accent2: fam.accent2,
    headingFont: fam.headingSerif ? SERIF_STACK : tokens.headingFont,
  };

  return {
    ...familyTokens,
    density,
    motion,
    cardStyle,
    sectionRhythm,
    archetype: deriveArchetype(archetypeWords),
    sectionPad: PAD[density],
    paletteFamily,
  };
}

/** Serif stack mirror (kept local to avoid importing brief internals). */
const SERIF_STACK = 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif';

/** Serialize the design system to a reusable `designSystem.ts` token module — a
 *  real file in the generated project (not a placeholder). */
export function designSystemFileContent(ds: WebBuildDesignSystem): string {
  const obj = {
    colors: {
      background: ds.bg,
      accent: ds.accent,
      accentAlt: ds.accent2,
      foreground: '#f1f5f9',
      muted: '#94a3b8',
      border: 'rgba(255,255,255,0.10)',
      card: 'rgba(255,255,255,0.03)',
      glow: 'color-mix(in srgb, ' + ds.accent + ' 45%, transparent)',
    },
    typography: { heading: ds.headingFont, body: ds.bodyFont, tracking: ds.tracking },
    radius: ds.radius,
    density: ds.density,
    motion: ds.motion,
    cardStyle: ds.cardStyle,
    sectionRhythm: ds.sectionRhythm,
    archetype: ds.archetype,
    paletteFamily: ds.paletteFamily,
  };
  return `/**
 * Design system tokens for this site — derived from the build strategy
 * (visual mood, color direction, motion, layout logic). Import these instead of
 * hardcoding values so the whole site stays coherent.
 */
export const designSystem = ${JSON.stringify(obj, null, 2)} as const;

export type DesignSystem = typeof designSystem;
`;
}
