/**
 * Web Build FRONTEND BUILD SPECIFICATION (Phase 12A).
 *
 * Consolidates every scattered planning artifact (Research → Strategic Thinking
 * Ledger → Art Direction → Strategy → Experience Blueprint → Vertical Intelligence
 * → Section/Page Architecture → Visual Signature → Layout Architect → Component
 * Engineer → Asset Director → Motion Composer → Image Pipeline → Reviewer / Quality
 * Director / Fixer) into ONE authoritative, typed, implementation-ready CONTRACT for
 * a FUTURE dedicated Frontend Builder model (Phase 12B).
 *
 * CONTRACT + ORCHESTRATION ONLY. `deriveFrontendBuildSpecification` is pure,
 * deterministic, network-free, bounded, non-mutating, JSON-serializable and FAILS
 * OPEN (never throws). It does NOT call a model/backend/provider, does NOT generate
 * React code, and NEVER inspects or copies the current synthesized files / template
 * synthesizer — the future builder must not imitate the internal synthesizer. The
 * spec is built from strategy, architecture, FINAL copy, design decisions, assets,
 * motion, interactions and honesty constraints only. `generation.status` is always
 * 'not-run' in Phase 12A.
 *
 * All cross-module imports are TYPE-ONLY, so there is no runtime import cycle.
 */
import type { WebBuildBrief } from '@/lib/webBuildApi';
import type { WebBuildSectionItem } from '@/lib/webBuildPayload';
import type { WebBuildLayoutPlan } from '@/lib/webBuildLayoutPlan';
// Phase 12F — the shared product-intent authority (a leaf; no runtime cycle) for the
// final specification contradiction guard.
import { resolveProductIntent } from '@/lib/webBuildProductIntent';
// PR #510 — deterministic Experience Architecture planner (a leaf; pure + fail-open; reads
// only this assembled spec + the prompt, so it introduces no runtime import cycle).
import { deriveExperienceArchitecturePlan } from '@/lib/webBuildExperienceArchitecture';
import type {
  FrontendBuildSpecification, FrontendSpecSection, FrontendSpecImageSlot, FrontendSpecMotionLayer,
  FrontendSpecIdentity, FrontendSpecDesignSystem, FrontendSpecArchitecture, FrontendSpecAssetPlan,
  FrontendSpecResearchEvidence, FrontendSpecOutputContract, FrontendBuildSpecStatus,
  ResearchAgentArtifact, StrategicThinkingLedger, ArtDirectionArtifact, StrategyAgentArtifact,
  ExperienceBlueprint, VerticalIntelligenceArtifact, PageArchitectureDecision, VisualSignaturePlan,
  PageBlueprint, ComponentEngineerArtifact, ReviewerAgentArtifact, QualityDirectorArtifact,
  AssetDirectorArtifact, MotionComposerArtifact, ImagePipelineArtifact, FixerAgentArtifact,
} from '@/lib/webBuildAgents';

export interface FrontendBuildSpecInput {
  prompt: string;
  lang: string;
  brief: WebBuildBrief;
  sectionItems: WebBuildSectionItem[];
  layoutPlan: WebBuildLayoutPlan;

  research?: ResearchAgentArtifact;
  thinkingLedger?: StrategicThinkingLedger;
  artDirection?: ArtDirectionArtifact;
  strategy?: StrategyAgentArtifact;
  experienceBlueprint?: ExperienceBlueprint;
  verticalIntelligence?: VerticalIntelligenceArtifact;
  pageArchitecture?: PageArchitectureDecision;
  visualSignaturePlan?: VisualSignaturePlan;
  blueprint?: PageBlueprint;
  componentEngineer?: ComponentEngineerArtifact;
  reviewer?: ReviewerAgentArtifact;
  qualityDirector?: QualityDirectorArtifact;
  assetDirector?: AssetDirectorArtifact;
  motionComposer?: MotionComposerArtifact;
  imagePipeline?: ImagePipelineArtifact;
  fixer?: FixerAgentArtifact;
}

/* ── Deterministic, bounded helpers (no Date/random/network; JSON-safe) ─────── */

const CAP = 12;            // default array cap
const RESEARCH_CAP = 8;    // sources + evidence arrays

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** Trim, drop empties, dedupe, cap. Never mutates the input. */
function clean(xs: ReadonlyArray<string | undefined | null> | undefined, cap = CAP): string[] {
  if (!Array.isArray(xs)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of xs) {
    const s = str(raw);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

/** Merge several string sources into one bounded, deduped list (first wins). */
function merge(cap: number, ...groups: Array<ReadonlyArray<string | undefined | null> | undefined>): string[] {
  const all: Array<string | undefined | null> = [];
  for (const g of groups) if (Array.isArray(g)) all.push(...g);
  return clean(all, cap);
}

/** First non-empty string among the candidates, else undefined. */
function firstOf(...cands: Array<string | undefined | null>): string | undefined {
  for (const c of cands) if (nonEmpty(c)) return c.trim();
  return undefined;
}

const normId = (s: string): string => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const pascal = (id: string): string =>
  (id || '').replace(/(^|[-_ ]+)(\w)/g, (_m, _s, c: string) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '') || 'Section';

/** Deterministic component file path for a final section id (fallback path). */
function sectionFilePath(id: string): string {
  return `src/components/${pascal(id)}.tsx`;
}

/* ── Phase 13B — internal-planning-copy detector (pure, deterministic, EN+TR) ───
 * Some upstream sources hand a section a PLANNING description ("proof points,
 * metrics and security" / "Ürün kanıtı (demo/ekran), metrikler ve güvenlik") where a
 * real audience-facing headline belongs. Rendering such a string verbatim leaks the
 * internal specification as public copy. This detector flags those strings so the
 * public-copy sanitization guard can blank them (never rendered, never required by
 * the validator; the builder then writes real copy). It is CONSERVATIVE (high
 * precision): it fires only on a parenthetical slash-enumeration combined with a
 * planning term, on two or more distinct planning meta-terms, or on a single
 * unambiguous placeholder/meta term. It matches PLANNING VOCABULARY, never a product
 * concept, so it is not vertical-specific. */
const INTERNAL_PLANNING_META_TERMS: readonly string[] = [
  // EN planning vocabulary
  'proof points', 'proof point', 'value proposition', 'trust signals', 'trust signal',
  'call to action', 'above the fold', 'target audience', 'pain points', 'use cases',
  'key benefits', 'feature list', 'section header', 'placeholder text', 'lorem ipsum',
  'conversion goal', 'primary cta', 'secondary cta', 'metrics and security',
  // TR planning vocabulary
  'ürün kanıtı', 'değer önerisi', 'güven sinyalleri', 'harekete geçirici',
  'hedef kitle', 'kullanım senaryoları', 'referans müşteriler', 'teknik özellikler',
  'yer tutucu', 'metrikler ve güvenlik', 'sertifikalar', 'metrikler',
];
const STRONG_PLANNING_TERMS: readonly string[] = [
  'lorem ipsum', 'placeholder text', 'yer tutucu', 'ürün kanıtı', 'değer önerisi',
  'proof points', 'proof point', 'trust signals',
];
const PAREN_SLASH_ENUM_RE = /\([^)]*\/[^)]*\)/; // e.g. "(demo/ekran)", "(a/b/c)"

/** True when a PUBLIC copy string reads as internal planning metadata. Conservative. */
function looksLikeInternalPlanningCopy(raw: string | undefined): boolean {
  const s = (raw || '').trim().toLowerCase();
  if (s.length < 3) return false;
  if (STRONG_PLANNING_TERMS.some((t) => s.includes(t))) return true;
  const parenSlash = PAREN_SLASH_ENUM_RE.test(s);
  let metaHits = 0;
  for (const t of INTERNAL_PLANNING_META_TERMS) { if (s.includes(t)) { metaHits += 1; if (metaHits >= 2) break; } }
  if (parenSlash && metaHits >= 1) return true;
  return metaHits >= 2;
}

/* ── Output file contract (Phase 12B target; declared, never generated here) ── */

const REQUIRED_FILES = ['src/main.tsx', 'src/App.tsx', 'src/styles.css'];
const RECOMMENDED_FILES = ['src/lib/designSystem.ts', 'src/data/siteContent.ts'];

const OUTPUT_REQUIREMENTS: string[] = [
  'Emit complete file contents for every file — no truncation.',
  'Use valid relative imports; no missing required imports; no duplicate file paths.',
  'No empty component bodies and no placeholder comments (e.g. "// TODO", "...").',
  'Preserve the final section order exactly.',
  'Preserve the final public copy (headline/subheadline/CTA/bullets) unless code escaping requires a mechanical adjustment.',
  'Accessible, semantic HTML with a mobile-first responsive layout.',
  'Respect prefers-reduced-motion for every animation.',
  'Local, static demo behavior only — any interactive/demo surface is a front-end sample.',
];
const OUTPUT_FORBIDDEN: string[] = [
  'No blank image rectangles or empty media placeholders presented as real assets.',
  'No fabricated metrics, reviews, logos, prices, inventory, listings or compliance badges.',
  'No runtime fetch/XHR/WebSocket calls; no backend, auth, payments or database.',
  'No real AI runtime or live data. Do NOT invent external image URLs; use ONLY the '
  + 'pre-approved provider stock image URLs supplied in assets.imageSlots[].url.',
  'No copying or imitating the internal template synthesizer output.',
];
const OUTPUT_SUCCESS: string[] = [
  'The build compiles as a static React + TypeScript + Tailwind project.',
  'Every final section renders as its own component in the final order.',
  'The look follows the selected visual direction, not a generic template.',
  'All copy shown is the provided final copy; nothing is fabricated.',
];

/* ── Safe anti-template fallbacks (only used when real artifacts provide none) ── */

const ANTI_TEMPLATE_FALLBACKS: string[] = [
  'Do not default to a centered hero followed by equal-weight three-card grids.',
  'Do not default to dark navy/black with gold/amber accents.',
  'Do not render every section as the same rounded card container.',
  'Use at least two visibly different section compositions when the architecture supports it.',
  'Let the selected visual direction control typography, spacing, surfaces and hero composition.',
];

/* ── Universal honesty rules (always present; reinforced by real policies) ───── */

const BASE_HONESTY_RULES: string[] = [
  'Never fabricate proof: no fake metrics, reviews, testimonials, logos, prices, inventory, listings, certifications or compliance.',
  'Required real material stays a labelled placeholder / manual-upload slot — never invented content presented as real.',
  'Any demo/interactive surface is a local, front-end-only sample; never implies a real backend, AI runtime or live data.',
  'AI-illustrative visuals are mood/atmosphere/texture only — never generated products, people, documents or evidence.',
];

/* ── The output contract is fully deterministic given the final sections. ────── */
function buildOutputContract(sectionComponentFiles: string[]): FrontendSpecOutputContract {
  return {
    format: 'frontend-files-v1',
    framework: 'react',
    language: 'typescript',
    styling: 'tailwind-css',
    requiredFiles: clean(REQUIRED_FILES, 16),
    recommendedFiles: clean(RECOMMENDED_FILES, 16),
    requiredSectionComponentFiles: clean(sectionComponentFiles, 64),
    allowedExtensions: ['tsx', 'ts', 'css'],
    requirements: clean(OUTPUT_REQUIREMENTS, 24),
    forbiddenPatterns: clean(OUTPUT_FORBIDDEN, 24),
    successCriteria: clean(OUTPUT_SUCCESS, 16),
  };
}

/** The honest generation stub — Phase 12A never runs a model. */
const NOT_RUN_GENERATION = {
  status: 'not-run' as const,
  reason: 'Phase 12A created the implementation contract only; the dedicated Frontend Builder model is not connected yet.',
};

/* ── The failed-open contract — still usable, honest, never throws. ──────────── */
function failedOpenSpec(input: FrontendBuildSpecInput): FrontendBuildSpecification {
  const items = Array.isArray(input.sectionItems) ? input.sectionItems : [];
  const sections: FrontendSpecSection[] = items.map((s, i) => ({
    id: str(s.id) || `section-${i + 1}`,
    name: str(s.name) || str(s.id) || `Section ${i + 1}`,
    order: i,
    purpose: firstOf(s.purpose),
    headline: firstOf(s.headline),
    subheadline: firstOf(s.sub),
    primaryCTA: firstOf(s.cta),
    bullets: clean(s.bullets, 8),
    interactionHints: [],
    assetSlotIds: [],
    motionLayerIds: [],
  }));
  const sectionComponentFiles = clean(
    sections.filter((s) => !/^footer$/i.test(s.id)).map((s) => sectionFilePath(s.id)), 64,
  );
  return {
    version: 'frontend-spec-v1',
    status: 'failed-open',
    language: str(input.lang) || 'en',
    prompt: str(input.prompt),
    identity: { siteType: str(input.brief?.type) || 'website' },
    designSystem: {
      rejectedDirections: [], colorTokens: {}, compositionRules: [], surfaceRules: [],
      componentStyleRules: [], proofRules: [], responsiveRules: [], accessibilityRules: [],
      templateTrapsToAvoid: clean(ANTI_TEMPLATE_FALLBACKS), mustAvoid: [], differentiationMoves: [],
    },
    architecture: {
      demoSurfaces: [], statefulDemoComponents: [],
      sectionOrder: sections.map((s) => s.id), sections,
    },
    assets: {
      cssSvgSlots: [], imageSlots: [], motionLayers: [],
      realSourceRequired: [], aiIllustrativeAllowed: [], forbiddenGenerated: [],
      honestyConstraints: clean(BASE_HONESTY_RULES),
    },
    researchEvidence: {
      status: 'not-run', didUseRealSources: false, sources: [], sourceBackedInsights: [],
      audienceExpectations: [], conversionPatterns: [], trustSignals: [], visualPatterns: [],
      risksToAvoid: [], differentiationOpportunities: [],
    },
    outputContract: buildOutputContract(sectionComponentFiles),
    honestyRules: clean(BASE_HONESTY_RULES),
    sourceTrace: ['failed-open: derivation error — final sections + minimum contract preserved'],
    missingInputs: [],
    warnings: ['Frontend Build Specification failed open — the contract still carries the final sections, basic copy and honesty rules.'],
    generation: { ...NOT_RUN_GENERATION },
    summary: 'Frontend Build Specification failed open (generation not-run).',
  };
}

const splitCsv = (s: unknown): string[] =>
  (typeof s === 'string' && s.trim() ? s.split(/[,·|]/).map((x) => x.trim()).filter(Boolean) : []);
const fileBase = (p: string): string => ((p || '').split('/').pop() || '').replace(/\.[a-z0-9]+$/i, '');
const isComponentPath = (p: string): boolean => /^src\/components\/.+\.tsx$/.test(p || '');

/** Slot/layer ids whose target maps to a section id (exact → section-prefixed →
 *  contained). Deterministic; no fuzzy model call. */
function slotIdsForSection(slots: ReadonlyArray<{ id: string; target: string }> | undefined, id: string): string[] {
  const nid = normId(id);
  if (!Array.isArray(slots) || !nid) return [];
  const out: string[] = [];
  for (const s of slots) {
    if (!s) continue;
    const t = normId(s.target);
    if (t === nid || t === `section${nid}` || (nid.length >= 4 && t.includes(nid))) {
      const sid = str(s.id);
      if (sid) out.push(sid);
    }
  }
  return out;
}

/**
 * Derive the model-native Frontend Build Specification (Phase 12A). Pure,
 * deterministic, network-free, bounded, non-mutating, JSON-serializable, fail-open.
 * Consolidates the real planning artifacts + FINAL section copy into one
 * authoritative contract; NEVER inspects the current synthesized files, never calls
 * a model/backend/provider, and keeps generation.status === 'not-run'.
 */
export function deriveFrontendBuildSpecification(input: FrontendBuildSpecInput): FrontendBuildSpecification {
  try {
    const lang = str(input.lang) || 'en';
    const brief = input.brief || ({} as WebBuildBrief);
    const items = Array.isArray(input.sectionItems) ? input.sectionItems : [];
    const plan = input.layoutPlan;

    const vi = input.verticalIntelligence;
    // A usable, classified, non-general sector — narrowed here so TS keeps the type.
    const viForId = vi && vi.sector !== 'general' && vi.status !== 'failed-open' ? vi : undefined;
    const eb = input.experienceBlueprint;
    const ca = input.research?.conceptAuthority;
    const ledger = input.thinkingLedger;
    const mdp = ledger?.modelDesignPlan;
    const ad = input.artDirection;
    const ve = ad?.visualExploration;
    const selected = ve?.candidates?.find((c) => c.id === ve.selectedCandidateId);
    const strat = input.strategy;
    const ic = strat?.interactionContract;
    const wep = strat?.websiteExperiencePlan;
    const pa = input.pageArchitecture;
    const vsp = input.visualSignaturePlan;
    const bp = input.blueprint;
    const ce = input.componentEngineer;
    const asset = input.assetDirector;
    const motion = input.motionComposer;
    const image = input.imagePipeline;

    // ── Identity (authority: Vertical Intelligence sector → Experience Blueprint →
    //    Concept Authority → brief/inferred). The PRIMARY sector is never replaced
    //    by audienceSector. ──
    const identity: FrontendSpecIdentity = {
      siteType: firstOf(eb?.siteExperienceType, brief.type, ledger?.conceptThesis) || 'website',
      primaryConcept: firstOf(ledger?.primaryConcept, ca?.primaryConcept, viForId?.subsector),
      sector: viForId?.sector,
      subsector: firstOf(viForId?.subsector),
      audienceSector: viForId?.audienceSector,
      classificationBasis: viForId?.classificationBasis,
      businessModel: viForId?.businessModel,
      websiteExperienceModel: firstOf(ic?.websiteExperienceModel, wep?.websiteExperienceModel, brief.websiteExperienceModel),
      pageScreenModel: firstOf(ic?.pageScreenModel, wep?.pageScreenModel, brief.pageScreenModel),
      primaryWebsiteExperience: firstOf(ic?.primaryWebsiteExperience, wep?.primaryWebsiteExperience, brief.primaryWebsiteExperience),
      primaryConversionIntent: firstOf(ic?.primaryConversionIntent, wep?.primaryConversionIntent, brief.primaryConversionIntent, vi?.conversionModel?.goal),
    };

    // ── Design system (authority: selected Visual Exploration → Art Direction
    //    structured → Visual Signature → Design Thinking (brief/ledger) → layout). ──
    const colorTokens: Record<string, string> = {};
    const putColor = (k: string, v: unknown): void => { if (nonEmpty(v) && !colorTokens[k]) colorTokens[k] = v.trim(); };
    const cs = ad?.colorSystem;
    if (cs) {
      putColor('background', cs.background); putColor('foreground', cs.foreground);
      putColor('accent', cs.accent); putColor('accent2', cs.accent2); putColor('muted', cs.muted);
      putColor('surface', cs.surface); putColor('border', cs.border); putColor('primary', cs.primary);
      putColor('secondary', cs.secondary); putColor('text', cs.text); putColor('gradient', cs.gradient);
    }
    putColor('accent', brief.artAccent); putColor('accent2', brief.artAccent2); putColor('background', brief.artBg);

    const componentStyleValues = ad?.componentStyleRules
      ? Object.values(ad.componentStyleRules).filter((v): v is string => typeof v === 'string') : [];
    const responsiveValues = ad?.responsiveDirection
      ? Object.values(ad.responsiveDirection).filter((v): v is string => typeof v === 'string') : [];
    const accessibilityValues = ad?.accessibilityDirection
      ? Object.values(ad.accessibilityDirection).filter((v): v is string => typeof v === 'string') : [];

    const rejectedCandidateNames = (ve?.candidates || [])
      .filter((c) => (ve?.rejectedCandidateIds || []).includes(c.id)).map((c) => c.name);
    let templateTraps = merge(CAP, mdp?.templateTraps, [brief.templateTrapsToAvoid], ve?.antiTemplateNotes);
    // Fold in Quality Director same-template + Reviewer anti-template findings.
    const qdTemplate = (input.qualityDirector?.issues || [])
      .filter((i) => /template|monoton|accent-overuse|dashboard-overuse|palette-mismatch/i.test(i.category))
      .map((i) => i.recommendation);
    const rvTemplate = (input.reviewer?.findings || [])
      .filter((f) => /template|visual|monoton/i.test(`${f.category} ${f.title}`)).map((f) => f.recommendation);
    templateTraps = merge(CAP, templateTraps, qdTemplate, rvTemplate);
    if (!templateTraps.length) templateTraps = clean(ANTI_TEMPLATE_FALLBACKS);

    const designSystem: FrontendSpecDesignSystem = {
      designThesis: firstOf(mdp?.designThesis, brief.designThesis),
      selectedVisualDirection: firstOf(selected?.name, mdp?.selectedVisualDirection, brief.selectedVisualDirection, vsp?.visualSignature),
      rejectedDirections: merge(CAP, rejectedCandidateNames, mdp?.rejectedLooks, [brief.rejectedDirections]),
      firstImpression: firstOf(mdp?.firstImpression, brief.firstImpression),
      paletteFamily: firstOf(selected?.paletteFamily, ad?.paletteFamily, mdp?.paletteFamily, brief.paletteFamily),
      paletteDecision: firstOf(mdp?.paletteDecision, brief.paletteDecision, selected?.paletteIntent, cs?.colorPsychologyReasoning),
      colorTokens,
      typographyDecision: firstOf(mdp?.typographyDecision, brief.typographyDecision, ad?.typographyProfile?.fontPairingIntent),
      typographyDirection: firstOf(ad?.typographyDirection, brief.typographyDirection, ad?.typographyProfile?.headingStyle),
      heroComposition: firstOf(selected?.heroComposition, ad?.heroTreatment?.composition, mdp?.heroComposition, brief.heroCompositionDecision, vsp?.heroVisualType, plan?.heroComposition),
      sectionRhythm: firstOf(mdp?.sectionRhythmDecision, ad?.sectionRhythmDirection, brief.sectionRhythmDecision, bp?.sectionRhythm, plan?.rhythm),
      visualSignature: firstOf(ad?.visualSignature, vsp?.visualSignature, brief.artVisualSignature, plan?.visualSystem?.motif),
      visualMetaphor: firstOf(ad?.visualMetaphor, brief.visualMetaphor, vsp?.primaryMotif),
      compositionRules: merge(CAP, ad?.compositionRules, brief.artCompositionRules),
      surfaceRules: merge(CAP, ad?.surfaceRules, brief.artSurfaceRules),
      componentStyleRules: merge(CAP, ad?.componentStyleHints, componentStyleValues),
      proofRules: merge(CAP, ad?.proofRules, brief.artProofRules),
      responsiveRules: merge(CAP, responsiveValues, [ad?.responsiveDesignDirection], [bp?.responsiveBehavior]),
      accessibilityRules: merge(CAP, accessibilityValues),
      templateTrapsToAvoid: templateTraps,
      mustAvoid: merge(CAP, ad?.mustAvoid, ad?.avoid, ledger?.mustNotBecome, vsp?.avoidVisuals),
      differentiationMoves: merge(CAP, [mdp?.differentiationMove], [brief.differentiationMove], [strat?.differentiation], ad?.visualDifferentiators),
    };

    // ── Architecture (authority: VI conversion → Strategy contract/CTA → EB →
    //    brief). Copy/section list are the FINAL passed sectionItems (authoritative). ──
    const sections: FrontendSpecSection[] = items.map((s, i) => {
      const id = str(s.id) || `section-${i + 1}`;
      const name = str(s.name) || str(s.id) || `Section ${i + 1}`;
      const bpS = (bp?.sections || []).find((x) => x.id === id) || (bp?.sections || []).find((x) => normId(x.id) === normId(id));
      const ceC = (ce?.componentPlan || []).find((c) => normId(c.usedBlueprintSection) === normId(name))
        || (ce?.componentPlan || []).find((c) => normId(c.name) === normId(pascal(id)) || normId(fileBase(c.filePath)) === normId(pascal(id)));
      const intent = (strat?.sectionIntent || []).find((si) => normId(si.section) === normId(name) || normId(si.section) === normId(id));
      const actions = (ic?.sectionActions && ic.sectionActions[id]) ? ic.sectionActions[id] : [];
      return {
        id,
        name,
        order: i,
        purpose: firstOf(s.purpose, bpS?.purpose, intent?.purpose),
        headline: firstOf(s.headline),
        subheadline: firstOf(s.sub),
        primaryCTA: firstOf(s.cta),
        bullets: clean(s.bullets, 8),
        componentHint: firstOf(ceC?.name, bpS ? pascal(id) : undefined),
        layoutVariant: firstOf(bpS?.variant, plan?.sectionVariants ? plan.sectionVariants[id] : undefined),
        visualModule: firstOf(bpS?.visualModule, ceC?.visualModule),
        density: firstOf(bpS?.density),
        interactionHints: merge(8, actions.map((a) => a.label), intent ? [intent.visitorQuestion] : []),
        assetSlotIds: merge(8, slotIdsForSection(asset?.slots, id), slotIdsForSection(image?.slots, id)),
        motionLayerIds: merge(8, slotIdsForSection(motion?.layers, id)),
      };
    });
    const sectionOrder = sections.map((s) => s.id);

    const architecture: FrontendSpecArchitecture = {
      architecture: firstOf(bp?.architecture, pa?.entryModel, plan?.pageArchitecture, plan?.archetype),
      navigationModel: firstOf(ic?.navigationModel, wep?.navigationModel, brief.navigationModel, bp?.navigationStyle, plan?.navigationStyle),
      navigationBehavior: firstOf(ic?.navigationBehavior, wep?.navigationBehavior, brief.navigationBehavior),
      entryFlowModel: firstOf(ic?.entryFlowModel, wep?.entryFlowModel, brief.entryFlowModel),
      entryScreen: firstOf(ic?.entryScreen, wep?.entryScreen, brief.entryScreen),
      postEntryScreen: firstOf(ic?.postEntryScreen, wep?.postEntryScreen, brief.postEntryScreen),
      conversionJourneyModel: firstOf(ic?.conversionJourneyModel, wep?.conversionJourneyModel, brief.conversionJourneyModel),
      primaryCTA: firstOf(vi?.conversionModel?.primaryCTA, strat?.ctaHierarchy?.primary, pa?.primaryCTA, eb?.primaryCTA, brief.primaryCTA),
      secondaryCTA: firstOf(vi?.conversionModel?.secondaryCTA, strat?.ctaHierarchy?.secondary, pa?.secondaryCTA, eb?.secondaryCTA, brief.secondaryCTA),
      demoSurfaces: merge(CAP, wep?.demoSurfaces, splitCsv(brief.demoSurfaces), ledger?.demoSurfaceMustShow),
      statefulDemoComponents: merge(CAP, ic?.requiredStatefulComponents, wep?.statefulDemoComponents, splitCsv(brief.statefulDemoComponents)),
      sectionOrder,
      sections,
    };

    // ── Assets (Asset Director / Image Pipeline / Motion Composer + VI visual truth). ──
    const imageSlots: FrontendSpecImageSlot[] = (image?.slots || []).slice(0, CAP).map((sl) => ({
      id: str(sl.id),
      target: str(sl.target),
      kind: str(sl.kind),
      source: str(sl.source),
      purpose: str(sl.purpose),
      prompt: firstOf(sl.prompt?.positive),
      placeholderLabel: firstOf(sl.placeholderLabel),
      manualUploadRecommended: !!sl.manualUploadRecommended,
      providerReady: !!sl.providerReady,
    })).filter((sl) => !!sl.id);
    const motionLayers: FrontendSpecMotionLayer[] = (motion?.layers || []).slice(0, CAP).map((ml) => ({
      id: str(ml.id),
      target: str(ml.target),
      pattern: str(ml.pattern),
      intensity: str(ml.intensity),
      purpose: str(ml.purpose),
      reducedMotionFallback: str(ml.reducedMotionFallback),
    })).filter((ml) => !!ml.id);
    const assets: FrontendSpecAssetPlan = {
      strategy: firstOf(asset?.assetStrategy, image?.imageStrategy),
      visualLanguage: firstOf(asset?.styleSystem?.visualLanguage, vsp?.primaryMotif),
      cssSvgSlots: merge(CAP, asset?.cssSvgNowSlots, (vsp?.svgAssets || []).map((a) => a.name)),
      imageSlots,
      motionLayers,
      realSourceRequired: merge(CAP, vi?.visualPolicy?.realSourceRequired, vi?.trustModel?.sourceRequiredProof),
      aiIllustrativeAllowed: merge(CAP, vi?.visualPolicy?.aiIllustrativeAllowed),
      forbiddenGenerated: merge(CAP, vi?.visualPolicy?.forbiddenGenerated, asset?.forbiddenAssets, image?.forbiddenImageContent),
      honestyConstraints: merge(CAP, asset?.honestyConstraints, vsp?.assetHonestyRules, [image?.generatedImagePolicy]),
    };

    // ── Research evidence (source-backed ONLY when real URLs exist; never copies
    //    deterministic recommendations into findings). ──
    const ev = vi?.researchPlan?.evidence;
    const validSources = (ev?.sources || []).filter((s) => nonEmpty(s?.url)).slice(0, RESEARCH_CAP);
    const genuine = !!ev && ev.didResearch === true && (ev.sourceCount || 0) > 0 && validSources.length > 0;
    const researchEvidence: FrontendSpecResearchEvidence = genuine
      ? {
        status: vi?.researchPlan?.status || 'not-run',
        didUseRealSources: true,
        provider: firstOf(ev?.provider),
        sources: validSources.map((s) => {
          const snip = str(s.snippet);
          return snip
            ? { title: str(s.title) || str(s.url), url: str(s.url), snippet: snip }
            : { title: str(s.title) || str(s.url), url: str(s.url) };
        }),
        sourceBackedInsights: clean(ev?.sourceBackedInsights, RESEARCH_CAP),
        audienceExpectations: clean(ev?.audienceExpectations, RESEARCH_CAP),
        conversionPatterns: clean(ev?.conversionPatterns, RESEARCH_CAP),
        trustSignals: clean(ev?.trustSignals, RESEARCH_CAP),
        visualPatterns: clean(ev?.visualPatterns, RESEARCH_CAP),
        risksToAvoid: clean(ev?.risksToAvoid, RESEARCH_CAP),
        differentiationOpportunities: clean(ev?.differentiationOpportunities, RESEARCH_CAP),
      }
      : {
        status: vi?.researchPlan?.status || 'not-run',
        didUseRealSources: false,
        sources: [], sourceBackedInsights: [], audienceExpectations: [], conversionPatterns: [],
        trustSignals: [], visualPatterns: [], risksToAvoid: [], differentiationOpportunities: [],
      };

    // ── Output file contract: one required component file per final section
    //    (footer excluded). Prefer a clean Component Engineer path, else derive it. ──
    const sectionComponentFiles: string[] = [];
    for (const sec of sections) {
      if (/^footer$/i.test(sec.id) || /footer/i.test(sec.name)) continue;
      const ceC = (ce?.componentPlan || []).find((c) => normId(fileBase(c.filePath)) === normId(pascal(sec.id)) || normId(c.name) === normId(pascal(sec.id)));
      const path = ceC && isComponentPath(ceC.filePath) ? ceC.filePath : sectionFilePath(sec.id);
      sectionComponentFiles.push(path);
    }
    const outputContract = buildOutputContract(clean(sectionComponentFiles, 64));

    // ── Honesty, source trace, missing inputs, warnings. ──
    const honestyRules = merge(16, BASE_HONESTY_RULES, vi?.trustModel?.forbiddenClaims, vi?.visualPolicy?.forbiddenGenerated);
    const present: Array<[string, unknown]> = [
      ['research', input.research], ['thinkingLedger', ledger], ['artDirection', ad], ['strategy', strat],
      ['experienceBlueprint', eb], ['verticalIntelligence', vi], ['pageArchitecture', pa],
      ['visualSignaturePlan', vsp], ['blueprint', bp], ['componentEngineer', ce], ['assetDirector', asset],
      ['motionComposer', motion], ['imagePipeline', image], ['reviewer', input.reviewer], ['qualityDirector', input.qualityDirector],
    ];
    const sourceTrace = clean(present.filter(([, v]) => !!v).map(([k]) => k), 24);
    // Artifacts whose absence downgrades a full 'ready' spec to 'partial'.
    const readyKeys: Array<[string, unknown]> = [
      ['artDirection', ad], ['strategy', strat], ['verticalIntelligence', viForId],
      ['experienceBlueprint', eb], ['componentEngineer', ce], ['assetDirector', asset],
      ['motionComposer', motion], ['imagePipeline', image],
    ];
    const missingInputs = clean(readyKeys.filter(([, v]) => !v).map(([k]) => k), 24);
    const warnings = merge(8, pa?.architectureWarnings, input.reviewer?.risks, vi?.warnings, vsp?.visualAssetWarnings);

    // ── Readiness. ──
    const designReady = !!(designSystem.selectedVisualDirection || designSystem.heroComposition || designSystem.visualSignature || designSystem.paletteFamily || designSystem.designThesis);
    const archReady = !!(architecture.architecture || architecture.navigationModel || architecture.primaryCTA) && sectionOrder.length > 0;
    const coreReady = sections.length >= 5 && nonEmpty(identity.siteType) && designReady && archReady
      && outputContract.requiredFiles.length > 0 && outputContract.requirements.length > 0;
    const status: FrontendBuildSpecStatus = coreReady && missingInputs.length === 0 ? 'ready' : 'partial';

    const summary = `Frontend Build Specification (${status}): ${sections.length} sections · sector ${identity.sector || 'n/a'} · ${outputContract.requiredSectionComponentFiles.length} component files · research ${researchEvidence.didUseRealSources ? 'source-backed' : 'none'} · generation not-run.`;

    // ── Phase 12F — final product-intent contradiction guard (pure, non-throwing). ──
    // Correct ONLY deterministic architecture/demo LABELS that provably contradict the
    // resolved product intent (a chat surface without explicit chat evidence; a
    // storefront/shopper surface without an actual store concept). Real section copy,
    // section order, research evidence, design direction, honesty rules and the output
    // contract are preserved untouched. Never silently deletes public copy — it filters
    // machine/demo labels + neutralizes drifting design labels, and records a warning.
    const guardIntent = resolveProductIntent({
      prompt: input.prompt,
      briefText: `${identity.siteType || ''} ${identity.primaryWebsiteExperience || ''} ${identity.businessModel || ''}`,
      primaryConcept: identity.primaryConcept || identity.sector,
      targetVertical: identity.subsector,
      lang: lang === 'tr' ? 'tr' : 'en',
    });
    const forbiddenDrift = guardIntent.forbiddenDriftLabels;
    const hasDrift = (s: string | undefined): boolean => {
      if (!s) return false;
      const low = s.toLowerCase();
      return forbiddenDrift.some((f) => low.includes(f));
    };
    const stripDrift = (xs: string[]): string[] => xs.filter((x) => !hasDrift(x));

    const gDemoSurfaces = stripDrift(architecture.demoSurfaces);
    const gStateful = stripDrift(architecture.statefulDemoComponents)
      .filter((c) => guardIntent.explicitChat || !/chat-?demo-?panel|chat-?panel/i.test(c));
    const gSections = sections.map((s) =>
      (Array.isArray(s.interactionHints) && s.interactionHints.some(hasDrift))
        ? { ...s, interactionHints: stripDrift(s.interactionHints) }
        : s);
    const neutralCTA = lang === 'tr' ? 'Ürün Demosunu Gör' : 'See Product Demo';
    const gPrimaryCTA = hasDrift(architecture.primaryCTA) ? neutralCTA : architecture.primaryCTA;
    const gSecondaryCTA = hasDrift(architecture.secondaryCTA) ? neutralCTA : architecture.secondaryCTA;

    const archDrift =
      gDemoSurfaces.length !== architecture.demoSurfaces.length ||
      gStateful.length !== architecture.statefulDemoComponents.length ||
      gPrimaryCTA !== architecture.primaryCTA ||
      gSecondaryCTA !== architecture.secondaryCTA ||
      gSections.some((s, i) => s !== sections[i]);
    const guardedArchitecture: FrontendSpecArchitecture = archDrift
      ? { ...architecture, demoSurfaces: gDemoSurfaces, statefulDemoComponents: gStateful, primaryCTA: gPrimaryCTA, secondaryCTA: gSecondaryCTA, sections: gSections }
      : architecture;

    // Drifting DESIGN labels (hero composition / visual metaphor / visual signature) are
    // neutralized — they are deterministic design labels, not public copy.
    const gHero = hasDrift(designSystem.heroComposition) ? undefined : designSystem.heroComposition;
    const gMetaphor = hasDrift(designSystem.visualMetaphor) ? undefined : designSystem.visualMetaphor;
    const gSignature = hasDrift(designSystem.visualSignature) ? undefined : designSystem.visualSignature;
    const designDrift = gHero !== designSystem.heroComposition || gMetaphor !== designSystem.visualMetaphor || gSignature !== designSystem.visualSignature;
    const guardedDesignSystem: FrontendSpecDesignSystem = designDrift
      ? { ...designSystem, heroComposition: gHero, visualMetaphor: gMetaphor, visualSignature: gSignature }
      : designSystem;

    const guardWarnings: string[] = [];
    if (archDrift || designDrift) {
      if (!guardIntent.explicitChat) guardWarnings.push(lang === 'tr'
        ? 'Sohbet olmayan ürün spesifikasyonundan çelişen sohbet-yüzeyi etiketleri kaldırıldı.'
        : 'Removed contradictory chat-surface labels from a non-chat product specification.');
      if (!guardIntent.catalogOriented) guardWarnings.push(lang === 'tr'
        ? 'Mağaza olmayan ürün spesifikasyonundan çelişen mağaza/alışverişçi-yüzeyi etiketleri kaldırıldı.'
        : 'Removed contradictory storefront/shopper-surface labels from a non-store product specification.');
    }
    // ── Phase 13B — PUBLIC-COPY sanitization guard. Blank any PUBLIC section copy
    //    (headline / subheadline / primaryCTA / bullets) that reads as INTERNAL planning
    //    metadata rather than real audience-facing copy, so the internal specification is
    //    never leaked verbatim as visible page text. Pure/deterministic/bounded: it blanks
    //    a leaked field (the builder then writes real copy) or drops a leaked bullet, and
    //    records a bounded warning. It never touches purpose/interactionHints (already
    //    internal) or copy that does not read as planning metadata.
    let copyLeaksSanitized = 0;
    const sanitizeSection = (s: FrontendSpecSection): FrontendSpecSection => {
      const headline = looksLikeInternalPlanningCopy(s.headline) ? undefined : s.headline;
      const subheadline = looksLikeInternalPlanningCopy(s.subheadline) ? undefined : s.subheadline;
      const primaryCTA = looksLikeInternalPlanningCopy(s.primaryCTA) ? undefined : s.primaryCTA;
      const srcBullets = Array.isArray(s.bullets) ? s.bullets : [];
      const bullets = srcBullets.filter((b) => !looksLikeInternalPlanningCopy(b));
      const changed =
        headline !== s.headline || subheadline !== s.subheadline ||
        primaryCTA !== s.primaryCTA || bullets.length !== srcBullets.length;
      if (!changed) return s;
      copyLeaksSanitized += 1;
      return { ...s, headline, subheadline, primaryCTA, bullets };
    };
    const sanitizedSections = guardedArchitecture.sections.map(sanitizeSection);
    const finalArchitecture: FrontendSpecArchitecture = copyLeaksSanitized
      ? { ...guardedArchitecture, sections: sanitizedSections }
      : guardedArchitecture;
    const copyGuardWarnings: string[] = [];
    if (copyLeaksSanitized) copyGuardWarnings.push(lang === 'tr'
      ? `${copyLeaksSanitized} bölümde herkese açık metin yerine sızan iç planlama metni temizlendi.`
      : `Sanitized leaked internal planning text from public copy in ${copyLeaksSanitized} section(s).`);

    const finalWarnings = merge(10, warnings, guardWarnings, copyGuardWarnings);
    const traceTags: string[] = [];
    if (archDrift || designDrift) traceTags.push('productIntentGuard');
    if (copyLeaksSanitized) traceTags.push('publicCopyGuard');
    const finalSourceTrace = traceTags.length ? clean(sourceTrace.concat(traceTags), 26) : sourceTrace;

    const built: FrontendBuildSpecification = {
      version: 'frontend-spec-v1',
      status,
      language: lang,
      prompt: str(input.prompt),
      identity,
      designSystem: guardedDesignSystem,
      architecture: finalArchitecture,
      assets,
      researchEvidence,
      outputContract,
      honestyRules,
      sourceTrace: finalSourceTrace,
      missingInputs,
      warnings: finalWarnings,
      generation: { ...NOT_RUN_GENERATION },
      summary,
    };

    // PR #510 — attach the structured Experience Architecture contract when the flag is on.
    // Derived DETERMINISTICALLY from THIS assembled spec + the user prompt (no model call);
    // fail-open (undefined ⇒ omit the field, spec byte-for-byte the pre-#510 contract).
    try {
      const experienceArchitecture = deriveExperienceArchitecturePlan(built, str(input.prompt));
      if (experienceArchitecture) built.experienceArchitecture = experienceArchitecture;
    } catch { /* never block the build on the planner */ }

    return built;
  } catch {
    return failedOpenSpec(input);
  }
}
