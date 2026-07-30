/**
 * Web Build BRAND DESIGN SYSTEM COMPILER (PR #522).
 *
 * A DETERMINISTIC translation layer — NOT a new design agent, NOT another planner, NO model call.
 * It compiles the EXISTING design intelligence (Experience Architecture + its Layout / Signature /
 * Asset strategies, the spec's Design-System prose + chosen palette, the business category, and
 * the user's explicit visual requests) into ONE concrete-but-flexible, typed `BrandDesignSystem`
 * so the frontend coding model implements a COHERENT design system instead of re-inventing the
 * same dark/purple template with arbitrary per-component CSS.
 *
 * It NESTS inside the Hard Generation Contract (one BINDING sub-section — never a second block),
 * and its conservative static checks feed the EXISTING contract-compliance validator → the
 * EXISTING single bounded repair (never a second validator/repair). Explicit user requests always
 * win. Bounded, model-facing prose (no scores / confidence / reasoning / raw enums). Fail-open.
 *
 * Feature flag (default OFF → the request + validation are byte-for-byte unchanged):
 *     VITE_ENABLE_BRAND_DESIGN_SYSTEM=false
 * It is only active when the Hard Generation Contract is also active (it must never create a
 * competing standalone prompt block).
 */
import type {
  ExperienceArchitecturePlan, FrontendBuildSpecification, BrandDesignSystem,
  BrandColorMode, BrandTypographyPersonality, BrandDensity, BrandRadiusStyle, BrandCardPolicy,
  FrontendGeneratedFile,
} from '@/lib/webBuildAgents';
import type { ContractFinding } from '@/lib/webBuildGenerationContract';

export function isBrandDesignSystemEnabled(): boolean {
  try {
    const raw = (import.meta as unknown as { env?: Record<string, unknown> })?.env?.VITE_ENABLE_BRAND_DESIGN_SYSTEM;
    return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const MAX_FIELD = 200;
const MAX_LIST = 10;
const cap = (v: string): string => (v.length > MAX_FIELD ? v.slice(0, MAX_FIELD) : v).trim();
function cleanList(xs: ReadonlyArray<string | undefined | null>, n = MAX_LIST): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of xs) {
    const t = cap(s(raw));
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= n) break;
  }
  return out;
}

/* ── Explicit visual overrides (read ONLY from the real request + directives) ──*/
export interface ExplicitDesign {
  wantsDark: boolean; wantsLight: boolean;
  wantsSharp: boolean; wantsRounded: boolean; wantsPill: boolean;
  wantsPurpleOrNeon: boolean;
  typographyFirst: boolean; compact: boolean; spacious: boolean;
  playful: boolean; minimal: boolean;
  /** The user asked for a deliberately many-coloured / eclectic / brutalist look. */
  multicolor: boolean;
  /** Any specific colour word the user named (so we never forbid a requested colour). */
  namedColors: string[];
}

const COLOR_WORDS = ['purple', 'violet', 'indigo', 'blue', 'navy', 'teal', 'cyan', 'green', 'emerald', 'lime', 'yellow', 'amber', 'gold', 'orange', 'red', 'crimson', 'pink', 'rose', 'magenta', 'brown', 'beige', 'cream', 'black', 'white', 'gray', 'grey', 'monochrome'];

export function readExplicitDesign(explicit: string): ExplicitDesign {
  const t = ` ${(explicit || '').toLowerCase().replace(/\s+/g, ' ')} `;
  const has = (re: RegExp): boolean => re.test(t);
  return {
    wantsDark: has(/dark (mode|theme|palette|background|ui)|dark[- ]themed|black background/),
    wantsLight: has(/light (mode|theme|palette|background)|bright|airy|white background/),
    wantsSharp: has(/sharp (corner|edge)|square corner|no rounded|hard edge|angular/),
    wantsRounded: has(/rounded|soft corner|friendly shape/),
    wantsPill: has(/pill|fully rounded|circular button/),
    wantsPurpleOrNeon: has(/purple|violet|neon|cyberpunk|futuristic|glow/),
    typographyFirst: has(/typography[- ]first|type[- ]led|text[- ]only|no images|minimal(ist)? (landing|type)/),
    compact: has(/compact|dense|data[- ]dense|information[- ]dense|tight/),
    spacious: has(/spacious|airy|lots of (white ?space|breathing)|generous spacing|editorial/),
    playful: has(/playful|fun|friendly|kids?|children|whimsical|colou?rful for kids/),
    minimal: has(/minimal|clean|understated|restrained|sparse/),
    multicolor: has(/multi[- ]?colou?r|colou?rful|rainbow|vibrant palette|eclectic|brutalist|maximalist/),
    namedColors: COLOR_WORDS.filter((c) => t.includes(` ${c}`)),
  };
}

/* ── Category / signal helpers ────────────────────────────────────────────────*/
function planText(plan: ExperienceArchitecturePlan, spec?: FrontendBuildSpecification): string {
  const ds = spec?.designSystem;
  return [
    plan.experienceType, plan.entryPattern, plan.heroPattern,
    plan.layoutStrategy?.pageStructure, plan.layoutStrategy?.heroStyle,
    plan.signature?.emotionalGoal, plan.signature?.attentionStrategy,
    spec?.identity?.siteType, spec?.identity?.sector, spec?.identity?.subsector, spec?.identity?.primaryConcept,
    ds?.selectedVisualDirection, ds?.designThesis, ds?.firstImpression, ds?.paletteFamily, ds?.visualSignature,
    ds?.typographyDirection,
  ].map((v) => s(v).toLowerCase()).join(' ');
}

function isAppLike(plan: ExperienceArchitecturePlan): boolean {
  return plan.landingRequired === false
    || plan.layoutStrategy?.pageStructure === 'application'
    || plan.heroContentPriority === 'none'
    || /app-first/.test(plan.entryPattern || '');
}
function isEditorialLike(plan: ExperienceArchitecturePlan, ctx: string): boolean {
  return /atmosphere|editorial|work-showcase|showcase|portfolio|gallery/.test(`${plan.experienceType} ${plan.entryPattern} ${plan.layoutStrategy?.pageStructure || ''}`)
    || plan.primaryVisualMedium === 'photography'
    || /editorial|gallery|portfolio|atmosphere|magazine|luxury|restaurant|hospitality|architecture/.test(ctx);
}
function isMinimal(plan: ExperienceArchitecturePlan, ex: ExplicitDesign): boolean {
  return ex.minimal || ex.typographyFirst
    || plan.textDensity === 'low'
    || plan.layoutStrategy?.contentDensity === 'minimal'
    || plan.signature?.interactionPattern === 'minimal_static'
    || plan.primaryVisualMedium === 'typography';
}

/* ── Field derivations ────────────────────────────────────────────────────────*/
function deriveMode(spec: FrontendBuildSpecification | undefined, ex: ExplicitDesign): BrandColorMode {
  if (ex.wantsDark) return 'dark';
  if (ex.wantsLight) return 'light';
  // Respect the ALREADY-chosen palette when present (never re-invent it).
  const bg = s(spec?.designSystem?.colorTokens?.background);
  const fam = `${s(spec?.designSystem?.paletteFamily)} ${s(spec?.designSystem?.paletteDecision)}`.toLowerCase();
  if (bg) {
    const dark = /^#?(0|1|2|3)/.test(bg.replace(/[^#0-9a-f]/gi, '').replace('#', ''))
      || /rgb\(\s*([0-4]?\d)\b/.test(bg) || /\b(0|1|2|3|4)\d?%\)/.test(bg);
    if (/black|midnight|noir|obsidian|dark/.test(fam) || dark) return 'dark';
    return 'light';
  }
  if (/dark|midnight|noir|black/.test(fam)) return 'dark';
  // Default: LIGHT. Never assume dark/purple just because a product is AI/tech.
  return 'light';
}

function derivePersonality(plan: ExperienceArchitecturePlan, ctx: string, ex: ExplicitDesign): BrandTypographyPersonality {
  if (ex.playful || /kids?|children|education|learning|playful|toy|game/.test(ctx)) return 'playful';
  // Photography/atmosphere/showcase brands are EDITORIAL first (a luxury restaurant is editorial,
  // not "heritage") — heritage is the narrower fallback for heritage/artisan brands that are NOT
  // image-led editorial experiences.
  if (isEditorialLike(plan, ctx)) return 'editorial';
  if (/heritage|artisan|craft|old[- ]world|winery|couture|bespoke/.test(ctx)) return 'heritage';
  if (isAppLike(plan) || /dashboard|admin|console|operations|ops\b/.test(ctx)) return 'utilitarian';
  if (/developer|api|infrastructure|technical|engineering|protocol|sdk|database/.test(ctx)) return 'technical';
  if (/geometric|modern|minimal|swiss|grid/.test(ctx)) return 'geometric';
  return 'humanist';
}

function deriveDensity(plan: ExperienceArchitecturePlan, ctx: string, ex: ExplicitDesign): BrandDensity {
  if (ex.compact) return 'compact';
  if (ex.spacious) return 'spacious';
  if (isAppLike(plan) || /dashboard|admin|console|data|operations/.test(ctx)) return 'compact';
  if (plan.layoutStrategy?.contentDensity === 'rich') return 'compact';
  if (isEditorialLike(plan, ctx) || plan.layoutStrategy?.contentDensity === 'minimal') return 'spacious';
  return 'balanced';
}

function deriveRadius(personality: BrandTypographyPersonality, ex: ExplicitDesign): BrandRadiusStyle {
  if (ex.wantsSharp) return 'sharp';
  if (ex.wantsPill) return 'pill-accented';
  if (ex.wantsRounded || personality === 'playful') return 'rounded';
  if (personality === 'editorial' || personality === 'heritage') return 'sharp';
  if (personality === 'geometric') return 'sharp';
  return 'subtle';
}

function deriveCardPolicy(plan: ExperienceArchitecturePlan, ctx: string, ex: ExplicitDesign): BrandCardPolicy {
  if (isMinimal(plan, ex)) return 'minimal';
  if (isEditorialLike(plan, ctx)) return 'exceptional';
  if (isAppLike(plan) || plan.heroContentPriority === 'product_ui' || plan.primaryVisualMedium === 'product_ui') return 'functional';
  return 'standard';
}

/* ── The compiler ─────────────────────────────────────────────────────────────*/
export interface BrandCompileContext {
  spec?: FrontendBuildSpecification;
  explicitRequest?: string;
}

/**
 * Compile the typed Brand Design System from the EXISTING plan (+ optional spec design fields and
 * the user's explicit request). Returns `undefined` when the flag is off or there is no usable
 * plan. Pure + fail-open — never throws. Explicit user requests always win.
 */
export function compileBrandDesignSystem(
  plan: ExperienceArchitecturePlan | undefined,
  ctxIn?: BrandCompileContext,
): BrandDesignSystem | undefined {
  try {
    if (!isBrandDesignSystemEnabled()) return undefined;
    if (!plan || plan.version !== 'experience-arch-v1') return undefined;
    const spec = ctxIn?.spec;
    const directives = [
      ...(plan.userDirectives || []), ...(plan.signature?.userDirectives || []),
      ...(plan.assetStrategy?.userDirectives || []), ...(plan.layoutStrategy?.userDirectives || []),
    ].join(' ');
    const ex = readExplicitDesign(`${s(ctxIn?.explicitRequest)} ${directives}`);
    const ctx = planText(plan, spec);

    const mode = deriveMode(spec, ex);
    const personality = derivePersonality(plan, ctx, ex);
    const density = deriveDensity(plan, ctx, ex);
    const radiusStyle = deriveRadius(personality, ex);
    const cardPolicy = deriveCardPolicy(plan, ctx, ex);
    const tokens = spec?.designSystem?.colorTokens || {};
    const tok = (k: string): string => s(tokens[k]);
    const chosen = (k: string, label: string): string => (tok(k) ? ` (chosen: ${tok(k)})` : ` (${label})`);

    const baseLabel = mode === 'dark' ? 'a deep neutral base, not pure black' : 'a clean neutral base (warm or cool off-white per the brand), not stark';
    const colorSystem = {
      mode,
      background: `Define --background as ${baseLabel}${chosen('background', 'from the brand direction')}.`,
      surface: `Define --surface for content surfaces, one small step from the background${chosen('surface', 'subtle contrast')}.`,
      elevatedSurface: `Define an elevated surface token for the few raised elements${chosen('card', 'a touch more contrast, no heavy shadow')}.`,
      textPrimary: `Define --foreground for primary text with strong contrast on the background${chosen('foreground', 'AA+ contrast')}.`,
      textSecondary: `Define a muted text token for secondary copy${chosen('muted', 'still readable, never faint')}.`,
      accent: `Define a SINGLE restrained brand accent used sparingly for emphasis and CTAs${chosen('accent', 'business-specific, coherent with the direction')}.`,
      accentContrast: 'Define an on-accent text token that meets contrast on the accent.',
      border: `Define --border as a low-contrast hairline${chosen('border', 'subtle, not decorative')}.`,
      muted: `Define a muted/subtle token for backgrounds of quiet regions${chosen('muted', 'quiet, coherent')}.`,
      usageRules: cleanList([
        'Define the palette ONCE — CSS custom properties in the global stylesheet (:root) OR a single tokens/theme module — and reference those tokens everywhere.',
        'Never scatter raw hex or invent per-component colors; every section shares the SAME token system.',
        `Keep to ${mode} mode consistently across all sections.`,
        'The accent is used sparingly; the base + neutrals carry most of the page.',
      ], 6),
    };

    const typographyGuidance: Record<BrandTypographyPersonality, { heading: string; body: string; pairing: string; tracking: string }> = {
      editorial: { heading: 'a refined serif or high-contrast display face with generous size', body: 'a readable serif or humanist sans at a comfortable measure', pairing: 'editorial serif display + clean sans/serif body', tracking: 'slightly tight display, normal body' },
      geometric: { heading: 'a geometric sans with confident weight', body: 'a neutral geometric/grotesk sans', pairing: 'one geometric sans family across weights', tracking: 'tight display, normal body' },
      humanist: { heading: 'a warm humanist sans with clear hierarchy', body: 'a humanist sans at a relaxed measure', pairing: 'one humanist sans, varied weights', tracking: 'normal' },
      technical: { heading: 'a precise grotesk/neo-grotesk sans', body: 'a legible sans; monospace only for real code/data', pairing: 'grotesk sans + optional mono for data', tracking: 'normal, slightly tight labels' },
      heritage: { heading: 'a classic serif with heritage character', body: 'a readable serif or old-style body', pairing: 'heritage serif + restrained sans accents', tracking: 'normal' },
      playful: { heading: 'a friendly rounded or characterful display face', body: 'a clear, friendly sans', pairing: 'characterful display + simple sans body, kept legible', tracking: 'normal, never cramped' },
      utilitarian: { heading: 'a compact, functional sans for UI labels and titles', body: 'a legible UI sans at a smaller scale', pairing: 'one UI sans family; mono for data columns', tracking: 'tight labels, normal body' },
    };
    const tg = typographyGuidance[personality];
    const displayScale = density === 'compact' ? 'restrained display sizes (UI-appropriate, not marketing-huge)'
      : density === 'spacious' ? 'confident, large display sizes with clear jumps between levels'
        : 'clear, moderate display sizes with distinct heading levels';
    const typographySystem = {
      personality,
      headingStyle: cap(`Headings: ${tg.heading}.`),
      bodyStyle: cap(`Body: ${tg.body}.`),
      displayScale: cap(displayScale),
      bodyScale: density === 'compact' ? 'compact body (14–15px base), tight leading for data' : 'comfortable body (16–18px base)',
      lineHeight: density === 'spacious' ? 'generous line-height for reading' : density === 'compact' ? 'tighter line-height for dense UI' : 'balanced line-height',
      tracking: tg.tracking,
      measure: personality === 'editorial' || personality === 'heritage' ? 'a comfortable reading measure (~60–75ch) for long copy' : 'a controlled measure; avoid full-width paragraphs',
      fontPairingGuidance: cap(`${tg.pairing}. Keep to at most two families; establish ONE clear type hierarchy and reuse it everywhere.`),
    };

    const spacingSystem = {
      density,
      baseUnit: 'Use one spacing scale (a 4px or 8px base); never arbitrary magic values.',
      sectionSpacing: density === 'spacious' ? 'large, deliberate spacing between sections' : density === 'compact' ? 'tight section spacing appropriate to a dense app' : 'moderate, even section spacing',
      componentSpacing: density === 'compact' ? 'compact internal padding for dense controls' : 'consistent internal padding from the same scale',
      contentWidth: isEditorialLike(plan, ctx) ? 'a controlled editorial content width with intentional whitespace' : isAppLike(plan) ? 'a wide app content area that uses the available width' : 'a centered content width with comfortable gutters',
      rhythmRules: cleanList([
        'Derive all spacing from ONE scale — no arbitrary pixel values scattered per component.',
        density === 'spacious' ? 'Whitespace is intentional and generous; let content breathe.' : density === 'compact' ? 'Density is intentional; keep alignment and rhythm tight and consistent.' : 'Keep a consistent vertical rhythm across sections.',
      ], 4),
    };

    const shapeGuidance: Record<BrandRadiusStyle, { scale: string; border: string; shadow: string }> = {
      sharp: { scale: 'near-zero radius (0–2px); crisp corners', border: 'hairline borders define structure; borders over shadows', shadow: 'flat — avoid drop shadows; use borders and spacing for separation' },
      subtle: { scale: 'a small consistent radius (~6–10px) applied uniformly', border: 'subtle borders where grouping is needed', shadow: 'restrained, soft shadows only where elevation is meaningful' },
      rounded: { scale: 'a friendly, consistent radius (~12–20px)', border: 'soft borders; rounded consistently', shadow: 'soft, cohesive shadows kept consistent' },
      'pill-accented': { scale: 'pill/fully-rounded for buttons + pills; a consistent moderate radius elsewhere', border: 'clean borders; pills read as intentional accents', shadow: 'light, consistent shadows' },
    };
    const sh = shapeGuidance[radiusStyle];
    const shapeSystem = {
      radiusStyle,
      radiusScale: cap(sh.scale),
      borderStyle: cap(sh.border),
      shadowStyle: cap(sh.shadow),
    };

    const buttonStyle = radiusStyle === 'sharp' ? 'crisp, confident buttons with clear primary/secondary hierarchy; minimal or no radius'
      : radiusStyle === 'pill-accented' ? 'pill primary buttons as an accent; secondary quieter'
        : radiusStyle === 'rounded' ? 'friendly rounded buttons with a clear primary'
          : 'clean buttons with a small consistent radius and a single clear primary';
    const imageTreatment = plan.primaryVisualMedium === 'photography' ? 'Photography/editorial imagery is a primary element; treat it full-bleed or generously, never as a tiny decorative thumbnail.'
      : plan.primaryVisualMedium === 'typography' || ex.typographyFirst ? 'No decorative imagery; rely on typography, space and structure.'
        : plan.primaryVisualMedium === 'product_ui' || plan.heroContentPriority === 'product_ui' ? 'Show real product UI; do NOT substitute decorative stock or fake dashboards.'
          : 'Use imagery only where it adds real meaning; no filler stock.';
    const componentLanguage = {
      buttonStyle: cap(buttonStyle),
      cardPolicy,
      navigationStyle: isAppLike(plan) ? 'app navigation (sidebar or compact top bar) suited to the workspace' : isEditorialLike(plan, ctx) ? 'a light, editorial top navigation that stays out of the way' : 'a clear, conventional top navigation with an obvious primary action',
      inputStyle: cap(`Inputs share the shape system (${radiusStyle}); consistent focus states from the accent.`),
      iconStyle: personality === 'playful' ? 'friendly, consistent icons; never mixed icon sets' : 'one consistent, restrained icon set (single stroke weight)',
      imageTreatment: cap(imageTreatment),
    };

    const heroDominanceMap: Record<string, string> = {
      interaction: 'a functional product/interactive demo dominates the first viewport',
      product_ui: 'real product UI dominates the first viewport',
      media: 'editorial media dominates the first viewport',
      catalog: 'the catalog/work dominates the first viewport',
      content: 'a specific value proposition leads, supported — not a giant generic headline',
      text: 'a concrete headline with real supporting copy leads',
      none: 'no marketing hero; open into the workspace',
    };
    const visualHierarchy = {
      heroDominance: cap(heroDominanceMap[plan.heroContentPriority] || 'the primary business experience leads the first viewport'),
      headingContrast: density === 'compact' ? 'clear but restrained heading-to-body contrast for a working UI' : 'strong, deliberate heading-to-body size/weight contrast',
      contentDensity: density,
      emphasisRules: cleanList([
        'Establish ONE emphasis system (size, weight, colour, space) and reuse it — do not invent new emphasis per section.',
        'Use the accent for emphasis sparingly; over-accenting flattens hierarchy.',
      ], 4),
    };

    // Forbidden visual defaults — strict UNLESS the user explicitly requested them.
    const forbid: string[] = [
      'inventing unrelated colours or radii per component instead of one token system',
      'arbitrary magic spacing / hex values scattered across components',
    ];
    if (!ex.wantsPurpleOrNeon && !ex.namedColors.includes('purple') && !ex.namedColors.includes('violet')) {
      forbid.push('the default dark-purple / neon AI aesthetic and violet gradients');
    }
    if (cardPolicy === 'exceptional' || cardPolicy === 'minimal') {
      forbid.push('wrapping every section in identical rounded shadow cards');
    }
    if (personality === 'editorial' || personality === 'heritage' || isMinimal(plan, ex)) {
      forbid.push('unnecessary gradients and heavy drop shadows');
    }
    if (density === 'compact' || isAppLike(plan)) {
      forbid.push('oversized marketing-hero whitespace inside a functional app');
    }
    if (!ex.multicolor) {
      forbid.push('anonymous startup-template styling with no brand-specific point of view');
    }

    const creativeFreedom = cleanList([
      'the exact palette values within the chosen mode and direction',
      'micro-interactions and hover/focus states',
      'the internal composition within each section',
      'iconography and imagery choices within the stated treatment',
    ], 6);

    return {
      version: 'brand-design-system-v1',
      colorSystem,
      typographySystem,
      spacingSystem,
      shapeSystem,
      componentLanguage,
      visualHierarchy,
      forbiddenVisualDefaults: cleanList(forbid, MAX_LIST),
      creativeFreedom,
    };
  } catch {
    return undefined;
  }
}

/* ── Binding sub-section rendered INSIDE the Hard Generation Contract block ─────*/
export function renderBrandDesignSystemBlock(system: BrandDesignSystem | undefined): string {
  if (!system || system.version !== 'brand-design-system-v1') return '';
  const c = system.colorSystem, t = system.typographySystem, sp = system.spacingSystem;
  const sh = system.shapeSystem, cl = system.componentLanguage, vh = system.visualHierarchy;
  const lines = [
    'BRAND DESIGN SYSTEM — BINDING (implement ONE coherent system; do not re-invent styling per component):',
    '- Define a SINGLE source of truth: CSS custom properties in the global stylesheet (:root) or one central tokens/theme module. Reference those tokens everywhere; never scatter raw hex or magic spacing.',
    `- Colour mode: ${c.mode}. ${c.usageRules.join(' ')}`,
    `- Colour tokens: ${[c.background, c.surface, c.textPrimary, c.textSecondary, c.accent, c.border].join(' ')}`,
    `- Typography (${t.personality}): ${t.headingStyle} ${t.bodyStyle} ${t.displayScale}. ${t.fontPairingGuidance} Use this ONE type hierarchy in every section.`,
    `- Spacing (${sp.density}): ${sp.baseUnit} ${sp.sectionSpacing}; ${sp.contentWidth}. ${sp.rhythmRules.join(' ')}`,
    `- Shape (${sh.radiusStyle}): ${sh.radiusScale}; ${sh.borderStyle}; ${sh.shadowStyle}. Apply the radius uniformly.`,
    `- Components: buttons — ${cl.buttonStyle} Card policy — ${cl.cardPolicy}: ${cardPolicyLine(system)} Navigation — ${cl.navigationStyle}. Icons — ${cl.iconStyle}. Images — ${cl.imageTreatment}`,
    `- Visual hierarchy: ${vh.heroDominance}; ${vh.headingContrast}. ${vh.emphasisRules.join(' ')}`,
    `- FORBIDDEN visual defaults (strict unless the user explicitly asked): ${system.forbiddenVisualDefaults.join('; ')}.`,
    `- Free within the system: ${system.creativeFreedom.join('; ')}.`,
  ];
  return lines.join('\n');
}
function cardPolicyLine(system: BrandDesignSystem): string {
  const map: Record<BrandCardPolicy, string> = {
    exceptional: 'cards are exceptional, not the default; prefer open composition and type/image hierarchy.',
    minimal: 'prefer whitespace and open composition; few or no cards.',
    functional: 'real UI surfaces where the app needs them; no decorative fake dashboards.',
    standard: 'coherent, consistent cards; never a wall of identical marketing cards.',
  };
  return map[system.componentLanguage.cardPolicy];
}

/* ── Conservative static compliance (STRONG evidence only; fed into the EXISTING
 *    contract validator → EXISTING single bounded repair). Never a second validator. ──*/
const HEX_RE = /#[0-9a-fA-F]{6}\b/g;
const ARBITRARY_HEX_UTILITY_RE = /(?:bg|text|border|from|to|via|fill|stroke|ring)-\[#[0-9a-fA-F]{3,8}\]/g;
const CARD_RE = /rounded-(?:md|lg|xl|2xl|3xl)[^"'`]*shadow(?:-[a-z0-9]+)?[^"'`]*(?:border|bg-)/g;
const RADIUS_TOKEN_RE = /\brounded-(?:none|sm|md|lg|xl|2xl|3xl|full)\b/g;
const CENTRAL_TOKEN_RE = /:root\s*\{[^}]*--[a-z]/i;               // CSS custom properties in a stylesheet
const THEME_MODULE_RE = /export\s+(?:const|default)\s+\w*(?:designSystem|theme|tokens|palette)\b|as\s+const/i;
const CHART_CONTEXT_RE = /recharts|chart|<Cell\b|COLORS\s*=|dataKey|nivo|visx|d3-/i;
const CODE_HL_RE = /syntax|highlight|prism|hljs|shiki|token-/i;

/**
 * Extend the contract compliance validator with the Brand Design System's conservative checks.
 * Returns extra ContractFindings (same shape as the existing checks) so they ride the EXISTING
 * merge → EXISTING single bounded repair. STRONG evidence only; heavy false-positive guards.
 */
export function evaluateBrandDesignCompliance(
  files: FrontendGeneratedFile[],
  system: BrandDesignSystem,
  explicit: ExplicitDesign,
): ContractFinding[] {
  const out: ContractFinding[] = [];
  try {
    const cssFiles = files.filter((f) => /\.css$/i.test(f.path));
    const codeFiles = files.filter((f) => /\.(t|j)sx?$/i.test(f.path));
    const blob = files.map((f) => f.content || '').join('\n');
    const cssBlob = cssFiles.map((f) => f.content || '').join('\n');

    const hasCentralTokens = CENTRAL_TOKEN_RE.test(cssBlob) || THEME_MODULE_RE.test(blob);

    // Count arbitrary per-component colours OUTSIDE chart / syntax-highlight contexts.
    const arbitraryColors = new Set<string>();
    let componentFilesWithColor = 0;
    for (const f of codeFiles) {
      const content = f.content || '';
      if (CHART_CONTEXT_RE.test(content) || CODE_HL_RE.test(content)) continue;   // charts / highlighting allowed
      const utils = content.match(ARBITRARY_HEX_UTILITY_RE) || [];
      const bare = (content.match(HEX_RE) || []).filter(() => true);
      const localColors = new Set<string>([...utils, ...bare.map((h) => h.toLowerCase())]);
      if (localColors.size > 0) componentFilesWithColor += 1;
      localColors.forEach((c) => arbitraryColors.add(c.toLowerCase()));
    }

    // 1. Excessive hardcoded colours with NO central token source — strong evidence of an
    //    inconsistent, non-tokenised palette. Skipped for intentionally multicolour/eclectic brands.
    if (!explicit.multicolor && !hasCentralTokens && arbitraryColors.size >= 8 && componentFilesWithColor >= 3) {
      out.push({
        code: 'brand-missing-central-tokens', severity: 'major',
        message: `The brand system requires ONE coherent token source, but ${arbitraryColors.size} arbitrary colours are hardcoded across components with no central CSS-variable or theme definition.`,
        repairInstruction: 'Preserve all content and layout. Define the palette ONCE as CSS custom properties in the global stylesheet (:root) or a single tokens/theme module, then reference those tokens everywhere — do not patch colours component-by-component.',
      });
    } else if (!explicit.multicolor && hasCentralTokens && arbitraryColors.size >= 12 && componentFilesWithColor >= 4) {
      // 2. A token source EXISTS but many components still bypass it with unrelated hex.
      out.push({
        code: 'brand-inconsistent-hardcoded-colors', severity: 'major',
        message: `A central token source exists, but ${arbitraryColors.size} unrelated hardcoded colours across sections bypass it, producing inconsistent palettes between sections.`,
        repairInstruction: 'Preserve content and section order. Replace the scattered hardcoded colours with the central tokens so every section shares one coherent palette.',
      });
    }

    // 3. Excessive identical card containers when the card policy is exceptional/minimal.
    if (system.componentLanguage.cardPolicy === 'exceptional' || system.componentLanguage.cardPolicy === 'minimal') {
      const cards = (blob.match(CARD_RE) || []).length;
      if (cards >= 5) {
        out.push({
          code: 'brand-excessive-cards', severity: 'major',
          message: `The brand system's card policy is "${system.componentLanguage.cardPolicy}" (cards should be rare/open composition preferred), but ${cards} rounded shadow-card containers are used.`,
          repairInstruction: 'Preserve content and section order. Remove unnecessary card containers from editorial/minimal sections, converting them to open grid/list compositions; retain cards only where grouping is functionally necessary.',
        });
      }
    }

    // 4. Inconsistent radius vs a sharp shape policy (many distinct radii despite "sharp").
    if (system.shapeSystem.radiusStyle === 'sharp' && !explicit.wantsRounded) {
      const radii = new Set((blob.match(RADIUS_TOKEN_RE) || []).map((r) => r.toLowerCase()));
      radii.delete('rounded-none');
      const big = [...radii].filter((r) => /(lg|xl|2xl|3xl|full)/.test(r));
      if (radii.size >= 4 && big.length >= 2) {
        out.push({
          code: 'brand-radius-conflicts-sharp-policy', severity: 'minor',
          message: `The brand system specifies a sharp/low-radius shape language, but ${radii.size} different radius sizes (including large rounded values) are used inconsistently.`,
          repairInstruction: 'Preserve content. Apply one low radius uniformly (per the shape system); remove the large arbitrary rounded values that conflict with the sharp shape language.',
        });
      }
    }
    return out;
  } catch {
    return out;
  }
}
