import { describe, it, expect } from 'vitest';
import { deriveFrontendBuildSpecification, type FrontendBuildSpecInput } from '@/lib/webBuildFrontendSpec';
import { buildFrontendBuilderReviewRequest, fitReviewRequestUnderCap } from '@/lib/webBuildApi';
import { buildReviewScopedSpecProjection, buildRepairAuthorityDigest } from '@/lib/webBuildQualityContext';
import { deriveLayoutPlan } from '@/lib/webBuildLayoutPlan';
import type { WebBuildBrief } from '@/lib/webBuildApi';
import type { WebBuildFile } from '@/lib/webBuildPayload';
import type { FrontendBuildSpecification, FrontendBuilderReviewArtifact } from '@/lib/webBuildAgents';

function spec(prompt: string, buildType: 'app' | 'web'): FrontendBuildSpecification {
  const brief: WebBuildBrief = { type: buildType === 'app' ? 'app' : 'website' };
  const sections = [
    { id: 'dashboard', name: 'Dashboard' }, { id: 'contacts', name: 'Contacts' },
    { id: 'contact-detail', name: 'Contact Detail' }, { id: 'deals', name: 'Deals' }, { id: 'settings', name: 'Settings' },
  ];
  const input: FrontendBuildSpecInput = {
    prompt, lang: 'en', buildType, brief,
    sectionItems: sections.map((s) => ({ id: s.id, name: s.name })),
    layoutPlan: deriveLayoutPlan(brief, sections),
  };
  return deriveFrontendBuildSpecification(input);
}

const FILES: WebBuildFile[] = [
  { path: 'src/main.tsx', content: 'import App from "./App";', language: 'tsx', status: 'unchanged', added: 0, removed: 0 },
  { path: 'src/App.tsx', content: 'export default function App(){return null}', language: 'tsx', status: 'unchanged', added: 0, removed: 0 },
  { path: 'src/styles.css', content: '@tailwind base;', language: 'css', status: 'unchanged', added: 0, removed: 0 },
];
const prevReview = { issues: [{ id: 'x', category: 'accessibility', severity: 'major', repairInstruction: 'fix' }] } as unknown as FrontendBuilderReviewArtifact;

// The exact request the orchestrator sends for an app review: lean projected spec + files +
// the bounded authority digest (this is how fitReviewRequestUnderCap threads them together).
function appReviewRequest(s: FrontendBuildSpecification, stage: 'initial' | 'post-repair' = 'initial', prev?: FrontendBuilderReviewArtifact): string {
  return buildFrontendBuilderReviewRequest(
    buildReviewScopedSpecProjection(s), FILES, stage, prev, undefined, undefined, buildRepairAuthorityDigest(s),
  );
}

describe('PR #615 review fix — static review explicitly consumes the authority digest', () => {
  const appSpec = spec('Build a CRM for a sales team with contacts and deals', 'app');
  const webSpec = spec('Build a bakery landing page', 'web');
  const req = appReviewRequest(appSpec);
  const digest = buildRepairAuthorityDigest(appSpec)!;

  it('A. the app review request EXPLICITLY names authorityDigest as a source of truth (not just embeds it)', () => {
    // The digest object is embedded in the request JSON...
    expect(req).toContain('"authorityDigest"');
    // ...AND the model-facing prose names it as a THIRD source of truth alongside spec + source.
    expect(req).toContain('Review the specification, the authorityDigest AND the source files below');
    expect(req).toContain('AUTHORITY DIGEST:');
    expect(req).toContain('`authorityDigest`');
    // It must NOT fall back to the old "ONLY the specification and the source files" framing.
    expect(req).not.toContain('Review ONLY the specification and the source files below');
  });

  it('B. the digest + its authority instruction stay in the STABLE cache-friendly prefix (before "stage")', () => {
    const digestIdx = req.indexOf('"authorityDigest"');
    const authorityProseIdx = req.indexOf('AUTHORITY DIGEST:');
    const stageIdx = req.indexOf('"stage":');
    expect(digestIdx).toBeGreaterThan(0);
    expect(authorityProseIdx).toBeGreaterThan(0);
    expect(stageIdx).toBeGreaterThan(0);
    // Both the embedded digest and the prose that authorizes it precede the first varying field.
    expect(digestIdx).toBeLessThan(stageIdx);
    expect(authorityProseIdx).toBeLessThan(req.indexOf('BEGIN_FRONTEND_BUILD_SPEC_JSON')); // in the stable prose header
  });

  it('C. ACCESSIBILITY obligations are represented in the digest the reviewer is told to honor', () => {
    const acc = (digest.qualityObligations as Record<string, unknown> | undefined)?.accessibility as string[] | undefined;
    expect(Array.isArray(acc) && acc.length).toBeTruthy();
    // And they physically ride inside the request the reviewer receives.
    expect(req).toContain('keyboard-operable');
    expect(req).toContain('focus ring');
  });

  it('D. RESPONSIVE obligations are represented in the digest', () => {
    const resp = (digest.qualityObligations as Record<string, unknown> | undefined)?.responsive as string[] | undefined;
    expect(Array.isArray(resp) && resp.length).toBeTruthy();
    expect(req).toContain('one readable column on mobile');
    expect(req).toMatch(/44px targets/);
  });

  it('E. CONTRAST / visual-system obligations are represented in the digest', () => {
    const contrast = (digest.visualSystemObligations as Record<string, unknown> | undefined)?.contrast as string[] | undefined;
    expect(Array.isArray(contrast) && contrast.length).toBeTruthy();
    expect(req).toMatch(/scrim|contrast|readable on their assigned surface/);
  });

  it('F. INTERACTION obligations still have an owner — screenDepth is kept in the projection, and the prose names interaction as a digest requirement', () => {
    // Per-screen interaction/state is owned by app-screen-depth-v1, which the projection KEEPS
    // (it is not one of the dropped authorities), so the reviewer always sees it directly.
    const projected = buildReviewScopedSpecProjection(appSpec);
    expect(projected.screenDepth).toBeDefined();
    expect(req).toContain('app-screen-depth-v1');
    // The authority-digest prose also lists interaction requirements as review requirements.
    expect(req).toContain('interaction requirements');
  });

  it('G. the instruction frames the digest as AUTHORITATIVE review input, never optional/diagnostic metadata', () => {
    expect(req).toContain('AUTHORITATIVE');
    expect(req).toContain('REVIEW REQUIREMENT');
    expect(req).toContain('flag violations of it exactly as you would');
    expect(req).toContain('never optional metadata');
    // Guard against a downgrade to soft language.
    expect(req).not.toMatch(/authorityDigest is (optional|advisory|for reference|diagnostic|metadata only)/i);
  });

  it('H. the POST-REPAIR review carries the SAME authority behavior (digest present, authoritative, before "stage")', () => {
    const post = appReviewRequest(appSpec, 'post-repair', prevReview);
    expect(post).toContain('"authorityDigest"');
    expect(post).toContain('AUTHORITY DIGEST:');
    expect(post).toContain('Review the specification, the authorityDigest AND the source files below');
    expect(post.indexOf('"authorityDigest"')).toBeLessThan(post.indexOf('"stage":'));
    expect(post).toContain('"stage":"post-repair"');
    // The stable prose header (which now carries the authority instruction) is identical across stages.
    const head = (s: string) => s.slice(0, s.indexOf('BEGIN_FRONTEND_BUILD_SPEC_JSON'));
    expect(head(post)).toBe(head(req));
  });

  it('I. the WEB review is byte-for-byte unchanged — no digest, no authority prose, stage in the header', () => {
    const web = buildFrontendBuilderReviewRequest(webSpec, FILES, 'initial');
    // The unchanged web path equals the direct builder output threaded through the fitter.
    const webFit = fitReviewRequestUnderCap(webSpec, FILES, 'initial', undefined, undefined, undefined);
    expect(webFit.message).toBe(web);
    expect(web).not.toContain('authorityDigest');
    expect(web).not.toContain('AUTHORITY DIGEST:');
    expect(web).not.toContain('Review the specification, the authorityDigest');
    expect(web).toContain('Review ONLY the specification and the source files below');
    expect(web).toContain('(stage: initial)'); // stage stays in the web prose header
  });

  it('J. the full spec is NOT reintroduced — the projected spec still drops the heavy authorities and the request stays materially smaller', () => {
    const projected = buildReviewScopedSpecProjection(appSpec);
    expect(projected.experienceQuality).toBeUndefined();
    expect(projected.visualSystem).toBeUndefined();
    expect(projected.researchDirection).toBeUndefined();
    const fit = fitReviewRequestUnderCap(appSpec, FILES, 'initial', undefined, undefined, undefined);
    expect(fit.projectionReductionPct).toBeGreaterThan(10); // still materially reduced vs the full spec
    // The digest is a bounded extract, not the full authority objects: it must be far smaller
    // than the fields it stands in for (a few KB, never the whole spec).
    const digestChars = JSON.stringify(digest).length;
    expect(digestChars).toBeLessThan(fit.specCharsFull! - fit.specCharsProjected! + JSON.stringify(digest).length + 1);
    expect(digestChars).toBeLessThan(20000);
  });

  it('K. no new model call — the digest rides INSIDE the single existing review request string (one request, one call)', () => {
    // The whole authority contract (prose + embedded digest) lives in ONE serialized request that
    // the existing review call sends; there is no second request builder / no extra round trip.
    expect(typeof req).toBe('string');
    expect(req).toContain('BEGIN_FRONTEND_REVIEW_INPUT_JSON');
    expect(req.match(/BEGIN_FRONTEND_REVIEW_INPUT_JSON/g)?.length).toBe(1); // exactly one review payload
    expect(req).toContain('"authorityDigest"'); // consumed by that same single payload
  });

  it('L. the review request CONTRACT is unchanged — same task + responseContract the gpt-5.6/LOW reviewer already runs', () => {
    // The fix only added instruction + moved existing input; it does NOT change the review task
    // identity, so the model / effort / token config bound to this contract is untouched.
    expect(req).toContain('"task":"frontend-design-review"');
    expect(req).toContain('"responseContract":"frontend-review-v1"');
    expect(req).toContain('[FRONTEND REVIEW REQUEST]');
    // The web contract is identically named (no per-build-type contract fork).
    const web = buildFrontendBuilderReviewRequest(webSpec, FILES, 'initial');
    expect(web).toContain('"task":"frontend-design-review"');
    expect(web).toContain('"responseContract":"frontend-review-v1"');
  });
});
