/**
 * Web Build MOTION INTELLIGENCE LAYER (PR #513).
 *
 * Decides HOW a website should move before generation — overall motion level, interaction
 * style, hero motion and transitions. It is a lightweight, DETERMINISTIC strategy layer, NOT
 * a new intelligence system and NOT a competing plan: it consumes existing outputs only (the
 * already-built ExperienceArchitecturePlan, its Signature's motion intensity, its Asset
 * Strategy's hero asset, and the user request) and NESTS a typed MotionStrategy onto that same
 * plan (`plan.motionStrategy`). ZERO extra model calls.
 *
 * `deriveMotionStrategy` is pure, synchronous, network-free, bounded, JSON-serializable and
 * FAILS OPEN (returns `undefined` on any problem, never throws).
 *
 * Rules honoured: motion is NEVER added merely because a site is AI-generated; dashboards /
 * app interfaces prefer none/subtle; luxury prefers subtle cinematic; gaming/creative may go
 * immersive; explicit user intent wins; accessibility + performance are always respected.
 *
 * Feature flag (default OFF → no motion strategy is attached; the plan is byte-for-byte the
 * prior contract):
 *
 *     VITE_ENABLE_MOTION_INTELLIGENCE=false
 */
import type {
  ExperienceArchitecturePlan, MotionStrategy, MotionLevel, MotionInteractionStyle,
  MotionHeroMotion, MotionTransitionStyle, ExperienceMotionIntensity, AssetHeroKind,
} from '@/lib/webBuildAgents';

export function isMotionIntelligenceEnabled(): boolean {
  try {
    const raw = (import.meta as unknown as { env?: Record<string, unknown> })?.env?.VITE_ENABLE_MOTION_INTELLIGENCE;
    return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

const MAX_AVOID = 10;
const MAX_DIRECTIVES = 6;
const MAX_FIELD = 160;
const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const cap = (v: string): string => (v.length > MAX_FIELD ? v.slice(0, MAX_FIELD) : v).trim();

const LEVEL_RANK: Record<MotionLevel, number> = { none: 0, subtle: 1, moderate: 2, immersive: 3 };
/** Clamp a motion level so it never exceeds a ceiling (used by dashboards / minimal / etc.). */
function capLevel(value: MotionLevel, ceiling: MotionLevel): MotionLevel {
  return LEVEL_RANK[value] > LEVEL_RANK[ceiling] ? ceiling : value;
}

/** Map the Signature's motion intensity (none|subtle|medium|high) → a MotionLevel. */
function levelFromIntensity(intensity: ExperienceMotionIntensity): MotionLevel {
  switch (intensity) {
    case 'none': return 'none';
    case 'subtle': return 'subtle';
    case 'medium': return 'moderate';
    case 'high': return 'immersive';
    default: return 'subtle';
  }
}

function cleanList(xs: ReadonlyArray<string | undefined | null> | undefined, n = MAX_AVOID): string[] {
  if (!Array.isArray(xs)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of xs) {
    const t = cap(s(raw));
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= n) break;
  }
  return out;
}

interface MotionDefault {
  motionLevel: MotionLevel;
  interactionStyle: MotionInteractionStyle;
  heroMotion: MotionHeroMotion;
  transitionStyle: MotionTransitionStyle;
  avoid: string[];
}

/* Per experience-type defaults (keyed to the plan's `experienceType`). All overridable. */
const DEFAULTS: Record<string, MotionDefault> = {
  'atmosphere-editorial': {
    motionLevel: 'moderate', interactionStyle: 'cinematic', heroMotion: 'slow_zoom', transitionStyle: 'cinematic',
    avoid: ['jarring bounces', 'excessive parallax'],
  },
  'catalog-commerce': {
    motionLevel: 'subtle', interactionStyle: 'hover', heroMotion: 'fade', transitionStyle: 'smooth',
    avoid: ['motion that delays the purchase path', 'distracting product-card animation'],
  },
  'work-showcase': {
    motionLevel: 'moderate', interactionStyle: 'scroll_reveal', heroMotion: 'fade', transitionStyle: 'smooth',
    avoid: ['motion that upstages the work'],
  },
  'product-demonstration': {
    motionLevel: 'subtle', interactionStyle: 'interactive', heroMotion: 'interactive', transitionStyle: 'smooth',
    avoid: ['gratuitous animation', 'motion that hides the real product UI'],
  },
  'trust-clarity': {
    motionLevel: 'subtle', interactionStyle: 'scroll_reveal', heroMotion: 'fade', transitionStyle: 'smooth',
    avoid: ['flashy motion', 'distracting effects that undercut trust'],
  },
  'creative-showcase': {
    motionLevel: 'immersive', interactionStyle: 'cinematic', heroMotion: 'video_motion', transitionStyle: 'cinematic',
    avoid: ['timid static layouts'],
  },
  'content-editorial': {
    motionLevel: 'subtle', interactionStyle: 'scroll_reveal', heroMotion: 'fade', transitionStyle: 'smooth',
    avoid: ['motion that interrupts reading'],
  },
};

function adaptiveDefault(): MotionDefault {
  return { motionLevel: 'subtle', interactionStyle: 'scroll_reveal', heroMotion: 'fade', transitionStyle: 'smooth', avoid: [] };
}

/** Refine hero motion from the Asset Strategy's hero asset (a strong, already-made signal). */
function heroFromAsset(heroAsset: AssetHeroKind | undefined, fallback: MotionHeroMotion): MotionHeroMotion {
  switch (heroAsset) {
    case 'video': return 'video_motion';
    case 'interactive_demo': return 'interactive';
    case 'none': return 'none';
    default: return fallback;
  }
}

/* ── Explicit user overrides (these win) ──────────────────────────────────────*/
interface MotionOverrides {
  motionLevel?: MotionLevel;
  motionCeiling?: MotionLevel;
  interactionStyle?: MotionInteractionStyle;
  heroMotion?: MotionHeroMotion;
  transitionStyle?: MotionTransitionStyle;
  extraAvoid: string[];
  directives: string[];
}

function parseMotionOverrides(prompt: string): MotionOverrides {
  const p = (prompt || '').toLowerCase();
  const o: MotionOverrides = { extraAvoid: [], directives: [] };

  if (/\b(no|without|zero|disable)\s+(animation|animations|motion)\b/.test(p) || /\bstatic\b/.test(p) || /\bno\s+fancy\b/.test(p)) {
    o.motionLevel = 'none'; o.motionCeiling = 'none';
    o.interactionStyle = 'static'; o.heroMotion = 'none'; o.transitionStyle = 'instant';
    o.directives.push('No animation / static');
  }

  if (/\bdashboard\b/.test(p) || /\bapp\s+interface\b/.test(p) || /\bweb\s?app\b/.test(p) || /\badmin\s+(panel|interface)\b/.test(p)) {
    // Dashboards / app interfaces prefer none or subtle.
    o.motionCeiling = o.motionCeiling || 'subtle';
    o.heroMotion = o.heroMotion || 'none';
    o.interactionStyle = o.interactionStyle || 'hover';
    o.transitionStyle = o.transitionStyle || 'instant';
    o.directives.push('Dashboard / app interface — restrained motion');
  }

  if (/\bminimal(ist)?\b/.test(p)) {
    o.motionCeiling = o.motionCeiling || 'subtle';
    o.directives.push('Minimal motion');
  }

  if (/\bluxur(y|ious)\b/.test(p) || /\bpremium\b/.test(p) || /\belegant\b/.test(p)) {
    // Luxury prefers SUBTLE CINEMATIC (restrained, not busy).
    o.motionCeiling = o.motionCeiling || 'subtle';
    o.interactionStyle = o.interactionStyle || 'cinematic';
    o.transitionStyle = o.transitionStyle || 'cinematic';
    o.directives.push('Luxury — subtle cinematic');
  }

  if (/\b(game|gaming|arcade|immersive|3d|interactive\s+experience)\b/.test(p) || /\bcreative\s+studio\b/.test(p)) {
    // Gaming / creative may use immersive motion (raises the ceiling, never forces it alone).
    o.motionLevel = o.motionLevel || 'immersive';
    o.interactionStyle = o.interactionStyle || 'cinematic';
    o.directives.push('Gaming / creative — immersive motion allowed');
  }

  return o;
}

/**
 * Derive the Motion Strategy from an already-built plan + user prompt. Returns `undefined`
 * when the flag is off, there is no plan, or on any failure — so the caller attaches nothing
 * and the plan stays the prior contract. Never throws.
 */
export function deriveMotionStrategy(
  plan: ExperienceArchitecturePlan | undefined,
  prompt: string,
): MotionStrategy | undefined {
  try {
    if (!isMotionIntelligenceEnabled()) return undefined;
    if (!plan || plan.version !== 'experience-arch-v1') return undefined;

    const base = DEFAULTS[plan.experienceType] || adaptiveDefault();
    const overrides = parseMotionOverrides(prompt);

    // Start from the class default; let the SIGNATURE's already-decided motion intensity refine
    // the level (never inflate it just because the product is "AI").
    let motionLevel: MotionLevel = base.motionLevel;
    if (plan.signature?.motionIntensity) motionLevel = levelFromIntensity(plan.signature.motionIntensity);
    if (overrides.motionLevel) motionLevel = overrides.motionLevel;
    if (overrides.motionCeiling) motionLevel = capLevel(motionLevel, overrides.motionCeiling);

    const interactionStyle: MotionInteractionStyle = overrides.interactionStyle || base.interactionStyle;
    const transitionStyle: MotionTransitionStyle = overrides.transitionStyle || base.transitionStyle;

    let heroMotion: MotionHeroMotion = heroFromAsset(plan.assetStrategy?.heroAsset, base.heroMotion);
    if (overrides.heroMotion) heroMotion = overrides.heroMotion;
    // A 'none' motion level must not carry a moving hero.
    if (motionLevel === 'none') heroMotion = 'none';

    const avoidMotion = cleanList([
      ...base.avoid,
      ...overrides.extraAvoid,
      // Accessibility + performance staples — always present.
      'motion that ignores prefers-reduced-motion',
      'heavy motion that hurts performance or CLS',
      ...(plan.forbiddenPatterns || []).filter((f) => /(motion|animat|parallax|scroll|zoom|neon|gimmick)/i.test(s(f))),
    ], MAX_AVOID);

    const strategy: MotionStrategy = {
      version: 'motion-strategy-v1',
      basis: overrides.directives.length > 0 ? 'user-override' : 'derived',
      motionLevel,
      interactionStyle,
      heroMotion,
      transitionStyle,
      avoidMotion,
      userDirectives: overrides.directives.slice(0, MAX_DIRECTIVES),
    };
    return strategy;
  } catch {
    return undefined;   // fail open — never break a build
  }
}

/**
 * Concise enforcement lines describing the motion strategy for the frontend_builder request.
 * Folded INTO the existing Experience Architecture enforcement block (not a second competing
 * block). Returns [] when no strategy — so the request is unchanged. No scores/reasoning.
 */
export function motionStrategyEnforcementLines(strategy: MotionStrategy | undefined): string[] {
  if (!strategy || strategy.version !== 'motion-strategy-v1') return [];
  const lines = [
    `- Motion level: ${strategy.motionLevel} — respect it exactly; "none" means no animation at all.`
      + ' Never add motion just because the site is AI-generated.',
    `- Interaction style: ${strategy.interactionStyle}; hero motion: ${strategy.heroMotion};`
      + ` transitions: ${strategy.transitionStyle}.`,
    '- Always honour prefers-reduced-motion and keep motion performant (no layout-shifting or'
      + ' heavy continuous animation).',
  ];
  if (strategy.avoidMotion.length) {
    lines.push(`- Never use these motion patterns: ${strategy.avoidMotion.join('; ')}.`);
  }
  return lines;
}
