/**
 * Web Build — BINDING CONVERSION NARRATIVE, BRAND VOICE, CONTENT SPECIFICITY, CTA HIERARCHY &
 * TRUTHFUL PROOF (Phase).
 *
 * ONE authoritative, additive, deterministic, JSON-safe content-narrative contract derived from the
 * EXISTING authoritative artifacts (identity/sector, conversion model, research-grounded direction +
 * approved-claim policy from #560, page composition from #561, binding requirements from #558, and
 * the sanitized section public copy) and consumed by BOTH frontend generation and deterministic
 * acceptance.
 *
 * The upstream systems already fix sector fidelity, functionality, imagery, composition and the
 * premium visual system — yet a generated site can obey all of them and still feel generic/AI-written
 * because its VISIBLE PUBLIC COPY lacks a coherent conversion narrative, section-specific message
 * roles, concrete specificity, a deliberate brand voice, cross-section continuity, a consistent CTA
 * hierarchy and truthful proof. This contract assigns every section a distinct message job and a
 * concrete specificity target WITHOUT forcing one universal funnel.
 *
 * Acceptance is conservative and section-scoped (reusing the shared #561/#562 section extractor and a
 * robust visible-text reader — never a fragile <...> regex). Only strongly-proven failures block:
 * a required substantive section with no correlated visible public content; ≥4 distinct substantive
 * sections collapsing to materially identical/generic propositions; internal planning language
 * visibly rendered; or the required conversion action absent from every relevant CTA under strong
 * authority. Fabricated-claim authority is DEFERRED to #560 (no duplicate findings). Everything else
 * is a manual-review warning. Deterministic (no Math.random/time/ids). Network-free. Fail-open;
 * additive/optional for old builds.
 */
import type {
  FrontendGeneratedFile, FrontendBuilderReviewIssue, FrontendBuilderReviewSeverity, FrontendBuilderReviewCategory,
  FrontendSpecIdentity, FrontendSpecSection, ArtDirectionArtifact, FrontendBindingRequirements,
} from '@/lib/webBuildAgents';
import type { ResearchDirectionContract } from '@/lib/webBuildResearchDirection';
import type { CompositionContract } from '@/lib/webBuildComposition';
import { collectSectionUnits } from '@/lib/webBuildSectionSource';

/* ── Bounds (named, mandatory) ─────────────────────────────────────────────── */
const MAX_TEXT = 160;
const MAX_LIST = 8;
const MAX_VOICE = 6;
const MAX_PROGRESSION = 10;
const MAX_ANCHORS = 10;
const MAX_SECTION_ANCHORS = 6;
const MAX_SECTIONS = 24;
const MAX_GENERIC = 28;
const MAX_CLAIM_REFS = 8;
const MAX_EVIDENCE = 180;
const MAX_ISSUES = 24;
const MAX_ISSUE_FILES = 4;
const MAX_SCAN = 120_000;
const RENDER_CHAR_CEILING = 2800;   // documented hard ceiling for the rendered builder block
const MIN_WORDS = 6;                 // substantive visible copy for a content section
const COLLAPSE_MIN = 4;              // ≥ this many sections collapsing → systemic blocker
const DUP_JACCARD = 0.7;             // token-set overlap for "materially identical" propositions

/* ── Public contract types (persisted, all additive/optional for old builds) ── */
export type NarrativeRole =
  | 'orient' | 'establish-value' | 'demonstrate' | 'explain-process' | 'reduce-risk'
  | 'provide-proof' | 'compare' | 'enable-decision' | 'convert' | 'reassure' | 'inform';
export type ProofMode = 'none' | 'user-approved' | 'qualitative' | 'demonstrative';
export type CtaRole = 'primary' | 'secondary' | 'none';
export type CopyDensity = 'minimal' | 'balanced' | 'rich';

export interface ContentSectionAssignment {
  id: string;
  narrativeRole: NarrativeRole;
  visitorQuestion: string;
  messageObjective: string;
  specificityAnchors: string[];
  proofMode: ProofMode;
  ctaRole: CtaRole;
  continuity: string;
  prohibitedGenericSubstitutes: string[];
  publicCopyRequired: boolean;
  copyDensity: CopyDensity;
}

export interface ContentNarrativeContract {
  version: 'content-narrative-v1';
  status: 'derived' | 'legacy';
  language: string;
  audience: string;
  audienceProblem: string;
  valueProposition: string;
  positioningThesis: string;
  brandVoice: string[];
  voiceProhibitions: string[];
  narrativeProgression: NarrativeRole[];
  primaryCtaRole: string;
  secondaryCtaRole: string;
  ctaLabelPolicy: string;
  proofPolicy: string;
  approvedClaimRefs: string[];        // opaque #560 fingerprints (never rendered publicly)
  prohibitedClaimClasses: string[];
  genericTerms: string[];
  sections: ContentSectionAssignment[];
  derivationBasis: string[];
  contractPersistedInSpecification: boolean;
  contractRenderedToFrontendBuilder: boolean;
  contractUsedByAcceptance: boolean;
  agentsActuallyConsumingContract: string[];
  reasons: string[];
}

/* ── Small pure helpers ────────────────────────────────────────────────────── */
function clip(s: unknown, n = MAX_TEXT): string { return (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim().slice(0, n); }
function uniq<T>(a: T[]): T[] { return [...new Set(a)]; }
function lc(s: unknown): string { return (typeof s === 'string' ? s : '').toLowerCase(); }

// Generic marker words that cannot INDEPENDENTLY prove specificity (not globally forbidden).
const GENERIC_TERMS = [
  'experience', 'solution', 'solutions', 'innovation', 'innovative', 'future', 'seamless', 'elevate',
  'transform', 'unlock', 'discover', 'premium', 'tailored', 'cutting-edge', 'empower', 'streamline',
  'revolutionize', 'world-class', 'next-level', 'game-changing', 'best-in-class', 'leverage',
  'synergy', 'excellence', 'journey', 'possibilities', 'reimagine', 'redefine', 'effortless',
];
const STOPWORDS = new Set(['the', 'and', 'for', 'you', 'your', 'our', 'with', 'that', 'this', 'from', 'are', 'was', 'has', 'have', 'will', 'can', 'all', 'not', 'but', 'they', 'their', 'its', 'a', 'an', 'to', 'of', 'in', 'on', 'at', 'is', 'it', 'we', 'us', 'be', 'as', 'or', 'by', 'more', 'get', 'let', 'now', 'new']);
const GENERIC_CTA = ['learn more', 'read more', 'explore', 'discover', 'see more', 'view more', 'click here', 'get started', 'find out', 'more info', 'see all', 'view all'];
const CONVERSION_ACTIONS = ['book', 'reserve', 'enquir', 'inquir', 'contact', 'quote', 'call ', 'buy', 'order', 'shop', 'purchase', 'subscribe', 'sign up', 'signup', 'register', 'apply', 'request', 'schedule', 'consult', 'demo', 'trial', 'add to cart', 'checkout', 'donate', 'join', 'hire', 'message us', 'start free', 'start your'];
// Internal planning terminology that must never surface as visible public copy.
const INTERNAL_MARKERS = [
  'visitor question', 'narrative role', 'message objective', 'conversion objective', 'composition family',
  'proof mode', 'copy density', 'interaction hint', 'internal guidance', 'section id', 'specificity anchor',
  'establish-value', 'explain-process', 'reduce-risk', 'provide-proof', 'enable-decision',
  'immersive-hero', 'editorial-split', 'asymmetric-media', 'narrative-rail', 'comparison-band',
  'feature-mosaic', 'sequential-steps', 'gallery-strip', 'focused-tool', 'proof-ledger', 'catalog-index',
  'full-bleed-transition', 'compact-utility', 'conversion-finale', 'standard-stack',
];

function tokens(s: string): string[] {
  return lc(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}
function contentWords(s: string): string[] {
  // significant, non-generic content words (the specificity signal)
  return tokens(s).filter((w) => !GENERIC_TERMS.includes(w));
}

/* ────────────────────────────────────────────────────────────────────────────
 * DERIVATION — one binding content-narrative contract from existing artifacts.
 * ──────────────────────────────────────────────────────────────────────────── */
export interface ContentNarrativeInput {
  identity: FrontendSpecIdentity;
  language?: string;
  sections?: FrontendSpecSection[];
  primaryCta?: string;
  secondaryCta?: string;
  conversionModel?: string;
  research?: ResearchDirectionContract;
  composition?: CompositionContract;
  binding?: FrontendBindingRequirements;
  artDirection?: ArtDirectionArtifact;
  prompt?: string;
}

function roleFromFamilyAndPurpose(family: string | undefined, purpose: string, index: number, total: number): NarrativeRole {
  const p = lc(purpose);
  if (/testimonial|review|proof|trusted|logos|clients|press|award|credential|accredit|case study|results/.test(p)) return 'provide-proof';
  if (/faq|guarantee|warranty|refund|secure|safety|privacy|reassur/.test(p)) return 'reduce-risk';
  if (/how it works|process|\bstep|workflow|timeline|itinerary/.test(p)) return 'explain-process';
  if (/compar|pricing|plans|packages|tiers|membership/.test(p)) return 'compare';
  if (/contact|book|quote|get started|enquir|reserve|sign ?up|subscribe|newsletter|apply/.test(p) || (index === total - 1 && total > 1)) return 'convert';
  if (/catalog|menu|products|listings|rooms|collection|shop|gallery|portfolio|destinations|inventory|fleet|properties/.test(p)) return 'enable-decision';
  if (/about|story|mission|who we|philosophy|values|heritage/.test(p)) return 'establish-value';
  switch (family) {
    case 'immersive-hero': case 'full-bleed-transition': return index === 0 ? 'orient' : 'reassure';
    case 'focused-tool': return 'demonstrate';
    case 'sequential-steps': return 'explain-process';
    case 'comparison-band': return 'compare';
    case 'proof-ledger': return 'provide-proof';
    case 'catalog-index': case 'gallery-strip': return 'enable-decision';
    case 'conversion-finale': return 'convert';
    case 'compact-utility': return 'inform';
    case 'feature-mosaic': return 'demonstrate';
    case 'narrative-rail': case 'editorial-split': return 'establish-value';
    default: return index === 0 ? 'orient' : 'establish-value';
  }
}

const ROLE_QUESTION: Record<NarrativeRole, string> = {
  orient: 'what is this and is it for me?',
  'establish-value': 'why does this matter to me?',
  demonstrate: 'what exactly do I get?',
  'explain-process': 'how does this work?',
  'reduce-risk': 'what if it goes wrong?',
  'provide-proof': 'why should I believe you?',
  compare: 'which option fits me?',
  'enable-decision': 'what can I choose from?',
  convert: 'how do I take the next step?',
  reassure: 'am I making a safe choice?',
  inform: 'what do I need to know?',
};
const ROLE_OBJECTIVE: Record<NarrativeRole, string> = {
  orient: 'state who this is for and the core promise in concrete terms',
  'establish-value': 'connect a real audience problem to a concrete benefit',
  demonstrate: 'show the specific offering/capability, not adjectives',
  'explain-process': 'lay out the real steps the visitor goes through',
  'reduce-risk': 'address a real objection with honest reassurance',
  'provide-proof': 'present only approved/real proof; never fabricated',
  compare: 'differentiate real options so the visitor can choose',
  'enable-decision': 'let the visitor browse/choose concrete items',
  convert: 'drive one clear next action appropriate to the business',
  reassure: 'reinforce a genuine reason to trust before deciding',
  inform: 'give a concrete, useful piece of information',
};

function densityFromFamily(family: string | undefined, density: string | undefined): CopyDensity {
  const d = lc(density);
  if (/minimal|sparse|airy/.test(d)) return 'minimal';
  if (/rich|dense|editorial/.test(d)) return 'rich';
  switch (family) {
    case 'immersive-hero': case 'full-bleed-transition': case 'compact-utility': case 'conversion-finale': return 'minimal';
    case 'narrative-rail': case 'comparison-band': case 'proof-ledger': return 'rich';
    default: return 'balanced';
  }
}

export function deriveContentNarrativeContract(input: ContentNarrativeInput): ContentNarrativeContract | undefined {
  const identity = input.identity;
  const research = input.research;
  const comp = input.composition;
  const ad = input.artDirection;
  const rawSections = (input.sections || []).filter((s) => s && s.id).slice(0, MAX_SECTIONS);
  if (!research && !ad && rawSections.length === 0) return undefined;
  const ordered = [...rawSections].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const total = ordered.length;
  const famById = new Map<string, string>();
  const roleById = new Map<string, string>();
  const densityById = new Map<string, string>();
  for (const s of comp?.sections || []) { famById.set(s.id, s.family); roleById.set(s.id, s.narrativeRole); densityById.set(s.id, s.density); }

  // Brand tokens (excluded from duplication signal) + global specificity anchors.
  const operator = clip(research?.operatorIdentity || identity.primaryConcept || identity.siteType, 60);
  const brandTokens = new Set(tokens(operator));
  const anchorPool = uniq([
    ...contentWords(identity.primaryConcept || ''),
    ...contentWords(String(identity.sector || '')),
    ...contentWords(String(identity.subsector || '')),
    ...ordered.flatMap((s) => contentWords(`${s.headline || ''} ${s.subheadline || ''} ${(s.bullets || []).join(' ')}`)),
  ].filter((w) => !brandTokens.has(w))).slice(0, MAX_ANCHORS);

  const sections: ContentSectionAssignment[] = ordered.map((s, i) => {
    const family = famById.get(s.id);
    const compRole = roleById.get(s.id);
    const role: NarrativeRole = compRole && isRole(compRole) ? compRole : roleFromFamilyAndPurpose(family, s.purpose || s.name || '', i, total);
    const density = densityFromFamily(family, densityById.get(s.id) || s.density);
    const sectionAnchors = uniq(contentWords(`${s.headline || ''} ${s.subheadline || ''} ${s.purpose || ''}`).filter((w) => !brandTokens.has(w)));
    const anchors = (sectionAnchors.length ? sectionAnchors : anchorPool).slice(0, MAX_SECTION_ANCHORS);
    const bindingId = bindingInteractiveId(s, input.binding);
    const ctaRole: CtaRole = (i === 0 || role === 'convert' || family === 'conversion-finale' || role === 'compare')
      ? 'primary' : (bindingId || role === 'enable-decision' || role === 'demonstrate') ? 'secondary' : 'none';
    const proofMode: ProofMode = role === 'provide-proof'
      ? ((research?.claimPolicy?.approvedPublicClaims?.length || 0) > 0 ? 'user-approved' : 'qualitative')
      : role === 'demonstrate' || family === 'focused-tool' ? 'demonstrative'
      : role === 'reduce-risk' ? 'qualitative' : 'none';
    const publicCopyRequired = density !== 'minimal' && role !== 'inform' && family !== 'catalog-index' && family !== 'gallery-strip';
    return {
      id: s.id,
      narrativeRole: role,
      visitorQuestion: ROLE_QUESTION[role],
      messageObjective: clip(s.purpose ? `${ROLE_OBJECTIVE[role]} (${clip(s.purpose, 60)})` : ROLE_OBJECTIVE[role], 120),
      specificityAnchors: anchors,
      proofMode,
      ctaRole,
      continuity: i === 0 ? 'opens the narrative' : `builds on “${clip(ordered[i - 1].name || ordered[i - 1].id, 40)}” toward the next step`,
      prohibitedGenericSubstitutes: GENERIC_TERMS.slice(0, 6),
      publicCopyRequired,
      copyDensity: density,
    };
  });

  // Cap dominant CTAs to at most two primaries (hero + conversion).
  let primaries = 0;
  for (const sec of sections) { if (sec.ctaRole === 'primary') { primaries += 1; if (primaries > 2) sec.ctaRole = 'secondary'; } }

  const narrativeProgression = uniq(sections.map((s) => s.narrativeRole)).slice(0, MAX_PROGRESSION);
  const approvedClaims = (research?.claimPolicy?.approvedPublicClaims || []).slice(0, MAX_CLAIM_REFS);
  const prohibitedClaimClasses = uniq([...(research?.claimPolicy?.forbiddenClaimClasses || []), ...(research?.forbiddenClaims || [])]).slice(0, MAX_LIST);

  const voice = uniq([
    clip(ad?.brandPersonality || research?.artDirection?.emotionalTone || 'clear', 30),
    clip(research?.artDirection?.emotionalTone || ad?.visualMood || 'confident', 30),
    'concrete', 'audience-first',
  ].filter(Boolean)).slice(0, MAX_VOICE);
  const isSoftware = research?.isSoftwareSector === true || identity.classificationBasis === 'product-concept'
    || identity.sector === 'ai-saas' || identity.sector === 'marketplace';

  return {
    version: 'content-narrative-v1', status: 'derived',
    language: clip(input.language || 'en', 12),
    audience: clip(research?.audience || String(identity.audienceSector || '') || 'the target visitor', 80),
    audienceProblem: clip(research?.conversionModel || input.conversionModel || identity.primaryConversionIntent || `choosing the right ${clip(identity.primaryConcept || identity.siteType || 'option', 40)}`, MAX_TEXT),
    valueProposition: clip(research?.artDirection?.distinctiveSignature || research?.artDirection?.visualThesis || ad?.visualMetaphor || identity.primaryConcept || 'a concrete, sector-true offering', MAX_TEXT),
    positioningThesis: clip(research?.artDirection?.visualThesis || research?.artDirection?.emotionalTone || ad?.brandPersonality || 'a distinctive, honest position', MAX_TEXT),
    brandVoice: voice,
    voiceProhibitions: uniq([
      'hype/superlatives without substance',
      'internal or technical jargon in public copy',
      'mixing formal and informal address inconsistently',
      ...(isSoftware ? [] : ['SaaS/automation/productivity language for a non-software operator']),
      ...((ad?.avoid || []).slice(0, 2).map((a) => clip(a, 60))),
    ]).slice(0, MAX_LIST),
    narrativeProgression,
    primaryCtaRole: clip(input.primaryCta || identity.primaryConversionIntent || 'the one decisive next action', 60),
    secondaryCtaRole: clip(input.secondaryCta || 'a low-commitment way to keep exploring', 60),
    ctaLabelPolicy: 'CTA labels must name the real action (e.g. book/enquire/get a quote/subscribe as appropriate); generic labels only where the destination is unambiguous.',
    proofPolicy: approvedClaims.length
      ? 'render only user-approved facts and qualitative trust language; never invent metrics, testimonials, awards or customers.'
      : 'use only qualitative, honest trust language; never invent facts, metrics, testimonials, awards or customers.',
    approvedClaimRefs: approvedClaims,
    prohibitedClaimClasses,
    genericTerms: GENERIC_TERMS.slice(0, MAX_GENERIC),
    sections,
    derivationBasis: uniq([
      rawSections.length ? 'architectureSections' : '',
      research ? 'researchDirection' : '',
      comp ? 'composition' : '',
      input.binding ? 'bindingRequirements' : '',
      ad ? 'artDirection' : '',
      research?.claimPolicy ? 'approvedClaimPolicy' : '',
      input.prompt ? 'userPrompt' : '',
    ].filter(Boolean)).slice(0, MAX_LIST),
    contractPersistedInSpecification: true,
    contractRenderedToFrontendBuilder: true,
    contractUsedByAcceptance: true,
    agentsActuallyConsumingContract: [],
    reasons: [`derived ${sections.length} section message roles across ${narrativeProgression.length} narrative stages`].slice(0, MAX_LIST),
  };
}

const NARRATIVE_ROLE_SET = new Set<string>(['orient', 'establish-value', 'demonstrate', 'explain-process', 'reduce-risk', 'provide-proof', 'compare', 'enable-decision', 'convert', 'reassure', 'inform']);
function isRole(s: string): s is NarrativeRole {
  return NARRATIVE_ROLE_SET.has(s);
}

/** Does this section correspond to an explicit binding interactive requirement? Returns its id. */
function bindingInteractiveId(s: FrontendSpecSection, binding: FrontendBindingRequirements | undefined): string | undefined {
  if (!binding || !Array.isArray(binding.requirements)) return undefined;
  const p = `${s.purpose || ''} ${s.name || ''} ${(s.interactionHints || []).join(' ')}`.toLowerCase();
  const req = binding.requirements.find((r) => r.required && (r.kind === 'interactive-experience' || r.kind === 'dynamic-outcome')
    && (p.includes((r.label || '').toLowerCase().split(/\s+/)[0] || '') || (r.aliases || []).some((a) => a && p.includes(a.toLowerCase()))));
  return req?.id;
}

/* ────────────────────────────────────────────────────────────────────────────
 * RENDER — one compact BINDING PUBLIC CONTENT & CONVERSION NARRATIVE block. Bounded.
 * ──────────────────────────────────────────────────────────────────────────── */
export function renderContentNarrativeBlock(contract: ContentNarrativeContract | undefined): string[] {
  if (!contract || contract.status !== 'derived' || !contract.sections.length) return [];
  const secLines = contract.sections.slice(0, MAX_SECTIONS).map((s) => {
    const cta = s.ctaRole === 'none' ? 'no CTA' : `${s.ctaRole} CTA`;
    const anchors = s.specificityAnchors.slice(0, 4).join(', ') || 'concrete sector nouns';
    return `- ${s.id} · job: ${clip(s.messageObjective, 90)} · use concrete: ${anchors} · ${cta} · proof: ${s.proofMode} · density: ${s.copyDensity}`;
  });
  const out = [
    'BINDING PUBLIC CONTENT & CONVERSION NARRATIVE:',
    `Language: ${contract.language}. Audience: ${clip(contract.audience, 80)}.`,
    `Value proposition: ${clip(contract.valueProposition, MAX_TEXT)}`,
    `Positioning: ${clip(contract.positioningThesis, 120)} · brand voice: ${contract.brandVoice.slice(0, 4).join(', ')}.`,
    'Render ONLY public-facing copy as visible content. NEVER render internal role names, visitor',
    'questions, planning labels, section ids or any of these contract terms as page text.',
    'Give EVERY section a distinct message job below; connect the copy into one coherent narrative',
    'with real continuity — do not repeat the same proposition in every section.',
    'Use concrete sector/product/service nouns; avoid interchangeable template slogans and generic',
    `filler (${contract.genericTerms.slice(0, 8).join(', ')}) as the ONLY content of a section.`,
    'Preserve any exact user-provided approved copy verbatim.',
    `CTA hierarchy: ${contract.ctaLabelPolicy} Primary action: ${clip(contract.primaryCtaRole, 50)}; secondary: ${clip(contract.secondaryCtaRole, 50)}.`,
    `Proof: ${contract.proofPolicy}`,
    'Keep copy density consistent with each section role; keep ALL visible copy in the language above.',
    'Section message jobs (by section id):',
    ...secLines,
    ...(contract.voiceProhibitions.length ? [`Voice prohibits: ${contract.voiceProhibitions.slice(0, 5).join('; ')}.`] : []),
    '',
  ];
  let total = 0;
  const bounded: string[] = [];
  for (const line of out) { total += line.length + 1; if (total > RENDER_CHAR_CEILING) break; bounded.push(line); }
  return bounded;
}

/* ────────────────────────────────────────────────────────────────────────────
 * VISIBLE-TEXT READER — robust scanner (skips tags/attributes/braced expressions,
 * comments, strings; never a fragile <...> regex). Returns literal visible text.
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

interface VisibleText { text: string; hasDynamic: boolean; }
/** Extract literal visible JSX text nodes, skipping tags (respecting quotes/braces so `=>` and
 *  `{a>b}` never truncate), braced expressions (marked dynamic), svg/script/style and comments. */
function extractVisibleText(region: string): VisibleText {
  const cleaned = stripComments(region || '').replace(/<(svg|script|style)\b[\s\S]*?<\/\1>/gi, ' ');
  const n = cleaned.length; let out = ''; let hasDynamic = false; let i = 0;
  while (i < n) {
    const c = cleaned[i];
    if (c === '<') {
      // consume a full tag: to the matching '>' at brace/quote depth 0.
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
      out += ' ';
      continue;
    }
    if (c === '{') {
      // JSX child expression — dynamic; skip balanced braces (respect strings).
      hasDynamic = true; i += 1; let depth = 1; let q: string | null = null;
      while (i < n && depth > 0) {
        const d = cleaned[i];
        if (q) { if (d === '\\') { i += 2; continue; } if (d === q) q = null; i += 1; continue; }
        if (d === "'" || d === '"' || d === '`') { q = d; i += 1; continue; }
        if (d === '{') depth += 1;
        else if (d === '}') depth -= 1;
        i += 1;
      }
      out += ' ';
      continue;
    }
    out += c; i += 1;
  }
  return { text: out.replace(/\s+/g, ' ').trim(), hasDynamic };
}

/** Approximate visible labels of CTA-bearing elements (<button>, <a …>) in a region. */
function ctaLabels(region: string): string[] {
  const cleaned = stripComments(region || '');
  const labels: string[] = [];
  const re = /<(?:button|a)\b[^>]{0,400}?>/gi;
  let m: RegExpExecArray | null; let guard = 0;
  while ((m = re.exec(cleaned)) && guard < 60) {
    guard += 1;
    const rest = cleaned.slice(m.index + m[0].length, m.index + m[0].length + 220);
    const vt = extractVisibleText(`<x>${rest}`).text;
    const label = vt.split(/[<]/)[0].trim();
    if (label && /[a-z]/i.test(label)) labels.push(label.slice(0, 60));
  }
  return labels.slice(0, 40);
}

/* ────────────────────────────────────────────────────────────────────────────
 * ACCEPTANCE — conservative, section-scoped. Only strongly-proven failures block.
 * ──────────────────────────────────────────────────────────────────────────── */
export type ContentIssueCode =
  | 'content-missing-section'
  | 'content-generic-collapse'
  | 'content-duplicate-propositions'
  | 'content-internal-leak'
  | 'content-cta-hierarchy-missing'
  | 'content-weak-headline'
  | 'content-cta-vague'
  | 'content-repetition'
  | 'content-voice-drift'
  | 'content-language-mix'
  | 'content-proof-absent';

export interface ContentIssue {
  code: ContentIssueCode;
  severity: FrontendBuilderReviewSeverity;
  label: string;
  files: string[];
  evidence: string;
  repairInstruction: string;
}
export interface ContentAcceptanceResult {
  status: 'pass' | 'warning' | 'fail';
  legacy: boolean;
  analyzedSectionCount: number;
  satisfiedCount: number;
  missingCount: number;
  ambiguousCount: number;
  duplicateGroupCount: number;
  internalLeakCount: number;
  ctaActionable: boolean;
  issues: ContentIssue[];
}
const LEGACY_CONTENT: ContentAcceptanceResult = {
  status: 'pass', legacy: true, analyzedSectionCount: 0, satisfiedCount: 0, missingCount: 0, ambiguousCount: 0,
  duplicateGroupCount: 0, internalLeakCount: 0, ctaActionable: false, issues: [],
};

function capEv(s: string): string { const t = (s || '').replace(/\s+/g, ' ').trim(); return t.length > MAX_EVIDENCE ? t.slice(0, MAX_EVIDENCE) : t; }
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const x of a) if (b.has(x)) inter += 1;
  return inter / (a.size + b.size - inter);
}
function intentActionable(contract: ContentNarrativeContract): boolean {
  const p = lc(contract.primaryCtaRole + ' ' + contract.audienceProblem);
  if (/editorial|inform(ation)?|content|blog|news|magazine|read|browse-only|no cta|no sales/.test(p)) return false;
  return CONVERSION_ACTIONS.some((a) => p.includes(a.trim())) || /convert|lead|sale|sign|contact|book|buy|subscrib|enquir|quote|apply|register|donate|reserve|order|checkout/.test(p);
}

export function analyzeContentNarrative(
  files: FrontendGeneratedFile[] | undefined,
  contract: ContentNarrativeContract | undefined,
): ContentAcceptanceResult {
  try {
    if (!contract || contract.status !== 'derived') return LEGACY_CONTENT;
    const list = Array.isArray(files) ? files : [];
    if (!list.length) return { ...LEGACY_CONTENT, legacy: false };
    const issues: ContentIssue[] = [];
    const push = (i: ContentIssue) => { if (issues.length < MAX_ISSUES) issues.push(i); };
    const units = collectSectionUnits(list, contract.sections.map((s) => s.id));
    const byId = new Map(contract.sections.map((s) => [s.id, s]));
    // Concrete specificity baseline — the domain anchors the rendered copy SHOULD use, derived from the
    // authoritative identity + section copy. Generic-collapse is only judged against a real baseline.
    const anchorSet = new Set(contract.sections.flatMap((s) => s.specificityAnchors));
    const genericSet = new Set(contract.genericTerms);

    interface SecEval { id: string; path: string; role: NarrativeRole; required: boolean; words: string[]; hasDynamic: boolean; hasChild: boolean; hasSpecificity: boolean; genericOnly: boolean; fingerprint: Set<string>; leaked: string[]; substantive: boolean; }
    const evals: SecEval[] = [];
    for (const u of units.slice(0, MAX_SECTIONS)) {
      const sc = byId.get(u.id); if (!sc) continue;
      const region = (u.content || '').slice(0, MAX_SCAN);
      const vt = extractVisibleText(region);
      const words = tokens(vt.text);
      // A capitalized child component may carry the copy in another file → ambiguous, never "missing".
      const hasChild = /<[A-Z][A-Za-z0-9]*[\s/>]/.test(stripComments(region));
      // Internal-planning leakage — only from VISIBLE text (comments/attrs excluded by the reader).
      const vlow = ` ${lc(vt.text)} `;
      const leaked = INTERNAL_MARKERS.filter((mk) => vlow.includes(` ${mk} `) || vlow.includes(`${mk}:`) || vlow.includes(`(${mk})`));
      // Proposition fingerprint = significant, non-brand, non-generic tokens of the section copy.
      const fingerprint = new Set(contentWords(vt.text).filter((w) => !genericSet.has(w)));
      // Specific = uses a domain anchor OR carries ≥2 concrete (non-generic) content words. Generic-only
      // = substantive copy that is neither, yet leans on generic filler (interchangeable template copy).
      const substantive = words.length >= MIN_WORDS;
      const hasSpecificity = words.some((w) => anchorSet.has(w)) || fingerprint.size >= 2;
      const genericOnly = substantive && !hasSpecificity && words.some((w) => genericSet.has(w));
      evals.push({ id: u.id, path: u.path, role: sc.narrativeRole, required: sc.publicCopyRequired, words, hasDynamic: vt.hasDynamic, hasChild, hasSpecificity, genericOnly, fingerprint, leaked, substantive });
    }

    // ── 1. Missing substantive public content in a REQUIRED section (blocker, per section). A dynamic
    //    expression or a child component in the region → AMBIGUOUS (fail open), never a hard block. ──
    let missing = 0; let ambiguous = 0; let satisfied = 0;
    for (const e of evals) {
      if (!e.required || e.substantive) { satisfied += 1; continue; }
      if (e.hasDynamic || e.hasChild) { ambiguous += 1; continue; }
      missing += 1;
      push({ code: 'content-missing-section', severity: 'major', label: e.id, files: [e.path],
        evidence: capEv(`required "${e.role}" section "${e.id}" renders no substantive visible public copy (only a heading/markup, no child component or dynamic copy) — its message job is unfulfilled`),
        repairInstruction: capEv(`Render real public copy for "${e.id}" that answers its message job; a heading or the section name alone is not enough.`) });
    }

    // ── 2. Generic collapse: ≥4 substantive sections that carry neither a domain anchor nor ≥2 concrete
    //    words, leaning on generic filler — interchangeable template copy. ──
    const genericSections = evals.filter((e) => e.genericOnly);
    if (genericSections.length >= COLLAPSE_MIN) {
      push({ code: 'content-generic-collapse', severity: 'major', label: 'generic narrative', files: uniq(genericSections.map((e) => e.path)).slice(0, MAX_ISSUE_FILES),
        evidence: capEv(`${genericSections.length} substantive sections (${genericSections.slice(0, 6).map((e) => e.id).join(', ')}) use only generic filler with no concrete sector/product/service nouns — the narrative is interchangeable template copy`),
        repairInstruction: capEv('Give each section concrete, specific copy tied to the real offering; generic words cannot be the only content.') });
    }

    // ── 3. Duplicate propositions across ≥4 distinct substantive sections (blocker). ──
    const propEvals = evals.filter((e) => e.substantive && e.fingerprint.size >= 2);
    const clustered = new Set<number>();
    let dupGroups = 0; let dupBlocked = false;
    for (let a = 0; a < propEvals.length; a += 1) {
      if (clustered.has(a)) continue;
      const cluster = [a];
      for (let b = a + 1; b < propEvals.length; b += 1) {
        if (clustered.has(b)) continue;
        if (jaccard(propEvals[a].fingerprint, propEvals[b].fingerprint) >= DUP_JACCARD) { cluster.push(b); }
      }
      if (cluster.length >= 2) { dupGroups += 1; for (const idx of cluster) clustered.add(idx); }
      if (cluster.length >= COLLAPSE_MIN && !dupBlocked) {
        dupBlocked = true;
        const ids = cluster.map((idx) => propEvals[idx].id);
        push({ code: 'content-duplicate-propositions', severity: 'major', label: 'duplicated propositions', files: uniq(cluster.map((idx) => propEvals[idx].path)).slice(0, MAX_ISSUE_FILES),
          evidence: capEv(`${cluster.length} distinct sections (${ids.slice(0, 6).join(', ')}) repeat a materially identical proposition — distinct sections must carry distinct messages`),
          repairInstruction: capEv('Rewrite each section to make a distinct point in the narrative; do not restate the same proposition with minor wording changes.') });
      } else if (cluster.length === 2) {
        const ids = cluster.map((idx) => propEvals[idx].id);
        push({ code: 'content-repetition', severity: 'minor', label: 'possible repetition', files: [],
          evidence: capEv(`sections ${ids.join(' and ')} share a similar proposition — verify each makes a distinct point`),
          repairInstruction: capEv('Differentiate these two sections’ messages if they overlap.') });
      }
    }

    // ── 4. Internal-copy leakage visibly rendered (blocker). ──
    const leakEvals = evals.filter((e) => e.leaked.length);
    const internalLeakCount = leakEvals.length;
    if (internalLeakCount) {
      push({ code: 'content-internal-leak', severity: 'major', label: 'internal copy leaked', files: uniq(leakEvals.map((e) => e.path)).slice(0, MAX_ISSUE_FILES),
        evidence: capEv(`internal planning language is visibly rendered as public copy (${uniq(leakEvals.flatMap((e) => e.leaked)).slice(0, 6).join(', ')}) — these terms must never appear on the page`),
        repairInstruction: capEv('Remove internal role names/visitor questions/planning labels from visible copy; render only real public-facing text.') });
    }

    // ── 5. CTA hierarchy: the required conversion action absent from all CTAs (blocker, strong authority only). ──
    const allCtas = units.flatMap((u) => ctaLabels(u.content));
    const actionableCta = allCtas.some((l) => CONVERSION_ACTIONS.some((a) => lc(l).includes(a.trim())));
    const genericCtaCount = allCtas.filter((l) => GENERIC_CTA.some((g) => lc(l).includes(g))).length;
    const ctaActionable = actionableCta;
    if (intentActionable(contract) && allCtas.length >= 2 && !actionableCta && genericCtaCount >= 2) {
      push({ code: 'content-cta-hierarchy-missing', severity: 'major', label: 'no actionable CTA', files: [],
        evidence: capEv(`the authoritative conversion action (${clip(contract.primaryCtaRole, 40)}) appears in no CTA — all ${allCtas.length} CTAs are generic (${uniq(allCtas).slice(0, 5).join(', ')})`),
        repairInstruction: capEv('Give the primary CTA a label naming the real next action (book/enquire/get a quote/subscribe as appropriate), not a generic “learn more”.') });
    } else if (intentActionable(contract) && allCtas.length >= 1 && !actionableCta && genericCtaCount >= 1) {
      push({ code: 'content-cta-vague', severity: 'minor', label: 'vague CTA', files: [],
        evidence: capEv('primary CTA copy may be too generic for the authoritative conversion action — verify the label names a real next step'),
        repairInstruction: capEv('Prefer a CTA label that names the concrete action over a generic one where the destination is not obvious.') });
    }

    // ── Warnings: weak hero headline; optional proof; language mix. ──
    const hero = evals[0];
    if (hero && hero.substantive && !hero.hasSpecificity) {
      push({ code: 'content-weak-headline', severity: 'minor', label: 'generic hero headline', files: [hero.path],
        evidence: capEv('the opening section reads as a generic headline with no concrete specificity — verify it states the real promise'),
        repairInstruction: capEv('Make the hero headline concrete and sector-true, not an interchangeable slogan.') });
    }
    const proofSection = contract.sections.find((s) => s.proofMode === 'user-approved');
    if (proofSection && !contract.approvedClaimRefs.length) {
      push({ code: 'content-proof-absent', severity: 'minor', label: 'no approved proof', files: [],
        evidence: capEv('a proof section exists but no user-approved public claims were provided — keep proof qualitative and never fabricate specifics'),
        repairInstruction: capEv('Use honest qualitative trust language; do not invent metrics, testimonials or awards.') });
    }
    if (contract.language.toLowerCase().startsWith('en')) {
      const tr = evals.filter((e) => /(?:ı|ş|ğ|ç|ö|ü)|\b(ve|için|ile|hakkında|iletişim|hizmet)\b/i.test(e.words.join(' '))).length;
      if (tr >= 2) {
        push({ code: 'content-language-mix', severity: 'minor', label: 'language mixing', files: [],
          evidence: capEv(`${tr} sections mix non-English public copy in an English site — verify language coherence (proper nouns are fine)`),
          repairInstruction: capEv('Keep all substantive public copy in the authoritative output language; brand/product proper nouns may remain.') });
      }
    }

    const duplicateGroupCount = dupGroups;
    const blocking = issues.some((i) => i.severity !== 'minor');
    const warned = issues.some((i) => i.severity === 'minor');
    const status: ContentAcceptanceResult['status'] = blocking ? 'fail' : warned ? 'warning' : 'pass';
    return {
      status, legacy: false, analyzedSectionCount: evals.length, satisfiedCount: satisfied, missingCount: missing,
      ambiguousCount: ambiguous, duplicateGroupCount, internalLeakCount, ctaActionable, issues: issues.slice(0, MAX_ISSUES),
    };
  } catch {
    return { ...LEGACY_CONTENT, legacy: false };
  }
}

export function hasBlockingContentFindings(result: ContentAcceptanceResult | undefined): boolean {
  return !!result && result.status === 'fail';
}

const CONTENT_CATEGORY: Record<ContentIssueCode, FrontendBuilderReviewCategory> = {
  'content-missing-section': 'copy-fidelity',
  'content-generic-collapse': 'generic-template',
  'content-duplicate-propositions': 'copy-fidelity',
  'content-internal-leak': 'contract-fidelity',
  'content-cta-hierarchy-missing': 'copy-fidelity',
  'content-weak-headline': 'copy-fidelity',
  'content-cta-vague': 'copy-fidelity',
  'content-repetition': 'copy-fidelity',
  'content-voice-drift': 'copy-fidelity',
  'content-language-mix': 'copy-fidelity',
  'content-proof-absent': 'honesty',
};

export function contentNarrativeToReviewIssues(result: ContentAcceptanceResult | undefined): FrontendBuilderReviewIssue[] {
  if (!result || !result.issues.length) return [];
  const out: FrontendBuilderReviewIssue[] = [];
  let i = 0;
  for (const issue of result.issues) {
    if (issue.severity === 'minor') continue;   // advisory/manual-review — never a repair blocker
    out.push({
      id: `content-${issue.code}-${i += 1}`,
      severity: issue.severity,
      category: CONTENT_CATEGORY[issue.code],
      files: (issue.files || []).slice(0, MAX_ISSUE_FILES),
      evidence: capEv(issue.evidence),
      repairInstruction: capEv(issue.repairInstruction),
    });
    if (out.length >= MAX_ISSUES) break;
  }
  return out;
}

export function contentNarrativeIssueCodes(result: ContentAcceptanceResult | undefined): string[] {
  if (!result) return [];
  return uniq(result.issues.map((i) => i.code)).slice(0, 12);
}

/* ── Owner diagnostics (bounded, no secrets / source / URLs / raw copy). ── */
export interface ContentNarrativeDiagnostics {
  contentNarrativeVersion: string;
  contentNarrativeStatus: 'derived' | 'legacy';
  language: string;
  sectionAssignmentCount: number;
  narrativeRoleCount: number;
  specificityAnchorCount: number;
  approvedProofCount: number;
  contentNarrativeCharCount: number;
  derivationBasis: string[];
  contractPersistedInSpecification: boolean;
  contractRenderedToFrontendBuilder: boolean;
  contractUsedByAcceptance: boolean;
  agentsActuallyConsumingContract: string[];
  analyzedSectionCount?: number;
  satisfiedRoleCount?: number;
  missingRoleCount?: number;
  ambiguousRoleCount?: number;
  duplicatePropositionGroupCount?: number;
  ctaActionable?: boolean;
  internalCopyLeakCount?: number;
  contentAcceptanceStatus?: 'pass' | 'warning' | 'fail';
  contentIssueCodes?: string[];
}

export function buildContentNarrativeDiagnostics(
  contract: ContentNarrativeContract | undefined,
  acceptance: ContentAcceptanceResult | undefined,
  contentNarrativeCharCount: number,
): ContentNarrativeDiagnostics | undefined {
  if (!contract) return undefined;
  const live = acceptance && !acceptance.legacy ? acceptance : undefined;
  return {
    contentNarrativeVersion: contract.version,
    contentNarrativeStatus: contract.status,
    language: contract.language,
    sectionAssignmentCount: contract.sections.length,
    narrativeRoleCount: contract.narrativeProgression.length,
    specificityAnchorCount: uniq(contract.sections.flatMap((s) => s.specificityAnchors)).length,
    approvedProofCount: contract.approvedClaimRefs.length,
    contentNarrativeCharCount,
    derivationBasis: contract.derivationBasis.slice(0, 8),
    contractPersistedInSpecification: contract.contractPersistedInSpecification,
    contractRenderedToFrontendBuilder: contract.contractRenderedToFrontendBuilder,
    contractUsedByAcceptance: contract.contractUsedByAcceptance,
    agentsActuallyConsumingContract: contract.agentsActuallyConsumingContract.slice(0, 8),
    ...(live ? {
      analyzedSectionCount: live.analyzedSectionCount,
      satisfiedRoleCount: live.satisfiedCount,
      missingRoleCount: live.missingCount,
      ambiguousRoleCount: live.ambiguousCount,
      duplicatePropositionGroupCount: live.duplicateGroupCount,
      ctaActionable: live.ctaActionable,
      internalCopyLeakCount: live.internalLeakCount,
      contentAcceptanceStatus: live.status,
      contentIssueCodes: contentNarrativeIssueCodes(live),
    } : {}),
  };
}
