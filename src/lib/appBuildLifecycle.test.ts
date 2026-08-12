import { describe, it, expect, beforeEach } from 'vitest';
import { saveWebBuildPayloadToProject } from '@/lib/webBuildProject';
import { getProject } from '@/stores/projectStore';
import type { WebBuildFile, WebBuildPayload, WebBuildStep } from '@/lib/webBuildPayload';
import type { BuildType } from '@/lib/buildType';
import { deriveFrontendBuildSpecification, type FrontendBuildSpecInput } from '@/lib/webBuildFrontendSpec';
import { deriveLayoutPlan } from '@/lib/webBuildLayoutPlan';
import { buildFrontendBuilderRequest } from '@/lib/webBuildApi';
import { computeAppBuildDiagnostics, APP_INITIAL_MODEL, APP_INITIAL_MAX_OUTPUT_TOKENS } from '@/lib/appBuildDiagnostics';
import type { WebBuildBrief } from '@/lib/webBuildApi';

/** In-memory localStorage (same approach as webBuildProjectSave.test.ts). */
function installStorage(): void {
  const m = new Map<string, string>();
  const store = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    get length() { return m.size; },
  } as unknown as Storage;
  (globalThis as unknown as { localStorage: Storage }).localStorage = store;
}
const asUser = (id: string) => localStorage.setItem('korvix-auth', JSON.stringify({ state: { user: { id } } }));

const ENTRY = ['src/main.tsx', 'src/App.tsx', 'src/styles.css'];
function entryFiles(): WebBuildFile[] {
  return ENTRY.map((p) => ({ path: p, content: 'x', language: 'tsx', status: 'unchanged' as const, added: 0, removed: 0 }));
}
function step(id: string): WebBuildStep {
  return { id, files: entryFiles() } as unknown as WebBuildStep;
}
function payload(buildType: BuildType | undefined): WebBuildPayload {
  return {
    prompt: 'a CRM for a small sales team', brief: { type: 'CRM' }, sectionItems: [],
    activity: [{ id: 'save', status: 'pending' }], steps: [step('s1')],
    ...(buildType ? { buildType } : {}),
  } as unknown as WebBuildPayload;
}

describe('Phase 6 — persistence provenance', () => {
  beforeEach(() => { installStorage(); asUser('U'); });

  it('C. saving an app build persists buildType=app + App category/name', () => {
    const res = saveWebBuildPayloadToProject(payload('app'));
    expect(res.ok).toBe(true);
    const p = getProject(res.project.id);
    expect(p?.webBuild?.buildType).toBe('app');   // buildType round-trips
    expect(p?.category).toBe('App');
    expect(p?.name.startsWith('App:')).toBe(true);
  });

  it('E. saving a web build stays Website (unaffected)', () => {
    const res = saveWebBuildPayloadToProject(payload('web'));
    expect(res.ok).toBe(true);
    const p = getProject(res.project.id);
    expect(p?.category).toBe('Website');
    expect(p?.name.startsWith('Website:')).toBe(true);
  });

  it('G. a legacy payload with no buildType reopens as a Website (backward compatible)', () => {
    const res = saveWebBuildPayloadToProject(payload(undefined));
    expect(res.ok).toBe(true);
    const p = getProject(res.project.id);
    expect(p?.category).toBe('Website');
    expect(p?.webBuild?.buildType).toBeUndefined();
  });
});

describe('Phase 6 — truthful app diagnostics', () => {
  it('reports counts + the real initial-generation config (no prompt/source)', () => {
    const brief: WebBuildBrief = { type: 'app' };
    const sections = [{ id: 'home', name: 'Home' }, { id: 'detail', name: 'Detail' }];
    const input: FrontendBuildSpecInput = {
      prompt: 'Build a CRM for a sales team with contacts and deals', lang: 'en', buildType: 'app', brief,
      sectionItems: sections.map((s) => ({ id: s.id, name: s.name })),
      layoutPlan: deriveLayoutPlan(brief, sections),
    };
    const spec = deriveFrontendBuildSpecification(input);
    const requestChars = buildFrontendBuilderRequest(spec).length;
    const diag = computeAppBuildDiagnostics({
      spec, initialRequestChars: requestChars, validationErrors: 0, validationWarnings: 1, repairAttempted: false,
    });
    expect(diag.buildType).toBe('app');
    expect(diag.appType).toBe('crm');
    expect(diag.screenCount).toBeGreaterThan(0);
    expect(diag.routeCount).toBeGreaterThan(0);
    expect(diag.requiredScreenFiles).toBeGreaterThan(0);
    expect(diag.initialRequestChars).toBe(requestChars);
    expect(diag.model).toBe(APP_INITIAL_MODEL);
    expect(diag.reasoningEffort).toBe('low');
    expect(diag.maxOutputTokens).toBe(APP_INITIAL_MAX_OUTPUT_TOKENS);
    expect(diag.previewSource).toMatch(/model-native|generated-project/);
    // Diagnostics must not carry raw prompt text or source.
    expect(JSON.stringify(diag)).not.toContain('contacts and deals');
  });
});
