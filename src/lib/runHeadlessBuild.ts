// Phase 1 (headless) — runHeadlessBuild.
//
// The single headless entry the Node build worker calls. It reuses the SAME
// production build spine (generateWebBuild + runFrontendBuilderQualityPipeline)
// — no duplicated prompts, contracts, or validators — by installing an
// injected build runtime (auth token, api base, fetch transport) so the spine
// runs under Node with zero window/localStorage access. Browser globals are
// injected dependencies, not shimmed globals.
//
// The paid model work happens through the injected `transport` (a fetch).
// Tests inject a MOCK transport, so the full headless path is exercised with
// no paid build. The interactive browser path is unaffected (no override).

import {
  setBuildRuntime,
  resetBuildRuntime,
  isHeadless,
} from '@/lib/buildRuntime';
import { generateWebBuild } from '@/lib/webBuildApi';
import { runFrontendBuilderQualityPipeline } from '@/lib/webBuildFrontendQuality';
import type { BuildType } from '@/lib/buildType';

export interface HeadlessBuildContext {
  buildType: BuildType;        // 'web' | 'app'
  idea: string;
  authToken: string | null;
  apiBase: string;
  transport: typeof fetch;     // injected — a mock in tests, real in prod
  userId?: string;
  runQualityPipeline?: boolean; // default true; false = planning only
  signal?: AbortSignal;
}

export interface HeadlessBuildResult {
  status: 'completed' | 'failed';
  build_type: BuildType;
  artifact_ref: string;
  build_ref: string;
  summary: string;
  cost_ref: Record<string, unknown> | null;
  file_manifest: string[];     // paths only — never full source in the ref
  detail?: string;
}

/** Deterministic content-addressed ref for a produced payload (manifest-based;
 *  never embeds source). */
function artifactRef(buildType: BuildType, paths: string[]): string {
  let h = 5381;
  const s = `${buildType}:${paths.slice().sort().join('|')}`;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return `headless:${buildType}:${h.toString(16)}`;
}

export async function runHeadlessBuild(ctx: HeadlessBuildContext): Promise<HeadlessBuildResult> {
  setBuildRuntime({
    getAuthToken: () => ctx.authToken,
    getApiBase: () => ctx.apiBase,
    getFetch: () => ctx.transport,
    getUserId: () => ctx.userId ?? 'headless-worker',
    onVerificationRequired: () => { /* headless: no redirect */ },
  });
  try {
    if (!isHeadless()) {
      return {
        status: 'failed', build_type: ctx.buildType, artifact_ref: '', build_ref: '',
        summary: '', cost_ref: null, file_manifest: [],
        detail: 'headless runtime not installed',
      };
    }
    const mode = ctx.buildType === 'app' ? 'app_builder' : null;
    // Planning round-trip (same spine, injected transport).
    const planned = await generateWebBuild(ctx.idea, {
      signal: ctx.signal, mode: mode as never,
    });

    let payload = (planned as { payload?: unknown }).payload ?? planned;
    // Full quality pipeline (generation → review → single repair → acceptance)
    // — the same production pipeline, reached via transport-injected functions.
    if (ctx.runQualityPipeline !== false) {
      try {
        payload = await runFrontendBuilderQualityPipeline(payload as never, {
          signal: ctx.signal,
        });
      } catch (e) {
        // Pipeline failed after planning — surface truthfully.
        return {
          status: 'failed', build_type: ctx.buildType, artifact_ref: '', build_ref: '',
          summary: 'planning succeeded; quality pipeline failed',
          cost_ref: null, file_manifest: [],
          detail: String((e as Error)?.message || e),
        };
      }
    }

    const files = (payload as { files?: Array<{ path?: string }> })?.files ?? [];
    const manifest = files.map((f) => String(f?.path || '')).filter(Boolean);
    return {
      status: 'completed',
      build_type: ctx.buildType,
      artifact_ref: artifactRef(ctx.buildType, manifest),
      build_ref: '',
      summary: `${ctx.buildType} build produced ${manifest.length} file(s) headlessly`,
      cost_ref: null,
      file_manifest: manifest,
    };
  } catch (e) {
    return {
      status: 'failed', build_type: ctx.buildType, artifact_ref: '', build_ref: '',
      summary: '', cost_ref: null, file_manifest: [],
      detail: String((e as Error)?.message || e),
    };
  } finally {
    resetBuildRuntime();
  }
}
