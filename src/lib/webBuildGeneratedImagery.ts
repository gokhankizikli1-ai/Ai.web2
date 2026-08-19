/**
 * Web Build — GENERATED IMAGERY ROUTE (web-build-image-intelligence-v1).
 *
 * The `generated` arm of the image source strategy: it turns ONE routing decision into a real,
 * art-directed, DURABLY-PERSISTED image asset that the builder can render exactly like a stock
 * photograph — or into an honest failure that falls back.
 *
 * WHAT IT REUSES (it introduces no second image system)
 *   • the art direction that already exists — `visualConcept.imageRoles` (subject, medium, crop,
 *     focal point, lighting, tone, aspect, people policy, negative space);
 *   • the ONE provider surface — `POST /v2/web-build/images/generate` via
 *     `generateImageFromRequest` (keys stay server-side; the browser never sees a provider);
 *   • the ONE generation safety gate — the same proof-heavy kind sets the backend enforces;
 *   • the ONE storage authority — the backend persists through the existing asset system and
 *     returns a stable delivery URL, resolved by the existing `resolveAssetUrl`;
 *   • the ONE per-build budget — `MAX_GENERATED_IMAGES_PER_BUILD`.
 *
 * HARD PROPERTIES
 *   • WEB ONLY. An app build is refused here as well as being structurally unable to reach this
 *     module (no source-strategy contract is derived for it) — belt AND braces.
 *   • A generated image is DECORATIVE/ILLUSTRATIVE. The prompt forbids logos, wordmarks,
 *     certifications, identifiable people, product likenesses, screenshots implying real data
 *     and any other fabricated proof, and the asset carries an honest label.
 *   • A result that cannot be DURABLY persisted is never used: a session-only data: URL would
 *     not survive save/reopen/revision and would bloat the persisted payload. It is reported as
 *     `not-persistable` and the decision falls back.
 *   • Never throws. Any failure is an honest outcome, never a broken build.
 */
import type { FrontendBuildSpecification, SourcedImageAsset } from '@/lib/webBuildAgents';
import type { ImageRoleDirection, VisualConceptContract } from '@/lib/webBuildVisualConcept';
import type { ImageSourceDecision } from '@/lib/webBuildImageSourceStrategy';
import {
  MAX_GENERATED_IMAGES_PER_BUILD, resolveImageRoleForSlot,
} from '@/lib/webBuildImageSourceStrategy';
import {
  fetchImageGenHealth, generateImageFromRequest,
  ALWAYS_MANUAL_IMAGE_KINDS, ILLUSTRATIVE_IMAGE_KINDS,
  type ImageGenerationRequest, type GeneratedImageAsset,
} from '@/lib/webBuildImageGeneration';
import { resolveAssetUrl } from '@/lib/webBuildImageUpload';

/* ── Bounds ─────────────────────────────────────────────────────────────────── */
const MAX_PROMPT_CHARS = 1200;
const MAX_NEGATIVE_CHARS = 600;
const MAX_STYLE_CHARS = 400;
const MAX_FIELD = 160;
const MAX_LIST = 6;
/**
 * Hard wall-clock bound on the ENTIRE generated route, across every attempt. Each call already
 * has its own client timeout, but two sequential timeouts would add minutes to a build before the
 * coding model even starts. Once this deadline passes the remaining decisions fall back instead
 * of waiting. Deliberately smaller than `budget × IMAGE_GEN_TIMEOUT_MS`.
 */
export const GENERATED_IMAGERY_TOTAL_BUDGET_MS = 120_000;
/** The honest, user-visible label every generated visual carries. */
export const GENERATED_HONESTY_LABEL = 'AI-generated illustrative artwork (not a photograph of a real place, product or person)';

/* ── The structured ART-DIRECTION CONTRACT the generated route receives ─────── */
export interface GeneratedArtDirection {
  slotId: string;
  sectionId?: string;
  /** The section ROLE this visual serves (hero lead, ambient background, explanatory…). */
  sectionRole: string;
  subject: string;
  framing: string;
  composition: string;
  lighting: string;
  focalPoint: string;
  /** True when the visual sits behind or beside copy and must reserve a calm, low-detail zone. */
  negativeSpace: boolean;
  textSafeArea?: string;
  brandTone: string;
  visualStyle: string;
  medium: string;
  aspectRatio: string;
  orientation: 'landscape' | 'portrait' | 'square';
  /** What this visual may NOT imply — the fabrication boundary. */
  authenticityConstraints: string[];
  forbidden: string[];
  altText: string;
}

const clip = (v: unknown, n = MAX_FIELD): string =>
  (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
function list(items: Array<string | undefined>, n = MAX_LIST, each = MAX_FIELD): string[] {
  const out: string[] = [];
  for (const raw of items) {
    const s = clip(raw, each);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= n) break;
  }
  return out;
}

/** Aspect ratio → orientation. Deterministic; defaults to landscape. */
function orientationOf(aspect: string): 'landscape' | 'portrait' | 'square' {
  const m = /^(\d{1,2})\s*:\s*(\d{1,2})$/.exec(aspect.trim());
  if (!m) return 'landscape';
  const w = Number(m[1]); const h = Number(m[2]);
  if (!w || !h) return 'landscape';
  if (w > h) return 'landscape';
  if (h > w) return 'portrait';
  return 'square';
}

/** A readable phrase for the section role a visual serves. Never the word "slot". */
function sectionRoleOf(d: ImageSourceDecision): string {
  if (d.hero) return 'the first-viewport lead visual, behind and beside the headline';
  switch (d.role) {
    case 'background-atmosphere': return 'an ambient background layer behind readable content';
    case 'decorative-texture': return 'a quiet textural band separating two content sections';
    case 'process-illustration': return 'an explanatory visual beside a description of how the product works';
    case 'feature-explanation': return 'a supporting visual beside one capability explanation';
    case 'security-technical': return 'a supporting visual for a technical/trust section';
    default: return 'a supporting visual beside its own section copy';
  }
}

/* ── Art direction assembly — composed from ALREADY-derived contracts ───────── */
export interface GeneratedArtDirectionContext {
  spec: FrontendBuildSpecification;
  art?: ImageRoleDirection;
}

/**
 * Build the art-direction contract for one decision. Pure. It never invents a subject: the
 * subject comes from the visual-concept role, the coverage query or the identity of the product,
 * in that order, so a generated visual is about THIS product, never "a modern SaaS image".
 */
export function buildGeneratedArtDirection(
  decision: ImageSourceDecision, ctx: GeneratedArtDirectionContext,
): GeneratedArtDirection {
  const spec = ctx.spec || ({} as FrontendBuildSpecification);
  const art = ctx.art || resolveImageRoleForSlot(spec.visualConcept, decision.slotId, decision.role);
  const vc: VisualConceptContract | undefined = spec.visualConcept;
  const id = spec.identity || ({} as FrontendBuildSpecification['identity']);
  const ds = spec.designSystem || ({} as FrontendBuildSpecification['designSystem']);
  const di = spec.designIntelligence;

  const concept = clip(id.primaryConcept || id.subsector || id.sector || id.siteType, 90);
  const subject = clip(art?.subject, 180)
    || clip(vc?.signature?.dominantSubject, 180)
    || clip(concept ? `an abstract brand visual expressing ${concept}` : 'an abstract brand visual', 180);

  const aspectRatio = clip(decision.aspectRatio || art?.aspectRatio || (decision.hero ? '16:9' : '4:3'), 12) || '16:9';
  const negativeSpace = decision.hero
    || art?.role === 'hero-signature'
    || art?.role === 'background-atmosphere'
    || art?.role === 'decorative-texture';

  const brandTone = clip(
    [clip(di?.brand?.summary, 70), clip(ds.firstImpression, 70), clip(art?.tone, 70), clip(vc?.visualThesis, 70)]
      .filter(Boolean)[0] || 'confident, precise, contemporary',
    MAX_FIELD,
  );
  const visualStyle = clip(
    [clip(ds.selectedVisualDirection, 90), clip(ds.visualSignature, 90), clip(vc?.distinctiveness, 90)]
      .filter(Boolean)[0] || 'restrained contemporary art direction with real depth and material quality',
    MAX_FIELD,
  );

  return {
    slotId: decision.slotId,
    ...(decision.sectionId ? { sectionId: decision.sectionId } : {}),
    sectionRole: sectionRoleOf(decision),
    subject,
    framing: clip(art?.crop, 120) || (decision.hero
      ? 'wide, generous headroom with the subject held off-centre'
      : 'balanced, subject off-centre on the rule of thirds'),
    composition: clip(vc?.signature?.layeringStrategy, 120)
      || 'one clear idea, layered depth, nothing crowding the edges',
    lighting: clip(art?.lighting, 100) || 'natural, directional light with a clear key and soft falloff',
    focalPoint: clip(art?.focalPoint, 100) || (decision.hero
      ? 'upper-third, leaving a calm zone for the headline'
      : 'a single, unambiguous focal point'),
    negativeSpace,
    ...(negativeSpace ? {
      textSafeArea: decision.hero
        ? 'keep the left half and the upper third low-contrast and low-detail so overlaid headline and body copy stay readable'
        : 'keep one continuous low-detail region so adjacent copy stays readable',
    } : {}),
    brandTone,
    visualStyle,
    medium: clip(decision.medium || art?.medium, 40) || 'abstract-generative',
    aspectRatio,
    orientation: orientationOf(aspectRatio),
    authenticityConstraints: list([
      'this is decorative/illustrative artwork — it must not read as documentary evidence of a real place, product, team or result',
      art?.peoplePresent === 'avoid' || !art ? 'no identifiable people' : 'no identifiable real individuals; any human presence stays anonymous and incidental',
      'nothing that implies a certification, award, partnership, customer or metric',
    ], 3, 200),
    forbidden: list([
      ...(vc?.exclusions || []),
      ...(vc?.signature?.prohibited || []),
      ...(di?.image?.forbidden || []),
      'text, lettering, numerals, watermarks or captions of any kind',
      'logos, wordmarks, brand marks or badges',
      'user-interface chrome, browser windows, dashboards or charts with invented data',
      'stock-photo clichés: handshakes, boardroom smiles, floating glass cards over a purple gradient',
    ], MAX_LIST, 120),
    altText: clip(art?.altIntent, 180)
      || clip(decision.hero ? `Illustrative brand artwork for ${concept || 'this product'}` : `Illustrative supporting artwork for ${concept || 'this section'}`, 180),
  };
}

/* ── Prompt rendering ───────────────────────────────────────────────────────── */
export interface GeneratedImagePrompt {
  positive: string;
  negative: string;
  style: string;
  aspectRatio: string;
  safetyNotes: string[];
}

/**
 * Render the art direction into the provider prompt contract. Specific by construction: every
 * sentence is a decision this build already made. There is no generic "modern SaaS image" path —
 * with no art direction at all the subject still names the product's own concept.
 */
export function buildGeneratedImagePrompt(ad: GeneratedArtDirection): GeneratedImagePrompt {
  const positive = [
    `${ad.subject}.`,
    `Role: ${ad.sectionRole}.`,
    `Composition: ${ad.framing}; ${ad.composition}.`,
    `Focal point: ${ad.focalPoint}.`,
    `Lighting: ${ad.lighting}.`,
    ad.negativeSpace && ad.textSafeArea ? `Negative space: ${ad.textSafeArea}.` : '',
    `Mood: ${ad.brandTone}.`,
    `Art direction: ${ad.visualStyle}; medium: ${ad.medium}.`,
    `Framing: ${ad.orientation} ${ad.aspectRatio}, edge-to-edge, no border or frame.`,
  ].filter(Boolean).join(' ').slice(0, MAX_PROMPT_CHARS);

  const negative = ad.forbidden.join('; ').slice(0, MAX_NEGATIVE_CHARS);
  const style = `${ad.visualStyle} — ${ad.medium}, ${ad.brandTone}`.slice(0, MAX_STYLE_CHARS);

  return {
    positive,
    negative,
    style,
    aspectRatio: ad.aspectRatio,
    safetyNotes: ad.authenticityConstraints.slice(0, 4),
  };
}

/* ── The generated route ────────────────────────────────────────────────────── */
export type GeneratedImageryStatus =
  | 'ready' | 'app-build-excluded' | 'provider-unavailable' | 'unsafe-slot'
  | 'failed' | 'not-persistable' | 'over-budget' | 'timed-out' | 'duplicate';

export interface GeneratedImageryOutcome {
  slotId: string;
  status: GeneratedImageryStatus;
  /** Bounded, non-sensitive explanation. Never a key, URL fragment or prompt. */
  reason: string;
  asset?: SourcedImageAsset;
}

export interface GeneratedImageryDiagnostics {
  version: 'generated-imagery-v1';
  requested: number;
  attempted: number;
  produced: number;
  budget: number;
  ceiling: number;
  providerAvailable: boolean;
  providerCalls: number;
  healthCalls: number;
  notPersistable: number;
  failed: number;
  /**
   * Byte size of the heaviest generated image placed in this build. A provider PNG is materially
   * heavier than a stock CDN image with sizing parameters, and the optimizer's oversized-image
   * detector reads dimension QUERY PARAMS, which a stored asset URL does not carry — so the
   * weight is recorded here explicitly rather than being invisible. 0 when nothing was produced.
   */
  heaviestBytes: number;
  unsafeRefused: number;
  /** Attempts skipped because the route's total wall-clock budget was already spent. */
  timedOut: number;
  /** Generated results dropped because an identical URL had already filled another slot. */
  duplicatesPrevented: number;
  statuses: string[];
}

export interface GeneratedImageryResult {
  outcomes: GeneratedImageryOutcome[];
  assets: SourcedImageAsset[];
  diagnostics: GeneratedImageryDiagnostics;
}

const EMPTY_DIAG = (requested: number, budget: number, providerAvailable: boolean, healthCalls = 0): GeneratedImageryDiagnostics => ({
  version: 'generated-imagery-v1',
  requested, attempted: 0, produced: 0, budget, ceiling: MAX_GENERATED_IMAGES_PER_BUILD,
  providerAvailable, providerCalls: 0, healthCalls,
  notPersistable: 0, failed: 0, unsafeRefused: 0, timedOut: 0, duplicatesPrevented: 0,
  heaviestBytes: 0, statuses: [],
});

/** The image-pipeline kind a generated visual is requested as. Always inside the EXISTING
 *  illustrative-safe set, so the backend's own gate corroborates the routing rather than
 *  being bypassed. A proof-heavy kind is never mapped here. */
export function generationKindFor(decision: ImageSourceDecision): string {
  const kind = (decision.kind || '').trim();
  if (kind && ILLUSTRATIVE_IMAGE_KINDS.has(kind)) return kind;
  if (decision.hero) return 'hero-image';
  return 'abstract-brand-image';
}

/**
 * A durable, renderable URL for generated project source — never a `data:` URL.
 *
 * An ABSOLUTE url from the provider must be `https:`: a plain-http image is blocked as mixed
 * content on an https site, so it would render as a broken image in the delivered product (the
 * same https-only rule the user-image replacement path already enforces). A RELATIVE url is our
 * own asset route and is resolved against the configured API base, whatever scheme that base
 * uses — so local development keeps working.
 */
export function durableUrl(asset: Pick<GeneratedImageAsset, 'url'>): string {
  const raw = (asset?.url || '').trim();
  if (!raw || /^data:/i.test(raw)) return '';
  const absolute = /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//');
  if (absolute) return /^https:\/\//i.test(raw) ? raw : '';
  const resolved = resolveAssetUrl(raw);
  return /^https?:\/\//i.test(resolved) ? resolved : '';
}

export interface RunGeneratedImageryContext {
  spec: FrontendBuildSpecification;
  budget: number;
  buildId?: string;
  projectId?: string;
  /** Injectable clock (tests + determinism). Defaults to `Date.now`. */
  now?: () => number;
  /** Override the total wall-clock bound (tests). Defaults to the constant above. */
  totalBudgetMs?: number;
}

/**
 * Run the generated route for the decisions the strategy routed to it. Bounded by `budget` AND
 * by the product-wide ceiling. Performs ONE health probe (no provider call) and at most `budget`
 * provider calls. NEVER throws; every failure is an honest outcome the caller falls back from.
 */
export async function runGeneratedImagery(
  decisions: ImageSourceDecision[],
  ctx: RunGeneratedImageryContext,
  opts?: { signal?: AbortSignal },
): Promise<GeneratedImageryResult> {
  const wanted = (decisions || []).filter((d) => d && d.strategy === 'generated');
  const budget = Math.max(0, Math.min(ctx?.budget ?? 0, MAX_GENERATED_IMAGES_PER_BUILD));

  // ── APP BUILD ISOLATION (belt & braces). The source-strategy contract is never derived for
  //    an app build, so this list is normally empty; if a caller ever passes decisions anyway,
  //    NO provider call may originate here. ──
  if (!ctx?.spec || ctx.spec.buildType === 'app') {
    return {
      outcomes: wanted.map((d) => ({ slotId: d.slotId, status: 'app-build-excluded' as const, reason: 'app build never uses generated imagery' })),
      assets: [],
      diagnostics: EMPTY_DIAG(wanted.length, 0, false),
    };
  }
  if (!wanted.length || budget === 0) {
    return { outcomes: [], assets: [], diagnostics: EMPTY_DIAG(wanted.length, budget, false) };
  }

  // ONE health probe — no provider call, no cost. Skips the whole route (and its metered
  // generate calls) when the deployment has image generation off or unconfigured.
  let providerAvailable = false;
  let healthCalls = 0;
  try {
    healthCalls = 1;
    const health = await fetchImageGenHealth();
    providerAvailable = !!health && health.enabled === true && health.configured === true;
  } catch { providerAvailable = false; }

  const diagnostics = EMPTY_DIAG(wanted.length, budget, providerAvailable, healthCalls);
  const outcomes: GeneratedImageryOutcome[] = [];
  const assets: SourcedImageAsset[] = [];

  if (!providerAvailable) {
    for (const d of wanted) {
      outcomes.push({ slotId: d.slotId, status: 'provider-unavailable', reason: 'image generation is not enabled or not configured on this deployment' });
    }
    diagnostics.statuses = ['provider-unavailable'];
    return { outcomes, assets, diagnostics };
  }

  const now = ctx.now || (() => Date.now());
  const deadline = now() + Math.max(1000, ctx.totalBudgetMs ?? GENERATED_IMAGERY_TOTAL_BUDGET_MS);
  const seenUrls = new Set<string>();
  let spent = 0;
  for (const d of wanted) {
    if (opts?.signal?.aborted) {
      outcomes.push({ slotId: d.slotId, status: 'failed', reason: 'build cancelled' });
      continue;
    }
    if (spent >= budget) {
      outcomes.push({ slotId: d.slotId, status: 'over-budget', reason: 'per-build generated-image budget already spent' });
      continue;
    }
    // The whole route is wall-clock bounded, not just each call: a build must never wait out two
    // consecutive provider timeouts before the coding model starts.
    if (now() >= deadline) {
      diagnostics.timedOut += 1;
      outcomes.push({ slotId: d.slotId, status: 'timed-out', reason: 'the generated-imagery time budget for this build was already spent' });
      continue;
    }
    // Proof-heavy slots are never fabricated — the same rule the backend enforces.
    if (d.kind && ALWAYS_MANUAL_IMAGE_KINDS.has(d.kind)) {
      diagnostics.unsafeRefused += 1;
      outcomes.push({ slotId: d.slotId, status: 'unsafe-slot', reason: 'this slot depicts something that must actually exist' });
      continue;
    }

    const ad = buildGeneratedArtDirection(d, { spec: ctx.spec });
    const prompt = buildGeneratedImagePrompt(ad);
    const req: ImageGenerationRequest = {
      slotId: d.slotId,
      target: d.sectionId ? `section:${d.sectionId}` : 'section:hero',
      kind: generationKindFor(d),
      source: 'provider-ready',
      manualUploadRecommended: false,
      honestyLabel: GENERATED_HONESTY_LABEL,
      prompt,
      persist: true,
      ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
      ...(ctx.buildId ? { buildId: ctx.buildId } : {}),
    };

    spent += 1;
    diagnostics.attempted += 1;
    diagnostics.providerCalls += 1;
    // Sequential on purpose: bounded to `budget` calls and gentle on provider rate limits.
    const result = await generateImageFromRequest(req, { signal: opts?.signal });
    if (result.status !== 'ready') {
      diagnostics.failed += 1;
      outcomes.push({ slotId: d.slotId, status: 'failed', reason: (result.reason || result.error || 'image generation did not produce an image').slice(0, 160) });
      continue;
    }
    const url = durableUrl(result);
    if (!url) {
      diagnostics.notPersistable += 1;
      outcomes.push({ slotId: d.slotId, status: 'not-persistable', reason: 'the generated image could not be stored durably, so it was not used' });
      continue;
    }
    // One image may never fill two roles. A provider that returns a cached/identical asset for
    // two prompts would otherwise place the same picture in two sections — the exact duplication
    // the stock path already refuses.
    if (seenUrls.has(url)) {
      diagnostics.duplicatesPrevented += 1;
      outcomes.push({ slotId: d.slotId, status: 'duplicate', reason: 'the provider returned an image already used by another slot' });
      continue;
    }
    seenUrls.add(url);
    diagnostics.produced += 1;
    if (typeof result.bytes === 'number' && result.bytes > diagnostics.heaviestBytes) {
      diagnostics.heaviestBytes = result.bytes;
    }
    assets.push({
      slotId: d.slotId,
      source: 'generated',
      url,
      altText: ad.altText,
      honestyLabel: GENERATED_HONESTY_LABEL,
      generatedProvider: result.provider,
      ...(result.assetId ? { assetId: result.assetId } : {}),
      ...(typeof result.width === 'number' ? { width: result.width } : {}),
      ...(typeof result.height === 'number' ? { height: result.height } : {}),
    });
    outcomes.push({ slotId: d.slotId, status: 'ready', reason: 'generated and stored', asset: assets[assets.length - 1] });
  }

  diagnostics.statuses = [...new Set(outcomes.map((o) => o.status))].slice(0, 8);
  return { outcomes, assets, diagnostics };
}
