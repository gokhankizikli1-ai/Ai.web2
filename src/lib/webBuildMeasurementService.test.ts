/**
 * Tests — Measurement Service (PR #518).
 *
 * The service is the module-level, navigation-independent router between the pipeline's
 * `renderedVisualProducer` and the app-level hidden host. These cover the deterministic,
 * host-agnostic guarantees: flag gating, no-host fail-open, delegation, one-job/supersede,
 * stale-run drop, abort, cleanup, and the producer factory. The Sandpack host component itself
 * is browser-only and verified by type/lint (a headless CI cannot run Sandpack).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  registerMeasurementHost, isMeasurementHostRegistered, runMeasurement,
  createMeasurementProducer, shouldRunPreviewMeasurement, __resetMeasurementServiceForTests,
  type MeasurementHost, type MeasurementJob,
} from '@/lib/webBuildMeasurementService';
import type { FrontendGeneratedFile, RenderedVisualInput } from '@/lib/webBuildAgents';

const files: FrontendGeneratedFile[] = [{ path: 'App.tsx', language: 'tsx', content: '<div/>', charCount: 6, lineCount: 1 }];
const INPUT: RenderedVisualInput = { screenshots: [{ viewport: 'desktop', width: 1440, height: 900 }], runtimeCompiled: true };

function hostReturning(value: RenderedVisualInput | undefined, spy?: (j: MeasurementJob) => void): MeasurementHost {
  return { measure: async (job) => { spy?.(job); return value; } };
}

afterEach(() => { __resetMeasurementServiceForTests(); vi.unstubAllEnvs(); });

/* ── Flag gating (1/2/3) ──────────────────────────────────────────────────────*/
describe('flag gating', () => {
  it('both off → shouldRun false; producer undefined', () => {
    expect(shouldRunPreviewMeasurement()).toBe(false);
    expect(createMeasurementProducer('run-1')).toBeUndefined();
  });
  it('only one flag on → shouldRun false; producer undefined', () => {
    vi.stubEnv('VITE_ENABLE_RENDERED_VISUAL_EVAL', 'true'); // preview measurement still off
    expect(shouldRunPreviewMeasurement()).toBe(false);
    expect(createMeasurementProducer('run-1')).toBeUndefined();
  });
  it('both on → shouldRun true; producer defined', () => {
    vi.stubEnv('VITE_ENABLE_RENDERED_VISUAL_EVAL', 'true');
    vi.stubEnv('VITE_ENABLE_PREVIEW_MEASUREMENT', 'true');
    expect(shouldRunPreviewMeasurement()).toBe(true);
    expect(typeof createMeasurementProducer('run-1')).toBe('function');
  });
});

/* ── No host → fail-open (12/13 old behavior) ─────────────────────────────────*/
describe('no host registered', () => {
  it('runMeasurement returns undefined (old behavior)', async () => {
    expect(isMeasurementHostRegistered()).toBe(false);
    expect(await runMeasurement({ runId: 'r', files })).toBeUndefined();
  });
  it('producer with both flags on but no host → undefined (fail-open)', async () => {
    vi.stubEnv('VITE_ENABLE_RENDERED_VISUAL_EVAL', 'true');
    vi.stubEnv('VITE_ENABLE_PREVIEW_MEASUREMENT', 'true');
    const producer = createMeasurementProducer('run-1')!;
    expect(await producer({ files })).toBeUndefined();
  });
});

/* ── Delegation + registration lifecycle (4/5/12) ─────────────────────────────*/
describe('delegation', () => {
  it('registered host receives the job and its result is returned', async () => {
    let seen: MeasurementJob | undefined;
    const unregister = registerMeasurementHost(hostReturning(INPUT, (j) => { seen = j; }));
    expect(isMeasurementHostRegistered()).toBe(true);
    const out = await runMeasurement({ runId: 'r', files });
    expect(out).toEqual(INPUT);
    expect(seen?.runId).toBe('r');
    expect(seen?.files).toBe(files);
    unregister();
    expect(isMeasurementHostRegistered()).toBe(false);
  });
  it('unusable job (no files / no runId) → undefined, host not called', async () => {
    const spy = vi.fn();
    registerMeasurementHost({ measure: async (j) => { spy(j); return INPUT; } });
    expect(await runMeasurement({ runId: 'r', files: [] })).toBeUndefined();
    expect(await runMeasurement({ runId: '', files })).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});

/* ── Abort during measurement (9) ─────────────────────────────────────────────*/
describe('abort', () => {
  it('already-aborted signal → undefined, host not called', async () => {
    const spy = vi.fn();
    registerMeasurementHost({ measure: async (j) => { spy(j); return INPUT; } });
    const ac = new AbortController(); ac.abort();
    expect(await runMeasurement({ runId: 'r', files, signal: ac.signal })).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});

/* ── One job / supersede / stale-run drop (10/11) ─────────────────────────────*/
describe('supersede + stale run', () => {
  it('a newer run supersedes an in-flight one → the older result is dropped', async () => {
    let releaseOld: (v: RenderedVisualInput) => void = () => {};
    const oldHost: MeasurementHost = { measure: () => new Promise((res) => { releaseOld = res; }) };
    registerMeasurementHost(oldHost);
    const oldPromise = runMeasurement({ runId: 'OLD', files });
    // A newer build starts and completes first.
    registerMeasurementHost(hostReturning(INPUT));   // (host swap is fine; latestRunId is what guards)
    await runMeasurement({ runId: 'NEW', files });
    // Now the old measurement resolves late — it must be dropped (stale).
    releaseOld(INPUT);
    expect(await oldPromise).toBeUndefined();
  });
});

/* ── Fail-open on host throw (8/13) ───────────────────────────────────────────*/
describe('host failure', () => {
  it('host that throws → undefined (fail-open), never rejects', async () => {
    registerMeasurementHost({ measure: async () => { throw new Error('mount failed'); } });
    await expect(runMeasurement({ runId: 'r', files })).resolves.toBeUndefined();
  });
  it('host that returns undefined (timeout/blank/no READY) → undefined', async () => {
    registerMeasurementHost(hostReturning(undefined));
    expect(await runMeasurement({ runId: 'r', files })).toBeUndefined();
  });
});

/* ── Producer routes through the service (3/4) ────────────────────────────────*/
describe('producer factory', () => {
  it('produced callback routes files/spec/signal into the host', async () => {
    vi.stubEnv('VITE_ENABLE_RENDERED_VISUAL_EVAL', 'true');
    vi.stubEnv('VITE_ENABLE_PREVIEW_MEASUREMENT', 'true');
    let seen: MeasurementJob | undefined;
    registerMeasurementHost(hostReturning(INPUT, (j) => { seen = j; }));
    const producer = createMeasurementProducer('run-42')!;
    const out = await producer({ files });
    expect(out).toEqual(INPUT);
    expect(seen?.runId).toBe('run-42');
  });
});
