/**
 * Web Build ART RENDER IDENTITY — the single, shared decision that makes the
 * preview AND the generated files render the same concept-specific surface/proof/
 * hero language, not just the same premium template with new colors.
 *
 * The UI / Art Director Agent persists its chosen identity onto the WebBuildBrief
 * (artDesignArchetype / artVisualSignature / artProofRules / …). This helper reads
 * those fields (plus safe fallbacks from the layout archetype and the plain brief)
 * and returns one deterministic `WebBuildArtIdentity` used by both render layers,
 * so the two can never disagree.
 *
 * IMPORTANT: the `*Tone` fields are literal Tailwind class fragments. They live in
 * this file (scanned by the app's Tailwind content glob) so they apply in the live
 * preview, and the same strings are emitted verbatim into the generated files — so
 * a change here changes BOTH. Everything is pure, deterministic and safe on missing
 * fields (no throws), so old saved builds with no art fields fall back cleanly.
 *
 * Type-only import from webBuildApi → no runtime dependency, no import cycle.
 */
import type { WebBuildBrief } from '@/lib/webBuildApi';
import type { WebBuildLayoutPlan } from '@/lib/webBuildLayoutPlan';

/** The rendered identity mode — a small, stable set that both render layers switch
 *  on. Broader than the ~20 art archetypes on purpose: it groups them into the
 *  surface/proof families that actually change the rendered components. */
export type ArtRenderMode =
  | 'archive'
  | 'landscaping'
  | 'trust-service'
  | 'hospitality'
  | 'product-saas'
  | 'marketplace'
  | 'event'
  | 'education'
  | 'community'
  | 'industrial'
  | 'portfolio'
  | 'modern';

export interface WebBuildArtIdentity {
  mode: ArtRenderMode;
  /** A one-line identity signature (subtle eyebrow enhancer), when known. */
  signature: string;
  /** Why this is not a generic SaaS template (for comments/owner debug). */
  antiTemplate: string;
  compositionRules: string[];
  surfaceRules: string[];
  /** Concise, concept-specific proof chips for the hero proof rail. */
  proofRules: string[];
  imagery: string;
  heroTreatment: string;
  componentStyle: string;
  /** Literal Tailwind fragments — appended to card / proof / media / eyebrow
   *  className strings in BOTH the preview and the generated files. */
  cardTone: string;
  proofTone: string;
  mediaTone: string;
  eyebrowTone: string;
}

/** The UI / Art Director archetype key → render mode. */
const ARCHETYPE_KEY_TO_MODE: Record<string, ArtRenderMode> = {
  'editorial-archive': 'archive',
  'real-estate': 'marketplace',
  'landscaping-nature': 'landscaping',
  'legal-medical-trust': 'trust-service',
  'fintech-trust': 'trust-service',
  'local-service-premium': 'trust-service',
  'wellness-retreat': 'hospitality',
  'restaurant-hospitality': 'hospitality',
  'high-conversion-saas': 'product-saas',
  'ai-tool': 'product-saas',
  'founder-startup': 'product-saas',
  'marketplace-catalog': 'marketplace',
  'education-platform': 'education',
  'community-membership': 'community',
  'nonprofit-campaign': 'community',
  'industrial-b2b': 'industrial',
  'event-conference': 'event',
  'cinematic-studio': 'portfolio',
  'creative-agency': 'portfolio',
  'portfolio-showcase': 'portfolio',
  'luxury-boutique': 'portfolio',
  'modern-brand': 'modern',
};

/** The structural layout archetype (agentArchetype) → render mode (fallback). */
const LAYOUT_ARCHETYPE_TO_MODE: Record<string, ArtRenderMode> = {
  archive: 'archive',
  editorial: 'archive',
  hospitality: 'hospitality',
  'luxury-service': 'trust-service',
  dashboard: 'product-saas',
  'data-platform': 'product-saas',
  technical: 'industrial',
  marketplace: 'marketplace',
  membership: 'education',
  community: 'community',
  event: 'event',
  portfolio: 'portfolio',
  standard: 'modern',
};

/** Ordered keyword → mode rules for the last-resort prose scan. */
const MODE_KEYWORDS: Array<[RegExp, ArtRenderMode]> = [
  [/archive|museum|catalog|catalogue|collection|library|exhibit|heritage|editorial|magazine/, 'archive'],
  [/landscap|garden|lawn|outdoor|nursery|horticultur|nature/, 'landscaping'],
  [/legal|law|lawyer|attorney|medical|clinic|health|dental|doctor|therap|finance|bank|insurance|trust/, 'trust-service'],
  [/restaurant|cafe|coffee|menu|dining|bistro|bakery|hotel|hospitality|reservation/, 'hospitality'],
  [/marketplace|e-?commerce|store|shop|storefront|retail|product\s?catalog|listing|real\s?estate|property/, 'marketplace'],
  [/event|conference|summit|festival|expo|webinar|meetup/, 'event'],
  [/course|education|academy|learn|curriculum|bootcamp|lms/, 'education'],
  [/community|nonprofit|charity|donate|campaign|membership|forum/, 'community'],
  [/industrial|manufactur|logistics|machinery|engineering|construction|b2b|supply\s?chain/, 'industrial'],
  [/portfolio|showcase|studio|creative|agency|photograph/, 'portfolio'],
  [/saas|dashboard|\bai\b|artificial\s?intelligence|software|platform|api|analytics|automation/, 'product-saas'],
];

/** Per-mode render tokens: concise proof chips + literal Tailwind class fragments.
 *  Fragments are additive (they refine rounding/edges/labels) so they never fight
 *  the visual-system radius/surface tokens; all values are dark-safe. */
interface ModeTokens {
  proof: string[];
  cardTone: string;
  proofTone: string;
  mediaTone: string;
  eyebrowTone: string;
}
const MODE_TOKENS: Record<ArtRenderMode, ModeTokens> = {
  archive: {
    proof: ['Provenance', 'Curated catalog', 'Full metadata'],
    cardTone: '!rounded-sm border-l-2',
    proofTone: 'rounded-sm',
    mediaTone: 'aspect-[3/4]',
    eyebrowTone: 'uppercase tracking-[0.3em]',
  },
  landscaping: {
    proof: ['Real projects', 'Materials & process', 'Free site visit'],
    cardTone: '!rounded-2xl overflow-hidden',
    proofTone: 'rounded-full',
    mediaTone: 'aspect-[3/2]',
    eyebrowTone: 'tracking-wide',
  },
  'trust-service': {
    proof: ['Credentials', 'Clear process', 'Confidential'],
    cardTone: '!rounded-lg shadow-none',
    proofTone: 'rounded-md border',
    mediaTone: 'aspect-[4/3]',
    eyebrowTone: 'tracking-wide',
  },
  hospitality: {
    proof: ['The menu', 'Ambience', 'Reservations'],
    cardTone: '!rounded-2xl',
    proofTone: 'rounded-full',
    mediaTone: 'aspect-[4/3]',
    eyebrowTone: 'uppercase tracking-[0.25em]',
  },
  'product-saas': {
    proof: ['Live demo', 'Security', 'Integrations'],
    cardTone: '!rounded-xl',
    proofTone: 'rounded-md',
    mediaTone: 'aspect-video',
    eyebrowTone: 'font-mono uppercase tracking-wider',
  },
  marketplace: {
    proof: ['Secure checkout', 'Easy returns', 'Real reviews'],
    cardTone: '!rounded-lg',
    proofTone: 'rounded-md',
    mediaTone: 'aspect-square',
    eyebrowTone: 'tracking-wide',
  },
  event: {
    proof: ['Speakers', 'Full agenda', 'Register'],
    cardTone: '!rounded-xl',
    proofTone: 'rounded-full',
    mediaTone: 'aspect-[4/3]',
    eyebrowTone: 'uppercase tracking-[0.25em]',
  },
  education: {
    proof: ['Curriculum', 'Outcomes', 'Enroll'],
    cardTone: '!rounded-2xl',
    proofTone: 'rounded-full',
    mediaTone: 'aspect-video',
    eyebrowTone: 'tracking-wide',
  },
  community: {
    proof: ['Join us', 'Members', 'Real impact'],
    cardTone: '!rounded-2xl',
    proofTone: 'rounded-full',
    mediaTone: 'aspect-[4/3]',
    eyebrowTone: 'tracking-wide',
  },
  industrial: {
    proof: ['Specifications', 'Certifications', 'Request a quote'],
    cardTone: '!rounded-none border',
    proofTone: 'rounded-none border',
    mediaTone: 'aspect-[4/3]',
    eyebrowTone: 'font-mono uppercase tracking-wider',
  },
  portfolio: {
    proof: ['Selected work', 'Case studies', 'Start a project'],
    cardTone: '!rounded-none',
    proofTone: 'rounded-none',
    mediaTone: 'aspect-[4/5]',
    eyebrowTone: 'uppercase tracking-[0.3em]',
  },
  modern: {
    proof: [],
    cardTone: '',
    proofTone: 'rounded-full',
    mediaTone: 'aspect-[4/3]',
    eyebrowTone: '',
  },
};

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Trim an Art Director proof directive into a concise chip
 *  ("Foreground: credentials." → "credentials"; "Show licenses as a calm…" →
 *  "licenses"). Never invents claims — only shortens existing text. */
function shortProof(raw: string): string {
  let s = clean(raw)
    .replace(/^(foreground|show|prove|surface|present)\s*[:-]?\s*/i, '')
    .replace(/\s+(as|near|for|via|with)\s+.*$/i, '')
    .replace(/[.;:]+$/, '');
  if (s.length > 32) s = clean(s.slice(0, 30)) + '…';
  return s;
}

/** A proof chip we must NOT assert on the user's behalf — an unverifiable
 *  compliance/metric/rating/award claim (SOC2, uptime, %, ★, "customer metrics",
 *  awards…). Structural words (logos, process, credentials) pass through. */
const isUnsafeProofClaim = (s: string): boolean =>
  /soc\s?2|iso\s?27001|\buptime\b|\bawards?\b|\bmetrics?\b|%|★|\b\d+(?:\.\d+)?\s*(?:stars?|k\+|\/\s?7|\/\s?24)\b/i.test(s);

/** Split a free-text trust-signals string into concise chips, dropping any that
 *  read as an unsubstantiated metric/compliance claim (kept honest — a build with
 *  only fabricated-metric trust signals falls back to structural mode labels). */
function proofFromTrust(trust: string | undefined): string[] {
  if (!trust) return [];
  return trust
    .split(/[,·|/]|\band\b|\bve\b/i)
    .map((x) => clean(x).replace(/[.;:]+$/, ''))
    .filter((x) => x.length >= 2 && x.length <= 40 && !isUnsafeProofClaim(x))
    .slice(0, 4);
}

/** Detect the render mode deterministically: explicit art archetype → layout
 *  archetype → prose keywords → 'modern'. */
function detectMode(brief: WebBuildBrief): ArtRenderMode {
  const artKey = (brief.artDesignArchetype || '').toLowerCase();
  if (artKey && ARCHETYPE_KEY_TO_MODE[artKey]) return ARCHETYPE_KEY_TO_MODE[artKey];
  const layoutKey = (brief.agentArchetype || '').toLowerCase();
  if (layoutKey && LAYOUT_ARCHETYPE_TO_MODE[layoutKey]) return LAYOUT_ARCHETYPE_TO_MODE[layoutKey];
  const hay = [brief.type, brief.style, brief.visualMood, brief.visualMetaphor, brief.artVisualSignature]
    .filter(Boolean).join(' ').toLowerCase();
  for (const [re, mode] of MODE_KEYWORDS) if (re.test(hay)) return mode;
  return 'modern';
}

/**
 * Resolve the shared render identity from the persisted brief. Pure, deterministic
 * and safe when every art field is missing (old builds → 'modern' + neutral tones).
 */
export function deriveWebBuildArtIdentity(brief: WebBuildBrief | undefined): WebBuildArtIdentity {
  const b: WebBuildBrief = brief || {};
  const mode = detectMode(b);
  const tok = MODE_TOKENS[mode] || MODE_TOKENS.modern;

  // Proof chips: the Art Director's proof rules → real trust signals → mode default.
  const fromArt = (b.artProofRules || []).map(shortProof).filter(Boolean);
  const fromTrust = proofFromTrust(b.trustSignals);
  const proofRules = (fromArt.length ? fromArt : fromTrust.length ? fromTrust : tok.proof).slice(0, 4);

  return {
    mode,
    signature: clean(b.artVisualSignature || ''),
    antiTemplate: clean(b.artAntiTemplateDiagnosis || ''),
    compositionRules: Array.isArray(b.artCompositionRules) ? b.artCompositionRules.slice(0, 6) : [],
    surfaceRules: Array.isArray(b.artSurfaceRules) ? b.artSurfaceRules.slice(0, 6) : [],
    proofRules,
    imagery: clean(b.artImageryDirection || ''),
    heroTreatment: clean(b.artHeroTreatment || ''),
    componentStyle: clean(b.artComponentStyle || ''),
    cardTone: tok.cardTone,
    proofTone: tok.proofTone,
    mediaTone: tok.mediaTone,
    eyebrowTone: tok.eyebrowTone,
  };
}

/* ── Concept-gated Motion Fit ───────────────────────────────────────────────
 * Motion must NEVER be universal. This deterministic decision says how much
 * ambient/UI motion a concept can carry before it stops improving perceived
 * quality: a data/SaaS product can pulse and scan; an archive, a law firm or a
 * clinic must stay restrained (credibility first); landscaping/hospitality get
 * only slow, organic, warm motion. Both render layers read the SAME decision so
 * Preview and generated files gate motion identically. Pure, no randomness, no
 * network, safe on missing fields. */

export type MotionIntensity = 'none' | 'subtle' | 'medium' | 'expressive';
export interface MotionFit {
  intensity: MotionIntensity;
  /** Internal (non-UI) explanation of the decision. */
  reason: string;
  /** Named motifs the renderers may use. Only motifs in AMBIENT_MOTIFS animate a
   *  background; others (reveal / hover-micro / proof-emphasis) are calm. */
  allowedMotifs: string[];
}

/** Motifs that move a BACKGROUND. If none of these is allowed, the ambient
 *  backdrop stays completely still (archive / legal / medical / marketplace). */
const AMBIENT_MOTIFS = new Set([
  'rule-scan', 'paper-drift', 'contour-drift', 'botanical', 'data-pulse', 'dot-drift',
  'blueprint-scan', 'float', 'veil', 'spotlight-drift', 'diagonal-sweep', 'frame-drift', 'mesh-drift',
]);

const MODE_MOTION: Record<ArtRenderMode, { intensity: MotionIntensity; motifs: string[] }> = {
  archive: { intensity: 'subtle', motifs: ['reveal', 'rule-scan', 'paper-drift'] },
  landscaping: { intensity: 'subtle', motifs: ['reveal', 'contour-drift', 'botanical'] },
  'trust-service': { intensity: 'subtle', motifs: ['reveal', 'proof-emphasis'] },
  hospitality: { intensity: 'subtle', motifs: ['reveal', 'veil', 'spotlight-drift'] },
  'product-saas': { intensity: 'medium', motifs: ['reveal', 'data-pulse', 'dot-drift', 'blueprint-scan', 'float'] },
  marketplace: { intensity: 'subtle', motifs: ['reveal', 'hover-micro'] },
  event: { intensity: 'medium', motifs: ['reveal', 'diagonal-sweep', 'frame-drift'] },
  education: { intensity: 'subtle', motifs: ['reveal', 'line-draw'] },
  community: { intensity: 'subtle', motifs: ['reveal', 'mesh-drift'] },
  industrial: { intensity: 'medium', motifs: ['reveal', 'blueprint-scan', 'line-draw'] },
  portfolio: { intensity: 'subtle', motifs: ['reveal', 'frame-drift'] },
  modern: { intensity: 'subtle', motifs: ['reveal'] },
};

const ORDER: MotionIntensity[] = ['none', 'subtle', 'medium', 'expressive'];
const capAt = (v: MotionIntensity, max: MotionIntensity): MotionIntensity =>
  ORDER.indexOf(v) > ORDER.indexOf(max) ? max : v;
const bumpUp = (v: MotionIntensity): MotionIntensity => ORDER[Math.min(ORDER.length - 1, ORDER.indexOf(v) + 1)];

/**
 * Derive the concept-gated Motion Fit from the brief, the shared art identity and
 * (optionally) the resolved layout plan. Deterministic and total.
 */
export function deriveMotionFit(
  brief: WebBuildBrief | undefined,
  art: WebBuildArtIdentity,
  plan?: WebBuildLayoutPlan,
): MotionFit {
  const b: WebBuildBrief = brief || {};
  const mode = art.mode;
  const base = MODE_MOTION[mode] || MODE_MOTION.modern;
  const hay = [b.type, b.style, b.visualMood, b.artVisualSignature, b.artAntiTemplateDiagnosis]
    .filter(Boolean).join(' ').toLowerCase();
  const calm = /minimal|calm|restrained|serious|academic|sober|quiet|elegant|classic|formal|clinical|legal|medical|finance|trust|historic|heritage|museum|archive/.test(hay);
  const energetic = /expressive|bold|energetic|kinetic|dynamic|vibrant|playful|immersive|animated|lively/.test(hay);

  // Credibility-first concepts can never go past subtle; organic concepts stay
  // slow and soft — energy must not override either.
  const restrained = mode === 'archive' || mode === 'trust-service';
  const organic = mode === 'landscaping' || mode === 'hospitality';

  let intensity = base.intensity;
  if (energetic && !restrained && !organic) intensity = bumpUp(intensity);
  if (plan?.motionPattern === 'kinetic' && !restrained && !organic) intensity = bumpUp(intensity);
  if (calm) intensity = capAt(intensity, 'subtle');
  if (restrained) intensity = capAt(intensity, 'subtle');
  if (organic) intensity = capAt(intensity, 'subtle');
  if (plan?.motionPattern === 'minimal') intensity = capAt(intensity, 'subtle');

  const reason = `motion:${intensity}:${mode}${restrained ? ':restrained' : organic ? ':organic' : ''}${calm ? ':calm' : ''}`;
  return { intensity, reason, allowedMotifs: base.motifs.slice() };
}

/** True when the concept permits an ANIMATED ambient background (as opposed to a
 *  completely still backdrop). Restrained / functional concepts return false. */
export function motionAmbientAllowed(fit: MotionFit): boolean {
  return fit.intensity !== 'none' && fit.allowedMotifs.some((m) => AMBIENT_MOTIFS.has(m));
}

/** The primary ambient motif for the concept (drives which backdrop animation is
 *  used), or '' when the backdrop must stay still. */
export function ambientMotif(fit: MotionFit): string {
  return fit.allowedMotifs.find((m) => AMBIENT_MOTIFS.has(m)) || '';
}
