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
const RENDER_CHAR_CEILING = 3000; // documented hard ceiling for the rendered builder block
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
  sectionIds: string[];
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

export function deriveVisualSystemContract(input: VisualSystemInput): VisualSystemContract | undefined {
  const identity = input.identity || ({} as FrontendSpecIdentity);
  const ds = input.designSystem;
  const ad = input.artDirection;
  const research = input.research;
  const comp = input.composition;
  const sectionIds = uniq((comp?.sections?.map((s) => s.id) || (input.sections || []).map((s) => s.id)).filter(Boolean)).slice(0, MAX_SECTION_IDS);
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
    sectionIds,
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
export function renderVisualSystemBlock(contract: VisualSystemContract | undefined): string[] {
  if (!contract || contract.status !== 'derived') return [];
  const t = contract.typography;
  const s = contract.surfaces;
  const roleLine = contract.colorRoles.map((r) => `${r.role}${r.token ? `=${r.token}` : ''}`).slice(0, MAX_COLOR_ROLES).join(', ');
  const typoRoles = t.roles.map((r) => `${r.name}(${r.sizeHint}/${r.weightHint})`).slice(0, MAX_TYPO_ROLES).join(' · ');
  const comps = contract.components.map((c) => `${c.element}: ${c.rule}`).slice(0, MAX_COMPONENT_RULES);
  const out = [
    'BINDING PREMIUM VISUAL SYSTEM:',
    `Visual thesis: ${clip(contract.systemThesis, MAX_TEXT)} · colour mode: ${contract.colorMode}`,
    `TOKEN STRATEGY: ${clip(contract.tokenStrategy, 320)}`,
    `Typography (${t.strategy}): display-stack "${t.displayStack}"; body-stack "${t.bodyStack}". Roles: ${typoRoles}.`,
    `  ${t.weightBoundary}; ${t.bodyScale}; ${t.lineHeight}; ${t.measure}; ${t.capitalization}; mobile: ${t.mobileAdjust}.`,
    `  Typography prohibits: ${t.prohibited.slice(0, 5).join('; ')}.`,
    `Colour roles (semantic, define once, reuse): ${roleLine}.`,
    `Contrast/readability: ${contract.contrastObligations.slice(0, 5).join('; ')}.`,
    `Surfaces: ${s.vocabulary.slice(0, 6).join(' · ')}. Radius ${s.radiusRange}. Shadows: ${s.shadowRoles.slice(0, 3).join('; ')}. Borders: ${s.borderBehavior}. Overlay: ${s.overlayBehavior}.`,
    `  Gradients: ${s.gradients}. Glass: ${s.glass}. Max distinct surface treatments: ${s.maxSurfaceVariety}.`,
    'Component chrome:',
    ...comps.map((c) => `  - ${c}`),
    `Detail language: ${contract.detailLanguage.slice(0, 6).join('; ')}.`,
    `Responsive: ${contract.responsiveObligations.slice(0, 5).join('; ')}.`,
    `ANTI-SLOP — do NOT: ${contract.antiSlop.prohibited.slice(0, 10).join('; ')}.`,
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
  issues: VisualSystemIssue[];
}
const LEGACY_VISUAL: VisualSystemAcceptanceResult = {
  status: 'pass', legacy: true, analyzedSectionCount: 0, tokenSource: 'none', tokenConsumed: false,
  arbitraryValueCount: 0, chromeRepeatSectionCount: 0, readabilityFindingCount: 0, responsiveFindingCount: 0, issues: [],
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
    const codeSrc = codeFiles.map((f) => (f.content || '').slice(0, MAX_FILE_SCAN)).join('\n');
    const styleSrc = styleFiles.map((f) => (f.content || '').slice(0, MAX_FILE_SCAN)).join('\n');

    // ── Global token-source detection: definition vs actual consumption. ──
    const cssVarDefs = (styleSrc.match(/--[a-z][\w-]*\s*:/gi) || []).length + (codeSrc.match(/--[a-z][\w-]*\s*:/gi) || []).length;
    const varUsages = (codeSrc.match(/var\(--[a-z][\w-]*/gi) || []).length + (styleSrc.match(/var\(--[a-z][\w-]*/gi) || []).length;
    const themeModule = /from\s+['"][^'"]*(?:designSystem|\/theme|\/tokens|\/design-system)['"]/i.test(codeSrc)
      || list.some((f) => /(?:designSystem|theme|tokens)\.(?:t|j)s$/i.test(f.path) && /--[a-z]|export const|:\s*['"]#/.test(f.content || ''));
    const semanticTailwind = (codeSrc.match(/(?:bg|text|border|ring|from|via|to|fill|stroke|divide|placeholder|caret|outline|decoration)-(?:primary|secondary|background|foreground|surface|card|muted|accent|border|ring|destructive|popover|input|brand)(?:-foreground)?\b/g) || []).length;
    const tokenSource: VisualSystemAcceptanceResult['tokenSource'] = themeModule ? 'theme-module'
      : cssVarDefs >= 3 ? 'css-vars'
      : semanticTailwind >= 8 ? 'semantic-tailwind' : 'none';
    const tokenConsumed = varUsages >= 3 || semanticTailwind >= 8 || themeModule;

    // ── Section-scoped units (never whole-project token composition). ──
    const units = collectSectionUnits(list, contract.sectionIds);
    const arbitrarySet = new Set<string>();
    let arbSectionCount = 0;
    // Repeated generic card chrome is keyed on the IDENTICAL card radius (not merely "has cards"), so a
    // coherent card system or a legitimate features/pricing/testimonials trio never trips a hard block.
    const chromeSigCount = new Map<string, number>();
    const chromeSigFiles = new Map<string, string[]>();
    let gradientUnits = 0, glassUnits = 0, pillTotal = 0, iconCircle = 0;
    for (const u of units) {
      const before = arbitrarySet.size;
      collectArbitrary(u.content, arbitrarySet);
      if (arbitrarySet.size > before) arbSectionCount += 1;
      if (/grid-cols-\d/.test(u.content)) {
        let sig = '';
        for (const size of ['3xl', '2xl', 'xl']) {
          if ((u.content.match(new RegExp(`rounded-${size}[^"'\`]{0,100}(?:border|shadow|ring)`, 'gi')) || []).length >= 3) { sig = size; break; }
        }
        if (sig) {
          chromeSigCount.set(sig, (chromeSigCount.get(sig) || 0) + 1);
          const arr = chromeSigFiles.get(sig) || []; if (!arr.includes(u.path)) arr.push(u.path); chromeSigFiles.set(sig, arr);
        }
      }
      if (/bg-gradient|from-[a-z[]/.test(u.content) && /\bto-[a-z[]/.test(u.content)) gradientUnits += 1;
      if (/backdrop-blur/.test(u.content)) glassUnits += 1;
      pillTotal += (u.content.match(/rounded-full/g) || []).length;
      iconCircle += (u.content.match(/rounded-full[^"'`>]{0,40}(?:w-1[0-6]|h-1[0-6]|p-[234])\b/g) || []).length;
    }
    // Dominant identical-chrome signature (the collapse candidate).
    let chromeRepeat = 0; let chromeSig = '';
    for (const [s, c] of chromeSigCount) if (c > chromeRepeat) { chromeRepeat = c; chromeSig = s; }
    const chromeFiles = chromeSigFiles.get(chromeSig) || [];
    const radiusShadowArbSet = new Set<string>();
    for (const k of arbitrarySet) if (k.startsWith('r:') || k.startsWith('s:')) radiusShadowArbSet.add(k);
    const radiusShadowArb = radiusShadowArbSet.size;
    const arbitraryValueCount = arbitrarySet.size;

    // ── Global readability (works even if section correlation is thin). ──
    const readSrc = units.length >= 2 ? units.map((u) => u.content).join('\n') : codeSrc;
    const transparentBody = (readSrc.match(/<(?:p|blockquote)\b[^>]*\b(?:opacity-(?:0|5|10|15|20)|text-transparent)\b[^>]*>/gi) || [])
      .filter((tag) => !/bg-clip-text/.test(tag)).length;
    const sameTokenTextBg = (readSrc.match(/<[a-zA-Z][^>]*\b(?:text-white\b[^>]*\bbg-white|text-black\b[^>]*\bbg-black)\b[^>]*>/gi) || []).length
      + (readSrc.match(/<[a-zA-Z][^>]*text-\[?(var\(--[\w-]+\))\]?[^>]*bg-\[?\1\]?/gi) || []).length;

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
    // ── 3. Repeated generic card chrome across unrelated sections (blocker). Requires an OVERWHELMING
    //    majority (≥60%) of sections to share the IDENTICAL rounded card chrome — a coherent card system
    //    or a normal features/pricing/testimonials trio never trips this. ──
    if (chromeRepeat >= COLLAPSE_MIN && chromeRepeat >= Math.ceil(units.length * 0.6)) {
      push({ code: 'visual-system-chrome-collapse', severity: 'major', label: `repeated rounded-${chromeSig} card chrome`, files: chromeFiles.slice(0, MAX_ISSUE_FILES),
        evidence: capEv(`${chromeRepeat} of ${units.length} unrelated top-level sections repeat the same generic rounded-${chromeSig} bordered/shadowed card-grid chrome, contradicting their assigned composition roles`),
        repairInstruction: capEv('Give each top-level section its assigned composition surface/chrome; a repeated card grid may live inside ONE catalog section, not across unrelated sections.') });
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
    const interactiveScore = (codeSrc.match(/<button\b|<input\b|<select\b|<textarea\b|onClick=/g) || []).length;
    if (interactiveScore >= 8 && !/focus-visible:|focus:|:focus\b/.test(codeSrc)) {
      push({ code: 'visual-system-focus-missing', severity: 'minor', label: 'no focus intent', files: [],
        evidence: capEv('a highly interactive site shows no focus/focus-visible styling — verify keyboard focus is visible'),
        repairInstruction: capEv('Add a visible focus-visible ring to interactive elements.') });
    }
    if (units.length >= MIN_UNITS && !/(?:sm|md|lg):(?:text-|p[xy]?-|gap-|leading-)/.test(codeSrc)) {
      push({ code: 'visual-system-mobile-typography-risk', severity: 'minor', label: 'no responsive typography intent', files: [],
        evidence: capEv('no responsive typography/spacing prefixes detected — verify mobile does not shrink body text or crush spacing'),
        repairInstruction: capEv('Add responsive typography/spacing adjustments per the responsive obligations.') });
    }
    // Text-over-image without a scrim (per unit) → warning.
    let textOverImage = 0;
    for (const u of units) {
      const hasImg = /<img\b|<picture\b|background-image|data-korvix-image-slot/i.test(u.content);
      const hasOverlayText = /absolute[^>]*(?:<h1|<h2|text-white)/i.test(u.content) || (/<img\b/i.test(u.content) && /absolute/.test(u.content) && /text-white/.test(u.content));
      const hasScrim = /bg-black\/|bg-gradient|from-black|backdrop-blur|scrim|overlay|bg-\[rgba/i.test(u.content);
      if (hasImg && hasOverlayText && !hasScrim) textOverImage += 1;
    }
    if (textOverImage >= 1) {
      push({ code: 'visual-system-text-over-image', severity: 'minor', label: 'text over image without scrim', files: [],
        evidence: capEv(`${textOverImage} section(s) place text over imagery without a clear scrim/overlay — verify readability`),
        repairInstruction: capEv('Add a scrim/gradient overlay or a protected panel behind text placed over imagery.') });
    }

    const readabilityFindingCount = (transparentBody >= 2 || sameTokenTextBg >= 1 ? 1 : 0) + textOverImage;
    const responsiveFindingCount = issues.filter((i) => i.code === 'visual-system-mobile-typography-risk').length;
    const blocking = issues.some((i) => i.severity !== 'minor');
    const warned = issues.some((i) => i.severity === 'minor');
    const status: VisualSystemAcceptanceResult['status'] = blocking ? 'fail' : warned ? 'warning' : 'pass';
    return {
      status, legacy: false, analyzedSectionCount: units.length, tokenSource, tokenConsumed,
      arbitraryValueCount, chromeRepeatSectionCount: chromeRepeat, readabilityFindingCount, responsiveFindingCount,
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
      visualSystemAcceptanceStatus: live.status,
      visualSystemIssueCodes: visualSystemIssueCodes(live),
    } : {}),
  };
}
