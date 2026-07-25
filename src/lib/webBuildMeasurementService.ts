/**
 * Web Build MEASUREMENT SERVICE (PR #518) — the module-level bridge between the run
 * coordinator's `renderedVisualProducer` and the app-level hidden measurement host.
 *
 * WHY a module singleton: the Web Build run coordinator (`webBuildRunStore`) runs the quality
 * pipeline in a module-scope promise that OUTLIVES the WebsiteBuilder page — a user navigating
 * to another route must NOT cancel or disable measurement. So the producer talks to THIS
 * service (module-level, navigation-independent), which delegates to whichever
 * `WebBuildMeasurementHost` is mounted at the app shell. If no host is registered (flags off /
 * not mounted), it returns `undefined` → the pipeline continues unchanged (fail-open).
 *
 * Guarantees encoded here (host-agnostic, unit-testable):
 *   • ONE active job at a time — a newer build supersedes an older measurement (`latestRunId`);
 *   • a stale job can never affect a newer build (result dropped when superseded);
 *   • generated files are held only transiently (passed straight to the host, never persisted);
 *   • bounded + AbortSignal-aware + FAIL-OPEN (any problem → `undefined`, build continues).
 *
 * It creates NO evaluator, NO repair loop, NO bridge, NO persistence — it only routes a
 * measurement request to the host and returns the host's `RenderedVisualInput`.
 */
import type {
  RenderedVisualInput, FrontendGeneratedFile, FrontendBuildSpecification,
} from '@/lib/webBuildAgents';
import { isRenderedVisualEvaluationEnabled, isPreviewMeasurementEnabled } from '@/lib/webBuildPreviewMeasurement';

export interface MeasurementJob {
  /** Stamps every measurement so a stale preview can't affect a newer build. */
  runId: string;
  files: FrontendGeneratedFile[];
  spec?: FrontendBuildSpecification;
  signal?: AbortSignal;
  /** PR #521 — capture ONE desktop screenshot in the same session (conditional vision review). */
  captureScreenshot?: boolean;
}

/** The app-level host's imperative contract: mount an isolated preview, measure, clean up. */
export interface MeasurementHost {
  measure(job: MeasurementJob): Promise<RenderedVisualInput | undefined>;
}

let host: MeasurementHost | null = null;
let latestRunId: string | null = null;

/** Register the (single) app-level host. Returns an unregister fn for the host's cleanup. */
export function registerMeasurementHost(h: MeasurementHost): () => void {
  host = h;
  return () => { if (host === h) host = null; };
}

/** True when a host is mounted and ready to take jobs (diagnostic / test helper). */
export function isMeasurementHostRegistered(): boolean {
  return host !== null;
}

/** Both flags on ⇒ measurement should run. This is the SINGLE gate the wiring consults, so a
 *  half-enabled configuration never mounts host work. */
export function shouldRunPreviewMeasurement(): boolean {
  return isRenderedVisualEvaluationEnabled() && isPreviewMeasurementEnabled();
}

/**
 * Run one measurement job through the mounted host. Returns `undefined` (fail-open) when no
 * host is mounted, the job is unusable, the run was superseded by a newer build, or anything
 * throws — so the quality pipeline continues exactly as before. Never throws.
 */
export async function runMeasurement(job: MeasurementJob): Promise<RenderedVisualInput | undefined> {
  try {
    if (!host) return undefined;                                   // no host → old behavior
    if (!job || !job.runId) return undefined;
    if (!Array.isArray(job.files) || job.files.length === 0) return undefined;
    if (job.signal?.aborted) return undefined;
    latestRunId = job.runId;                                        // newest build wins
    const result = await host.measure(job);
    if (latestRunId !== job.runId) return undefined;               // superseded → stale, drop
    return result;
  } catch {
    return undefined;                                              // fail-open
  } finally {
    if (latestRunId === job?.runId) latestRunId = null;
  }
}

/**
 * Build the `renderedVisualProducer` the quality pipeline accepts. It routes through this
 * service (so it is navigation-independent) and is used ONLY for fresh builds. Returns
 * `undefined` when the flags are not both on, so the pipeline is passed no producer at all.
 */
export function createMeasurementProducer(runId: string):
  ((ctx: { files?: FrontendGeneratedFile[]; spec?: FrontendBuildSpecification; signal?: AbortSignal; captureScreenshot?: boolean }) => Promise<RenderedVisualInput | undefined>) | undefined {
  if (!shouldRunPreviewMeasurement() || !runId) return undefined;
  return (ctx) => runMeasurement({
    runId,
    files: ctx.files || [],
    spec: ctx.spec,
    signal: ctx.signal,
    captureScreenshot: ctx.captureScreenshot === true,
  });
}

/** Test-only reset of module state (never used in production). */
export function __resetMeasurementServiceForTests(): void {
  host = null;
  latestRunId = null;
}
