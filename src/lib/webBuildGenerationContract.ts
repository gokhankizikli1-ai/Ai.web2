/**
 * Web Build HARD GENERATION CONTRACT (PR #519, Part A).
 *
 * Translates the EXISTING ExperienceArchitecturePlan (+ its nested Signature / Asset / Motion /
 * Layout strategies) into ONE compact, BINDING generation contract — hard requirements,
 * forbidden patterns, optional creative freedom — so the frontend_builder can no longer treat
 * the design guidance as optional inspiration and fall back to its familiar generic template.
 *
 * It is NOT a new plan, NOT a new intelligence system, and adds NO model call: it re-states
 * existing decisions as enforceable model-facing language (no scores, confidence, reasoning or
 * raw enums), and its STATIC checks feed the EXISTING review merge + EXISTING single bounded
 * repair (never a second validator/repair).
 *
 * Feature flag (default OFF → the request + validation are byte-for-byte unchanged):
 *     VITE_ENABLE_HARD_GENERATION_CONTRACT=false
 */
import type {
  ExperienceArchitecturePlan, FrontendGenerationContract, FrontendBuildSpecification,
  FrontendGeneratedFile, FrontendBuilderReviewIssue, FrontendBuilderReviewCategory,
  FrontendBuilderReviewSeverity, ExperienceVisualMedium,
} from '@/lib/webBuildAgents';
// PR #522 — the Brand Design System NESTS inside this contract (one BINDING sub-section) and its
// conservative checks extend THIS validator. It is only active when this contract is active.
import {
  isBrandDesignSystemEnabled, compileBrandDesignSystem, renderBrandDesignSystemBlock,
  evaluateBrandDesignCompliance, readExplicitDesign,
} from '@/lib/webBuildBrandDesignSystem';

export function isHardGenerationContractEnabled(): boolean {
  try {
    const raw = (import.meta as unknown as { env?: Record<string, unknown> })?.env?.VITE_ENABLE_HARD_GENERATION_CONTRACT;
    return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

const MAX_LIST = 12;
const MAX_FIELD = 200;
const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const cap = (v: string): string => (v.length > MAX_FIELD ? v.slice(0, MAX_FIELD) : v).trim();

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

/* Generic AI-template tells that are forbidden UNLESS the plan/request explicitly justifies
 * them. Phrased as strict negative constraints. */
const GENERIC_FALLBACKS = [
  'centered large headline + two CTA buttons as the dominant hero',
  'a generic three-identical-card features section',
  'meaningless metric/number cards without real data',
  'decorative dashboard/analytics mockups presented as product proof',
  'unlabeled node/graph diagrams',
  'empty skeleton bars standing in for content',
  'a default dark-purple AI aesthetic',
  'neon/futuristic styling merely because the product uses AI',
];

/* A generic anti-template default must NOT forbid something the user EXPLICITLY asked for. Each
 * entry pairs a fallback (matched loosely) with the explicit-intent evidence that justifies it.
 * Only these GENERIC defaults are overridable — safety and structural plan requirements are not.
 * Evidence is read from the user's real request/directives, never inferred from an internal enum. */
const EXPLICIT_INTENT_OVERRIDES: ReadonlyArray<{ fallback: RegExp; requested: RegExp }> = [
  { fallback: /two cta buttons|centered large headline/i, requested: /centered (hero|headline|layout|typograph)|typographic hero|hero with (a )?(centered )?headline|centered.*hero/i },
  { fallback: /three-identical-card|features section/i, requested: /feature (card|comparison)|comparison (card|table)|feature grid|pricing (card|table)|card grid/i },
  { fallback: /metric\/number cards/i, requested: /metric (card|grid)|stat(s| card| grid)|number card/i },
  { fallback: /dark-purple/i, requested: /purple|violet|dark (theme|mode|palette|background)|dark[- ]purple/i },
  { fallback: /neon/i, requested: /neon|futuristic|cyberpunk|glow/i },
];

const MAX_EXPLICIT_REQUEST = 600;

/** Bounded, lowercase view of what the user EXPLICITLY asked for — their original request plus any
 *  user directives carried on the plan. Deliberately EXCLUDES `experienceType` (an internal enum):
 *  explicit intent must come from the real request, not an inferred classification. Never stored. */
function explicitRequestText(explicitRequest: string | undefined, plan: ExperienceArchitecturePlan): string {
  const directives = [
    ...(plan.userDirectives || []), ...(plan.signature?.userDirectives || []),
    ...(plan.assetStrategy?.userDirectives || []), ...(plan.layoutStrategy?.userDirectives || []),
  ].join(' ');
  return `${s(explicitRequest)} ${directives}`.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, MAX_EXPLICIT_REQUEST);
}

/** True when the user's explicit request justifies keeping a generic fallback (so it must NOT be
 *  forbidden). Empty request → never justified (defaults stay in force). */
function isExplicitlyRequested(fallback: string, explicit: string): boolean {
  if (!explicit) return false;
  return EXPLICIT_INTENT_OVERRIDES.some((o) => o.fallback.test(fallback) && o.requested.test(explicit));
}

interface Intent { minimal: boolean; appFirst: boolean; expectsImages: boolean; }
function readIntent(plan: ExperienceArchitecturePlan): Intent {
  const directives = [
    ...(plan.userDirectives || []), ...(plan.signature?.userDirectives || []),
    ...(plan.assetStrategy?.userDirectives || []), ...(plan.layoutStrategy?.userDirectives || []),
  ].join(' ').toLowerCase();
  const minimal = plan.textDensity === 'low' || plan.layoutStrategy?.contentDensity === 'minimal'
    || plan.signature?.interactionPattern === 'minimal_static' || /minimal|no images|text-only|simple landing/.test(directives);
  // app-first = NO marketing landing (open into the app). interactive-demo is product-first
  // (a landing dominated by a demo), so it is NOT app-first here.
  const appFirst = plan.landingRequired === false || /app-first/.test(plan.entryPattern || '')
    || plan.layoutStrategy?.pageStructure === 'application';
  const heroAsset = plan.assetStrategy?.heroAsset;
  const expectsImages = plan.primaryVisualMedium === 'photography'
    || (heroAsset !== undefined && heroAsset !== 'none' && heroAsset !== 'interactive_demo')
    || (plan.sectionContracts || []).some((c) => c.visualMedium === 'photography');
  return { minimal, appFirst, expectsImages };
}

function mediumLabel(m: ExperienceVisualMedium): string {
  return m.replace(/_/g, ' ');
}

/**
 * Build the binding generation contract from an already-built plan. Returns `undefined` when
 * the flag is off or there is no usable plan. Pure + fail-open — never throws.
 *
 * `explicitRequest` is the user's ORIGINAL request (bounded). It is used ONLY to keep an
 * explicitly-requested pattern out of the generic forbidden list — it is never stored on, nor
 * exposed through, the returned contract.
 */
export function buildGenerationContract(
  plan: ExperienceArchitecturePlan | undefined,
  explicitRequest?: string,
  spec?: FrontendBuildSpecification,
): FrontendGenerationContract | undefined {
  try {
    if (!isHardGenerationContractEnabled()) return undefined;
    if (!plan || plan.version !== 'experience-arch-v1') return undefined;
    const intent = readIntent(plan);
    const explicit = explicitRequestText(explicitRequest, plan);

    // Entry requirement.
    let entryRequirement: string;
    if (intent.appFirst) {
      entryRequirement = 'Open directly into the application/product experience — do NOT build a marketing landing page.';
    } else if (/product-first|interactive-demo/.test(plan.entryPattern || '') || plan.heroContentPriority === 'interaction' || plan.heroContentPriority === 'product_ui') {
      entryRequirement = 'The first viewport must be dominated by a functional product experience, not a marketing headline.';
    } else if (/atmosphere/.test(plan.entryPattern || '')) {
      entryRequirement = 'Open with atmosphere-setting editorial visuals, not a generic SaaS hero.';
    } else if (/work-first/.test(plan.entryPattern || '')) {
      entryRequirement = 'Open with the actual work/portfolio, not a marketing headline.';
    } else {
      entryRequirement = 'Open with a clear, specific value proposition for this business — not a generic template hero.';
    }

    // Hero requirement.
    const heroRequirement = (plan.heroContentPriority === 'none' || /no hero|none/i.test(plan.heroPattern || ''))
      ? 'Do NOT invent a hero section.'
      : `Hero: ${cap(s(plan.heroPattern) || 'concept-led, specific to this business')}. The headline is supporting content unless the hero priority is text.`;

    // Dominant first-viewport element.
    const dominant = ((): string => {
      switch (plan.heroContentPriority) {
        case 'interaction': case 'product_ui': return 'a functional product / interactive demo';
        case 'catalog': return 'the product catalog';
        case 'media': return 'editorial photography / media';
        case 'content': return 'a specific value proposition';
        case 'text': return 'a concrete headline with real supporting copy';
        case 'none': return 'the application workspace';
        default: return 'the primary business experience';
      }
    })();

    // Required proof — business-specific, from the section proof requirements + proof strategy.
    const requiredProof = cleanList([
      ...(plan.sectionContracts || []).filter((c) => c.proofRequirement).map((c) => `${c.id}: ${s(c.proofRequirement)}`),
      s(plan.proofStrategy),
    ], 8);

    // Required visual media — genuine, never decorative substitutes. Skip when no-image intent.
    const media = new Set<ExperienceVisualMedium>();
    if (!intent.minimal) media.add(plan.primaryVisualMedium);
    for (const c of (plan.sectionContracts || [])) {
      if (c.visualMedium !== 'typography' && c.visualMedium !== 'none') media.add(c.visualMedium);
    }
    const requiredVisualMedia = cleanList([...media].filter((m) => m !== 'none' && m !== 'mixed').map(mediumLabel), 6);

    // Required interactions.
    const requiredInteractions = cleanList([
      s(plan.signature?.signatureMoment),
      ...(plan.sectionContracts || []).map((c) => s(c.interaction)).filter(Boolean),
    ], 6);

    // Forbidden — the plan's own avoids + the generic staples that conflict with it.
    const planForbids = cleanList([
      ...(plan.forbiddenPatterns || []),
      ...(plan.layoutStrategy?.avoidPatterns || []),
      ...(plan.assetStrategy?.avoidAssets || []),
      ...(plan.motionStrategy?.avoidMotion || []),
    ], 10);
    // Drop any GENERIC anti-template default the user EXPLICITLY asked for (explicit intent
    // overrides generic defaults). Plan-derived forbids stay — they are business requirements,
    // not generic staples.
    const genericFallbacks = GENERIC_FALLBACKS.filter((f) => !isExplicitlyRequested(f, explicit));
    const forbiddenPatterns = cleanList([...planForbids, ...genericFallbacks], MAX_LIST);

    const creativeFreedom = cleanList([
      'exact copy wording (kept truthful and specific)',
      'micro-interactions and hover states',
      'the internal layout within each required section',
      'palette refinement within the chosen visual direction',
    ], 6);

    // PR #522 — compile the Brand Design System and NEST it inside the contract (one BINDING
    // sub-section). Only active when its own flag is on; undefined ⇒ the contract is unchanged.
    const brandDesignSystem = isBrandDesignSystemEnabled()
      ? compileBrandDesignSystem(plan, { spec, explicitRequest })
      : undefined;

    return {
      version: 'generation-contract-v1',
      entryRequirement: cap(entryRequirement),
      heroRequirement: cap(heroRequirement),
      dominantFirstViewportElement: cap(dominant),
      requiredProof,
      requiredVisualMedia,
      requiredInteractions,
      requiredSections: cleanList(plan.sectionSequence, MAX_LIST),
      forbiddenPatterns,
      creativeFreedom,
      ...(brandDesignSystem ? { brandDesignSystem } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Render the binding contract as a concise, imperative prompt block for the frontend_builder
 * request. Returns "" when no contract — so the request is unchanged. No scores/reasoning.
 */
export function renderGenerationContractBlock(contract: FrontendGenerationContract | undefined): string {
  if (!contract || contract.version !== 'generation-contract-v1') return '';
  const lines = [
    'GENERATION CONTRACT — BINDING (obey exactly; this is a contract, not optional inspiration):',
    `- First viewport: ${contract.entryRequirement}`,
    `- Dominant first-viewport element: ${contract.dominantFirstViewportElement}.`,
    `- ${contract.heroRequirement}`,
  ];
  if (contract.requiredProof.length) lines.push(`- Required proof (must be visible + business-specific, never decorative): ${contract.requiredProof.join('; ')}.`);
  if (contract.requiredVisualMedia.length) lines.push(`- Required visual media (genuine, not decorative substitutes): ${contract.requiredVisualMedia.join('; ')}.`);
  if (contract.requiredInteractions.length) lines.push(`- Required interactions: ${contract.requiredInteractions.join('; ')}.`);
  if (contract.requiredSections.length) lines.push(`- Respect this section sequence: ${contract.requiredSections.join(' → ')}.`);
  lines.push(`- FORBIDDEN (do NOT use unless the user request explicitly asks for it): ${contract.forbiddenPatterns.join('; ')}.`);
  lines.push(`- Creative freedom: ${contract.creativeFreedom.join('; ')}.`);
  lines.push('- Use motion only to explain state/transitions, never as decorative filler.');
  // PR #522 — the Brand Design System rides as ONE nested sub-section of THIS contract (never a
  // second competing block). Empty string when absent ⇒ the block is byte-for-byte unchanged.
  const brandBlock = renderBrandDesignSystemBlock(contract.brandDesignSystem);
  if (brandBlock) { lines.push(''); lines.push(brandBlock); }
  return lines.join('\n');
}

/* ── Deterministic static enforcement ─────────────────────────────────────────*/
export interface ContractFinding {
  code: string;
  severity: FrontendBuilderReviewSeverity;
  message: string;
  repairInstruction: string;
}

const norm = (v: string): string => (v || '').toLowerCase();
const count = (re: RegExp, hay: string): number => (hay.match(re) || []).length;

/* Files that plausibly hold the app's ROOT render — where source order can reflect render order. */
const ENTRY_FILE_RE = /(^|\/)(App|main|index|Root|Page|Home)\.(t|j)sx?$/i;
/** JSX tag for a custom (PascalCase) component — its markup lives in ANOTHER file, so its
 *  presence before any inline first-viewport structure means source order ≠ rendered order. */
const CUSTOM_COMPONENT_RE = /<[A-Z][A-Za-z0-9]*[\s/>]/;

/**
 * Resolve the first-viewport source ONLY when the render order is strongly evidenced from a
 * single repository-native entry file — i.e. the entry inlines its first structural container
 * (`<section>`/`<header>`/`<main>`/`<h1>`/`<img>`) before rendering any child component. When the
 * page is composed of child components split across files (a `<Hero/>` rendered before any inline
 * markup), source order does NOT reveal what the browser paints first, so evidence is WEAK and we
 * defer to the existing rendered-DOM evaluation instead of guessing from arbitrary file order.
 */
function resolveFirstViewport(files: FrontendGeneratedFile[]): { strong: boolean; firstSection: string } {
  const entry = files.find((f) => ENTRY_FILE_RE.test(f.path))
    || files.find((f) => /export\s+default/.test(f.content) && /<[A-Za-z]/.test(f.content))
    || files[0];
  const content = entry?.content || '';
  if (!content) return { strong: false, firstSection: '' };
  const structural = content.search(/<(section|header|main)\b/i);
  const headline = content.search(/<h1\b/i);
  const img = content.search(/<img\b/i);
  const custom = content.search(CUSTOM_COMPONENT_RE);
  const inlineStarts = [structural, headline, img].filter((i) => i >= 0);
  if (inlineStarts.length === 0) return { strong: false, firstSection: '' }; // pure composition
  const firstInline = Math.min(...inlineStarts);
  // A child component rendered before the first inline structure owns the true first viewport.
  if (custom >= 0 && custom < firstInline) return { strong: false, firstSection: '' };
  const start = structural >= 0 && structural <= firstInline ? structural : firstInline;
  return { strong: true, firstSection: content.slice(start, start + 1800) };
}

/* ── Motion enforcement ───────────────────────────────────────────────────────
 * The plan/spec can genuinely REQUIRE motion (composed Motion-Composer layers, or a non-static
 * motion strategy). The other contract checks prove layout/hero/proof/imagery but NOT that the
 * planned motion was actually implemented — so a site can claim motion readiness in diagnostics
 * yet render static. These bounded, deterministic helpers close that gap: they resolve the
 * requirement ONLY from the authoritative plan + sanitized spec, then look for STRONG executable
 * evidence in the generated source (never comments, planning text, imports or dependency names).
 */
type MotionRequirementLevel = 'none' | 'micro' | 'composed';
interface MotionRequirement {
  required: boolean;
  level: MotionRequirementLevel;
  reducedMotionExpected: boolean;
  summary: string;   // bounded, PLAN-derived label only (never source / prompt / PII)
}
const _NONE_MOTION: MotionRequirement = { required: false, level: 'none', reducedMotionExpected: false, summary: '' };

/** Pattern/level tokens that mean "no motion" — never a requirement. */
const MOTION_NONE_TOKEN_RE = /^(none|static|instant|off)$/;

/**
 * Decide whether the AUTHORITATIVE plan/spec genuinely requires motion, and at what level.
 * Sources: `spec.assets.motionLayers` (the sanitized Motion-Composer projection) and
 * `plan.motionStrategy` (motionLevel / interactionStyle / heroMotion). Deliberately static /
 * minimal / reduced-motion plans, empty layer arrays and `none` patterns produce NO requirement.
 * Pure + fail-open.
 */
function resolveMotionRequirement(
  plan: ExperienceArchitecturePlan,
  spec: FrontendBuildSpecification | undefined,
): MotionRequirement {
  try {
    const ms = plan.motionStrategy;

    // Explicit static / reduced-motion / no-animation intent → never a motion requirement.
    if (norm(s(plan.signature?.interactionPattern)) === 'minimal_static') return _NONE_MOTION;
    const directives = [
      ...(ms?.userDirectives || []), ...(plan.userDirectives || []),
      ...(plan.signature?.userDirectives || []),
    ].join(' ').toLowerCase();
    if (/no animation|no motion|without animation|reduce[d]? motion|prefers-reduced|static (only|site|page|layout)|minimal motion/.test(directives)
      || (ms?.avoidMotion || []).some((a) => /\ball\b|\bany\b|\bevery\b|no motion|no animation/i.test(s(a)))) {
      return _NONE_MOTION;
    }

    // Authoritative composed layers from the sanitized spec (preferred, concrete source).
    const specLayers = Array.isArray(spec?.assets?.motionLayers) ? spec!.assets.motionLayers : [];
    const meaningfulLayers = specLayers.filter((l) => {
      const p = norm(s(l?.pattern));
      const i = norm(s(l?.intensity));
      return !!l && !!p && !MOTION_NONE_TOKEN_RE.test(p) && i !== 'none';
    });

    // Plan-level motion strategy signal (present only when motion intelligence ran).
    const motionLevel = norm(s(ms?.motionLevel));            // '' | none | subtle | moderate | immersive
    const interactionStyle = norm(s(ms?.interactionStyle));  // static | hover | scroll_reveal | parallax | cinematic | interactive
    const heroMotion = norm(s(ms?.heroMotion));              // none | fade | slow_zoom | video_motion | interactive
    const strategyRequiresMotion = !!motionLevel && motionLevel !== 'none'
      && !!interactionStyle && interactionStyle !== 'static';

    const intent = readIntent(plan);
    // Required only when the plan genuinely composed motion. A soft-minimal plan with NO composed
    // layers is never forced into decorative animation.
    const required = meaningfulLayers.length > 0
      || (strategyRequiresMotion && !(intent.minimal && meaningfulLayers.length === 0));
    if (!required) return _NONE_MOTION;

    // Structural (composed) vs micro-interaction-only. Any composed layer is structural motion;
    // otherwise a moderate/immersive level, a scroll/parallax/cinematic/interactive style, or a
    // structural hero motion is composed. A subtle + hover-only strategy is micro.
    const structuralTargets = new Set<string>();
    for (const l of meaningfulLayers) {
      const t = norm(s(l.target));
      if (t === 'hero') structuralTargets.add('hero');
      else if (t === 'global') structuralTargets.add('global');
      else if (t.startsWith('section:')) structuralTargets.add('section');
    }
    const structuralStrategy = motionLevel === 'moderate' || motionLevel === 'immersive'
      || /scroll_reveal|parallax|cinematic|interactive/.test(interactionStyle)
      || /slow_zoom|video_motion|interactive/.test(heroMotion);
    const composed = meaningfulLayers.length > 0 || structuralStrategy;
    const level: MotionRequirementLevel = composed ? 'composed' : 'micro';
    const targetLabels = structuralTargets.size ? [...structuralTargets] : (composed ? ['hero'] : ['micro-interaction']);
    return {
      required: true,
      level,
      reducedMotionExpected: composed,
      summary: composed
        ? `composed structural motion (${targetLabels.slice(0, 4).join(', ')})`
        : 'micro-interaction motion (hover/focus/tap/state)',
    };
  } catch {
    return _NONE_MOTION;
  }
}

interface MotionEvidence { composed: boolean; micro: boolean; reducedMotion: boolean; }

/** Remove comments so a comment mentioning "animation"/"motion"/a class name can never count as
 *  implementation proof. Bounded, best-effort — strips block and line comments (incl. `{/* … *​/}`). */
function stripMotionComments(src: string): string {
  try {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, ' ')       // block comments (also the inner of {/* … */})
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');  // line comments (the `[^:]` guard skips `://` URLs)
  } catch {
    return src;
  }
}

/**
 * STRONG, deterministic evidence that motion was actually IMPLEMENTED in the generated source —
 * executable usage only, never comments / imports / dependency names / planning text. Bounded
 * (scans a capped, comment-stripped blob). Pure + fail-open.
 */
function detectMotionEvidence(files: FrontendGeneratedFile[]): MotionEvidence {
  try {
    const code = stripMotionComments(files.map((f) => f.content).join('\n')).slice(0, 200000);

    // Framer Motion, MEANINGFULLY used: imported AND a motion element/AnimatePresence AND a real
    // animation prop. Importing framer-motion without using it never counts.
    const importsFramer = /from\s+['"]framer-motion['"]/.test(code);
    const motionEl = /<motion\.[a-z][a-zA-Z0-9]*/.test(code) || /<AnimatePresence[\s/>]/.test(code);
    const framerAnimProp = /\b(initial|animate|whileInView|whileHover|whileTap|whileFocus|variants|exit)\s*=/.test(code)
      || /\blayout(Id)?\s*[=}]/.test(code) || /\btransition\s*=\s*\{/.test(code);
    const framerMeaningful = importsFramer && motionEl && framerAnimProp;
    const framerStructural = framerMeaningful && /\b(whileInView|variants|animate|exit)\s*=|<AnimatePresence[\s/>]|\blayout(Id)?\s*[=}]/.test(code);
    const framerMicro = framerMeaningful && /\b(whileHover|whileTap|whileFocus)\s*=/.test(code);

    // CSS @keyframes ACTUALLY applied: a defined keyframe name referenced by an `animation(-name)`
    // declaration, or a Tailwind arbitrary `animate-[…name…]` utility. Unused @keyframes do not count.
    const kf = new Set<string>();
    for (const m of code.matchAll(/@keyframes\s+([A-Za-z_][\w-]*)/g)) kf.add(m[1].toLowerCase());
    let keyframesApplied = false;
    if (kf.size) {
      const low2 = code.toLowerCase();
      for (const m of low2.matchAll(/animation(?:-name)?\s*:\s*([^;{}]+)[;}]/g)) {
        if ([...kf].some((n) => m[1].includes(n))) { keyframesApplied = true; break; }
      }
      if (!keyframesApplied) keyframesApplied = [...kf].some((n) => new RegExp(`animate-\\[[^\\]]*${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(code));
    }

    // Canvas rAF animation.
    const canvasRaf = /requestAnimationFrame\s*\(/.test(code) && /getContext\(\s*['"](2d|webgl2?)['"]/.test(code);

    // State-driven structural motion: useState/useReducer combined with transform/opacity/height
    // transitions, or an IntersectionObserver scroll reveal.
    const stateMotion = (/\buse(State|Reducer)\s*\(/.test(code)
      && /(translate|-translate|opacity-0|opacity-100|scale-\d|rotate-\d|transition-transform|transition-all|max-h-0|max-h-\[)/i.test(code))
      || /IntersectionObserver/.test(code);

    // Applied Tailwind animation utilities INSIDE a className attribute (comments already stripped).
    // A custom arbitrary keyframe utility is structural; built-in spin/bounce/ping is only micro;
    // skeleton `animate-pulse` never counts.
    const classAttr = (re: RegExp): boolean => re.test(code);
    const appliedCustomAnim = classAttr(/class(?:Name)?\s*=\s*(["'`])(?:(?!\1)[\s\S]){0,600}?\banimate-\[[^\]]+\]/i);
    const appliedBuiltinAnim = classAttr(/class(?:Name)?\s*=\s*(["'`])(?:(?!\1)[\s\S]){0,600}?\banimate-(?!pulse\b)(spin|bounce|ping)\b/i);

    // Micro-interaction: hover/focus/tap/active that TRANSFORMS (not `transition-colors` alone).
    const microTailwind = /\b(hover:scale-|hover:-?translate-|hover:rotate-|group-hover:(?:scale|translate|rotate)|active:scale-|focus(?:-visible)?:scale-|transition-transform)/i.test(code);

    const composed = framerStructural || keyframesApplied || canvasRaf || stateMotion || appliedCustomAnim;
    const micro = composed || framerMicro || microTailwind || appliedBuiltinAnim;
    const reducedMotion = /prefers-reduced-motion/i.test(code) || /\buseReducedMotion\b/.test(code) || /\bmotion-reduce:/.test(code);
    return { composed, micro, reducedMotion };
  } catch {
    return { composed: false, micro: false, reducedMotion: false };
  }
}

/**
 * Deterministic static checks of generated source against the contract. Only STRONG evidence
 * yields major/blocker; intentionally minimal / typography-first / app-first sites are not
 * penalised (no false positives). Pure + fail-open — returns [] on any problem.
 *
 * `explicitRequest` is the user's ORIGINAL request (bounded): a pattern they explicitly asked
 * for (e.g. a pricing or testimonials section) is not flagged as unrequested.
 *
 * `spec` is the authoritative sanitized FrontendBuildSpecification (optional for backward
 * compatibility): it supplies the composed motion layers used by the motion-enforcement check.
 */
export function evaluateContractCompliance(
  files: FrontendGeneratedFile[] | undefined,
  plan: ExperienceArchitecturePlan | undefined,
  explicitRequest?: string,
  spec?: FrontendBuildSpecification,
): ContractFinding[] {
  try {
    if (!plan || plan.version !== 'experience-arch-v1') return [];
    if (!Array.isArray(files) || files.length === 0) return [];
    const intent = readIntent(plan);
    const blob = files.map((f) => f.content).join('\n');
    const low = norm(blob);
    // First-viewport evidence: strong only when a single entry file inlines the first render
    // (see resolveFirstViewport). Weak evidence ⇒ empty firstSection ⇒ no first-viewport findings.
    const fv = resolveFirstViewport(files);
    const firstSection = fv.firstSection;
    const firstLow = norm(firstSection);
    const out: ContractFinding[] = [];
    // Explicit intent from the REAL request + directives (never experienceType alone).
    const requested = `${explicitRequestText(explicitRequest, plan)} ${norm(s(plan.experienceType))}`.trim();

    const productFirst = /product-first|interactive-demo/.test(plan.entryPattern || '')
      || plan.heroContentPriority === 'interaction' || plan.heroContentPriority === 'product_ui';
    const interactiveMarkers = /(usestate|onclick|onchange|<button\b|<input\b|<textarea\b|role=["']tab)/;

    // 1. Generic headline-first fallback against a product-first plan. Emitted ONLY on strong
    //    render-order evidence; a split multi-file composition defers to rendered DOM evaluation.
    if (fv.strong && productFirst && /<h1\b/i.test(firstSection) && !interactiveMarkers.test(firstLow) && !/<img\b/i.test(firstSection)) {
      out.push({
        code: 'contract-headline-first-vs-product-first', severity: 'major',
        message: 'The plan is product-first/interactive, but the first viewport is a text headline with no functional product experience.',
        repairInstruction: 'Reduce headline dominance and make the first viewport a real functional product/interactive demo (state, inputs, or product UI) — not a marketing headline.',
      });
    }

    // 2. Hero generated despite heroPattern none.
    if ((plan.heroContentPriority === 'none' || /no hero/i.test(plan.heroPattern || ''))
      && /class(name)?=["'][^"']*min-h-screen[^"']*["'][\s\S]{0,400}<h1\b/i.test(blob)) {
      out.push({
        code: 'contract-hero-when-none', severity: 'major',
        message: 'The plan requires no hero, but a full-screen headline hero was generated.',
        repairInstruction: 'Remove the invented hero; open directly into the intended experience.',
      });
    }

    // 3. Marketing landing despite landingRequired false.
    if (plan.landingRequired === false && /(pricing|testimonial|trusted by|start your free trial)/.test(low) && /<h1\b/i.test(firstSection)) {
      out.push({
        code: 'contract-marketing-landing-when-app-first', severity: 'major',
        message: 'The plan sets landingRequired=false, but a marketing landing page (hero + pricing/testimonials) was generated.',
        repairInstruction: 'Replace the marketing landing with the application/product experience the plan requires.',
      });
    }

    // 4. Prohibited three-card feature stack (only when forbidden AND not minimal).
    const cardLike = count(/rounded-(xl|2xl|3xl)[^"']*border[^"']*p-[4-8]/g, low);
    if (!intent.minimal && /grid-cols-3/.test(low) && cardLike >= 3
      && (plan.forbiddenPatterns || []).some((f) => /feature|card|template/i.test(f))) {
      out.push({
        code: 'contract-generic-feature-cards', severity: 'major',
        message: 'A generic three-identical-card features section is present, which the plan forbids.',
        repairInstruction: 'Replace the identical feature-card trio with substantive, differentiated content specific to the business.',
      });
    }

    // 5. Automatic pricing/testimonials/final-CTA absent from the plan and not requested.
    for (const [pat, re] of [
      ['pricing', /\bpricing\b/], ['testimonials', /\btestimonial/], ] as Array<[string, RegExp]>) {
      const inPlan = (plan.sectionSequence || []).some((id) => re.test(norm(id)));
      if (!inPlan && !re.test(requested) && re.test(low)) {
        out.push({
          code: `contract-auto-${pat}`, severity: 'minor',
          message: `An automatic ${pat} section was added although the plan and request did not call for it.`,
          repairInstruction: `Remove the unrequested ${pat} section (or replace it with a section the plan actually requires).`,
        });
      }
    }

    // 6. Missing required visual medium (photography expected but no real imagery).
    if (!intent.minimal && intent.expectsImages && !/<img\b/i.test(blob)) {
      out.push({
        code: 'contract-missing-required-medium', severity: 'major',
        message: 'The plan requires real photography, but no real imagery is rendered.',
        repairInstruction: 'Render the planned image slots as real <img> elements; do not substitute decorative SVG/gradients.',
      });
    }

    // 7. Decorative-as-proof / missing required proof markers.
    for (const c of (plan.sectionContracts || [])) {
      if (!c.proofRequirement) continue;
      const tok = norm(c.id).replace(/[^a-z0-9]+/g, '');
      if (!tok) continue;
      const at = low.indexOf(tok);
      if (at < 0) continue;
      const win = norm(blob.slice(at, at + 2200));
      const skeleton = /(animate-pulse|skeleton|placeholder-bar)/.test(win);
      const realEvidence = /(<img\b|\d|<button\b|<input\b|<table\b|aria-label|recharts)/.test(win);
      if (skeleton || !realEvidence) {
        out.push({
          code: 'contract-decorative-proof', severity: 'major',
          message: `Section "${c.id}" must show real proof, but it appears decorative (skeleton/SVG, no concrete evidence).`,
          repairInstruction: `Render the real proof for "${c.id}" (real numbers, product UI, image or data) — decorative visuals do not satisfy a proof requirement.`,
        });
      }
    }

    // 8. Default AI neon/purple aesthetic when forbidden (and not requested).
    const forbidsPurpleNeon = (plan.forbiddenPatterns || []).some((f) => /neon|cyberpunk|purple|futuristic/i.test(f))
      || (plan.assetStrategy?.avoidAssets || []).some((f) => /neon|cyberpunk|purple/i.test(f));
    if (forbidsPurpleNeon && !/neon|purple|cyberpunk|futuristic/.test(requested)
      && (count(/#(a855f7|7c3aed|8b5cf6|6d28d9|9333ea)/g, low) + count(/\b(violet|fuchsia|purple)-[3-9]00\b/g, low)) >= 3) {
      out.push({
        code: 'contract-default-purple-neon', severity: 'minor',
        message: 'A default dark-purple / neon AI aesthetic is used although the plan forbids it and the request did not ask for it.',
        repairInstruction: 'Use the palette from the plan’s visual direction; avoid the generic purple/neon AI look.',
      });
    }

    // 9. PR #522 — Brand Design System conservative checks (central token source, hardcoded-colour
    //    inconsistency, excessive cards vs card policy, radius vs shape policy). Only active when the
    //    brand flag is on; STRONG evidence only; extends THIS validator (never a second one).
    if (isBrandDesignSystemEnabled()) {
      const system = compileBrandDesignSystem(plan, { explicitRequest });
      if (system) {
        const ex = readExplicitDesign(requested);
        out.push(...evaluateBrandDesignCompliance(files, system, ex));
      }
    }

    // 10. Required motion not implemented. When the authoritative plan/spec genuinely requires
    //     motion but the generated source shows no credible executable evidence, emit a bounded
    //     MAJOR finding so the EXISTING single repair implements the planned motion. A structural
    //     requirement is NOT satisfied by a lone button hover; a micro requirement accepts credible
    //     hover/tap/focus/state evidence. Evidence never includes comments, imports or planning
    //     text. Purely static source evidence — no claim of visual/runtime verification.
    const motionReq = resolveMotionRequirement(plan, spec);
    if (motionReq.required) {
      const ev = detectMotionEvidence(files);
      const satisfied = motionReq.level === 'micro' ? (ev.micro || ev.composed) : ev.composed;
      if (!satisfied) {
        out.push({
          code: 'contract-missing-required-motion', severity: 'major',
          message: `The authoritative motion plan requires ${motionReq.summary}, but the generated source shows no executable ${motionReq.level === 'composed' ? 'structural' : 'interaction'} motion (imports, comments and class names in text do not count).`,
          repairInstruction: `Implement the planned ${motionReq.summary} purposefully — bounded Framer Motion (motion.* with initial/animate/whileInView/variants), applied CSS @keyframes, or state-driven reveal/interaction tied to the planned experience. Preserve the existing copy and layout intent, keep motion subtle, do NOT scatter decorative animation, and respect prefers-reduced-motion.`,
        });
      } else if (motionReq.reducedMotionExpected && !ev.reducedMotion) {
        // Motion IS implemented but no reduced-motion protection is present. One bounded
        // accessibility finding WITHIN the motion objective (not a general a11y refactor).
        out.push({
          code: 'contract-motion-missing-reduced-motion', severity: 'minor',
          message: 'Required structural motion is implemented, but no prefers-reduced-motion protection was found in the generated source.',
          repairInstruction: 'Add a reduced-motion guard for the implemented motion (a prefers-reduced-motion media query, Tailwind motion-reduce: variants, or Framer useReducedMotion) so the animation degrades to a static/subtle fallback.',
        });
      }
    }

    return out;
  } catch {
    return [];
  }
}

/* Map a contract finding → an EXISTING review category so it rides the existing repair. */
function categoryFor(code: string): FrontendBuilderReviewCategory {
  // PR #522 — brand design-system findings map to existing categories (distinct where possible so
  // a card/radius finding is not shadowed by a palette one).
  if (code.startsWith('brand-')) {
    if (code.includes('card')) return 'component-composition';
    if (code.includes('radius')) return 'layout-rhythm';
    return 'palette-and-surfaces';   // central-tokens / hardcoded-colours
  }
  // Motion enforcement → the dedicated existing categories (distinct so a motion finding is never
  // shadowed by a same-category contract-fidelity finding during the category dedup).
  if (code.includes('reduced-motion')) return 'accessibility-intent';
  if (code.includes('motion')) return 'motion-and-interaction';
  if (code.includes('headline-first') || code.includes('hero') || code.includes('landing')) return 'concept-drift';
  if (code.includes('feature-cards') || code.includes('auto-')) return 'generic-template';
  if (code.includes('medium') || code.includes('proof')) return 'contract-fidelity';
  if (code.includes('purple') || code.includes('neon')) return 'palette-and-surfaces';
  return 'contract-fidelity';
}

const SEVERITY_RANK: Record<FrontendBuilderReviewSeverity, number> = { blocker: 0, major: 1, minor: 2 };

/**
 * Convert contract findings → review issues for the EXISTING bounded repair. Dedups by
 * category (mergeDeterministicIssues also dedups), so this never duplicates the model reviewer.
 * Findings are ordered by severity first, so a MAJOR finding is never shadowed by a same-category
 * MINOR (e.g. a brand central-token major vs a purple-neon minor).
 */
export function contractFindingsToReviewIssues(findings: ContractFinding[]): FrontendBuilderReviewIssue[] {
  const out: FrontendBuilderReviewIssue[] = [];
  const seen = new Set<FrontendBuilderReviewCategory>();
  const ordered = [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  for (const f of ordered) {
    const category = categoryFor(f.code);
    if (seen.has(category)) continue;
    seen.add(category);
    out.push({
      id: `contract:${f.code}`.slice(0, 80),
      severity: f.severity,
      category,
      files: [],
      evidence: `Generation contract: ${f.message}`.slice(0, 240),
      repairInstruction: f.repairInstruction.slice(0, 240),
    });
  }
  return out;
}

export { buildGenerationContract as _buildGenerationContract };
