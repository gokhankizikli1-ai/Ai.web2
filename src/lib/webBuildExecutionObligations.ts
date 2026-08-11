/* ────────────────────────────────────────────────────────────────────────────
 * webBuildExecutionObligations.ts — EXECUTION OBLIGATION REGISTRY & ACCOUNTABILITY
 *
 * Korvix plans well; the remaining gap is reliable EXECUTION. A correctly-planned
 * signature hero / real-image trust section / product demonstration / motion scene
 * can still be simplified into generic cards, omitted, or collapsed by the builder.
 * This layer makes high-value obligations SURVIVE the whole path:
 *     DERIVED → RENDERED TO BUILDER → IMPLEMENTED → VERIFIED → REPAIRED IF NEEDED
 *
 * It is NOT another planning contract. It is an accountability spine that:
 *   1. Collects only high-value, concrete, verifiable obligations from the EXISTING
 *      contracts (composition, content narrative, image coverage, visual concept,
 *      experience identity, motion execution, binding), each with ONE owner + stable id.
 *   2. Renders a concise, machine-readable Obligation Manifest to the builder (by id,
 *      "completion will be checked") — prevention, near the top of the request.
 *   3. Evaluates each obligation's lifecycle status against a reusable evidence map
 *      (reusing experienceQuality's ONE scanner) for owner diagnostics.
 *   4. Protects against repair regressions: pre/post comparison so a repair that fixes
 *      one obligation but breaks a higher-priority fulfilled one is rejected.
 *
 * DUPLICATE-ISSUE SAFETY: every blocker-eligible obligation type is already BLOCKED by
 * its owner analyzer (hero-signature → visualConcept, regulated-disclaimer → experience
 * identity, motion-execution → motionExecution, state-linked-interaction → experience
 * quality, …). To honour "never create duplicate repair issues", this layer NEVER emits
 * blocking repair issues for owner-blocked types — it defers blocking to the owners and
 * contributes ADVISORY warnings + diagnostics + the (new, non-duplicative) repair
 * regression gate. Its concrete teeth are PREVENTION (manifest) and PRESERVATION
 * (pre/post regression rejection), not a second copy of existing blocks.
 *
 * Pure: no Date/Math.random/network/import(); JSON-safe; hard-bounded; fails open.
 * ──────────────────────────────────────────────────────────────────────────── */
import type {
  FrontendGeneratedFile,
  FrontendBindingRequirements,
  FrontendBuilderReviewIssue,
  FrontendBuilderReviewCategory,
} from '@/lib/webBuildAgents';
import type { CompositionContract } from '@/lib/webBuildComposition';
import type { ContentNarrativeContract } from '@/lib/webBuildContentNarrative';
import type { ImageCoverageRequirement } from '@/lib/webBuildImageCoverage';
import type { VisualConceptContract } from '@/lib/webBuildVisualConcept';
import type { ExperienceIdentityContract } from '@/lib/webBuildExperienceIdentity';
import type { MotionExecutionContract } from '@/lib/webBuildMotionExecution';
import { collectSectionUnits, normId } from '@/lib/webBuildSectionSource';
import { factsFor, type SectionFacts } from '@/lib/webBuildExperienceQuality';

/* ── Bounds ───────────────────────────────────────────────────────────────── */
const MAX_TEXT = 160;
const MAX_OBLIGATIONS = 28;
const MAX_MANIFEST = 14;          // high-priority obligations rendered to the builder
const MAX_ISSUES = 16;
const MAX_ISSUE_FILES = 4;
const MAX_EVIDENCE = 180;
const MAX_SCAN = 24_000;
const RENDER_CHAR_CEILING = 2400; // documented hard ceiling for the rendered manifest block

/* ── Vocabulary ───────────────────────────────────────────────────────────── */
export type ObligationType =
  | 'hero-signature' | 'required-image-role' | 'product-demonstration' | 'state-linked-interaction'
  | 'trust-evidence' | 'regulated-disclaimer' | 'narrative-stage' | 'section-composition'
  | 'responsive-recomposition' | 'motion-execution' | 'reduced-motion-equivalent' | 'cta-stage'
  | 'content-specificity' | 'semantic-accessibility' | 'performance-delivery';

export type ObligationPriority = 'required' | 'preferred' | 'advisory';
export type ObligationOwner =
  | 'visualConcept' | 'experienceIdentity' | 'motionExecution' | 'imageCoverage'
  | 'contentNarrative' | 'composition' | 'bindingRequirements' | 'experienceQuality';

export type ObligationStatus =
  | 'fulfilled' | 'partial' | 'ambiguous' | 'missing' | 'contradicted' | 'not-applicable';

export interface ExecutionObligation {
  obligationId: string;
  ownerContract: ObligationOwner;
  ownerVersion: string;
  type: ObligationType;
  category: FrontendBuilderReviewCategory;
  sectionId: string;                 // '' → page-global scope
  targetScope: string;               // human label of the scope
  priority: ObligationPriority;
  requirement: string;               // concise, verifiable
  evidenceExpected: string;
  implementationMedium: string;
  interactionRequired: boolean;
  visibleStateChangeRequired: boolean;
  realImageRequired: boolean;
  animationRequired: boolean;
  mobileAdaptationRequired: boolean;
  disclaimerRequired: boolean;
  frontendSimulationOk: boolean;
  repairAllowed: boolean;
  safeRepairScope: 'section-local' | 'multi-section' | 'full-project';
  blockerEligible: boolean;
  ownerAnalyzerBlocks: boolean;      // true → the owner analyzer already blocks this; we never duplicate
  ambiguityPolicy: 'warn' | 'fail-open';
  notApplicableWhen: string;
  sourceTrace: string[];             // supporting contracts that referenced the same requirement
  forbiddenShortcut: string;
  allowedFreedom: string;
  renderedToBuilder: boolean;
  consumedByAcceptance: boolean;
}

export interface ExecutionObligationRegistry {
  version: 'execution-obligations-v1';
  status: 'derived' | 'legacy';
  obligations: ExecutionObligation[];
  requiredCount: number;
  blockerEligibleCount: number;
  ownerDistribution: Record<string, number>;
  sectionDistribution: Record<string, number>;
  reasons: string[];
  contractPersistedInSpecification: boolean;
  contractRenderedToFrontendBuilder: boolean;
  contractUsedByAcceptance: boolean;
  agentsActuallyConsumingContract: string[];
}

export interface ObligationRegistryInput {
  composition?: CompositionContract;
  contentNarrative?: ContentNarrativeContract;
  imageCoverage?: ImageCoverageRequirement;
  visualConcept?: VisualConceptContract;
  experienceIdentity?: ExperienceIdentityContract;
  motionExecution?: MotionExecutionContract;
  binding?: FrontendBindingRequirements;
  heroSectionId?: string;
}

/* ── Pure helpers ─────────────────────────────────────────────────────────── */
function clip(s: unknown, n = MAX_TEXT): string { return (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim().slice(0, n); }
function uniq<T>(a: T[]): T[] { return [...new Set(a)]; }
/** FNV-1a 32-bit → 8-hex-char, stable, no Date/random/position dependence. */
function hashString(s: string): number { let h = 0x811c9dc5; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0); }
function reqKey(s: string): string { return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 8).join(' '); }
/** Stable obligation id from owner|type|section|requirement — NOT array position. */
function obligationId(owner: string, type: string, section: string, requirement: string): string {
  return `obl_${hashString(`${owner}|${type}|${normId(section)}|${reqKey(requirement)}`).toString(16).padStart(8, '0')}`;
}

/* ── Registry derivation ──────────────────────────────────────────────────── */
export function deriveExecutionObligationRegistry(input: ObligationRegistryInput): ExecutionObligationRegistry | undefined {
  try {
    if (!input || typeof input !== 'object') return undefined;
    const obligations: ExecutionObligation[] = [];
    const seen = new Set<string>();
    const reasons: string[] = [];
    const heroId = input.heroSectionId || input.visualConcept?.rhythm?.peakSectionId || '';

    const add = (o: Omit<ExecutionObligation, 'obligationId' | 'renderedToBuilder' | 'consumedByAcceptance'>) => {
      if (obligations.length >= MAX_OBLIGATIONS) return;
      const id = obligationId(o.ownerContract, o.type, o.sectionId, o.requirement);
      // Dedup: same real requirement (owner+type+section) collapses to one; merge source traces.
      const key = `${o.type}|${normId(o.sectionId)}`;
      if (seen.has(key)) {
        const prev = obligations.find((x) => `${x.type}|${normId(x.sectionId)}` === key);
        if (prev) prev.sourceTrace = uniq([...prev.sourceTrace, ...o.sourceTrace, o.ownerContract]).slice(0, 6);
        return;
      }
      seen.add(key);
      obligations.push({ ...o, obligationId: id, renderedToBuilder: false, consumedByAcceptance: false });
    };

    // 1. HERO SIGNATURE (owner: visualConcept; blocked by visualConcept + motionExecution).
    const sig = input.visualConcept?.signature;
    if (sig) {
      const animated = !!sig.animated;
      add({
        ownerContract: 'visualConcept', ownerVersion: input.visualConcept!.version, type: 'hero-signature', category: 'visual-hierarchy',
        sectionId: heroId, targetScope: 'hero', priority: 'required',
        requirement: clip(`render one dominant ${animated ? 'animated ' : ''}${sig.medium} signature scene (${sig.family}) in the first viewport: ${clip(sig.fiveSecondMemory, 70)}`, MAX_TEXT),
        evidenceExpected: animated ? 'an animated svg/canvas/chart/state-driven scene in the hero' : 'a real image/svg/product surface in the hero (not a placeholder)',
        implementationMedium: sig.medium, interactionRequired: false, visibleStateChangeRequired: false,
        realImageRequired: !!sig.photographic, animationRequired: animated, mobileAdaptationRequired: true, disclaimerRequired: false,
        frontendSimulationOk: true, repairAllowed: true, safeRepairScope: 'section-local', blockerEligible: true, ownerAnalyzerBlocks: true,
        ambiguityPolicy: 'fail-open', notApplicableWhen: 'the hero is hosted in a child component',
        sourceTrace: ['visualConcept', ...(input.motionExecution ? ['motionExecution'] : [])],
        forbiddenShortcut: 'a static dashboard screenshot, a random orb, or three floating cards',
        allowedFreedom: 'exact composition and styling follow the visual-system and visual-concept authorities',
      });
    }

    // 2. MOTION EXECUTION for the signature scene (owner: motionExecution; blocked by motionExecution).
    const me = input.motionExecution;
    if (me?.signatureSceneRequired) {
      add({
        ownerContract: 'motionExecution', ownerVersion: me.version, type: 'motion-execution', category: 'motion-and-interaction',
        sectionId: heroId, targetScope: me.signatureSceneLocation.includes('hero') ? 'hero' : 'primary demo section', priority: 'required',
        requirement: clip(`implement the ${me.techniqueFamily} signature animation with ${me.implementationMedium} — ${clip(me.motionPurpose, 60)}`, MAX_TEXT),
        evidenceExpected: 'framer-motion / CSS keyframes / SVG SMIL / chart / stroke-dash animation in the scene',
        implementationMedium: me.implementationMedium, interactionRequired: me.stateLinkage === 'user-input' || me.stateLinkage === 'calculator-values',
        visibleStateChangeRequired: me.stateLinkage !== 'scroll' && me.stateLinkage !== 'static-narrative-timing',
        realImageRequired: false, animationRequired: true, mobileAdaptationRequired: true, disclaimerRequired: false,
        frontendSimulationOk: true, repairAllowed: true, safeRepairScope: 'section-local', blockerEligible: true, ownerAnalyzerBlocks: true,
        ambiguityPolicy: 'fail-open', notApplicableWhen: 'no animated signature scene is required',
        sourceTrace: ['motionExecution', ...(input.visualConcept ? ['visualConcept'] : [])],
        forbiddenShortcut: 'a static screenshot pretending to be animated, or a universal fade-up',
        allowedFreedom: 'exact technique realization within the current stack (no WebGL/Three.js)',
      });
      // reduced-motion equivalent (owner: experienceQuality already blocks unbounded motion).
      add({
        ownerContract: 'experienceQuality', ownerVersion: 'experience-quality-v1', type: 'reduced-motion-equivalent', category: 'motion-and-interaction',
        sectionId: heroId, targetScope: 'hero', priority: 'required',
        requirement: clip(`provide a reduced-motion equivalent: ${clip(me.reducedMotionEquivalent, 90)}`, MAX_TEXT),
        evidenceExpected: 'prefers-reduced-motion / useReducedMotion handling that renders the final informative frame',
        implementationMedium: 'css/react', interactionRequired: false, visibleStateChangeRequired: false, realImageRequired: false,
        animationRequired: false, mobileAdaptationRequired: false, disclaimerRequired: false, frontendSimulationOk: true,
        repairAllowed: true, safeRepairScope: 'section-local', blockerEligible: false, ownerAnalyzerBlocks: true,
        ambiguityPolicy: 'fail-open', notApplicableWhen: 'no continuous motion is present', sourceTrace: ['motionExecution', 'experienceQuality'],
        forbiddenShortcut: 'motion with no reduced-motion fallback', allowedFreedom: 'implementation via CSS media query or framer-motion useReducedMotion',
      });
    }

    // 3. PRODUCT DEMONSTRATION (owner: experienceIdentity; interaction blocked by experienceQuality).
    const demo = input.experienceIdentity?.demonstration;
    if (demo?.required) {
      const bp = demo.blueprint;
      const ctlLabels = bp ? bp.controls.map((c) => clip(c.label, 24)).slice(0, 3).join(', ') : '';
      const outLabels = bp ? bp.outputs.map((o) => clip(o.label, 24)).slice(0, 2).join(' + ') : '';
      add({
        ownerContract: 'experienceIdentity', ownerVersion: input.experienceIdentity!.version, type: 'product-demonstration', category: 'component-composition',
        sectionId: '', targetScope: 'primary demonstration section', priority: 'required',
        requirement: clip(bp
          ? `a working ${demo.pattern} demo: controls [${ctlLabels}] drive a computed output [${outLabels}] via real React state (${bp.computation.kind}), recomputed on change`
          : `a working ${demo.pattern} demo: ${clip(demo.userInput, 40)} → ${clip(demo.visibleResponse, 50)} via real state`, MAX_TEXT),
        evidenceExpected: bp
          ? clip(`the named controls (${ctlLabels}) + a handler + React state whose change recomputes ${outLabels || 'the visible result'} (clamped, no NaN/∞, illustrative-labelled)`, MAX_TEXT)
          : 'a control + handler + React state whose change is rendered as a visible result',
        implementationMedium: 'react-state', interactionRequired: true, visibleStateChangeRequired: true, realImageRequired: false,
        animationRequired: false, mobileAdaptationRequired: true, disclaimerRequired: false,
        frontendSimulationOk: demo.frontendSimOk ?? true, repairAllowed: true, safeRepairScope: 'multi-section', blockerEligible: true, ownerAnalyzerBlocks: true,
        ambiguityPolicy: 'fail-open', notApplicableWhen: 'no demonstration is required (visual/editorial-led category)',
        sourceTrace: ['experienceIdentity', ...(input.binding ? ['bindingRequirements'] : []), ...(input.motionExecution ? ['motionExecution'] : [])],
        forbiddenShortcut: 'a decorative control that never recomputes the output, static copy, or an empty click handler',
        allowedFreedom: 'exact control style and layout; frontend-only simulation with labeled illustrative data',
      });
    }

    // 4. STATE-LINKED INTERACTION from binding (owner: bindingRequirements; blocked by experienceQuality).
    const reqs = Array.isArray(input.binding?.requirements) ? input.binding!.requirements : [];
    for (const r of reqs.filter((x) => x.required && (x.kind === 'interactive-experience' || x.kind === 'control' || x.kind === 'dynamic-outcome')).slice(0, 3)) {
      add({
        ownerContract: 'bindingRequirements', ownerVersion: input.binding!.version, type: 'state-linked-interaction', category: 'motion-and-interaction',
        sectionId: '', targetScope: clip(r.label, 40), priority: 'required',
        requirement: clip(`${clip(r.label, 50)} must produce a visible outcome: ${clip(r.dynamicOutcome || 'a rendered state change', 60)}`, MAX_TEXT),
        evidenceExpected: 'a rendered control whose state is read back into the UI (value/output/aria-live)',
        implementationMedium: 'react-state', interactionRequired: true, visibleStateChangeRequired: true, realImageRequired: false,
        animationRequired: false, mobileAdaptationRequired: true, disclaimerRequired: false, frontendSimulationOk: r.frontendOnly ?? true,
        repairAllowed: true, safeRepairScope: 'section-local', blockerEligible: true, ownerAnalyzerBlocks: true,
        ambiguityPolicy: 'fail-open', notApplicableWhen: 'the control is hosted in a child component', sourceTrace: ['bindingRequirements', 'experienceQuality'],
        forbiddenShortcut: 'a decorative control that changes nothing', allowedFreedom: 'control style and micro-interaction',
      });
    }

    // 5. REGULATED DISCLAIMER (owner: experienceIdentity; blocked by experienceIdentity).
    const trust = input.experienceIdentity?.trust;
    if (trust?.stakes === 'regulated' && trust.disclaimersRequired.length) {
      add({
        ownerContract: 'experienceIdentity', ownerVersion: input.experienceIdentity!.version, type: 'regulated-disclaimer', category: 'concept-fidelity',
        sectionId: '', targetScope: 'page (near claims / footer)', priority: 'required',
        requirement: clip(`render visible limitations/disclaimers: ${trust.disclaimersRequired.slice(0, 2).join('; ')}`, MAX_TEXT),
        evidenceExpected: 'visible limitation/disclaimer copy in the rendered text',
        implementationMedium: 'text', interactionRequired: false, visibleStateChangeRequired: false, realImageRequired: false,
        animationRequired: false, mobileAdaptationRequired: false, disclaimerRequired: true, frontendSimulationOk: true,
        repairAllowed: true, safeRepairScope: 'section-local', blockerEligible: true, ownerAnalyzerBlocks: true,
        ambiguityPolicy: 'fail-open', notApplicableWhen: 'the build is not a regulated category', sourceTrace: ['experienceIdentity', 'research'],
        forbiddenShortcut: 'overstated claims with no limitation language', allowedFreedom: 'placement and wording within honest bounds',
      });
    }

    // 6. REQUIRED IMAGE ROLES (owner: imageCoverage; partially blocked by visualConcept).
    const targets = Array.isArray(input.imageCoverage?.targets) ? input.imageCoverage!.targets : [];
    for (const t of targets.filter((x) => (x as { required?: boolean }).required).slice(0, 4)) {
      const purpose = clip((t as { purpose?: string; label?: string }).label || (t as { purpose?: string }).purpose || 'image', 40);
      const sectionId = clip((t as { sectionId?: string }).sectionId || '', 60);
      add({
        ownerContract: 'imageCoverage', ownerVersion: input.imageCoverage!.version, type: 'required-image-role', category: 'component-composition',
        sectionId, targetScope: purpose, priority: 'required',
        requirement: clip(`render a real, semantic image for "${purpose}" (${(t as { altText?: string }).altText || 'meaningful alt'})`, MAX_TEXT),
        evidenceExpected: 'a non-placeholder <img>/background image depicting the purpose',
        implementationMedium: 'image', interactionRequired: false, visibleStateChangeRequired: false, realImageRequired: true,
        animationRequired: false, mobileAdaptationRequired: false, disclaimerRequired: false, frontendSimulationOk: false,
        repairAllowed: true, safeRepairScope: 'section-local', blockerEligible: true, ownerAnalyzerBlocks: true,
        ambiguityPolicy: 'fail-open', notApplicableWhen: 'the section is hosted in a child component', sourceTrace: ['imageCoverage', ...(input.visualConcept ? ['visualConcept'] : [])],
        forbiddenShortcut: 'a placeholder, an unrelated abstract gradient, a logo, or one image reused across roles',
        allowedFreedom: 'the exact subject/crop within the art-direction authority',
      });
    }

    // 7. CTA STAGE (owner: contentNarrative; conversion action present & clear).
    const cn = input.contentNarrative;
    if (cn?.primaryCtaRole) {
      add({
        ownerContract: 'contentNarrative', ownerVersion: cn.version, type: 'cta-stage', category: 'concept-fidelity',
        sectionId: '', targetScope: 'conversion section', priority: 'required',
        requirement: clip(`a clear primary CTA for: ${clip(cn.primaryCtaRole, 60)}`, MAX_TEXT),
        evidenceExpected: 'a prominent, labeled primary CTA button/link',
        implementationMedium: 'button/link', interactionRequired: false, visibleStateChangeRequired: false, realImageRequired: false,
        animationRequired: false, mobileAdaptationRequired: true, disclaimerRequired: false, frontendSimulationOk: true,
        repairAllowed: true, safeRepairScope: 'section-local', blockerEligible: false, ownerAnalyzerBlocks: true,
        ambiguityPolicy: 'warn', notApplicableWhen: 'the site is a pure portfolio with no conversion', sourceTrace: ['contentNarrative'],
        forbiddenShortcut: 'a hidden or ambiguous CTA', allowedFreedom: 'label wording and placement per the content narrative',
      });
    }

    // 8. NARRATIVE STAGE — the proof/trust stage exists (owner: contentNarrative).
    const stages = Array.isArray(cn?.narrativeProgression) ? cn!.narrativeProgression : [];
    if (stages.includes('provide-proof' as never)) {
      add({
        ownerContract: 'contentNarrative', ownerVersion: cn!.version, type: 'narrative-stage', category: 'concept-fidelity',
        sectionId: '', targetScope: 'proof section', priority: 'preferred',
        requirement: 'a distinct proof/trust stage with real, source-appropriate proof (not invented metrics)',
        evidenceExpected: 'a proof/trust section with substantive, non-fabricated evidence',
        implementationMedium: 'content', interactionRequired: false, visibleStateChangeRequired: false, realImageRequired: false,
        animationRequired: false, mobileAdaptationRequired: false, disclaimerRequired: false, frontendSimulationOk: true,
        repairAllowed: false, safeRepairScope: 'section-local', blockerEligible: false, ownerAnalyzerBlocks: true,
        ambiguityPolicy: 'warn', notApplicableWhen: 'no proof stage was planned', sourceTrace: ['contentNarrative', ...(input.experienceIdentity ? ['experienceIdentity'] : [])],
        forbiddenShortcut: 'invented metrics or fake logos as the only proof', allowedFreedom: 'proof presentation format',
      });
    }

    const requiredCount = obligations.filter((o) => o.priority === 'required').length;
    const blockerEligibleCount = obligations.filter((o) => o.blockerEligible).length;
    const ownerDistribution: Record<string, number> = {};
    const sectionDistribution: Record<string, number> = {};
    for (const o of obligations) {
      ownerDistribution[o.ownerContract] = (ownerDistribution[o.ownerContract] || 0) + 1;
      const s = o.sectionId || 'page';
      sectionDistribution[s] = (sectionDistribution[s] || 0) + 1;
    }
    reasons.push(clip(`${obligations.length} obligations · ${requiredCount} required · ${blockerEligibleCount} blocker-eligible (all owner-blocked → no duplicate issues)`, MAX_TEXT));

    return {
      version: 'execution-obligations-v1', status: 'derived', obligations,
      requiredCount, blockerEligibleCount, ownerDistribution, sectionDistribution, reasons,
      contractPersistedInSpecification: true, contractRenderedToFrontendBuilder: false,
      contractUsedByAcceptance: false, agentsActuallyConsumingContract: [],
    };
  } catch {
    return undefined;   // never block the build on obligation-registry derivation
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * PHASE 3 — BUILDER OBLIGATION MANIFEST (concise, machine-readable, near the top).
 * ──────────────────────────────────────────────────────────────────────────── */
const PRIORITY_RANK: Record<ObligationPriority, number> = { required: 0, preferred: 1, advisory: 2 };
export function renderObligationManifestBlock(registry: ExecutionObligationRegistry | undefined): string[] {
  if (!registry || registry.status !== 'derived' || !registry.obligations.length) return [];
  const ranked = [...registry.obligations].sort((a, b) => (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || (Number(b.blockerEligible) - Number(a.blockerEligible)));
  const out: string[] = [];
  // Phase 4 — this DOWNSTREAM accountability block references each obligation by id + owner + a concise
  // requirement; it does NOT re-explain the paragraphs the OWNER contract above already states in full,
  // and the evidence/forbidden-shortcut detail is checked DETERMINISTICALLY by acceptance (it lives in
  // the persisted registry, not re-emitted to the model). This keeps the checklist authoritative while
  // removing duplicated model-facing prose.
  out.push('EXECUTION OBLIGATION MANIFEST (each id WILL be checked after generation — fulfil the intent; the OWNER contract above states the full detail, this is the accountability checklist, not a re-explanation):');
  for (const o of ranked.slice(0, MAX_MANIFEST)) {
    out.push(`[OBL ${o.obligationId} · ${o.type}${o.sectionId ? ` · ${clip(o.sectionId, 24)}` : ''} · ${o.priority} · owner:${o.ownerContract}] ${clip(o.requirement, 130)}`);
  }
  out.push('Report the obligation ids you addressed. Preserve every already-correct section; do not collapse distinct obligations into one generic block.');
  let total = 0; const bounded: string[] = [];
  for (const line of out) { total += line.length + 1; if (total > RENDER_CHAR_CEILING) break; bounded.push(line); }
  return bounded;
}

/* ────────────────────────────────────────────────────────────────────────────
 * PHASE 4 — GENERATED CODE EVIDENCE MAP (reuses the ONE shared scanner; bounded; fails open).
 * ──────────────────────────────────────────────────────────────────────────── */
export interface EvidenceMap {
  fileCount: number;
  sectionCount: number;
  framerImport: boolean;
  motionEvidence: boolean;
  reducedMotionEvidence: boolean;
  hasState: boolean;
  hasControl: boolean;
  hasHandler: boolean;
  responsiveEvidence: boolean;
  disclaimerEvidence: boolean;
  ctaEvidence: boolean;
  fakeMetricEvidence: boolean;
  visibleTextLen: number;
  realImages: Array<{ src: string; path: string }>;
  heroFacts: SectionFacts | null;
  sectionFacts: Map<string, SectionFacts>;
  anyChildComponent: boolean;
}
const MOTION_RE = /from\s+['"]framer-motion['"]|whileInView|whileHover|<animate\b|<animateTransform\b|@keyframes|animate-\[|animate-(?:spin|pulse|bounce|ping)|transition-(?:all|transform|opacity|colors|\[)|stroke-dash|clip-path|requestAnimationFrame|useScroll|useSpring/i;
const REDUCED_RE = /prefers-reduced-motion|useReducedMotion|motion-reduce:/i;
const STATE_RE = /useState\s*[<(]|useReducer\s*[<(]/;
const HANDLER_RE = /on(?:Click|Change|Input|Submit|Toggle)\s*=/;
const CONTROL_RE = /<input\b|<textarea\b|<select\b|<button\b|type=["']range["']|role=["'](?:slider|tab|tablist)["']/i;
const RESPONSIVE_RE = /\b(?:sm|md|lg|xl):[a-z]|@media|useMediaQuery|hidden\s+(?:sm|md|lg):/;
const DISCLAIMER_RE = /\b(not\s+(?:financial|investment|legal|medical|tax|professional)\s+advice|for\s+informational\s+purposes|consult\s+(?:a|an|your|with|qualified|the)|results?\s+(?:may|can|are\s+not|will)\s+var|past\s+performance|no\s+guarantee|not\s+a\s+substitute|individual\s+results|terms(?:\s+and\s+conditions)?\s+apply|eligibility|disclaimer|limitations?\b|illustrative|for\s+general\s+information)\b/i;
const CTA_RE = /<(?:button|a)\b[^>]*>(?:[^<]{0,40})(?:get\s+started|start|try|book|buy|sign\s+up|subscribe|contact|request|demo|join|learn\s+more|explore|order|reserve|enquire|apply)/i;
const FAKEMETRIC_RE = /trusted\s+by\s+[\d,]{2,}\+?\s*(?:customers|users|clients|companies|businesses|teams|brands)/i;
const PLACEHOLDER_SRC = /^\s*$|placeholder|placehold\.co|via\.placeholder|example\.com\/(?:image|img)|dummyimage/i;
const LOGO_ISH = /logo|icon|favicon|avatar|sprite/i;
function srcOf(attr: string): string { const m = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*[`'"]([^`'"]*)[`'"]\s*\})/.exec(attr); return (m ? (m[1] ?? m[2] ?? m[3] ?? '') : '').trim(); }
function isRealImage(src: string): boolean { return !!src && !PLACEHOLDER_SRC.test(src) && !LOGO_ISH.test(src) && !/^data:/i.test(src) && (/^https?:\/\//i.test(src) || /^\/?assets?\//i.test(src) || /\.(?:jpe?g|png|webp|avif|gif)(?:\?|$)/i.test(src)); }

export function buildEvidenceMap(files: FrontendGeneratedFile[] | undefined, sectionIds: string[], heroSectionId?: string): EvidenceMap {
  const map: EvidenceMap = {
    fileCount: 0, sectionCount: 0, framerImport: false, motionEvidence: false, reducedMotionEvidence: false,
    hasState: false, hasControl: false, hasHandler: false, responsiveEvidence: false, disclaimerEvidence: false,
    ctaEvidence: false, fakeMetricEvidence: false, visibleTextLen: 0, realImages: [], heroFacts: null,
    sectionFacts: new Map(), anyChildComponent: false,
  };
  try {
    const list = Array.isArray(files) ? files : [];
    map.fileCount = list.length;
    let visibleText = '';
    for (const file of list) {
      const content = (file.content || '').slice(0, MAX_SCAN);
      if (!map.framerImport && /from\s+['"]framer-motion['"]/.test(content)) map.framerImport = true;
      if (!map.motionEvidence && MOTION_RE.test(content)) map.motionEvidence = true;
      if (!map.reducedMotionEvidence && REDUCED_RE.test(content)) map.reducedMotionEvidence = true;
      if (!map.hasState && STATE_RE.test(content)) map.hasState = true;
      if (!map.hasHandler && HANDLER_RE.test(content)) map.hasHandler = true;
      if (!map.hasControl && CONTROL_RE.test(content)) map.hasControl = true;
      if (!map.responsiveEvidence && RESPONSIVE_RE.test(content)) map.responsiveEvidence = true;
      if (!map.ctaEvidence && CTA_RE.test(content)) map.ctaEvidence = true;
      if (!map.fakeMetricEvidence && FAKEMETRIC_RE.test(content)) map.fakeMetricEvidence = true;
      let f: SectionFacts | null = null;
      try { f = factsFor('scan', file.path || '', file.content || ''); } catch { f = null; }
      if (f) {
        visibleText += ' ' + f.text;
        if (f.hasChildComponent) map.anyChildComponent = true;
        for (const el of f.elements) { if (el.tag === 'img' || el.tag === 'source') { const s = srcOf(el.attr); if (isRealImage(s)) map.realImages.push({ src: s, path: file.path || '' }); } }
      }
    }
    map.visibleTextLen = visibleText.trim().length;
    map.disclaimerEvidence = DISCLAIMER_RE.test(visibleText);
    // Section-scoped facts for located obligations (hero + named sections).
    const ids = uniq([heroSectionId || '', ...sectionIds].filter(Boolean)).slice(0, 12);
    if (ids.length) { for (const u of collectSectionUnits(list, ids)) { try { map.sectionFacts.set(u.id, factsFor(u.id, u.path, u.content)); } catch { /* skip */ } } }
    map.sectionCount = map.sectionFacts.size;
    if (heroSectionId && map.sectionFacts.has(heroSectionId)) map.heroFacts = map.sectionFacts.get(heroSectionId) || null;
    if (!map.heroFacts) { const hf = list.find((f) => /hero/i.test(f.path || '')); if (hf) { try { map.heroFacts = factsFor('hero', hf.path, hf.content); } catch { /* skip */ } } }
  } catch { /* fail open — return what we have */ }
  return map;
}

/* ────────────────────────────────────────────────────────────────────────────
 * PHASE 5 — OBLIGATION FULFILLMENT ANALYZER (status per obligation; for diagnostics
 * + pre/post regression; blocking is DEFERRED to the owner analyzers).
 * ──────────────────────────────────────────────────────────────────────────── */
export interface ObligationEvaluation {
  obligationId: string;
  type: ObligationType;
  priority: ObligationPriority;
  status: ObligationStatus;
  confidence: 'high' | 'medium' | 'low';
  evidenceFiles: string[];
  evidenceSummary: string;
  missingEvidence: string;
}
export interface ObligationFulfillmentResult {
  status: 'pass' | 'warning' | 'fail';
  legacy: boolean;
  evaluations: ObligationEvaluation[];
  fulfilled: number; partial: number; ambiguous: number; missing: number; contradicted: number; notApplicable: number;
}
const LEGACY_FULFILLMENT: ObligationFulfillmentResult = {
  status: 'pass', legacy: true, evaluations: [], fulfilled: 0, partial: 0, ambiguous: 0, missing: 0, contradicted: 0, notApplicable: 0,
};
function heroHasSurface(f: SectionFacts): boolean {
  return /<svg\b|<canvas\b|<img\b|background(?:-image)?\s*:\s*url\(|backgroundImage|<(?:Area|Bar|Line|Pie|Radar)Chart\b|ResponsiveContainer/i.test(f.clean);
}
function heroHasMotion(f: SectionFacts, framer: boolean): boolean {
  return framer || MOTION_RE.test(f.clean) || /Recharts|ResponsiveContainer|<(?:Area|Bar|Line|Pie|Radar)Chart\b|isAnimationActive/.test(f.clean);
}
function evalOne(o: ExecutionObligation, m: EvidenceMap): ObligationEvaluation {
  const mk = (status: ObligationStatus, confidence: ObligationEvaluation['confidence'], summary: string, missing = '', files: string[] = []): ObligationEvaluation =>
    ({ obligationId: o.obligationId, type: o.type, priority: o.priority, status, confidence, evidenceFiles: files.slice(0, MAX_ISSUE_FILES), evidenceSummary: clip(summary, MAX_TEXT), missingEvidence: clip(missing, MAX_TEXT) });
  try {
    switch (o.type) {
      case 'hero-signature': {
        const f = m.heroFacts;
        if (!f) return mk('ambiguous', 'low', 'hero region not locatable', 'hero markup');
        if (f.hasChildComponent) return mk('ambiguous', 'low', 'hero hosts a child component', 'hero surface (child-hosted)');
        if (!heroHasSurface(f)) return mk('missing', 'high', 'hero renders no visual surface', 'svg/img/canvas/chart in hero', [f.path]);
        if (o.animationRequired && !heroHasMotion(f, m.framerImport)) return mk('partial', 'medium', 'hero has a visual but no animation evidence', 'animation in hero', [f.path]);
        return mk('fulfilled', 'high', 'hero renders a visual surface' + (o.animationRequired ? ' with motion' : ''), '', [f.path]);
      }
      case 'motion-execution': {
        const f = m.heroFacts;
        if (m.motionEvidence || m.framerImport) return mk('fulfilled', f && heroHasMotion(f, m.framerImport) ? 'high' : 'medium', 'motion implementation found');
        if (f?.hasChildComponent) return mk('ambiguous', 'low', 'scene may be child-hosted', 'motion (child-hosted)');
        return mk('missing', 'medium', 'no motion implementation found', 'framer-motion/CSS/SVG animation');
      }
      case 'reduced-motion-equivalent':
        return m.reducedMotionEvidence ? mk('fulfilled', 'high', 'reduced-motion handling found')
          : (m.motionEvidence ? mk('ambiguous', 'low', 'motion present; reduced-motion not statically confirmed', 'prefers-reduced-motion/useReducedMotion') : mk('not-applicable', 'medium', 'no continuous motion present'));
      case 'product-demonstration':
      case 'state-linked-interaction': {
        if (m.hasState && (m.hasHandler || m.hasControl)) return mk('fulfilled', 'medium', 'state + control/handler present');
        if (m.anyChildComponent) return mk('ambiguous', 'low', 'interaction may live in a child component', 'state/handler (child-hosted)');
        if (m.hasControl || m.hasHandler) return mk('partial', 'medium', 'control/handler present but no state read-back', 'React state linkage');
        return mk('missing', 'medium', 'no interactive/state evidence', 'control + handler + state');
      }
      case 'regulated-disclaimer':
        if (m.disclaimerEvidence) return mk('fulfilled', 'high', 'limitation/disclaimer language present');
        if (m.visibleTextLen < 40) return mk('ambiguous', 'low', 'too little rendered copy to judge', 'disclaimer (thin copy)');
        return mk('missing', 'high', 'no limitation/disclaimer language in substantial copy', 'visible disclaimer text');
      case 'required-image-role': {
        const sectionF = o.sectionId ? m.sectionFacts.get(o.sectionId) : null;
        if (sectionF?.hasChildComponent) return mk('ambiguous', 'low', 'image section hosts a child component', 'real image (child-hosted)');
        if (m.realImages.length) return mk('fulfilled', o.sectionId && sectionF ? 'medium' : 'low', `${m.realImages.length} real image(s) rendered`, '', uniq(m.realImages.map((i) => i.path)));
        return mk('missing', 'medium', 'no real (non-placeholder) images rendered', 'a semantic <img>/background');
      }
      case 'cta-stage':
        return m.ctaEvidence ? mk('fulfilled', 'medium', 'a primary CTA is present') : mk('ambiguous', 'low', 'no obvious CTA label matched', 'a clear primary CTA');
      case 'narrative-stage':
        return m.visibleTextLen > 200 ? mk('fulfilled', 'low', 'substantive content present (proof stage assumed)') : mk('ambiguous', 'low', 'insufficient content to confirm a proof stage', 'a proof/trust section');
      default:
        return mk('ambiguous', 'low', 'no specific evaluator', '');
    }
  } catch { return mk('ambiguous', 'low', 'evaluator error (fail open)', ''); }
}

export function analyzeObligationFulfillment(
  files: FrontendGeneratedFile[] | undefined,
  registry: ExecutionObligationRegistry | undefined,
): ObligationFulfillmentResult {
  try {
    if (!registry || registry.status !== 'derived' || !registry.obligations.length) return LEGACY_FULFILLMENT;
    const list = Array.isArray(files) ? files : [];
    if (!list.length) return { ...LEGACY_FULFILLMENT, legacy: false };
    const sectionIds = uniq(registry.obligations.map((o) => o.sectionId).filter(Boolean));
    const heroId = registry.obligations.find((o) => o.type === 'hero-signature')?.sectionId || undefined;
    const m = buildEvidenceMap(list, sectionIds, heroId);
    const evaluations = registry.obligations.map((o) => evalOne(o, m));
    const count = (s: ObligationStatus) => evaluations.filter((e) => e.status === s).length;
    return {
      status: 'pass', legacy: false, evaluations,
      fulfilled: count('fulfilled'), partial: count('partial'), ambiguous: count('ambiguous'),
      missing: count('missing'), contradicted: count('contradicted'), notApplicable: count('not-applicable'),
    };
  } catch { return LEGACY_FULFILLMENT; }
}

/* ────────────────────────────────────────────────────────────────────────────
 * PHASE 8 — PRE/POST REPAIR REGRESSION PROTECTION. A repair that breaks a REQUIRED
 * obligation which was fulfilled/partial before is rejected. Fails open when
 * comparison is ambiguous (missing evaluations / low-confidence).
 * ──────────────────────────────────────────────────────────────────────────── */
export interface ObligationRegression { obligationId: string; type: ObligationType; before: ObligationStatus; after: ObligationStatus; }
export interface ObligationComparison { improved: number; regressed: ObligationRegression[]; regressionRejectsRepair: boolean; }
const GOOD: Set<ObligationStatus> = new Set(['fulfilled', 'partial']);
const BAD: Set<ObligationStatus> = new Set(['missing', 'contradicted']);
export function compareObligationFulfillment(
  pre: ObligationFulfillmentResult | undefined,
  post: ObligationFulfillmentResult | undefined,
): ObligationComparison {
  const empty: ObligationComparison = { improved: 0, regressed: [], regressionRejectsRepair: false };
  try {
    if (!pre || !post || pre.legacy || post.legacy) return empty;
    const preById = new Map(pre.evaluations.map((e) => [e.obligationId, e]));
    let improved = 0; const regressed: ObligationRegression[] = [];
    for (const a of post.evaluations) {
      const b = preById.get(a.obligationId);
      if (!b) continue;
      if (BAD.has(a.status) && GOOD.has(b.status)) {
        // Only count a REQUIRED, high/medium-confidence regression toward rejection (fail open on low confidence).
        if (a.priority === 'required' && a.confidence !== 'low') regressed.push({ obligationId: a.obligationId, type: a.type, before: b.status, after: a.status });
      } else if (GOOD.has(a.status) && BAD.has(b.status)) improved += 1;
    }
    return { improved, regressed, regressionRejectsRepair: regressed.length > 0 };
  } catch { return empty; }
}

/* ── Advisory repair-issue mapping (NEVER blocking — owners own blocking; deduped by design). ── */
export type ObligationIssueCode = 'obligation-unfulfilled-advisory';
export function obligationsToReviewIssues(result: ObligationFulfillmentResult | undefined): FrontendBuilderReviewIssue[] {
  // Deliberately advisory-only: every blocker-eligible obligation type is already blocked by its owner
  // analyzer, so surfacing obligation status here as MINOR keeps owners authoritative and avoids duplicate
  // repair issues. Returned for completeness/diagnostics; contributes no blocking.
  if (!result || result.legacy) return [];
  const out: FrontendBuilderReviewIssue[] = [];
  let i = 0;
  for (const e of result.evaluations) {
    if (e.status !== 'missing' || e.priority !== 'required' || e.confidence === 'low') continue;
    out.push({
      id: `obligation-${e.type}-${i += 1}`,
      severity: 'minor',
      category: 'concept-fidelity',
      files: e.evidenceFiles.slice(0, MAX_ISSUE_FILES),
      evidence: clip(`obligation ${e.obligationId} (${e.type}) appears unfulfilled — its owner analyzer is authoritative for blocking; ${e.evidenceSummary}`, MAX_EVIDENCE),
      repairInstruction: clip(`Fulfil obligation ${e.obligationId} (${e.type}); ${e.missingEvidence ? `provide ${e.missingEvidence}` : ''}`, MAX_EVIDENCE),
    });
    if (out.length >= MAX_ISSUES) break;
  }
  return out;
}

/* ── Owner diagnostics (bounded, secret-free) ─────────────────────────────── */
export interface ObligationDiagnostics {
  version: 'execution-obligations-v1';
  totalObligations: number;
  requiredCount: number;
  blockerEligibleCount: number;
  renderedToBuilderCount: number;
  evaluatedCount: number;
  fulfilled: number; partial: number; ambiguous: number; missing: number; contradicted: number; notApplicable: number;
  repairImproved: number;
  regressionCount: number;
  ownerDistribution: Record<string, number>;
  sectionDistribution: Record<string, number>;
  statusByObligation: string[];        // "obl_x:fulfilled" pairs, bounded
  repairScopesAvailable: string[];
  promptCharCount: number;
  contractRenderedToFrontendBuilder: boolean;
  contractUsedByAcceptance: boolean;
  agentsActuallyConsumingContract: string[];
}
export function buildObligationDiagnostics(
  registry: ExecutionObligationRegistry | undefined,
  initial: ObligationFulfillmentResult | undefined,
  post: ObligationFulfillmentResult | undefined,
  comparison: ObligationComparison | undefined,
  promptCharCount: number,
): ObligationDiagnostics | undefined {
  if (!registry || registry.status !== 'derived') return undefined;
  const rendered = promptCharCount > 0;
  const evalr = post && !post.legacy ? post : initial;
  const analyzed = !!evalr && !evalr.legacy;
  return {
    version: 'execution-obligations-v1',
    totalObligations: registry.obligations.length,
    requiredCount: registry.requiredCount,
    blockerEligibleCount: registry.blockerEligibleCount,
    renderedToBuilderCount: rendered ? Math.min(registry.obligations.length, MAX_MANIFEST) : 0,
    evaluatedCount: evalr?.evaluations.length ?? 0,
    fulfilled: evalr?.fulfilled ?? 0, partial: evalr?.partial ?? 0, ambiguous: evalr?.ambiguous ?? 0,
    missing: evalr?.missing ?? 0, contradicted: evalr?.contradicted ?? 0, notApplicable: evalr?.notApplicable ?? 0,
    repairImproved: comparison?.improved ?? 0,
    regressionCount: comparison?.regressed.length ?? 0,
    ownerDistribution: registry.ownerDistribution,
    sectionDistribution: registry.sectionDistribution,
    statusByObligation: (evalr?.evaluations || []).slice(0, 16).map((e) => `${e.obligationId}:${e.status}`),
    repairScopesAvailable: uniq(registry.obligations.filter((o) => o.repairAllowed).map((o) => o.safeRepairScope)),
    promptCharCount: Math.max(0, Math.round(promptCharCount)),
    contractRenderedToFrontendBuilder: rendered,
    contractUsedByAcceptance: analyzed,
    agentsActuallyConsumingContract: uniq([...(rendered ? ['frontend-builder-prompt'] : []), ...(analyzed ? ['frontend-acceptance'] : [])]),
  };
}
