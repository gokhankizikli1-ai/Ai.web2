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

export interface WebBuildDesignSystem extends DesignTokens {
  /** Vertical spacing scale for section padding. */
  density: Density;
  /** How much animation the build leans on. */
  motion: MotionLevel;
  /** The dominant surface treatment for cards/panels. */
  cardStyle: CardStyle;
  /** How sections are paced down the page. */
  sectionRhythm: SectionRhythm;
  /** Section vertical padding class, derived from density. */
  sectionPad: string;
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

  return {
    ...tokens,
    density,
    motion,
    cardStyle,
    sectionRhythm,
    sectionPad: PAD[density],
  };
}

/** Serialize the design system to a reusable `designSystem.ts` token module — a
 *  real file in the generated project (not a placeholder). */
export function designSystemFileContent(ds: WebBuildDesignSystem): string {
  const obj = {
    colors: { background: ds.bg, accent: ds.accent, accentAlt: ds.accent2 },
    typography: { heading: ds.headingFont, body: ds.bodyFont, tracking: ds.tracking },
    radius: ds.radius,
    density: ds.density,
    motion: ds.motion,
    cardStyle: ds.cardStyle,
    sectionRhythm: ds.sectionRhythm,
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
