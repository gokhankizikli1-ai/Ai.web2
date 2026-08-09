import { describe, it, expect, beforeEach } from 'vitest';
import {
  orderFilesForReviewBounding,
  compactContextFromIncludedFiles,
  REVIEW_ALWAYS_INCLUDE_PATHS,
} from '@/lib/webBuildQualityContext';
import { buildFrontendBuilderReviewRequest } from '@/lib/webBuildApi';
import { parseFrontendBuilderReview } from '@/lib/webBuildFrontendReview';
import * as aiGuard from '@/lib/aiGuard';
import type { FrontendBuildSpecification, FrontendBuilderReviewRawArtifact } from '@/lib/webBuildAgents';
import type { WebBuildFile } from '@/lib/webBuildPayload';

/**
 * Phase 14L.2 — the design-quality review must fit under the backend structured-builder safety cap
 * (_STRUCTURED_MAX_LEN = 125_000, backend/services/safety/guard.py). A rich premium project whose
 * FULL source exceeds it was rejected as `safety_length`; the /chat response then carried
 * mode="safety_length", which the client read as "Backend routed the review request to an
 * unexpected mode" → the review was recorded `failed` → the acceptance pipeline fell to
 * `initial-review-incomplete` → Safe Preview ("the automatic design-quality review did not
 * complete"). This hit OWNER and normal users identically (a safety cap, not the ai_guard quota).
 *
 * These tests pin the deterministic size-bounding that keeps the review request under the cap (so a
 * large project is still reviewed), and prove the operation-id propagation is stable across a
 * build's sub-calls (ruling out the continuation/op-id hypothesis for the same symptom).
 */

const spec = {
  version: 'frontend-build-spec-v1', status: 'ready', prompt: 'a premium SaaS marketing site',
  outputContract: { requiredFiles: ['src/main.tsx', 'src/App.tsx', 'src/styles.css'] },
} as unknown as FrontendBuildSpecification;

function file(path: string, chars: number): WebBuildFile {
  return { path, language: path.endsWith('.css') ? 'css' : 'tsx', content: 'x'.repeat(chars) } as WebBuildFile;
}

/** A project whose full source comfortably exceeds the backend 125k structured-builder cap. */
function oversizedProject(): WebBuildFile[] {
  const files: WebBuildFile[] = [
    file('src/main.tsx', 400),
    file('src/App.tsx', 1_200),
    file('src/styles.css', 3_000),
  ];
  // 20 heavy section/component files → well over 125k total.
  for (let i = 0; i < 20; i += 1) files.push(file(`src/sections/Section${i}.tsx`, 9_000));
  return files;
}

describe('orderFilesForReviewBounding — deterministic priority + ascending remainder', () => {
  it('puts entry/required files first, then the rest smallest-first', () => {
    const files = [
      file('src/sections/Big.tsx', 9_000),
      file('src/sections/Small.tsx', 500),
      file('src/App.tsx', 1_200),
      file('src/styles.css', 3_000),
      file('src/main.tsx', 400),
      file('src/sections/Mid.tsx', 2_000),
    ];
    const { prioritized, rest } = orderFilesForReviewBounding(spec, files);
    // Entry files (main/App/styles) are prioritized, in the canonical entry order.
    expect(prioritized.map((f) => f.path)).toEqual(['src/main.tsx', 'src/App.tsx', 'src/styles.css']);
    // The rest are ascending by size.
    expect(rest.map((f) => f.path)).toEqual(['src/sections/Small.tsx', 'src/sections/Mid.tsx', 'src/sections/Big.tsx']);
  });

  it('the always-include entry paths are the three canonical roots', () => {
    expect([...REVIEW_ALWAYS_INCLUDE_PATHS]).toEqual(['src/main.tsx', 'src/App.tsx', 'src/styles.css']);
  });

  it('caller-supplied priority paths (e.g. changed files) are also force-included', () => {
    const files = [file('src/App.tsx', 100), file('src/sections/Changed.tsx', 8_000), file('src/sections/Other.tsx', 100)];
    const { prioritized } = orderFilesForReviewBounding(spec, files, ['src/sections/Changed.tsx']);
    expect(prioritized.map((f) => f.path)).toContain('src/sections/Changed.tsx');
  });
});

describe('compactContextFromIncludedFiles — omitted manifest carries metadata only', () => {
  it('manifests every non-included file with path/language/size and NO source content', () => {
    const all = [file('src/App.tsx', 100), file('src/sections/A.tsx', 2_000), file('src/sections/B.tsx', 3_000)];
    const ctx = compactContextFromIncludedFiles(all, [all[0]]);
    expect(ctx.includedFiles.map((f) => f.path)).toEqual(['src/App.tsx']);
    expect(ctx.omittedManifest.map((m) => m.path).sort()).toEqual(['src/sections/A.tsx', 'src/sections/B.tsx']);
    for (const m of ctx.omittedManifest) {
      expect(typeof m.charCount).toBe('number');
      // The manifest is metadata only — it never carries the omitted file's source.
      expect(JSON.stringify(m)).not.toContain('x'.repeat(100));
    }
  });
});

describe('the design-quality review request fits under the backend 125k structured cap', () => {
  const BACKEND_STRUCTURED_CAP = 125_000; // mirrors backend _STRUCTURED_MAX_LEN

  it('the FULL-source review request for a large project would exceed the backend cap', () => {
    const files = oversizedProject();
    const full = buildFrontendBuilderReviewRequest(spec, files, 'initial');
    expect(full.length).toBeGreaterThan(BACKEND_STRUCTURED_CAP);
  });

  it('a size-bounded review request stays under the cap and always keeps the entry files', () => {
    const files = oversizedProject();
    const { prioritized, rest } = orderFilesForReviewBounding(spec, files);
    // Greedily include prioritized + as many small files as fit under a safe bound.
    const SAFE = 118_000;
    let included = [...prioritized];
    for (const f of rest) {
      const candidate = [...included, f];
      const msg = buildFrontendBuilderReviewRequest(spec, files, 'initial', undefined, undefined, compactContextFromIncludedFiles(files, candidate));
      if (msg.length <= SAFE) included = candidate; else break;
    }
    const bounded = buildFrontendBuilderReviewRequest(spec, files, 'initial', undefined, undefined, compactContextFromIncludedFiles(files, included));
    expect(bounded.length).toBeLessThanOrEqual(BACKEND_STRUCTURED_CAP);
    // Entry files are never dropped.
    for (const p of REVIEW_ALWAYS_INCLUDE_PATHS) expect(bounded).toContain(p);
    // The omitted files are declared in the manifest so the reviewer knows they exist.
    expect(bounded).toContain('omittedFilesManifest');
  });

  it('a small project review request is unchanged (no manifest, full source)', () => {
    const files = [file('src/main.tsx', 200), file('src/App.tsx', 800), file('src/styles.css', 1_000)];
    const msg = buildFrontendBuilderReviewRequest(spec, files, 'initial');
    expect(msg.length).toBeLessThan(118_000);
    expect(msg).not.toContain('omittedFilesManifest');
  });
});

describe('review transport diagnostics survive parsing (self-explanatory SAVED build)', () => {
  const activeFiles = [file('src/App.tsx', 40)];

  it('a failed review carries the request size + size-bounding + continuation role', () => {
    const raw: FrontendBuilderReviewRawArtifact = {
      version: 'frontend-review-raw-v1', stage: 'initial', status: 'failed', mode: 'frontend_builder',
      responseCharCount: 0, reason: 'Backend routed the review request to an unexpected mode.',
      requestCharCount: 130_000, sizeBounded: true, omittedFileCount: 6, continuationRole: 'continuation',
    };
    const parsed = parseFrontendBuilderReview(raw, 'initial', activeFiles);
    expect(parsed.status).toBe('failed');
    expect(parsed.requestCharCount).toBe(130_000);
    expect(parsed.sizeBounded).toBe(true);
    expect(parsed.omittedFileCount).toBe(6);
    expect(parsed.continuationRole).toBe('continuation');
    expect(parsed.continuationAttached).toBe(true);
  });

  it('a start role maps continuationAttached to false (op-key did NOT match)', () => {
    const raw: FrontendBuilderReviewRawArtifact = {
      version: 'frontend-review-raw-v1', stage: 'initial', status: 'failed', mode: 'frontend_builder',
      responseCharCount: 0, reason: 'x', continuationRole: 'start',
    };
    const parsed = parseFrontendBuilderReview(raw, 'initial', activeFiles);
    expect(parsed.continuationRole).toBe('start');
    expect(parsed.continuationAttached).toBe(false);
  });

  it('an old raw artifact without the fields parses cleanly (backward compatible)', () => {
    const raw: FrontendBuilderReviewRawArtifact = {
      version: 'frontend-review-raw-v1', stage: 'initial', status: 'failed', mode: 'frontend_builder',
      responseCharCount: 0, reason: 'transport failed',
    };
    const parsed = parseFrontendBuilderReview(raw, 'initial', activeFiles);
    expect(parsed.requestCharCount).toBeUndefined();
    expect(parsed.sizeBounded).toBeUndefined();
    expect(parsed.continuationRole).toBeUndefined();
  });
});

describe('operation-id propagation — ONE stable key across a build\'s sub-calls', () => {
  beforeEach(() => { aiGuard.clearActiveOperation(); });

  it('planning, generation, initial review, repair and final review all send the SAME key', () => {
    const k1 = aiGuard.beginWebBuildOperation('web_build_full', 'session-A');
    // Each sub-call spreads activeOperationHeaders('web_build_full') — the SAME call the real
    // planning / generation / review / repair transports use.
    const keys = Array.from({ length: 5 }, () => aiGuard.activeOperationHeaders('web_build_full')['X-Korvix-Operation-Id']);
    for (const k of keys) expect(k).toBe(k1);
    expect(new Set(keys).size).toBe(1); // exactly one distinct operation id for the whole build
  });

  it('a fresh intentional build rotates to a NEW key (not reused across builds)', () => {
    const k1 = aiGuard.beginWebBuildOperation('web_build_full', 'session-A');
    aiGuard.clearActiveOperation();
    const k2 = aiGuard.beginWebBuildOperation('web_build_full', 'session-A');
    expect(k2).not.toBe(k1);
  });

  it('with no explicit begin, the lazy header still yields ONE stable key across sub-calls', () => {
    const first = aiGuard.activeOperationHeaders('web_build_full')['X-Korvix-Operation-Id'];
    const second = aiGuard.activeOperationHeaders('web_build_full')['X-Korvix-Operation-Id'];
    expect(first).toBe(second);
    expect(first).toBeTruthy();
  });
});
