/**
 * Web Build PREVIEW MEASUREMENT PRODUCER (PR #517).
 *
 * Turns real preview/runtime measurements (collected over the existing `korvix.visual-edit.v1`
 * bridge) into the `RenderedVisualInput` the #516 evaluator already consumes. It is the
 * "measurement producer" stage of:
 *
 *   generated project → preview runtime → measurement producer → RenderedVisualInput
 *     → existing evaluateRenderedVisual → existing review-issue merge → existing bounded repair
 *
 * It creates NO second evaluator, NO second repair, NO new planning system. It is
 * deterministic, bounded, cancellable and FAILS OPEN — a preview timeout / inaccessible iframe
 * / stale run yields `undefined`, so the build is never blocked and never altered.
 *
 * HONESTY: it only fills the metadata fields it truly measured. It NEVER sets
 * `screenshotReviewed` — no image pixels are captured here (there is no screenshot dependency),
 * so #516's `screenshotReviewed` stays false. `runtimeCompiled` reflects the observed runtime.
 *
 * Feature flags:
 *   VITE_ENABLE_RENDERED_VISUAL_EVAL  — the #516 consumer (reused).
 *   VITE_ENABLE_PREVIEW_MEASUREMENT   — this producer/capture stage (default off).
 */
import type {
  RenderedVisualInput, RenderedScreenshotMeta, RenderedVisualViewport, ExperienceArchitecturePlan,
} from '@/lib/webBuildAgents';
import type { VeMeasurement } from '@/lib/visualEditProtocol';
import { isRenderedVisualEvaluationEnabled } from '@/lib/webBuildRenderedVisualEvaluation';
export { isRenderedVisualEvaluationEnabled };

export function isPreviewMeasurementEnabled(): boolean {
  try {
    const raw = (import.meta as unknown as { env?: Record<string, unknown> })?.env?.VITE_ENABLE_PREVIEW_MEASUREMENT;
    return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

/** The default viewports measured (desktop + mobile). */
export const DEFAULT_MEASURE_VIEWPORTS: ReadonlyArray<{ viewport: RenderedVisualViewport; width: number; height: number }> = [
  { viewport: 'desktop', width: 1440, height: 900 },
  { viewport: 'mobile', width: 390, height: 844 },
];

const PER_VIEWPORT_TIMEOUT_MS = 6000;

/** The plan-required layout-contract expectations passed to the runtime, so it measures the
 *  right DOM facts (hero/CTA/app-first) rather than the parent inferring them from source. */
export interface PreviewMeasureExpectations {
  expectHero: boolean;
  expectCta: boolean;
  appFirst: boolean;
}

export function deriveMeasureExpectations(plan: ExperienceArchitecturePlan | undefined): PreviewMeasureExpectations {
  if (!plan) return { expectHero: false, expectCta: false, appFirst: false };
  const appFirst = plan.landingRequired === false
    || /interactive-demo|app-first/.test(plan.entryPattern || '')
    || plan.layoutStrategy?.pageStructure === 'application';
  const expectHero = !appFirst && plan.heroContentPriority !== 'none';
  const expectCta = !appFirst && plan.landingRequired !== false;
  return { expectHero, expectCta, appFirst };
}

/** One viewport measurement request the transport fulfils. */
export interface PreviewMeasureRequest {
  viewport: RenderedVisualViewport;
  width: number;
  height: number;
  runId: string;
  expectHero: boolean;
  expectCta: boolean;
  appFirst: boolean;
}

/**
 * The measurement TRANSPORT — injected so the producer core is fully testable. The real
 * implementation drives the isolated measurement preview over the reused visual-edit bridge;
 * tests pass a fake. It MUST be bounded, cancellable and never throw (resolve `null` on
 * timeout / unavailable / stale).
 */
export interface PreviewMeasurementTransport {
  measure(req: PreviewMeasureRequest, signal?: AbortSignal): Promise<VeMeasurement | null>;
}

/** Map a validated runtime measurement → the #516 screenshot-metadata shape. Note: NO `image`
 *  and the producer NEVER sets screenshotReviewed — only measured layout facts are carried. */
function toScreenshotMeta(m: VeMeasurement): RenderedScreenshotMeta {
  const meta: RenderedScreenshotMeta = {
    viewport: m.viewport,
    width: m.width,
    height: m.height,
    contentHeight: m.contentHeight,
    horizontalOverflow: m.horizontalOverflow,
    whitespaceRatio: m.whitespaceRatio,
    blank: m.blank,
    runtimeError: m.runtimeError,
  };
  if (typeof m.firstContentTop === 'number') { /* retained via metrics; not needed downstream */ }
  if (typeof m.heroVisible === 'boolean') meta.heroVisible = m.heroVisible;
  if (typeof m.ctaInFirstViewport === 'boolean') meta.ctaInFirstViewport = m.ctaInFirstViewport;
  if (typeof m.marketingHeroOnAppFirst === 'boolean') meta.marketingHeroOnAppFirst = m.marketingHeroOnAppFirst;
  return meta;
}

/**
 * Build a `RenderedVisualInput` from collected runtime measurements. STALE-RUN SAFE: only
 * measurements whose `runId` matches `expectedRunId` are used (a stale preview from an older
 * build is dropped). Returns `undefined` when nothing valid remains. `runtimeCompiled` is true
 * only when at least one viewport compiled and none reported a runtime error.
 */
export function buildRenderedVisualInput(
  measurements: ReadonlyArray<VeMeasurement | null | undefined>,
  expectedRunId: string,
): RenderedVisualInput | undefined {
  const valid = (measurements || []).filter(
    (m): m is VeMeasurement => !!m && typeof m === 'object' && m.runId === expectedRunId,
  );
  if (valid.length === 0) return undefined;
  // De-dupe by viewport (keep the first per viewport).
  const byViewport = new Map<RenderedVisualViewport, VeMeasurement>();
  for (const m of valid) if (!byViewport.has(m.viewport)) byViewport.set(m.viewport, m);
  const screenshots = [...byViewport.values()].map(toScreenshotMeta);
  const anyCompiled = valid.some((m) => m.runtimeCompiled);
  const anyError = valid.some((m) => m.runtimeError);
  return { screenshots, runtimeCompiled: anyCompiled && !anyError };
}

/**
 * Drive the transport to measure the given viewports, then build the RenderedVisualInput.
 * Bounded (per-viewport timeout is the transport's responsibility; this also honours the abort
 * signal), cancellable and FAIL-OPEN — returns `undefined` on cancellation / no usable
 * measurement / any error. Never throws.
 */
export async function produceRenderedVisualInput(opts: {
  transport: PreviewMeasurementTransport;
  runId: string;
  plan?: ExperienceArchitecturePlan;
  viewports?: ReadonlyArray<{ viewport: RenderedVisualViewport; width: number; height: number }>;
  signal?: AbortSignal;
}): Promise<RenderedVisualInput | undefined> {
  try {
    const { transport, runId, signal } = opts;
    if (!transport || !runId) return undefined;
    if (signal?.aborted) return undefined;
    const expectations = deriveMeasureExpectations(opts.plan);
    const viewports = opts.viewports && opts.viewports.length ? opts.viewports : DEFAULT_MEASURE_VIEWPORTS;

    const results = await Promise.all(viewports.map(async (v) => {
      try {
        return await transport.measure({ ...v, runId, ...expectations }, signal);
      } catch {
        return null;   // fail-open per viewport
      }
    }));
    if (signal?.aborted) return undefined;
    return buildRenderedVisualInput(results, runId);
  } catch {
    return undefined;   // fail-open — never block the build
  }
}

/**
 * Build the `renderedVisualProducer` the quality pipeline accepts, from a bound transport +
 * run identity. The pipeline awaits this (under its own hard budget) before the #516 merge.
 * The returned producer derives the plan from the pipeline-supplied spec and forwards the
 * pipeline's abort signal, so it is bounded, cancellable and fail-open. Pure factory.
 */
export function createRenderedVisualProducer(transport: PreviewMeasurementTransport, runId: string) {
  return async (ctx: { spec?: { experienceArchitecture?: ExperienceArchitecturePlan }; signal?: AbortSignal }): Promise<RenderedVisualInput | undefined> => {
    if (!isRenderedVisualEvaluationEnabled() || !isPreviewMeasurementEnabled()) return undefined;
    return produceRenderedVisualInput({
      transport,
      runId,
      plan: ctx.spec?.experienceArchitecture,
      signal: ctx.signal,
    });
  };
}

export { PER_VIEWPORT_TIMEOUT_MS };
