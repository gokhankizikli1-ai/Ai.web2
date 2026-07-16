/**
 * Visual Edit bridge protocol — `korvix.visual-edit.v1` (Phase 14K.3).
 *
 * The SINGLE typed contract shared, conceptually, by the parent editor and the
 * visual-edit runtime that is injected into the Candidate Preview's Sandpack
 * iframe. The iframe runtime is a self-contained string (it cannot import this
 * module), so it re-declares the same literals — this module is the parent-side
 * authority + the documented source of truth. Keep the two in sync.
 *
 * Design constraints encoded here:
 *   • A strict namespace + integer version gate every message.
 *   • Only a fixed, small set of command/event types exist — there is NO generic
 *     EXECUTE / EVAL / SET_ATTRIBUTE / MUTATE_NODE / QUERY_SELECTOR message.
 *   • Every event the parent accepts is validated for namespace, version, type,
 *     instance id and payload SHAPE, and (by the caller) `event.source` identity.
 *   • Incoming selection/image payloads are sanitized to a whitelist — the parent
 *     never trusts raw strings, never receives DOM nodes / outerHTML / form values.
 */
import type { VisualSelection, VisualElementType, VisualIdentitySource, VisualImageTarget } from '@/lib/visualSelection';

export const VE_NAMESPACE = 'korvix.visual-edit' as const;
export const VE_VERSION = 1 as const;

/** Parent → iframe runtime. A closed set; no arbitrary/DOM command exists. */
export type VeCommandType =
  | 'PING'
  | 'ENABLE_SELECTION'
  | 'DISABLE_SELECTION'
  | 'CLEAR_SELECTION'
  | 'PREVIEW_IMAGE'
  | 'RESTORE_IMAGE'
  | 'GET_STATE';

/** iframe runtime → parent. */
export type VeEventType =
  | 'READY'
  | 'SELECTION_MODE_CHANGED'
  | 'SELECTED'
  | 'SELECTION_CLEARED'
  | 'IMAGE_PREVIEW_APPLIED'
  | 'IMAGE_RESTORED'
  | 'ERROR'
  | 'PONG'
  | 'STATE';

const EVENT_TYPES: ReadonlySet<string> = new Set<VeEventType>([
  'READY', 'SELECTION_MODE_CHANGED', 'SELECTED', 'SELECTION_CLEARED',
  'IMAGE_PREVIEW_APPLIED', 'IMAGE_RESTORED', 'ERROR', 'PONG', 'STATE',
]);

export interface VeEnvelope<T = unknown> {
  namespace: typeof VE_NAMESPACE;
  version: typeof VE_VERSION;
  type: string;
  /** Identifies the specific mounted preview runtime; stale instances are ignored. */
  instanceId: string;
  requestId?: string;
  payload?: T;
}

/** PREVIEW_IMAGE command payload — a single, already-validated image. `provider`
 *  is a closed enum ('user-upload' is the caller's own authenticated-storage image,
 *  Phase 14K.6); `url` must still be HTTPS. This is NOT a generic URL-mutation
 *  command — the runtime re-validates the enum + https before touching the DOM. */
export interface VePreviewImagePayload {
  nodeId: string;
  provider: 'pexels' | 'unsplash' | 'user-upload';
  providerImageId: string;
  /** The exact HTTPS URL (provider CDN or the user's stored asset). */
  url: string;
}

/** Sanitized image metadata the runtime attaches to a SELECTED image. */
export interface VeSerializedImageTarget {
  imageKind: 'img' | 'background';
  currentUrl: string;
  altText?: string;
  width?: number;
  height?: number;
  aspectRatio?: number;
  objectFit?: string;
  sourceAttribute: 'src' | 'background-image';
  canPreviewReplace: boolean;
  limitationReason?: string;
}

/* ── Parent-side command builder ─────────────────────────────────────────────── */

export function makeCommand<T>(
  type: VeCommandType, instanceId: string, payload?: T, requestId?: string,
): VeEnvelope<T> {
  const env: VeEnvelope<T> = { namespace: VE_NAMESPACE, version: VE_VERSION, type, instanceId };
  if (requestId) env.requestId = requestId;
  if (payload !== undefined) env.payload = payload;
  return env;
}

/* ── Parent-side inbound validation ──────────────────────────────────────────── */

/** Structural gate: namespace + version + known event type + instance id. */
export function parseVeEvent(data: unknown): VeEnvelope | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.namespace !== VE_NAMESPACE) return null;
  if (d.version !== VE_VERSION) return null;
  if (typeof d.type !== 'string' || !EVENT_TYPES.has(d.type)) return null;
  if (typeof d.instanceId !== 'string' || !d.instanceId || d.instanceId.length > 128) return null;
  const env: VeEnvelope = { namespace: VE_NAMESPACE, version: VE_VERSION, type: d.type, instanceId: d.instanceId };
  if (typeof d.requestId === 'string' && d.requestId.length <= 128) env.requestId = d.requestId;
  if (d.payload && typeof d.payload === 'object') env.payload = d.payload;
  return env;
}

const ELEMENT_TYPES: ReadonlySet<string> = new Set<VisualElementType>([
  'heading', 'text', 'button', 'link', 'image', 'card', 'navigation', 'section', 'footer', 'container', 'unknown',
]);

function cleanStr(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : undefined;
}

function finiteNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Whitelist an untrusted SELECTED.selection into a safe `VisualSelection`. Only
 * known scalar fields are copied and bounded; anything else (nodes, HTML, styles,
 * form values, arbitrary datasets) is dropped.
 */
export function sanitizeSelection(raw: unknown): VisualSelection | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const nodeId = cleanStr(r.nodeId, 256);
  const tagName = cleanStr(r.tagName, 40);
  if (!nodeId || !tagName) return null;
  const elementType = (typeof r.elementType === 'string' && ELEMENT_TYPES.has(r.elementType)
    ? r.elementType : 'unknown') as VisualElementType;
  const identitySource: VisualIdentitySource = r.identitySource === 'metadata' ? 'metadata' : 'runtime';
  return {
    version: 1,
    route: cleanStr(r.route, 200),
    nodeId,
    identitySource,
    tagName,
    role: cleanStr(r.role, 40) || tagName,
    elementType,
    typeKey: cleanStr(r.typeKey, 40) || 'vsElement',
    section: cleanStr(r.section, 28),
    textPreview: cleanStr(r.textPreview, 120),
    domPath: cleanStr(r.domPath, 200),
  };
}

/**
 * Whitelist an untrusted SELECTED.imageTarget into a `VisualImageTarget`. Returns
 * null when the payload is absent or not a supported image descriptor. The parent
 * decides whether to offer replacement from `canPreviewReplace`.
 */
export function sanitizeImageTarget(raw: unknown, selection: VisualSelection): VisualImageTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const imageKind = r.imageKind === 'background' ? 'background' : r.imageKind === 'img' ? 'img' : null;
  if (!imageKind) return null;
  const sourceAttribute = r.sourceAttribute === 'background-image' ? 'background-image'
    : r.sourceAttribute === 'src' ? 'src' : (imageKind === 'img' ? 'src' : 'background-image');
  const currentUrl = cleanStr(r.currentUrl, 2048) || '';
  return {
    selection,
    imageKind,
    currentUrl,
    altText: cleanStr(r.altText, 200),
    width: finiteNum(r.width),
    height: finiteNum(r.height),
    aspectRatio: finiteNum(r.aspectRatio),
    objectFit: cleanStr(r.objectFit, 40),
    sourceAttribute,
    canPreviewReplace: r.canPreviewReplace === true,
    limitationReason: cleanStr(r.limitationReason, 60),
    nodeId: selection.nodeId,
  };
}

/** A short, bounded error code from an ERROR event (never a stack trace). */
export function sanitizeErrorCode(v: unknown): string {
  return cleanStr(v, 60) || 'error';
}
