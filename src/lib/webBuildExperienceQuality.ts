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

function deriveInteraction(s: FrontendSpecSection, family: string): ExperienceSectionObligation['interaction'] {
  const hay = `${(s.interactionHints || []).join(' ')} ${s.purpose || ''} ${s.name || ''}`.toLowerCase();
  let kind: InteractionKind = 'none';
  if (family === 'focused-tool' || /finder|calculat|configurat|quiz|estimat|planner|builder|\btool\b|selector/.test(hay)) kind = 'tool';
  else if (/\bform\b|contact|newsletter|subscribe|sign ?up|booking|enquir|\bquote\b|register/.test(hay)) kind = 'form';
  else if (/\btab\b|accordion|\bfaq\b|toggle|expand|disclosure|collaps/.test(hay)) kind = 'disclosure';
  else if (/filter|sort|carousel|slider|gallery|lightbox|\bslide\b/.test(hay)) kind = 'gallery';
  else if (/\bnav\b|menu|hamburger/.test(hay)) kind = 'navigation';
  else if ((s.interactionHints || []).length > 0) kind = 'tool';
  if (kind === 'none') return undefined;
  const states: Record<InteractionKind, string[]> = {
    none: [],
    tool: ['default/empty state', 'selection state', 'a derived result that changes with input', 'a reset/change path'],
    form: ['default state', 'visible submit feedback (frontend-only)', 'a clear success or error message', 'disabled/invalid handling'],
    disclosure: ['expanded/collapsed state', 'a visible active/selected state', 'keyboard toggle'],
    gallery: ['selected/active item state', 'clear prev/next affordance', 'an empty/no-results state'],
    navigation: ['expanded/collapsed state', 'an operable close control', 'keyboard operation', 'responsive visibility'],
  };
  const output = kind === 'tool' ? 'the output sits with its controls and updates from them'
    : kind === 'form' ? 'submission feedback appears at the form (no fabricated network/booking/payment)'
    : 'the state change is visible in place';
  return {
    kind,
    requiredStates: states[kind].slice(0, MAX_OBLIGATIONS),
    outputRelationship: output,
    obligations: uniq([
      'controls are discoverable and keyboard-operable',
      'every state change produces visible feedback',
      output,
      ...(kind === 'tool' || kind === 'gallery' ? ['handle the empty/no-selection state gracefully'] : []),
    ]).slice(0, MAX_OBLIGATIONS),
  };
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
      // Phase 3 — interaction lifecycle, derived from binding/hints/family (states appropriate to the
      // requested feature only; never fabricate backend/network/loading where frontend-only is asked).
      interaction: deriveInteraction(s, family),
      // Phase 4 — accessibility obligations (context-aware; native semantics preferred over ARIA).
      accessibility: {
        landmark: i === 0 ? 'page header / hero region' : /footer|contact/.test(lc(s.purpose || s.name)) ? 'contentinfo/footer' : 'labelled section with a heading',
        obligations: uniq([
          'give this section a real heading in correct order',
          ...((s.interactionHints || []).length > 0 ? ['controls are real <button>/<a>, keyboard-operable, with a visible focus ring'] : []),
          ...(mediaRole !== 'none' ? ['images carry meaningful alt or are marked decorative (alt="")'] : []),
          ...(ctaRole !== 'none' ? ['the CTA is a real link/button with a clear accessible name'] : []),
        ]).slice(0, MAX_OBLIGATIONS),
      },
      // Phase 5 — performance / media delivery (reuse #559 media decisions; intelligent delivery only).
      performance: {
        mediaPriority: (i === 0 && mediaRole !== 'none') ? 'hero' : (family === 'full-bleed-transition' && mediaRole !== 'none') ? 'decorative' : mediaRole !== 'none' ? 'below-fold' : 'none',
        motionPolicy: 'motion is subtle and respects prefers-reduced-motion; no unbounded continuous animation on content',
        obligations: uniq([
          ...(i === 0 && mediaRole !== 'none' ? ['prioritize the hero/LCP image (eager, fetchpriority high); reserve its aspect ratio'] : []),
          ...(i > 0 && mediaRole !== 'none' ? ['lazy-load this below-fold image and reserve width/height/aspect to avoid layout shift'] : []),
          'avoid duplicating the same heavy media; avoid large inline base64 payloads',
          'motion respects prefers-reduced-motion; no unbounded continuous animation',
        ]).slice(0, MAX_OBLIGATIONS),
      },
      ambiguityNote: '',
    };
  });

  const dominant = sections.filter((s) => s.hierarchyRelation === 'dominant moment').length;
  return {
    version: 'experience-quality-v1', status: 'derived',
    subPolicies: ['coherence', 'responsive', 'interaction', 'accessibility', 'performance'],
    rhythmObligation: clip(comp?.globalRhythm || content?.positioningThesis || 'one coherent experience: vary section weight and density, keep 1–2 dominant moments, and make every section point its content, media, hierarchy and CTA the same way', MAX_TEXT),
    globalResponsive: [
      'every multi-column layout collapses to one readable column on mobile',
      'preserve semantic reading/tab order at all breakpoints',
      'no required copy clipped; long headings wrap instead of overflowing',
      'the primary CTA and any required control/output stay visible and reachable on mobile',
      'reserve media aspect ratio to prevent layout shift; text over media keeps its scrim',
    ],
    globalAccessibility: [
      'use semantic landmarks (header/nav/main/footer) and headings in order',
      'interactive elements are real <button>/<a>, keyboard-operable, with a visible focus ring',
      'every form control has an accessible name (label / aria-label)',
      'images carry meaningful alt or are marked decorative; do not label decorative images as content',
      'respect prefers-reduced-motion; never communicate state by colour alone',
      'prefer native semantics over redundant/invalid ARIA',
    ],
    globalPerformance: [
      'prioritize the hero/LCP image; never lazy-load it',
      'lazy-load below-fold images and reserve width/height/aspect to avoid layout shift',
      'do not duplicate the same heavy media across sections; avoid large inline base64 payloads',
      'motion respects prefers-reduced-motion; avoid unbounded continuous animation on content',
      'keep decorative effects (blur/filters) cheap; deliver responsive image sizes',
    ],
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
  | 'experience-flat-rhythm' | 'experience-content-layout-tight'
  // Phase 2 — responsive
  | 'experience-desktop-only' | 'experience-harmful-clip'
  | 'experience-cta-hidden-mobile' | 'experience-responsive-warn'
  // Phase 3 — interaction
  | 'experience-interaction-no-feedback' | 'experience-interaction-warn'
  // Phase 4 — accessibility
  | 'experience-clickable-div' | 'experience-input-unlabeled' | 'experience-menu-no-control' | 'experience-a11y-warn'
  // Phase 5 — performance
  | 'experience-all-eager' | 'experience-hero-lazy'
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
    // ── Phase 3 — interaction depth & state-feedback integrity. ──
    interactionCheck(byId, factById, push);
    // ── Phase 4 — accessibility & keyboard usability. ──
    accessibilityCheck(byId, factById, push);
    // ── Phase 5 — performance, media delivery & runtime resilience. ──
    performanceCheck(facts, byId, factById, push);

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

/** Phase 3 — interaction: verify the STATE→FEEDBACK loop is wired in the rendered component. #558 owns
 *  whether the control/outcome must exist; this owns whether declared state actually drives visible
 *  feedback. Blocks a required tool/form whose own region declares handlers+state but reads none of that
 *  state back into the JSX (a dead control). Everything else warns; dynamic/child regions fail open. */
function interactionCheck(
  byId: Map<string, ExperienceSectionObligation>,
  factById: Map<string, SectionFacts>,
  push: (x: ExperienceIssue) => void,
): void {
  for (const [id, ob] of byId) {
    const kind = ob.interaction?.kind;
    if (!kind || kind === 'none') continue;
    const f = factById.get(id);
    if (!f || f.hasDynamic || f.hasChildComponent) continue;   // state may live in a child/prop → fail open
    const region = f.clean;
    // Handlers are JSX attributes → detect via render evidence (excludes strings/comments), so a string
    // literal containing "onClick=" can never masquerade as a real handler.
    const hasHandler = /\bon(?:Click|Change|Submit|Input|KeyDown|Toggle)\s*=/.test(f.render);
    if (!hasHandler) continue;                                   // no local interactivity to judge
    const stateVars: string[] = [];
    const sre = /const\s*\[\s*(\w+)\s*,\s*set\w+\s*\]\s*=\s*(?:React\.)?useState/g;
    let m: RegExpExecArray | null; let guard = 0;
    while ((m = sre.exec(region)) && guard < 40) { guard += 1; if (m[1]) stateVars.push(m[1]); }
    // A state var is "read back" if it appears more than its single destructuring occurrence.
    const anyStateRead = stateVars.some((v) => (region.match(new RegExp(`\\b${v}\\b`, 'g')) || []).length > 1);
    // Conditional/feedback signals independent of named state (ternaries in JSX, aria-expanded, data-state).
    const hasConditionalFeedback = /\?\s*['"`]?[\w-]/.test(f.render) || /aria-(?:expanded|selected|current|pressed)=/.test(region) || /data-state=/.test(region);
    const noFeedback = (stateVars.length === 0 || !anyStateRead) && !hasConditionalFeedback;
    if (noFeedback && (kind === 'tool' || kind === 'form')) {
      push({ code: 'experience-interaction-no-feedback', severity: 'major', subPolicy: 'interaction', label: `${kind} without state feedback`, files: [f.path],
        evidence: capEv(`the required ${kind} section "${id}" declares interactive handlers but no declared state is read back into the UI and there is no conditional feedback — the control changes nothing visible`),
        repairInstruction: capEv(`Wire ${kind} state into the rendered UI so interactions produce visible feedback (selection/result/message); do not fabricate network/booking success.`) });
    } else if (noFeedback) {
      push({ code: 'experience-interaction-warn', severity: 'minor', subPolicy: 'interaction', label: `${kind} feedback unclear`, files: [f.path],
        evidence: capEv(`the ${kind} section "${id}" may not show a visible active/selected/expanded state — verify state changes are perceivable`),
        repairInstruction: capEv('Add a visible state (active/selected/expanded) so the interaction reads clearly.') });
    }
  }
}

/** Phase 4 — accessibility: block only strong, keyboard/name failures (#559 owns image existence,
 *  #562 owns contrast). Native semantics satisfy requirements; absent-keyword alone never blocks. */
function accessibilityCheck(
  byId: Map<string, ExperienceSectionObligation>,
  factById: Map<string, SectionFacts>,
  push: (x: ExperienceIssue) => void,
): void {
  for (const [id, ob] of byId) {
    const f = factById.get(id);
    if (!f || f.hasDynamic || f.hasChildComponent) continue;   // fail open on ambiguous structure
    // JSX-attribute signals (controls, labels, roles) live in tags → use render evidence so strings/
    // comments can never satisfy or trip these checks. (useState lives in JS → read from f.clean below.)
    const r = f.render;
    // 1. Interactive control implemented ONLY as a non-focusable clickable div/span (no real button/
    //    link, no role=button, no tabIndex, no key handler) → not keyboard-operable.
    const divClick = /<(?:div|span)\b[^>]{0,300}\bon(?:Click|MouseDown)\s*=/.test(r);
    const hasRealControl = /<button\b/.test(r) || /<a\b[^>]*\bhref=/.test(r);
    const hasKeyAffordance = /role=["']button["']/.test(r) || /\btabIndex\b/.test(r) || /\bonKeyDown\s*=/.test(r) || /\bonKeyPress\s*=/.test(r);
    if (divClick && !hasRealControl && !hasKeyAffordance && ob.interaction && ob.interaction.kind !== 'none') {
      push({ code: 'experience-clickable-div', severity: 'major', subPolicy: 'accessibility', label: 'clickable div control', files: [f.path],
        evidence: capEv(`the interactive section "${id}" implements its control as a clickable <div>/<span> with no real button/link, role or keyboard handler — it is not keyboard-operable`),
        repairInstruction: capEv('Use a real <button>/<a> for the control (or add role="button", tabIndex and a key handler) so it is keyboard-operable.') });
    }
    // 2. Form control with NO accessible name at all (no <label>, no aria-label/labelledby, no placeholder).
    const hasField = /<(?:input|textarea|select)\b/.test(r) && !/type=["'](?:hidden|submit|button)["']/.test(r);
    if (hasField) {
      const hasName = /<label\b/.test(r) || /aria-label(?:ledby)?=/.test(r);
      const hasPlaceholder = /\bplaceholder=/.test(r);
      if (!hasName && !hasPlaceholder) {
        push({ code: 'experience-input-unlabeled', severity: 'major', subPolicy: 'accessibility', label: 'unlabeled form field', files: [f.path],
          evidence: capEv(`section "${id}" renders a form control with no accessible name (no <label>, aria-label/labelledby or placeholder) — it cannot be identified by assistive tech`),
          repairInstruction: capEv('Give every form control an accessible name via a <label> (preferred) or aria-label.') });
      } else if (!hasName && hasPlaceholder) {
        push({ code: 'experience-a11y-warn', severity: 'minor', subPolicy: 'accessibility', label: 'placeholder-only field', files: [f.path],
          evidence: capEv(`section "${id}" labels a field with a placeholder only — verify it has a real <label> for assistive tech`),
          repairInstruction: capEv('Add a real <label> in addition to the placeholder.') });
      }
    }
    // 3. Mobile menu / disclosure that toggles but exposes no disclosure state / operable control (warning).
    if (ob.interaction && (ob.interaction.kind === 'navigation' || ob.interaction.kind === 'disclosure')) {
      const toggles = /\bon(?:Click|Toggle)\s*=/.test(r) || /useState/.test(f.clean);
      const exposes = /aria-(?:expanded|controls|hidden)=/.test(r) || /<button\b/.test(r);
      if (toggles && !exposes) {
        push({ code: 'experience-menu-no-control', severity: 'minor', subPolicy: 'accessibility', label: 'disclosure state not exposed', files: [f.path],
          evidence: capEv(`the ${ob.interaction.kind} in "${id}" toggles but exposes no aria-expanded/controls or button control — verify it is operable and announced`),
          repairInstruction: capEv('Use a <button> with aria-expanded/aria-controls for the disclosure/menu toggle and an operable close.') });
      }
    }
  }
}

/** Phase 5 — performance / media delivery. Reuses #559 media decisions (no new sourcing). Blocks only
 *  strong, high-impact systemic waste; unprovable runtime cost warns/fails open. */
function performanceCheck(
  facts: SectionFacts[],
  byId: Map<string, ExperienceSectionObligation>,
  factById: Map<string, SectionFacts>,
  push: (x: ExperienceIssue) => void,
): void {
  const imgOf = (r: string): string[] => r.match(/<img\b[^>]*>/gi) || [];
  const allImgs = facts.flatMap((f) => imgOf(f.render));
  const lazyImgs = allImgs.filter((t) => /loading=["']lazy["']/i.test(t));
  const sectionsWithImg = facts.filter((f) => imgOf(f.render).length > 0);
  // 1. All images eager (no lazy anywhere) on an image-heavy page (blocker).
  if (allImgs.length >= 6 && sectionsWithImg.length >= COLLAPSE_MIN && lazyImgs.length === 0) {
    push({ code: 'experience-all-eager', severity: 'major', subPolicy: 'performance', label: 'no lazy-loading', files: uniq(sectionsWithImg.map((f) => f.path)).slice(0, MAX_ISSUE_FILES),
      evidence: capEv(`${allImgs.length} images across ${sectionsWithImg.length} sections load eagerly with zero lazy-loading — below-fold media is downloaded up front, hurting load performance`),
      repairInstruction: capEv('Lazy-load below-fold images (loading="lazy") and keep only the hero/LCP image eager.') });
  }
  // 2. Hero/LCP image lazy-loaded (blocker).
  for (const [id, ob] of byId) {
    if (ob.performance?.mediaPriority !== 'hero') continue;
    const f = factById.get(id);
    if (f && !f.hasDynamic && imgOf(f.render).some((t) => /loading=["']lazy["']/i.test(t))) {
      push({ code: 'experience-hero-lazy', severity: 'major', subPolicy: 'performance', label: 'hero image lazy-loaded', files: [f.path],
        evidence: capEv(`the hero section "${id}" lazy-loads its image — the LCP image should load eagerly (with priority), not be deferred`),
        repairInstruction: capEv('Load the hero/LCP image eagerly (remove loading="lazy"; add fetchpriority="high").') });
      break;
    }
  }
  // 3. Unbounded continuous animation across several elements with NO reduced-motion anywhere (blocker).
  const reducedMotion = facts.some((f) => /motion-reduce:|prefers-reduced-motion/i.test(f.clean));
  const infinite = facts.reduce((acc, f) => acc + ((f.render.match(/\banimate-(?:spin|bounce|ping)\b/g) || []).length) + ((f.clean.match(/animation:[^;]*\binfinite\b/gi) || []).length), 0);
  if (infinite >= COLLAPSE_MIN && !reducedMotion) {
    push({ code: 'experience-unbounded-motion', severity: 'major', subPolicy: 'performance', label: 'unbounded motion, no reduced-motion', files: [],
      evidence: capEv(`${infinite} continuous/infinite animations run with no prefers-reduced-motion handling anywhere — this wastes runtime and ignores motion sensitivity`),
      repairInstruction: capEv('Gate continuous animations behind prefers-reduced-motion (motion-reduce:) and avoid unbounded animation on content.') });
  }
  // 4. Giant or repeated inline base64 payloads (blocker).
  const base64 = facts.flatMap((f) => f.clean.match(/data:(?:image|font)\/[^;]{1,20};base64,[A-Za-z0-9+/=]{2000,}/gi) || []);
  const huge = base64.filter((b) => b.length >= 40000);
  const repeated = base64.filter((b) => b.length >= 8000);
  const repeatedDup = new Set(repeated).size < repeated.length && repeated.length >= 3;
  if (huge.length >= 1 || repeatedDup) {
    push({ code: 'experience-huge-inline', severity: 'major', subPolicy: 'performance', label: 'huge/duplicated inline media', files: [],
      evidence: capEv(`${huge.length ? `a ${Math.round((huge[0]?.length || 0) / 1000)}KB inline base64 payload is embedded` : `${repeated.length} large inline base64 payloads (some duplicated) are embedded`} — inline media bloats the bundle and blocks parsing`),
      repairInstruction: capEv('Serve media as real image files (reuse the sourced assets) instead of embedding large/duplicated base64 inline.') });
  }
  // 5. Duplicate heavy media reused across many sections (warning — often intentional, e.g. logos).
  const srcCount = new Map<string, number>();
  for (const t of allImgs) { const m = /src=["']([^"']+)["']/i.exec(t); if (m && m[1] && !/logo|icon|favicon/i.test(m[1])) srcCount.set(m[1], (srcCount.get(m[1]) || 0) + 1); }
  const dup = [...srcCount.entries()].filter(([, c]) => c >= 3);
  if (dup.length) {
    push({ code: 'experience-perf-warn', severity: 'minor', subPolicy: 'performance', label: 'repeated large media', files: [],
      evidence: capEv(`${dup.length} image source(s) are reused in 3+ places — verify this is intentional (a shared asset), not duplicated heavy media`),
      repairInstruction: capEv('Reuse a single optimized asset reference; avoid loading the same heavy image many times unnecessarily.') });
  }
}

export function hasBlockingExperienceFindings(result: ExperienceAcceptanceResult | undefined): boolean {
  return !!result && result.status === 'fail';
}

const EXPERIENCE_CATEGORY: Record<ExperienceIssueCode, FrontendBuilderReviewCategory> = {
  'experience-flat-rhythm': 'layout-rhythm',
  'experience-content-layout-tight': 'layout-rhythm',
  'experience-desktop-only': 'responsive-intent',
  'experience-harmful-clip': 'responsive-intent',
  'experience-cta-hidden-mobile': 'responsive-intent',
  'experience-responsive-warn': 'responsive-intent',
  'experience-interaction-no-feedback': 'motion-and-interaction',
  'experience-interaction-warn': 'motion-and-interaction',
  'experience-clickable-div': 'accessibility-intent',
  'experience-input-unlabeled': 'accessibility-intent',
  'experience-menu-no-control': 'accessibility-intent',
  'experience-a11y-warn': 'accessibility-intent',
  'experience-all-eager': 'maintainability',
  'experience-hero-lazy': 'maintainability',
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
