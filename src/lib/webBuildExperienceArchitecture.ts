/**
 * Web Build EXPERIENCE ARCHITECTURE PLANNER (PR #510).
 *
 * Decides what a website should ACTUALLY BE — entry pattern, hero behaviour, per-section
 * visual medium, proof strategy, signature moment and forbidden template patterns — as ONE
 * bounded TYPED contract, BEFORE any source is generated. It fixes the "every site feels
 * like one template" problem by turning the planning decisions into an ENFORCEABLE contract
 * instead of soft prose.
 *
 * DETERMINISTIC + ZERO extra model calls. `deriveExperienceArchitecturePlan` is pure,
 * synchronous, network-free, bounded, non-mutating, JSON-serializable and FAILS OPEN
 * (returns `undefined` on any problem). It reads the planning output the model already
 * emits (entry flow, hero composition, section rhythm, page sections) plus the
 * already-computed asset/visual signals on the assembled specification. It does NOT call a
 * model, does NOT re-implement Visual Intelligence or Design Personality (it CONSUMES their
 * outputs), and OWNS only experience STRUCTURE.
 *
 * EXPLICIT USER INTENT WINS: "no landing page", "open directly into the app", "product-first"
 * and "minimal text" (and similar) override the derived defaults.
 *
 * Feature flag (default OFF → the plan is never attached and the spec/prompt are byte-for-byte
 * the pre-#510 contract):
 *
 *     VITE_ENABLE_EXPERIENCE_ARCHITECTURE=false
 */
import type {
  FrontendBuildSpecification, ExperienceArchitecturePlan, ExperienceSectionContract,
  ExperienceVisualMedium, ExperienceTextDensity, ExperienceHeroContentPriority,
} from '@/lib/webBuildAgents';
// PR #511 — the Experience Signature layer (a leaf; pure + fail-open). Nested onto this plan;
// returns undefined when its own flag is off, so the plan stays the PR #509 contract.
import { deriveExperienceSignature, experienceSignatureEnforcementLines } from '@/lib/webBuildExperienceSignature';

/* ── Feature flag ─────────────────────────────────────────────────────────────
 * Read LIVE (per call, never cached at module load) so tests can toggle it and so a
 * misread never throws. */
export function isExperienceArchitectureEnabled(): boolean {
  try {
    const raw = (import.meta as unknown as { env?: Record<string, unknown> })?.env?.VITE_ENABLE_EXPERIENCE_ARCHITECTURE;
    return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

/* ── Bounds (safe, JSON-serializable, prompt-budget friendly) ────────────────── */
const MAX_SECTIONS = 24;
const MAX_LIST = 10;
const MAX_FIELD = 200;
const MAX_ID = 100;
const MAX_DIRECTIVES = 8;

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const cap = (v: string, n = MAX_FIELD): string => (v.length > n ? v.slice(0, n) : v);

function cleanList(xs: ReadonlyArray<string | undefined | null> | undefined, n = MAX_LIST): string[] {
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

/* ── Explicit user overrides (these always win) ───────────────────────────────
 * Bounded, case-insensitive intent detection over the raw user prompt. Each match records
 * a human directive (surfaced to generation + validation) and flips a derived default. */
interface UserOverrides {
  landingRequired?: boolean;
  entryPattern?: string;
  heroContentPriority?: ExperienceHeroContentPriority;
  primaryVisualMedium?: ExperienceVisualMedium;
  textDensity?: ExperienceTextDensity;
  directives: string[];
}

function parseUserOverrides(prompt: string): UserOverrides {
  const p = (prompt || '').toLowerCase();
  const o: UserOverrides = { directives: [] };

  const noLanding = /\bno\s+(landing|landing\s*page|hero)\b/.test(p)
    || /\b(skip|without|drop|remove)\s+(the\s+)?(landing|landing\s*page|hero)\b/.test(p)
    || /\bopen(s)?\s+(directly|straight|right)?\s*(in)?to\s+(the\s+)?(app|demo|product|dashboard|tool)\b/.test(p)
    || /\b(app|demo)[-\s]?first\b/.test(p)
    || /\bstraight\s+into\s+(the\s+)?(app|demo|product)\b/.test(p);
  if (noLanding) {
    o.landingRequired = false;
    o.entryPattern = 'app-first';
    o.heroContentPriority = 'interaction';
    o.directives.push('No landing page — open directly into the app/product experience');
  }

  if (/\b(product|products|catalog|shop)[-\s]?first\b/.test(p) || /\bshow\s+products?\s+first\b/.test(p)) {
    o.entryPattern = o.entryPattern || 'product-first';
    o.heroContentPriority = o.heroContentPriority || 'catalog';
    o.directives.push('Product/category-first entry');
  }

  if (/\b(interactive|product|live)\s+demo\b/.test(p) || /\bdemo[-\s]?first\b/.test(p) || /\btry\s+it\s+live\b/.test(p)) {
    o.entryPattern = o.entryPattern || 'interactive-demo';
    o.heroContentPriority = o.heroContentPriority || 'interaction';
    o.primaryVisualMedium = o.primaryVisualMedium || 'interactive_demo';
    o.directives.push('Interactive product demo as the primary experience');
  }

  if (/\b(minimal|less|low|short|light)\s*(text|copy|words)\b/.test(p) || /\btext[-\s]?light\b/.test(p) || /\bminimal\s+text\b/.test(p)) {
    o.textDensity = 'low';
    o.directives.push('Minimal text / low copy density');
  }

  if (/\b(work|project|portfolio)[-\s]?first\b/.test(p)) {
    o.entryPattern = o.entryPattern || 'work-first';
    o.heroContentPriority = o.heroContentPriority || 'media';
    o.directives.push('Work/project-first entry');
  }

  return o;
}

/* ── Signal keyword maps (experience STRUCTURE, not visual style) ────────────── */
const RE = {
  restaurant: /(restaurant|dining|cafe|bistro|food|menu|culinary|hospitality|hotel|\bbar\b)/,
  finance: /(finance|financial|bank|banking|fintech|invest|wealth|trading|payment|insurance)/,
  ai: /(\bai\b|artificial\s+intelligence|\bml\b|machine\s+learning|chatbot|assistant|\bagent\b|\bllm\b|generative)/,
  saas: /(\bsaas\b|dashboard|platform|analytics|\bb2b\b|workflow|automation|developer\s+tool|devtool)/,
  // Commerce needs a genuine commerce signal — NEVER bare "product" (which appears in
  // "AI product", "SaaS product", …). Requires shop/store/cart/checkout/catalog/sell/retail.
  ecommerce: /(e-?commerce|online\s+store|\bshop\b|\bstore\b|catalog|retail|boutique|marketplace|checkout|add\s+to\s+cart|\bsell(ing)?\b|\bbuy\b)/,
  portfolio: /(portfolio|designer|photographer|artist|freelance|showcase|personal\s+site)/,
  agency: /(agency|studio|creative|marketing|branding|consultanc)/,
  media: /(\bmedia\b|editorial|magazine|\bblog\b|\bnews\b|publication)/,
};

function classify(spec: FrontendBuildSpecification, prompt: string): string {
  const hay = [
    s(spec.identity?.sector), s(spec.identity?.subsector), s(spec.identity?.siteType),
    s(spec.identity?.primaryConcept), (prompt || '').slice(0, 400),
  ].join(' ').toLowerCase();
  // Order = specificity. AI/SaaS/finance are checked before commerce so a "product" that is
  // really an AI/SaaS product is never miscategorised as a store.
  if (RE.restaurant.test(hay)) return 'restaurant';
  if (RE.finance.test(hay)) return 'finance';
  if (RE.ai.test(hay)) return 'ai-product';
  if (RE.saas.test(hay)) return 'saas';
  if (RE.ecommerce.test(hay)) return 'ecommerce';
  if (RE.portfolio.test(hay)) return 'portfolio';
  if (RE.agency.test(hay)) return 'agency';
  if (RE.media.test(hay)) return 'media';
  return 'general';
}

/* Per experience class: the STRUCTURAL defaults (all overridable by explicit user intent). */
interface ClassDefaults {
  experienceType: string;
  entryPattern: string;
  landingRequired: boolean;
  heroPattern: string;
  heroContentPriority: ExperienceHeroContentPriority;
  textDensity: ExperienceTextDensity;
  primaryVisualMedium: ExperienceVisualMedium;
  signatureMoment: string;
  forbidden: string[];
}

const DEFAULTS: Record<string, ClassDefaults> = {
  restaurant: {
    experienceType: 'atmosphere-editorial', entryPattern: 'atmosphere-first', landingRequired: true,
    heroPattern: 'full-bleed editorial photography', heroContentPriority: 'media', textDensity: 'low',
    primaryVisualMedium: 'photography', signatureMoment: 'cinematic menu or space reveal',
    forbidden: ['dashboard cards', 'technical diagrams', 'SaaS feature-card grid'],
  },
  ecommerce: {
    experienceType: 'catalog-commerce', entryPattern: 'product-first', landingRequired: false,
    heroPattern: 'product/category grid (hero optional)', heroContentPriority: 'catalog', textDensity: 'low',
    primaryVisualMedium: 'photography', signatureMoment: 'product quick-view or category browse',
    forbidden: ['long corporate storytelling before products', 'generic centered SaaS hero'],
  },
  portfolio: {
    experienceType: 'work-showcase', entryPattern: 'work-first', landingRequired: false,
    heroPattern: 'selected project or visual composition', heroContentPriority: 'media', textDensity: 'low',
    primaryVisualMedium: 'photography', signatureMoment: 'project hover/detail transition',
    forbidden: ['generic feature grid', 'testimonials-as-filler', 'centered headline + two CTA buttons'],
  },
  'ai-product': {
    experienceType: 'product-demonstration', entryPattern: 'interactive-demo', landingRequired: true,
    heroPattern: 'functional product/conversation simulation, minimal supporting copy',
    heroContentPriority: 'interaction', textDensity: 'medium', primaryVisualMedium: 'product_ui',
    signatureMoment: 'live product interaction (e.g. AI-to-human handoff)',
    forbidden: ['decorative node diagrams with meaningless numbers', 'generic centered SaaS hero', 'cyberpunk/neon clichés unless truly warranted'],
  },
  saas: {
    experienceType: 'product-demonstration', entryPattern: 'interactive-demo', landingRequired: true,
    heroPattern: 'real product UI preview with minimal copy', heroContentPriority: 'product_ui',
    textDensity: 'medium', primaryVisualMedium: 'product_ui', signatureMoment: 'interactive product preview',
    forbidden: ['decorative diagrams substituting for real product UI', 'three identical feature cards'],
  },
  finance: {
    experienceType: 'trust-clarity', entryPattern: 'value-first', landingRequired: true,
    heroPattern: 'clear value proposition with data clarity', heroContentPriority: 'content',
    textDensity: 'medium', primaryVisualMedium: 'data_visualization', signatureMoment: 'clear data/rate visualization',
    forbidden: ['cyberpunk/neon styling', 'gimmicky motion', 'unsubstantiated metrics'],
  },
  agency: {
    experienceType: 'creative-showcase', entryPattern: 'work-first', landingRequired: true,
    heroPattern: 'bold creative statement or reel', heroContentPriority: 'media', textDensity: 'low',
    primaryVisualMedium: 'mixed', signatureMoment: 'expressive scroll or case-study reveal',
    forbidden: ['timid centered layouts', 'generic feature grid'],
  },
  media: {
    experienceType: 'content-editorial', entryPattern: 'content-first', landingRequired: false,
    heroPattern: 'featured content / editorial lead', heroContentPriority: 'content', textDensity: 'high',
    primaryVisualMedium: 'photography', signatureMoment: 'immersive article/reading experience',
    forbidden: ['SaaS pricing-card layout', 'fake product demo'],
  },
  general: {
    experienceType: 'adaptive', entryPattern: 'value-first', landingRequired: true,
    heroPattern: 'concept-led hero derived from the idea', heroContentPriority: 'content', textDensity: 'medium',
    primaryVisualMedium: 'mixed', signatureMoment: 'one distinctive interaction or visual moment',
    forbidden: ['reflex "centered hero + three cards + CTA"', 'generic repeated blocks'],
  },
};

/* ── Per-section visual medium (consumes the section's already-planned module) ── */
function sectionMedium(
  section: { id?: string; name?: string; visualModule?: string; componentHint?: string },
  primary: ExperienceVisualMedium,
): ExperienceVisualMedium {
  const t = [s(section.visualModule), s(section.componentHint), s(section.name), s(section.id)].join(' ').toLowerCase();
  if (/(chart|graph|metric|stat|data|analytics)/.test(t)) return 'data_visualization';
  if (/(demo|interactive|playground|simulation|sandbox|try)/.test(t)) return 'interactive_demo';
  if (/(product\s*ui|screenshot|dashboard|app\s*preview|interface)/.test(t)) return 'product_ui';
  if (/(photo|gallery|image|lifestyle|editorial|portrait|venue|food|team)/.test(t)) return 'photography';
  if (/(illustration|illustrative|drawing|mascot)/.test(t)) return 'illustration';
  if (/(video|motion|animation|reel)/.test(t)) return 'video_or_motion';
  if (/(quote|faq|copy|text|manifesto|story)/.test(t)) return 'typography';
  if (/(logo|divider|spacer|footer)/.test(t)) return 'none';
  return primary;
}

function sectionTextDensity(density: string, planTextDensity: ExperienceTextDensity): ExperienceTextDensity {
  const d = (density || '').toLowerCase();
  if (/\b(low|sparse|minimal|light)\b/.test(d)) return 'low';
  if (/\b(high|dense|rich|heavy)\b/.test(d)) return 'high';
  if (/\b(medium|balanced)\b/.test(d)) return 'medium';
  return planTextDensity;
}

function inferLandingFromPlan(spec: FrontendBuildSpecification, fallback: boolean): boolean {
  const t = [s(spec.architecture?.entryFlowModel), s(spec.architecture?.entryScreen)].join(' ').toLowerCase();
  if (/\b(no\s+landing|app-first|direct|skip\s+landing|straight\s+into)\b/.test(t)) return false;
  if (/\b(landing|marketing\s+page|traditional)\b/.test(t)) return true;
  return fallback;
}

/**
 * Derive the Experience Architecture plan from an assembled specification + the raw user
 * prompt. Returns `undefined` when the flag is off, there is no usable structure, or on any
 * failure — so the caller attaches nothing and the build path is unchanged. Never throws.
 */
export function deriveExperienceArchitecturePlan(
  spec: FrontendBuildSpecification | undefined,
  prompt: string,
): ExperienceArchitecturePlan | undefined {
  try {
    if (!isExperienceArchitectureEnabled()) return undefined;
    if (!spec || !spec.architecture) return undefined;

    const cls = classify(spec, prompt);
    const base = DEFAULTS[cls] || DEFAULTS.general;
    const overrides = parseUserOverrides(prompt);

    const ds = spec.designSystem || ({} as FrontendBuildSpecification['designSystem']);
    const arch = spec.architecture;
    const sections = Array.isArray(arch.sections) ? arch.sections.slice(0, MAX_SECTIONS) : [];

    // No section structure at all → nothing meaningful to enforce; stay out of the way.
    if (sections.length === 0 && (!Array.isArray(arch.sectionOrder) || arch.sectionOrder.length === 0)) {
      return undefined;
    }

    const textDensity: ExperienceTextDensity = overrides.textDensity || base.textDensity;
    const primaryVisualMedium: ExperienceVisualMedium = overrides.primaryVisualMedium || base.primaryVisualMedium;

    const sectionContracts: ExperienceSectionContract[] = sections.map((sec) => {
      const requiredContent = cleanList([sec.headline, sec.subheadline, ...(sec.bullets || [])], 6);
      const medium = sectionMedium(sec, primaryVisualMedium);
      const contract: ExperienceSectionContract = {
        id: cap(s(sec.id) || `section-${sec.order ?? 0}`, MAX_ID),
        purpose: cap(s(sec.purpose) || s(sec.name) || 'section'),
        requiredContent,
        visualMedium: medium,
        textDensity: sectionTextDensity(s(sec.density), textDensity),
      };
      const interaction = cleanList(sec.interactionHints, 3).join('; ');
      if (interaction) contract.interaction = cap(interaction);
      // Proof sections must carry real evidence; a photographic/product medium implies it.
      if (medium === 'photography' || medium === 'product_ui' || medium === 'interactive_demo' || medium === 'data_visualization') {
        contract.proofRequirement = medium === 'photography'
          ? 'Real imagery/evidence (not a decorative placeholder)'
          : 'A real, labeled product/data artifact (not a decorative diagram or empty skeleton)';
      }
      if (medium === 'none' || medium === 'typography') {
        contract.fallback = 'Typography/composition only — do not force an image into this section';
      }
      return contract;
    });

    const sectionSequence = cleanList(
      Array.isArray(arch.sectionOrder) && arch.sectionOrder.length > 0
        ? arch.sectionOrder
        : sections.map((x) => s(x.id)),
      MAX_SECTIONS,
    );

    const landingRequired = overrides.landingRequired !== undefined
      ? overrides.landingRequired
      : inferLandingFromPlan(spec, base.landingRequired);

    const heroContentPriority: ExperienceHeroContentPriority = overrides.heroContentPriority
      || (landingRequired ? base.heroContentPriority : 'interaction');

    const forbidden = cleanList([
      ...base.forbidden,
      ...(ds.templateTrapsToAvoid || []),
      ...(ds.mustAvoid || []),
    ], MAX_LIST);

    const plan: ExperienceArchitecturePlan = {
      version: 'experience-arch-v1',
      basis: overrides.directives.length > 0 ? 'user-override' : 'derived',
      experienceType: cap(base.experienceType, 60),
      entryPattern: cap(overrides.entryPattern || base.entryPattern, 60),
      landingRequired,
      heroPattern: cap(s(ds.heroComposition) || base.heroPattern),
      heroContentPriority,
      textDensity,
      primaryVisualMedium,
      signatureMoment: cap(s(ds.visualSignature) || base.signatureMoment),
      sectionSequence,
      sectionContracts,
      forbiddenPatterns: forbidden,
      userDirectives: cleanList(overrides.directives, MAX_DIRECTIVES),
    };

    const navigationBehavior = cap(s(arch.navigationBehavior) || s(arch.navigationModel));
    if (navigationBehavior) plan.navigationBehavior = navigationBehavior;
    const conversionPath = cap(s(arch.conversionJourneyModel) || s(arch.primaryCTA));
    if (conversionPath) plan.conversionPath = conversionPath;
    const proofStrategy = cap(cleanList(spec.researchEvidence?.trustSignals, 4).join('; '));
    if (proofStrategy) plan.proofStrategy = proofStrategy;

    // PR #511 — nest the memorable-interaction signature onto THIS plan (integrated, not a
    // competing plan). Gated by its own flag; undefined ⇒ omitted, so the plan stays the
    // PR #509 contract. Fail-open.
    const signature = deriveExperienceSignature(plan, prompt);
    if (signature) plan.signature = signature;

    return plan;
  } catch {
    return undefined;   // fail open — never break a build
  }
}

/**
 * A concise ENFORCEMENT block for the frontend_builder request. Frames the structured
 * `experienceArchitecture` JSON (already in the projection) as a binding execution contract —
 * NOT a second competing prose plan and NOT optional inspiration. Returns "" when no plan is
 * present (so the request is byte-for-byte unchanged). Exposes no scores/reasoning.
 */
export function buildExperienceEnforcementBlock(plan: ExperienceArchitecturePlan | undefined): string {
  if (!plan || plan.version !== 'experience-arch-v1') return '';
  const lines = [
    'EXPERIENCE ARCHITECTURE CONTRACT (binding execution contract — obey exactly, not optional inspiration):',
    'The specification includes an "experienceArchitecture" object. Implement it as a contract:',
    '- Build exactly the sections in sectionSequence, in that order; do not add generic filler sections.',
    '- Honor heroPattern and heroContentPriority. Do NOT default to a centered headline + two CTA buttons',
    '  unless heroContentPriority is "text".',
    '- If landingRequired is false, do NOT build a traditional landing page — open directly into the',
    '  entryPattern experience.',
    '- For each sectionContract, deliver its visualMedium honestly: "photography" => a real <img>;',
    '  "product_ui"/"interactive_demo" => a real interactive component (never a decorative SVG diagram);',
    '  "data_visualization" => a real labeled chart; "typography"/"none" => no forced imagery.',
    '- Satisfy every proofRequirement with real, concrete evidence. Empty skeleton bars, unlabeled nodes',
    '  or decorative visuals do NOT satisfy a proof requirement.',
    '- Never use any pattern listed in forbiddenPatterns.',
    '- Respect each section\'s textDensity ("low" => minimal copy).',
    '- Do NOT assume a hero, headline, CTA pair, feature-card grid, testimonials or a final CTA section',
    '  unless the contract requires it.',
    '- userDirectives are explicit user instructions and OVERRIDE every default above.',
    // PR #511 — the memorable-interaction signature (nested on the same plan). Folded in here
    // so there is exactly ONE enforcement block, never a competing one. Empty when absent.
    ...experienceSignatureEnforcementLines(plan.signature),
    '',
  ];
  return lines.join('\n');
}
