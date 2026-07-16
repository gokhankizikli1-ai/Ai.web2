import { useCallback, useEffect, useRef, useState } from 'react';
import {
  makeCommand, parseVeEvent, sanitizeSelection, sanitizeImageTarget, sanitizeErrorCode,
  type VeCommandType,
} from '@/lib/visualEditProtocol';
import type { VisualSelection, VisualImageTarget } from '@/lib/visualSelection';
import type { StockImageResult } from '@/lib/stockImages';

/**
 * useCandidateVisualEditBridge (Phase 14K.3) — the PARENT side of the
 * `korvix.visual-edit.v1` bridge to the Candidate Preview iframe runtime.
 *
 * It owns: binding to the runtime (adopting its instance id + source window from
 * READY, cross-checked against the current preview iframe), strict inbound
 * validation, readiness + a truthful "unavailable" timeout, and the small set of
 * outbound commands (enable/disable/clear/preview/restore). It NEVER inspects or
 * mutates the iframe DOM — that is the runtime's job. Selection + image payloads
 * are sanitized before they reach the caller.
 *
 * Binding rules (defence in depth):
 *   • adopt instance id + source window only from a READY that came from THIS
 *     preview's iframe window (contentWindow identity check when resolvable);
 *   • every later event must match the bound source window AND instance id;
 *   • the sandbox origin is opaque/cross-origin, so commands post to the bound
 *     origin when it is a real http(s) origin, otherwise to '*' (documented).
 */

export interface CandidateBridgeCallbacks {
  onSelected: (selection: VisualSelection, imageTarget: VisualImageTarget | null) => void;
  onSelectionCleared: () => void;
  onModeChanged?: (enabled: boolean) => void;
  onImageApplied?: (nodeId: string | undefined) => void;
  onImageRestored?: () => void;
  onError?: (code: string) => void;
  /** The iframe reloaded (a NEW runtime instance announced itself) — clear stale
   *  selection context; any in-iframe temporary preview is already gone. */
  onReload?: () => void;
}

export interface CandidateBridgeOptions extends CandidateBridgeCallbacks {
  /** Only listen/bind while the Candidate Preview is the active, mounted preview. */
  active: boolean;
  /** Wrapper around the Sandpack preview — used to locate the preview iframe. */
  containerRef: { readonly current: HTMLElement | null };
  /** Changing this (build / mode / candidate identity) fully resets the bridge. */
  resetKey: string;
}

export interface CandidateBridgeApi {
  bridgeReady: boolean;
  selectionEnabled: boolean;
  /** Honest failure code when the runtime never initialized ('bridge_unavailable'). */
  unavailable: boolean;
  enable: () => void;
  disable: () => void;
  clear: () => void;
  previewImage: (nodeId: string, result: StockImageResult) => void;
  restoreImage: (nodeId?: string) => void;
}

// Aligned with Sandpack's own ~25s cold-bundle soft timeout so a slow first
// install/transpile doesn't flash a premature "unavailable" before READY arrives.
const READY_TIMEOUT_MS = 30000;

function makeRequestId(): string {
  return 'req_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function useCandidateVisualEditBridge(opts: CandidateBridgeOptions): CandidateBridgeApi {
  const { active, containerRef, resetKey } = opts;
  const [bridgeReady, setBridgeReady] = useState(false);
  const [selectionEnabled, setSelectionEnabled] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  const boundWinRef = useRef<Window | null>(null);
  const instanceIdRef = useRef<string | null>(null);
  const originRef = useRef<string>('*');

  // Latest callbacks via refs so the message listener never needs re-subscribing.
  const cbRef = useRef<CandidateBridgeCallbacks>(opts);
  cbRef.current = opts;

  const send = useCallback((type: VeCommandType, payload?: unknown, requestId?: string) => {
    const win = boundWinRef.current;
    const id = instanceIdRef.current;
    if (!win || !id) return;
    try { win.postMessage(makeCommand(type, id, payload, requestId), originRef.current); } catch { /* iframe gone */ }
  }, []);

  // Full reset whenever the target preview changes or the bridge deactivates. Any
  // in-iframe temporary preview dies with the iframe, so there is nothing to undo here.
  useEffect(() => {
    boundWinRef.current = null;
    instanceIdRef.current = null;
    originRef.current = '*';
    setBridgeReady(false);
    setSelectionEnabled(false);
    setUnavailable(false);
  }, [resetKey, active]);

  useEffect(() => {
    if (!active) return;
    const onMessage = (e: MessageEvent) => {
      const env = parseVeEvent(e.data);
      if (!env) return;

      if (env.type === 'READY') {
        // Adopt only from the iframe that belongs to THIS preview. When the
        // contentWindow is resolvable we require identity; otherwise (opaque
        // nesting) we bind on protocol + instance and record origin honestly.
        const iframe = containerRef.current?.querySelector('iframe') as HTMLIFrameElement | null;
        if (!iframe) return;
        if (iframe.contentWindow && e.source && iframe.contentWindow !== e.source) return;
        const isReload = !!instanceIdRef.current && instanceIdRef.current !== env.instanceId;
        boundWinRef.current = (e.source as Window) || iframe.contentWindow;
        instanceIdRef.current = env.instanceId;
        originRef.current = (e.origin && /^https?:\/\//i.test(e.origin)) ? e.origin : '*';
        setUnavailable(false);
        setBridgeReady(true);
        // A fresh runtime instance means the iframe reloaded — the previous
        // selection + temporary preview are gone; clear stale parent context.
        if (isReload) { setSelectionEnabled(false); cbRef.current.onReload?.(); }
        // Ask for current mode so a reconnect reflects true runtime state.
        send('GET_STATE');
        return;
      }

      // Every non-READY event must come from the bound runtime.
      if (!boundWinRef.current || e.source !== boundWinRef.current) return;
      if (env.instanceId !== instanceIdRef.current) return;
      const cb = cbRef.current;
      const p = (env.payload || {}) as Record<string, unknown>;

      switch (env.type) {
        case 'SELECTION_MODE_CHANGED': {
          const en = p.enabled === true;
          setSelectionEnabled(en);
          cb.onModeChanged?.(en);
          break;
        }
        case 'STATE':
          setSelectionEnabled(p.enabled === true);
          break;
        case 'SELECTED': {
          const selection = sanitizeSelection(p.selection);
          if (!selection) return;
          const imageTarget = sanitizeImageTarget(p.imageTarget, selection);
          cb.onSelected(selection, imageTarget);
          break;
        }
        case 'SELECTION_CLEARED':
          cb.onSelectionCleared();
          break;
        case 'IMAGE_PREVIEW_APPLIED':
          cb.onImageApplied?.(typeof p.nodeId === 'string' ? p.nodeId : undefined);
          break;
        case 'IMAGE_RESTORED':
          cb.onImageRestored?.();
          break;
        case 'ERROR':
          cb.onError?.(sanitizeErrorCode(p.code));
          break;
        default:
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [active, containerRef, send]);

  // Honest "unavailable" state if the runtime never announces within the timeout.
  useEffect(() => {
    if (!active) return;
    setUnavailable(false);
    const id = window.setTimeout(() => {
      if (!boundWinRef.current) setUnavailable(true);
    }, READY_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [active, resetKey]);

  const enable = useCallback(() => send('ENABLE_SELECTION'), [send]);
  const disable = useCallback(() => send('DISABLE_SELECTION'), [send]);
  const clear = useCallback(() => send('CLEAR_SELECTION'), [send]);
  const previewImage = useCallback((nodeId: string, result: StockImageResult) => {
    send('PREVIEW_IMAGE', {
      nodeId, provider: result.provider, providerImageId: result.providerImageId, url: result.previewUrl,
    }, makeRequestId());
  }, [send]);
  const restoreImage = useCallback((nodeId?: string) => {
    send('RESTORE_IMAGE', nodeId ? { nodeId } : undefined);
  }, [send]);

  return { bridgeReady, selectionEnabled, unavailable, enable, disable, clear, previewImage, restoreImage };
}
