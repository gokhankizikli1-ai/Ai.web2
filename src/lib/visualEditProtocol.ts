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
  | 'GET_STATE'
  // PR #517 — request a bounded, read-only layout MEASUREMENT of the rendered DOM. This is
  // NOT a generic query: the runtime returns only fixed numeric/boolean layout metrics.
  | 'MEASURE'
  // PR #521 — request ONE bounded, viewport-only rasterization of the rendered preview. The
  // runtime returns a single compressed image data URL (or an honest failure). It is NOT a
  // generic screen-scrape: only the generated preview's own viewport is captured.
  | 'CAPTURE_SCREENSHOT';

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
  | 'STATE'
  // PR #517 — the read-only layout metrics for a MEASURE request.
  | 'MEASUREMENT'
  // PR #521 — the bounded result of a CAPTURE_SCREENSHOT request (one compressed image or a
  // typed failure). Never carries DOM/source/text — only the encoded pixels + honest metadata.
  | 'SCREENSHOT_RESULT';

const EVENT_TYPES: ReadonlySet<string> = new Set<VeEventType>([
  'READY', 'SELECTION_MODE_CHANGED', 'SELECTED', 'SELECTION_CLEARED',
  'IMAGE_PREVIEW_APPLIED', 'IMAGE_RESTORED', 'ERROR', 'PONG', 'STATE', 'MEASUREMENT', 'SCREENSHOT_RESULT',
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

/* ── PR #517 — read-only layout MEASUREMENT ──────────────────────────────────── */

/** MEASURE command payload — which viewport to report + the run identity to stamp back, so a
 *  stale measurement can be discarded. Contains NO source, secrets or user data. */
/** The measured layout regimes. App Build Quality V2 adds `laptop` (1024) and `mobile-large`
 *  (430); they are only ever requested for an APP build, so website measurement is unchanged. */
export type VeViewport = 'desktop' | 'laptop' | 'tablet' | 'mobile-large' | 'mobile';

/** The runtime accepts exactly these viewport labels; anything else falls back to 'desktop'. */
export const VE_VIEWPORTS: ReadonlySet<string> = new Set<VeViewport>([
  'desktop', 'laptop', 'tablet', 'mobile-large', 'mobile',
]);

export interface VeMeasureRequestPayload {
  viewport: VeViewport;
  /** Echoed back on the MEASUREMENT so the parent can drop stale/mismatched runs. */
  runId: string;
  /** The parent-required layout contract flags (from the plan) the runtime should check. */
  expectHero?: boolean;
  expectCta?: boolean;
  appFirst?: boolean;
  /* ── App Build Quality V2 — APP-ONLY measurement switches. Absent for a website build, so the
   *  runtime performs exactly the measurement it performed before. */
  /** Measure the app-surface facts (nav reachability, touch targets, clipping) and use the
   *  application-shell selectors for the coverage/whitespace estimate. */
  appMode?: boolean;
  /** Additionally OPERATE up to a few primary navigation controls and report whether they
   *  actually changed the route / rendered screen. Requested at most once per candidate, after
   *  every viewport measurement, so it can never perturb an earlier measurement. */
  probeNav?: boolean;
}

/** The bounded, whitelisted layout metrics a MEASUREMENT carries. ONLY fixed numeric/boolean
 *  layout facts — never DOM nodes, HTML, text content, source, styles, tokens or user data. */
export interface VeMeasurement {
  viewport: VeViewport;
  runId: string;
  width: number;
  height: number;
  contentHeight: number;
  horizontalOverflow: boolean;
  whitespaceRatio: number;
  blank: boolean;
  runtimeCompiled: boolean;
  runtimeError: boolean;
  /** Top offset (px) of the first meaningful content block, if resolvable. */
  firstContentTop?: number;
  /** Runtime-observed layout-contract facts (DOM truth, not source inference). */
  heroVisible?: boolean;
  ctaInFirstViewport?: boolean;
  marketingHeroOnAppFirst?: boolean;
  /* ── App Build Quality V2 — APP-ONLY runtime facts (present only when `appMode` was asked). ── */
  /** Primary navigation controls the runtime actually operated (`probeNav` only). */
  navProbedCount?: number;
  /** How many of those genuinely changed the route or the rendered screen (`probeNav` only). */
  navWorkingCount?: number;
  /** The navigation is reachable at this viewport (visible nav items or a menu/drawer trigger). */
  navReachable?: boolean;
  /** Interactive controls smaller than the minimum comfortable hit area at this viewport. */
  smallTouchTargetCount?: number;
  /** Elements whose own content is cut off by their box with no scroll affordance. */
  clippedElementCount?: number;
}

function clampNum(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.min(max, Math.max(min, v));
}

/**
 * Whitelist an untrusted MEASUREMENT payload into a safe `VeMeasurement`. Only fixed
 * numeric/boolean layout fields are copied and bounded; anything else is dropped. Returns
 * `null` when the payload is not a usable measurement (missing viewport / dimensions).
 */
export function sanitizeMeasurement(raw: unknown): VeMeasurement | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const viewport = typeof r.viewport === 'string' && VE_VIEWPORTS.has(r.viewport) ? (r.viewport as VeViewport) : null;
  const runId = cleanStr(r.runId, 128);
  const width = clampNum(r.width, 0, 100000);
  const height = clampNum(r.height, 0, 100000);
  if (!viewport || !runId || width === undefined || height === undefined) return null;
  const contentHeight = clampNum(r.contentHeight, 0, 10000000) ?? height;
  const whitespaceRatio = clampNum(r.whitespaceRatio, 0, 1) ?? 0;
  const out: VeMeasurement = {
    viewport,
    runId,
    width,
    height,
    contentHeight,
    horizontalOverflow: r.horizontalOverflow === true,
    whitespaceRatio,
    blank: r.blank === true,
    runtimeCompiled: r.runtimeCompiled === true,
    runtimeError: r.runtimeError === true,
  };
  const firstContentTop = clampNum(r.firstContentTop, 0, 10000000);
  if (firstContentTop !== undefined) out.firstContentTop = firstContentTop;
  if (typeof r.heroVisible === 'boolean') out.heroVisible = r.heroVisible;
  if (typeof r.ctaInFirstViewport === 'boolean') out.ctaInFirstViewport = r.ctaInFirstViewport;
  if (typeof r.marketingHeroOnAppFirst === 'boolean') out.marketingHeroOnAppFirst = r.marketingHeroOnAppFirst;
  // App Build Quality V2 — bounded APP-only facts. Absent for a website measurement, so a web
  // build produces byte-for-byte the same sanitized measurement it produced before.
  const navProbedCount = clampNum(r.navProbedCount, 0, 64);
  if (navProbedCount !== undefined) out.navProbedCount = Math.round(navProbedCount);
  const navWorkingCount = clampNum(r.navWorkingCount, 0, 64);
  if (navWorkingCount !== undefined) out.navWorkingCount = Math.round(navWorkingCount);
  if (typeof r.navReachable === 'boolean') out.navReachable = r.navReachable;
  const smallTouchTargetCount = clampNum(r.smallTouchTargetCount, 0, 2000);
  if (smallTouchTargetCount !== undefined) out.smallTouchTargetCount = Math.round(smallTouchTargetCount);
  const clippedElementCount = clampNum(r.clippedElementCount, 0, 2000);
  if (clippedElementCount !== undefined) out.clippedElementCount = Math.round(clippedElementCount);
  // A working count can never exceed the probed count (defensive against a malformed runtime).
  if (out.navWorkingCount !== undefined && out.navProbedCount !== undefined) {
    out.navWorkingCount = Math.min(out.navWorkingCount, out.navProbedCount);
  }
  return out;
}

/* ── PR #521 — bounded single-viewport SCREENSHOT capture ─────────────────────── */

export type VeScreenshotFormat = 'webp' | 'jpeg' | 'png';
/** MIME types the parent will accept back — kept in sync with VeScreenshotFormat. */
export const VE_SCREENSHOT_MIME_TYPES: ReadonlySet<string> = new Set(['image/webp', 'image/jpeg', 'image/png']);
/** Hard ceiling on the encoded image the parent will accept (fail-open above this). */
export const VE_SCREENSHOT_MAX_BYTES = 1_600_000;
/** data:image/<fmt>;base64,<...> — the only shape the parent trusts as an image. */
const SCREENSHOT_DATA_URL_RE = /^data:image\/(webp|jpe?g|png);base64,[A-Za-z0-9+/=]+$/;

/** CAPTURE_SCREENSHOT command payload — desktop-only, viewport-only, bounded. Carries the run
 *  identity so a stale capture can be discarded. Contains NO source/secrets/user data. */
export interface VeScreenshotRequestPayload {
  /** Only 'desktop' is captured for the rendered vision review (viewport-only, not full page). */
  viewport: 'desktop';
  /** Echoed back on SCREENSHOT_RESULT so the parent can drop stale/mismatched runs. */
  runId: string;
  width: number;
  height: number;
  format: VeScreenshotFormat;
  /** 0–1 encoder quality (ignored for png). */
  quality: number;
  /** The runtime must not return an image larger than this many encoded bytes. */
  maxBytes: number;
}

/** The bounded result of a CAPTURE_SCREENSHOT. On success `dataUrl` is a single compressed image;
 *  on any failure/blank/oversized/tainted capture, `ok` is false and `errorCode` explains why.
 *  `partial` marks an honestly-incomplete capture (e.g. cross-origin media could not be drawn). */
export interface VeScreenshotResult {
  runId: string;
  ok: boolean;
  mimeType?: string;
  byteLength: number;
  dataUrl?: string;
  blank: boolean;
  partial: boolean;
  errorCode?: string;
}

/** Approx. decoded byte length of a base64 data URL WITHOUT allocating the bytes. */
export function base64DataUrlByteLength(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return 0;
  const b64 = dataUrl.slice(comma + 1);
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/**
 * Whitelist an untrusted SCREENSHOT_RESULT payload into a safe `VeScreenshotResult`. Enforces:
 * a valid runId, a recognized image MIME + `data:image/...;base64,...` shape, and the encoded
 * size ceiling. A blank / oversized / malformed / mismatched-format capture is normalized to
 * `ok:false` with a bounded errorCode (never trusted as a reviewable image). Returns `null` only
 * when there is no usable run identity. Never throws.
 */
export function sanitizeScreenshotResult(raw: unknown, maxBytes = VE_SCREENSHOT_MAX_BYTES): VeScreenshotResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const runId = cleanStr(r.runId, 128);
  if (!runId) return null;
  const blank = r.blank === true;
  const partial = r.partial === true;
  const errorCode = cleanStr(r.errorCode, 60);
  const base: VeScreenshotResult = { runId, ok: false, byteLength: 0, blank, partial };
  if (errorCode) base.errorCode = errorCode;

  // Only a well-formed, in-budget, non-blank image data URL is accepted as ok.
  const dataUrl = typeof r.dataUrl === 'string' ? r.dataUrl : '';
  const mimeType = cleanStr(r.mimeType, 40);
  if (r.ok !== true) return base;
  if (blank) return { ...base, ok: false, errorCode: base.errorCode || 'blank' };
  if (!dataUrl || dataUrl.length > maxBytes * 2 || !SCREENSHOT_DATA_URL_RE.test(dataUrl)) {
    return { ...base, ok: false, errorCode: 'invalid-data-url' };
  }
  if (mimeType && !VE_SCREENSHOT_MIME_TYPES.has(mimeType)) {
    return { ...base, ok: false, errorCode: 'unsupported-mime' };
  }
  const byteLength = base64DataUrlByteLength(dataUrl);
  if (byteLength <= 0) return { ...base, ok: false, errorCode: 'blank' };
  if (byteLength > maxBytes) return { ...base, ok: false, byteLength, errorCode: 'too-large' };
  const derivedMime = `image/${(dataUrl.slice(11, dataUrl.indexOf(';')) || 'webp').replace('jpg', 'jpeg')}`;
  return {
    runId,
    ok: true,
    mimeType: mimeType && VE_SCREENSHOT_MIME_TYPES.has(mimeType) ? mimeType : derivedMime,
    byteLength,
    dataUrl,
    blank: false,
    partial,
  };
}
