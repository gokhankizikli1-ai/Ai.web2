/* ────────────────────────────────────────────────────────────────────────────
 * webBuildMotionExecution.ts — MOTION VISUAL EXECUTION (concept → executable code)
 *
 * The three prior layers DIRECT motion but do not EXECUTE it:
 *   • visualConcept      → motion vocabulary (which techniques) + signature visual
 *   • experienceIdentity → product story + demonstration INTENT + micro-motifs
 *   • experienceQuality  → reduced-motion / performance / interaction ACCEPTANCE
 * A strong "living data field resolving into a plan" concept can still be built as a
 * gradient with three floating cards and a universal fade-up. This layer converts the
 * existing intent into a technically-achievable, product-specific IMPLEMENTATION plan:
 * a technique family, an implementation medium (CSS / SVG / SVG+React state /
 * framer-motion / chart lib), a scene layer model, choreography, meaningful state
 * linkage, responsive simplification, a reduced-motion equivalent, a performance
 * budget, a fallback, and anti-slop exclusions — plus a hero blueprint and (when a
 * demonstration is required) an animated-demo plan.
 *
 * COMPOSES the two contracts (no new model/network call). Additive & optional; fails
 * open. Reuses experienceQuality's ONE JSX scanner for acceptance.
 *
 * OWNERSHIP BOUNDARY (translate, never duplicate):
 *   • which motion techniques / signature visual  → visualConcept (we map → medium/choreography)
 *   • product story / demonstration intent         → experienceIdentity (we map → executable demo)
 *   • reduced-motion + perf + interaction acceptance→ experienceQuality (we never re-check those)
 *   • colour/type/surface tokens                    → visualSystem
 * We add: implementation medium, scene layers, choreography, state linkage, responsive
 * simplification, reduced-motion EQUIVALENT (concrete final frame), performance budget,
 * fallback, hero execution blueprint, animated-demo plan, and anti-slop execution rules.
 *
 * Pure: no Date/Math.random/network/import(); JSON-safe; hard-bounded throughout.
 * ──────────────────────────────────────────────────────────────────────────── */
import type {
  FrontendSpecIdentity,
  FrontendGeneratedFile,
  FrontendBuilderReviewSeverity,
  FrontendBuilderReviewIssue,
  FrontendBuilderReviewCategory,
} from '@/lib/webBuildAgents';
import {
  classifyVisualCategory, type VisualCategory, type VisualConceptContract,
  type SignatureHeroFamily,
} from '@/lib/webBuildVisualConcept';
import type { ExperienceIdentityContract, DemonstrationPattern } from '@/lib/webBuildExperienceIdentity';
import { collectSectionUnits } from '@/lib/webBuildSectionSource';
import { factsFor, type SectionFacts } from '@/lib/webBuildExperienceQuality';

/* ── Bounds ───────────────────────────────────────────────────────────────── */
const MAX_TEXT = 140;
const MAX_LIST = 8;
const MAX_ISSUES = 14;
const MAX_ISSUE_FILES = 4;
const MAX_EVIDENCE = 180;
const MAX_SCAN = 24_000;
const RENDER_CHAR_CEILING = 2200;   // documented hard ceiling — kept tight; references peer blocks

/* ── Public vocabulary ────────────────────────────────────────────────────── */
export type MotionTechniqueFamily =
  | 'svg-path-flow' | 'svg-node-graph' | 'mask-reveal' | 'clip-path-transform' | 'layered-parallax'
  | 'progress-construction' | 'animated-data-field' | 'card-convergence' | 'before-after-reveal'
  | 'state-driven-workspace' | 'timeline-progression' | 'orbital-relationship' | 'particle-lite-flow'
  | 'material-light-sweep' | 'image-depth-composition' | 'scroll-linked-story' | 'input-reactive-viz'
  | 'diagram-build-sequence' | 'typographic-motion';

export type ImplementationMedium =
  | 'css-only' | 'svg-css' | 'svg-react-state' | 'framer-motion' | 'chart-library'
  | 'dom-transforms' | 'mask-clip-path' | 'image-layering' | 'canvas-lite';

export type HeroBlueprintFamily =
  | 'living-data-field' | 'animated-workflow' | 'spatial-product-theatre' | 'layered-editorial-scene'
  | 'cinematic-image-depth' | 'interactive-simulator' | 'diagrammatic-intelligence' | 'product-workspace'
  | 'transformation-sequence' | 'technical-system-map' | 'typographic-motion-hero' | 'environmental-narrative'
  | 'material-object-reveal' | 'before-after-scene';

export type StateLinkage =
  | 'user-input' | 'selected-tab' | 'calculator-values' | 'hover-focus' | 'progress' | 'scroll'
  | 'loading' | 'success' | 'comparison-selection' | 'static-narrative-timing';

export type DepthPattern =
  | 'editorial-layering' | 'spatial-theatre' | 'technical-plane-stack' | 'atmospheric-image-depth'
  | 'product-workspace-depth' | 'material-close-up' | 'diagram-layers' | 'typographic-depth';

export type SceneLayer =
  | 'background-atmosphere' | 'structural-frame' | 'primary-subject' | 'data-content'
  | 'foreground-accent' | 'interactive-control';

export interface Choreography {
  startCondition: string;
  sequence: string;
  durationRange: string;
  easing: string;
  loop: string;
  pause: string;
  interactionResponse: string;
  climax: string;
  settle: string;
}

export interface ResponsiveSimplification {
  desktop: string;
  tablet: string;
  mobile: string;
  remove: string[];
  keep: string[];
  touch: string;
}

export interface PerformanceBudget {
  maxContinuousAnimatedElements: number;
  forbiddenProperties: string[];   // layout-triggering / expensive
  preferProperties: string[];
  avoid: string[];
}

export interface AnimatedDemoPlan {
  required: boolean;
  userAction: string;
  changedState: string;
  visibleResult: string;
  transition: string;
  successFeedback: string;
  emptyErrorState: string;
  accessibility: string;
  keyboard: string;
  mobile: string;
  frontendOnlyBoundary: string;
  labelIllustrativeData: boolean;
}

export interface MotionExecutionContract {
  version: 'motion-execution-v1';
  status: 'derived' | 'legacy';
  category: VisualCategory;
  motionPurpose: string;                 // product-specific: what the animation communicates
  signatureSceneRequired: boolean;
  signatureSceneLocation: string;
  techniqueFamily: MotionTechniqueFamily;
  heroBlueprint: HeroBlueprintFamily;
  implementationMedium: ImplementationMedium;
  sceneLayers: SceneLayer[];
  depthPattern: DepthPattern;
  choreography: Choreography;
  stateLinkage: StateLinkage;
  responsive: ResponsiveSimplification;
  reducedMotionEquivalent: string;
  performanceBudget: PerformanceBudget;
  fallback: string;
  animatedDemo: AnimatedDemoPlan;
  forbiddenShortcuts: string[];
  antiSlopExclusions: string[];
  reasons: string[];
  /* ── Truthful consumption trace (mirrors peer contracts). ── */
  upstreamEvidenceUsedToDeriveContract: string[];
  contractPersistedInSpecification: boolean;
  contractRenderedToFrontendBuilder: boolean;
  contractUsedByAcceptance: boolean;
  agentsActuallyConsumingContract: string[];
}

export interface MotionExecutionInput {
  visualConcept?: VisualConceptContract;
  experienceIdentity?: ExperienceIdentityContract;
  identity?: Partial<FrontendSpecIdentity> & { category?: string; name?: string };
  heroSectionId?: string;
  prompt?: string;
}

/* ── Pure helpers ─────────────────────────────────────────────────────────── */
function clip(s: unknown, n = MAX_TEXT): string { return (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim().slice(0, n); }
function uniq<T>(a: T[]): T[] { return [...new Set(a)]; }
function capList<T>(a: T[] | undefined, n = MAX_LIST): T[] { return Array.isArray(a) ? a.slice(0, n) : []; }

/* ── Family selection (signature family + demonstration pattern → executable family) ── */
const FAMILY_TO_EXEC: Record<SignatureHeroFamily, MotionTechniqueFamily> = {
  'cinematic-full-bleed': 'image-depth-composition',
  'product-interface-theatre': 'state-driven-workspace',
  'editorial-split': 'layered-parallax',
  'layered-collage': 'mask-reveal',
  'living-data-field': 'animated-data-field',
  'visualized-workflow': 'svg-node-graph',
  'spatial-product-ecosystem': 'image-depth-composition',
  'interactive-simulator': 'input-reactive-viz',
  'typographic-environmental': 'typographic-motion',
  'photography-trust': 'image-depth-composition',
  'transformation-before-after': 'before-after-reveal',
  'diagrammatic-intelligence': 'diagram-build-sequence',
  'material-object': 'material-light-sweep',
  'ambient-3d-scene': 'layered-parallax',
};
const DEMO_TO_EXEC: Record<DemonstrationPattern, MotionTechniqueFamily | null> = {
  'input-to-output-transformation': 'state-driven-workspace',
  'scenario-calculator': 'input-reactive-viz',
  'guided-intake': 'progress-construction',
  'threat-flow-visualization': 'svg-path-flow',
  'product-detail-reveal': 'mask-reveal',
  'project-reveal': 'image-depth-composition',
  'spatial-atmosphere': 'image-depth-composition',
  'code-to-result-flow': 'state-driven-workspace',
  'quote-flow': 'progress-construction',
  'guided-learning-path': 'timeline-progression',
  'impact-forecast': 'animated-data-field',
  'in-app-flow': 'state-driven-workspace',
  'workflow-graph': 'svg-node-graph',
  'menu-exploration': 'mask-reveal',
  'work-showcase': 'image-depth-composition',
  'guided-overview': 'scroll-linked-story',
  none: null,
};
const CATEGORY_EXEC: Record<VisualCategory, MotionTechniqueFamily> = {
  'software-saas': 'state-driven-workspace', finance: 'input-reactive-viz', 'ecommerce-fashion': 'mask-reveal',
  architecture: 'image-depth-composition', 'hospitality-luxury': 'image-depth-composition', healthcare: 'progress-construction',
  education: 'timeline-progression', security: 'svg-path-flow', 'food-restaurant': 'mask-reveal',
  'portfolio-creative': 'image-depth-composition', 'developer-tool': 'state-driven-workspace', 'climate-energy': 'animated-data-field',
  'mobile-app': 'state-driven-workspace', 'b2b-enterprise': 'svg-node-graph', 'local-service': 'before-after-reveal', generic: 'scroll-linked-story',
};

const HERO_BLUEPRINT: Record<SignatureHeroFamily, HeroBlueprintFamily> = {
  'cinematic-full-bleed': 'cinematic-image-depth',
  'product-interface-theatre': 'product-workspace',
  'editorial-split': 'layered-editorial-scene',
  'layered-collage': 'layered-editorial-scene',
  'living-data-field': 'living-data-field',
  'visualized-workflow': 'animated-workflow',
  'spatial-product-ecosystem': 'spatial-product-theatre',
  'interactive-simulator': 'interactive-simulator',
  'typographic-environmental': 'typographic-motion-hero',
  'photography-trust': 'cinematic-image-depth',
  'transformation-before-after': 'before-after-scene',
  'diagrammatic-intelligence': 'diagrammatic-intelligence',
  'material-object': 'material-object-reveal',
  'ambient-3d-scene': 'environmental-narrative',
};

const EXEC_TO_MEDIUM: Record<MotionTechniqueFamily, ImplementationMedium[]> = {
  'svg-path-flow': ['svg-css', 'svg-react-state'],
  'svg-node-graph': ['svg-react-state', 'svg-css'],
  'mask-reveal': ['mask-clip-path', 'framer-motion'],
  'clip-path-transform': ['mask-clip-path', 'css-only'],
  'layered-parallax': ['framer-motion', 'dom-transforms'],
  'progress-construction': ['svg-react-state', 'framer-motion'],
  'animated-data-field': ['chart-library', 'svg-react-state'],
  'card-convergence': ['framer-motion', 'dom-transforms'],
  'before-after-reveal': ['mask-clip-path', 'svg-react-state'],
  'state-driven-workspace': ['svg-react-state', 'framer-motion'],
  'timeline-progression': ['framer-motion', 'svg-css'],
  'orbital-relationship': ['svg-css', 'framer-motion'],
  'particle-lite-flow': ['svg-css', 'canvas-lite'],
  'material-light-sweep': ['css-only', 'svg-css'],
  'image-depth-composition': ['image-layering', 'framer-motion'],
  'scroll-linked-story': ['framer-motion', 'css-only'],
  'input-reactive-viz': ['svg-react-state', 'chart-library'],
  'diagram-build-sequence': ['svg-react-state', 'svg-css'],
  'typographic-motion': ['framer-motion', 'css-only'],
};

const DEPTH_BY_CATEGORY: Record<VisualCategory, DepthPattern> = {
  'software-saas': 'product-workspace-depth', finance: 'technical-plane-stack', 'ecommerce-fashion': 'material-close-up',
  architecture: 'spatial-theatre', 'hospitality-luxury': 'atmospheric-image-depth', healthcare: 'editorial-layering',
  education: 'diagram-layers', security: 'technical-plane-stack', 'food-restaurant': 'material-close-up',
  'portfolio-creative': 'editorial-layering', 'developer-tool': 'product-workspace-depth', 'climate-energy': 'diagram-layers',
  'mobile-app': 'product-workspace-depth', 'b2b-enterprise': 'diagram-layers', 'local-service': 'editorial-layering', generic: 'editorial-layering',
};

/* ── Family grouping → choreography character ─────────────────────────────── */
type FamilyGroup = 'structural' | 'ambient' | 'reveal';
const STRUCTURAL: Set<MotionTechniqueFamily> = new Set(['svg-node-graph', 'diagram-build-sequence', 'progress-construction', 'timeline-progression', 'before-after-reveal', 'state-driven-workspace', 'input-reactive-viz', 'animated-data-field', 'svg-path-flow']);
const AMBIENT: Set<MotionTechniqueFamily> = new Set(['image-depth-composition', 'layered-parallax', 'material-light-sweep', 'orbital-relationship', 'particle-lite-flow', 'scroll-linked-story']);
function groupOf(f: MotionTechniqueFamily): FamilyGroup { return STRUCTURAL.has(f) ? 'structural' : AMBIENT.has(f) ? 'ambient' : 'reveal'; }

const SCENE_LAYERS_BY_FAMILY: Record<MotionTechniqueFamily, SceneLayer[]> = {
  'svg-path-flow': ['background-atmosphere', 'structural-frame', 'data-content'],
  'svg-node-graph': ['structural-frame', 'primary-subject', 'data-content', 'interactive-control'],
  'mask-reveal': ['background-atmosphere', 'primary-subject', 'foreground-accent'],
  'clip-path-transform': ['primary-subject', 'foreground-accent'],
  'layered-parallax': ['background-atmosphere', 'primary-subject', 'foreground-accent'],
  'progress-construction': ['structural-frame', 'data-content', 'interactive-control'],
  'animated-data-field': ['structural-frame', 'data-content', 'interactive-control'],
  'card-convergence': ['primary-subject', 'foreground-accent'],
  'before-after-reveal': ['primary-subject', 'interactive-control'],
  'state-driven-workspace': ['structural-frame', 'primary-subject', 'data-content', 'interactive-control'],
  'timeline-progression': ['structural-frame', 'data-content'],
  'orbital-relationship': ['background-atmosphere', 'primary-subject', 'data-content'],
  'particle-lite-flow': ['background-atmosphere', 'foreground-accent'],
  'material-light-sweep': ['primary-subject', 'foreground-accent'],
  'image-depth-composition': ['background-atmosphere', 'primary-subject', 'foreground-accent'],
  'scroll-linked-story': ['background-atmosphere', 'primary-subject', 'data-content'],
  'input-reactive-viz': ['structural-frame', 'data-content', 'interactive-control'],
  'diagram-build-sequence': ['structural-frame', 'primary-subject', 'data-content'],
  'typographic-motion': ['primary-subject', 'foreground-accent'],
};

function stateLinkageFor(pattern: DemonstrationPattern | undefined, family: MotionTechniqueFamily, demoRequired: boolean): StateLinkage {
  if (demoRequired && pattern) {
    switch (pattern) {
      case 'scenario-calculator': case 'impact-forecast': return 'calculator-values';
      case 'threat-flow-visualization': return 'comparison-selection';
      case 'product-detail-reveal': case 'menu-exploration': return 'selected-tab';
      case 'guided-intake': case 'quote-flow': case 'guided-learning-path': return 'progress';
      case 'input-to-output-transformation': case 'code-to-result-flow': case 'in-app-flow': case 'workflow-graph': return 'user-input';
      default: break;
    }
  }
  if (family === 'input-reactive-viz' || family === 'state-driven-workspace') return 'user-input';
  if (family === 'before-after-reveal') return 'comparison-selection';
  if (family === 'progress-construction' || family === 'timeline-progression' || family === 'animated-data-field') return 'progress';
  if (groupOf(family) === 'ambient') return 'scroll';
  if (family === 'typographic-motion') return 'static-narrative-timing';
  return 'scroll';
}

function choreographyFor(family: MotionTechniqueFamily, linkage: StateLinkage): Choreography {
  const g = groupOf(family);
  const interactive = linkage === 'user-input' || linkage === 'calculator-values' || linkage === 'selected-tab' || linkage === 'comparison-selection';
  if (g === 'structural') {
    return {
      startCondition: interactive ? 'on user input/selection (and an initial in-view build)' : 'when the scene scrolls into view (IntersectionObserver / whileInView)',
      sequence: 'staged: frame → nodes/points → connections/values resolve in order (short stagger, 40–90ms)',
      durationRange: '400–900ms per stage',
      easing: 'ease-out with a slight settle (no overshoot bounce)',
      loop: 'none — plays once and HOLDS the final informative state',
      pause: 'pause/skip when off-screen; never re-trigger on every scroll',
      interactionResponse: interactive ? 'each input re-runs only the affected stage and updates the rendered values' : 'hover/focus reveals a node’s detail',
      climax: 'the result, connection or resolved value lands',
      settle: 'hold the final state as a legible, static diagram/result',
    };
  }
  if (g === 'ambient') {
    return {
      startCondition: 'on mount for depth; scroll-linked for movement (useScroll / scroll progress)',
      sequence: 'layers move at different rates to create depth; foreground last',
      durationRange: 'slow — 4–12s subtle loops or bound to scroll progress',
      easing: 'linear or ease-in-out for calm motion',
      loop: 'subtle continuous OR scroll-bound (no abrupt restarts)',
      pause: 'respect reduced-motion; pause continuous loops off-screen',
      interactionResponse: 'gentle pointer/parallax response where appropriate (small, capped)',
      climax: 'the depth/atmosphere peak around mid-scroll',
      settle: 'a calm resting frame with full legibility of overlaid copy',
    };
  }
  return {
    startCondition: 'when the element scrolls into view (whileInView, once)',
    sequence: 'quick staged reveal via mask/clip-path; content in reading order',
    durationRange: '300–700ms',
    easing: 'ease-out',
    loop: 'none',
    pause: 'no continuous loop; single reveal',
    interactionResponse: 'hover/focus deepens the reveal or shows detail',
    climax: 'the subject/content is fully revealed',
    settle: 'the final composed, static layout',
  };
}

function responsiveFor(family: MotionTechniqueFamily): ResponsiveSimplification {
  const g = groupOf(family);
  if (g === 'structural') {
    return {
      desktop: 'the full staged build with all nodes/points and interactive controls',
      tablet: 'fewer nodes/points; keep the core sequence and the primary control',
      mobile: 're-compose vertically: a compact, tappable version of the same diagram/result',
      remove: ['secondary nodes/points', 'hover-only detail', 'decorative accents'],
      keep: ['the primary subject', 'the resolved result/value', 'the primary control'],
      touch: 'controls are ≥44px, tap-driven; no hover-only affordances',
    };
  }
  if (g === 'ambient') {
    return {
      desktop: 'multi-layer parallax/depth with scroll-linked movement',
      tablet: 'reduce parallax layers; keep image depth and masks',
      mobile: 'largely static composed depth (1–2 layers), scroll-linked movement minimized',
      remove: ['extra depth layers', 'pointer-parallax', 'continuous loops'],
      keep: ['the hero image/subject', 'the composed framing', 'legible overlaid copy'],
      touch: 'no pointer-parallax on touch; a single tap/scroll reveal is enough',
    };
  }
  return {
    desktop: 'the full mask/clip reveal with staged content',
    tablet: 'same reveal, slightly faster/simpler stagger',
    mobile: 'a single quick reveal (or instant) with the same final layout',
    remove: ['multi-step stagger', 'decorative accents'],
    keep: ['the revealed subject/content', 'the final layout'],
    touch: 'reveal on scroll-in; no hover dependency',
  };
}

function performanceBudget(family: MotionTechniqueFamily): PerformanceBudget {
  const ambient = groupOf(family) === 'ambient';
  return {
    maxContinuousAnimatedElements: ambient ? 6 : 3,
    forbiddenProperties: ['top', 'left', 'right', 'bottom', 'width', 'height', 'margin'],
    preferProperties: ['transform', 'opacity', 'clip-path', 'stroke-dashoffset', 'background-position'],
    avoid: ['animated blur / backdrop-filter', 'large DOM particle fields', 'layout-thrashing animation', 'autoplay video (unless explicitly requested)', 'giant inline data'],
  };
}

const CATEGORY_ANTISLOP: Partial<Record<VisualCategory, string[]>> = {
  'software-saas': ['a floating dashboard that only fades up', 'orbiting particles with no data meaning'],
  finance: ['a decorative chart animating fake numbers', 'a glowing gradient blob as the "data"'],
  security: ['green matrix rain', 'a pulsing shield icon as the whole scene'],
  'developer-tool': ['an infinite-spinning logo', 'a fake terminal that never changes'],
  'hospitality-luxury': ['a spinning icon over a photo', 'aggressive parallax that fights the imagery'],
  architecture: ['a blurred blob behind the building photo', 'card hover-lift on gallery items'],
  'ecommerce-fashion': ['a bouncing “new” badge', 'every product card lifting on hover'],
  healthcare: ['a fast pulsing animation', 'an animated fake statistic'],
  'climate-energy': ['a spinning globe', 'animated numbers that are not real'],
  'b2b-enterprise': ['three glass cards floating up', 'an orbiting particle field'],
};
const UNIVERSAL_ANTISLOP = [
  'a universal fade-up applied to every element',
  'infinite bounce/spin/pulse used as decoration',
  'random glowing lines or an unrelated orb',
  'motion with no visible state or relationship change',
];

const EXEC_TO_BLUEPRINT: Record<MotionTechniqueFamily, HeroBlueprintFamily> = {
  'svg-path-flow': 'technical-system-map', 'svg-node-graph': 'animated-workflow', 'mask-reveal': 'layered-editorial-scene',
  'clip-path-transform': 'layered-editorial-scene', 'layered-parallax': 'layered-editorial-scene', 'progress-construction': 'animated-workflow',
  'animated-data-field': 'living-data-field', 'card-convergence': 'layered-editorial-scene', 'before-after-reveal': 'before-after-scene',
  'state-driven-workspace': 'product-workspace', 'timeline-progression': 'animated-workflow', 'orbital-relationship': 'diagrammatic-intelligence',
  'particle-lite-flow': 'environmental-narrative', 'material-light-sweep': 'material-object-reveal', 'image-depth-composition': 'cinematic-image-depth',
  'scroll-linked-story': 'environmental-narrative', 'input-reactive-viz': 'interactive-simulator', 'diagram-build-sequence': 'diagrammatic-intelligence',
  'typographic-motion': 'typographic-motion-hero',
};
const FALLBACK_BY_MEDIUM: Record<ImplementationMedium, string> = {
  'css-only': 'the final composed layout renders; the animation is progressive enhancement only',
  'svg-css': 'the SVG renders its final frame (paths at full stroke) with no JS; JS only adds the build',
  'svg-react-state': 'the SVG renders a sensible default/resolved state without interaction (labeled illustrative where needed)',
  'framer-motion': 'the settled final frame renders without motion (wrap in a component that defaults to the end state)',
  'chart-library': 'the chart renders its final data state with isAnimationActive disabled when motion is unavailable',
  'dom-transforms': 'the composed layout renders at its resting transform with no JS',
  'mask-clip-path': 'the fully-revealed final layout renders; the reveal is progressive enhancement',
  'image-layering': 'the hero image and composed layers render statically without JS',
  'canvas-lite': 'a static SVG/image fallback renders when canvas/JS is unavailable',
};

/* ── Derivation entry point ──────────────────────────────────────────────── */
export function deriveMotionExecutionContract(input: MotionExecutionInput): MotionExecutionContract | undefined {
  try {
    if (!input || typeof input !== 'object') return undefined;
    const vc = input.visualConcept;
    const ei = input.experienceIdentity;
    const cat: VisualCategory = ei?.category || (vc?.category as VisualCategory | undefined) || classifyVisualCategory({ identity: input.identity, prompt: input.prompt });
    const demo = ei?.demonstration;
    const demoRequired = !!demo?.required;

    // Family: the required demonstration owns the signature scene; else the visual signature family; else category.
    const demoFamily = demoRequired && demo ? DEMO_TO_EXEC[demo.pattern] : null;
    const sigFamily = vc?.signature?.family;
    const techniqueFamily: MotionTechniqueFamily = demoFamily || (sigFamily ? FAMILY_TO_EXEC[sigFamily] : CATEGORY_EXEC[cat]);
    const heroBlueprint: HeroBlueprintFamily = sigFamily ? HERO_BLUEPRINT[sigFamily] : EXEC_TO_BLUEPRINT[techniqueFamily];

    const signatureSceneRequired = !!vc?.signature?.animated || demoRequired;
    const linkage = stateLinkageFor(demo?.pattern, techniqueFamily, demoRequired);
    const mediumCands = EXEC_TO_MEDIUM[techniqueFamily];
    const interactive = linkage === 'user-input' || linkage === 'calculator-values' || linkage === 'selected-tab' || linkage === 'comparison-selection';
    const implementationMedium: ImplementationMedium = interactive
      ? (mediumCands.find((m) => m === 'svg-react-state' || m === 'framer-motion' || m === 'chart-library') || mediumCands[0])
      : mediumCands[0];

    const group = groupOf(techniqueFamily);
    const reducedMotionEquivalent = group === 'structural'
      ? 'render the final resolved diagram/result/values instantly (the settled SVG/chart state) with no transition — full information parity'
      : group === 'ambient'
        ? 'render the composed hero image/scene as a still with overlaid copy fully legible; no parallax or loops'
        : 'render the final revealed layout immediately with no mask/clip animation';

    const motionPurpose = clip(
      ei?.signatureBehavior ? `Show ${ei.signatureBehavior.replace(/^(the|a)\s+/i, '')}`
        : vc?.signature?.fiveSecondMemory ? `Make the visitor remember: ${vc.signature.fiveSecondMemory}`
        : `Communicate the product through a ${techniqueFamily.replace(/-/g, ' ')}, not decoration`,
      MAX_TEXT,
    );
    const signatureSceneLocation = vc?.signature?.animated ? 'the hero (must begin in the first viewport)'
      : demoRequired ? 'the primary product-demonstration section' : 'the primary product/story section';

    const animatedDemo: AnimatedDemoPlan = {
      required: demoRequired,
      userAction: clip(demo?.userInput || 'a simple control the visitor operates', 90),
      changedState: 'real React state (useState) updated by the action — not a decorative timer',
      visibleResult: clip(demo?.visibleResponse || 'an on-screen visual/value that reflects the new state', 90),
      transition: 'animate ONLY the change (values interpolate, the affected node/stage updates) — never a decorative flourish',
      successFeedback: clip(demo?.feedback || 'immediate perceivable feedback at the control (value/selection/status, aria-live)', 90),
      emptyErrorState: 'a clear empty/invalid state with a labeled illustrative example — never blank or fabricated results',
      accessibility: 'keyboard-operable, visible focus, result announced via aria-live; respects prefers-reduced-motion',
      keyboard: 'every control reachable and operable by keyboard',
      mobile: 'stacked layout, ≥44px touch targets, tap-driven (no hover dependency)',
      frontendOnlyBoundary: 'frontend-only simulation — never call a backend or imply live/real customer data',
      labelIllustrativeData: demo?.labelFictionalData ?? (cat === 'finance' || cat === 'security' || cat === 'healthcare'),
    };

    const evidence: string[] = [];
    if (vc) evidence.push('visualConcept.signature/motion/category');
    if (ei) evidence.push('experienceIdentity.demonstration/signatureBehavior/category');
    if (vc?.motion?.techniques?.length) evidence.push('visualConcept.motion.techniques');

    return {
      version: 'motion-execution-v1',
      status: 'derived',
      category: cat,
      motionPurpose,
      signatureSceneRequired,
      signatureSceneLocation,
      techniqueFamily,
      heroBlueprint,
      implementationMedium,
      sceneLayers: SCENE_LAYERS_BY_FAMILY[techniqueFamily].slice(0, 6),
      depthPattern: DEPTH_BY_CATEGORY[cat],
      choreography: choreographyFor(techniqueFamily, linkage),
      stateLinkage: linkage,
      responsive: responsiveFor(techniqueFamily),
      reducedMotionEquivalent,
      performanceBudget: performanceBudget(techniqueFamily),
      fallback: FALLBACK_BY_MEDIUM[implementationMedium],
      animatedDemo,
      forbiddenShortcuts: uniq([
        'headline-left + a random dashboard-right as the default hero',
        'three floating cards as the entire visual',
        'one blurred blob as the scene',
        'a static screenshot pretending to be the signature animated visual',
        'a hero animation that only starts below the fold',
        'lazy-loading the hero/LCP media',
        'unreadable copy over busy animation',
        'identical desktop and mobile scenes',
      ]).slice(0, MAX_LIST),
      antiSlopExclusions: uniq([...(CATEGORY_ANTISLOP[cat] || []), ...UNIVERSAL_ANTISLOP]).slice(0, MAX_LIST),
      reasons: [
        clip(`category "${cat}" · technique family "${techniqueFamily}" (${group}) · medium "${implementationMedium}"`, MAX_TEXT),
        clip(`hero blueprint "${heroBlueprint}" · state linkage "${linkage}"${demoRequired ? ` · animated demo (${demo?.pattern})` : ''}`, MAX_TEXT),
        clip(`signature animated scene ${signatureSceneRequired ? 'REQUIRED' : 'optional'} at ${signatureSceneLocation}`, MAX_TEXT),
      ],
      upstreamEvidenceUsedToDeriveContract: uniq(evidence).slice(0, MAX_LIST),
      contractPersistedInSpecification: true,
      contractRenderedToFrontendBuilder: false,
      contractUsedByAcceptance: false,
      agentsActuallyConsumingContract: [],
    };
  } catch {
    return undefined;   // never block the build on motion-execution derivation
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * RENDER — one hard-bounded builder block (≤ RENDER_CHAR_CEILING). Implementation
 * guidance only; references the peer authorities instead of repeating them.
 * ──────────────────────────────────────────────────────────────────────────── */
export function renderMotionExecutionBlock(contract: MotionExecutionContract | undefined): string[] {
  if (!contract || contract.status !== 'derived') return [];
  const c = contract; const ch = c.choreography; const r = c.responsive; const p = c.performanceBudget;
  const out: string[] = [];
  out.push(`BINDING MOTION EXECUTION (build the signature animation as REAL product-meaningful code, not decoration — implementation guidance; the visual/story/reduced-motion authorities own their parts):`);
  out.push(`- Motion purpose: ${clip(c.motionPurpose, MAX_TEXT)}`);
  out.push(`- Signature scene [${c.heroBlueprint}] ${c.signatureSceneRequired ? 'REQUIRED' : 'optional'} at ${clip(c.signatureSceneLocation, 60)}`);
  out.push(`- Technique family: ${c.techniqueFamily}; implement with: ${c.implementationMedium} (achievable on the current stack — never WebGL/Three.js)`);
  out.push(`- Scene layers: ${c.sceneLayers.join(' · ')}; depth: ${c.depthPattern} (real overlap/mask/shadow, NOT uniform glass cards)`);
  out.push(`- Choreography: start ${clip(ch.startCondition, 70)}; ${clip(ch.sequence, 80)}; ${ch.durationRange}, ${clip(ch.easing, 40)}; loop: ${clip(ch.loop, 44)}`);
  out.push(`  · climax: ${clip(ch.climax, 50)}; settle: ${clip(ch.settle, 55)}; ${clip(ch.pause, 50)}`);
  out.push(`- State linkage: ${c.stateLinkage}${c.stateLinkage !== 'static-narrative-timing' && c.stateLinkage !== 'scroll' ? ' — the animation MUST render real changed state, not run on a timer' : ''}`);
  if (c.animatedDemo.required) {
    out.push(`- Animated product demo: ${clip(c.animatedDemo.userAction, 50)} → ${clip(c.animatedDemo.visibleResult, 55)} via ${c.animatedDemo.changedState}`);
    out.push(`  · ${clip(c.animatedDemo.transition, 80)}; empty/error: ${clip(c.animatedDemo.emptyErrorState, 60)}; ${c.animatedDemo.frontendOnlyBoundary}${c.animatedDemo.labelIllustrativeData ? '; label example data as illustrative' : ''}`);
  }
  out.push(`- Responsive: desktop — ${clip(r.desktop, 60)}; mobile — ${clip(r.mobile, 70)}; keep ${capList(r.keep, 3).join('/')}, drop ${capList(r.remove, 3).join('/')}`);
  out.push(`- Reduced-motion equivalent (information parity): ${clip(c.reducedMotionEquivalent, MAX_TEXT)}`);
  out.push(`- No-JS/fallback: ${clip(c.fallback, MAX_TEXT)}`);
  out.push(`- Performance budget: ≤${p.maxContinuousAnimatedElements} continuous animated elements; animate ${capList(p.preferProperties, 4).join('/')} — NEVER ${capList(p.forbiddenProperties, 5).join('/')}; avoid ${capList(p.avoid, 3).join('; ')}`);
  out.push(`- Forbidden shortcuts: ${capList(c.forbiddenShortcuts, 5).map((x) => clip(x, 46)).join('; ')}`);
  out.push(`- Anti-slop: no ${capList(c.antiSlopExclusions, 5).map((x) => clip(x, 42)).join('; no ')}`);
  let total = 0; const bounded: string[] = [];
  for (const line of out) { total += line.length + 1; if (total > RENDER_CHAR_CEILING) break; bounded.push(line); }
  return bounded;
}

/* ────────────────────────────────────────────────────────────────────────────
 * ACCEPTANCE — conservative, evidence-backed, non-duplicative, fail-open. Reuses
 * experienceQuality's ONE JSX scanner. Blocks ONLY a required signature scene that
 * has a visual surface but is provably STATIC (no animation) — a defect owned by
 * nobody else (visualConcept blocks ABSENT visuals; experienceQuality blocks
 * continuous-motion-without-reduced-motion). Everything else warns.
 * ──────────────────────────────────────────────────────────────────────────── */
export type MotionExecutionIssueCode =
  | 'motion-signature-static' | 'motion-slop-concentration' | 'motion-layout-props'
  | 'motion-blur-filter' | 'motion-demo-no-state' | 'motion-exec-warn';

export interface MotionExecutionIssue {
  code: MotionExecutionIssueCode;
  severity: FrontendBuilderReviewSeverity;
  subPolicy: 'signature' | 'anti-slop' | 'performance' | 'demonstration';
  label: string;
  files: string[];
  evidence: string;
  repairInstruction: string;
}
export interface MotionExecutionAcceptanceResult {
  status: 'pass' | 'warning' | 'fail';
  legacy: boolean;
  analyzedFileCount: number;
  heroLocated: boolean;
  heroAnimated: boolean;
  fadeUpCount: number;
  infiniteCount: number;
  issues: MotionExecutionIssue[];
}
const LEGACY_MOTION: MotionExecutionAcceptanceResult = {
  status: 'pass', legacy: true, analyzedFileCount: 0, heroLocated: false, heroAnimated: false, fadeUpCount: 0, infiniteCount: 0, issues: [],
};
function capEv(s: string): string { const t = (s || '').replace(/\s+/g, ' ').trim(); return t.length > MAX_EVIDENCE ? t.slice(0, MAX_EVIDENCE) : t; }

// Any evidence that a region carries real animation (framer-motion, CSS anim/transition, SVG SMIL,
// stroke-dash draw, clip-path, chart lib which animates by default, or rAF).
const ANIM_RE = /whileInView|whileHover|animate=|initial=|motion\.[a-z]|<animate\b|<animateTransform\b|@keyframes|animate-\[|animate-(?:spin|pulse|bounce|ping)|transition-(?:all|transform|opacity|colors|\[)|stroke-dash|clip-path|requestAnimationFrame|useScroll|useSpring|useTransform/i;
const CHART_RE = /Recharts|ResponsiveContainer|<(?:Area|Bar|Line|Pie|Radar|Radial|Scatter|Composed)Chart\b|isAnimationActive/;
const VISUAL_SURFACE_RE = /<svg\b|<canvas\b|<img\b|background(?:-image)?\s*:\s*url\(|backgroundImage|motion\.[a-z]/i;
const FADEUP_RE = /initial=\{\{\s*opacity\s*:\s*0[^}]*\by\s*:|animate-\[fade|\bfade-?up\b|translate-y-\d.*transition|opacity-0.*translate-y/gi;
const INFINITE_RE = /animate-(?:spin|bounce|ping|pulse)\b|animation:[^;]*infinite|repeat:\s*Infinity/gi;
const BLURFILTER_RE = /@keyframes[^}]*(?:filter|blur)|animate[^;]*(?:blur|backdrop-filter)|transition-\[?(?:filter|backdrop)/i;
const LAYOUTPROP_RE = /@keyframes[^}]*\b(?:top|left|width|height|margin)\s*:|transition-\[(?:top|left|width|height|margin)/i;

/** Locate the hero region facts, or null (fail open). */
function heroFacts(files: FrontendGeneratedFile[], heroSectionId?: string): SectionFacts | null {
  try {
    if (heroSectionId) {
      const u = collectSectionUnits(files, [heroSectionId])[0];
      if (u) return factsFor(u.id, u.path, u.content);
    }
    const hf = files.find((f) => /hero/i.test(f.path || ''));
    if (hf) return factsFor('hero', hf.path, hf.content);
    return null;
  } catch { return null; }
}

export function analyzeMotionExecution(
  files: FrontendGeneratedFile[] | undefined,
  contract: MotionExecutionContract | undefined,
  heroSectionId?: string,
): MotionExecutionAcceptanceResult {
  try {
    if (!contract || contract.status !== 'derived') return LEGACY_MOTION;
    const list = Array.isArray(files) ? files : [];
    if (!list.length) return { ...LEGACY_MOTION, legacy: false };
    const issues: MotionExecutionIssue[] = [];
    const push = (x: MotionExecutionIssue) => { if (issues.length < MAX_ISSUES) issues.push(x); };

    let framerImport = false; let fadeUp = 0; let infinite = 0; let blurFilter = false; let layoutProps = false; let sectionCount = 0;
    for (const file of list) {
      const content = (file.content || '').slice(0, MAX_SCAN);
      if (!framerImport && /from\s+['"]framer-motion['"]/.test(content)) framerImport = true;
      fadeUp += (content.match(FADEUP_RE) || []).length;
      infinite += (content.match(INFINITE_RE) || []).length;
      if (!blurFilter && BLURFILTER_RE.test(content)) blurFilter = true;
      if (!layoutProps && LAYOUTPROP_RE.test(content)) layoutProps = true;
      if (/data-korvix-section|<section\b/i.test(content)) sectionCount += (content.match(/data-korvix-section|<section\b/gi) || []).length;
    }

    // (1) SIGNATURE SCENE STATIC (block) — required animated scene, hero located, has a visual surface,
    //     but no animation evidence anywhere it could live (region markers OR project framer-motion OR
    //     chart lib). Fail open on child components. Genuinely unowned.
    const hero = heroFacts(list, heroSectionId);
    let heroAnimated = false;
    if (hero) {
      const regionAnimated = ANIM_RE.test(hero.clean) || CHART_RE.test(hero.clean) || framerImport;
      heroAnimated = regionAnimated;
      const hasSurface = VISUAL_SURFACE_RE.test(hero.clean) || CHART_RE.test(hero.clean);
      if (contract.signatureSceneRequired && contract.signatureSceneLocation.includes('hero') && hasSurface && !regionAnimated && !hero.hasChildComponent) {
        push({
          code: 'motion-signature-static', severity: 'major', subPolicy: 'signature', label: 'signature scene is static',
          files: [hero.path],
          evidence: capEv(`the hero declares a REQUIRED animated ${contract.heroBlueprint} scene (${contract.techniqueFamily}) and renders a visual surface, but no animation evidence exists (no framer-motion/CSS animation/SVG SMIL/chart/stroke-dash) — a static scene pretending to be the signature visual`),
          repairInstruction: capEv(`Implement the ${contract.techniqueFamily} animation with ${contract.implementationMedium} in the hero (begin in the first viewport), with the reduced-motion final-frame equivalent and a no-JS fallback.`),
        });
      }
    }

    // (2) ANIMATED DEMO WITHOUT STATE (warn) — a required animated demo but no stateful React linkage
    //     anywhere (useState/onChange/onClick). bindingRequirements/experienceQuality own hard gates.
    if (contract.animatedDemo.required && !list.some((f) => /useState\s*[<(]|onChange=|onClick=/.test((f.content || '').slice(0, MAX_SCAN)))) {
      push({
        code: 'motion-demo-no-state', severity: 'minor', subPolicy: 'demonstration', label: 'animated demo not state-linked',
        files: [],
        evidence: capEv(`the ${contract.category} experience requires an animated product demo linked to ${contract.stateLinkage}, but no React state/handlers were found — animation must reflect real changed state, not a timer`),
        repairInstruction: capEv('Drive the demo animation from real React state updated by the control; animate only the change, with a labeled illustrative fallback.'),
      });
    }

    // (3) ANTI-SLOP CONCENTRATION (warn) — a heavy concentration of fade-up/infinite motion far beyond
    //     the section count, where the contract required a structural technique. Concentration, not isolated use.
    const slopTotal = fadeUp + infinite;
    if (slopTotal >= 8 && slopTotal > Math.max(4, sectionCount * 2) && STRUCTURAL.has(contract.techniqueFamily)) {
      push({
        code: 'motion-slop-concentration', severity: 'minor', subPolicy: 'anti-slop', label: 'generic motion concentration',
        files: [],
        evidence: capEv(`${slopTotal} generic fade-up/infinite-loop animations concentrated across the project while a structural ${contract.techniqueFamily} was the intended signature — motion reads as decoration, not the product`),
        repairInstruction: capEv('Replace repeated fade-up/loops with the intended structural technique for the signature scene; reserve entrance fades for a few elements only.'),
      });
    }

    // (4) EXPENSIVE FILTER / (5) LAYOUT-TRIGGERING PROPERTIES (warn).
    if (blurFilter) {
      push({ code: 'motion-blur-filter', severity: 'minor', subPolicy: 'performance', label: 'animated blur/filter', files: [],
        evidence: capEv('an animated blur/filter/backdrop-filter was found — expensive to composite; prefer opacity/transform or a static blur'),
        repairInstruction: capEv('Avoid animating blur/filter; use opacity/transform, or apply blur statically.') });
    }
    if (layoutProps) {
      push({ code: 'motion-layout-props', severity: 'minor', subPolicy: 'performance', label: 'layout-triggering animation', files: [],
        evidence: capEv('animation targets layout properties (top/left/width/height/margin) — triggers layout/reflow; use transform/opacity instead'),
        repairInstruction: capEv('Animate transform/opacity (and clip-path/stroke-dashoffset) instead of top/left/width/height/margin.') });
    }

    const majors = issues.filter((i) => i.severity !== 'minor').length;
    const status: MotionExecutionAcceptanceResult['status'] = majors > 0 ? 'fail' : (issues.length ? 'warning' : 'pass');
    return { status, legacy: false, analyzedFileCount: list.length, heroLocated: !!hero, heroAnimated, fadeUpCount: fadeUp, infiniteCount: infinite, issues };
  } catch {
    return LEGACY_MOTION;   // fail open
  }
}

export function hasBlockingMotionExecutionFindings(result: MotionExecutionAcceptanceResult | undefined): boolean {
  return !!result && result.status === 'fail';
}

const ME_CATEGORY: Record<MotionExecutionIssueCode, FrontendBuilderReviewCategory> = {
  'motion-signature-static': 'motion-and-interaction',
  'motion-slop-concentration': 'motion-and-interaction',
  'motion-layout-props': 'motion-and-interaction',
  'motion-blur-filter': 'motion-and-interaction',
  'motion-demo-no-state': 'motion-and-interaction',
  'motion-exec-warn': 'motion-and-interaction',
};

export function motionExecutionToReviewIssues(result: MotionExecutionAcceptanceResult | undefined): FrontendBuilderReviewIssue[] {
  if (!result || !result.issues.length) return [];
  const out: FrontendBuilderReviewIssue[] = [];
  let i = 0;
  for (const issue of result.issues) {
    if (issue.severity === 'minor') continue;    // advisory — never a repair blocker
    out.push({
      id: `motion-execution-${issue.code}-${i += 1}`,
      severity: issue.severity,
      category: ME_CATEGORY[issue.code],
      files: (issue.files || []).slice(0, MAX_ISSUE_FILES),
      evidence: capEv(issue.evidence),
      repairInstruction: capEv(issue.repairInstruction),
    });
    if (out.length >= MAX_ISSUES) break;
  }
  return out;
}

export function motionExecutionIssueCodes(result: MotionExecutionAcceptanceResult | undefined): string[] {
  return result && result.issues.length ? uniq(result.issues.map((i) => i.code)) : [];
}

/* ── Owner diagnostics (bounded, secret-free) ─────────────────────────────── */
export interface MotionExecutionDiagnostics {
  version: 'motion-execution-v1';
  category: VisualCategory;
  techniqueFamily: MotionTechniqueFamily;
  heroBlueprint: HeroBlueprintFamily;
  implementationMedium: ImplementationMedium;
  stateLinkage: StateLinkage;
  signatureSceneRequired: boolean;
  demoRequired: boolean;
  sceneLayerCount: number;
  maxContinuousAnimatedElements: number;
  promptCharCount: number;
  acceptanceStatus: 'pass' | 'warning' | 'fail' | 'legacy';
  heroLocated: boolean;
  heroAnimated: boolean;
  fadeUpCount: number;
  infiniteCount: number;
  issueCodes: string[];
  contractRenderedToFrontendBuilder: boolean;
  contractUsedByAcceptance: boolean;
  agentsActuallyConsumingContract: string[];
  upstreamEvidenceUsedToDeriveContract: string[];
}

export function buildMotionExecutionDiagnostics(
  contract: MotionExecutionContract | undefined,
  acceptance: MotionExecutionAcceptanceResult | undefined,
  promptCharCount: number,
): MotionExecutionDiagnostics | undefined {
  if (!contract || contract.status !== 'derived') return undefined;
  const rendered = promptCharCount > 0;
  const analyzed = !!acceptance && !acceptance.legacy;
  return {
    version: 'motion-execution-v1',
    category: contract.category,
    techniqueFamily: contract.techniqueFamily,
    heroBlueprint: contract.heroBlueprint,
    implementationMedium: contract.implementationMedium,
    stateLinkage: contract.stateLinkage,
    signatureSceneRequired: contract.signatureSceneRequired,
    demoRequired: contract.animatedDemo.required,
    sceneLayerCount: contract.sceneLayers.length,
    maxContinuousAnimatedElements: contract.performanceBudget.maxContinuousAnimatedElements,
    promptCharCount: Math.max(0, Math.round(promptCharCount)),
    acceptanceStatus: acceptance ? (acceptance.legacy ? 'legacy' : acceptance.status) : 'legacy',
    heroLocated: acceptance?.heroLocated ?? false,
    heroAnimated: acceptance?.heroAnimated ?? false,
    fadeUpCount: acceptance?.fadeUpCount ?? 0,
    infiniteCount: acceptance?.infiniteCount ?? 0,
    issueCodes: motionExecutionIssueCodes(acceptance),
    contractRenderedToFrontendBuilder: rendered,
    contractUsedByAcceptance: analyzed,
    agentsActuallyConsumingContract: uniq([...(rendered ? ['frontend-builder-prompt'] : []), ...(analyzed ? ['frontend-acceptance'] : [])]),
    upstreamEvidenceUsedToDeriveContract: contract.upstreamEvidenceUsedToDeriveContract,
  };
}
