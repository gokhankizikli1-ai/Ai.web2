/**
 * Web Build — BINDING PREMIUM VISUAL SYSTEM, TYPOGRAPHIC HIERARCHY, SURFACE LANGUAGE &
 * ANTI-AI-SLOP EXECUTION (Phase).
 *
 * ONE authoritative, additive, JSON-safe visual-system contract derived from the EXISTING
 * authoritative artifacts (identity/sector, design system, research-grounded art direction, page
 * composition, binding requirements, image coverage) and consumed by BOTH generation and acceptance.
 *
 * The upstream systems already fix sector fidelity, art direction, functional requirements, image
 * coverage and page composition — yet the coding model can still improvise typography, font scale,
 * colour roles, contrast, borders, shadows, radii, gradients, glass, buttons, controls, section
 * surfaces and decorative accents, producing the familiar cheap "AI/Tailwind" look. This contract
 * translates the existing sector identity + research direction + composition into a coherent
 * EXECUTABLE visual system (semantic colour roles, typographic roles, a small surface vocabulary,
 * coherent component chrome, a bounded detail language, readability + responsive obligations and a
 * sector-aware anti-slop policy) WITHOUT forcing one universal aesthetic.
 *
 * Acceptance is conservative and source/component/section-scoped (never global project-wide token
 * composition). Only strongly-proven collapse blocks: no coherent shared token/system source with
 * severe cross-section fragmentation; systematic bypass of declared tokens by many arbitrary values;
 * repeated generic card chrome across unrelated top-level sections; or literal severe unreadability.
 * Everything else is a manual-review warning. Functional depth defers to the binding-requirements
 * phase, composition to the page-composition phase, imagery to the image-coverage phase. Fail-open;
 * additive/optional for old builds. Deterministic (no Math.random / time / ids). Network-free.
 */
import type {
  FrontendGeneratedFile, FrontendBuilderReviewIssue, FrontendBuilderReviewSeverity, FrontendBuilderReviewCategory,
  FrontendSpecIdentity, FrontendSpecSection, FrontendSpecDesignSystem, ArtDirectionArtifact, FrontendBindingRequirements,
} from '@/lib/webBuildAgents';
import type { ResearchDirectionContract } from '@/lib/webBuildResearchDirection';
import type { ImageCoverageRequirement } from '@/lib/webBuildImageCoverage';
import type { CompositionContract } from '@/lib/webBuildComposition';
import { collectSectionUnits } from '@/lib/webBuildSectionSource';

/* ── Bounds (named, mandatory) ─────────────────────────────────────────────── */
const MAX_TEXT = 140;
const MAX_LIST = 8;
const MAX_TYPO_ROLES = 6;
const MAX_COLOR_ROLES = 16;
const MAX_SURFACE_ROLES = 7;
const MAX_COMPONENT_RULES = 12;
const MAX_PROHIBITED = 14;
const MAX_OBLIGATIONS = 8;
const MAX_DETAIL = 8;
const MAX_DERIVATION = 8;
const MAX_SECTION_IDS = 24;
const MAX_EVIDENCE = 180;
const MAX_ISSUES = 24;
const MAX_ISSUE_FILES = 4;
const MAX_FILE_SCAN = 120_000;   // per-file scan cap for global token/readability signals
const RENDER_CHAR_CEILING = 4700; // documented hard ceiling for the rendered builder block (raised to fit the bounded whole-page continuity + final-polish lines)
// Acceptance thresholds — deliberately conservative so legitimate sites never trip a hard block.
const MIN_UNITS = 4;                 // need this many correlated sections to prove a SYSTEMIC defect
const COLLAPSE_MIN = 4;              // ≥ this many unrelated sections sharing generic card chrome
const FRAG_ARBITRARY = 16;           // no token source + this many distinct arbitrary colour/radius/shadow values
const BYPASS_ARBITRARY = 12;         // tokens declared-not-consumed + this many arbitrary values
const BYPASS_HIGH = 22;              // tokens present but heavily bypassed by arbitrary values
const PROLIFERATION = 8;             // distinct arbitrary radius/shadow → proliferation warning

/* ── Public contract types (persisted, all additive/optional for old builds) ── */
export type VisualColorMode = 'light' | 'dark' | 'mixed';
export type FontStrategy = 'system-stack' | 'configured-font';
export type GradientPolicy = 'none' | 'accent-only' | 'allowed';
export type GlassPolicy = 'none' | 'justified' | 'allowed';
export type ColorRoleSource = 'explicit' | 'sector' | 'fallback';

export interface TypographyRole { name: string; usage: string; sizeHint: string; weightHint: string; }
export interface VisualColorRole { role: string; source: ColorRoleSource; token?: string; }
export interface VisualComponentRule { element: string; rule: string; }

export interface VisualTypographySystem {
  strategy: FontStrategy;
  displayStack: string;
  bodyStack: string;
  monoStack: string;
  roles: TypographyRole[];
  weightBoundary: string;
  displayScale: string;
  bodyScale: string;
  lineHeight: string;
  tracking: string;
  measure: string;
  capitalization: string;
  numeric: string;
  mobileAdjust: string;
  prohibited: string[];
}

export interface VisualSurfaceSystem {
  vocabulary: string[];
  radiusRange: string;
  shadowRoles: string[];
  borderBehavior: string;
  overlayBehavior: string;
  gradients: GradientPolicy;
  glass: GlassPolicy;
  maxSurfaceVariety: number;
}

export interface VisualAntiSlopPolicy { prohibited: string[]; justified: string[]; }

/* ── Whole-page visual CONTINUITY (Phase — makes the page read as ONE art-directed product).
 *  All fields are optional/bounded/deterministic and DERIVED from the same signals already used
 *  above (colour mode, typography, surfaces, components, sector). They describe what stays CONSTANT
 *  from hero to footer so sections stay diverse without becoming unrelated templates. Never a second
 *  token system — these are role/usage descriptions that reference the existing surface/type bands. */
export interface VisualRoleUsage { role: string; usage: string; }
export interface VisualContinuity {
  thesis: string;                 // one sentence: what visually remains constant across the whole page
  anchors: string[];              // the small set of recurring visual anchors that create recognition
  surfaceHierarchy: VisualRoleUsage[];   // base → quiet → elevated → interactive → emphasis → climax
  radiusRoles: VisualRoleUsage[];        // control / card / image-frame / feature-surface / pill
  shadowRoles: VisualRoleUsage[];        // none / separation / interactive-elevation / emphasis
  borderLogic: string;            // where borders separate vs where spacing alone does
  typographyContinuity: string[]; // heading transitions, one display treatment, numeric, eyebrow, measure, mobile
  imageTreatment: string[];       // crop family, mask/corner language, overlay, caption, full-bleed vs framed
  iconContinuity: string[];       // family, stroke/fill, size scale, container, when to omit
  ctaContinuity: string[];        // primary/secondary appearance, compact vs major, hover/focus, repeated-label avoidance
  motionContinuity: string[];     // shared easing character + timing band, what may loop, which sections host major motion
  footerResolution: string;       // how the footer completes the visual story (not a generic dark block)
  finalPolish: string[];          // concise, high-priority optical/rhythm/alignment polish obligations
}

export interface VisualSystemContract {
  version: 'visual-system-v1';
  status: 'derived' | 'legacy';
  systemThesis: string;
  colorMode: VisualColorMode;
  typography: VisualTypographySystem;
  colorRoles: VisualColorRole[];
  contrastObligations: string[];
  surfaces: VisualSurfaceSystem;
  components: VisualComponentRule[];
  detailLanguage: string[];
  responsiveObligations: string[];
  antiSlop: VisualAntiSlopPolicy;
  tokenStrategy: string;
  /** Whole-page continuity (optional; absent for legacy contracts). */
  continuity?: VisualContinuity;
  sectionIds: string[];
  /** PR #561 composition family per section id (drives the chrome-collapse role-contradiction check;
   *  empty when no composition contract is available ⇒ chrome-collapse fails open to a warning). */
  sectionFamilies: Record<string, string>;
  /* ── Truthful consumption trace. ── */
  derivationBasis: string[];
  contractPersistedInSpecification: boolean;
  contractRenderedToFrontendBuilder: boolean;
  contractUsedByAcceptance: boolean;
  agentsActuallyConsumingContract: string[];
  reasons: string[];
}

/* ── Small pure helpers ────────────────────────────────────────────────────── */
function clip(s: unknown, n = MAX_TEXT): string { return (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim().slice(0, n); }
function uniq<T>(a: T[]): T[] { return [...new Set(a)]; }
function lc(s: unknown): string { return (typeof s === 'string' ? s : '').toLowerCase(); }

const SYSTEM_SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const SYSTEM_SERIF = "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif";
const SYSTEM_MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

const SOFTWARE_SECTORS = new Set(['ai-saas', 'marketplace']);
const IMAGE_SECTORS = new Set(['travel-tourism', 'restaurant-hospitality', 'real-estate', 'portfolio-agency', 'furniture-interiors', 'jewelry', 'automotive-dealership', 'landscaping']);

/* ────────────────────────────────────────────────────────────────────────────
 * DERIVATION — one binding visual-system contract from existing authoritative artifacts.
 * ──────────────────────────────────────────────────────────────────────────── */
export interface VisualSystemInput {
  identity: FrontendSpecIdentity;
  designSystem?: FrontendSpecDesignSystem;
  artDirection?: ArtDirectionArtifact;
  research?: ResearchDirectionContract;
  composition?: CompositionContract;
  binding?: FrontendBindingRequirements;
  imageCoverage?: ImageCoverageRequirement;
  sections?: FrontendSpecSection[];
  prompt?: string;
}

/** Conservatively read a background-ish colour token to infer light/dark. */
function isDarkHex(v: string): boolean {
  const m = /#([0-9a-fA-F]{6})/.exec(v || '');
  if (!m) return /\b(black|ink|midnight|onyx|obsidian|charcoal|slate-9|zinc-9|neutral-9|gray-9|graphite)\b/i.test(v || '');
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 96; // relative luminance, conservative
}

function deriveColorMode(ds: FrontendSpecDesignSystem | undefined, ad: ArtDirectionArtifact | undefined, research: ResearchDirectionContract | undefined, prompt: string): VisualColorMode {
  const hay = `${prompt} ${lc(ds?.selectedVisualDirection)} ${lc(ds?.paletteDecision)} ${lc(ad?.visualMood)} ${lc(research?.artDirection?.visualThesis)}`;
  const wantsDark = /\bdark\b|midnight|noir|obsidian|black background|dark mode/.test(hay);
  const wantsLight = /\blight\b|airy|bright|pale|ivory|off-white|editorial white|light mode/.test(hay);
  const tokens = ds?.colorTokens || {};
  const bgKey = Object.keys(tokens).find((k) => /^(bg|background|canvas|page|base|surface)$/i.test(k) || /background|canvas/i.test(k));
  const bgDark = bgKey ? isDarkHex(tokens[bgKey] || '') : false;
  if (wantsDark && wantsLight) return 'mixed';
  if (wantsDark || (!wantsLight && bgDark)) return 'dark';
  return 'light';
}

const COLOR_ROLE_KEYS: Array<{ role: string; keys: RegExp }> = [
  { role: 'canvas', keys: /^(bg|background|canvas|page|base)$/i },
  { role: 'surface', keys: /^(surface|card|panel)$/i },
  { role: 'surfaceElevated', keys: /^(elevated|raised|surface2|surfacealt)$/i },
  { role: 'textStrong', keys: /^(foreground|text|heading|textstrong|ink|title)$/i },
  { role: 'textBody', keys: /^(body|textbody|content|copy)$/i },
  { role: 'textMuted', keys: /^(muted|subtle|secondarytext|mutedtext|caption)$/i },
  { role: 'accentPrimary', keys: /^(accent|primary|brand)$/i },
  { role: 'accentSecondary', keys: /^(accent2|secondary|brand2)$/i },
  { role: 'border', keys: /^(border|divider|line|outline)$/i },
  { role: 'actionPrimary', keys: /^(action|cta|button|primaryaction)$/i },
  { role: 'success', keys: /^(success|positive|trust)$/i },
  { role: 'destructive', keys: /^(danger|destructive|error|warning|negative)$/i },
];

function deriveColorRoles(ds: FrontendSpecDesignSystem | undefined): VisualColorRole[] {
  const tokens = ds?.colorTokens || {};
  const explicit = /(explicit|user|requested|brand-provided|literal)/i.test(ds?.paletteDecision || '');
  const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const entries = Object.keys(tokens);
  const out: VisualColorRole[] = [];
  for (const { role, keys } of COLOR_ROLE_KEYS) {
    const key = entries.find((k) => keys.test(norm(k)) || keys.test(k));
    const token = key ? clip(tokens[key], 40) : undefined;
    out.push({ role, source: token ? (explicit ? 'explicit' : 'sector') : 'fallback', ...(token ? { token } : {}) });
    if (out.length >= MAX_COLOR_ROLES) break;
  }
  // Always-present semantic roles even without concrete tokens (focus/overlay/selection).
  for (const role of ['focusRing', 'overlay', 'selection']) {
    if (out.length >= MAX_COLOR_ROLES) break;
    out.push({ role, source: 'fallback' });
  }
  return out.slice(0, MAX_COLOR_ROLES);
}

function deriveTypography(ds: FrontendSpecDesignSystem | undefined, ad: ArtDirectionArtifact | undefined): VisualTypographySystem {
  const tp = ad?.typographyProfile;
  const hay = `${lc(ds?.typographyDirection)} ${lc(ds?.typographyDecision)} ${lc(tp?.headingStyle)} ${lc(tp?.bodyStyle)} ${lc(ad?.typographyDirection)}`;
  const serifHeading = /serif|editorial|didone|literary|heritage|classic/.test(hay) && !/sans/.test(hay);
  const serifBody = /serif body|reading serif|book serif/.test(hay);
  const scale = lc(tp?.scale);
  const displayScale = /dramatic/.test(scale) ? 'large display step (clamp ~2.5rem→4rem), reserved for the hero'
    : /editorial/.test(scale) ? 'editorial display step (clamp ~2rem→3.25rem)'
    : /compact/.test(scale) ? 'restrained display step (~1.75rem→2.5rem)'
    : 'balanced display step (~2rem→3rem)';
  return {
    strategy: 'system-stack',
    displayStack: serifHeading ? SYSTEM_SERIF : SYSTEM_SANS,
    bodyStack: serifBody ? SYSTEM_SERIF : SYSTEM_SANS,
    monoStack: SYSTEM_MONO,
    roles: [
      { name: 'display', usage: 'hero headline only', sizeHint: displayScale, weightHint: /light|thin/.test(hay) ? 'medium 500' : 'semibold 600–700' },
      { name: 'h2', usage: 'section titles', sizeHint: '~1.5rem→2rem', weightHint: 'semibold 600' },
      { name: 'h3', usage: 'sub-section / card titles', sizeHint: '~1.125rem→1.375rem', weightHint: 'medium 500–600' },
      { name: 'body', usage: 'paragraphs', sizeHint: '1rem–1.0625rem', weightHint: 'regular 400' },
      { name: 'label', usage: 'eyebrow / caption / UI labels', sizeHint: '0.75rem→0.875rem', weightHint: 'medium 500' },
    ].slice(0, MAX_TYPO_ROLES),
    weightBoundary: 'use 2–3 weights total; do not give every heading the same size+weight',
    displayScale,
    bodyScale: 'body 16–17px; do not shrink body below 15px on desktop',
    lineHeight: 'body line-height 1.5–1.7; headings 1.05–1.25',
    tracking: /geometric|technical|mono/.test(hay) ? 'slight negative tracking on display; normal on body' : 'normal tracking; avoid wide letter-spacing on body',
    measure: 'body measure 60–75ch; never full-viewport paragraph width',
    capitalization: 'sentence case for headings; UPPERCASE only for short eyebrow/label text',
    numeric: /pricing|data|dashboard|finance|metric/.test(hay) ? 'tabular-nums for aligned figures' : 'default numerals',
    mobileAdjust: 'reduce display one step on mobile; keep body ≥16px; keep line-height',
    prohibited: uniq([
      'one oversized gradient headline as the only hierarchy',
      'every heading rendered at the same size and weight',
      'long body copy set in all-caps or wide tracking',
      'ultra-thin (100–200) weights for body text',
      'more than two font families',
      ...(serifHeading ? [] : ['a decorative script/serif display that fights the sans body']),
    ]).slice(0, MAX_LIST),
  };
}

function deriveSurfaces(ds: FrontendSpecDesignSystem | undefined, ad: ArtDirectionArtifact | undefined, research: ResearchDirectionContract | undefined, isSoftware: boolean, prompt: string): VisualSurfaceSystem {
  const hay = `${prompt} ${lc(ds?.selectedVisualDirection)} ${(ds?.surfaceRules || []).join(' ').toLowerCase()} ${lc(ad?.layoutFeeling)} ${lc(research?.artDirection?.compositionModel)}`;
  const avoid = `${(ds?.mustAvoid || []).join(' ')} ${(ad?.avoid || []).join(' ')}`.toLowerCase();
  const sharp = /sharp|square|hard edge|brutalist|editorial flat/.test(hay);
  const pill = /pill|fully rounded|round buttons/.test(hay);
  const soft = /soft|rounded|friendly|approachable/.test(hay);
  const radiusRange = sharp ? '0–4px (sharp, editorial)'
    : pill ? 'controls pill; cards/containers 12–20px'
    : soft ? '10–20px (soft, consistent)'
    : '6–14px (subtle, consistent)';
  const wantsGradient = /gradient/.test(hay);
  const wantsGlass = /glass|frosted|backdrop|blur/.test(hay);
  const gradients: GradientPolicy = /no gradient|avoid gradient/.test(avoid) ? 'none' : (isSoftware && wantsGradient) ? 'allowed' : 'accent-only';
  const glass: GlassPolicy = /no glass|avoid glass|no glassmorphism/.test(avoid) ? 'none' : wantsGlass ? 'allowed' : 'justified';
  return {
    vocabulary: uniq([
      'flat (default section surface)',
      'bordered (grouped content)',
      'softly-raised (interactive cards)',
      'strongly-elevated (one focal moment)',
      'tinted (section rhythm accent)',
      'media-backed (imagery sections)',
      ...(glass !== 'none' ? ['glass (one justified surface, e.g. sticky nav)'] : []),
    ]).slice(0, MAX_SURFACE_ROLES),
    radiusRange,
    shadowRoles: uniq([
      'rest: none or a single soft ambient shadow',
      'raised: one consistent card shadow',
      'overlay: a slightly stronger shadow for popovers/menus',
    ]).slice(0, MAX_LIST),
    borderBehavior: 'one consistent 1px border token for dividers/cards; do not mix many border colours',
    overlayBehavior: 'text over imagery needs a real scrim/gradient or a protected panel; never raw text on a busy photo',
    gradients,
    glass,
    maxSurfaceVariety: 4,
  };
}

function deriveComponents(comp: CompositionContract | undefined, colorMode: VisualColorMode): VisualComponentRule[] {
  const usesCards = !comp || comp.sections.some((s) => s.family === 'feature-mosaic' || s.family === 'catalog-index' || s.family === 'comparison-band');
  const rules: VisualComponentRule[] = [
    { element: 'primaryButton', rule: 'solid action colour, readable label, clear hover/active, visible focus ring' },
    { element: 'secondaryButton', rule: 'outline or tinted; same height/radius as primary; never a second solid competing CTA' },
    { element: 'textAction', rule: 'link-style with underline or clear affordance; keeps focus/hover states' },
    { element: 'iconButton', rule: 'min 40–44px target, aria-label, visible focus; not a bare clickable div' },
    { element: 'input', rule: 'consistent height/radius/border with textAction; visible label; clear focus ring' },
    { element: 'select', rule: 'matches input chrome; accessible; no custom control without keyboard support' },
    { element: 'nav', rule: 'one coherent header; consistent link treatment; clear active state' },
    { element: 'footer', rule: 'quiet surface; grouped links; consistent muted text token' },
    ...(usesCards ? [{ element: 'card', rule: 'one shared card chrome (radius+border+shadow); used only where composition calls for cards' }] : []),
    { element: 'badge', rule: 'only for real semantic status; one shape; not scattered decoration' },
    { element: 'icon', rule: 'one library and one stroke/fill style throughout; consistent size steps' },
    { element: 'states', rule: `every interactive element defines hover/active/disabled and a visible focus-visible ring${colorMode === 'dark' ? ' (with dark-mode contrast)' : ''}` },
  ];
  return rules.slice(0, MAX_COMPONENT_RULES);
}

function deriveAntiSlop(identity: FrontendSpecIdentity, ds: FrontendSpecDesignSystem | undefined, ad: ArtDirectionArtifact | undefined, isSoftware: boolean, surfaces: VisualSurfaceSystem, colorMode: VisualColorMode): VisualAntiSlopPolicy {
  const prohibited: string[] = [];
  if (!(isSoftware && surfaces.gradients === 'allowed')) prohibited.push('purple/blue gradient text used as the default headline treatment');
  prohibited.push('decorative glow blobs floating behind content');
  if (surfaces.glass !== 'allowed') prohibited.push('glassmorphism applied to every card');
  prohibited.push('pills/badges scattered across sections without semantic purpose');
  prohibited.push('every container rounded-2xl/3xl with an identical border+shadow');
  prohibited.push('random unrelated radius/shadow/colour values per section');
  prohibited.push('long uppercase letter-spaced text used as body copy');
  prohibited.push('icon-in-circle used as the repeated dominant motif across the page');
  prohibited.push('fake logos or unauthorised "trusted by" customer marks');
  if (!isSoftware) prohibited.push('decorative dashboard/product-UI mockups for a non-software business');
  prohibited.push('an oversized headline paired with weak content hierarchy');
  prohibited.push('muted text so low-contrast it is effectively invisible');
  prohibited.push('default unstyled browser form controls');
  // Merge explicit upstream avoid signals (bounded, deduped).
  for (const a of [...(ds?.mustAvoid || []), ...(ds?.templateTrapsToAvoid || []), ...(ad?.avoid || [])]) {
    const c = clip(a, 90); if (c && prohibited.length < MAX_PROHIBITED) prohibited.push(c);
  }
  const justified: string[] = [];
  if (colorMode === 'dark') justified.push('dark theme (with proven text contrast)');
  if (surfaces.gradients === 'allowed') justified.push('gradients where the direction calls for them');
  if (surfaces.glass === 'allowed') justified.push('one/limited glass surface');
  if (IMAGE_SECTORS.has(identity.sector || '')) justified.push('full-bleed photography');
  if (isSoftware) justified.push('a real product-UI/dashboard surface');
  return { prohibited: uniq(prohibited).slice(0, MAX_PROHIBITED), justified: uniq(justified).slice(0, MAX_LIST) };
}

/* ── Whole-page continuity derivation. Category-aware (so coherence ≠ uniformity): the anchor,
 *  image, motion and footer language diverge by sector bucket + colour mode + type strategy, all
 *  reusing signals already derived above. Bounded + deterministic; no new tokens invented. ── */
type VisualBucket = 'software' | 'image-led' | 'editorial-neutral';
function visualBucket(sector: string, isSoftware: boolean): VisualBucket {
  if (isSoftware) return 'software';
  if (IMAGE_SECTORS.has(sector)) return 'image-led';
  return 'editorial-neutral';
}

function deriveContinuity(
  sector: string, isSoftware: boolean, colorMode: VisualColorMode,
  typography: VisualTypographySystem, surfaces: VisualSurfaceSystem,
): VisualContinuity {
  const bucket = visualBucket(sector, isSoftware);
  const serifDisplay = typography.displayStack === SYSTEM_SERIF;
  const radiusBand = surfaces.radiusRange;
  const sharp = /sharp|0–4px/.test(radiusBand);
  const pill = /pill/.test(radiusBand);

  // Sector-bucket presets keep coherence category-true instead of universal.
  const accent = bucket === 'software' ? 'one connective line/node motif (the product logic made visible)'
    : bucket === 'image-led' ? 'one thin editorial rule + a consistent full-bleed image frame'
    : 'one restrained accent bar/underline used only to mark emphasis';
  const imageLang = bucket === 'image-led'
    ? ['full-bleed or large framed photography with ONE consistent soft-corner mask', 'editorial crop that keeps the subject; no random per-section aspect ratios', 'a single caption style (small label token), same placement each time', 'consistent photographic colour treatment (one grade across the page)']
    : bucket === 'software'
    ? ['framed product/UI surfaces with ONE consistent inset + corner radius', 'screens/diagrams share one device/frame treatment', 'imagery is functional, not decorative stock; one consistent aspect family', 'overlays/annotations use the accent role, not new colours']
    : ['framed imagery with ONE consistent corner radius from the surface band', 'one crop family; keep the subject; avoid mixed circular/rounded/hard masks', 'a single caption style, same placement', 'one photographic treatment; no per-section filters'];
  const motionChar = bucket === 'software' ? 'swift, precise easing (ease-out, ~150–260ms) shared by all micro-interactions'
    : bucket === 'image-led' ? 'slow, cinematic easing (~360–680ms) for reveals; restrained micro-interactions'
    : 'calm, confident easing (ease-out, ~200–360ms) shared across the page';
  const footer = colorMode === 'dark'
    ? `the footer resolves to a QUIET variant of the canvas (not a new pure-black block), echoes ${bucket === 'image-led' ? 'the hero image treatment' : 'the hero accent'}, keeps the muted text token, groups links, and ends with one restrained final CTA`
    : `the footer resolves to a quiet tinted surface that echoes ${bucket === 'image-led' ? 'the hero image treatment' : 'the hero accent'} rather than a generic dark block, keeps the muted text token, groups links, and ends with one restrained final CTA`;

  const surfaceHierarchy: VisualRoleUsage[] = [
    { role: 'base canvas', usage: 'the page background; most sections sit directly on it' },
    { role: 'quiet section', usage: 'a subtle tint for rhythm — used sparingly, not every other section' },
    { role: 'elevated content', usage: 'grouped cards/panels; ONE shared chrome; not every section' },
    { role: 'interactive surface', usage: 'controls/inputs/demos; one consistent field treatment' },
    { role: 'emphasis surface', usage: 'a single focal moment (the visual climax) — used once' },
  ];
  const radiusRoles: VisualRoleUsage[] = [
    { role: 'control', usage: pill ? 'pill for buttons/inputs' : `tight end of the ${radiusBand} band` },
    { role: 'card', usage: sharp ? 'near-square, matching the editorial band' : `mid of the ${radiusBand} band, shared by all cards` },
    { role: 'image-frame', usage: sharp ? '0–2px' : `matches card radius so imagery and panels agree` },
    { role: 'feature-surface', usage: `upper end of the ${radiusBand} band, for the one focal surface only` },
    { role: 'pill/badge', usage: 'fully rounded, reserved for small status labels' },
  ];
  const shadowRoles: VisualRoleUsage[] = [
    { role: 'none', usage: 'default; flat sections rely on spacing, not shadow' },
    { role: 'separation', usage: 'a single soft ambient shadow to lift grouped content' },
    { role: 'interactive-elevation', usage: 'one slightly stronger shadow for hover/menus/popovers' },
    { role: 'emphasis', usage: 'the strongest shadow, reserved for the one focal surface' },
  ];
  const typographyContinuity = [
    'display type appears ONCE (the hero); section titles all use the h2 role at one size',
    'at most one display treatment page-wide; do not reinvent heading style per section',
    `${typography.numeric}; eyebrow/label text shares one style token everywhere`,
    `body keeps a ${typography.measure.replace(/^body measure /, '')} measure and left alignment by default (centre only hero/CTA)`,
    'mobile: reduce display one step, keep body ≥16px and the same hierarchy',
  ];
  const iconContinuity = [
    'ONE icon library and one stroke/fill style across the whole page',
    'a small consistent size scale (e.g. 16/20/24); icons baseline-align with their text',
    'icons sit in consistent containers or none — not circle-badged in one section and bare in another',
    'omit icons where a number, image or the accent motif communicates better',
  ];
  const ctaContinuity = [
    'ONE primary button appearance (colour/height/radius) from hero to footer; never a second competing solid CTA in a section',
    'secondary CTA is the same height/radius, outline or tinted',
    'a compact nav CTA uses the same colour at a smaller size — not a different style',
    'consistent hover/focus response; avoid repeating the identical CTA label in adjacent sections',
  ];
  const finalPolish = [
    'consistent container max-width and page gutters across every section (incl. the footer)',
    'a shared vertical rhythm: comparable section padding; headings spaced from body, not glued to it',
    'card padding follows a hierarchy (denser utility, roomier feature) — not one identical pad everywhere',
    'buttons share one height/padding; inputs share one height; borders share one 1px token',
    'consistent focus-ring; numeric columns align (tabular where shown); image aspect/crop consistent',
    'no random 1px/2px borders or mixed radii; decorations must not clip on mobile; avoid oversized empty mobile gaps',
  ];

  return {
    thesis: clip(`${colorMode} canvas, ${serifDisplay ? 'editorial-serif display over ' : ''}one type system, ${accent}, and one shared surface/radius/shadow language hold every section together from hero to footer.`, MAX_TEXT),
    anchors: uniq([
      accent,
      `one line/border treatment: ${surfaces.borderBehavior.replace(/^one /, '')}`,
      bucket === 'image-led' ? 'one image-mask family' : 'one card chrome (radius+border+shadow)',
      'one eyebrow/label style',
      'one signature section-padding rhythm',
    ]).slice(0, MAX_LIST),
    surfaceHierarchy: surfaceHierarchy.slice(0, MAX_SURFACE_ROLES),
    radiusRoles: radiusRoles.slice(0, MAX_LIST),
    shadowRoles: shadowRoles.slice(0, MAX_LIST),
    borderLogic: clip(`use borders for grouped/interactive content and dividers; separate major sections with spacing and surface tint, not stacked borders; ${surfaces.borderBehavior}`, MAX_TEXT),
    typographyContinuity: typographyContinuity.slice(0, MAX_LIST),
    imageTreatment: imageLang.slice(0, MAX_LIST),
    iconContinuity: iconContinuity.slice(0, MAX_LIST),
    ctaContinuity: ctaContinuity.slice(0, MAX_LIST),
    motionContinuity: [
      `shared easing character: ${motionChar}`,
      'reserve MAJOR motion for the hero and one demonstration; other sections use quiet entrance/hover only',
      'only ambient hero/background motion may loop; never loop body content; respect prefers-reduced-motion (see motion-execution)',
      'interaction feedback (hover/press/focus) is identical across all controls',
    ].slice(0, MAX_LIST),
    footerResolution: clip(footer, MAX_TEXT),
    finalPolish: finalPolish.slice(0, MAX_LIST),
  };
}

export function deriveVisualSystemContract(input: VisualSystemInput): VisualSystemContract | undefined {
  const identity = input.identity || ({} as FrontendSpecIdentity);
  const ds = input.designSystem;
  const ad = input.artDirection;
  const research = input.research;
  const comp = input.composition;
  const sectionIds = uniq((comp?.sections?.map((s) => s.id) || (input.sections || []).map((s) => s.id)).filter(Boolean)).slice(0, MAX_SECTION_IDS);
  // Composition family per section (from PR #561), used only to judge whether repeated card chrome
  // contradicts DISTINCT non-card roles. Empty when no composition contract ⇒ chrome-collapse warns.
  const sectionFamilies: Record<string, string> = {};
  for (const s of (comp?.sections || []).slice(0, MAX_SECTION_IDS)) if (s.id) sectionFamilies[s.id] = s.family;
  // Require at least one design source; otherwise stay legacy (absent ⇒ legacy behavior downstream).
  if (!ds && !ad && !research && sectionIds.length === 0) return undefined;

  const sector = clip(identity.sector || research?.sector || 'general', 40);
  const isSoftware = SOFTWARE_SECTORS.has(sector) || identity.classificationBasis === 'product-concept';
  const prompt = lc(input.prompt);
  const colorMode = deriveColorMode(ds, ad, research, prompt);
  const typography = deriveTypography(ds, ad);
  const colorRoles = deriveColorRoles(ds);
  const surfaces = deriveSurfaces(ds, ad, research, isSoftware, prompt);
  const components = deriveComponents(comp, colorMode);
  const antiSlop = deriveAntiSlop(identity, ds, ad, isSoftware, surfaces, colorMode);
  const continuity = deriveContinuity(sector, isSoftware, colorMode, typography, surfaces);

  const contrastObligations = [
    'strong, body and muted text must each stay readable on their assigned surface',
    'interactive text/controls must not rely on low-contrast colour alone',
    'text over imagery needs a real scrim/overlay or a protected panel',
    'body keeps a 60–75ch measure and ≥1.5 line-height',
    'focus indicators must be visible on every interactive element',
    'muted text must not drop below a legible contrast; never near-transparent body copy',
    'mobile body text must not shrink into decorative microcopy',
  ].slice(0, MAX_OBLIGATIONS);

  const responsiveObligations = [
    'reduce display type one step on mobile; keep body ≥16px and line-height',
    'buttons/controls become full-width and ≥44px targets on narrow screens',
    'card/surface padding relaxes on mobile; no clipped fixed heights',
    'decorative ornament and eyebrow text may drop on mobile, essential content never does',
    'text-over-image keeps its scrim/protected placement on mobile',
    'icon-only controls keep an accessible label at every breakpoint',
  ].slice(0, MAX_OBLIGATIONS);

  const detailLanguage = [
    'one icon library + one stroke/fill style throughout',
    'a single recognizable accent motif, not five unrelated ones',
    'consistent corner radius and separator treatment',
    'eyebrow/label text shares one style; not reinvented per section',
    'image masks/crops keep the subject and one consistent shape language',
    'decoration is subtractive: remove ornament that does not earn its place',
  ].slice(0, MAX_DETAIL);

  const tokenStrategy = 'Define ONE local visual-token source (CSS custom properties on :root in the existing global stylesheet, or the project’s existing design-system/theme module) for colour roles, radius, shadow, spacing and type scale, then consume those tokens everywhere. Do not scatter arbitrary hex/px/radius/shadow values. Work with the existing React/Vite/Tailwind stack; do not add Tailwind config changes, new packages or runtime font requests.';

  const derivationBasis = uniq([
    ds ? 'designSystem' : '',
    ad ? 'artDirection' : '',
    research ? 'researchDirection' : '',
    comp ? 'composition' : '',
    input.binding ? 'bindingRequirements' : '',
    input.imageCoverage ? 'imageCoverage' : '',
    sectionIds.length ? 'architectureSections' : '',
    input.prompt ? 'userPrompt' : '',
  ].filter(Boolean)).slice(0, MAX_DERIVATION);

  const reasons: string[] = [];
  reasons.push(`colour mode: ${colorMode} (${colorRoles.some((r) => r.source !== 'fallback') ? 'from design-system tokens' : 'fallback semantic roles'})`);
  if (surfaces.gradients === 'allowed') reasons.push('gradients permitted by sector/direction');
  if (surfaces.glass === 'allowed') reasons.push('glass permitted by explicit direction');

  return {
    version: 'visual-system-v1', status: 'derived',
    systemThesis: clip(ds?.designThesis || ds?.visualSignature || research?.artDirection?.visualThesis || ad?.visualMetaphor || `${clip(identity.primaryConcept || identity.siteType || sector, 60)}: a coherent, sector-true visual system`, MAX_TEXT),
    colorMode, typography, colorRoles, contrastObligations, surfaces, components, detailLanguage, responsiveObligations, antiSlop, tokenStrategy,
    continuity,
    sectionIds, sectionFamilies,
    derivationBasis,
    contractPersistedInSpecification: true,
    contractRenderedToFrontendBuilder: true,
    contractUsedByAcceptance: true,
    agentsActuallyConsumingContract: [],
    reasons: reasons.slice(0, MAX_LIST),
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * RENDER — one compact BINDING PREMIUM VISUAL SYSTEM block. Hard-bounded.
 * ──────────────────────────────────────────────────────────────────────────── */
/** Compact whole-page continuity + final-polish lines (bounded; folded into the visual-system block
 *  so the builder gets coherence direction without a second 2–3 KB block). Empty for legacy. */
function renderContinuityLines(c: VisualContinuity | undefined): string[] {
  if (!c) return [];
  const roles = (arr: VisualRoleUsage[], n: number) => arr.slice(0, n).map((x) => x.role).join(' → ');
  return [
    `WHOLE-PAGE CONTINUITY (ONE art-directed product hero→footer; keep sections diverse but unmistakably one design): ${clip(c.thesis, 150)}`,
    `  Anchors: ${c.anchors.slice(0, 4).map((a) => clip(a, 60)).join('; ')}.`,
    `  Surface hierarchy (do NOT elevate every section): ${roles(c.surfaceHierarchy, 5)}. Radius roles: ${roles(c.radiusRoles, 5)}. Shadows: ${roles(c.shadowRoles, 4)}.`,
    `  Type: ${c.typographyContinuity.slice(0, 2).map((x) => clip(x, 90)).join('; ')}. Icons/CTAs: ${clip(c.iconContinuity[0] || '', 60)}; ${clip(c.ctaContinuity[0] || '', 80)}.`,
    `  Images: ${c.imageTreatment.slice(0, 2).map((x) => clip(x, 70)).join('; ')}. Motion: ${clip(c.motionContinuity[0] || '', 90)}.`,
    `  Footer: ${clip(c.footerResolution, 140)}.`,
    `  FINAL POLISH: ${c.finalPolish.slice(0, 5).map((x) => clip(x, 80)).join('; ')}.`,
  ];
}

export function renderVisualSystemBlock(contract: VisualSystemContract | undefined): string[] {
  if (!contract || contract.status !== 'derived') return [];
  const t = contract.typography;
  const s = contract.surfaces;
  const roleLine = contract.colorRoles.map((r) => `${r.role}${r.token ? `=${r.token}` : ''}`).slice(0, MAX_COLOR_ROLES).join(', ');
  const typoRoles = t.roles.map((r) => `${r.name}(${r.sizeHint}/${r.weightHint})`).slice(0, MAX_TYPO_ROLES).join(' · ');
  // Continuity now carries icon/CTA/typography/detail direction, so the base block renders a tighter
  // component set + shorter token strategy and drops the standalone detail-language line (Phase 8 —
  // shorten/dedupe rather than blindly append). Continuity supplies the rest without duplication.
  const comps = contract.components.map((c) => `${c.element}: ${c.rule}`).slice(0, 5);
  const out = [
    'BINDING PREMIUM VISUAL SYSTEM:',
    `Visual thesis: ${clip(contract.systemThesis, MAX_TEXT)} · colour mode: ${contract.colorMode}`,
    `TOKEN STRATEGY: ${clip(contract.tokenStrategy, 220)}`,
    `Typography (${t.strategy}): display-stack "${t.displayStack}"; body-stack "${t.bodyStack}". Roles: ${typoRoles}.`,
    `  ${t.weightBoundary}; ${t.bodyScale}; ${t.lineHeight}; ${t.measure}; ${t.capitalization}; mobile: ${t.mobileAdjust}.`,
    `  Typography prohibits: ${t.prohibited.slice(0, 5).join('; ')}.`,
    `Colour roles (semantic, define once, reuse): ${roleLine}.`,
    `Contrast/readability: ${contract.contrastObligations.slice(0, 5).join('; ')}.`,
    `Surfaces: ${s.vocabulary.slice(0, 6).join(' · ')}. Radius ${s.radiusRange}. Shadows: ${s.shadowRoles.slice(0, 3).join('; ')}. Borders: ${s.borderBehavior}. Overlay: ${s.overlayBehavior}.`,
    `  Gradients: ${s.gradients}. Glass: ${s.glass}. Max distinct surface treatments: ${s.maxSurfaceVariety}.`,
    // Continuity is the primary coherence payload — render it BEFORE the verbose component/anti-slop tail
    // so it always survives the character ceiling (the tail truncates as it did before this sprint).
    ...renderContinuityLines(contract.continuity),
    'Component chrome:',
    ...comps.map((c) => `  - ${c}`),
    `Responsive: ${contract.responsiveObligations.slice(0, 5).join('; ')}.`,
    `ANTI-SLOP — do NOT: ${contract.antiSlop.prohibited.slice(0, 8).join('; ')}.`,
    ...(contract.antiSlop.justified.length ? [`Allowed where justified: ${contract.antiSlop.justified.slice(0, 6).join('; ')}.`] : []),
    'Implement ONE coherent visual system across every section; vary rhythm without inventing a new visual language per section. Keep semantic DOM order and accessibility.',
    '',
  ];
  // Enforce the documented character ceiling defensively (never inflate generation cost).
  let total = 0;
  const bounded: string[] = [];
  for (const line of out) {
    total += line.length + 1;
    if (total > RENDER_CHAR_CEILING) break;
    bounded.push(line);
  }
  return bounded;
}

/* ────────────────────────────────────────────────────────────────────────────
 * ACCEPTANCE — conservative, source/component/section-scoped. Only strongly proven
 * visual-system collapse blocks; everything else is manual-review warning. Fail-open.
 * ──────────────────────────────────────────────────────────────────────────── */
export type VisualSystemIssueCode =
  | 'visual-system-no-coherent-tokens'
  | 'visual-system-tokens-bypassed'
  | 'visual-system-chrome-collapse'
  | 'visual-system-unreadable-body'
  | 'visual-system-contrast-risk'
  | 'visual-system-text-over-image'
  | 'visual-system-radius-shadow-proliferation'
  | 'visual-system-gradient-glass-pill-repetition'
  | 'visual-system-focus-missing'
  | 'visual-system-mobile-typography-risk'
  | 'visual-system-cta-inconsistent'
  | 'visual-system-footer-discontinuity'
  | 'visual-system-slop-pattern';

export interface VisualSystemIssue {
  code: VisualSystemIssueCode;
  severity: FrontendBuilderReviewSeverity;
  label: string;
  files: string[];
  evidence: string;
  repairInstruction: string;
}
export interface VisualSystemAcceptanceResult {
  status: 'pass' | 'warning' | 'fail';
  legacy: boolean;
  analyzedSectionCount: number;
  tokenSource: 'css-vars' | 'theme-module' | 'semantic-tailwind' | 'none';
  tokenConsumed: boolean;
  arbitraryValueCount: number;
  chromeRepeatSectionCount: number;
  readabilityFindingCount: number;
  responsiveFindingCount: number;
  distinctPrimaryButtonStyleCount: number;
  footerContinuity: 'ok' | 'missing' | 'disconnected' | 'unknown';
  issues: VisualSystemIssue[];
}
const LEGACY_VISUAL: VisualSystemAcceptanceResult = {
  status: 'pass', legacy: true, analyzedSectionCount: 0, tokenSource: 'none', tokenConsumed: false,
  arbitraryValueCount: 0, chromeRepeatSectionCount: 0, readabilityFindingCount: 0, responsiveFindingCount: 0,
  distinctPrimaryButtonStyleCount: 0, footerContinuity: 'unknown', issues: [],
};

function capEv(s: string): string { const t = (s || '').replace(/\s+/g, ' ').trim(); return t.length > MAX_EVIDENCE ? t.slice(0, MAX_EVIDENCE) : t; }
function isCode(path: string): boolean { return /\.(?:t|j)sx?$/.test(path) && !/\.(?:config|test|spec)\./.test(path) && !/(?:tailwind|vite|postcss|eslint)\.config/.test(path); }
function isStyle(path: string): boolean { return /\.css$/.test(path); }

/** Distinct arbitrary colour/radius/shadow values (the AI-slop signal), normalized. */
function collectArbitrary(content: string, into: Set<string>): number {
  let n = 0;
  const push = (v: string) => { const k = v.replace(/\[|\]/g, '').replace(/\s+/g, ''); if (k) { if (!into.has(k)) n += 1; into.add(k); } };
  for (const m of content.match(/\[#[0-9a-fA-F]{3,8}\]/g) || []) push(m);
  for (const m of content.match(/rounded(?:-[a-z]+)?-\[[^\]]{1,40}\]/g) || []) push(`r:${m}`);
  for (const m of content.match(/shadow(?:-[a-z]+)?-\[[^\]]{1,60}\]/g) || []) push(`s:${m}`);
  for (const m of content.match(/(?:bg|text|border|fill|stroke|from|to|via)-\[#[0-9a-fA-F]{3,8}\]/g) || []) push(m);
  return n;
}

// PR #561 composition families that LEGITIMATELY use repeated card chrome (never a collapse when shared).
const CARD_JUSTIFIED_FAMILIES = new Set(['feature-mosaic', 'catalog-index', 'comparison-band', 'gallery-strip', 'proof-ledger']);

/** Remove comments so example/documentation text can never pollute token or arbitrary-value counts,
 *  while preserving real strings, template literals, JSX className/style and stylesheet declarations.
 *  Deterministic, bounded, single-pass, fails open (returns the input on any anomaly). In CSS mode
 *  only block comments are stripped (CSS has no `//`, and `url(https://…)` must survive); in code mode
 *  a `//` is a line comment only when it is not part of `://` (so URLs in JSX text/attributes survive).
 *  Regex literals containing `//`/`/*` are a rare, bounded edge accepted under the fail-open policy. */
function stripComments(src: string, cssMode: boolean): string {
  try {
    const s = src || '';
    const n = s.length;
    let out = '';
    let state: 'normal' | 'sq' | 'dq' | 'tpl' | 'line' | 'block' = 'normal';
    let i = 0;
    while (i < n) {
      const c = s[i];
      const c2 = i + 1 < n ? s[i + 1] : '';
      if (state === 'normal') {
        if (c === '/' && c2 === '*') { state = 'block'; i += 2; continue; }
        if (!cssMode && c === '/' && c2 === '/' && s[i - 1] !== ':') { state = 'line'; i += 2; continue; }
        if (c === "'") { state = 'sq'; out += c; i += 1; continue; }
        if (c === '"') { state = 'dq'; out += c; i += 1; continue; }
        if (c === '`') { state = 'tpl'; out += c; i += 1; continue; }
        out += c; i += 1; continue;
      }
      if (state === 'line') { if (c === '\n') { state = 'normal'; out += c; } i += 1; continue; }
      if (state === 'block') { if (c === '*' && c2 === '/') { state = 'normal'; i += 2; } else { if (c === '\n') out += c; i += 1; } continue; }
      // string / template states — keep contents verbatim, honour escapes.
      out += c;
      if (c === '\\' && i + 1 < n) { out += s[i + 1]; i += 2; continue; }
      if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = 'normal';
      i += 1;
    }
    return out;
  } catch { return src || ''; }
}

/** Identifiers imported from a theme/tokens/design-system module (namespace, named, aliased, default).
 *  Their MERE import proves nothing; consumption is proven only if they are then referenced in code. */
function importedThemeIdentifiers(cleanCode: string): string[] {
  const ids: string[] = [];
  const re = /import\s+([^;'"]+?)\s+from\s+['"][^'"]*(?:designSystem|\/theme|\/tokens|\/design-system|\/styles\/theme)['"]/gi;
  let m: RegExpExecArray | null; let guard = 0;
  while ((m = re.exec(cleanCode)) && guard < 40) {
    guard += 1;
    const clause = m[1] || '';
    const ns = /\*\s+as\s+(\w+)/.exec(clause); if (ns) ids.push(ns[1]);
    const named = /\{([^}]*)\}/.exec(clause);
    if (named) for (const part of named[1].split(',')) {
      const seg = part.trim(); if (!seg) continue;
      const asM = /(\w+)\s+as\s+(\w+)/.exec(seg);
      ids.push(asM ? asM[2] : seg.replace(/\s.*/, '').trim());
    }
    const head = clause.replace(/\{[^}]*\}/g, '').replace(/\*\s+as\s+\w+/g, '');
    const def = /(^|,)\s*(\w+)\s*(,|$)/.exec(head); if (def) ids.push(def[2]);
  }
  return uniq(ids.filter((x) => x && /^[A-Za-z_$][\w$]*$/.test(x))).slice(0, 20);
}

/** A NORMALIZED composite card-grid chrome signature: radius + surface + border + shadow together.
 *  Two sections match only when ALL components are identical — shared radius alone is NOT a match, so a
 *  coherent design system (same tokens, different surfaces/borders/shadows) never reads as collapse.
 *  Returns '' when the section is not a repeated card grid. Operates on comment-stripped source. */
function chromeSignature(uc: string): string {
  if (!/grid-cols-\d/.test(uc)) return '';
  const cards = (uc.match(/rounded-(?:sm|md|lg|xl|2xl|3xl|full)[^"'`]{0,140}?(?:border|shadow|ring|bg-)/gi) || []).length;
  if (cards < 3) return '';
  const radius = (uc.match(/rounded-(3xl|2xl|xl|lg|md|sm|full)\b/) || [])[1] || (/rounded-\[/.test(uc) ? 'arb' : 'none');
  const surfaceM = uc.match(/bg-(white|black|slate-\d{2,3}|gray-\d{2,3}|neutral-\d{2,3}|zinc-\d{2,3}|stone-\d{2,3}|card|background|surface|muted|popover|\[[^\]]{1,24}\])/);
  const surface = surfaceM ? surfaceM[1] : 'none';
  const borderM = uc.match(/\bborder(?:-(\w+|\[[^\]]{1,24}\]))?\b/);
  const border = borderM ? (borderM[1] || 'plain') : 'none';
  const shadowM = uc.match(/\bshadow(?:-(sm|md|lg|xl|2xl|inner|none|\[[^\]]{1,24}\]))?\b/);
  const shadow = shadowM ? (shadowM[1] || 'base') : 'none';
  return `r:${radius}|s:${surface}|b:${border}|sh:${shadow}`;
}

/** Reduce comment-free source to RENDER-RELEVANT evidence only — JSX opening/closing tags (with their
 *  className/style attributes and structural tag names) plus class/style attribute values — so unused
 *  string constants, object metadata, console/debug strings and other non-rendered text cannot
 *  register fake token/semantic/arbitrary evidence. Bounded and deterministic; a token/var/class only
 *  counts when it appears inside actual rendered markup. Inline style objects (style={{…}}) are kept
 *  because they carry real var(--token) and colour values used by rendered output. Fails open. */
function renderEvidence(cleanSrc: string): string {
  try {
    const tags: string[] = cleanSrc.match(/<\/?[A-Za-z][^>]{0,600}>/g) || [];
    const classVals: string[] = cleanSrc.match(/\b(?:class|className)\s*=\s*(?:"[^"]*"|'[^']*'|\{[^}]{0,600}\})/g) || [];
    const styleVals: string[] = cleanSrc.match(/\bstyle\s*=\s*(?:\{\{[^}]{0,600}\}\}|"[^"]*"|'[^']*')/g) || [];
    return [...tags, ...classVals, ...styleVals].join('\n');
  } catch { return cleanSrc || ''; }
}

/** True when an opening tag is structurally HIDDEN or purely DECORATIVE — screen-reader-hidden
 *  (aria-hidden="true"/{true}), presentational (role="presentation"/"none"), or a visually-hidden
 *  utility (sr-only / visually-hidden, but NOT the "not-sr-only" reveal). Such nodes are never the
 *  authoritative visible body copy, so near-transparent/decorative/same-token text inside them is not
 *  a readability defect. Deliberately NARROW: only explicit hidden/decorative markers exclude a node;
 *  a genuinely visible low-opacity or same-token element is unaffected and still counts. Pure. */
function isHiddenOrDecorativeTag(tag: string): boolean {
  return /\baria-hidden\s*=\s*(?:["']true["']|\{\s*true\s*\})/i.test(tag)
    || /\brole\s*=\s*["'](?:presentation|none)["']/i.test(tag)
    || /(?<![\w-])(?:sr-only|visually-hidden)(?![\w-])/i.test(tag);
}

export function analyzeVisualSystem(
  files: FrontendGeneratedFile[] | undefined,
  contract: VisualSystemContract | undefined,
): VisualSystemAcceptanceResult {
  try {
    if (!contract || contract.status !== 'derived') return LEGACY_VISUAL;
    const list = Array.isArray(files) ? files : [];
    if (!list.length) return { ...LEGACY_VISUAL, legacy: false };
    const issues: VisualSystemIssue[] = [];
    const push = (i: VisualSystemIssue) => { if (issues.length < MAX_ISSUES) issues.push(i); };

    const codeFiles = list.filter((f) => isCode(f.path));
    const styleFiles = list.filter((f) => isStyle(f.path));
    // Comment/example-free source (defect 2). `codeSrc` is the whole comment-free code (used only for
    // import parsing); `codeRender` is reduced to RENDER-RELEVANT evidence (JSX tags + class/style
    // values), so unused string constants, object metadata and console/debug strings can never register
    // fake token/semantic/arbitrary evidence. CSS files are executable declarations kept whole.
    const codeSrc = codeFiles.map((f) => stripComments((f.content || '').slice(0, MAX_FILE_SCAN), false)).join('\n');
    const codeRender = renderEvidence(codeSrc);
    const styleSrc = styleFiles.map((f) => stripComments((f.content || '').slice(0, MAX_FILE_SCAN), true)).join('\n');

    // ── Token SOURCE is DECLARED/IMPORTED vs actually CONSUMED — never conflated (defect 1). All
    //    definition/usage/semantic evidence is drawn from executable CSS + RENDERED code only. ──
    const cssVarDefs = (styleSrc.match(/--[a-z][\w-]*\s*:/gi) || []).length + (codeRender.match(/--[a-z][\w-]*\s*:/gi) || []).length;
    const varUsages = (codeRender.match(/var\(--[a-z][\w-]*/gi) || []).length + (styleSrc.match(/var\(--[a-z][\w-]*/gi) || []).length;
    const semanticTailwind = (codeRender.match(/(?:bg|text|border|ring|from|via|to|fill|stroke|divide|placeholder|caret|outline|decoration)-(?:primary|secondary|background|foreground|surface|card|muted|accent|border|ring|destructive|popover|input|brand)(?:-foreground)?\b/g) || []).length;
    // A theme/tokens/design-system module being IMPORTED or merely EXISTING proves declaration only.
    const themeModuleImported = /import\b[^;]*\bfrom\s+['"][^'"]*(?:designSystem|\/theme|\/tokens|\/design-system|\/styles\/theme)['"]/i.test(codeSrc);
    const themeModuleDeclared = themeModuleImported
      || list.some((f) => /(?:designSystem|theme|tokens)\.(?:t|j)sx?$/i.test(f.path)
        && /export\s+(?:const|default|function|let|var)|--[a-z]/.test(stripComments(f.content || '', isStyle(f.path))));
    // CONSUMPTION must be PROVEN from RENDERED output — an imported identifier counts only when it
    // appears inside rendered JSX/className/style (codeRender excludes imports, console/debug, metadata
    // and unused helpers/objects), or via a stylesheet value. Import-only/debug-only never suffice.
    const themeIds = importedThemeIdentifiers(codeSrc);
    const moduleTokensConsumed = themeIds.some((id) => new RegExp(`\\b${id}\\b`).test(codeRender));
    const cssVarsConsumed = cssVarDefs >= 1 && varUsages >= 3;
    const semanticConsumed = semanticTailwind >= 8;
    const tokenSource: VisualSystemAcceptanceResult['tokenSource'] = themeModuleDeclared ? 'theme-module'
      : cssVarDefs >= 3 ? 'css-vars'
      : semanticTailwind >= 8 ? 'semantic-tailwind' : 'none';
    // themeModule existence/import ALONE never sets this — only proven consumption does.
    const tokenConsumed = cssVarsConsumed || moduleTokensConsumed || semanticConsumed;

    // ── Section-scoped units (never whole-project token composition). Analyzed on RENDER-relevant,
    //    comment-free evidence, so unused strings/metadata inside a component region cannot pollute. ──
    const units = collectSectionUnits(list, contract.sectionIds);
    const fam = contract.sectionFamilies || {};
    const renderUnits = units.map((u) => ({ id: u.id, path: u.path, render: renderEvidence(stripComments(u.content, false)) }));
    const arbitrarySet = new Set<string>();
    let arbSectionCount = 0;
    // Repeated card chrome is grouped by a NORMALIZED COMPOSITE signature (radius+surface+border+shadow),
    // so shared radius alone — or a coherent card system — never groups as identical collapse.
    const sigGroups = new Map<string, { ids: string[]; files: string[] }>();
    let gradientUnits = 0, glassUnits = 0, pillTotal = 0, iconCircle = 0;
    for (const u of renderUnits) {
      const uc = u.render;
      const before = arbitrarySet.size;
      collectArbitrary(uc, arbitrarySet);
      if (arbitrarySet.size > before) arbSectionCount += 1;
      const sig = chromeSignature(uc);
      if (sig) {
        const g = sigGroups.get(sig) || { ids: [], files: [] };
        if (!g.ids.includes(u.id)) g.ids.push(u.id);
        if (!g.files.includes(u.path)) g.files.push(u.path);
        sigGroups.set(sig, g);
      }
      if (/bg-gradient|from-[a-z[]/.test(uc) && /\bto-[a-z[]/.test(uc)) gradientUnits += 1;
      if (/backdrop-blur/.test(uc)) glassUnits += 1;
      pillTotal += (uc.match(/rounded-full/g) || []).length;
      iconCircle += (uc.match(/rounded-full[^"'`>]{0,40}(?:w-1[0-6]|h-1[0-6]|p-[234])\b/g) || []).length;
    }
    // Largest identical-composite-chrome group size (diagnostic only; the blocker below evaluates EVERY
    // qualifying group, not just this one).
    let chromeRepeat = 0;
    for (const g of sigGroups.values()) if (g.ids.length > chromeRepeat) chromeRepeat = g.ids.length;
    const radiusShadowArbSet = new Set<string>();
    for (const k of arbitrarySet) if (k.startsWith('r:') || k.startsWith('s:')) radiusShadowArbSet.add(k);
    const radiusShadowArb = radiusShadowArbSet.size;
    const arbitraryValueCount = arbitrarySet.size;

    // ── Global readability (works even if section correlation is thin). Render-relevant, comment-free. ──
    const readSrc = renderUnits.length >= 2 ? renderUnits.map((u) => u.render).join('\n') : codeRender;
    // Decorative/hidden nodes (aria-hidden, role=presentation/none, sr-only/visually-hidden) are NOT
    // the authoritative visible copy, so they never count as unreadable body evidence (Fix A). Gradient
    // clip text (bg-clip-text) stays excluded. Genuinely visible low-opacity/same-token text still counts.
    const transparentBody = (readSrc.match(/<(?:p|blockquote)\b[^>]*\b(?:opacity-(?:0|5|10|15|20)|text-transparent)\b[^>]*>/gi) || [])
      .filter((tag) => !/bg-clip-text/.test(tag) && !isHiddenOrDecorativeTag(tag)).length;
    const sameTokenTextBg = (readSrc.match(/<[a-zA-Z][^>]*\b(?:text-white\b[^>]*\bbg-white|text-black\b[^>]*\bbg-black)\b[^>]*>/gi) || [])
      .filter((tag) => !isHiddenOrDecorativeTag(tag)).length
      + (readSrc.match(/<[a-zA-Z][^>]*text-\[?(var\(--[\w-]+\))\]?[^>]*bg-\[?\1\]?/gi) || [])
        .filter((tag) => !isHiddenOrDecorativeTag(tag)).length;

    // ── 1. No coherent token source + severe cross-section fragmentation (blocker). ──
    let blocked = false;
    if (units.length >= MIN_UNITS && tokenSource === 'none' && arbitraryValueCount >= FRAG_ARBITRARY && arbSectionCount >= Math.ceil(units.length / 2)) {
      blocked = true;
      push({ code: 'visual-system-no-coherent-tokens', severity: 'major', label: 'no coherent token source', files: uniq(units.map((u) => u.path)).slice(0, MAX_ISSUE_FILES),
        evidence: capEv(`no shared visual-token/system source detected and ${arbitraryValueCount} distinct arbitrary colour/radius/shadow values are spread across ${arbSectionCount} of ${units.length} sections — the visual system is fragmented per section`),
        repairInstruction: capEv('Define one local token source (CSS variables on :root or the existing theme module) for colour roles/radius/shadow and consume it everywhere instead of arbitrary per-section values.') });
    }
    // ── 2. Tokens declared but systematically bypassed (blocker). ──
    if (!blocked && tokenSource !== 'none' && units.length >= 3 && (
      (!tokenConsumed && arbitraryValueCount >= BYPASS_ARBITRARY && arbSectionCount >= 3)
      || (arbitraryValueCount >= BYPASS_HIGH && arbSectionCount >= Math.ceil(units.length / 2)))) {
      blocked = true;
      push({ code: 'visual-system-tokens-bypassed', severity: 'major', label: 'declared tokens bypassed', files: uniq(units.map((u) => u.path)).slice(0, MAX_ISSUE_FILES),
        evidence: capEv(`a ${tokenSource} token source is present${tokenConsumed ? '' : ' but barely consumed'}, yet components bypass it with ${arbitraryValueCount} distinct arbitrary colour/radius/shadow values across ${arbSectionCount} sections`),
        repairInstruction: capEv('Consume the declared visual tokens across all components; remove the arbitrary hex/radius/shadow values and map them to the semantic token roles.') });
    }
    // ── 3. Repeated IDENTICAL card chrome collapsing DISTINCT non-card composition roles (blocker).
    //    Fires ONLY when ≥4 sections share a materially identical composite signature (radius+surface+
    //    border+shadow), those sections were assigned DISTINCT non-card PR #561 families (so they should
    //    look different), and every sharing section's family is known. Shared radius, a coherent card
    //    system, one catalog grid, or legitimate card families (feature/catalog/comparison/gallery/proof)
    //    never trip it; ambiguous composition correlation fails open to a warning. ──
    //    EVERY qualifying signature group is evaluated (not only the largest), so a real collapse group
    //    is never missed behind a larger legitimate catalog-card group.
    const chromeBlocking: Array<{ sig: string; files: string[]; nonCardIds: string[]; families: string[] }> = [];
    const chromeAmbiguous: Array<{ sig: string; files: string[]; size: number }> = [];
    for (const [sig, g] of sigGroups) {
      if (g.ids.length < COLLAPSE_MIN) continue;
      const familiesKnown = g.ids.every((id) => !!fam[id]);
      const nonCardIds = g.ids.filter((id) => fam[id] && !CARD_JUSTIFIED_FAMILIES.has(fam[id]));
      const distinctNonCardFamilies = uniq(nonCardIds.map((id) => fam[id]));
      if (familiesKnown && nonCardIds.length >= COLLAPSE_MIN && distinctNonCardFamilies.length >= 2) {
        chromeBlocking.push({ sig, files: g.files, nonCardIds, families: distinctNonCardFamilies });
      } else if (!familiesKnown && g.ids.length >= Math.ceil(units.length * 0.6)) {
        chromeAmbiguous.push({ sig, files: g.files, size: g.ids.length });
      }
      // else: a coherent shared card design among card-justified families → no finding.
    }
    // Strongest group first; emit a bounded, de-duplicated (per distinct signature) finding per group.
    chromeBlocking.sort((a, b) => b.nonCardIds.length - a.nonCardIds.length);
    for (const grp of chromeBlocking.slice(0, 3)) {
      push({ code: 'visual-system-chrome-collapse', severity: 'major', label: 'identical card chrome across distinct non-card roles', files: grp.files.slice(0, MAX_ISSUE_FILES),
        evidence: capEv(`${grp.nonCardIds.length} top-level sections (${grp.nonCardIds.slice(0, 6).join(', ')}) assigned DISTINCT non-card composition families (${grp.families.slice(0, 6).join(', ')}) all render the identical composite card-grid chrome [${grp.sig.split('|').join(' ')}] — the repetition contradicts their assigned roles`),
        repairInstruction: capEv('Give each non-card section (hero/story/steps/CTA/etc.) its assigned composition treatment; reserve the shared card grid for card families (feature/catalog/comparison/gallery/proof).') });
    }
    if (!chromeBlocking.length) for (const grp of chromeAmbiguous.slice(0, 1)) {
      push({ code: 'visual-system-slop-pattern', severity: 'minor', label: 'possible repeated card chrome', files: grp.files.slice(0, MAX_ISSUE_FILES),
        evidence: capEv(`${grp.size} sections share an identical composite card-grid chrome [${grp.sig.split('|').join(' ')}] but composition roles could not be correlated — verify this is a coherent card system, not template collapse`),
        repairInstruction: capEv('Confirm each section’s composition role; vary the card chrome where the assigned roles differ.') });
    }
    // ── 4. Literal severe unreadability (blocker). ──
    if (transparentBody >= 2 || sameTokenTextBg >= 1) {
      push({ code: 'visual-system-unreadable-body', severity: 'major', label: 'unreadable body text', files: [],
        evidence: capEv(`${transparentBody ? `${transparentBody} body element(s) render near-transparent/transparent text` : ''}${transparentBody && sameTokenTextBg ? '; ' : ''}${sameTokenTextBg ? `${sameTokenTextBg} element(s) use the same literal token for text and background` : ''} — body copy is not readable`),
        repairInstruction: capEv('Render body text with a readable strong/body token on its surface; never near-transparent body copy or identical text/background tokens.') });
    }

    // ── Warnings (manual review only; never hard blockers). ──
    if (!blocked && radiusShadowArb >= PROLIFERATION) {
      push({ code: 'visual-system-radius-shadow-proliferation', severity: 'minor', label: 'radius/shadow proliferation', files: [],
        evidence: capEv(`${radiusShadowArb} distinct arbitrary radius/shadow values — verify the surface language is coherent rather than improvised per element`),
        repairInstruction: capEv('Consolidate radius/shadow to the small token set in the surface vocabulary.') });
    }
    if (gradientUnits >= 4 || glassUnits >= 4 || pillTotal >= 10) {
      push({ code: 'visual-system-gradient-glass-pill-repetition', severity: 'minor', label: 'gradient/glass/pill repetition', files: [],
        evidence: capEv(`repeated decorative treatments (gradient sections ${gradientUnits}, glass ${glassUnits}, pills ${pillTotal}) — confirm each is justified, not slop-by-accumulation`),
        repairInstruction: capEv('Reserve gradients/glass/pills for justified moments per the anti-slop policy; do not apply them uniformly.') });
    }
    if (iconCircle >= 6 && units.length >= 3) {
      push({ code: 'visual-system-slop-pattern', severity: 'minor', label: 'icon-circle repetition', files: [],
        evidence: capEv(`${iconCircle} icon-in-circle treatments across sections — verify this is not the repeated dominant motif`),
        repairInstruction: capEv('Vary the detail language; icon-in-circle should not be the page-wide dominant motif.') });
    }
    const interactiveScore = (codeRender.match(/<button\b|<input\b|<select\b|<textarea\b|onClick=/g) || []).length;
    if (interactiveScore >= 8 && !/focus-visible:|focus:/.test(codeRender) && !/:focus\b/.test(styleSrc)) {
      push({ code: 'visual-system-focus-missing', severity: 'minor', label: 'no focus intent', files: [],
        evidence: capEv('a highly interactive site shows no focus/focus-visible styling — verify keyboard focus is visible'),
        repairInstruction: capEv('Add a visible focus-visible ring to interactive elements.') });
    }
    if (units.length >= MIN_UNITS && !/(?:sm|md|lg):(?:text-|p[xy]?-|gap-|leading-)/.test(codeRender)) {
      push({ code: 'visual-system-mobile-typography-risk', severity: 'minor', label: 'no responsive typography intent', files: [],
        evidence: capEv('no responsive typography/spacing prefixes detected — verify mobile does not shrink body text or crush spacing'),
        repairInstruction: capEv('Add responsive typography/spacing adjustments per the responsive obligations.') });
    }
    // Text-over-image without a scrim (per unit) → warning.
    let textOverImage = 0;
    for (const u of renderUnits) {
      const uc = u.render;
      const hasImg = /<img\b|<picture\b|background-image|data-korvix-image-slot/i.test(uc);
      const hasOverlayText = /absolute[^>]*(?:<h1|<h2|text-white)/i.test(uc) || (/<img\b/i.test(uc) && /absolute/.test(uc) && /text-white/.test(uc));
      const hasScrim = /bg-black\/|bg-gradient|from-black|backdrop-blur|scrim|overlay|bg-\[rgba/i.test(uc);
      if (hasImg && hasOverlayText && !hasScrim) textOverImage += 1;
    }
    if (textOverImage >= 1) {
      push({ code: 'visual-system-text-over-image', severity: 'minor', label: 'text over image without scrim', files: [],
        evidence: capEv(`${textOverImage} section(s) place text over imagery without a clear scrim/overlay — verify readability`),
        repairInstruction: capEv('Add a scrim/gradient overlay or a protected panel behind text placed over imagery.') });
    }

    // ── CTA-system continuity (warning): count DISTINCT solid primary-button background tokens on real
    //    <button>/<a role=button> elements. One coherent system uses 1–2; ≥4 distinct solid colours across
    //    ≥3 sections signals several unrelated button systems. Heuristic → warning only, fails open. ──
    const buttonBgTokens = new Set<string>();
    let buttonSectionsWithSolid = 0;
    for (const u of renderUnits) {
      let sawSolid = false;
      for (const m of u.render.matchAll(/<(?:button|a)\b[^>]*\b(?:bg-(gradient-[a-z-]+|[a-z]+-\d{2,3}|primary|accent|brand|secondary|\[#[0-9a-fA-F]{3,8}\]))/gi)) {
        const tok = (m[1] || '').toLowerCase();
        if (!tok || /white|transparent|none|black/.test(tok)) continue;
        buttonBgTokens.add(tok); sawSolid = true;
      }
      if (sawSolid) buttonSectionsWithSolid += 1;
    }
    const distinctPrimaryButtonStyleCount = buttonBgTokens.size;
    if (distinctPrimaryButtonStyleCount >= 4 && buttonSectionsWithSolid >= 3) {
      push({ code: 'visual-system-cta-inconsistent', severity: 'minor', label: 'inconsistent CTA/button system', files: [],
        evidence: capEv(`${distinctPrimaryButtonStyleCount} distinct solid button background tokens (${[...buttonBgTokens].slice(0, 5).join(', ')}) across ${buttonSectionsWithSolid} sections — verify ONE primary CTA appearance is reused, not several competing button styles`),
        repairInstruction: capEv('Use one primary button appearance (colour/height/radius) reused across all sections per the CTA continuity; reserve a single tinted/outline secondary; do not introduce a new solid button colour per section.') });
    }

    // ── Footer continuity (warning): a footer should complete the page, not fall back to a generic
    //    disconnected block. Missing footer across a multi-section page, or a hard black footer on a
    //    light page, is a coherence warning only. Fails open when ambiguous. ──
    let footerContinuity: VisualSystemAcceptanceResult['footerContinuity'] = 'unknown';
    const footerTag = /<footer\b[^>]{0,400}>/i.exec(codeRender);
    if (!footerTag) {
      if (units.length >= MIN_UNITS) {
        footerContinuity = 'missing';
        push({ code: 'visual-system-footer-discontinuity', severity: 'minor', label: 'no footer element', files: [],
          evidence: capEv('no <footer> element was found on a multi-section page — the page may end abruptly without a resolving footer'),
          repairInstruction: capEv('Add a footer that completes the visual story (quiet surface echoing the hero, consistent muted token, grouped links, one restrained final CTA) per the footer continuity.') });
      }
    } else if (contract.colorMode === 'light' && /bg-(?:black|zinc-950|neutral-950|slate-950|gray-950|stone-950|\[#0{3,6}\b|\[#0{3}\])/i.test(footerTag[0])) {
      footerContinuity = 'disconnected';
      push({ code: 'visual-system-footer-discontinuity', severity: 'minor', label: 'footer visually disconnected', files: [],
        evidence: capEv('a light-themed page renders a hard pure-black footer — verify the footer resolves the page palette (a quiet tinted surface) rather than a generic dark block disconnected from the design'),
        repairInstruction: capEv('Resolve the footer into a quiet variant of the page canvas that echoes the hero, keeping the muted text token and grouped links, instead of a generic pure-black block.') });
    } else {
      footerContinuity = 'ok';
    }

    const readabilityFindingCount = (transparentBody >= 2 || sameTokenTextBg >= 1 ? 1 : 0) + textOverImage;
    const responsiveFindingCount = issues.filter((i) => i.code === 'visual-system-mobile-typography-risk').length;
    const blocking = issues.some((i) => i.severity !== 'minor');
    const warned = issues.some((i) => i.severity === 'minor');
    const status: VisualSystemAcceptanceResult['status'] = blocking ? 'fail' : warned ? 'warning' : 'pass';
    return {
      status, legacy: false, analyzedSectionCount: units.length, tokenSource, tokenConsumed,
      arbitraryValueCount, chromeRepeatSectionCount: chromeRepeat, readabilityFindingCount, responsiveFindingCount,
      distinctPrimaryButtonStyleCount, footerContinuity,
      issues: issues.slice(0, MAX_ISSUES),
    };
  } catch {
    return { ...LEGACY_VISUAL, legacy: false };
  }
}

export function hasBlockingVisualSystemFindings(result: VisualSystemAcceptanceResult | undefined): boolean {
  return !!result && result.status === 'fail';
}

const VISUAL_CATEGORY: Record<VisualSystemIssueCode, FrontendBuilderReviewCategory> = {
  'visual-system-no-coherent-tokens': 'palette-and-surfaces',
  'visual-system-tokens-bypassed': 'palette-and-surfaces',
  'visual-system-chrome-collapse': 'component-composition',
  'visual-system-unreadable-body': 'accessibility-intent',
  'visual-system-contrast-risk': 'accessibility-intent',
  'visual-system-text-over-image': 'accessibility-intent',
  'visual-system-radius-shadow-proliferation': 'palette-and-surfaces',
  'visual-system-gradient-glass-pill-repetition': 'palette-and-surfaces',
  'visual-system-focus-missing': 'accessibility-intent',
  'visual-system-mobile-typography-risk': 'responsive-intent',
  'visual-system-cta-inconsistent': 'component-composition',
  'visual-system-footer-discontinuity': 'component-composition',
  'visual-system-slop-pattern': 'generic-template',
};

export function visualSystemToReviewIssues(result: VisualSystemAcceptanceResult | undefined): FrontendBuilderReviewIssue[] {
  if (!result || !result.issues.length) return [];
  const out: FrontendBuilderReviewIssue[] = [];
  let i = 0;
  for (const issue of result.issues) {
    if (issue.severity === 'minor') continue;   // advisory/manual-review — not a repair blocker
    out.push({
      id: `visual-${issue.code}-${i += 1}`,
      severity: issue.severity,
      category: VISUAL_CATEGORY[issue.code],
      files: (issue.files || []).slice(0, MAX_ISSUE_FILES),
      evidence: capEv(issue.evidence),
      repairInstruction: capEv(issue.repairInstruction),
    });
    if (out.length >= MAX_ISSUES) break;
  }
  return out;
}

export function visualSystemIssueCodes(result: VisualSystemAcceptanceResult | undefined): string[] {
  if (!result) return [];
  return uniq(result.issues.map((i) => i.code)).slice(0, 12);
}

/* ── Owner diagnostics (bounded, no secrets / source / URLs). ── */
export interface VisualSystemDiagnostics {
  visualSystemVersion: string;
  visualSystemStatus: 'derived' | 'legacy';
  systemThesis: string;
  colorMode: VisualColorMode;
  typographyRoleCount: number;
  colorRoleCount: number;
  surfaceRoleCount: number;
  componentRuleCount: number;
  prohibitedPatternCount: number;
  visualSystemCharCount: number;
  gradientPolicy: GradientPolicy;
  glassPolicy: GlassPolicy;
  continuityPresent: boolean;
  continuityAnchorCount: number;
  derivationBasis: string[];
  contractPersistedInSpecification: boolean;
  contractRenderedToFrontendBuilder: boolean;
  contractUsedByAcceptance: boolean;
  agentsActuallyConsumingContract: string[];
  tokenSourceDetected?: VisualSystemAcceptanceResult['tokenSource'];
  tokenConsumptionDetected?: boolean;
  analyzedSectionCount?: number;
  arbitraryValueCount?: number;
  chromeRepeatSectionCount?: number;
  readabilityFindingCount?: number;
  responsiveFindingCount?: number;
  distinctPrimaryButtonStyleCount?: number;
  footerContinuity?: VisualSystemAcceptanceResult['footerContinuity'];
  visualSystemAcceptanceStatus?: 'pass' | 'warning' | 'fail';
  visualSystemIssueCodes?: string[];
}

export function buildVisualSystemDiagnostics(
  contract: VisualSystemContract | undefined,
  acceptance: VisualSystemAcceptanceResult | undefined,
  visualSystemCharCount: number,
): VisualSystemDiagnostics | undefined {
  if (!contract) return undefined;
  const live = acceptance && !acceptance.legacy ? acceptance : undefined;
  return {
    visualSystemVersion: contract.version,
    visualSystemStatus: contract.status,
    systemThesis: clip(contract.systemThesis, 80),
    colorMode: contract.colorMode,
    typographyRoleCount: contract.typography.roles.length,
    colorRoleCount: contract.colorRoles.length,
    surfaceRoleCount: contract.surfaces.vocabulary.length,
    componentRuleCount: contract.components.length,
    prohibitedPatternCount: contract.antiSlop.prohibited.length,
    visualSystemCharCount,
    gradientPolicy: contract.surfaces.gradients,
    glassPolicy: contract.surfaces.glass,
    continuityPresent: !!contract.continuity,
    continuityAnchorCount: contract.continuity?.anchors.length ?? 0,
    derivationBasis: contract.derivationBasis.slice(0, 8),
    contractPersistedInSpecification: contract.contractPersistedInSpecification,
    contractRenderedToFrontendBuilder: contract.contractRenderedToFrontendBuilder,
    contractUsedByAcceptance: contract.contractUsedByAcceptance,
    agentsActuallyConsumingContract: contract.agentsActuallyConsumingContract.slice(0, 8),
    ...(live ? {
      tokenSourceDetected: live.tokenSource,
      tokenConsumptionDetected: live.tokenConsumed,
      analyzedSectionCount: live.analyzedSectionCount,
      arbitraryValueCount: live.arbitraryValueCount,
      chromeRepeatSectionCount: live.chromeRepeatSectionCount,
      readabilityFindingCount: live.readabilityFindingCount,
      responsiveFindingCount: live.responsiveFindingCount,
      distinctPrimaryButtonStyleCount: live.distinctPrimaryButtonStyleCount,
      footerContinuity: live.footerContinuity,
      visualSystemAcceptanceStatus: live.status,
      visualSystemIssueCodes: visualSystemIssueCodes(live),
    } : {}),
  };
}
