/**
 * Web Build EXPERIENCE ARCHITECTURE COMPLIANCE (PR #510).
 *
 * Deterministic, STATIC compliance of generated `frontend-files-v1` source against the
 * structured ExperienceArchitecturePlan. NO screenshot / runtime / DOM evaluation (that is a
 * later PR). `evaluateExperienceCompliance` is pure, synchronous, network-free, non-mutating,
 * bounded, JSON-serializable and FAILS OPEN (returns `undefined` on any problem, never throws).
 *
 * It is WARNING-ONLY: the caller records the diagnostics but NEVER changes validation status
 * or gates consumption on them — a build is never blocked because the planner or this check
 * disagreed with the model. Heuristics are intentionally conservative (low false-positive):
 * absence of clear evidence is reported as a specific warning, not a hard failure.
 */
import type {
  FrontendGeneratedFile, ExperienceArchitecturePlan, ExperienceComplianceDiagnostics,
  ExperienceVisualMedium, ExperienceSectionContract,
} from '@/lib/webBuildAgents';

const MAX_WARNINGS = 20;
const MAX_LIST = 20;
const SEQUENCE_THRESHOLD = 0.6;   // ≥60% of the planned order preserved counts as "respected"

const norm = (v: string): string => (v || '').toLowerCase();
const idToken = (id: string): string => norm(id).replace(/[^a-z0-9]+/g, '');

/** Longest-common-subsequence length of two id arrays (order similarity). */
function lcs(a: string[], b: string[]): number {
  const m = a.length, n = b.length;
  if (m === 0 || n === 0) return 0;
  const dp: number[] = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    let prev = 0;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

/** The order section ids FIRST appear across the concatenated source (best-effort). */
function observedOrder(planned: string[], blob: string): string[] {
  const seen: Array<{ id: string; at: number }> = [];
  for (const id of planned) {
    const tok = idToken(id);
    if (!tok) continue;
    // Match the id in kebab/camel/plain form as an attribute value, path or identifier.
    const at = blob.indexOf(tok);
    if (at >= 0) seen.push({ id, at });
  }
  return seen.sort((x, y) => x.at - y.at).map((e) => e.id);
}

/** Is a required visual medium represented somewhere in the source? Conservative. */
function mediumRepresented(medium: ExperienceVisualMedium, blob: string): boolean {
  switch (medium) {
    case 'photography':
      return /<img\b/.test(blob) || /background-image\s*:/.test(blob);
    case 'product_ui':
    case 'interactive_demo':
      // A REAL interactive component — state or handlers — not just a static SVG diagram.
      return /(usestate|usereducer|onclick|onchange|oninput|role=["']tab|<button\b|<input\b|<textarea\b|<select\b)/.test(blob);
    case 'data_visualization':
      return /(recharts|<svg[\s\S]{0,4000}<text\b|chart|<canvas\b|role=["']img["'][\s\S]{0,200}aria-label)/.test(blob);
    case 'video_or_motion':
      return /(<video\b|framer-motion|motion\.|animate=|@keyframes|transition:)/.test(blob);
    case 'illustration':
      return /(<svg\b|illustration)/.test(blob);
    case 'typography':
    case 'none':
    case 'mixed':
      return true;   // nothing to require
    default:
      return true;
  }
}

/** A small map of forbidden-pattern phrases → a deterministic source signature. Only the
 *  detectable ones are checked; undetectable phrases are left to the model + human review. */
function detectForbidden(phrase: string, blob: string): boolean {
  const p = norm(phrase);
  if (/(feature[-\s]?card|three\s+cards|card\s+grid|feature\s+grid)/.test(p)) {
    // ≥3 repeated card blocks in a 3-col grid.
    const cards = (blob.match(/classname=["'][^"']*\bcard\b/g) || []).length;
    return /grid-cols-3/.test(blob) && cards >= 3;
  }
  if (/(dashboard\s+card|technical\s+diagram|node\s+diagram)/.test(p)) {
    // Diagram-heavy with no real photography.
    return /<svg\b/.test(blob) && !/<img\b/.test(blob);
  }
  if (/(neon|cyberpunk)/.test(p)) {
    return /(neon|#0ff|#f0f|drop-shadow\([^)]*(?:0ff|f0f))/.test(blob);
  }
  if (/(testimonial)/.test(p)) {
    return /testimonial/.test(blob);
  }
  return false;   // not statically detectable → do not claim a violation
}

/** Does a proof section carry real evidence, or only an empty skeleton? */
function proofLooksEmpty(section: ExperienceSectionContract, blob: string): boolean {
  const tok = idToken(section.id);
  if (!tok) return false;
  const at = blob.indexOf(tok);
  if (at < 0) return false;                 // not represented → handled elsewhere
  const window = blob.slice(at, at + 2500); // a bounded neighbourhood around the section
  const hasSkeleton = /(animate-pulse|skeleton|placeholder-bar)/.test(window);
  const hasRealEvidence = /(<img\b|\d|<button\b|<input\b|aria-label|<table\b|recharts|motion\.)/.test(window);
  return hasSkeleton && !hasRealEvidence;
}

/**
 * Evaluate compliance of generated files against a plan. Returns `undefined` when there is no
 * plan or no files (nothing to check). Never throws.
 */
export function evaluateExperienceCompliance(
  files: FrontendGeneratedFile[] | undefined,
  plan: ExperienceArchitecturePlan | undefined,
): ExperienceComplianceDiagnostics | undefined {
  try {
    if (!plan || plan.version !== 'experience-arch-v1') return undefined;
    if (!Array.isArray(files) || files.length === 0) return undefined;

    const blob = norm(files.map((f) => `${f.path}\n${f.content}`).join('\n'));
    const warnings: string[] = [];
    const pushWarn = (w: string) => { if (warnings.length < MAX_WARNINGS) warnings.push(w); };

    // 1. Section coverage — is each planned section represented in the source?
    const contracts = Array.isArray(plan.sectionContracts) ? plan.sectionContracts : [];
    const missingSections: string[] = [];
    for (const c of contracts) {
      const tok = idToken(c.id);
      if (tok && blob.indexOf(tok) < 0 && missingSections.length < MAX_LIST) missingSections.push(c.id);
    }
    if (missingSections.length > 0) pushWarn(`Missing sections: ${missingSections.join(', ')}`);

    // 2. Sequence respected — order similarity vs the planned sequence.
    const planned = (plan.sectionSequence || []).filter(Boolean);
    const observed = observedOrder(planned, blob);
    const sequenceRespected = planned.length <= 1
      ? true
      : (lcs(planned, observed) / planned.length) >= SEQUENCE_THRESHOLD;
    if (!sequenceRespected) pushWarn('Section sequence substantially diverges from the plan');

    // 3. Required media represented.
    const requiredMedia = new Set<ExperienceVisualMedium>();
    if (plan.primaryVisualMedium) requiredMedia.add(plan.primaryVisualMedium);
    for (const c of contracts) requiredMedia.add(c.visualMedium);
    const missingMedia: string[] = [];
    for (const m of requiredMedia) {
      if (!mediumRepresented(m, blob) && missingMedia.length < MAX_LIST) missingMedia.push(m);
    }
    const requiredMediaRepresented = missingMedia.length === 0;
    if (!requiredMediaRepresented) pushWarn(`Required visual medium not represented: ${missingMedia.join(', ')}`);

    // 4. Hero pattern not collapsed to the generic centered-headline default.
    let heroPatternRespected = true;
    if (plan.heroContentPriority !== 'text' && plan.heroContentPriority !== 'none') {
      // The hero should show its medium/interaction; if the source has NO image, chart,
      // video or interactive element at all, it collapsed to a text hero.
      const anyRichSurface = /(<img\b|<svg\b|<video\b|<canvas\b|usestate|<button\b|<input\b)/.test(blob);
      if (!anyRichSurface) { heroPatternRespected = false; pushWarn('Hero pattern appears collapsed to a generic text hero'); }
    }
    if (plan.landingRequired === false && /class(name)?=["'][^"']*min-h-screen[^"']*["'][\s\S]{0,400}<h1\b/.test(blob)) {
      // Explicitly no landing page, yet a full-screen headline hero is present.
      pushWarn('Plan sets landingRequired=false but a full-screen headline hero is present');
      heroPatternRespected = false;
    }

    // 5. Forbidden patterns.
    const forbiddenPatternViolations: string[] = [];
    for (const phrase of (plan.forbiddenPatterns || [])) {
      if (detectForbidden(phrase, blob) && forbiddenPatternViolations.length < MAX_LIST) {
        forbiddenPatternViolations.push(phrase);
      }
    }
    if (forbiddenPatternViolations.length > 0) pushWarn(`Forbidden patterns present: ${forbiddenPatternViolations.join('; ')}`);

    // 6. Proof requirements not replaced by empty skeletons.
    const emptyProofSections: string[] = [];
    for (const c of contracts) {
      if (c.proofRequirement && proofLooksEmpty(c, blob) && emptyProofSections.length < MAX_LIST) {
        emptyProofSections.push(c.id);
      }
    }
    const proofSatisfied = emptyProofSections.length === 0;
    if (!proofSatisfied) pushWarn(`Proof replaced by empty skeleton in: ${emptyProofSections.join(', ')}`);

    const compliant = missingSections.length === 0 && sequenceRespected && requiredMediaRepresented
      && heroPatternRespected && forbiddenPatternViolations.length === 0 && proofSatisfied;

    return {
      version: 'experience-compliance-v1',
      planPresent: true,
      requiredSectionCount: contracts.length,
      representedSectionCount: Math.max(0, contracts.length - missingSections.length),
      missingSections,
      sequenceRespected,
      requiredMediaRepresented,
      missingMedia,
      heroPatternRespected,
      forbiddenPatternViolations,
      proofSatisfied,
      emptyProofSections,
      warnings,
      compliant,
    };
  } catch {
    return undefined;   // fail open — never break validation
  }
}
