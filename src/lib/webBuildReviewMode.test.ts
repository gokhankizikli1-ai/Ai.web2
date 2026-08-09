import { describe, it, expect } from 'vitest';
import {
  readAiGuardBlock,
  buildFrontendBuilderReviewRequest,
  FRONTEND_BUILDER_MODE,
} from '@/lib/webBuildApi';
import type { FrontendBuildSpecification } from '@/lib/webBuildAgents';
import type { WebBuildFile } from '@/lib/webBuildPayload';

/**
 * Design-quality review mode / ai_guard-block regression suite.
 *
 * Production case: a normal user's INITIAL design review came back with
 * `frontendInitialReviewReason = "Backend routed the review request to an unexpected mode."`
 * Root cause: on a NON-rate-limited ai_guard preflight block the backend returns
 * `mode/intent = "ai_guard_block"` (a policy block, NOT a routing mode). When that block's
 * structured metadata was absent/partial, the frontend's strict `status:'blocked'` reader missed
 * it and the response fell through to the `mode !== 'frontend_builder'` check — mislabeling an
 * honest usage/concurrency block as an "unexpected mode" routing error. These tests pin that a
 * guard block is now classified as a block (never a mode error), while a genuine review response
 * keeps the canonical `frontend_builder` mode.
 */

describe('readAiGuardBlock — a guard block is classified as a block, never an "unexpected mode"', () => {
  it('recognizes a fully-structured founder-beta block (status blocked + code)', () => {
    const r = readAiGuardBlock({
      mode: 'ai_guard_block', intent: 'ai_guard_block',
      metadata: { aiOperation: { status: 'blocked', code: 'daily_limit_reached', operationType: 'web_build_full' } },
    });
    expect(r).not.toBeNull();
    expect(r!.betaCode).toBe('daily_limit_reached');
    expect(r!.operationType).toBe('web_build_full');
  });

  it('recognizes a block by the intent/mode MARKER even when metadata is absent (version skew)', () => {
    // This is the exact production gap: the strict reader misses it, so it was mislabeled.
    const r = readAiGuardBlock({ mode: 'ai_guard_block', intent: 'ai_guard_block' });
    expect(r).not.toBeNull();
    expect(r!.betaCode).toBe('ai_guard_block'); // bounded generic; never invents a specific limit
  });

  it('recognizes a marker block and prefers the real code when partial metadata is present', () => {
    const r = readAiGuardBlock({
      intent: 'ai_guard_block',
      metadata: { aiOperation: { code: 'operation_in_progress' } }, // note: no status field
    });
    expect(r!.betaCode).toBe('operation_in_progress');
  });

  it('a NORMAL successful frontend_builder response is NOT a block (success is unaffected)', () => {
    expect(readAiGuardBlock({ mode: 'frontend_builder', reply: '{"version":"frontend-review-v1"}' })).toBeNull();
  });

  it('an unrelated response is not a block', () => {
    expect(readAiGuardBlock({ mode: 'chat', reply: 'hello' })).toBeNull();
  });
});

describe('the expected review mode is the canonical frontend_builder mode (unchanged)', () => {
  const spec = {
    version: 'frontend-build-spec-v1', status: 'ready', prompt: 'a premium SaaS site',
  } as unknown as FrontendBuildSpecification;
  const files: WebBuildFile[] = [
    { path: 'src/App.tsx', language: 'tsx', content: 'export default function App(){return null;}' } as WebBuildFile,
  ];

  it('the canonical mode constant is frontend_builder', () => {
    expect(FRONTEND_BUILDER_MODE).toBe('frontend_builder');
  });

  it('the INITIAL review request carries the review markers + initial stage (drives backend task kind)', () => {
    const msg = buildFrontendBuilderReviewRequest(spec, files, 'initial');
    expect(msg).toContain('[FRONTEND BUILDER REQUEST]');
    expect(msg).toContain('[FRONTEND REVIEW REQUEST]');
    expect(msg).toContain('stage: initial');
    expect(msg).not.toContain('stage: post-repair');
  });

  it('the FINAL post-repair review request carries the same markers + post-repair stage', () => {
    const msg = buildFrontendBuilderReviewRequest(spec, files, 'post-repair');
    expect(msg).toContain('[FRONTEND BUILDER REQUEST]');
    expect(msg).toContain('[FRONTEND REVIEW REQUEST]');
    expect(msg).toContain('stage: post-repair');
  });

  it('initial and final review requests are the SAME task (both design reviews, same mode path)', () => {
    // Neither carries a generation/repair/revision marker, so both classify as a review on the
    // backend and resolve to the identical frontend_builder mode. No owner/user branch exists here.
    const initial = buildFrontendBuilderReviewRequest(spec, files, 'initial');
    const post = buildFrontendBuilderReviewRequest(spec, files, 'post-repair');
    for (const msg of [initial, post]) {
      expect(msg).not.toContain('[FRONTEND REPAIR REQUEST]');
      expect(msg).not.toContain('[FRONTEND REVISION REQUEST]');
      expect(msg).not.toContain('[FRONTEND CONTRACT REPAIR REQUEST]');
    }
  });
});
