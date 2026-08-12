/**
 * Tests — Phase 6: App Build numeric diagnostics.
 *
 * Truthful, numbers-only snapshot: build type, archetype, screen/route counts, shell +
 * nav pattern, the inherited model/reasoning/output budget, validation counts, repair
 * flag and preview source. Carries no prompt text. Fail-open on empty input.
 */
import { describe, it, expect } from 'vitest';
import { deriveAppArchitectureContract, deriveNavigationContract } from '@/lib/appBuildArchitecture';
import { deriveScreenDepthContract } from '@/lib/appBuildScreenDepth';
import {
  computeAppBuildDiagnostics, summarizeAppBuildDiagnostics,
  APP_BUILD_MODEL, APP_BUILD_INITIAL_REASONING_EFFORT, APP_BUILD_INITIAL_MAX_OUTPUT_TOKENS,
  type AppBuildDiagnosticsInput,
} from '@/lib/appBuildDiagnostics';

function appSpec(prompt: string): AppBuildDiagnosticsInput['spec'] {
  const appArchitecture = deriveAppArchitectureContract({ prompt });
  const navigation = deriveNavigationContract(appArchitecture);
  const screenDepth = deriveScreenDepthContract(appArchitecture);
  return { buildType: 'app', appArchitecture, navigation, screenDepth };
}

describe('app build diagnostics — truthful numeric snapshot', () => {
  it('reports build type, archetype, screen/route counts and the inherited model plumbing', () => {
    const d = computeAppBuildDiagnostics({ spec: appSpec('Build a CRM for a sales team with contacts and a deal pipeline') });
    expect(d.buildType).toBe('app');
    expect(d.archetype).toBe('crm-workspace');
    expect(d.shell).toBe('sidebar-app');
    expect(d.navPattern).toBe('sidebar');
    expect(d.screenCount).toBeGreaterThanOrEqual(4);
    expect(d.topLevelScreenCount).toBeGreaterThanOrEqual(2);
    expect(d.routeCount).toBe(d.screenCount);
    expect(d.deepLinkRouteCount).toBeGreaterThanOrEqual(1);
    // Inherited SHARED frontend model plumbing (gpt-5.6 / LOW / 24k).
    expect(d.model).toBe(APP_BUILD_MODEL);
    expect(d.reasoningEffort).toBe(APP_BUILD_INITIAL_REASONING_EFFORT);
    expect(d.maxOutputTokens).toBe(APP_BUILD_INITIAL_MAX_OUTPUT_TOKENS);
    expect(d.model).toBe('gpt-5.6');
    expect(d.maxOutputTokens).toBe(24_000);
  });

  it('threads run signals (request size, repair flag, preview source, validation counts)', () => {
    const d = computeAppBuildDiagnostics({
      spec: appSpec('Build a shopping app with a product catalog, cart and checkout'),
      initialRequestChars: 8123,
      repairAttempted: true,
      previewSource: 'model-native-sandbox',
      validation: { screenFilesFound: 6, structuralIssues: 0, completenessIssues: 0, visualDefects: 0 },
    });
    expect(d.initialRequestChars).toBe(8123);
    expect(d.repairAttempted).toBe(true);
    expect(d.previewSource).toBe('model-native-sandbox');
    expect(d.validation?.screenFilesFound).toBe(6);
  });

  it('summary is a compact one-liner with no prompt text', () => {
    const spec = appSpec('Build a CRM for a sales team with contacts and a deal pipeline');
    const s = summarizeAppBuildDiagnostics(computeAppBuildDiagnostics({ spec }));
    expect(s).toMatch(/buildType=app/);
    expect(s).toMatch(/model=gpt-5\.6/);
    expect(s).toMatch(/screens=\d+/);
    expect(s).not.toMatch(/sales team|CRM for/i); // no prompt text leaks
  });

  it('fails open: no spec ⇒ a web, zero-count snapshot (never throws)', () => {
    const d = computeAppBuildDiagnostics(undefined);
    expect(d.buildType).toBe('web');
    expect(d.screenCount).toBe(0);
    expect(d.routeCount).toBe(0);
    expect(summarizeAppBuildDiagnostics(undefined)).toMatch(/unavailable/);
  });

  it('a web spec reports buildType web with no app counts', () => {
    const d = computeAppBuildDiagnostics({ spec: { buildType: 'web' } });
    expect(d.buildType).toBe('web');
    expect(d.screenCount).toBe(0);
  });
});
