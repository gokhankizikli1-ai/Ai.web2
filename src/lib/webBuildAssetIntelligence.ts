/**
 * Web Build ASSET INTELLIGENCE LAYER (PR #512).
 *
 * Decides WHAT visual assets a website needs before generation — hero asset, per-section
 * needs, real-vs-generated preference, authenticity and media priority. It is a lightweight,
 * DETERMINISTIC strategy layer, NOT a new intelligence system and NOT a competing plan: it
 * consumes existing outputs only (the already-built ExperienceArchitecturePlan + its
 * Signature, the spec's asset signals — which already carry Visual Intelligence's decisions —
 * and the user request) and NESTS a typed AssetStrategy onto that same plan
 * (`plan.assetStrategy`). ZERO extra model calls.
 *
 * `deriveAssetStrategy` is pure, synchronous, network-free, bounded, JSON-serializable and
 * FAILS OPEN (returns `undefined` on any problem, never throws).
 *
 * Rules honoured: images are NEVER forced on every site (typography/none sections get no
 * asset); dashboard / "no images" requests set the hero asset to none; real product proof is
 * never replaced by decorative imagery; explicit user intent wins.
 *
 * Feature flag (default OFF → no asset strategy is attached; the plan is byte-for-byte the
 * prior contract):
 *
 *     VITE_ENABLE_ASSET_INTELLIGENCE=false
 */
import type {
  FrontendBuildSpecification, ExperienceArchitecturePlan, AssetStrategy, AssetHeroKind,
  AssetSectionKind, AssetSectionNeed, AssetSourcePreference, AssetVisualAuthenticity,
  AssetMediaPriority, ExperienceVisualMedium,
} from '@/lib/webBuildAgents';

export function isAssetIntelligenceEnabled(): boolean {
  try {
    const raw = (import.meta as unknown as { env?: Record<string, unknown> })?.env?.VITE_ENABLE_ASSET_INTELLIGENCE;
    return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}

const MAX_SECTION_ASSETS = 24;
const MAX_AVOID = 10;
const MAX_DIRECTIVES = 6;
const MAX_FIELD = 160;
const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const cap = (v: string): string => (v.length > MAX_FIELD ? v.slice(0, MAX_FIELD) : v).trim();

function cleanList(xs: ReadonlyArray<string | undefined | null> | undefined, n = MAX_AVOID): string[] {
  if (!Array.isArray(xs)) return [];
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

interface AssetDefault {
  heroAsset: AssetHeroKind;
  assetSourcePreference: AssetSourcePreference;
  visualAuthenticity: AssetVisualAuthenticity;
  mediaPriority: AssetMediaPriority;
  avoid: string[];
}

/* Per experience-type defaults (keyed to the plan's `experienceType`). All overridable by
 * explicit user intent below. */
const DEFAULTS: Record<string, AssetDefault> = {
  'atmosphere-editorial': {
    heroAsset: 'photography', assetSourcePreference: 'real_assets', visualAuthenticity: 'authentic',
    mediaPriority: 'storytelling', avoid: ['generic stock gradients', 'clip-art icons', 'dashboard cards'],
  },
  'catalog-commerce': {
    heroAsset: 'photography', assetSourcePreference: 'real_assets', visualAuthenticity: 'authentic',
    mediaPriority: 'conversion', avoid: ['fake lifestyle stock', 'long corporate storytelling imagery'],
  },
  'work-showcase': {
    heroAsset: 'photography', assetSourcePreference: 'real_assets', visualAuthenticity: 'authentic',
    mediaPriority: 'storytelling', avoid: ['generic feature-grid icons', 'filler stock photography'],
  },
  'product-demonstration': {
    heroAsset: 'interactive_demo', assetSourcePreference: 'mixed', visualAuthenticity: 'branded',
    mediaPriority: 'conversion', avoid: ['decorative node diagrams', 'meaningless metric charts', 'generic robot imagery'],
  },
  'trust-clarity': {
    heroAsset: 'photography', assetSourcePreference: 'mixed', visualAuthenticity: 'branded',
    mediaPriority: 'trust', avoid: ['cyberpunk/neon imagery', 'gimmicky effects', 'fake testimonial photos'],
  },
  'creative-showcase': {
    heroAsset: 'generated_art', assetSourcePreference: 'mixed', visualAuthenticity: 'branded',
    mediaPriority: 'storytelling', avoid: ['timid corporate stock', 'generic muted imagery'],
  },
  'content-editorial': {
    heroAsset: 'photography', assetSourcePreference: 'real_assets', visualAuthenticity: 'authentic',
    mediaPriority: 'storytelling', avoid: ['clickbait thumbnails', 'unrelated stock photos'],
  },
};

/** Map a section's already-decided visual medium → the concrete asset kind it needs. Returns
 *  `null` for media that need NO asset (typography/none/mixed) — so images are never forced. */
function mediumToAsset(medium: ExperienceVisualMedium): AssetSectionKind | null {
  switch (medium) {
    case 'photography': return 'photography';
    case 'product_ui': return 'product_render';
    case 'interactive_demo': return 'interactive_demo';
    case 'data_visualization': return 'data_visualization';
    case 'illustration': return 'illustration';
    case 'generated_art': return 'generated_art';
    case 'video_or_motion': return 'video';
    default: return null;   // typography | none | mixed → no dedicated asset
  }
}

/** Fallback hero asset for 'adaptive'/unknown types — from the plan's primary medium. */
function adaptiveHero(medium: ExperienceVisualMedium): AssetHeroKind {
  const mapped = mediumToAsset(medium);
  if (mapped === 'data_visualization') return 'product_render';
  return (mapped as AssetHeroKind) || 'none';
}

/* ── Explicit user overrides (these win) ──────────────────────────────────────*/
interface AssetOverrides {
  heroAsset?: AssetHeroKind;
  assetSourcePreference?: AssetSourcePreference;
  visualAuthenticity?: AssetVisualAuthenticity;
  mediaPriority?: AssetMediaPriority;
  noImages?: boolean;
  extraAvoid: string[];
  directives: string[];
}

function parseAssetOverrides(prompt: string): AssetOverrides {
  const p = (prompt || '').toLowerCase();
  const o: AssetOverrides = { extraAvoid: [], directives: [] };

  if (/\b(no|without|zero)\s+(image|images|photo|photos|photography|picture|pictures)\b/.test(p)
    || /\btext[-\s]?only\b/.test(p) || /\bicon[-\s]?only\b/.test(p)) {
    o.noImages = true;
    o.heroAsset = 'none';
    o.visualAuthenticity = 'abstract';
    o.extraAvoid.push('photographic imagery where it is not essential');
    o.directives.push('No images / text-only');
  }

  if (/\bdashboard\b/.test(p) || /\bapp\s+interface\b/.test(p) || /\bweb\s?app\b/.test(p) || /\badmin\s+(panel|interface)\b/.test(p)) {
    // Dashboards / app interfaces may require NO hero imagery.
    o.heroAsset = o.heroAsset || 'none';
    o.mediaPriority = o.mediaPriority || 'exploration';
    o.assetSourcePreference = o.assetSourcePreference || 'mixed';
    o.extraAvoid.push('decorative hero imagery on a functional app interface');
    o.directives.push('Dashboard / app interface');
  }

  if (/\b(real|authentic|our\s+own)\s+(photo|photos|photography|images|imagery)\b/.test(p) || /\bno\s+ai\s+(art|image|images)\b/.test(p)) {
    o.assetSourcePreference = o.assetSourcePreference || 'real_assets';
    o.visualAuthenticity = o.visualAuthenticity || 'authentic';
    o.directives.push('Real / authentic assets only');
  }

  if (/\b(ai[-\s]?art|ai[-\s]?generated|generated\s+art|illustration[-\s]?only|illustrations?\s+only)\b/.test(p)) {
    o.assetSourcePreference = o.assetSourcePreference || 'generated_assets';
    o.directives.push('Generated / illustrative assets');
  }

  if (/\bminimal(ist)?\b/.test(p) && !o.noImages) {
    o.extraAvoid.push('heavy or decorative imagery');
    o.directives.push('Minimal imagery');
  }

  return o;
}

/**
 * Derive the visual Asset Strategy from an already-built plan + spec + user prompt. Returns
 * `undefined` when the flag is off, there is no plan, or on any failure — so the caller
 * attaches nothing and the plan stays the prior contract. Never throws.
 */
export function deriveAssetStrategy(
  plan: ExperienceArchitecturePlan | undefined,
  spec: FrontendBuildSpecification | undefined,
  prompt: string,
): AssetStrategy | undefined {
  try {
    if (!isAssetIntelligenceEnabled()) return undefined;
    if (!plan || plan.version !== 'experience-arch-v1') return undefined;

    const base = DEFAULTS[plan.experienceType] || {
      heroAsset: adaptiveHero(plan.primaryVisualMedium),
      assetSourcePreference: 'mixed' as AssetSourcePreference,
      visualAuthenticity: 'branded' as AssetVisualAuthenticity,
      mediaPriority: 'exploration' as AssetMediaPriority,
      avoid: [],
    };
    const overrides = parseAssetOverrides(prompt);

    // Portfolio hero: "generated_art OR photography depending on existing work" — real work
    // present ⇒ photography; otherwise generated_art. Uses the spec's real-source signal.
    let heroAsset: AssetHeroKind = base.heroAsset;
    if (plan.experienceType === 'work-showcase') {
      const hasRealWork = (spec?.assets?.realSourceRequired || []).some(
        (r) => /(project|work|photo|portfolio|case)/i.test(s(r)),
      );
      heroAsset = hasRealWork ? 'photography' : 'generated_art';
    }
    if (overrides.heroAsset) heroAsset = overrides.heroAsset;

    // Per-section needs — reuse the section-level medium decisions already on the plan. Media
    // that need no asset (typography/none) are skipped, so images are never forced. When the
    // user asked for no images, only genuinely functional assets survive (product/data/demo).
    const sectionAssets: AssetSectionNeed[] = [];
    for (const c of (plan.sectionContracts || [])) {
      if (sectionAssets.length >= MAX_SECTION_ASSETS) break;
      const kind = mediumToAsset(c.visualMedium);
      if (!kind) continue;
      if (overrides.noImages && (kind === 'photography' || kind === 'illustration' || kind === 'generated_art' || kind === 'video')) {
        continue;   // honour "no images" — keep only functional product/data/demo assets
      }
      sectionAssets.push({
        sectionId: cap(s(c.id)),
        assetType: kind,
        // Preserve real product/data proof; never let a decorative image replace it.
        purpose: c.proofRequirement ? 'real product/data proof (not decorative)' : cap(s(c.purpose) || 'section visual'),
      });
    }

    // Avoid list: class avoid + explicit avoid + asset-relevant forbidden patterns + a staple
    // that protects real proof.
    const avoidAssets = cleanList([
      ...base.avoid,
      ...overrides.extraAvoid,
      'decorative images replacing real product proof',
      ...(plan.forbiddenPatterns || []).filter((f) => /(image|photo|stock|gradient|diagram|icon|neon|render|visual)/i.test(s(f))),
    ], MAX_AVOID);

    const strategy: AssetStrategy = {
      version: 'asset-strategy-v1',
      basis: overrides.directives.length > 0 ? 'user-override' : 'derived',
      heroAsset,
      sectionAssets,
      assetSourcePreference: overrides.assetSourcePreference || base.assetSourcePreference,
      visualAuthenticity: overrides.visualAuthenticity || base.visualAuthenticity,
      avoidAssets,
      mediaPriority: overrides.mediaPriority || base.mediaPriority,
      userDirectives: overrides.directives.slice(0, MAX_DIRECTIVES),
    };
    return strategy;
  } catch {
    return undefined;   // fail open — never break a build
  }
}

/**
 * Concise enforcement lines describing the asset strategy for the frontend_builder request.
 * Folded INTO the existing Experience Architecture enforcement block (not a second competing
 * block). Returns [] when no strategy — so the request is unchanged. No scores/reasoning.
 */
export function assetStrategyEnforcementLines(strategy: AssetStrategy | undefined): string[] {
  if (!strategy || strategy.version !== 'asset-strategy-v1') return [];
  const lines = [
    `- Hero asset: ${strategy.heroAsset}. "none" means DO NOT invent a decorative hero image;`
      + ` use layout/typography instead. Never force imagery where it isn't needed.`,
    `- Asset source: ${strategy.assetSourcePreference}; authenticity: ${strategy.visualAuthenticity};`
      + ` media priority: ${strategy.mediaPriority}.`,
    '- Deliver each sectionAssets[] entry with its assetType; real product/data proof must be'
      + ' genuine (never replaced by a decorative image).',
  ];
  if (strategy.avoidAssets.length) {
    lines.push(`- Never generate these asset patterns: ${strategy.avoidAssets.join('; ')}.`);
  }
  return lines;
}
