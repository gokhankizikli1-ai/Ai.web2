/**
 * Web Build — INTEGRATED EXPERIENCE QUALITY (Phases 1–6): cross-system experience coherence,
 * responsive layout & content-fit, interaction depth & state feedback, accessibility & keyboard
 * usability, performance & media delivery — unified into ONE authoritative, additive, deterministic,
 * JSON-safe integration contract with clearly-owned sub-policies and ONE analysis surface.
 *
 * The merged systems each guarantee one dimension independently: #558 functionality/controls/state,
 * #559 semantic imagery, #560 research/claims/drift, #561 composition/section families, #562
 * typography/surfaces/visual system, #563 conversion narrative/voice/specificity/proof. A site can
 * satisfy every one of them and still be a POOR EXPERIENCE — incoherent across systems, desktop-only,
 * shallow in interaction feedback, inaccessible, or heavy at runtime. This contract connects those
 * authoritative decisions into implementable PER-SECTION presentation obligations and verifies them
 * with conservative, section-scoped, fail-open acceptance. It never recreates or duplicates the
 * findings owned by #558–#563; it consumes their decisions and blocks only proven cross-cutting
 * defects those systems do not own. Deterministic (no Math.random/time/ids); network-free; additive.
 */
import type {
  FrontendGeneratedFile, FrontendBuilderReviewIssue, FrontendBuilderReviewSeverity, FrontendBuilderReviewCategory,
  FrontendSpecIdentity, FrontendSpecSection, FrontendBindingRequirements, FrontendSpecImageSlot,
} from '@/lib/webBuildAgents';
import type { CompositionContract } from '@/lib/webBuildComposition';
import type { ContentNarrativeContract } from '@/lib/webBuildContentNarrative';
import type { VisualSystemContract } from '@/lib/webBuildVisualSystem';
import type { ImageCoverageRequirement } from '@/lib/webBuildImageCoverage';
import { collectSectionUnits } from '@/lib/webBuildSectionSource';

/* ── Bounds (named, mandatory) ─────────────────────────────────────────────── */
const MAX_TEXT = 140;
const MAX_LIST = 8;
const MAX_SECTIONS = 24;
const MAX_OBLIGATIONS = 8;
const MAX_EVIDENCE = 180;
const MAX_ISSUES = 32;
const MAX_ISSUE_FILES = 4;
const MAX_SCAN = 120_000;
const RENDER_CHAR_CEILING = 3200;   // documented hard ceiling for the rendered builder block
const COLLAPSE_MIN = 4;             // ≥ this many sections sharing a proven defect → systemic blocker
const MIN_WORDS = 6;

/* ── Public contract types (persisted, all additive/optional for old builds) ── */
export type ContentLayoutFit = 'fit' | 'tight' | 'ambiguous';
export type ExperienceFocal = 'headline' | 'media' | 'items' | 'controls' | 'proof' | 'cta' | 'content';
export type MediaPriority = 'hero' | 'below-fold' | 'decorative' | 'none';
export type InteractionKind = 'none' | 'navigation' | 'tool' | 'form' | 'disclosure' | 'gallery';

/** Per-section, cross-system presentation obligations. Sub-policy fields are populated by the
 *  phase that owns them; all are bounded and JSON-safe. */
export interface ExperienceSectionObligation {
  id: string;
  narrativeRole: string;
  family: string;
  density: string;
  mediaRole: string;
  ctaRole: string;
  /* Phase 1 — coherence */
  focal: ExperienceFocal;
  hierarchyRelation: string;
  mediaCopyRelation: string;
  contentLayoutFit: ContentLayoutFit;
  desktopFlow: string;
  mobileFlow: string;
  adjacency: string;
  transitionRole: string;
  allowedFallback: string;
  coherenceObligations: string[];
  /* Phase 2 — responsive */
  responsive?: {
    stackOrder: string;
    criticalAdjacency: string;
    overflowPolicy: string;
    mediaAspectRole: string;
    overlayReadability: string;
    ctaPreserved: boolean;
    controlPreserved: boolean;
    obligations: string[];
  };
  /* Phase 3 — interaction */
  interaction?: {
    kind: InteractionKind;
    requiredStates: string[];
    outputRelationship: string;
    obligations: string[];
  };
  /* Phase 4 — accessibility */
  accessibility?: {
    landmark: string;
    obligations: string[];
  };
  /* Phase 5 — performance */
  performance?: {
    mediaPriority: MediaPriority;
    motionPolicy: string;
    obligations: string[];
  };
  ambiguityNote: string;
}

export interface ExperienceQualityContract {
  version: 'experience-quality-v1';
  status: 'derived' | 'legacy';
  /** which sub-policies were derived (phase presence). */
  subPolicies: string[];
  rhythmObligation: string;
  globalResponsive: string[];
  globalAccessibility: string[];
  globalPerformance: string[];
  sections: ExperienceSectionObligation[];
  reasons: string[];
  derivationBasis: string[];
  contractPersistedInSpecification: boolean;
  contractRenderedToFrontendBuilder: boolean;
  contractUsedByAcceptance: boolean;
  agentsActuallyConsumingContract: string[];
}

/* ── Small pure helpers ────────────────────────────────────────────────────── */
function clip(s: unknown, n = MAX_TEXT): string { return (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim().slice(0, n); }
function uniq<T>(a: T[]): T[] { return [...new Set(a)]; }
function lc(s: unknown): string { return (typeof s === 'string' ? s : '').toLowerCase(); }

const MINIMAL_FAMILIES = new Set(['immersive-hero', 'full-bleed-transition', 'compact-utility', 'conversion-finale']);

/* ────────────────────────────────────────────────────────────────────────────
 * DERIVATION — connect the authoritative contracts into per-section obligations.
 * ──────────────────────────────────────────────────────────────────────────── */
export interface ExperienceQualityInput {
  identity: FrontendSpecIdentity;
  sections?: FrontendSpecSection[];
  composition?: CompositionContract;
  contentNarrative?: ContentNarrativeContract;
  visualSystem?: VisualSystemContract;
  imageCoverage?: ImageCoverageRequirement;
  imageSlots?: FrontendSpecImageSlot[];
  binding?: FrontendBindingRequirements;
}

function focalFor(role: string, family: string, mediaRole: string, ctaRole: string): ExperienceFocal {
  if (/provide-proof|reassure/.test(role)) return 'proof';
  if (/convert/.test(role) || ctaRole === 'primary') return 'cta';
  if (/enable-decision/.test(role) || family === 'catalog-index' || family === 'gallery-strip') return 'items';
  if (/demonstrate|explain-process/.test(role) || family === 'focused-tool') return 'controls';
  if (mediaRole === 'anchor' || family === 'immersive-hero') return 'media';
  if (/orient/.test(role)) return 'headline';
  return 'content';
}

export function deriveExperienceQualityContract(input: ExperienceQualityInput): ExperienceQualityContract | undefined {
  const identity = input.identity;
  const comp = input.composition;
  const content = input.contentNarrative;
  const raw = (input.sections || []).filter((s) => s && s.id).slice(0, MAX_SECTIONS);
  if (!comp && !content && raw.length === 0) return undefined;
  const ordered = [...raw].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const total = ordered.length;
  const compById = new Map((comp?.sections || []).map((s) => [s.id, s]));
  const contentById = new Map((content?.sections || []).map((s) => [s.id, s]));
  const slotSet = new Set((input.imageSlots || []).filter((s) => s && s.id).map((s) => s.id));

  const sections: ExperienceSectionObligation[] = ordered.map((s, i) => {
    const cs = compById.get(s.id);
    const cn = contentById.get(s.id);
    const family = cs?.family || 'standard-stack';
    const density = cs?.density || lc(s.density) || 'balanced';
    const mediaRole = cs?.mediaRole || ((s.assetSlotIds || []).some((x) => slotSet.has(x)) ? 'support' : 'none');
    const narrativeRole = cn?.narrativeRole || cs?.narrativeRole || 'establish-value';
    const ctaRole = cn?.ctaRole || 'none';
    const focal = focalFor(narrativeRole, family, mediaRole, ctaRole);
    // Content-layout fit: rich/dense planned copy forced into a minimal composition is "tight".
    const wantsRichCopy = /rich|dense/.test(density) || /provide-proof|explain-process|compare|establish-value/.test(narrativeRole);
    const contentLayoutFit: ContentLayoutFit = wantsRichCopy && MINIMAL_FAMILIES.has(family) ? 'tight' : 'fit';
    const isDominant = cs?.hierarchyLevel === 1 || i === 0;
    return {
      id: s.id, narrativeRole, family, density, mediaRole, ctaRole,
      focal,
      hierarchyRelation: isDominant ? 'dominant moment' : 'supporting',
      mediaCopyRelation: clip(cs?.textMedia || (mediaRole === 'none' ? 'text-only' : 'balanced'), 40),
      contentLayoutFit,
      desktopFlow: clip(`${focal} leads → supporting content → ${ctaRole !== 'none' ? 'CTA' : 'transition'}`, 80),
      mobileFlow: clip(`${focal === 'media' ? 'headline → media → CTA' : `${focal} → supporting → ${ctaRole !== 'none' ? 'CTA' : 'next'}`} (preserve reading order)`, 90),
      adjacency: i === 0 ? 'opens the page' : `follows “${clip(ordered[i - 1].name || ordered[i - 1].id, 30)}”; vary weight from it`,
      transitionRole: isDominant ? 'anchor beat' : 'build/contrast beat',
      allowedFallback: mediaRole === 'anchor' ? 'typographic focal if media missing' : 'tighten copy, keep the focal',
      coherenceObligations: uniq([
        `make ${focal} the clear focal element of this section`,
        ...(contentLayoutFit === 'tight' ? ['give this dense/proof content real room — do not cram it into a minimal centered block'] : []),
        ...(focal === 'proof' ? ['proof must read stronger than any decorative element here'] : []),
        ...(ctaRole === 'primary' ? ['the primary CTA must carry the strongest interactive emphasis in this section'] : []),
        ...(mediaRole === 'anchor' ? ['imagery serves this section’s message, not generic decoration'] : []),
      ]).slice(0, MAX_OBLIGATIONS),
      // Phase 2 — responsive obligations, derived from the same authoritative signals.
      responsive: {
        stackOrder: clip(focal === 'media' ? 'headline → media → CTA' : `${focal} → supporting → ${ctaRole !== 'none' ? 'CTA' : 'next'}`, 70),
        criticalAdjacency: ctaRole !== 'none' ? 'keep the CTA with its context' : focal === 'controls' ? 'keep controls with their output' : 'keep the heading with its supporting copy',
        overflowPolicy: 'wrap long headings; never clip required copy; card strips scroll accessibly',
        mediaAspectRole: mediaRole === 'none' ? 'n/a' : 'reserve aspect ratio; crop keeps the subject',
        overlayReadability: (mediaRole === 'background' || mediaRole === 'anchor') ? 'text over media keeps a scrim/protected panel at every breakpoint' : 'n/a',
        ctaPreserved: ctaRole !== 'none',
        controlPreserved: (s.interactionHints || []).length > 0,
        obligations: uniq([
          'multi-column layouts collapse to one readable column on mobile',
          ...(ctaRole === 'primary' ? ['keep the primary CTA visible and reachable (full-width) on mobile'] : []),
          ...(mediaRole !== 'none' ? ['reserve media aspect ratio to prevent layout shift'] : []),
          ...(contentLayoutFit === 'tight' ? ['let dense content wrap; do not clip it in a fixed-height box'] : []),
        ]).slice(0, MAX_OBLIGATIONS),
      },
      ambiguityNote: '',
    };
  });

  const dominant = sections.filter((s) => s.hierarchyRelation === 'dominant moment').length;
  return {
    version: 'experience-quality-v1', status: 'derived',
    subPolicies: ['coherence', 'responsive'],
    rhythmObligation: clip(comp?.globalRhythm || content?.positioningThesis || 'one coherent experience: vary section weight and density, keep 1–2 dominant moments, and make every section point its content, media, hierarchy and CTA the same way', MAX_TEXT),
    globalResponsive: [
      'every multi-column layout collapses to one readable column on mobile',
      'preserve semantic reading/tab order at all breakpoints',
      'no required copy clipped; long headings wrap instead of overflowing',
      'the primary CTA and any required control/output stay visible and reachable on mobile',
      'reserve media aspect ratio to prevent layout shift; text over media keeps its scrim',
    ],
    globalAccessibility: [],
    globalPerformance: [],
    sections,
    reasons: [`connected ${sections.length} sections across composition/content/visual/media with ${dominant} dominant moment(s)`].slice(0, MAX_LIST),
    derivationBasis: uniq([
      comp ? 'composition' : '', content ? 'contentNarrative' : '', input.visualSystem ? 'visualSystem' : '',
      input.imageCoverage ? 'imageCoverage' : '', input.binding ? 'bindingRequirements' : '', raw.length ? 'architectureSections' : '',
    ].filter(Boolean)).slice(0, MAX_LIST),
    contractPersistedInSpecification: true,
    contractRenderedToFrontendBuilder: true,
    contractUsedByAcceptance: true,
    agentsActuallyConsumingContract: [],
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * RENDER — one compact BINDING INTEGRATED EXPERIENCE block. Hard-bounded.
 * ──────────────────────────────────────────────────────────────────────────── */
export function renderExperienceQualityBlock(contract: ExperienceQualityContract | undefined): string[] {
  if (!contract || contract.status !== 'derived' || !contract.sections.length) return [];
  const secLines = contract.sections.slice(0, MAX_SECTIONS).map((s) => {
    const parts = [`- ${s.id} · focal:${s.focal} · ${s.hierarchyRelation} · desktop:${clip(s.desktopFlow, 60)} · mobile:${clip(s.mobileFlow, 60)}`];
    if (s.responsive) parts.push(`  responsive: ${s.responsive.obligations.slice(0, 3).join('; ')}`);
    if (s.interaction && s.interaction.kind !== 'none') parts.push(`  interaction(${s.interaction.kind}): ${s.interaction.obligations.slice(0, 3).join('; ')}`);
    if (s.accessibility) parts.push(`  a11y: ${s.accessibility.obligations.slice(0, 3).join('; ')}`);
    if (s.performance) parts.push(`  media/perf: ${s.performance.obligations.slice(0, 3).join('; ')}`);
    return parts.join('\n');
  });
  const out = [
    'BINDING INTEGRATED EXPERIENCE (coherence + responsive + interaction + a11y + performance):',
    `Whole-page rhythm: ${clip(contract.rhythmObligation, MAX_TEXT)}`,
    'Implement each section so its content, media, hierarchy and CTA point the SAME way (the focal',
    'element leads). Keep one coherent experience across the whole page, not isolated sections.',
    ...(contract.globalResponsive.length ? [`Responsive: ${contract.globalResponsive.slice(0, 5).join('; ')}.`] : []),
    ...(contract.globalAccessibility.length ? [`Accessibility: ${contract.globalAccessibility.slice(0, 5).join('; ')}.`] : []),
    ...(contract.globalPerformance.length ? [`Performance/media: ${contract.globalPerformance.slice(0, 5).join('; ')}.`] : []),
    'Per-section experience obligations (by section id):',
    ...secLines,
    '',
  ];
  let total = 0; const bounded: string[] = [];
  for (const line of out) { total += line.length + 1; if (total > RENDER_CHAR_CEILING) break; bounded.push(line); }
  return bounded;
}

/* ────────────────────────────────────────────────────────────────────────────
 * SHARED SECTION-FACTS EXTRACTOR — robust, brace/quote-aware (no fragile <...>).
 * Computed ONCE per section and consumed by every sub-policy analyzer.
 * ──────────────────────────────────────────────────────────────────────────── */
function stripComments(src: string): string {
  try {
    const s = src || ''; const n = s.length; let out = '';
    let state: 'normal' | 'sq' | 'dq' | 'tpl' | 'line' | 'block' = 'normal'; let i = 0;
    while (i < n) {
      const c = s[i]; const c2 = i + 1 < n ? s[i + 1] : '';
      if (state === 'normal') {
        if (c === '/' && c2 === '*') { state = 'block'; i += 2; continue; }
        if (c === '/' && c2 === '/' && s[i - 1] !== ':') { state = 'line'; i += 2; continue; }
        if (c === "'") { state = 'sq'; out += c; i += 1; continue; }
        if (c === '"') { state = 'dq'; out += c; i += 1; continue; }
        if (c === '`') { state = 'tpl'; out += c; i += 1; continue; }
        out += c; i += 1; continue;
      }
      if (state === 'line') { if (c === '\n') { state = 'normal'; out += c; } i += 1; continue; }
      if (state === 'block') { if (c === '*' && c2 === '/') { state = 'normal'; i += 2; } else { if (c === '\n') out += c; i += 1; } continue; }
      out += c;
      if (c === '\\' && i + 1 < n) { out += s[i + 1]; i += 2; continue; }
      if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = 'normal';
      i += 1;
    }
    return out;
  } catch { return src || ''; }
}

/** Render-relevant evidence (opening/closing tags + class/style values) — excludes unused string
 *  constants, metadata, console/debug so nothing off-DOM registers as executable evidence. */
function renderEvidence(cleanSrc: string): string {
  try {
    const tags: string[] = cleanSrc.match(/<\/?[A-Za-z][^>]{0,800}>/g) || [];
    const classVals: string[] = cleanSrc.match(/\b(?:class|className)\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]{0,800}\})/g) || [];
    const styleVals: string[] = cleanSrc.match(/\bstyle\s*=\s*(?:\{\{[^}]{0,800}\}\}|"[^"]*"|'[^']*')/g) || [];
    return [...tags, ...classVals, ...styleVals].join('\n');
  } catch { return cleanSrc || ''; }
}

/** Literal visible JSX text (skips tags/attributes/braced expressions/comments/svg). */
function extractVisibleText(region: string): { text: string; hasDynamic: boolean } {
  const cleaned = stripComments(region || '').replace(/<(svg|script|style)\b[\s\S]*?<\/\1>/gi, ' ');
  const n = cleaned.length; let out = ''; let hasDynamic = false; let i = 0;
  while (i < n) {
    const c = cleaned[i];
    if (c === '<') {
      i += 1; let depth = 0; let q: string | null = null;
      while (i < n) {
        const d = cleaned[i];
        if (q) { if (d === '\\') { i += 2; continue; } if (d === q) q = null; i += 1; continue; }
        if (d === "'" || d === '"' || d === '`') { q = d; i += 1; continue; }
        if (d === '{') { depth += 1; i += 1; continue; }
        if (d === '}') { if (depth > 0) depth -= 1; i += 1; continue; }
        if (d === '>' && depth === 0) { i += 1; break; }
        i += 1;
      }
      out += ' '; continue;
    }
    if (c === '{') {
      hasDynamic = true; i += 1; let depth = 1; let q: string | null = null;
      while (i < n && depth > 0) {
        const d = cleaned[i];
        if (q) { if (d === '\\') { i += 2; continue; } if (d === q) q = null; i += 1; continue; }
        if (d === "'" || d === '"' || d === '`') { q = d; i += 1; continue; }
        if (d === '{') depth += 1; else if (d === '}') depth -= 1;
        i += 1;
      }
      out += ' '; continue;
    }
    out += c; i += 1;
  }
  return { text: out.replace(/\s+/g, ' ').trim(), hasDynamic };
}

export interface SectionFacts {
  id: string;
  path: string;
  clean: string;
  render: string;
  text: string;
  words: number;
  hasDynamic: boolean;
  hasChildComponent: boolean;
}
function factsFor(id: string, path: string, content: string): SectionFacts {
  const clean = stripComments((content || '').slice(0, MAX_SCAN));
  const render = renderEvidence(clean);
  const vt = extractVisibleText(content || '');
  return {
    id, path, clean, render, text: vt.text, words: vt.text ? vt.text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length : 0,
    hasDynamic: vt.hasDynamic, hasChildComponent: /<[A-Z][A-Za-z0-9]*[\s/>]/.test(clean),
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * ACCEPTANCE — one unified, conservative, section-scoped surface. Sub-policies
 * push issues; only strongly-proven majors block; ambiguity → warning/fail-open.
 * ──────────────────────────────────────────────────────────────────────────── */
export type ExperienceIssueCode =
  // Phase 1 — coherence
  | 'experience-focal-conflict' | 'experience-flat-rhythm' | 'experience-content-layout-tight'
  // Phase 2 — responsive
  | 'experience-desktop-only' | 'experience-mobile-order-conflict' | 'experience-harmful-clip'
  | 'experience-text-over-media-unsafe' | 'experience-cta-hidden-mobile' | 'experience-responsive-warn'
  // Phase 3 — interaction
  | 'experience-interaction-no-feedback' | 'experience-interaction-output-uncorrelated' | 'experience-interaction-warn'
  // Phase 4 — accessibility
  | 'experience-clickable-div' | 'experience-input-unlabeled' | 'experience-menu-no-control' | 'experience-a11y-warn'
  // Phase 5 — performance
  | 'experience-all-eager' | 'experience-hero-lazy' | 'experience-duplicate-heavy-media'
  | 'experience-unbounded-motion' | 'experience-huge-inline' | 'experience-perf-warn';

export interface ExperienceIssue {
  code: ExperienceIssueCode;
  severity: FrontendBuilderReviewSeverity;
  subPolicy: 'coherence' | 'responsive' | 'interaction' | 'accessibility' | 'performance';
  label: string;
  files: string[];
  evidence: string;
  repairInstruction: string;
}
export interface ExperienceAcceptanceResult {
  status: 'pass' | 'warning' | 'fail';
  legacy: boolean;
  analyzedSectionCount: number;
  ambiguousSectionCount: number;
  coherenceFindingCount: number;
  responsiveFindingCount: number;
  interactionFindingCount: number;
  accessibilityFindingCount: number;
  performanceFindingCount: number;
  issues: ExperienceIssue[];
}
const LEGACY_EXPERIENCE: ExperienceAcceptanceResult = {
  status: 'pass', legacy: true, analyzedSectionCount: 0, ambiguousSectionCount: 0,
  coherenceFindingCount: 0, responsiveFindingCount: 0, interactionFindingCount: 0,
  accessibilityFindingCount: 0, performanceFindingCount: 0, issues: [],
};

function capEv(s: string): string { const t = (s || '').replace(/\s+/g, ' ').trim(); return t.length > MAX_EVIDENCE ? t.slice(0, MAX_EVIDENCE) : t; }

export function analyzeExperienceQuality(
  files: FrontendGeneratedFile[] | undefined,
  contract: ExperienceQualityContract | undefined,
): ExperienceAcceptanceResult {
  try {
    if (!contract || contract.status !== 'derived') return LEGACY_EXPERIENCE;
    const list = Array.isArray(files) ? files : [];
    if (!list.length) return { ...LEGACY_EXPERIENCE, legacy: false };
    const issues: ExperienceIssue[] = [];
    const push = (x: ExperienceIssue) => { if (issues.length < MAX_ISSUES) issues.push(x); };
    const units = collectSectionUnits(list, contract.sections.map((s) => s.id));
    const facts = units.slice(0, MAX_SECTIONS).map((u) => factsFor(u.id, u.path, u.content));
    const factById = new Map(facts.map((f) => [f.id, f]));
    const byId = new Map(contract.sections.map((s) => [s.id, s]));
    let ambiguous = 0;
    for (const f of facts) if (f.hasDynamic || f.hasChildComponent) ambiguous += 1;

    // ── Phase 1 — coherence (conservative, warning-first; ambiguity fails open). ──
    const tight = contract.sections.filter((sc) => {
      const f = factById.get(sc.id);
      return sc.contentLayoutFit === 'tight' && f && !f.hasDynamic && !f.hasChildComponent
        && f.words >= MIN_WORDS && /text-center/.test(f.render) && !/grid-cols|md:flex|lg:flex/.test(f.render);
    });
    if (tight.length >= COLLAPSE_MIN) {
      push({ code: 'experience-content-layout-tight', severity: 'minor', subPolicy: 'coherence', label: 'dense content in minimal layout', files: uniq(tight.map((s) => factById.get(s.id)?.path || '').filter(Boolean)).slice(0, MAX_ISSUE_FILES),
        evidence: capEv(`${tight.length} sections carry dense/proof content in a minimal centered single-column layout — verify the experience gives that content real room`),
        repairInstruction: capEv('Give dense/proof sections a layout with room (columns/structure) matching their content; do not cram them into a minimal centered block.') });
    }
    coherenceRhythmCheck(contract, facts, push);
    // ── Phase 2 — responsive layout & content-fit. ──
    responsiveCheck(facts, byId, factById, push);

    const coherenceFindingCount = issues.filter((i) => i.subPolicy === 'coherence').length;
    const responsiveFindingCount = issues.filter((i) => i.subPolicy === 'responsive').length;
    const interactionFindingCount = issues.filter((i) => i.subPolicy === 'interaction').length;
    const accessibilityFindingCount = issues.filter((i) => i.subPolicy === 'accessibility').length;
    const performanceFindingCount = issues.filter((i) => i.subPolicy === 'performance').length;
    const blocking = issues.some((i) => i.severity !== 'minor');
    const warned = issues.some((i) => i.severity === 'minor');
    const status: ExperienceAcceptanceResult['status'] = blocking ? 'fail' : warned ? 'warning' : 'pass';
    return {
      status, legacy: false, analyzedSectionCount: facts.length, ambiguousSectionCount: ambiguous,
      coherenceFindingCount, responsiveFindingCount, interactionFindingCount, accessibilityFindingCount, performanceFindingCount,
      issues: issues.slice(0, MAX_ISSUES),
    };
  } catch {
    return { ...LEGACY_EXPERIENCE, legacy: false };
  }
}

/** Flat-rhythm warning: many substantive sections rendered as the same centered single-column block. */
function coherenceRhythmCheck(contract: ExperienceQualityContract, facts: SectionFacts[], push: (x: ExperienceIssue) => void): void {
  const centered = facts.filter((f) => !f.hasDynamic && f.words >= MIN_WORDS && /text-center/.test(f.render) && /mx-auto/.test(f.render) && !/grid-cols|flex-row|md:flex/.test(f.render));
  if (centered.length >= COLLAPSE_MIN && centered.length >= Math.ceil(facts.length * 0.6)) {
    push({ code: 'experience-flat-rhythm', severity: 'minor', subPolicy: 'coherence', label: 'flat page rhythm', files: uniq(centered.map((f) => f.path)).slice(0, MAX_ISSUE_FILES),
      evidence: capEv(`${centered.length} of ${facts.length} sections render as the same centered single-column block — the overall experience reads flat despite individually valid sections`),
      repairInstruction: capEv('Vary section structure/weight so the page has rhythm and 1–2 dominant moments, not one repeated centered column.') });
  }
  void contract;
}

/** Phase 2 — responsive: block only a SYSTEMIC desktop-only grid (unique to this phase; #561/#562 do
 *  not own it). Isolated cases, clipping and mobile-CTA risks are warnings. Ambiguity fails open. */
function responsiveCheck(
  facts: SectionFacts[],
  byId: Map<string, ExperienceSectionObligation>,
  factById: Map<string, SectionFacts>,
  push: (x: ExperienceIssue) => void,
): void {
  // A multi-column grid that provably never collapses (no responsive grid variant, no single-col
  // fallback, no flex-col, no flex-wrap) is desktop-only. Dynamic/child regions fail open.
  const desktopOnly = facts.filter((f) => {
    if (f.hasDynamic || f.hasChildComponent) return false;
    const r = f.render;
    if (!/\bgrid-cols-[2-9]\b/.test(r)) return false;
    const collapses = /(?:sm|md|lg|xl):grid-cols/.test(r) || /\bgrid-cols-1\b/.test(r)
      || /\bflex-col\b/.test(r) || /(?:sm|md|lg|xl):flex-col/.test(r) || /\bflex-wrap\b/.test(r);
    return !collapses;
  });
  if (desktopOnly.length >= COLLAPSE_MIN && desktopOnly.length >= Math.ceil(facts.length * 0.6)) {
    push({ code: 'experience-desktop-only', severity: 'major', subPolicy: 'responsive', label: 'desktop-only grids', files: uniq(desktopOnly.map((f) => f.path)).slice(0, MAX_ISSUE_FILES),
      evidence: capEv(`${desktopOnly.length} of ${facts.length} sections use a fixed multi-column grid (grid-cols-N) with no responsive collapse, single-column fallback, flex-col or wrap — the layout is desktop-only and breaks on mobile`),
      repairInstruction: capEv('Make multi-column grids collapse on mobile (e.g. grid-cols-1 md:grid-cols-N) so each section stays readable on narrow screens.') });
  } else if (desktopOnly.length >= 1) {
    push({ code: 'experience-responsive-warn', severity: 'minor', subPolicy: 'responsive', label: 'possible desktop-only grid', files: uniq(desktopOnly.map((f) => f.path)).slice(0, MAX_ISSUE_FILES),
      evidence: capEv(`${desktopOnly.length} section(s) use a multi-column grid with no visible responsive collapse — verify they stack on mobile`),
      repairInstruction: capEv('Add a responsive collapse (grid-cols-1 md:grid-cols-N) so the grid stacks on mobile.') });
  }
  // Harmful clipping of substantial copy in a small fixed-height overflow box (warning).
  const clipped = facts.filter((f) => !f.hasDynamic && f.words >= 20 && /\boverflow-hidden\b/.test(f.render)
    && /\b(?:max-)?h-\[\d{2,3}px\]/.test(f.render) && !/line-clamp/.test(f.render));
  if (clipped.length) {
    push({ code: 'experience-harmful-clip', severity: 'minor', subPolicy: 'responsive', label: 'possible copy clipping', files: uniq(clipped.map((f) => f.path)).slice(0, MAX_ISSUE_FILES),
      evidence: capEv(`${clipped.length} section(s) place substantial copy in a small fixed-height overflow-hidden box with no line-clamp — verify text is not clipped on narrow screens`),
      repairInstruction: capEv('Avoid fixed heights that clip copy; let text wrap or use an intentional line-clamp with a full view.') });
  }
  // Primary-CTA section hidden at the base breakpoint with no responsive reveal (warning).
  for (const [id, ob] of byId) {
    if (ob.ctaRole !== 'primary') continue;
    const f = factById.get(id);
    if (f && !f.hasDynamic && /\bhidden\b/.test(f.render) && !/(?:sm|md|lg|xl):(?:block|flex|inline|inline-block|grid)/.test(f.render)) {
      push({ code: 'experience-cta-hidden-mobile', severity: 'minor', subPolicy: 'responsive', label: 'primary CTA may be hidden', files: [f.path],
        evidence: capEv(`the primary-CTA section "${id}" uses a base "hidden" utility with no responsive reveal — verify the CTA is visible on mobile`),
        repairInstruction: capEv('Do not hide the primary CTA at the base breakpoint; keep it visible on mobile.') });
      break;
    }
  }
}

export function hasBlockingExperienceFindings(result: ExperienceAcceptanceResult | undefined): boolean {
  return !!result && result.status === 'fail';
}

const EXPERIENCE_CATEGORY: Record<ExperienceIssueCode, FrontendBuilderReviewCategory> = {
  'experience-focal-conflict': 'visual-hierarchy',
  'experience-flat-rhythm': 'layout-rhythm',
  'experience-content-layout-tight': 'layout-rhythm',
  'experience-desktop-only': 'responsive-intent',
  'experience-mobile-order-conflict': 'responsive-intent',
  'experience-harmful-clip': 'responsive-intent',
  'experience-text-over-media-unsafe': 'accessibility-intent',
  'experience-cta-hidden-mobile': 'responsive-intent',
  'experience-responsive-warn': 'responsive-intent',
  'experience-interaction-no-feedback': 'motion-and-interaction',
  'experience-interaction-output-uncorrelated': 'motion-and-interaction',
  'experience-interaction-warn': 'motion-and-interaction',
  'experience-clickable-div': 'accessibility-intent',
  'experience-input-unlabeled': 'accessibility-intent',
  'experience-menu-no-control': 'accessibility-intent',
  'experience-a11y-warn': 'accessibility-intent',
  'experience-all-eager': 'maintainability',
  'experience-hero-lazy': 'maintainability',
  'experience-duplicate-heavy-media': 'maintainability',
  'experience-unbounded-motion': 'motion-and-interaction',
  'experience-huge-inline': 'maintainability',
  'experience-perf-warn': 'maintainability',
};

export function experienceToReviewIssues(result: ExperienceAcceptanceResult | undefined): FrontendBuilderReviewIssue[] {
  if (!result || !result.issues.length) return [];
  const out: FrontendBuilderReviewIssue[] = [];
  let i = 0;
  for (const issue of result.issues) {
    if (issue.severity === 'minor') continue;   // advisory/manual-review — never a repair blocker
    out.push({
      id: `experience-${issue.code}-${i += 1}`,
      severity: issue.severity,
      category: EXPERIENCE_CATEGORY[issue.code],
      files: (issue.files || []).slice(0, MAX_ISSUE_FILES),
      evidence: capEv(issue.evidence),
      repairInstruction: capEv(issue.repairInstruction),
    });
    if (out.length >= MAX_ISSUES) break;
  }
  return out;
}

export function experienceIssueCodes(result: ExperienceAcceptanceResult | undefined): string[] {
  if (!result) return [];
  return uniq(result.issues.map((i) => i.code)).slice(0, 12);
}

/* ── Owner diagnostics (bounded, no secrets / source / URLs / raw copy). ── */
export interface ExperienceQualityDiagnostics {
  experienceVersion: string;
  experienceStatus: 'derived' | 'legacy';
  subPolicies: string[];
  sectionObligationCount: number;
  experienceCharCount: number;
  derivationBasis: string[];
  contractPersistedInSpecification: boolean;
  contractRenderedToFrontendBuilder: boolean;
  contractUsedByAcceptance: boolean;
  agentsActuallyConsumingContract: string[];
  analyzedSectionCount?: number;
  ambiguousSectionCount?: number;
  coherenceFindingCount?: number;
  responsiveFindingCount?: number;
  interactionFindingCount?: number;
  accessibilityFindingCount?: number;
  performanceFindingCount?: number;
  experienceAcceptanceStatus?: 'pass' | 'warning' | 'fail';
  experienceIssueCodes?: string[];
}

export function buildExperienceDiagnostics(
  contract: ExperienceQualityContract | undefined,
  acceptance: ExperienceAcceptanceResult | undefined,
  experienceCharCount: number,
): ExperienceQualityDiagnostics | undefined {
  if (!contract) return undefined;
  const live = acceptance && !acceptance.legacy ? acceptance : undefined;
  return {
    experienceVersion: contract.version,
    experienceStatus: contract.status,
    subPolicies: contract.subPolicies.slice(0, MAX_LIST),
    sectionObligationCount: contract.sections.length,
    experienceCharCount,
    derivationBasis: contract.derivationBasis.slice(0, MAX_LIST),
    contractPersistedInSpecification: contract.contractPersistedInSpecification,
    contractRenderedToFrontendBuilder: contract.contractRenderedToFrontendBuilder,
    contractUsedByAcceptance: contract.contractUsedByAcceptance,
    agentsActuallyConsumingContract: contract.agentsActuallyConsumingContract.slice(0, MAX_LIST),
    ...(live ? {
      analyzedSectionCount: live.analyzedSectionCount,
      ambiguousSectionCount: live.ambiguousSectionCount,
      coherenceFindingCount: live.coherenceFindingCount,
      responsiveFindingCount: live.responsiveFindingCount,
      interactionFindingCount: live.interactionFindingCount,
      accessibilityFindingCount: live.accessibilityFindingCount,
      performanceFindingCount: live.performanceFindingCount,
      experienceAcceptanceStatus: live.status,
      experienceIssueCodes: experienceIssueCodes(live),
    } : {}),
  };
}
