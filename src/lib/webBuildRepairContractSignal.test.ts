import { describe, it, expect } from 'vitest';
import { parseBuildSections } from '@/lib/gameBuilderApi';
import { buildWebBuildPayload } from '@/lib/webBuildPayload';
import {
  fitStructuredBuilderRequestUnderCap, reviewIssueFilePaths,
  buildFrontendBuilderDeltaRepairRequest, buildFrontendBuilderRepairRequest,
  BACKEND_STRUCTURED_MAX_LEN,
} from '@/lib/webBuildApi';
import type { WebBuildResult } from '@/lib/webBuildApi';
import type { FrontendBuildSpecification, FrontendBuilderReviewArtifact } from '@/lib/webBuildAgents';
import type { WebBuildFile } from '@/lib/webBuildPayload';

/**
 * Phase 2 — the two repair request producers must emit DISTINCT, machine-readable response-contract
 * markers so the backend can size the provider budget by the ACTUAL output contract:
 *   full-project repair  → [FRONTEND REPAIR CONTRACT: frontend-files-v1]   (backend keeps 30k)
 *   bounded delta repair → [FRONTEND REPAIR CONTRACT: frontend-delta-v1]   (backend → 16k)
 * The marker is a header line and must survive request size-fitting (never stripped before the
 * backend task resolver sees it). Neither marker changes the [FRONTEND REPAIR REQUEST] discriminator.
 */

const _FILES_MARKER = '[FRONTEND REPAIR CONTRACT: frontend-files-v1]';
const _DELTA_MARKER = '[FRONTEND REPAIR CONTRACT: frontend-delta-v1]';
const SECTIONS = ['hero', 'features', 'pricing', 'faq', 'footer'];

function reply(): string {
  const l = ['## Build Plan', 'Website type: premium SaaS', 'Audience: teams', 'Goal: convert', '', '## Page Sections'];
  for (const s of SECTIONS) l.push(`- ${s}: ${s} section with premium copy`);
  l.push('', '## Generated Copy');
  for (const s of SECTIONS) { l.push(`### ${s}`, `Başlık: ${s} headline`, `Alt başlık: ${s} subheadline`, `CTA: ${s}`, ''); }
  l.push('## Frontend Code', '', '## Next Steps', '- ship');
  return l.join('\n');
}

function specAndFiles(): { spec: FrontendBuildSpecification; files: WebBuildFile[] } {
  const payload = buildWebBuildPayload('a premium SaaS platform for teams',
    { reply: reply(), sections: parseBuildSections(reply()), partial: false, model: 'x', mode: 'website_builder', requestId: '1' } as WebBuildResult,
    undefined, 'tr');
  const spec = (payload.steps[payload.steps.length - 1]?.artifacts?.frontendBuildSpec
    || payload.artifacts?.frontendBuildSpec) as FrontendBuildSpecification;
  return { spec, files: (payload.files || []) as WebBuildFile[] };
}

function review(issueFiles: string[]): FrontendBuilderReviewArtifact {
  return {
    version: 'frontend-review-v1', stage: 'initial', status: 'completed', reviewKind: 'model-static-design-review',
    renderedScreenshotReviewed: false, runtimeCompilationReviewed: false, verdict: 'repair', score: 65,
    strengths: ['clean layout'], resolvedIssueIds: [], passed: false, blockerCount: 1, majorCount: 1, minorCount: 0,
    reason: 'requests changes', mode: 'frontend_builder', responseCharCount: 100,
    issues: issueFiles.map((f, i) => ({
      id: `i${i}`, severity: i === 0 ? 'blocker' : 'major', category: 'copy-fidelity',
      files: [f], evidence: 'planning label leaked into public copy', repairInstruction: 'remove the label',
    })),
  } as unknown as FrontendBuilderReviewArtifact;
}

describe('repair request response-contract signal (Phase 2)', () => {
  const { spec, files } = specAndFiles();
  const rv = review(['src/App.tsx']);

  it('the FULL-project repair emits the frontend-files-v1 contract marker (and NOT the delta marker)', () => {
    const msg = buildFrontendBuilderRepairRequest(spec, files, rv);
    expect(msg).toContain(_FILES_MARKER);
    expect(msg).not.toContain(_DELTA_MARKER);
  });

  it('the DELTA repair emits the frontend-delta-v1 contract marker (and NOT the files marker)', () => {
    const msg = buildFrontendBuilderDeltaRepairRequest(spec, files, rv);
    expect(msg).toContain(_DELTA_MARKER);
    expect(msg).not.toContain(_FILES_MARKER);
  });

  it('both still carry the [FRONTEND REPAIR REQUEST] discriminator (classification unchanged)', () => {
    for (const msg of [buildFrontendBuilderRepairRequest(spec, files, rv), buildFrontendBuilderDeltaRepairRequest(spec, files, rv)]) {
      expect(msg).toContain('[FRONTEND BUILDER REQUEST]');
      expect(msg).toContain('[FRONTEND REPAIR REQUEST]');
      // The contract marker must NOT be mistakable for the contract-repair marker.
      expect(msg).not.toContain('[FRONTEND CONTRACT REPAIR REQUEST]');
    }
  });

  it('the delta contract marker SURVIVES the backend-cap size fitter (header never stripped)', () => {
    const fit = fitStructuredBuilderRequestUnderCap(spec, files, reviewIssueFilePaths(rv), undefined,
      (useSpec, compact) => buildFrontendBuilderDeltaRepairRequest(useSpec, files, rv, undefined, undefined, compact));
    expect(fit.message.length).toBeLessThanOrEqual(BACKEND_STRUCTURED_MAX_LEN);
    expect(fit.message).toContain(_DELTA_MARKER);
    expect(fit.message).not.toContain(_FILES_MARKER);
  });

  it('the full-repair contract marker SURVIVES the size fitter', () => {
    const fit = fitStructuredBuilderRequestUnderCap(spec, files, files.map((f) => f.path), undefined,
      (useSpec) => buildFrontendBuilderRepairRequest(useSpec, files, rv));
    expect(fit.message).toContain(_FILES_MARKER);
    expect(fit.message).not.toContain(_DELTA_MARKER);
  });
});
