/**
 * App Build diagnostics (Phase 6) — truthful, numeric, PII/source-free observability
 * for an app build. Pure and deterministic: it reports only counts and the known
 * production model configuration, never raw prompts or generated source.
 *
 * The model/reasoning/output values are the backend's initial-generation config for
 * the shared `frontend_builder` mode (mode_manager.py MODEL_FRONTEND='gpt-5.6';
 * ai_client.py reasoning 'low' + FRONTEND_INITIAL_GENERATION_MAX_OUTPUT_TOKENS=24000).
 * App Build reuses that exact path via the [FRONTEND BUILDER REQUEST] header, so these
 * are the real values — reported here, not re-configured.
 */
import type { FrontendBuildSpecification } from '@/lib/webBuildAgents';
import { resolveBuildType, type BuildType } from '@/lib/buildType';

/** The production initial-generation config the app path inherits (documented, not set here). */
export const APP_INITIAL_MODEL = 'gpt-5.6';
export const APP_INITIAL_REASONING_EFFORT = 'low';
export const APP_INITIAL_MAX_OUTPUT_TOKENS = 24_000;

export interface AppBuildDiagnostics {
  buildType: BuildType;
  appType?: string;
  screenCount: number;
  routeCount: number;
  globalScreenCount: number;
  initialRequestChars: number;
  requiredScreenFiles: number;
  model: string;
  reasoningEffort: string;
  maxOutputTokens: number;
  validationErrors: number;
  validationWarnings: number;
  repairAttempted: boolean;
  previewSource: string;
}

export interface AppDiagnosticsInput {
  spec: FrontendBuildSpecification;
  /** Character length of the built generation request (buildFrontendBuilderRequest). */
  initialRequestChars: number;
  validationErrors?: number;
  validationWarnings?: number;
  repairAttempted?: boolean;
  /** How the preview is sourced — for an app this is the real generated project. */
  previewSource?: string;
}

/**
 * Compute the truthful diagnostics for an app build. Never includes prompt text or
 * source. Safe to log.
 */
export function computeAppBuildDiagnostics(input: AppDiagnosticsInput): AppBuildDiagnostics {
  const spec = input.spec;
  const arch = spec.appArchitecture;
  const screens = arch?.screens || [];
  const requiredScreenFiles = (spec.outputContract?.requiredFiles || []).filter((f) => f.startsWith('src/screens/')).length;
  return {
    buildType: resolveBuildType(spec.buildType),
    appType: arch?.appType,
    screenCount: screens.length,
    routeCount: spec.navigation?.routes?.length || 0,
    globalScreenCount: arch?.globalScreenIds?.length || 0,
    initialRequestChars: Math.max(0, Math.trunc(input.initialRequestChars) || 0),
    requiredScreenFiles,
    model: APP_INITIAL_MODEL,
    reasoningEffort: APP_INITIAL_REASONING_EFFORT,
    maxOutputTokens: APP_INITIAL_MAX_OUTPUT_TOKENS,
    validationErrors: Math.max(0, input.validationErrors ?? 0),
    validationWarnings: Math.max(0, input.validationWarnings ?? 0),
    repairAttempted: !!input.repairAttempted,
    previewSource: input.previewSource || 'model-native-generated-project',
  };
}
