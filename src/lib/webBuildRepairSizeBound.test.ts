import { describe, it, expect } from 'vitest';
import { parseBuildSections } from '@/lib/gameBuilderApi';
import { buildWebBuildPayload } from '@/lib/webBuildPayload';
import {
  fitStructuredBuilderRequestUnderCap, reviewIssueFilePaths, readStructuredSafetyRejection,
  buildFrontendBuilderDeltaRepairRequest, buildFrontendBuilderRepairRequest,
  BACKEND_STRUCTURED_MAX_LEN, FRONTEND_BUILDER_MODE,
} from '@/lib/webBuildApi';
import { reconstructRepairRawFromDelta } from '@/lib/webBuildDeltaRepair';
import type { WebBuildResult } from '@/lib/webBuildApi';
import type { FrontendBuildSpecification, FrontendBuilderReviewArtifact } from '@/lib/webBuildAgents';
import type { WebBuildFile } from '@/lib/webBuildPayload';

/**
 * Phase 14L.4 — the post-#586 blocker was the DELTA REPAIR transport, not the review. Production:
 *   frontendInitialReview = completed, score 65, blockers=2 major=3 minor=3 (review WORKS)
 *   frontendRepair = failed, frontendRepairReason = "Backend routed the delta repair request to an
 *   unexpected mode.", frontendAcceptance = manual-review-required
 *
 * MEASURED root cause: the delta repair request (spec ~99k + full source + delta prompt) is ~145k —
 * over the backend structured-builder safety cap (_STRUCTURED_MAX_LEN = 125_000). The safety guard
 * rejects it as `safety_length`; `/chat` returns mode="safety_length"; the repair transport's
 * `reportedMode !== 'frontend_builder'` assertion mislabels that as "unexpected mode". The repair
 * request was NEVER given the size-fitting that #585/#586 added to the review path (which is exactly
 * why generation + review now work but the repair does not). This reuses the SAME fitter for the
 * repair; no duplicate repair system, no threshold change, no extra provider call.
 */

const SECTIONS = ['hero', 'features', 'showcase', 'pricing', 'testimonials', 'faq', 'integrations', 'final-cta', 'footer'];

function bigReply(): string {
  const l = ['## Build Plan', 'Website type: premium SaaS platform', 'Audience: enterprise teams', 'Goal: convert', '', '## Page Sections'];
  for (const s of SECTIONS) l.push(`- ${s}: ${s} section with rich premium copy and detail`);
  l.push('', '## Generated Copy');
  for (const s of SECTIONS) {
    l.push(`### ${s}`);
    l.push(`Başlık: ${s} headline that is fairly long and descriptive for a premium brand`);
    l.push(`Alt başlık: ${s} subheadline elaborating the value proposition with specifics`);
    for (let i = 0; i < 6; i += 1) l.push(`- ${s} feature bullet ${i} with a supporting sentence`);
    l.push(`CTA: Explore ${s}`);
    l.push('');
  }
  l.push('## Frontend Code', '', '## Next Steps', '- ship');
  return l.join('\n');
}

function realSpecAndFiles(): { spec: FrontendBuildSpecification; files: WebBuildFile[] } {
  const payload = buildWebBuildPayload('a premium SaaS platform for enterprise teams',
    { reply: bigReply(), sections: parseBuildSections(bigReply()), partial: false, model: 'x', mode: 'website_builder', requestId: '1' } as WebBuildResult,
    undefined, 'tr');
  const spec = (payload.steps[payload.steps.length - 1]?.artifacts?.frontendBuildSpec
    || payload.artifacts?.frontendBuildSpec) as FrontendBuildSpecification;
  return { spec, files: (payload.files || []) as WebBuildFile[] };
}

function inflate(files: WebBuildFile[], perFile: number): WebBuildFile[] {
  const pad = `\n/* ${'detail '.repeat(Math.max(1, Math.floor(perFile / 7)))} */\n`;
  return files.map((f) => ({ ...f, content: (f.content || '') + pad }));
}

// The production review: score 65, actionable issues (copy-fidelity leak, unsupported claim).
function failingReview(issueFiles: string[]): FrontendBuilderReviewArtifact {
  return {
    version: 'frontend-review-v1', stage: 'initial', status: 'completed', reviewKind: 'model-static-design-review',
    renderedScreenshotReviewed: false, runtimeCompilationReviewed: false, verdict: 'repair', score: 65,
    strengths: ['clean layout'], resolvedIssueIds: [], passed: false, blockerCount: 2, majorCount: 3, minorCount: 3,
    reason: 'requests changes', mode: 'frontend_builder', responseCharCount: 100,
    issues: issueFiles.map((f, i) => ({
      id: `i${i}`, severity: i === 0 ? 'blocker' : 'major', category: 'copy-fidelity',
      files: [f], evidence: 'planning label leaked into public copy', repairInstruction: 'remove the label',
    })),
  } as unknown as FrontendBuilderReviewArtifact;
}

function fitDelta(spec: FrontendBuildSpecification, files: WebBuildFile[], review: FrontendBuilderReviewArtifact) {
  return fitStructuredBuilderRequestUnderCap(spec, files, reviewIssueFilePaths(review), undefined,
    (useSpec, compact) => buildFrontendBuilderDeltaRepairRequest(useSpec, files, review, undefined, undefined, compact));
}
function fitFullRepair(spec: FrontendBuildSpecification, files: WebBuildFile[], review: FrontendBuilderReviewArtifact) {
  return fitStructuredBuilderRequestUnderCap(spec, files, files.map((f) => f.path), undefined,
    (useSpec) => buildFrontendBuilderRepairRequest(useSpec, files, review));
}

describe('the DELTA REPAIR request now fits under the backend structured cap (the production failure)', () => {
  const { spec, files } = realSpecAndFiles();
  const review = failingReview(['src/App.tsx']);

  it('reproduces the failure: the UNBOUNDED delta repair request exceeds the 125k cap', () => {
    const unbounded = buildFrontendBuilderDeltaRepairRequest(spec, files, review);
    expect(unbounded.length).toBeGreaterThan(BACKEND_STRUCTURED_MAX_LEN); // ~145k → safety_length → "unexpected mode"
  });

  it('baseline build — the fitted delta repair request is under the cap', () => {
    const fit = fitDelta(spec, files, review);
    expect(fit.message.length).toBeLessThanOrEqual(BACKEND_STRUCTURED_MAX_LEN);
    expect(fit.fitMode).not.toBe('irreducible');
  });

  it('heavy build — escalates to spec-compacted and stays under the cap', () => {
    const fit = fitDelta(spec, inflate(files, 12_000), review);
    expect(fit.message.length).toBeLessThanOrEqual(BACKEND_STRUCTURED_MAX_LEN);
    expect(fit.specCompacted).toBe(true);
  });

  it('the review issue files are PINNED so the repair can still fix them (never dropped)', () => {
    const fit = fitDelta(spec, inflate(files, 12_000), review);
    // The fitted message must still contain the issue file path (App.tsx) as included full source.
    expect(fit.message).toContain('src/App.tsx');
  });

  it('a fitted delta reconstructs against the ORIGINAL full file set, preserving OMITTED files byte-for-byte', () => {
    // Prove dropping non-issue files from the REQUEST is safe: the pure delta module merges the
    // upserts into the original full files, so a file the request omitted survives unchanged.
    const original = files;
    const omitted = original.find((f) => f.path !== 'src/App.tsx' && (f.content || '').length > 0)!;
    const deltaRaw = {
      version: 'frontend-builder-raw-v1', status: 'completed', mode: 'frontend_builder', responseCharCount: 50,
      reason: 'ok', rawResponse: '## FRONTEND_DELTA_V1\n{"upserts":[{"path":"src/App.tsx","language":"tsx","content":"export default function App(){return <div/>;}"}]}\n## END_FRONTEND_DELTA_V1',
    } as never;
    const recon = reconstructRepairRawFromDelta({ deltaRaw, originalFiles: original as never });
    // The reconstructed frontend-files-v1 body still carries the omitted file's original content.
    expect(recon.repairRaw.status).toBe('completed');
    expect(recon.repairRaw.rawResponse).toContain(omitted.path);
  });
});

describe('the FULL repair request also fits — via spec-compaction ONLY (never drops files)', () => {
  const { spec, files } = realSpecAndFiles();
  const review = failingReview(['src/App.tsx']);

  it('baseline full repair fits under the cap and omits ZERO files (complete-project safety)', () => {
    const fit = fitFullRepair(spec, files, review);
    expect(fit.message.length).toBeLessThanOrEqual(BACKEND_STRUCTURED_MAX_LEN);
    expect(fit.omittedFileCount).toBe(0); // the full repair must never lose a file from its request
  });
});

describe('safety_length stays DISTINCT from a genuine unexpected mode (decision-table pin)', () => {
  it('a safety_length response is recognized as a safety rejection (not a routing/mode error)', () => {
    const r = readStructuredSafetyRejection({
      mode: 'safety_length',
      metadata: { safety: { status: 'rejected', code: 'length', request_char_count: 145000, limit_char_count: 125000 } },
    });
    expect(r).toContain('safety_length');
    expect(r).toContain('145000');
  });

  it('a GENUINE wrong mode (e.g. website_builder) is NOT a safety rejection → still hits the mode assertion', () => {
    // readStructuredSafetyRejection returns null, so the transport falls through to the
    // reportedMode !== frontend_builder rejection — a genuinely wrong mode is still rejected.
    expect(readStructuredSafetyRejection({ mode: 'website_builder', reply: '...' })).toBeNull();
    expect('website_builder').not.toBe(FRONTEND_BUILDER_MODE);
  });

  it('a normal frontend_builder success is neither a safety rejection nor a wrong mode', () => {
    expect(readStructuredSafetyRejection({ mode: FRONTEND_BUILDER_MODE, reply: '## FRONTEND_DELTA_V1' })).toBeNull();
  });
});

describe('reviewIssueFilePaths — bounded, deduped issue-file extraction', () => {
  it('collects the unique files referenced by review issues', () => {
    const review = failingReview(['src/App.tsx', 'src/sections/Hero.tsx', 'src/App.tsx']);
    expect(reviewIssueFilePaths(review).sort()).toEqual(['src/App.tsx', 'src/sections/Hero.tsx']);
  });
  it('returns empty for a review with no issues', () => {
    expect(reviewIssueFilePaths(undefined)).toEqual([]);
  });
});

import { selectBoundedRepairIssues, MAX_REPAIR_ISSUES } from '@/lib/webBuildApi';
import type { FrontendBuilderReviewIssue } from '@/lib/webBuildAgents';

/**
 * Repair issue SELECTION priority. Production: a valid repair improved 56->77 but the final review
 * still reported 2 majors (a contract-fidelity architecture issue + a component-composition issue).
 * The bounded repair set must fill in priority order — blocker > gate-critical research >
 * gate-critical major > contract-fidelity major > component-composition major > remaining major >
 * minor — so the highest-priority majors (including every acceptance-gate obligation) are never
 * squeezed out by lower-priority ones.
 */
describe('selectBoundedRepairIssues — priority order + bounded size', () => {
  const mk = (over: Partial<FrontendBuilderReviewIssue>): FrontendBuilderReviewIssue => ({
    id: over.id || 'x', severity: 'major', category: 'copy-fidelity', files: [], evidence: 'e', repairInstruction: 'r', ...over,
  });

  it('orders blocker > research > contract-fidelity > component-composition > major > minor', () => {
    const issues = [
      mk({ id: 'minor-1', severity: 'minor', category: 'typography' }),
      mk({ id: 'major-generic', severity: 'major', category: 'copy-fidelity' }),
      mk({ id: 'comp-1', severity: 'major', category: 'component-composition' }),
      mk({ id: 'cf-1', severity: 'major', category: 'contract-fidelity' }),
      mk({ id: 'research-required-pattern-missing-1', severity: 'major', category: 'contract-fidelity', gateCritical: true }),
      mk({ id: 'blocker-1', severity: 'blocker', category: 'honesty' }),
    ];
    const ids = selectBoundedRepairIssues(issues).map((i) => i.id);
    expect(ids).toEqual(['blocker-1', 'research-required-pattern-missing-1', 'cf-1', 'comp-1', 'major-generic', 'minor-1']);
  });

  it('never exceeds the bounded budget and keeps the top-priority issues when over budget', () => {
    const many: FrontendBuilderReviewIssue[] = [];
    for (let i = 0; i < 20; i += 1) many.push(mk({ id: `filler-${i}`, severity: 'minor', category: 'typography' }));
    many.push(mk({ id: 'cf-late', severity: 'major', category: 'contract-fidelity' }));
    const sel = selectBoundedRepairIssues(many);
    expect(sel.length).toBe(MAX_REPAIR_ISSUES);
    expect(sel.map((i) => i.id)).toContain('cf-late'); // a contract-fidelity major is never squeezed out by minors
  });

  it('a non-research gate-critical major is kept ahead of same-category model majors at the repair cap', () => {
    // Eight model contract-fidelity majors fill the repair budget; a later-appended gate-critical
    // binding obligation (same category) must still reach issuesToFix — Finding 3's merge survival
    // is useless if repair selection then drops it on a same-priority index tie.
    const issues: FrontendBuilderReviewIssue[] = [];
    for (let n = 0; n < 8; n += 1) {
      issues.push(mk({ id: `model-cf-${n}`, severity: 'major', category: 'contract-fidelity' }));
    }
    for (let n = 0; n < 4; n += 1) {
      issues.push(mk({ id: `model-minor-${n}`, severity: 'minor', category: 'typography' }));
    }
    issues.push(mk({
      id: 'binding-section-missing-1',
      severity: 'major',
      category: 'contract-fidelity',
      gateCritical: true,
      repairInstruction: 'restore the bound section',
    }));
    const ids = selectBoundedRepairIssues(issues).map((i) => i.id);
    expect(ids.length).toBe(MAX_REPAIR_ISSUES);
    expect(ids).toContain('binding-section-missing-1');
    expect(ids.filter((id) => id.startsWith('model-cf-')).length).toBe(MAX_REPAIR_ISSUES - 1);
  });
});
