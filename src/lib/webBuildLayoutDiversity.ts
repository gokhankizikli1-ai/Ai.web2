/**
 * Web Build LAYOUT DIVERSITY INTELLIGENCE LAYER (PR #514).
 *
 * Decides the PAGE COMPOSITION before generation so websites stop following the same
 * repetitive AI landing structure (hero → features → three cards → CTA). It is a lightweight,
 * DETERMINISTIC strategy layer, NOT a new intelligence system and NOT a competing plan: it
 * consumes existing outputs only (the already-built ExperienceArchitecturePlan, its Signature
 * and Asset Strategy, and the user request) and NESTS a typed LayoutStrategy onto that same
 * plan (`plan.layoutStrategy`). ZERO extra model calls.
 *
 * `deriveLayoutStrategy` is pure, synchronous, network-free, bounded, JSON-serializable and
 * FAILS OPEN (returns `undefined` on any problem, never throws).
 *
 * Rules honoured: the generic hero/features/cards/CTA template is never the default (it is an
 * explicit avoid); business type changes the structure; dashboards/apps never use a marketing
 * landing layout; luxury prefers editorial/showcase; SaaS prioritises product demonstration;
 * explicit user intent wins.
 *
 * Feature flag (default OFF → no layout strategy is attached; the plan is byte-for-byte the
 * prior contract):
 *
 *     VITE_ENABLE_LAYOUT_DIVERSITY=false
 */
import type {
  ExperienceArchitecturePlan, LayoutStrategy, LayoutPageStructure, LayoutHeroStyle,
  LayoutContentDensity, ExperienceTextDensity,
} from '@/lib/webBuildAgents';

export function isLayoutDiversityEnabled(): boolean {
  try {
    const raw = (import.meta as unknown as { env?: Record<string, unknown> })?.env?.VITE_ENABLE_LAYOUT_DIVERSITY;
    return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

const MAX_FLOW = 10;
const MAX_AVOID = 10;
const MAX_DIRECTIVES = 6;
const MAX_FIELD = 80;
const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function cleanList(xs: ReadonlyArray<string | undefined | null> | undefined, n: number): string[] {
  if (!Array.isArray(xs)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of xs) {
    const t = s(raw).slice(0, MAX_FIELD);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= n) break;
  }
  return out;
}

// The generic AI-template stack that must NEVER be the default — always an explicit avoid.
const GENERIC_AVOIDS = [
  'generic hero → features → three cards → CTA stack',
  'identical repeated feature-card grid',
];

interface LayoutDefault {
  pageStructure: LayoutPageStructure;
  heroStyle: LayoutHeroStyle;
  contentDensity: LayoutContentDensity;
  sectionFlow: string[];
  avoid: string[];
}

/* Per experience-type defaults (keyed to the plan's `experienceType`). Each flow is a
 * business-specific composition, NOT the generic stack. All overridable. */
const DEFAULTS: Record<string, LayoutDefault> = {
  'atmosphere-editorial': {
    pageStructure: 'editorial', heroStyle: 'editorial', contentDensity: 'balanced',
    sectionFlow: ['atmosphere', 'signature-dishes', 'story', 'the-experience', 'reservation'],
    avoid: ['dashboard cards', 'technical diagrams'],
  },
  'catalog-commerce': {
    pageStructure: 'product_first', heroStyle: 'product_demo', contentDensity: 'rich',
    sectionFlow: ['featured-products', 'shop-by-category', 'product-detail', 'social-proof', 'checkout-cta'],
    avoid: ['long corporate storytelling before products', 'centered SaaS hero'],
  },
  'work-showcase': {
    pageStructure: 'showcase', heroStyle: 'immersive', contentDensity: 'minimal',
    sectionFlow: ['selected-work', 'project-detail', 'about', 'contact'],
    avoid: ['generic feature grid', 'testimonials as filler'],
  },
  'product-demonstration': {
    pageStructure: 'product_first', heroStyle: 'product_demo', contentDensity: 'balanced',
    sectionFlow: ['product-demo', 'how-it-works-interactive', 'use-cases', 'integrations', 'get-started'],
    avoid: ['decorative feature-card trio', 'static screenshot hero'],
  },
  'trust-clarity': {
    pageStructure: 'conversion', heroStyle: 'split', contentDensity: 'balanced',
    sectionFlow: ['value-proposition', 'data-proof', 'trust-signals', 'how-it-works', 'get-started'],
    avoid: ['flashy hero gimmicks', 'cyberpunk/neon styling'],
  },
  'creative-showcase': {
    pageStructure: 'showcase', heroStyle: 'immersive', contentDensity: 'balanced',
    sectionFlow: ['statement', 'selected-work', 'capabilities', 'contact'],
    avoid: ['timid centered corporate layout'],
  },
  'content-editorial': {
    pageStructure: 'editorial', heroStyle: 'editorial', contentDensity: 'rich',
    sectionFlow: ['featured-story', 'topic-sections', 'archive', 'subscribe'],
    avoid: ['SaaS pricing-card layout'],
  },
};

function adaptiveDefault(plan: ExperienceArchitecturePlan): LayoutDefault {
  const flow = cleanList(plan.sectionSequence, MAX_FLOW);
  return {
    pageStructure: 'narrative', heroStyle: 'minimal', contentDensity: 'balanced',
    sectionFlow: flow.length ? flow : ['intro', 'core-value', 'proof', 'next-step'],
    avoid: [],
  };
}

function densityFromText(textDensity: ExperienceTextDensity | undefined): LayoutContentDensity | undefined {
  switch (textDensity) {
    case 'low': return 'minimal';
    case 'medium': return 'balanced';
    case 'high': return 'rich';
    default: return undefined;
  }
}

/** Refine hero style from the Signature's interaction pattern + Asset Strategy's hero asset. */
function refineHeroStyle(plan: ExperienceArchitecturePlan, base: LayoutHeroStyle): LayoutHeroStyle {
  const heroAsset = plan.assetStrategy?.heroAsset;
  if (heroAsset === 'interactive_demo') return 'product_demo';
  if (heroAsset === 'none') return 'minimal';
  if (heroAsset === 'video') return 'immersive';
  switch (plan.signature?.interactionPattern) {
    case 'interactive_demo': return 'product_demo';
    case 'immersive_gallery':
    case 'cinematic_scroll': return 'immersive';
    case 'editorial_storytelling': return 'editorial';
    case 'minimal_static': return 'minimal';
    default: return base;
  }
}

/* ── Explicit user overrides (these win) ──────────────────────────────────────*/
interface LayoutOverrides {
  pageStructure?: LayoutPageStructure;
  heroStyle?: LayoutHeroStyle;
  contentDensity?: LayoutContentDensity;
  extraAvoid: string[];
  directives: string[];
}

function parseLayoutOverrides(prompt: string): LayoutOverrides {
  const p = (prompt || '').toLowerCase();
  const o: LayoutOverrides = { extraAvoid: [], directives: [] };

  if (/\bdashboard\b/.test(p) || /\bapp\s+interface\b/.test(p) || /\bweb\s?app\b/.test(p) || /\badmin\s+(panel|interface)\b/.test(p)
    || /\bopen(s)?\s+(directly|straight)?\s*(in)?to\s+(the\s+)?app\b/.test(p)) {
    // Dashboards / apps must NOT use a marketing landing layout.
    o.pageStructure = 'application';
    o.heroStyle = o.heroStyle || 'minimal';
    o.contentDensity = o.contentDensity || 'rich';
    o.extraAvoid.push('marketing landing hero', 'feature cards', 'testimonials', 'final marketing CTA section');
    o.directives.push('Dashboard / app — application layout, not a marketing landing');
  }

  if (/\bluxur(y|ious)\b/.test(p) || /\bpremium\b/.test(p) || /\belegant\b/.test(p) || /\bfine\s+dining\b/.test(p)) {
    // Luxury prefers editorial/showcase (unless it is clearly product/app-led).
    if (!o.pageStructure || o.pageStructure === 'conversion' || o.pageStructure === 'narrative') o.pageStructure = 'editorial';
    o.heroStyle = o.heroStyle || 'editorial';
    o.directives.push('Luxury — editorial/showcase structure');
  }

  if (/\b(product|products)[-\s]?first\b/.test(p) || /\bshow\s+products?\s+first\b/.test(p)) {
    o.pageStructure = o.pageStructure || 'product_first';
    o.heroStyle = o.heroStyle || 'product_demo';
    o.directives.push('Product-first structure');
  }

  if (/\b(editorial|magazine|story[-\s]?driven)\b/.test(p)) {
    o.pageStructure = o.pageStructure || 'editorial';
    o.heroStyle = o.heroStyle || 'editorial';
    o.directives.push('Editorial structure');
  }

  if (/\b(portfolio|showcase|gallery)\b/.test(p)) {
    o.pageStructure = o.pageStructure || 'showcase';
    o.directives.push('Showcase structure');
  }

  if (/\bminimal(ist)?\b/.test(p) || /\bsimple\b/.test(p)) {
    o.contentDensity = o.contentDensity || 'minimal';
    o.heroStyle = o.heroStyle || 'minimal';
    o.directives.push('Minimal composition');
  }

  return o;
}

/**
 * Derive the Layout Strategy from an already-built plan + user prompt. Returns `undefined`
 * when the flag is off, there is no plan, or on any failure — so the caller attaches nothing
 * and the plan stays the prior contract. Never throws.
 */
export function deriveLayoutStrategy(
  plan: ExperienceArchitecturePlan | undefined,
  prompt: string,
): LayoutStrategy | undefined {
  try {
    if (!isLayoutDiversityEnabled()) return undefined;
    if (!plan || plan.version !== 'experience-arch-v1') return undefined;

    const base = DEFAULTS[plan.experienceType] || adaptiveDefault(plan);
    const overrides = parseLayoutOverrides(prompt);

    // A plan that already declared itself non-landing (app-first) is an application layout,
    // even without an explicit keyword — dashboards/apps never get a marketing landing.
    const appFromPlan = plan.landingRequired === false
      || /interactive-demo|app-first/.test(plan.entryPattern || '');

    let pageStructure: LayoutPageStructure = overrides.pageStructure || base.pageStructure;
    if (appFromPlan && !overrides.pageStructure) pageStructure = 'application';

    // Application layouts get an app-shell flow, never a marketing stack.
    const applicationFlow = ['app-shell', 'primary-workspace', 'contextual-panels', 'account-settings'];
    const sectionFlow = pageStructure === 'application'
      ? applicationFlow
      : cleanList(base.sectionFlow, MAX_FLOW);

    let heroStyle: LayoutHeroStyle = overrides.heroStyle || refineHeroStyle(plan, base.heroStyle);
    if (pageStructure === 'application') heroStyle = overrides.heroStyle || 'minimal';

    const contentDensity: LayoutContentDensity = overrides.contentDensity
      || densityFromText(plan.textDensity)
      || base.contentDensity;

    const avoidPatterns = cleanList([
      ...GENERIC_AVOIDS,   // the generic stack is ALWAYS an explicit avoid
      ...base.avoid,
      ...overrides.extraAvoid,
      ...(pageStructure === 'application' ? ['marketing landing layout on a functional app'] : []),
    ], MAX_AVOID);

    const strategy: LayoutStrategy = {
      version: 'layout-strategy-v1',
      basis: overrides.directives.length > 0 ? 'user-override' : 'derived',
      pageStructure,
      sectionFlow,
      heroStyle,
      contentDensity,
      avoidPatterns,
      userDirectives: overrides.directives.slice(0, MAX_DIRECTIVES),
    };
    return strategy;
  } catch {
    return undefined;   // fail open — never break a build
  }
}

/**
 * Concise enforcement lines describing the layout strategy for the frontend_builder request.
 * Folded INTO the existing Experience Architecture enforcement block (not a second competing
 * block). Returns [] when no strategy — so the request is unchanged. No scores/reasoning.
 */
export function layoutStrategyEnforcementLines(strategy: LayoutStrategy | undefined): string[] {
  if (!strategy || strategy.version !== 'layout-strategy-v1') return [];
  const lines = [
    `- Page structure: ${strategy.pageStructure}; hero style: ${strategy.heroStyle};`
      + ` content density: ${strategy.contentDensity}.`,
    `- Compose the page as this section flow (not a generic hero/features/cards/CTA stack):`
      + ` ${strategy.sectionFlow.join(' → ')}.`,
    '- Do NOT reuse the same hero/features/cards/CTA template. Let the business type drive a'
      + ' distinct composition.',
  ];
  if (strategy.pageStructure === 'application') {
    lines.push('- This is an application/dashboard: use a functional app layout, NOT a marketing landing page.');
  }
  if (strategy.avoidPatterns.length) {
    lines.push(`- Never use these layout patterns: ${strategy.avoidPatterns.join('; ')}.`);
  }
  return lines;
}
