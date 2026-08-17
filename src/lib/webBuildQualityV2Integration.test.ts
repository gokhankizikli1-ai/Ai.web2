/**
 * Quality V2 — INTEGRATION INVARIANTS.
 *
 * These tests guard the seams where Quality V2 meets existing authorities. They exist to make the
 * dangerous failure modes loud:
 *   • a rendered regression must reject a repair, but must never demote a build to Safe Preview;
 *   • a promoted candidate must be consumed, but must never be reported as APPROVED;
 *   • builds with no rendered measurement must behave EXACTLY as they did before Quality V2.
 */
import { describe, it, expect } from 'vitest';
import { evaluateAcceptanceGate, buildUserFacingAcceptanceReasonFromArtifact } from '@/lib/webBuildAcceptanceGate';
import { attachFrontendBuilderQualityResult } from '@/lib/webBuildPayload';
import type {
  FrontendBuilderAcceptanceArtifact, FrontendBuilderValidationArtifact, FrontendGeneratedFile,
} from '@/lib/webBuildAgents';

/** A gate input where every existing condition passes, so a single flag decides the outcome. */
const PASSING_GATE = {
  finalReviewCompleted: true,
  finalReviewPassed: true,
  initialScore: 70,
  finalScore: 88,
  minRequiredScore: 82,
  blockerCount: 0,
  majorCount: 0,
  severeWarningGatePassed: true,
  blockingBinding: false,
  blockingResearch: false,
  blockingComposition: false,
  blockingVisualSystem: false,
  blockingContent: false,
  blockingExperience: false,
  blockingVisual: false,
  blockingExperienceIdentity: false,
  blockingMotionExecution: false,
  obligationRegressionRejects: false,
};

describe('acceptance gate — the rendered re-verification gate', () => {
  it('accepts exactly as before when no rendered regression is reported', () => {
    expect(evaluateAcceptanceGate(PASSING_GATE).accept).toBe(true);
    expect(evaluateAcceptanceGate({ ...PASSING_GATE, renderedRegressionRejects: false }).accept).toBe(true);
  });

  it('rejects a statically-perfect repair that measurably rendered worse', () => {
    const g = evaluateAcceptanceGate({ ...PASSING_GATE, renderedRegressionRejects: true });
    expect(g.accept).toBe(false);
    expect(g.reasonCode).toBe('rendered-regression');
    expect(g.diagnostics.renderedRegressionRejects).toBe(true);
  });

  it('outranks every static reason, because rendered truth beats source inference', () => {
    const g = evaluateAcceptanceGate({
      ...PASSING_GATE,
      renderedRegressionRejects: true,
      blockingExperience: true,
      blockingContent: true,
    });
    expect(g.reasonCode).toBe('rendered-regression');
  });

  it('is absent from diagnostics when it did not block (no noise on old builds)', () => {
    expect(evaluateAcceptanceGate(PASSING_GATE).diagnostics.renderedRegressionRejects).toBeUndefined();
  });

  it('explains itself to a normal user without leaking internals', () => {
    const g = evaluateAcceptanceGate({ ...PASSING_GATE, renderedRegressionRejects: true });
    const msg = buildUserFacingAcceptanceReasonFromArtifact({
      status: 'manual-review-required',
      acceptanceGate: g.diagnostics,
    });
    expect(msg?.en).toContain('rendered worse');
    expect(msg?.tr).toBeTruthy();
    // No internal module names, codes, scores-beyond-the-gate, prompts or ids.
    expect(msg?.en).not.toMatch(/webBuild|rendered-regression|blocking[A-Z]/);
  });
});

/* ── Payload consumption ─────────────────────────────────────────────────────────────────── */

function genFile(path: string, content: string): FrontendGeneratedFile {
  return { path, content, language: 'tsx', lineCount: 1, charCount: content.length } as FrontendGeneratedFile;
}

const REPAIRED_FILES = [
  genFile('src/main.tsx', 'repaired main'),
  genFile('src/App.tsx', 'repaired app'),
];

const REPAIRED_VALIDATION = {
  status: 'valid', readyForConsumption: true, files: REPAIRED_FILES,
  fileCount: 2, totalCharCount: 25, errors: [], warnings: [],
} as unknown as FrontendBuilderValidationArtifact;

function basePayload() {
  return {
    prompt: 'a restaurant site',
    files: [
      { path: 'src/main.tsx', content: 'initial main', language: 'tsx', status: 'added', added: 1, removed: 0 },
      { path: 'src/App.tsx', content: 'initial app', language: 'tsx', status: 'added', added: 1, removed: 0 },
    ],
    steps: [{ id: 's1', files: [], artifacts: { enforcement: {} } }],
    // `enforcement` must already exist for the payload to patch it — that is pre-existing
    // behaviour, so the fixture mirrors a real consumed payload rather than an empty one.
    artifacts: { enforcement: {} },
  } as never;
}

function acceptance(over: Partial<FrontendBuilderAcceptanceArtifact>): FrontendBuilderAcceptanceArtifact {
  return {
    version: 'frontend-acceptance-v1',
    status: 'manual-review-required',
    activeProject: 'initial-model-native',
    initialReviewPassed: false,
    repairAttempted: true,
    repairAccepted: false,
    finalReviewPassed: false,
    renderedVisualTestStatus: 'pending-manual-test',
    renderedScreenshotReviewed: false,
    runtimeCompilationReviewed: false,
    reason: 'test',
    ...over,
  } as FrontendBuilderAcceptanceArtifact;
}

describe('payload consumption — a promoted best candidate', () => {
  it('replaces the active files when the repair was promoted, even though it was not approved', () => {
    const out = attachFrontendBuilderQualityResult(basePayload(), {
      ran: true,
      acceptance: acceptance({ activeProject: 'repaired-model-native' }),
      acceptedRepairedFiles: REPAIRED_FILES,
      acceptedRepairedValidation: REPAIRED_VALIDATION,
      bestCandidatePromoted: true,
    });
    expect(out.files.map((f) => f.content)).toEqual(['repaired main', 'repaired app']);
    expect(out.artifacts?.frontendBuilderValidation).toBe(REPAIRED_VALIDATION);
  });

  it('never reports a promoted candidate as an approved or accepted repair', () => {
    const out = attachFrontendBuilderQualityResult(basePayload(), {
      ran: true,
      acceptance: acceptance({ activeProject: 'repaired-model-native' }),
      acceptedRepairedFiles: REPAIRED_FILES,
      acceptedRepairedValidation: REPAIRED_VALIDATION,
      bestCandidatePromoted: true,
    });
    const acc = out.artifacts?.frontendBuilderAcceptance;
    // The acceptance STATUS is the quality claim. It must stay provisional.
    expect(acc?.status).toBe('manual-review-required');
    expect(acc?.repairAccepted).toBe(false);
    expect(out.artifacts?.enforcement?.didAcceptFrontendBuilderRepair).toBe(false);
    // ...and the consumption reason must say so out loud rather than implying approval.
    expect(out.artifacts?.frontendBuilderConsumption?.reason).toContain('PROVISIONAL');
  });

  it('does NOT consume a repaired project that was neither approved nor promoted', () => {
    const out = attachFrontendBuilderQualityResult(basePayload(), {
      ran: true,
      acceptance: acceptance({}),
      acceptedRepairedFiles: REPAIRED_FILES,
      acceptedRepairedValidation: REPAIRED_VALIDATION,
      // bestCandidatePromoted omitted → the pre-Quality-V2 behaviour.
    });
    expect(out.files.map((f) => f.content)).toEqual(['initial main', 'initial app']);
  });

  it('still consumes an approved repair through the unchanged approval path', () => {
    const out = attachFrontendBuilderQualityResult(basePayload(), {
      ran: true,
      acceptance: acceptance({ status: 'repaired-approved', activeProject: 'repaired-model-native', repairAccepted: true }),
      acceptedRepairedFiles: REPAIRED_FILES,
      acceptedRepairedValidation: REPAIRED_VALIDATION,
    });
    expect(out.files.map((f) => f.content)).toEqual(['repaired main', 'repaired app']);
    expect(out.artifacts?.frontendBuilderConsumption?.reason).not.toContain('PROVISIONAL');
  });

  it('keeps the model-native preview source — promotion never routes through Safe Preview', () => {
    const out = attachFrontendBuilderQualityResult(basePayload(), {
      ran: true,
      acceptance: acceptance({ activeProject: 'repaired-model-native' }),
      acceptedRepairedFiles: REPAIRED_FILES,
      acceptedRepairedValidation: REPAIRED_VALIDATION,
      bestCandidatePromoted: true,
    });
    expect(out.artifacts?.frontendBuilderConsumption?.previewSource).toBe('model-native-sandbox');
    expect(out.artifacts?.frontendBuilderConsumption?.status).toBe('model-native');
    expect(out.artifacts?.enforcement?.frontendBuilderPreviewSource).toBe('model-native-sandbox');
  });
});
