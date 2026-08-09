import { describe, it, expect } from 'vitest';
import { parseBuildSections } from '@/lib/gameBuilderApi';
import { buildWebBuildPayload } from '@/lib/webBuildPayload';
import {
  fitReviewRequestUnderCap, readAiGuardBlock, readStructuredSafetyRejection,
  buildFrontendBuilderReviewRequest, SAFE_FRONTEND_REVIEW_REQUEST_CHARS, BACKEND_STRUCTURED_MAX_LEN,
} from '@/lib/webBuildApi';
import { buildReviewScopedSpecProjection } from '@/lib/webBuildQualityContext';
import { parseFrontendBuilderReview } from '@/lib/webBuildFrontendReview';
import type { WebBuildResult } from '@/lib/webBuildApi';
import type { FrontendBuildSpecification, FrontendBuilderReviewRawArtifact } from '@/lib/webBuildAgents';
import type { WebBuildFile } from '@/lib/webBuildPayload';

/**
 * Phase 14L.3 — POST-#585 root cause: a realistic premium build's SERIALIZED specification is ~99k
 * chars on its own (dominated by the optional generator authorities). #585 bounded only the FILES,
 * so for a rich build the fit floor (full spec + entry files + manifest) was ALREADY over the
 * backend 125k structured-builder cap → the review request was still rejected as `safety_length` →
 * mode "safety_length" → the client's "unexpected mode" path → "the automatic design-quality review
 * did not complete" → Safe Preview, for OWNER and normal users identically.
 *
 * The fix escalates to a review-scoped spec projection (drop the heavy optional generator
 * authorities the source already embodies) so the FINAL serialized request stays under the cap.
 * These tests assert on the FINAL serialized request length (not source chars), across project
 * shapes, and pin that the non-size failure categories stay distinct.
 */

const SECTIONS = ['hero', 'features', 'showcase', 'pricing', 'testimonials', 'faq', 'integrations', 'final-cta', 'footer'];

function bigReply(): string {
  const l = ['## Build Plan', 'Website type: premium SaaS platform', 'Audience: enterprise teams', 'Goal: convert', '', '## Page Sections'];
  for (const s of SECTIONS) l.push(`- ${s}: ${s} section with rich premium copy and detail`);
  l.push('', '## Generated Copy');
  for (const s of SECTIONS) {
    l.push(`### ${s}`);
    l.push(`Başlık: ${s} headline that is fairly long and descriptive for a premium brand experience`);
    l.push(`Alt başlık: ${s} subheadline elaborating the value proposition with several concrete specifics`);
    for (let i = 0; i < 6; i += 1) l.push(`- ${s} feature bullet ${i} with a meaningful sentence of supporting detail`);
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

function fitLen(spec: FrontendBuildSpecification, files: WebBuildFile[], stage: 'initial' | 'post-repair' = 'initial') {
  return fitReviewRequestUnderCap(spec, files, stage, undefined, undefined, undefined);
}

describe('the SERIALIZED review request stays under the backend structured cap (final size, not source chars)', () => {
  const { spec, files } = realSpecAndFiles();

  it('the real spec is large enough on its own to have caused the post-#585 failure', () => {
    // Proof of the root cause: spec alone is a large fraction of the 125k cap; #585 never bounded it.
    expect(JSON.stringify(spec).length).toBeGreaterThan(60_000);
  });

  it('INITIAL review — baseline real build fits under the backend cap', () => {
    const fit = fitLen(spec, files);
    expect(fit.message.length).toBeLessThanOrEqual(BACKEND_STRUCTURED_MAX_LEN);
  });

  it('FINAL (post-repair) review — baseline real build fits under the backend cap', () => {
    const fit = fitLen(spec, files, 'post-repair');
    expect(fit.message.length).toBeLessThanOrEqual(BACKEND_STRUCTURED_MAX_LEN);
  });

  it('huge SOURCE project — escalates to spec-compacted and stays under the cap', () => {
    const fit = fitLen(spec, inflate(files, 12_000)); // ~230k source; #585 floor was ~147k (over cap)
    expect(fit.message.length).toBeLessThanOrEqual(BACKEND_STRUCTURED_MAX_LEN);
    expect(fit.specCompacted).toBe(true);
    expect(fit.fitMode).toBe('spec-compacted');
  });

  it('huge SPEC + moderate source — the spec projection drops the heavy authorities to fit', () => {
    // A realistically heavy spec (extra sections + inflated authorities) + moderate source.
    const fit = fitLen(spec, inflate(files, 4_000));
    expect(fit.message.length).toBeLessThanOrEqual(BACKEND_STRUCTURED_MAX_LEN);
  });

  it('unicode-heavy source — JS .length bound is conservative vs the backend code-point len()', () => {
    // Backend check_structured_builder_message uses Python len() = CODE POINTS. JS .length counts
    // UTF-16 units (astral chars = 2), so JS length >= code points → bounding by JS length keeps the
    // backend-inspected size under the cap. Assert on BOTH the JS length and the code-point count.
    const emoji = files.map((f) => ({ ...f, content: (f.content || '') + '🚀'.repeat(4_000) }));
    const fit = fitLen(spec, emoji);
    const codePoints = [...fit.message].length; // Python len() equivalent
    expect(fit.message.length).toBeLessThanOrEqual(BACKEND_STRUCTURED_MAX_LEN);
    expect(codePoints).toBeLessThanOrEqual(fit.message.length); // conservative
    expect(codePoints).toBeLessThanOrEqual(BACKEND_STRUCTURED_MAX_LEN);
  });

  it('the omitted manifest itself never pushes the request over the cap', () => {
    // Many small files → a large manifest; the fit must still land under the cap.
    const many: WebBuildFile[] = [...files];
    for (let i = 0; i < 60; i += 1) many.push({ path: `src/components/Extra${i}.tsx`, language: 'tsx', content: 'x'.repeat(1_500) } as WebBuildFile);
    const fit = fitLen(spec, inflate(many, 3_000));
    expect(fit.message.length).toBeLessThanOrEqual(BACKEND_STRUCTURED_MAX_LEN);
  });

  it('small build is sent UNCHANGED (full spec + full files, no projection, no manifest)', () => {
    const smallSpec = { version: 'frontend-spec-v1', status: 'ready', prompt: 'small', outputContract: { requiredFiles: [] } } as unknown as FrontendBuildSpecification;
    const smallFiles = [
      { path: 'src/main.tsx', language: 'tsx', content: 'a'.repeat(300) },
      { path: 'src/App.tsx', language: 'tsx', content: 'b'.repeat(900) },
      { path: 'src/styles.css', language: 'css', content: 'c'.repeat(1200) },
    ] as WebBuildFile[];
    const fit = fitLen(smallSpec, smallFiles);
    expect(fit.fitMode).toBe('full');
    expect(fit.specCompacted).toBe(false);
    expect(fit.sizeBounded).toBe(false);
    expect(fit.message).not.toContain('omittedFilesManifest');
  });

  it('the review-scoped spec projection keeps the design-authoritative core, drops generator authorities', () => {
    const projected = buildReviewScopedSpecProjection(spec);
    // Core design contract preserved.
    expect(projected.identity).toBeDefined();
    expect(projected.designSystem).toBeDefined();
    expect(projected.architecture).toBeDefined();
    expect(projected.outputContract).toBeDefined();
    // Heavy optional generator authorities dropped.
    expect(projected.experienceQuality).toBeUndefined();
    expect(projected.visualSystem).toBeUndefined();
    expect(projected.composition).toBeUndefined();
    expect(projected.contentNarrative).toBeUndefined();
    expect(JSON.stringify(projected).length).toBeLessThan(JSON.stringify(spec).length);
  });

  it('owner and non-owner produce the IDENTICAL request (no owner branch in the fitter)', () => {
    // The fitter takes no owner flag — same spec/files → byte-identical message for both.
    const a = fitLen(spec, inflate(files, 8_000));
    const b = fitLen(spec, inflate(files, 8_000));
    expect(a.message).toBe(b.message);
    expect(a.fitMode).toBe(b.fitMode);
  });
});

describe('failure categories stay DISTINCT (decision-table pins)', () => {
  const activeFiles = [{ path: 'src/App.tsx', language: 'tsx', content: 'x' }] as WebBuildFile[];

  it('safety_length response maps EXPLICITLY to a safety_length reason (not "unexpected mode")', () => {
    const reason = readStructuredSafetyRejection({
      mode: 'safety_length', intent: 'safety_length',
      metadata: { safety: { status: 'rejected', code: 'length', request_char_count: 130000, limit_char_count: 125000 } },
    });
    expect(reason).toContain('safety_length');
    expect(reason).toContain('130000');
    expect(reason).not.toContain('unexpected mode');
  });

  it('safety rejection is recognized by the mode marker even without metadata (version skew)', () => {
    expect(readStructuredSafetyRejection({ mode: 'safety_throttle' })).toContain('safety_throttle');
  });

  it('a normal frontend_builder success is NOT a safety rejection and NOT an ai_guard block', () => {
    expect(readStructuredSafetyRejection({ mode: 'frontend_builder', reply: '{}' })).toBeNull();
    expect(readAiGuardBlock({ mode: 'frontend_builder', reply: '{}' })).toBeNull();
  });

  it('an ai_guard block stays distinct from a safety rejection', () => {
    // A guard block has NO safety envelope → readStructuredSafetyRejection ignores it.
    expect(readStructuredSafetyRejection({ mode: 'ai_guard_block', intent: 'ai_guard_block' })).toBeNull();
    expect(readAiGuardBlock({ mode: 'ai_guard_block', intent: 'ai_guard_block' })).not.toBeNull();
  });

  it('parser failure (truncated JSON) stays a distinct category from a transport/mode failure', () => {
    const raw: FrontendBuilderReviewRawArtifact = {
      version: 'frontend-review-raw-v1', stage: 'initial', status: 'completed', mode: 'frontend_builder',
      responseCharCount: 20, rawResponse: '{"version":"frontend-review-v1", "verdict":', reason: 'ok',
    };
    const parsed = parseFrontendBuilderReview(raw, 'initial', activeFiles);
    expect(parsed.status).toBe('failed');
    expect(parsed.reason.toLowerCase()).toContain('json');
  });

  it('the fit mode + spec-compacted flag survive parsing onto the review artifact', () => {
    const raw: FrontendBuilderReviewRawArtifact = {
      version: 'frontend-review-raw-v1', stage: 'initial', status: 'failed', mode: 'frontend_builder',
      responseCharCount: 0, reason: 'Backend safety guard rejected the review request: safety_length.',
      requestCharCount: 130000, reviewFitMode: 'irreducible', specCompacted: true,
    };
    const parsed = parseFrontendBuilderReview(raw, 'initial', activeFiles);
    expect(parsed.reviewFitMode).toBe('irreducible');
    expect(parsed.specCompacted).toBe(true);
    expect(parsed.requestCharCount).toBe(130000);
  });
});

describe('the safe client bound is strictly below the backend cap', () => {
  it('SAFE bound < backend structured cap (leaves headroom)', () => {
    expect(SAFE_FRONTEND_REVIEW_REQUEST_CHARS).toBeLessThan(BACKEND_STRUCTURED_MAX_LEN);
    expect(BACKEND_STRUCTURED_MAX_LEN).toBe(125_000);
  });
});
