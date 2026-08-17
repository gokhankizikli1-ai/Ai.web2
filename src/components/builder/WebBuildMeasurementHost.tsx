import { useEffect, useRef, useState, useCallback } from 'react';
import WebBuildModelNativePreview from '@/components/builder/WebBuildModelNativePreview';
import type { WebBuildFile } from '@/lib/webBuildPayload';
import { usePreviewMeasurementBridge } from '@/hooks/usePreviewMeasurementBridge';
import {
  buildRenderedVisualInput, deriveMeasureExpectations, toCapturedScreenshot,
  SCREENSHOT_CAPTURE, SCREENSHOT_FORMAT, SCREENSHOT_QUALITY, SCREENSHOT_MAX_BYTES,
  APP_MEASURE_VIEWPORTS,
} from '@/lib/webBuildPreviewMeasurement';
import {
  registerMeasurementHost, shouldRunPreviewMeasurement,
  type MeasurementHost, type MeasurementJob,
} from '@/lib/webBuildMeasurementService';
import type { RenderedVisualInput, RenderedVisualViewport } from '@/lib/webBuildAgents';
import type { VeMeasurement, VeScreenshotResult } from '@/lib/visualEditProtocol';

/**
 * WebBuildMeasurementHost (PR #518) — the SINGLE, app-level, hidden host that renders the
 * generated project in an ISOLATED off-screen Sandpack preview and collects desktop + mobile
 * layout measurements for the quality pipeline. It is mounted once at the app shell
 * (`AppLayout`), so it OUTLIVES the WebsiteBuilder page: a background build whose page has
 * unmounted (user navigated away) is still measured here.
 *
 * It reuses the EXISTING preview component (WebBuildModelNativePreview with `visualEdit`, which
 * injects the measure-capable `korvix.visual-edit.v1` runtime) and the EXISTING bridge — no new
 * evaluator, repair, bridge, planning system or persistence. Generated files live only in
 * memory here; nothing is saved.
 *
 * Safety: renders NOTHING unless both flags are on AND a job is active. The off-screen
 * container is fixed OUTSIDE the viewport with `pointer-events:none` and `aria-hidden` — it is
 * rendered (so layout/measurement is real) but never visible or interactive, and never uses
 * `display:none`/`visibility:hidden` (which would zero out Sandpack layout). Every path is
 * bounded, AbortSignal-aware, cleaned up, and FAIL-OPEN (resolves `undefined` so the build
 * continues unchanged).
 */

// Hard overall ceiling per job — also covers "never READY" (bridge cold-bundle can take up to
// ~30s), so a flag-on build never blocks: if READY/measurement doesn't complete in time, the
// job fails open to `undefined`.
const HOST_TIMEOUT_MS = 45_000;
const STABILIZE_FRAMES = 3;

const DESKTOP = { viewport: 'desktop' as const, width: 1440, height: 900 };
const MOBILE = { viewport: 'mobile' as const, width: 390, height: 844 };

/** The website measurement sequence — unchanged (desktop → mobile). */
const WEB_SEQUENCE: ReadonlyArray<{ viewport: RenderedVisualViewport; width: number; height: number }> = [DESKTOP, MOBILE];

function raf(): Promise<void> { return new Promise((r) => requestAnimationFrame(() => r())); }
async function stabilize(frames = STABILIZE_FRAMES): Promise<void> { for (let i = 0; i < frames; i++) await raf(); }

export default function WebBuildMeasurementHost() {
  const enabled = shouldRunPreviewMeasurement();
  const [job, setJob] = useState<MeasurementJob | null>(null);
  const [dims, setDims] = useState<{ width: number; height: number }>({ width: DESKTOP.width, height: DESKTOP.height });
  const resolverRef = useRef<((v: RenderedVisualInput | undefined) => void) | null>(null);
  const startedRef = useRef<string | null>(null);   // runId whose measurement already started
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { measure: bridgeMeasure, captureScreenshot: bridgeCapture, ready: bridgeReady } = usePreviewMeasurementBridge({
    active: !!job, containerRef, resetKey: job?.runId ?? 'none',
  });

  const settle = useCallback((result: RenderedVisualInput | undefined) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    startedRef.current = null;
    setJob(null);
    setDims({ width: DESKTOP.width, height: DESKTOP.height });
    resolve?.(result);
  }, []);

  // Register the imperative host with the module-level service (only while enabled).
  useEffect(() => {
    if (!enabled) return;
    const api: MeasurementHost = {
      measure: (j) => new Promise<RenderedVisualInput | undefined>((resolve) => {
        // Supersede any in-flight job (newest build wins).
        if (resolverRef.current) { const prev = resolverRef.current; resolverRef.current = null; prev(undefined); }
        startedRef.current = null;
        resolverRef.current = resolve;
        setDims({ width: DESKTOP.width, height: DESKTOP.height });
        setJob(j);
      }),
    };
    const unregister = registerMeasurementHost(api);
    return () => { unregister(); if (resolverRef.current) { const r = resolverRef.current; resolverRef.current = null; r(undefined); } };
  }, [enabled]);

  // Driver: once a job is active AND the bridge has bound (READY), run the sequential
  // desktop→mobile measurement exactly once. Bounded + abortable + fail-open.
  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    const signal = job.signal;

    const finish = (result?: RenderedVisualInput) => { if (cancelled) return; cancelled = true; settle(result); };
    if (signal?.aborted) { finish(undefined); return; }
    const onAbort = () => finish(undefined);
    signal?.addEventListener('abort', onAbort, { once: true });

    // Hard overall ceiling (also covers "never READY"): a flag-on build never blocks.
    const overall = window.setTimeout(() => finish(undefined), HOST_TIMEOUT_MS);

    // Only start the measurement sequence once the bridge is bound for THIS job.
    if (bridgeReady && startedRef.current !== job.runId) {
      startedRef.current = job.runId;
      // App Build Quality V2 — an APP is measured at the five layout regimes an application
      // genuinely breaks at (1440 / 1024 / 768 / 430 / 390) instead of the website pair, and its
      // measurement asks for the app-surface facts. A website build takes the unchanged
      // desktop → mobile sequence with the unchanged expectations.
      const isApp = job.spec?.buildType === 'app';
      const expectations = deriveMeasureExpectations(job.spec?.experienceArchitecture, isApp);
      const sequence = isApp ? APP_MEASURE_VIEWPORTS : WEB_SEQUENCE;
      (async () => {
        try {
          const results: Array<VeMeasurement | null> = [];
          let shot: VeScreenshotResult | null = null;
          for (let i = 0; i < sequence.length; i += 1) {
            const v = sequence[i];
            // The first entry is already the mounted size; every later one resizes the SAME
            // preview (sequential — one Sandpack, less memory/CPU) and lets it reflow.
            if (i > 0) setDims({ width: v.width, height: v.height });
            await stabilize();
            if (cancelled) return;
            const m = await bridgeMeasure({ ...v, runId: job.runId, ...expectations }, signal);
            if (cancelled) return;
            results.push(m);
            // PR #521 — ONE desktop screenshot while STILL at desktop dims, only when the
            // pipeline requested it (conditional vision-review trigger). Fail-open: a
            // null/blocked capture simply leaves the measurement result without pixels.
            if (i === 0 && job.captureScreenshot && bridgeCapture) {
              shot = await bridgeCapture({
                runId: job.runId, width: SCREENSHOT_CAPTURE.width, height: SCREENSHOT_CAPTURE.height,
                format: SCREENSHOT_FORMAT, quality: SCREENSHOT_QUALITY, maxBytes: SCREENSHOT_MAX_BYTES,
              }, signal);
              if (cancelled) return;
            }
          }
          // App Build Quality V2 — the NAVIGATION PROBE genuinely operates controls, so it runs
          // strictly LAST, back at desktop dims, as its own request. Every viewport measurement
          // above is already collected, so if a control performs a hard navigation (destroying
          // the runtime) only the probe is lost — never the measurements. Its nav facts are
          // merged onto the desktop measurement, which is the entry the evaluator reads.
          if (isApp && !cancelled) {
            setDims({ width: DESKTOP.width, height: DESKTOP.height });
            await stabilize();
            if (cancelled) return;
            const probe = await bridgeMeasure(
              { ...DESKTOP, runId: job.runId, ...expectations, probeNav: true }, signal,
            );
            if (cancelled) return;
            if (probe && results[0]) {
              results[0] = {
                ...results[0],
                ...(typeof probe.navProbedCount === 'number' ? { navProbedCount: probe.navProbedCount } : {}),
                ...(typeof probe.navWorkingCount === 'number' ? { navWorkingCount: probe.navWorkingCount } : {}),
              };
            }
          }
          const input = buildRenderedVisualInput(results, job.runId);
          const captured = toCapturedScreenshot(shot, job.runId);
          if (input && captured) input.capturedScreenshot = captured;
          finish(input);
        } catch {
          finish(undefined);
        }
      })();
    }

    return () => { cancelled = true; window.clearTimeout(overall); signal?.removeEventListener('abort', onAbort); };
  }, [job, bridgeReady, bridgeMeasure, settle]);

  if (!enabled || !job) return null;

  // Map the pipeline's FrontendGeneratedFile[] → the preview's WebBuildFile[] (path/language/
  // content only) — never persisted, never exported.
  const files: WebBuildFile[] = job.files.map((f) => ({ path: f.path, language: f.language, content: f.content })) as WebBuildFile[];

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      data-korvix-measurement-host="true"
      style={{
        position: 'fixed',
        top: 0,
        // Off-screen to the LEFT — rendered (real layout) but never visible or interactive.
        left: `-${dims.width + 200}px`,
        width: `${dims.width}px`,
        height: `${dims.height}px`,
        overflow: 'hidden',
        pointerEvents: 'none',
        opacity: 0,
        zIndex: -1,
      }}
    >
      <WebBuildModelNativePreview files={files} mode="embedded" candidate visualEdit />
    </div>
  );
}
