import { describe, it, expect } from 'vitest';
import { parseFrontendBuilderReview, extractReviewJsonObject } from '@/lib/webBuildFrontendReview';
import type { FrontendBuilderReviewRawArtifact } from '@/lib/webBuildAgents';
import type { WebBuildFile } from '@/lib/webBuildPayload';

/**
 * Design-quality review parser robustness regression suite.
 *
 * Production case: a fresh build fell to Safe Preview with "the automatic design-quality review did
 * not complete". The parser hard-rejected ANY reviewer body that was not a bare `{…}` object — so a
 * review wrapped in a ```json fence or with a line of surrounding prose (both extremely common model
 * behaviours) became a false "review incomplete". These tests pin that a fenced / prose-wrapped
 * review is now recovered and completes, while a genuinely truncated body still fails (we never
 * infer quality from a partial review), and every strict schema check still runs.
 */

const DIMENSIONS = {
  conceptSpecificity: 90, visualHierarchy: 88, layoutRhythm: 86, typography: 84,
  paletteAndSurfaces: 85, componentComposition: 87, motionAndInteraction: 83,
  responsiveIntent: 86, accessibilityIntent: 84, copyAndContractFidelity: 88,
  honesty: 92, maintainability: 85,
};

function reviewObject(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 'frontend-review-v1',
    stage: 'initial',
    verdict: 'pass',
    score: 88,
    dimensions: DIMENSIONS,
    issues: [],
    strengths: ['clean hierarchy'],
    resolvedIssueIds: [],
    summary: 'solid',
    ...over,
  };
}

function raw(rawResponse: string): FrontendBuilderReviewRawArtifact {
  return {
    version: 'frontend-review-raw-v1',
    stage: 'initial',
    status: 'completed',
    mode: 'frontend_builder',
    rawResponse,
    responseCharCount: rawResponse.length,
    reason: '',
    model: 'm', provider: 'p', requestId: 'r',
  } as FrontendBuilderReviewRawArtifact;
}

const files: WebBuildFile[] = [
  { path: 'src/App.tsx', language: 'tsx', content: 'export default function App(){return null;}' } as WebBuildFile,
  { path: 'src/styles.css', language: 'css', content: '@tailwind base;' } as WebBuildFile,
];

const parse = (body: string) => parseFrontendBuilderReview(raw(body), 'initial', files);

describe('extractReviewJsonObject — fence / prose / truncation', () => {
  it('returns a pure object unchanged', () => {
    expect(extractReviewJsonObject('{"a":1}')).toBe('{"a":1}');
  });
  it('strips a ```json fence', () => {
    expect(extractReviewJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it('strips a bare ``` fence', () => {
    expect(extractReviewJsonObject('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it('extracts the first balanced object from surrounding prose', () => {
    expect(extractReviewJsonObject('Here is the review:\n{"a":{"b":2}}\nThanks!')).toBe('{"a":{"b":2}}');
  });
  it('is not fooled by braces inside string literals', () => {
    expect(extractReviewJsonObject('{"note":"} not the end {","x":1}')).toBe('{"note":"} not the end {","x":1}');
  });
  it('returns null for a truncated (unbalanced) body — no partial salvage', () => {
    expect(extractReviewJsonObject('{"a":1,"b":{"c":2')).toBeNull();
  });
  it('returns null when there is no object at all', () => {
    expect(extractReviewJsonObject('no json here')).toBeNull();
  });
});

describe('parseFrontendBuilderReview — recovers fenced / prose-wrapped reviews', () => {
  it('a bare JSON review completes (baseline)', () => {
    const r = parse(JSON.stringify(reviewObject()));
    expect(r.status).toBe('completed');
    expect(r.passed).toBe(true);
    expect(r.score).toBe(88);
  });

  it('a ```json-fenced review now COMPLETES (was a false "incomplete")', () => {
    const r = parse('```json\n' + JSON.stringify(reviewObject()) + '\n```');
    expect(r.status).toBe('completed');
    expect(r.passed).toBe(true);
  });

  it('a review with a line of prose before/after now COMPLETES', () => {
    const r = parse('Sure, here is the review.\n' + JSON.stringify(reviewObject()) + '\nLet me know!');
    expect(r.status).toBe('completed');
  });

  it('a genuinely truncated review still FAILS (no quality inferred from a partial body)', () => {
    const full = JSON.stringify(reviewObject({ verdict: 'repair', score: 60 }));
    const truncated = full.slice(0, Math.floor(full.length * 0.7)); // cut mid-object
    const r = parse(truncated);
    expect(r.status).toBe('failed');
    expect(r.reason).toMatch(/complete JSON object|not valid JSON/);
  });
});

describe('parseFrontendBuilderReview — strict schema still enforced after extraction', () => {
  it('a fenced body missing a dimension still FAILS (extraction never weakens validation)', () => {
    const badDims = { ...DIMENSIONS } as Record<string, unknown>;
    delete badDims.typography;
    const r = parse('```json\n' + JSON.stringify(reviewObject({ dimensions: badDims })) + '\n```');
    expect(r.status).toBe('failed');
    expect(r.reason).toMatch(/dimension/i);
  });

  it('a fenced body with an out-of-range score still FAILS', () => {
    const r = parse('```json\n' + JSON.stringify(reviewObject({ score: 250 })) + '\n```');
    expect(r.status).toBe('failed');
    expect(r.reason).toMatch(/score/i);
  });

  it('a fenced body with a bad verdict still FAILS', () => {
    const r = parse('```json\n' + JSON.stringify(reviewObject({ verdict: 'approve' })) + '\n```');
    expect(r.status).toBe('failed');
    expect(r.reason).toMatch(/verdict/i);
  });

  it('score below the pass threshold does not pass even when fenced', () => {
    const r = parse('```json\n' + JSON.stringify(reviewObject({ verdict: 'pass', score: 70 })) + '\n```');
    expect(r.status).toBe('completed');
    expect(r.passed).toBe(false); // score < 82 → not passed (threshold unchanged)
  });

  it('owner/non-owner: parser has no owner input — identical output for identical input', () => {
    const body = '```json\n' + JSON.stringify(reviewObject()) + '\n```';
    expect(parse(body)).toEqual(parse(body));
  });
});
