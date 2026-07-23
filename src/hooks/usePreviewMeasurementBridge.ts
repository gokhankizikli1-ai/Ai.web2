import { useCallback, useEffect, useRef } from 'react';
import { makeCommand, parseVeEvent, sanitizeMeasurement, type VeMeasurement } from '@/lib/visualEditProtocol';
import type { PreviewMeasurementTransport, PreviewMeasureRequest } from '@/lib/webBuildPreviewMeasurement';

/**
 * usePreviewMeasurementBridge (PR #517) — the PARENT side of the read-only MEASURE extension of
 * the existing `korvix.visual-edit.v1` bridge. It REUSES that bridge (no new bridge): it binds
 * to the preview runtime via its READY handshake (instanceId + source-window identity), sends a
 * bounded MEASURE command per viewport, and resolves the sanitized MEASUREMENT — dropping any
 * message from the wrong window/instance or with a mismatched runId (stale run).
 *
 * It NEVER touches the iframe DOM (the runtime measures itself) and never receives source,
 * secrets, tokens or user data — only bounded layout metrics. A missing/slow runtime resolves
 * `null` (fail-open) within the per-request timeout, so a flag-on build never blocks.
 */

const MEASURE_TIMEOUT_MS = 6000;

export interface PreviewMeasurementBridgeOptions {
  /** Only listen/bind while the measurement preview is the active, mounted preview. */
  active: boolean;
  /** Wrapper around the Sandpack preview — used to locate + identity-check the iframe. */
  containerRef: { readonly current: HTMLElement | null };
  /** Changing this (build / run identity) fully resets the binding. */
  resetKey: string;
}

export function usePreviewMeasurementBridge(opts: PreviewMeasurementBridgeOptions): PreviewMeasurementTransport {
  const { active, containerRef, resetKey } = opts;
  const boundWinRef = useRef<Window | null>(null);
  const instanceIdRef = useRef<string | null>(null);
  const originRef = useRef<string>('*');
  // Pending MEASURE requests keyed by `${viewport}:${runId}`.
  const pendingRef = useRef<Map<string, (m: VeMeasurement | null) => void>>(new Map());

  useEffect(() => {
    boundWinRef.current = null;
    instanceIdRef.current = null;
    originRef.current = '*';
    // Resolve any in-flight waiters as unavailable when the target resets.
    pendingRef.current.forEach((res) => res(null));
    pendingRef.current.clear();
  }, [resetKey, active]);

  useEffect(() => {
    if (!active) return;
    const onMessage = (e: MessageEvent) => {
      const env = parseVeEvent(e.data);
      if (!env) return;
      if (env.type === 'READY') {
        const iframe = containerRef.current?.querySelector('iframe') as HTMLIFrameElement | null;
        if (!iframe) return;
        // Bind only to the iframe that belongs to THIS preview (contentWindow identity when
        // resolvable), exactly like the visual-edit bridge.
        if (iframe.contentWindow && e.source && iframe.contentWindow !== e.source) return;
        boundWinRef.current = (e.source as Window) || iframe.contentWindow;
        instanceIdRef.current = env.instanceId;
        originRef.current = (e.origin && /^https?:\/\//i.test(e.origin)) ? e.origin : '*';
        return;
      }
      // Every non-READY event must come from the bound runtime + instance.
      if (!boundWinRef.current || e.source !== boundWinRef.current) return;
      if (env.instanceId !== instanceIdRef.current) return;
      if (env.type !== 'MEASUREMENT') return;
      const m = sanitizeMeasurement(env.payload);
      if (!m) return;
      const key = `${m.viewport}:${m.runId}`;
      const resolve = pendingRef.current.get(key);
      if (resolve) { pendingRef.current.delete(key); resolve(m); }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [active, containerRef]);

  const measure = useCallback((req: PreviewMeasureRequest, signal?: AbortSignal): Promise<VeMeasurement | null> => {
    return new Promise<VeMeasurement | null>((resolve) => {
      const win = boundWinRef.current;
      const id = instanceIdRef.current;
      if (!win || !id) { resolve(null); return; }        // bridge unavailable → fail-open
      const key = `${req.viewport}:${req.runId}`;
      let settled = false;
      const finish = (m: VeMeasurement | null) => {
        if (settled) return; settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        pendingRef.current.delete(key);
        resolve(m);
      };
      const onAbort = () => finish(null);
      const timer = setTimeout(() => finish(null), MEASURE_TIMEOUT_MS);
      if (signal) { if (signal.aborted) { finish(null); return; } signal.addEventListener('abort', onAbort, { once: true }); }
      pendingRef.current.set(key, finish);
      try {
        win.postMessage(makeCommand('MEASURE', id, {
          viewport: req.viewport, runId: req.runId,
          expectHero: req.expectHero, expectCta: req.expectCta, appFirst: req.appFirst,
        }), originRef.current);
      } catch {
        finish(null);   // iframe gone → fail-open
      }
    });
  }, []);

  return { measure };
}

export { MEASURE_TIMEOUT_MS };
