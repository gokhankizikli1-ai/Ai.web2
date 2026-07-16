/**
 * Web Build — Visual Strategy schema, validation + normalization (Phase 14K.7).
 *
 * The typed, language-independent contract the Visual Intelligence Agent produces
 * and the deterministic stock-sourcing pipeline consumes. Model CONTENT is model-
 * generated; the CONTRACT here is strict — any malformed field is dropped/clamped
 * and a fully malformed response yields `null` so generation falls back cleanly.
 *
 * Nothing here calls a model or a provider; it is pure validation + normalization.
 */

export type PhotographyMode = 'none' | 'minimal' | 'balanced' | 'image-led';
export type VisualMediaType = 'photograph' | 'illustration' | 'typography-only' | 'none';
export type VisualSlotPurpose =
  | 'hero' | 'project' | 'gallery' | 'about' | 'team' | 'product'
  | 'service' | 'testimonial' | 'location' | 'background' | 'other';
export type VisualOrientation = 'landscape' | 'portrait' | 'square';
export type AuthenticityRisk = 'low' | 'medium' | 'high';

export interface VisualImageSlotPlan {
  slotId: string;
  sectionId: string;
  purpose: VisualSlotPurpose;
  mediaType: VisualMediaType;
  required: boolean;
  priority: number;
  /** Present + required only for `mediaType: 'photograph'`. Sanitized, ≤120 chars. */
  query?: string;
  orientation: VisualOrientation;
  composition?: string;
  mood?: string[];
  altText: string;
  avoid?: string[];
  authenticityRisk: AuthenticityRisk;
}

export interface VisualStrategy {
  version: 1;
  photographyMode: PhotographyMode;
  rationale: string;
  visualMood: string[];
  imageStyle: string[];
  avoid: string[];
  authenticityRules: string[];
  imageSlots: VisualImageSlotPlan[];
}

/** Hard cap on PHOTOGRAPHIC slots — enforced here, independent of model output. */
export const MAX_PHOTO_SLOTS = 8;
const MAX_QUERY = 120;
const MAX_ALT = 200;
const MAX_TEXT = 240;
const MAX_LIST = 8;

const PHOTOGRAPHY_MODES = new Set<PhotographyMode>(['none', 'minimal', 'balanced', 'image-led']);
const MEDIA_TYPES = new Set<VisualMediaType>(['photograph', 'illustration', 'typography-only', 'none']);
const PURPOSES = new Set<VisualSlotPurpose>([
  'hero', 'project', 'gallery', 'about', 'team', 'product', 'service', 'testimonial', 'location', 'background', 'other',
]);
const ORIENTATIONS = new Set<VisualOrientation>(['landscape', 'portrait', 'square']);
const RISKS = new Set<AuthenticityRisk>(['low', 'medium', 'high']);

/** Obviously non-descriptive queries we never send to a stock provider. */
const GENERIC_QUERY = /^(hero|hero image|website|website photo|business|business image|stock|stock photo|image|photo|photograph|picture)s?$/i;

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}
function strList(v: unknown, itemMax = 80, cap = MAX_LIST): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const s = str(item, itemMax);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}
function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : dflt;
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Sanitize a search query to a single, safe subject-line: letters/numbers/spaces
 * and a few separators only (no HTML/code/operators/ids/quotes), normalized,
 * ≤120 chars. Returns '' for empty or obviously-generic ("hero image") queries.
 */
export function sanitizeVisualQuery(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let q = raw.replace(/<[^>]*>/g, ' ')                      // strip any markup
    .replace(/[^0-9A-Za-zÀ-ɏЀ-ӿ\s\-&',]/g, ' ')             // keep letters/nums/basic separators
    .replace(/\s+/g, ' ')
    .trim();
  q = q.slice(0, MAX_QUERY).trim();
  if (q.length < 3 || GENERIC_QUERY.test(q)) return '';
  return q;
}

function sanitizeSlot(raw: unknown): VisualImageSlotPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const slotId = str(r.slotId, 120);
  if (!slotId) return null;
  const mediaType: VisualMediaType = MEDIA_TYPES.has(r.mediaType as VisualMediaType) ? (r.mediaType as VisualMediaType) : 'none';
  const query = mediaType === 'photograph' ? sanitizeVisualQuery(r.query) : '';
  // A photographic slot without a usable query cannot be sourced → drop it.
  if (mediaType === 'photograph' && !query) return null;
  return {
    slotId,
    sectionId: str(r.sectionId, 120) || slotId,
    purpose: PURPOSES.has(r.purpose as VisualSlotPurpose) ? (r.purpose as VisualSlotPurpose) : 'other',
    mediaType,
    required: r.required === true,
    priority: clampInt(r.priority, 0, 100, 50),
    ...(query ? { query } : {}),
    orientation: ORIENTATIONS.has(r.orientation as VisualOrientation) ? (r.orientation as VisualOrientation) : 'landscape',
    composition: str(r.composition, 120) || undefined,
    mood: strList(r.mood, 40, 6),
    altText: str(r.altText, MAX_ALT),
    avoid: strList(r.avoid, 60, 6),
    authenticityRisk: RISKS.has(r.authenticityRisk as AuthenticityRisk) ? (r.authenticityRisk as AuthenticityRisk) : 'low',
  };
}

/**
 * Validate + normalize a raw agent response into a `VisualStrategy`. Returns null
 * when nothing usable remains (→ deterministic fallback). Unknown fields ignored;
 * photographic slots deduped by slotId and hard-capped to MAX_PHOTO_SLOTS.
 */
export function sanitizeVisualStrategy(raw: unknown): VisualStrategy | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const photographyMode: PhotographyMode = PHOTOGRAPHY_MODES.has(r.photographyMode as PhotographyMode)
    ? (r.photographyMode as PhotographyMode) : 'balanced';

  const rawSlots = Array.isArray(r.imageSlots) ? r.imageSlots : [];
  const seen = new Set<string>();
  const slots: VisualImageSlotPlan[] = [];
  let photoCount = 0;
  for (const s of rawSlots) {
    const slot = sanitizeSlot(s);
    if (!slot || seen.has(slot.slotId)) continue;
    if (slot.mediaType === 'photograph') {
      if (photoCount >= MAX_PHOTO_SLOTS) continue;   // hard cap, independent of the model
      photoCount += 1;
    }
    seen.add(slot.slotId);
    slots.push(slot);
    if (slots.length >= 40) break;
  }

  // 'none' mode must carry zero photographic slots (respect an explicit photo-free ask).
  const finalSlots = photographyMode === 'none'
    ? slots.map((s) => (s.mediaType === 'photograph' ? { ...s, mediaType: 'none' as const, query: undefined } : s))
    : slots;

  // A response with neither a valid mode signal nor any slots is not usable.
  if (finalSlots.length === 0 && !PHOTOGRAPHY_MODES.has(r.photographyMode as PhotographyMode)) return null;

  return {
    version: 1,
    photographyMode,
    rationale: str(r.rationale, MAX_TEXT),
    visualMood: strList(r.visualMood, 40),
    imageStyle: strList(r.imageStyle, 40),
    avoid: strList(r.avoid, 60),
    authenticityRules: strList(r.authenticityRules, 120),
    imageSlots: finalSlots,
  };
}

/** The photographic slots a valid strategy wants sourced (already capped/sanitized). */
export function photographicSlots(strategy: VisualStrategy | null | undefined): VisualImageSlotPlan[] {
  if (!strategy) return [];
  return strategy.imageSlots.filter((s) => s.mediaType === 'photograph' && !!s.query).slice(0, MAX_PHOTO_SLOTS);
}
