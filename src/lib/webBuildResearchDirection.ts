/**
 * Web Build — RESEARCH-GROUNDED SECTOR DIRECTION + PREMIUM ART-DIRECTION / ANTI-TEMPLATE contract.
 *
 * ONE authoritative, additive, JSON-safe layer that turns the evidence the EXISTING research +
 * Vertical Intelligence pipeline already produced into (a) a bounded, normalized sector-evidence
 * contract with honest evidence typing + sufficiency, (b) an evidence-grounded premium art-direction
 * / anti-template contract, and (c) a conservative deterministic acceptance analysis proving the
 * generated project actually consumed that direction. It performs NO network request and NO model
 * call — it consumes what the backend Research Agent + Vertical Intelligence already threaded into
 * the FrontendBuildSpecification inputs, and it never fabricates sources, metrics, or claims.
 *
 * Design intent: make real sector evidence MATERIALLY control the final generation (via a compact
 * rendered direction block) and deterministic acceptance (via the existing single repair) — instead
 * of being recorded and ignored. It reuses the deterministic Vertical profiles (section/trust/visual
 * policy) as guardrails and the Research Agent evidence as source-backed signal, distinguishing the
 * two honestly. Everything is bounded and cost-free. Additive & optional for old/reopened builds.
 */
import type {
  FrontendGeneratedFile, FrontendBuilderReviewIssue, FrontendBuilderReviewSeverity, FrontendBuilderReviewCategory,
  FrontendSpecIdentity, FrontendSpecResearchEvidence, VerticalIntelligenceArtifact,
  ResearchAgentArtifact, ArtDirectionArtifact, StrategicThinkingLedger, WebBuildSource,
} from '@/lib/webBuildAgents';

/* ── Bounds (named, mandatory) ─────────────────────────────────────────────── */
const MAX_FINDINGS = 16;
const MAX_LIST = 8;
const MAX_SUBJECTS = 6;
const MAX_PATTERNS = 10;
const MAX_SOURCES = 8;
const MAX_SRC_CHARS = 240_000;
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
  /** Indices into `sources` (bounded). Empty when the finding is not mapped to a specific source. */
  sourceRefs: number[];
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
  /** Generic generator defaults to avoid UNLESS this build's evidence justifies them. */
  genericPatternsToAvoid: string[];
  /** Sector-incompatible modules/sections that must not appear (labels). */
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
  geography?: string;
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
  artDirection: ResearchArtDirection;
  consumedBy: string[];
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
    sourceRefs: [],
  }));
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
  const discardedSourceCount = Math.max(0, (input.research?.sourceCount || 0) - validatedSourceCount);
  const coveredAngles = uniq([...(input.research?.researchAngles || []), ...(vi?.researchPlan?.angles || [])].map((a) => clip(a, 40)).filter(Boolean)).slice(0, MAX_LIST);
  const conflictingFindingCount = (vi?.conflictingSignals || []).length;

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

  const sourceBackedFindingCount = findings.filter((f) => f.evidenceType === 'source-backed').length;
  const inferredFindingCount = findings.filter((f) => f.evidenceType === 'inferred').length;
  const userProvidedFindingCount = findings.filter((f) => f.evidenceType === 'user-provided').length;

  // ── Sufficiency (deterministic; source count alone is never treated as quality). ──
  let status: ResearchSufficiency;
  if (conflictingFindingCount >= 2) status = 'conflicting';
  else if (didUseRealSources && validatedSourceCount >= 3 && coveredAngles.length >= 3 && sourceBackedFindingCount >= 3) status = 'sufficient-source-backed';
  else if (didUseRealSources && validatedSourceCount >= 1) status = 'partial-source-backed';
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

  const consumedBy = uniq([
    input.research ? 'research' : '',
    ledger ? 'thinkingLedger' : '',
    vi ? 'verticalIntelligence' : '',
    ad ? 'artDirection' : '',
    'frontendBuilder',
  ].filter(Boolean));

  const reasons: string[] = [];
  if (!didUseRealSources) reasons.push(clip(re?.status ? `no live sources (${re.status})` : 'inference-only (no research artifact)', 80));
  if (status === 'conflicting') reasons.push('conflicting sector signals — manual review');
  if (discardedSourceCount > 0) reasons.push(`${discardedSourceCount} source(s) discarded as irrelevant/duplicate`);

  return {
    version: 'research-direction-v1', status,
    operatorIdentity, sector, subsector, audience, conversionModel,
    geography: undefined, isSoftwareSector,
    findings, sources: validSources, validatedSourceCount, discardedSourceCount, conflictingFindingCount,
    coveredAngles, sourceBackedFindingCount, inferredFindingCount, userProvidedFindingCount,
    requiredPatterns, recommendedPatterns, forbiddenClaims,
    artDirection, consumedBy, reasons,
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
 * ACCEPTANCE — conservative deterministic proof the project consumed the direction.
 * Strong correlated evidence only; weak stylistic signals warn (manual-review), never
 * hard-block. Pure; fail-open at the call site.
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
function filesWith(files: FrontendGeneratedFile[], re: RegExp): string[] {
  const out: string[] = [];
  for (const f of files) { if (re.test(f.content)) out.push(f.path); if (out.length >= MAX_ISSUE_FILES) break; }
  return out;
}

// Clear FABRICATION templates (never legitimate research-backed copy without user proof).
const FABRICATION_RES: Array<{ re: RegExp; what: string }> = [
  { re: /\btrusted by\s+[\d,]{2,}\+?\s*(?:customers|users|clients|companies|businesses|teams|brands)/i, what: 'trusted-by customer count' },
  { re: /\b[\d,]{3,}\+?\s*(?:happy\s+)?(?:customers|users|clients|members|downloads|five[- ]star reviews)/i, what: 'invented customer/user count' },
  { re: /\b\d(?:\.\d)?\s*(?:★|stars?)\b[^<]{0,40}\b(?:from\s+)?[\d,]{2,}\s*reviews/i, what: 'invented star-rating volume' },
  { re: /\baward[- ]winning\b|\bvoted\s+#?1\b|\bas seen (?:in|on)\b|\b#1[- ]rated\b/i, what: 'unverifiable award / "as seen in" claim' },
];

/** Significant tokens of a required/forbidden label (drops short/stop words). */
function labelTokens(label: string): string[] {
  return toks(label).filter((w) => w.length >= 4 && !['with', 'that', 'your', 'their', 'from', 'this', 'section', 'page', 'and', 'the'].includes(w));
}

export function analyzeResearchGrounding(
  files: FrontendGeneratedFile[] | undefined,
  contract: ResearchDirectionContract | undefined,
): ResearchGroundingResult {
  try {
    if (!contract) return LEGACY_GROUNDING;
    const list = Array.isArray(files) ? files : [];
    if (!list.length) return { ...LEGACY_GROUNDING, legacy: false };
    const src = list.map((f) => f.content).join('\n').slice(0, MAX_SRC_CHARS);
    const srcLower = src.toLowerCase();
    const issues: ResearchGroundingIssue[] = [];
    let requiredMissing = 0; let forbiddenCount = 0; let fabricated = 0; let repetition = 0;
    const push = (i: ResearchGroundingIssue) => { if (issues.length < MAX_ISSUES) issues.push(i); };

    // 1) Forbidden sector modules present (strong: full phrase or ≥2 distinctive tokens). Blocking.
    for (const mod of contract.artDirection.forbiddenModules) {
      const tk = labelTokens(mod);
      if (!tk.length) continue;
      const full = srcLower.includes(mod.toLowerCase());
      const hits = tk.filter((t) => present(t, src)).length;
      if (full || hits >= 2) {
        forbiddenCount += 1;
        push({ code: 'research-forbidden-module', severity: 'major', label: mod, files: filesWith(list, new RegExp(esc(tk[0]), 'i')),
          evidence: capEv(`sector-incompatible module "${mod}" appears on a ${contract.sector} site — research/sector evidence forbids it`),
          repairInstruction: capEv(`Remove the "${mod}" module (it belongs to a different sector) and replace it with a section appropriate to ${contract.operatorIdentity}.`) });
        if (forbiddenCount >= 4) break;
      }
    }

    // 2) Fabricated public claims (clear templates only). Blocking.
    for (const fab of FABRICATION_RES) {
      if (fab.re.test(src)) {
        fabricated += 1;
        push({ code: 'research-fabricated-claim', severity: 'major', label: fab.what, files: filesWith(list, fab.re),
          evidence: capEv(`a fabricated ${fab.what} appears in public copy — no real user-supplied proof backs it (research inference must never become a public factual claim)`),
          repairInstruction: capEv(`Remove the ${fab.what}; use neutral, non-factual copy unless the user supplied real proof. Never invent metrics, awards, logos or testimonials.`) });
        if (fabricated >= 3) break;
      }
    }

    // 3) Required sector patterns entirely absent (only when we have real sector authority). Blocking, capped.
    const strongAuthority = contract.status === 'sufficient-source-backed' || contract.status === 'partial-source-backed'
      || (contract.requiredPatterns.length > 0 && contract.sector !== 'general');
    if (strongAuthority) {
      for (const req of contract.requiredPatterns) {
        const tk = labelTokens(req);
        if (!tk.length) continue;
        const anyPresent = tk.some((t) => present(t, src));
        if (!anyPresent) {
          requiredMissing += 1;
          push({ code: 'research-required-pattern-missing', severity: 'major', label: req, files: [],
            evidence: capEv(`required sector pattern "${req}" is absent — the researched ${contract.sector} decision journey expects it`),
            repairInstruction: capEv(`Add a real "${req}" section appropriate to ${contract.operatorIdentity}; the researched conversion journey depends on it.`) });
          if (requiredMissing >= 2) break;   // conservative cap — never flood with false blockers
        }
      }
    }

    // 4) Template repetition — many identical equal-card grids across the page. Warning (manual-review).
    const gridCols = (src.match(/grid-cols-3\b/gi) || []).length;
    const cardHits = (src.match(/\brounded-(?:xl|2xl|3xl)\b[^"]*\b(?:shadow|border)\b/gi) || []).length;
    if (gridCols >= 4 && cardHits >= 9) {
      repetition += 1;
      push({ code: 'research-template-repetition', severity: 'minor', label: 'repeated identical card grids', files: filesWith(list, /grid-cols-3\b/i),
        evidence: capEv(`the page repeats identical equal-sized card grids (${gridCols} three-column grids) — a generic template rhythm rather than the researched decision journey`),
        repairInstruction: capEv('Vary section rhythm to match the researched conversion journey; do not reuse the same equal-card grid for every section.') });
    }

    // 5) Art-direction contradiction — dark navy/purple AI styling on a non-software business. Warning.
    if (!contract.isSoftwareSector) {
      const aiGlow = (srcLower.match(/(?:from|via|to)-(?:purple|violet|indigo|fuchsia)-\d{3}/g) || []).length;
      const darkGlass = /backdrop-blur|bg-slate-9\d0\/|bg-black\/[3-8]0/i.test(src);
      if (aiGlow >= 4 && darkGlass) {
        push({ code: 'research-artdirection-contradiction', severity: 'minor', label: 'AI-gradient styling on a non-software business', files: filesWith(list, /(?:from|via|to)-(?:purple|violet|indigo|fuchsia)-\d{3}/i),
          evidence: capEv(`heavy dark-navy/purple AI-gradient + glass styling on a ${contract.sector} site contradicts the researched art direction (${clip(contract.artDirection.emotionalTone, 40)})`),
          repairInstruction: capEv(`Adopt the researched palette/tone for ${contract.operatorIdentity}; reserve dark-purple AI aesthetics for genuine software products.`) });
      }
    }

    // 6) Operator identity not evident anywhere. Warning.
    const idTokens = labelTokens(contract.operatorIdentity).concat(labelTokens(contract.subsector || contract.sector));
    if (idTokens.length && !idTokens.some((t) => present(t, src))) {
      push({ code: 'research-identity-missing', severity: 'minor', label: contract.operatorIdentity, files: [],
        evidence: capEv(`no evidence of the operator identity/sector ("${contract.operatorIdentity}") in the rendered copy — the site reads generically`),
        repairInstruction: capEv(`Make ${contract.operatorIdentity} and its ${contract.sector} context explicit in the copy and structure.`) });
    }

    const blocking = issues.some((i) => i.code === 'research-forbidden-module' || i.code === 'research-fabricated-claim' || i.code === 'research-required-pattern-missing');
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
  sector: string;
  subsector?: string;
  isSoftwareSector: boolean;
  consumedBy: string[];
  requiredPatternCount: number;
  recommendedPatternCount: number;
  forbiddenModuleCount: number;
  artDirectionStatus: 'derived' | 'legacy';
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
    sector: contract.sector,
    subsector: contract.subsector,
    isSoftwareSector: contract.isSoftwareSector,
    consumedBy: contract.consumedBy.slice(0, 8),
    requiredPatternCount: contract.requiredPatterns.length,
    recommendedPatternCount: contract.recommendedPatterns.length,
    forbiddenModuleCount: contract.artDirection.forbiddenModules.length,
    artDirectionStatus: 'derived',
    researchGroundingStatus: grounding && !grounding.legacy ? grounding.status : undefined,
    researchGroundingIssueCodes: grounding ? researchGroundingIssueCodes(grounding) : undefined,
    contractCharCount,
  };
}
