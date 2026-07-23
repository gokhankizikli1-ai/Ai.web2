/**
 * Web Build EXPERIENCE SIGNATURE LAYER (PR #511).
 *
 * Decides the MEMORABLE first-interaction moment of a website — so two different ideas do
 * not generate the same generic structure. It is a lightweight, DETERMINISTIC planning layer,
 * NOT a new intelligence system and NOT a competing plan: it consumes the already-built
 * ExperienceArchitecturePlan (which itself already folds in Design Personality / Visual
 * Intelligence signals) plus the user request, and produces a small typed ExperienceSignature
 * that is NESTED on that same plan (`plan.signature`).
 *
 * ZERO extra model calls. `deriveExperienceSignature` is pure, synchronous, network-free,
 * bounded, JSON-serializable and FAILS OPEN (returns `undefined` on any problem, never throws).
 *
 * EXPLICIT USER INTENT WINS: "minimal", "no animation", "dashboard", "app interface" and
 * "simple landing" (and similar) never get forced into a cinematic experience.
 *
 * Feature flag (default OFF → no signature is attached; the plan is byte-for-byte the PR #509
 * contract):
 *
 *     VITE_ENABLE_EXPERIENCE_SIGNATURE=false
 */
import type {
  ExperienceArchitecturePlan, ExperienceSignature, ExperienceInteractionPattern,
  ExperienceMotionIntensity, ExperienceAttentionStrategy,
} from '@/lib/webBuildAgents';

export function isExperienceSignatureEnabled(): boolean {
  try {
    const raw = (import.meta as unknown as { env?: Record<string, unknown> })?.env?.VITE_ENABLE_EXPERIENCE_SIGNATURE;
    return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

const MAX_FIELD = 160;
const MAX_DIRECTIVES = 6;
const cap = (v: string): string => (v.length > MAX_FIELD ? v.slice(0, MAX_FIELD) : v).trim();

const MOTION_RANK: Record<ExperienceMotionIntensity, number> = { none: 0, subtle: 1, medium: 2, high: 3 };
/** Clamp a motion intensity so it never exceeds a ceiling (used by "minimal" etc.). */
function capMotion(value: ExperienceMotionIntensity, ceiling: ExperienceMotionIntensity): ExperienceMotionIntensity {
  return MOTION_RANK[value] > MOTION_RANK[ceiling] ? ceiling : value;
}

interface SignatureDefault {
  signatureMoment: string;
  emotionalGoal: string;
  interactionPattern: ExperienceInteractionPattern;
  motionIntensity: ExperienceMotionIntensity;
  attentionStrategy: ExperienceAttentionStrategy;
}

/* Per experience-type defaults (keyed to PR #509's `experienceType` values). All overridable
 * by explicit user intent below. */
const DEFAULTS: Record<string, SignatureDefault> = {
  'atmosphere-editorial': {
    signatureMoment: 'cinematic location reveal', emotionalGoal: 'refined anticipation and quiet desire',
    interactionPattern: 'cinematic_scroll', motionIntensity: 'medium', attentionStrategy: 'story_first',
  },
  'catalog-commerce': {
    signatureMoment: 'product discovery and conversion flow', emotionalGoal: 'confident, effortless desire to buy',
    interactionPattern: 'product_reveal', motionIntensity: 'medium', attentionStrategy: 'product_first',
  },
  'work-showcase': {
    signatureMoment: 'visual work showcase', emotionalGoal: 'impressed and curious to see more',
    interactionPattern: 'immersive_gallery', motionIntensity: 'subtle', attentionStrategy: 'story_first',
  },
  'product-demonstration': {
    signatureMoment: 'interactive product demonstration', emotionalGoal: 'confidence in the product\'s capability',
    interactionPattern: 'interactive_demo', motionIntensity: 'medium', attentionStrategy: 'product_first',
  },
  'trust-clarity': {
    signatureMoment: 'clear proof and data at a glance', emotionalGoal: 'trust and calm clarity',
    interactionPattern: 'data_exploration', motionIntensity: 'subtle', attentionStrategy: 'hero_first',
  },
  'creative-showcase': {
    signatureMoment: 'a bold creative statement', emotionalGoal: 'excitement and creative confidence',
    interactionPattern: 'editorial_storytelling', motionIntensity: 'medium', attentionStrategy: 'story_first',
  },
  'content-editorial': {
    signatureMoment: 'an immersive reading experience', emotionalGoal: 'absorbed and well-informed',
    interactionPattern: 'editorial_storytelling', motionIntensity: 'subtle', attentionStrategy: 'story_first',
  },
};

/** Fallback for 'adaptive'/unknown experience types — derived from the plan's hero priority. */
function adaptiveDefault(plan: ExperienceArchitecturePlan): SignatureDefault {
  switch (plan.heroContentPriority) {
    case 'interaction':
      return { signatureMoment: 'a hands-on interactive moment', emotionalGoal: 'engaged and in control',
        interactionPattern: 'interactive_demo', motionIntensity: 'medium', attentionStrategy: 'interaction_first' };
    case 'product_ui':
    case 'catalog':
      return { signatureMoment: 'a focused product reveal', emotionalGoal: 'confident and convinced',
        interactionPattern: 'product_reveal', motionIntensity: 'medium', attentionStrategy: 'product_first' };
    case 'media':
      return { signatureMoment: 'an immersive visual moment', emotionalGoal: 'drawn in and curious',
        interactionPattern: 'immersive_gallery', motionIntensity: 'subtle', attentionStrategy: 'story_first' };
    case 'content':
      return { signatureMoment: 'a clear editorial lead', emotionalGoal: 'informed and reassured',
        interactionPattern: 'editorial_storytelling', motionIntensity: 'subtle', attentionStrategy: 'story_first' };
    default:
      return { signatureMoment: 'a distinctive first impression', emotionalGoal: 'clear and memorable',
        interactionPattern: 'minimal_static', motionIntensity: 'subtle', attentionStrategy: 'hero_first' };
  }
}

/* ── Explicit user overrides (never force cinematic; these win) ────────────────*/
interface SignatureOverrides {
  motionCeiling?: ExperienceMotionIntensity;
  motionIntensity?: ExperienceMotionIntensity;
  interactionPattern?: ExperienceInteractionPattern;
  attentionStrategy?: ExperienceAttentionStrategy;
  emotionalGoal?: string;
  directives: string[];
}

function parseSignatureOverrides(prompt: string): SignatureOverrides {
  const p = (prompt || '').toLowerCase();
  const o: SignatureOverrides = { directives: [] };

  if (/\b(no|without|zero|disable)\s+(animation|animations|motion)\b/.test(p) || /\bstatic\b/.test(p) || /\bno\s+fancy\b/.test(p)) {
    o.motionIntensity = 'none';
    o.motionCeiling = 'none';
    o.directives.push('No animation / static');
  }

  if (/\bdashboard\b/.test(p) || /\bapp\s+interface\b/.test(p) || /\bweb\s?app\b/.test(p) || /\badmin\s+(panel|interface)\b/.test(p)) {
    o.interactionPattern = 'interactive_demo';
    o.attentionStrategy = 'interaction_first';
    o.motionCeiling = o.motionCeiling || 'subtle';
    o.emotionalGoal = o.emotionalGoal || 'efficient, capable and in control';
    o.directives.push('Dashboard / app interface');
  }

  if (/\bsimple\s+landing\b/.test(p) || /\bbasic\s+landing\b/.test(p)) {
    o.interactionPattern = o.interactionPattern || 'minimal_static';
    o.attentionStrategy = o.attentionStrategy || 'hero_first';
    o.motionCeiling = o.motionCeiling || 'subtle';
    o.directives.push('Simple landing');
  }

  if (/\bminimal(ist)?\b/.test(p) || /\bkeep\s+it\s+simple\b/.test(p) || /\bclean\s+and\s+simple\b/.test(p)) {
    // Do NOT force cinematic: cap motion and prefer a restrained pattern unless a stronger
    // product/app signal already set one.
    o.motionCeiling = o.motionCeiling || 'subtle';
    o.interactionPattern = o.interactionPattern || 'minimal_static';
    o.emotionalGoal = o.emotionalGoal || 'calm, focused clarity';
    o.directives.push('Minimal / simple');
  }

  return o;
}

/**
 * Derive the Experience Signature from an already-built ExperienceArchitecturePlan + the user
 * prompt. Returns `undefined` when the flag is off, there is no plan, or on any failure — so
 * the caller attaches nothing and the plan stays the PR #509 contract. Never throws.
 */
export function deriveExperienceSignature(
  plan: ExperienceArchitecturePlan | undefined,
  prompt: string,
): ExperienceSignature | undefined {
  try {
    if (!isExperienceSignatureEnabled()) return undefined;
    if (!plan || plan.version !== 'experience-arch-v1') return undefined;

    const base = DEFAULTS[plan.experienceType] || adaptiveDefault(plan);
    const overrides = parseSignatureOverrides(prompt);

    let motionIntensity = overrides.motionIntensity || base.motionIntensity;
    if (overrides.motionCeiling) motionIntensity = capMotion(motionIntensity, overrides.motionCeiling);

    const interactionPattern = overrides.interactionPattern || base.interactionPattern;
    const attentionStrategy = overrides.attentionStrategy || base.attentionStrategy;

    // Prefer the plan's own signatureMoment when it set one (single source of truth); else the
    // class default. Never duplicate — the signature does not compete with the plan.
    const signatureMoment = cap(overrides.interactionPattern && overrides.directives.length
      ? base.signatureMoment                    // an explicit override reshapes the moment to its default
      : (plan.signatureMoment || base.signatureMoment));

    return {
      version: 'experience-signature-v1',
      basis: overrides.directives.length > 0 ? 'user-override' : 'derived',
      signatureMoment,
      emotionalGoal: cap(overrides.emotionalGoal || base.emotionalGoal),
      interactionPattern,
      motionIntensity,
      attentionStrategy,
      userDirectives: overrides.directives.slice(0, MAX_DIRECTIVES),
    };
  } catch {
    return undefined;   // fail open — never break a build
  }
}

/**
 * Concise enforcement lines describing the signature for the frontend_builder request. Folded
 * INTO the existing Experience Architecture enforcement block (not a second competing block).
 * Returns [] when no signature — so the request is unchanged. Exposes no scores/reasoning.
 */
export function experienceSignatureEnforcementLines(signature: ExperienceSignature | undefined): string[] {
  if (!signature || signature.version !== 'experience-signature-v1') return [];
  return [
    `- Signature moment: ${signature.signatureMoment} — make THIS the memorable first interaction, not a generic hero.`,
    `- Interaction pattern: ${signature.interactionPattern}; attention strategy: ${signature.attentionStrategy};`
      + ` emotional goal: ${signature.emotionalGoal}.`,
    `- Motion intensity: ${signature.motionIntensity} — respect it exactly; "none" means no animation at all,`
      + ` "subtle" means restrained. Do not exceed it.`,
  ];
}
