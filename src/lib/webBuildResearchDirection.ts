/**
 * Web Build — RESEARCH-GROUNDED SECTOR DIRECTION + PREMIUM ART-DIRECTION / ANTI-TEMPLATE contract.
 *
 * ONE authoritative, additive, JSON-safe layer that turns the evidence the EXISTING research +
 * Vertical Intelligence pipeline already produced into (a) a bounded, normalized sector-evidence
 * contract with honest evidence typing + sufficiency, (b) an evidence-grounded premium art-direction
 * / anti-template contract, and (c) a conservative, FEATURE/SECTION-SCOPED deterministic acceptance
 * analysis proving the generated project actually consumed that direction. It performs NO network
 * request and NO model call — it consumes what the backend Research Agent + Vertical Intelligence
 * already threaded into the FrontendBuildSpecification inputs, and it never fabricates sources,
 * metrics, or claims. Research inference is INTERNAL planning guidance only — it never becomes a
 * public factual claim, and a provider answer is never attributed to a single source URL.
 *
 * Acceptance uses correlated, per-component/section evidence (never global token composition across
 * unrelated files — the same defect corrected in PR #558): a forbidden sector module blocks only
 * when one coherent UI scope names it; a required pattern is satisfied only by a real rendered
 * section, and a truly-absent required pattern blocks only under real sector authority. Everything
 * is bounded and fail-open. Additive & optional for old/reopened builds.
 */
import type {
  FrontendGeneratedFile, FrontendBuilderReviewIssue, FrontendBuilderReviewSeverity, FrontendBuilderReviewCategory,
  FrontendSpecIdentity, FrontendSpecResearchEvidence, VerticalIntelligenceArtifact,
  ResearchAgentArtifact, ArtDirectionArtifact, StrategicThinkingLedger,
} from '@/lib/webBuildAgents';
import type { WebBuildSource } from '@/lib/webBuildApi';

/* ── Bounds (named, mandatory) ─────────────────────────────────────────────── */
const MAX_FINDINGS = 16;
const MAX_LIST = 8;
const MAX_SUBJECTS = 6;
const MAX_PATTERNS = 10;
const MAX_SOURCES = 8;
const MAX_CLAIMS = 8;
const MAX_FILE_CHARS = 80_000;
const MAX_UNITS = 60;
const MAX_ISSUES = 24;
const MAX_ISSUE_FILES = 4;
const MAX_EVIDENCE = 180;
const MAX_TEXT = 200;

/* ── Public contract types (persisted, all additive/optional for old builds) ── */
export type ResearchEvidenceType = 'source-backed' | 'user-provided' | 'inferred';
export type ResearchApplicability = 'sector' | 'subsector' | 'audience' | 'geography' | 'conversion' | 'visual';
export type ResearchConfidence = 'high' | 'medium' | 'low';
export type ResearchSufficiency =
  | 'sufficient-source-backed' | 'partial-source-backed' | 'inference-only' | 'unavailable' | 'conflicting';

export interface NormalizedFinding {
  id: string;
  angle: string;
  finding: string;
  implication: string;
  confidence: ResearchConfidence;
  evidenceType: ResearchEvidenceType;
  applicability: ResearchApplicability;
  /** True only when this is safe as a PUBLIC factual claim (user-provided proof); research-derived
   *  guidance is internal-only, never surfaced as a public factual claim. */
  publicSafe: boolean;
}

/** Bounded public-claim policy — the ONLY facts that may appear as public claims are ones the user
 *  explicitly supplied in authoritative build input; research/provider inference never qualifies. */
export interface ResearchClaimPolicy {
  approvedPublicClaims: string[];   // bounded fingerprints of user-supplied public claims
  forbiddenClaimClasses: string[];  // sector claim classes that must never be fabricated
}

export interface ResearchArtDirection {
  visualThesis: string;
  emotionalTone: string;
  compositionModel: string;
  contentDensity: string;
  typographyCharacter: string;
  paletteBehavior: string;
  imageRole: string;
  imageSubjects: string[];
  sectionRhythm: string;
  interactionEmphasis: string;
  motionCharacter: string;
  conversionEmphasis: string;
  trustPresentation: string;
  distinctiveSignature: string;
  genericPatternsToAvoid: string[];
  forbiddenModules: string[];
}

export interface ResearchDirectionContract {
  version: 'research-direction-v1';
  status: ResearchSufficiency;
  operatorIdentity: string;
  sector: string;
  subsector?: string;
  audience: string;
  conversionModel: string;
  isSoftwareSector: boolean;
  findings: NormalizedFinding[];
  sources: WebBuildSource[];
  validatedSourceCount: number;
  discardedSourceCount: number;
  conflictingFindingCount: number;
  coveredAngles: string[];
  sourceBackedFindingCount: number;
  inferredFindingCount: number;
  userProvidedFindingCount: number;
  requiredPatterns: string[];
  recommendedPatterns: string[];
  forbiddenClaims: string[];
  claimPolicy: ResearchClaimPolicy;
  artDirection: ResearchArtDirection;
  /* ── Truthful consumption trace — never overclaims. ── */
  upstreamEvidenceUsedToDeriveContract: string[];
  contractRenderedToFrontendBuilder: boolean;
  contractUsedByAcceptance: boolean;
  agentsActuallyConsumingContract: string[];
  reasons: string[];
}

/* ── Small pure helpers ────────────────────────────────────────────────────── */
function clip(s: unknown, n = MAX_TEXT): string { return (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim().slice(0, n); }
function cleanList(a: unknown, n = MAX_LIST, itemMax = 120): string[] {
  if (!Array.isArray(a)) return [];
  const out: string[] = [];
  for (const x of a) { const s = clip(x, itemMax); if (s && !out.includes(s)) out.push(s); if (out.length >= n) break; }
  return out;
}
function toks(s: string): string[] { return (s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3); }
function uniq<T>(a: T[]): T[] { return [...new Set(a)]; }
function esc(s: string): string { return (s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function present(token: string, src: string): boolean {
  const t = (token || '').trim();
  if (t.length < 3) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc(t)}(?![\\p{L}\\p{N}])`, 'iu').test(src);
}
/** Generic words that must NEVER independently prove a forbidden module or required pattern. */
const GENERIC_TOKENS = new Set([
  'api', 'data', 'analytics', 'support', 'platform', 'security', 'integration', 'integrations',
  'directory', 'pricing', 'price', 'plan', 'plans', 'tier', 'tiers', 'documentation', 'docs',
  'dashboard', 'feature', 'features', 'section', 'page', 'about', 'contact', 'service', 'services',
]);
/** Significant tokens of a label (drops short/stop words). */
function labelTokens(label: string): string[] {
  return toks(label).filter((w) => w.length >= 4 && !['with', 'that', 'your', 'their', 'from', 'this', 'section', 'page', 'and', 'the'].includes(w));
}
const STOP_HEADING = /<h[1-6][^>]*>([\s\S]{0,140}?)<\/h[1-6]>/gi;

const SOFTWARE_SECTORS = new Set(['ai-saas', 'marketplace']);

/* ────────────────────────────────────────────────────────────────────────────
 * DERIVATION — normalized evidence + sufficiency + premium art-direction contract.
 * Pure. Consumes only already-produced artifacts (no network / model call).
 * ──────────────────────────────────────────────────────────────────────────── */
export interface ResearchDirectionInput {
  identity: FrontendSpecIdentity;
  vertical?: VerticalIntelligenceArtifact;
  researchEvidence?: FrontendSpecResearchEvidence;
  research?: ResearchAgentArtifact;
  artDirection?: ArtDirectionArtifact;
  ledger?: StrategicThinkingLedger;
  /** Raw prompt — used ONLY to extract bounded user-supplied public-claim fingerprints; never persisted. */
  prompt?: string;
}

/** Convert an evidence array into normalized findings of one applicability. */
function foldFindings(
  items: string[], angle: string, applicability: ResearchApplicability, implication: string,
  evidenceType: ResearchEvidenceType, confidence: ResearchConfidence, seq: { n: number },
): NormalizedFinding[] {
  return items.slice(0, 4).map((finding) => ({
    id: `rf-${seq.n += 1}`,
    angle, finding: clip(finding, 160), implication: clip(implication, 120),
    confidence, evidenceType, applicability,
    publicSafe: false,          // research-derived guidance is internal-only, never a public claim
  }));
}

// Fabrication templates. STRONG = clearly invented public metric → blocks unless user-approved.
// SOFT  = vaguer unverifiable claim → manual-review warning unless user-approved.
const FAB_STRONG: Array<{ re: RegExp; what: string }> = [
  { re: /\btrusted by\s+[\d,]{2,}\+?\s*(?:customers|users|clients|companies|businesses|teams|brands)/i, what: 'trusted-by customer count' },
  { re: /\b[\d,]{3,}\+?\s*(?:happy\s+)?(?:customers|users|clients|members|downloads|five[- ]star reviews)/i, what: 'invented customer/user count' },
  { re: /\b\d(?:\.\d)?\s*(?:★|stars?)\b[^<]{0,40}\b(?:from\s+)?[\d,]{2,}\s*reviews/i, what: 'invented star-rating volume' },
];
const FAB_SOFT: Array<{ re: RegExp; what: string }> = [
  { re: /\baward[- ]winning\b|\bvoted\s+#?1\b|\bas seen (?:in|on)\b|\b#1[- ]rated\b/i, what: 'unverifiable award / "as seen in" claim' },
];

// Claim nouns that carry the semantic identity of a public claim (so a materially different
// number/entity never structurally matches an approved one).
const CLAIM_NOUNS = new Set([
  'customers', 'users', 'clients', 'members', 'companies', 'businesses', 'teams', 'brands',
  'downloads', 'reviews', 'stars', 'star', 'award', 'awards', 'awarded', 'winning', 'rated', 'seen', 'five',
]);
interface ClaimFp { nums: string; nouns: string[]; }
/** Structured claim fingerprint = normalized number multiset + claim nouns. Numbers are normalized
 *  (commas/trailing-zeros stripped) so equivalence is exact, never a broad substring. */
function claimFp(s: string): ClaimFp {
  const lower = (s || '').toLowerCase();
  const nums = uniq((lower.match(/\d[\d.,]*\d|\d/g) || []).map((n) => n.replace(/,/g, '')).map((n) => n.replace(/\.0+$/, ''))).sort();
  const nouns = uniq((lower.match(/[a-z]{3,}/g) || []).filter((w) => CLAIM_NOUNS.has(w))).sort();
  return { nums: nums.join(','), nouns };
}
function claimFpString(f: ClaimFp): string { return `${f.nums}|${f.nouns.join(',')}`.slice(0, 80); }
function parseClaimFp(s: string): ClaimFp {
  const i = s.indexOf('|');
  const nums = i >= 0 ? s.slice(0, i) : s;
  const w = i >= 0 ? s.slice(i + 1) : '';
  return { nums, nouns: w ? w.split(',').filter(Boolean) : [] };
}
/** Exact/structurally-equivalent match: identical number multiset AND (no nouns on both, or a shared
 *  claim noun). Never approves a materially different number, rating, review count, award or entity. */
function claimsEquivalent(a: ClaimFp, b: ClaimFp): boolean {
  if (a.nums !== b.nums) return false;
  if (a.nouns.length === 0 && b.nouns.length === 0) return a.nums.length > 0;   // both numberless+nounless is not a claim
  return a.nouns.some((n) => b.nouns.includes(n));
}

// Bounded EN/TR negation / cautionary signals — a claim inside such a context is NEVER approved,
// even though its text occurs in the prompt (e.g. "do not say trusted by 10,000 customers").
const CLAIM_NEG_RE = /\b(?:no|not|never|don'?t|do not|without|avoid|avoiding|fake|fabricat\w*|invent\w*|placeholder|dummy|example only|examples? of)\b|\b(?:yok|değil|asla|kullanma|yazma|ekleme|uydurma|sahte|örnek|temsili)\b/i;
// Clear first-person/possessive affirmative ownership — REQUIRED for approval (positive intent).
const CLAIM_AFF_RE = /\b(?:we|we'?re|we'?ve|we have|our|ours|us|my)\b|\buse the fact\b|\bproudly\b|\b(?:biz|bizim|sahibiz|ödüllü|müşterimiz)\b/i;

/** Bounded local-context test: affirmative user intent present AND no negation/caution nearby. */
function claimHasAffirmativeIntent(before: string, after: string): boolean {
  if (CLAIM_NEG_RE.test(before) || CLAIM_NEG_RE.test(after)) return false;   // negative/cautionary context
  return CLAIM_AFF_RE.test(before);                                          // require positive ownership
}

/** Extract bounded user-supplied public-claim fingerprints from the raw prompt (never persisted raw).
 *  Textual occurrence ALONE is never approval — only affirmative local context qualifies. */
function extractApprovedClaims(prompt: string | undefined): string[] {
  const p = clip(prompt, 4000);
  if (!p) return [];
  const out: string[] = [];
  for (const fab of [...FAB_STRONG, ...FAB_SOFT]) {
    const g = new RegExp(fab.re.source, 'gi');
    for (const m of p.matchAll(g)) {
      const idx = m.index ?? 0;
      const before = p.slice(Math.max(0, idx - 48), idx);
      const after = p.slice(idx + m[0].length, idx + m[0].length + 16);
      if (!claimHasAffirmativeIntent(before, after)) continue;   // negation/example/no-ownership → reject
      const fp = claimFpString(claimFp(m[0]));
      if (fp && !out.includes(fp)) out.push(fp);
      if (out.length >= MAX_CLAIMS) break;
    }
    if (out.length >= MAX_CLAIMS) break;
  }
  return out.slice(0, MAX_CLAIMS);
}

export function deriveResearchDirection(input: ResearchDirectionInput): ResearchDirectionContract {
  const id = input.identity || ({} as FrontendSpecIdentity);
  const vi = input.vertical;
  const re = input.researchEvidence;
  const ad = input.artDirection;
  const ledger = input.ledger;

  const sector = clip(id.sector || vi?.sector || 'general', 40);
  const subsector = clip(id.subsector || vi?.subsector || '', 40) || undefined;
  const isSoftwareSector = SOFTWARE_SECTORS.has(sector);
  const operatorIdentity = clip(id.primaryConcept || id.siteType || subsector || sector, 120) || 'this business';
  const audience = clip(id.audienceSector || vi?.audienceSector || 'the intended audience', 60);
  const conversionModel = clip(vi?.conversionModel?.primaryAction || id.primaryConversionIntent || 'primary enquiry/action', 80);

  const didUseRealSources = !!re && re.didUseRealSources === true;
  const validSources = (re?.sources || []).filter((s) => !!s && !!s.url).slice(0, MAX_SOURCES);
  const validatedSourceCount = validSources.length;
  const coveredAngles = uniq([...(input.research?.researchAngles || []), ...(vi?.researchPlan?.angles || [])].map((a) => clip(a, 40)).filter(Boolean)).slice(0, MAX_LIST);

  // ── Normalized findings (source-backed when real sources exist, else inferred). ──
  const evType: ResearchEvidenceType = didUseRealSources ? 'source-backed' : 'inferred';
  const conf: ResearchConfidence = didUseRealSources ? 'high' : 'medium';
  const seq = { n: 0 };
  const findings: NormalizedFinding[] = [
    ...foldFindings(cleanList(re?.sourceBackedInsights), 'category', 'sector', 'informs positioning + content', evType, conf, seq),
    ...foldFindings(cleanList(re?.audienceExpectations), 'audience', 'audience', 'shapes hierarchy + messaging', evType, conf, seq),
    ...foldFindings(cleanList(re?.conversionPatterns), 'conversion', 'conversion', 'drives CTA + funnel', evType, conf, seq),
    ...foldFindings(cleanList(re?.trustSignals), 'trust', 'sector', 'shapes trust/proof presentation', evType, conf, seq),
    ...foldFindings(cleanList(re?.visualPatterns), 'visual', 'visual', 'guides art direction + imagery', evType, conf, seq),
    ...foldFindings(cleanList(re?.risksToAvoid), 'anti-pattern', 'sector', 'forbidden low-quality pattern', evType, 'low', seq),
    ...foldFindings(cleanList(re?.differentiationOpportunities), 'differentiation', 'sector', 'distinctive signature', evType, conf, seq),
  ].slice(0, MAX_FINDINGS);

  // Source-backed findings are grounded in validated sources ONLY when real sources were used.
  const sourceBackedFindingCount = didUseRealSources ? findings.filter((f) => f.evidenceType === 'source-backed').length : 0;
  const inferredFindingCount = findings.filter((f) => f.evidenceType === 'inferred').length;

  // ── Sufficiency (truthful; source count alone is never treated as quality). ──
  // 'conflicting' is only produced from a GENUINE conflict signal (low classification confidence
  // AND ≥2 conflicting sector signals) — never from generic uncertainty. `discardedSourceCount`
  // and `conflictingFindingCount` are 0 here because the upstream evidence does not carry compatible
  // discard/conflict counts; they are NOT computed from incompatible pre/post-dedupe numbers.
  const genuineConflict = vi?.confidence === 'low' && (vi?.conflictingSignals || []).length >= 2;
  let status: ResearchSufficiency;
  if (genuineConflict) status = 'conflicting';
  else if (didUseRealSources && validatedSourceCount >= 3 && coveredAngles.length >= 3 && sourceBackedFindingCount >= 3) status = 'sufficient-source-backed';
  else if (didUseRealSources && validatedSourceCount >= 1 && sourceBackedFindingCount >= 1) status = 'partial-source-backed';
  else if (findings.length > 0 || !!vi) status = 'inference-only';
  else status = 'unavailable';

  // ── Sector policy (deterministic guardrails from Vertical Intelligence). ──
  const requiredPatterns = cleanList(vi?.sectionPolicy?.required, MAX_LIST);
  const recommendedPatterns = cleanList(vi?.sectionPolicy?.recommended, MAX_LIST);
  const forbiddenSections = (vi?.sectionPolicy?.forbidden || []).map((f) => clip(f?.section, 60)).filter(Boolean).slice(0, MAX_LIST);
  const forbiddenClaims = cleanList(vi?.trustModel?.forbiddenClaims, MAX_LIST);

  // ── Premium art-direction / anti-template contract (evidence-grounded, sector-aware). ──
  const genericPatternsToAvoid = uniq([
    'identical equal-sized card grids repeated for every section',
    'fabricated metrics, awards, logos or testimonials without real user-supplied proof',
    'generic "trusted by" logo strips with invented brands',
    'decorative charts/dashboards with no real function',
    'repeated centered hero → three cards → features grid → testimonials → CTA skeleton',
    ...(isSoftwareSector ? [] : ['dark navy/purple AI-gradient styling and glassmorphism used for a non-software business', 'SaaS product-dashboard modules unrelated to this business']),
    ...cleanList(ad?.avoid, 4, 80),
    ...cleanList(re?.risksToAvoid, 3, 80),
  ]).slice(0, MAX_PATTERNS);

  const imageSubjects = uniq([
    ...cleanList(re?.visualPatterns, 3, 60),
    ...toks(subsector || sector).slice(0, 2),
    ...(vi?.visualPolicy?.heroRecommendation ? [clip(vi.visualPolicy.heroRecommendation, 60)] : []),
  ]).slice(0, MAX_SUBJECTS);

  const artDirection: ResearchArtDirection = {
    visualThesis: clip(ad?.visualMetaphor || ad?.brandPersonality || `${operatorIdentity}: a distinctive, sector-true visual identity`, MAX_TEXT),
    emotionalTone: clip(ad?.visualMood || 'confident, appropriate to the audience', 80),
    compositionModel: clip(ad?.heroDirection || ad?.layoutFeeling || 'editorial, purposeful composition', MAX_TEXT),
    contentDensity: clip(String(ad?.density || 'balanced'), 40),
    typographyCharacter: clip(ad?.typographyDirection || 'distinctive, legible type with clear hierarchy', MAX_TEXT),
    paletteBehavior: clip(ad?.colorPsychologyReasoning || 'a palette that fits the audience psychology, not a default AI theme', MAX_TEXT),
    imageRole: clip(vi?.visualPolicy?.heroRecommendation || ad?.imageryDirection || 'imagery that supports the researched brand story', MAX_TEXT),
    imageSubjects,
    sectionRhythm: clip(ad?.sectionRhythmDirection || 'varied section rhythm driven by the decision journey', MAX_TEXT),
    interactionEmphasis: clip(ledger?.primaryConversionPath || conversionModel, 120),
    motionCharacter: clip(ad?.motionDirection || 'subtle, honest motion only', 120),
    conversionEmphasis: clip(vi?.conversionModel?.primaryAction || conversionModel, 120),
    trustPresentation: clip((vi?.trustModel?.drivers || [])[0] || 'honest, source-appropriate proof', 120),
    distinctiveSignature: clip((ad?.premiumDetails || [])[0] || ad?.visualMetaphor || 'a memorable, sector-specific signature detail', 120),
    genericPatternsToAvoid,
    forbiddenModules: uniq([...forbiddenSections, ...(isSoftwareSector ? [] : ['pricing tiers', 'API documentation', 'integrations directory', 'analytics dashboard'])]).slice(0, MAX_LIST),
  };

  // ── Truthful consumption trace — only the upstream artifacts actually READ to build the contract;
  //    NO model agent reads the contract before its decision (it is applied at spec/generation/
  //    acceptance only). ──
  const upstreamEvidenceUsedToDeriveContract = uniq([
    input.research ? 'research' : '',
    vi ? 'verticalIntelligence' : '',
    ad ? 'artDirection' : '',
    ledger ? 'thinkingLedger' : '',
    re ? 'researchEvidence' : '',
  ].filter(Boolean));

  const reasons: string[] = [];
  if (!didUseRealSources) reasons.push(clip(re?.status ? `no live sources (${re.status})` : 'inference-only (no research artifact)', 80));
  if (status === 'conflicting') reasons.push('conflicting sector signals (low-confidence classification) — manual review');

  return {
    version: 'research-direction-v1', status,
    operatorIdentity, sector, subsector, audience, conversionModel, isSoftwareSector,
    findings, sources: validSources, validatedSourceCount,
    discardedSourceCount: 0, conflictingFindingCount: 0,
    coveredAngles, sourceBackedFindingCount, inferredFindingCount, userProvidedFindingCount: 0,
    requiredPatterns, recommendedPatterns, forbiddenClaims,
    claimPolicy: { approvedPublicClaims: extractApprovedClaims(input.prompt), forbiddenClaimClasses: forbiddenClaims },
    artDirection,
    upstreamEvidenceUsedToDeriveContract,
    contractRenderedToFrontendBuilder: true,
    contractUsedByAcceptance: true,
    agentsActuallyConsumingContract: [],
    reasons,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * RENDER — one compact RESEARCH-GROUNDED SECTOR DIRECTION block for the builder.
 * Bounded; no raw sources dump, no secrets, no unbounded text.
 * ──────────────────────────────────────────────────────────────────────────── */
export function renderResearchDirectionBlock(contract: ResearchDirectionContract | undefined): string[] {
  if (!contract) return [];
  const a = contract.artDirection;
  const line = (label: string, v: string) => (v ? `- ${label}: ${clip(v, MAX_TEXT)}` : '');
  const list = (label: string, arr: string[], n = 5) => (arr.length ? `- ${label}: ${arr.slice(0, n).map((x) => clip(x, 80)).join('; ')}` : '');
  const out = [
    'RESEARCH-GROUNDED SECTOR DIRECTION:',
    `This build is grounded in ${contract.status} sector evidence (${contract.validatedSourceCount} validated source(s), angles: ${contract.coveredAngles.slice(0, 6).join(', ') || 'n/a'}). Let it drive EVERY decision — do not fall back to a generic template.`,
    line('Business', contract.operatorIdentity),
    line('Sector', `${contract.sector}${contract.subsector ? ` · ${contract.subsector}` : ''}`),
    line('Audience', contract.audience),
    line('Conversion model', contract.conversionModel),
    line('Visual thesis', a.visualThesis),
    line('Emotional tone', a.emotionalTone),
    line('Composition', a.compositionModel),
    line('Typography', a.typographyCharacter),
    line('Palette behavior', a.paletteBehavior),
    line('Section rhythm', a.sectionRhythm),
    line('Imagery role', a.imageRole),
    list('Image subjects', a.imageSubjects, MAX_SUBJECTS),
    line('Conversion emphasis', a.conversionEmphasis),
    line('Trust presentation', a.trustPresentation),
    line('Distinctive signature', a.distinctiveSignature),
    list('Required sector patterns', contract.requiredPatterns, MAX_LIST),
    list('Forbidden sector modules', a.forbiddenModules, MAX_LIST),
    list('Never fabricate (claims)', contract.forbiddenClaims, MAX_LIST),
    list('Avoid (generic patterns)', a.genericPatternsToAvoid, MAX_PATTERNS),
    'Evidence status: research informs PRINCIPLES and sector expectations only — never copy a real',
    'competitor’s layout, wording or brand, and never present research inference as a factual claim.',
    '',
  ].filter(Boolean);
  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
 * ACCEPTANCE — conservative, FEATURE/SECTION-SCOPED proof the project consumed the
 * direction. Correlated per-file evidence only (never global token composition).
 * Strong evidence blocks; ambiguous warns (manual-review); weak produces no finding.
 * Pure; fail-open at the call site.
 * ──────────────────────────────────────────────────────────────────────────── */
export type ResearchGroundingIssueCode =
  | 'research-forbidden-module'
  | 'research-fabricated-claim'
  | 'research-required-pattern-missing'
  | 'research-template-repetition'
  | 'research-artdirection-contradiction'
  | 'research-identity-missing';

export interface ResearchGroundingIssue {
  code: ResearchGroundingIssueCode;
  severity: FrontendBuilderReviewSeverity;
  label: string;
  files: string[];
  evidence: string;
  repairInstruction: string;
}
export interface ResearchGroundingResult {
  status: 'pass' | 'warning' | 'fail';
  legacy: boolean;
  requiredPatternMissingCount: number;
  forbiddenModuleCount: number;
  fabricatedClaimCount: number;
  templateRepetitionCount: number;
  issues: ResearchGroundingIssue[];
}

const LEGACY_GROUNDING: ResearchGroundingResult = {
  status: 'pass', legacy: true, requiredPatternMissingCount: 0, forbiddenModuleCount: 0,
  fabricatedClaimCount: 0, templateRepetitionCount: 0, issues: [],
};

function capEv(s: string): string { const t = (s || '').replace(/\s+/g, ' ').trim(); return t.length > MAX_EVIDENCE ? t.slice(0, MAX_EVIDENCE) : t; }

/** Rendered "naming" surfaces of a single file: headings, aria-labels, nav/button/link/section text. */
function namingText(content: string): string {
  const parts: string[] = [];
  for (const m of content.matchAll(STOP_HEADING)) parts.push(m[1]);
  for (const m of content.matchAll(/\baria-label=["']([^"']{0,80})["']/gi)) parts.push(m[1]);
  for (const m of content.matchAll(/<(?:nav|button|a|figcaption|summary)\b[^>]*>([\s\S]{0,60}?)<\//gi)) parts.push(m[1].replace(/<[^>]*>/g, ' '));
  for (const m of content.matchAll(/data-korvix-(?:section|id|image-slot)=["']([^"']{0,60})["']/gi)) parts.push(m[1].replace(/[-_.]+/g, ' '));
  return parts.join(' \n ').toLowerCase();
}

// A required pattern is FUNCTIONAL (interactive) when its label implies an action/experience —
// its real proof (control/state/output) belongs to the EXISTING PR #558 binding analyzer, which
// runs on the same files and blocks independently. Research grounding never re-checks functionality.
const FUNCTIONAL_RE = /\b(?:book|booking|reserv\w*|search|searching|filter\w*|finder|calculat\w*|configur\w*|quote|enquir\w*|inquir\w*|checkout|cart|sign[- ]?up|signup|register|schedule|appointment|form|builder|planner|selector|comparison|compare|interactive)\b/i;

/** Whether a rendered unit has REAL supporting content beyond a bare heading/nav (a genuine section). */
function unitHasSupportingContent(content: string): boolean {
  return /<p\b|<li\b|<img\b|<form\b|<input\b|<textarea\b|<select\b|<table\b|<article\b|\.map\s*\(/i.test(content) || content.length > 800;
}

/** Real interactive evidence in a unit (used only as a manual-review gate — depth is proven by #558). */
function unitHasInteractiveEvidence(content: string): boolean {
  return /<form\b|<input\b|<select\b|<textarea\b|onClick=|onChange=|onSubmit=|use(?:State|Reducer)\b/i.test(content);
}

/** SECTION-level naming only — headings + section aria-labels + section ids. EXCLUDES nav/button/link
 *  text so a "Menu" nav link never counts as a real "menu" section. */
function headingText(content: string): string {
  const parts: string[] = [];
  for (const m of content.matchAll(STOP_HEADING)) parts.push(m[1]);
  for (const m of content.matchAll(/<section\b[^>]*aria-label=["']([^"']{0,80})["']/gi)) parts.push(m[1]);
  for (const m of content.matchAll(/data-korvix-section=["']([^"']{0,60})["']/gi)) parts.push(m[1].replace(/[-_.]+/g, ' '));
  return parts.join(' \n ').toLowerCase();
}

export function analyzeResearchGrounding(
  files: FrontendGeneratedFile[] | undefined,
  contract: ResearchDirectionContract | undefined,
): ResearchGroundingResult {
  try {
    if (!contract) return LEGACY_GROUNDING;
    const list = Array.isArray(files) ? files : [];
    if (!list.length) return { ...LEGACY_GROUNDING, legacy: false };
    const units = list.slice(0, MAX_UNITS).map((f) => {
      const content = (f.content || '').slice(0, MAX_FILE_CHARS);
      return { path: f.path, content, naming: namingText(content), heading: headingText(content) };
    });
    const issues: ResearchGroundingIssue[] = [];
    let requiredMissing = 0; let forbiddenCount = 0; let fabricated = 0; let repetition = 0;
    const push = (i: ResearchGroundingIssue) => { if (issues.length < MAX_ISSUES) issues.push(i); };
    const approvedFps = contract.claimPolicy.approvedPublicClaims.map(parseClaimFp);

    // 1) Forbidden sector modules — SECTION/COMPONENT-SCOPED correlated evidence (never global
    //    token composition). One coherent file must name the module: its full phrase in a heading/
    //    label, OR ≥2 DISTINCTIVE (non-generic) tokens co-occurring in that file with one in a
    //    naming surface. Generic words (api/data/analytics/pricing/plan/…) never independently prove.
    for (const mod of contract.artDirection.forbiddenModules) {
      const phrase = mod.toLowerCase();
      const distinctive = labelTokens(mod).filter((t) => !GENERIC_TOKENS.has(t));
      let hitFile = '';
      for (const u of units) {
        const fullNamed = u.naming.includes(phrase);
        const distinctiveInFile = distinctive.filter((t) => present(t, u.content));
        const distinctiveNamed = distinctive.some((t) => u.naming.includes(t));
        if (fullNamed || (distinctive.length >= 2 && distinctiveInFile.length >= 2 && distinctiveNamed)) { hitFile = u.path; break; }
      }
      if (hitFile) {
        forbiddenCount += 1;
        push({ code: 'research-forbidden-module', severity: 'major', label: mod, files: [hitFile],
          evidence: capEv(`sector-incompatible module "${mod}" is a named section/component on a ${contract.sector} site — research/sector evidence forbids it`),
          repairInstruction: capEv(`Remove the "${mod}" module (it belongs to a different sector) and replace it with a section appropriate to ${contract.operatorIdentity}.`) });
        if (forbiddenCount >= 4) break;
      }
    }

    // 2) Fabricated public claims — STRONG (invented metrics) block, SOFT (vaguer) warn, UNLESS the
    //    exact claim was explicitly user-supplied (approved). Research/provider inference is never
    //    public proof. Claims are matched project-wide (a fabricated number is a problem anywhere).
    const src = units.map((u) => u.content).join('\n');
    // Exact/structural match ONLY — a materially different number/rating/review-count/award is never
    // authorized by a broad substring.
    const claimApproved = (matched: string): boolean => {
      const g = claimFp(matched);
      return approvedFps.some((a) => claimsEquivalent(a, g));
    };
    for (const fab of FAB_STRONG) {
      const m = fab.re.exec(src);
      if (m && !claimApproved(m[0])) {
        fabricated += 1;
        push({ code: 'research-fabricated-claim', severity: 'major', label: fab.what, files: [],
          evidence: capEv(`a fabricated ${fab.what} appears in public copy with no user-supplied proof — research inference must never become a public factual claim`),
          repairInstruction: capEv(`Remove the ${fab.what}; use neutral, non-factual copy unless the user supplied real proof. Never invent metrics, awards, logos or testimonials.`) });
        if (fabricated >= 3) break;
      }
    }
    for (const fab of FAB_SOFT) {
      const m = fab.re.exec(src);
      if (m && !claimApproved(m[0])) {
        push({ code: 'research-fabricated-claim', severity: 'minor', label: fab.what, files: [],
          evidence: capEv(`a possibly-unverifiable ${fab.what} appears in public copy — confirm real user-supplied proof exists, else neutralize it`),
          repairInstruction: capEv(`Confirm the ${fab.what} is a real user-provided claim; if not, replace it with neutral copy. Never fabricate awards/press claims.`) });
      }
    }

    // 3) Required sector patterns — SECTION/COMPONENT-SCOPED correlated evidence. A pattern is
    //    SATISFIED only when ONE coherent rendered unit NAMES it (exact phrase, or ≥2 distinctive
    //    tokens, or an exact single-label heading) AND that same unit has real supporting content.
    //    A functional pattern's actual interactivity is proven by the EXISTING PR #558 binding
    //    analyzer (reused, not duplicated) — research grounding never re-checks or blocks functionality.
    //    Named-but-structurally-weak / mentioned-only → manual-review; entirely absent under real
    //    sector authority → blocking (capped); one generic token never satisfies a multi-token pattern.
    const strongAuthority = contract.status === 'sufficient-source-backed' || contract.status === 'partial-source-backed'
      || (contract.requiredPatterns.length > 0 && contract.sector !== 'general');
    for (const req of contract.requiredPatterns) {
      const tk = labelTokens(req);
      if (!tk.length) continue;
      const distinctive = tk.filter((t) => !GENERIC_TOKENS.has(t));
      const phrase = req.toLowerCase();
      const functional = FUNCTIONAL_RE.test(req);
      // A bearer NAMES the pattern at SECTION level (heading / section-label), not in nav/button text:
      // exact phrase, ≥2 distinctive tokens, or an exact single distinctive-label heading.
      const bearer = units.find((u) => u.heading.includes(phrase)
        || (distinctive.length >= 2 && distinctive.filter((t) => u.heading.includes(t)).length >= 2)
        || (distinctive.length === 1 && u.heading.includes(distinctive[0])));
      const anywhere = units.some((u) => tk.some((t) => present(t, u.content)));

      if (functional) {
        // Interactivity DEPTH is proven/blocked by PR #558's correlated control/state/output analysis
        // (reused, not duplicated). Here we only require the named section to carry real interactive
        // evidence; a mention or a non-interactive heading is manual-review, never a false pass/block.
        if (bearer && unitHasInteractiveEvidence(bearer.content)) continue;
        push({ code: 'research-required-pattern-missing', severity: 'minor', label: req, files: bearer ? [bearer.path] : [],
          evidence: capEv(`functional pattern "${req}" is ${bearer ? 'a named section but shows no interactive controls/state' : 'not evidently a rendered interactive section'} — verify via the binding-requirement analysis`),
          repairInstruction: capEv(`Implement "${req}" as a real interactive section (controls + state + visible output) for ${contract.operatorIdentity}; a mention or bare heading is not enough.`) });
        continue;
      }

      // Informational pattern.
      if (bearer && unitHasSupportingContent(bearer.content)) continue;   // strong: named + real content
      if (bearer || anywhere) {                                          // named-but-weak, or mention-only → manual review
        push({ code: 'research-required-pattern-missing', severity: 'minor', label: req, files: bearer ? [bearer.path] : [],
          evidence: capEv(`required sector pattern "${req}" is ${bearer ? 'named but lacks supporting rendered content (an empty/decorative heading is ambiguous)' : 'only mentioned incidentally (footer copy / import / comment does not prove a section)'} — manual review`),
          repairInstruction: capEv(`Make "${req}" a real, semantic rendered section (heading + meaningful content) for ${contract.operatorIdentity}, not just a heading or incidental text.`) });
      } else if (strongAuthority && requiredMissing < 2) {                // token nowhere → clearly absent → block
        requiredMissing += 1;
        push({ code: 'research-required-pattern-missing', severity: 'major', label: req, files: [],
          evidence: capEv(`required sector pattern "${req}" is entirely absent — the researched ${contract.sector} decision journey expects it`),
          repairInstruction: capEv(`Add a real "${req}" section appropriate to ${contract.operatorIdentity}; the researched conversion journey depends on it.`) });
      }
    }

    // 4) Template repetition — many identical equal-card grids across the page. Warning (manual-review).
    const gridCols = (src.match(/grid-cols-3\b/gi) || []).length;
    const cardHits = (src.match(/\brounded-(?:xl|2xl|3xl)\b[^"]*\b(?:shadow|border)\b/gi) || []).length;
    if (gridCols >= 4 && cardHits >= 9) {
      repetition += 1;
      push({ code: 'research-template-repetition', severity: 'minor', label: 'repeated identical card grids', files: units.filter((u) => /grid-cols-3\b/i.test(u.content)).slice(0, MAX_ISSUE_FILES).map((u) => u.path),
        evidence: capEv(`the page repeats identical equal-sized card grids (${gridCols} three-column grids) — a generic template rhythm rather than the researched decision journey`),
        repairInstruction: capEv('Vary section rhythm to match the researched conversion journey; do not reuse the same equal-card grid for every section.') });
    }

    // 5) Art-direction contradiction — dark navy/purple AI styling on a non-software business. Warning.
    if (!contract.isSoftwareSector) {
      const aiGlow = (src.match(/(?:from|via|to)-(?:purple|violet|indigo|fuchsia)-\d{3}/gi) || []).length;
      const darkGlass = /backdrop-blur|bg-slate-9\d0\/|bg-black\/[3-8]0/i.test(src);
      if (aiGlow >= 4 && darkGlass) {
        push({ code: 'research-artdirection-contradiction', severity: 'minor', label: 'AI-gradient styling on a non-software business', files: [],
          evidence: capEv(`heavy dark-navy/purple AI-gradient + glass styling on a ${contract.sector} site contradicts the researched art direction (${clip(contract.artDirection.emotionalTone, 40)})`),
          repairInstruction: capEv(`Adopt the researched palette/tone for ${contract.operatorIdentity}; reserve dark-purple AI aesthetics for genuine software products.`) });
      }
    }

    // 6) Operator identity not evident in any rendered naming surface. Warning.
    const idTokens = labelTokens(contract.operatorIdentity).concat(labelTokens(contract.subsector || contract.sector));
    if (idTokens.length && !units.some((u) => idTokens.some((t) => u.naming.includes(t) || present(t, u.content)))) {
      push({ code: 'research-identity-missing', severity: 'minor', label: contract.operatorIdentity, files: [],
        evidence: capEv(`no evidence of the operator identity/sector ("${contract.operatorIdentity}") in the rendered copy — the site reads generically`),
        repairInstruction: capEv(`Make ${contract.operatorIdentity} and its ${contract.sector} context explicit in the copy and structure.`) });
    }

    const blocking = issues.some((i) => i.severity !== 'minor' && (i.code === 'research-forbidden-module' || i.code === 'research-fabricated-claim' || i.code === 'research-required-pattern-missing'));
    const warned = issues.some((i) => i.severity === 'minor');
    const status: ResearchGroundingResult['status'] = blocking ? 'fail' : warned ? 'warning' : 'pass';
    return { status, legacy: false, requiredPatternMissingCount: requiredMissing, forbiddenModuleCount: forbiddenCount, fabricatedClaimCount: fabricated, templateRepetitionCount: repetition, issues: issues.slice(0, MAX_ISSUES) };
  } catch {
    return { ...LEGACY_GROUNDING, legacy: false };
  }
}

/** True when the result carries a blocking research-grounding finding. */
export function hasBlockingResearchFindings(result: ResearchGroundingResult | undefined): boolean {
  return !!result && result.status === 'fail';
}

/* ── Map grounding issues → the existing review-issue shape for the SINGLE existing repair. ── */
const GROUNDING_CATEGORY: Record<ResearchGroundingIssueCode, FrontendBuilderReviewCategory> = {
  'research-forbidden-module': 'concept-drift',
  'research-fabricated-claim': 'honesty',
  'research-required-pattern-missing': 'contract-fidelity',
  'research-template-repetition': 'generic-template',
  'research-artdirection-contradiction': 'palette-and-surfaces',
  'research-identity-missing': 'concept-fidelity',
};

export function researchGroundingToReviewIssues(result: ResearchGroundingResult | undefined): FrontendBuilderReviewIssue[] {
  if (!result || !result.issues.length) return [];
  const out: FrontendBuilderReviewIssue[] = [];
  let i = 0;
  for (const issue of result.issues) {
    // Minor (manual-review) findings are advisory — they do not enter the repair as blockers.
    if (issue.severity === 'minor') continue;
    out.push({
      id: `research-${issue.code}-${i += 1}`,
      severity: issue.severity,
      category: GROUNDING_CATEGORY[issue.code],
      files: (issue.files || []).slice(0, MAX_ISSUE_FILES),
      evidence: capEv(issue.evidence),
      repairInstruction: capEv(issue.repairInstruction),
    });
    if (out.length >= MAX_ISSUES) break;
  }
  return out;
}

/** Bounded issue codes for owner diagnostics (deduped). */
export function researchGroundingIssueCodes(result: ResearchGroundingResult | undefined): string[] {
  if (!result) return [];
  return uniq(result.issues.map((i) => i.code)).slice(0, 12);
}

/* ── Owner diagnostics assembly (bounded, no secrets / URLs / prompts). ── */
export interface ResearchDirectionDiagnostics {
  researchEvidenceVersion: string;
  researchSufficiency: ResearchSufficiency;
  validatedSourceCount: number;
  discardedSourceCount: number;
  conflictingFindingCount: number;
  coveredAngleCount: number;
  sourceBackedFindingCount: number;
  inferredFindingCount: number;
  userProvidedFindingCount: number;
  approvedUserClaimCount: number;
  sector: string;
  subsector?: string;
  isSoftwareSector: boolean;
  upstreamEvidenceUsedToDeriveContract: string[];
  contractRenderedToFrontendBuilder: boolean;
  contractUsedByAcceptance: boolean;
  agentsActuallyConsumingContract: string[];
  requiredPatternCount: number;
  recommendedPatternCount: number;
  forbiddenModuleCount: number;
  researchGroundingStatus?: 'pass' | 'warning' | 'fail';
  researchGroundingIssueCodes?: string[];
  contractCharCount: number;
}

export function buildResearchDirectionDiagnostics(
  contract: ResearchDirectionContract | undefined,
  grounding: ResearchGroundingResult | undefined,
  contractCharCount: number,
): ResearchDirectionDiagnostics | undefined {
  if (!contract) return undefined;
  return {
    researchEvidenceVersion: contract.version,
    researchSufficiency: contract.status,
    validatedSourceCount: contract.validatedSourceCount,
    discardedSourceCount: contract.discardedSourceCount,
    conflictingFindingCount: contract.conflictingFindingCount,
    coveredAngleCount: contract.coveredAngles.length,
    sourceBackedFindingCount: contract.sourceBackedFindingCount,
    inferredFindingCount: contract.inferredFindingCount,
    userProvidedFindingCount: contract.userProvidedFindingCount,
    approvedUserClaimCount: contract.claimPolicy.approvedPublicClaims.length,
    sector: contract.sector,
    subsector: contract.subsector,
    isSoftwareSector: contract.isSoftwareSector,
    upstreamEvidenceUsedToDeriveContract: contract.upstreamEvidenceUsedToDeriveContract.slice(0, 8),
    contractRenderedToFrontendBuilder: contract.contractRenderedToFrontendBuilder,
    contractUsedByAcceptance: contract.contractUsedByAcceptance,
    agentsActuallyConsumingContract: contract.agentsActuallyConsumingContract.slice(0, 8),
    requiredPatternCount: contract.requiredPatterns.length,
    recommendedPatternCount: contract.recommendedPatterns.length,
    forbiddenModuleCount: contract.artDirection.forbiddenModules.length,
    researchGroundingStatus: grounding && !grounding.legacy ? grounding.status : undefined,
    researchGroundingIssueCodes: grounding ? researchGroundingIssueCodes(grounding) : undefined,
    contractCharCount,
  };
}
