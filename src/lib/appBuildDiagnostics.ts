/**
 * App Build — numeric diagnostics (Phase 6).
 *
 * A compact, TRUTHFUL, numbers-only snapshot of an App Build for logs / the build
 * activity panel. It records shape and plumbing — build type, archetype, screen/route
 * counts, shell + nav pattern, the model/reasoning/output-budget the build actually
 * uses, request size, validation counts, whether the single repair ran, and the preview
 * source. It carries NO raw prompt text and no user content — only counts and enum
 * labels — so it is safe to log. Pure, deterministic, bounded, fail-open. Type-only
 * imports (leaf module).
 */
import type { BuildType } from '@/lib/buildType';
import type { FrontendBuildSpecification } from '@/lib/webBuildAgents';

/* The frontend model plumbing an initial App Build inherits from the SHARED frontend
 * builder path (mirrors ai_client.py: MODEL_FRONTEND, initial-generation → LOW reasoning,
 * FRONTEND_INITIAL_GENERATION_MAX_OUTPUT_TOKENS). Recorded here for truthful diagnostics;
 * the backend remains the authority — App Build adds no separate model plumbing. */
export const APP_BUILD_MODEL = 'gpt-5.6';
export const APP_BUILD_INITIAL_REASONING_EFFORT = 'low';
export const APP_BUILD_INITIAL_MAX_OUTPUT_TOKENS = 24_000;

export interface AppBuildValidationCounts {
  screenFilesFound?: number;
  structuralIssues?: number;
  completenessIssues?: number;
  visualDefects?: number;
}

export interface AppBuildDiagnostics {
  version: 'app-build-diagnostics-v1';
  buildType: BuildType;
  archetype?: string;
  shell?: string;
  navPattern?: string;
  screenCount: number;
  topLevelScreenCount: number;
  routeCount: number;
  deepLinkRouteCount: number;
  interactionPatternCount: number;
  /** Size of the initial builder request (chars), when known. */
  initialRequestChars?: number;
  model: string;
  reasoningEffort: string;
  maxOutputTokens: number;
  repairAttempted?: boolean;
  previewSource?: string;
  validation?: AppBuildValidationCounts;
}

export interface AppBuildDiagnosticsInput {
  spec?: Pick<FrontendBuildSpecification, 'buildType' | 'appArchitecture' | 'navigation' | 'screenDepth'>;
  initialRequestChars?: number;
  repairAttempted?: boolean;
  previewSource?: string;
  validation?: AppBuildValidationCounts;
}

/**
 * Compute the numeric App Build diagnostics from the derived spec + run signals. Never
 * throws; a missing/partial spec yields a minimal, honest snapshot. Contains no prompt
 * text — only counts and enum labels.
 */
export function computeAppBuildDiagnostics(input: AppBuildDiagnosticsInput | undefined): AppBuildDiagnostics {
  const spec = input?.spec;
  const buildType: BuildType = spec?.buildType === 'app' ? 'app' : 'web';
  const arch = spec?.appArchitecture;
  const nav = spec?.navigation;
  const depth = spec?.screenDepth;

  const screens = Array.isArray(arch?.screens) ? arch!.screens : [];
  const routes = Array.isArray(nav?.routes) ? nav!.routes : [];

  const base: AppBuildDiagnostics = {
    version: 'app-build-diagnostics-v1',
    buildType,
    archetype: arch?.archetype,
    shell: arch?.shell,
    navPattern: nav?.pattern,
    screenCount: screens.length,
    topLevelScreenCount: screens.filter((s) => s.topLevel).length,
    routeCount: routes.length,
    deepLinkRouteCount: routes.filter((r) => !!r.param).length,
    interactionPatternCount: Array.isArray(depth?.interactionPatterns) ? depth!.interactionPatterns.length : 0,
    model: APP_BUILD_MODEL,
    reasoningEffort: APP_BUILD_INITIAL_REASONING_EFFORT,
    maxOutputTokens: APP_BUILD_INITIAL_MAX_OUTPUT_TOKENS,
  };
  if (typeof input?.initialRequestChars === 'number') base.initialRequestChars = input.initialRequestChars;
  if (typeof input?.repairAttempted === 'boolean') base.repairAttempted = input.repairAttempted;
  if (typeof input?.previewSource === 'string') base.previewSource = input.previewSource;
  if (input?.validation) base.validation = input.validation;
  return base;
}

/** A one-line, human-readable summary of the diagnostics (safe to log; no prompt text). */
export function summarizeAppBuildDiagnostics(d: AppBuildDiagnostics | undefined): string {
  if (!d) return 'App Build diagnostics unavailable.';
  const parts = [
    `buildType=${d.buildType}`,
    d.archetype ? `archetype=${d.archetype}` : undefined,
    `screens=${d.screenCount}`,
    `topLevel=${d.topLevelScreenCount}`,
    `routes=${d.routeCount}`,
    d.deepLinkRouteCount ? `deepLinks=${d.deepLinkRouteCount}` : undefined,
    d.shell ? `shell=${d.shell}` : undefined,
    d.navPattern ? `nav=${d.navPattern}` : undefined,
    `model=${d.model}`,
    `reasoning=${d.reasoningEffort}`,
    `maxOut=${d.maxOutputTokens}`,
    typeof d.repairAttempted === 'boolean' ? `repair=${d.repairAttempted}` : undefined,
    d.previewSource ? `preview=${d.previewSource}` : undefined,
  ].filter(Boolean);
  return parts.join(' · ');
}
