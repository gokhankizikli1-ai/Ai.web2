// promptCategory — shared, deterministic prompt → product-category
// classifier + brand-palette resolver used by BOTH Website Builder
// (siteContent.ts) and App Builder (appPreviewData.ts). One maintained
// keyword bank instead of two, so the two builders never disagree about
// what kind of product a prompt describes.
//
// Pure string matching — no LLM, no network, fully deterministic.

export type BuilderCategory =
  | 'finance' | 'analytics' | 'ecommerce' | 'education' | 'creator'
  | 'agency' | 'portfolio' | 'internal_tool' | 'saas' | 'ai' | 'dashboard';

// Order matters — first match wins. `analytics` is checked ahead of
// `ecommerce` so "a Shopify analytics dashboard" reads as an analytics
// product (KPI-first) rather than a storefront landing page; the
// ecommerce-flavored copy still surfaces inside the analytics bank via
// `detectRetailFlavor()`.
const RULES: Array<[BuilderCategory, RegExp]> = [
  ['finance', /financ\w*|trading|invest\w*|hedge\s*fund|banking|crypto\w*|brokerage|wealth\s*manag\w*|stock\s*market/i],
  ['analytics', /analytics?|\bkpi\b|insight\w*|data\s*viz|reporting\s*dashboard|metrics?\s*dashboard|telemetry/i],
  ['ecommerce', /e-?commerce|shopify|online\s*store|storefront|retail\w*|merchant\w*|\bshop\b|\bstore\b|marketplace/i],
  ['education', /course\w*|curriculum|classroom|student\w*|learn\w*|tutor\w*|\bschool\b|academy|\blms\b/i],
  ['creator', /creator\w*|newsletter|podcast\w*|content\s*calendar|influencer|social\s*media\s*manag\w*|\bblog\w*/i],
  ['agency', /\bagency\b|\bstudio\b|consult\w*|freelanc\w*|branding\s*(?:site|studio)/i],
  ['portfolio', /portfolio(?!\s*manag)|personal\s*(?:site|website|brand)|\bresume\b|showcase\s*my\s*work/i],
  ['internal_tool', /internal\s*tool|admin\s*panel|back[\s-]*office|ops\s*(?:tool|dashboard)|employee\s*portal|control\s*panel/i],
  ['saas', /\bsaas\b|\bcrm\b|sales\s*(?:pipeline|team)|\bleads?\b|subscription\s*product|workflow\s*automation/i],
  ['ai', /\bai\b|artificial\s*intelligence|\bllm\b|copilot|chatbot|machine\s*learning|automation\s*assistant/i],
];

export function detectCategory(prompt: string): BuilderCategory {
  const text = prompt || '';
  for (const [category, pattern] of RULES) {
    if (pattern.test(text)) return category;
  }
  return 'dashboard';
}

export const CATEGORY_LABELS: Record<BuilderCategory, string> = {
  finance: 'Finance & Trading',
  analytics: 'Analytics',
  ecommerce: 'Ecommerce',
  education: 'Education',
  creator: 'Creator & Productivity',
  agency: 'Agency',
  portfolio: 'Portfolio',
  internal_tool: 'Internal Tool',
  saas: 'SaaS',
  ai: 'AI Product',
  dashboard: 'Dashboard',
};

// A secondary, cross-cutting flavor: does the prompt describe a retail /
// commerce product regardless of its primary category? Used so an
// "analytics dashboard for a fashion store" gets revenue/inventory/
// campaign copy instead of generic web-traffic KPIs.
export function detectRetailFlavor(prompt: string): boolean {
  return /shopify|\bstore\b|retail\w*|fashion|apparel|merch\w*|product\s*catalog|inventory|boutique/i.test(prompt || '');
}

export interface BuilderPalette {
  label: string;
  /** Primary brand accent (hex). */
  accent: string;
  /** Secondary accent used in gradients (hex). */
  accent2: string;
  /** Text color to place on top of a solid/gradient accent fill. */
  onAccent: string;
  /** Soft rgba glow used behind hero/CTA blocks. */
  glow: string;
  /** Slightly stronger rgba used for rings/borders on accent surfaces. */
  ring: string;
}

const PALETTES: Record<string, BuilderPalette> = {
  'Black + Gold': {
    label: 'Black + Gold', accent: '#D4AF37', accent2: '#8A6E2F', onAccent: '#0a0a0a',
    glow: 'rgba(212,175,55,0.26)', ring: 'rgba(212,175,55,0.35)',
  },
  'Black + Cyan': {
    label: 'Black + Cyan', accent: '#22D3EE', accent2: '#6366F1', onAccent: '#05060a',
    glow: 'rgba(99,102,241,0.30)', ring: 'rgba(34,211,238,0.35)',
  },
  'White + Graphite': {
    label: 'White + Graphite', accent: '#CBD5E1', accent2: '#64748B', onAccent: '#0a0a0a',
    glow: 'rgba(148,163,184,0.22)', ring: 'rgba(203,213,225,0.32)',
  },
  'Purple + Indigo': {
    label: 'Purple + Indigo', accent: '#A78BFA', accent2: '#6366F1', onAccent: '#05060a',
    glow: 'rgba(139,92,246,0.30)', ring: 'rgba(167,139,250,0.35)',
  },
};

const DEFAULT_PALETTE = PALETTES['Black + Cyan'];

export function paletteForDirection(direction?: string | null): BuilderPalette {
  if (!direction) return DEFAULT_PALETTE;
  return PALETTES[direction] || DEFAULT_PALETTE;
}

// A short, url-safe brand token derived from the user's prompt — shared by
// both builders for the fake browser address bar / app slug.
const BRAND_STOPWORDS = new Set([
  'a', 'an', 'the', 'for', 'build', 'create', 'design', 'make', 'generate', 'develop',
  'website', 'landing', 'page', 'site', 'app', 'application', 'dashboard', 'platform',
  'to', 'that', 'with', 'and', 'of', 'my', 'our',
]);

// A named third-party platform/integration ("Shopify analytics dashboard")
// is CONTEXT for the product being built, never the product's own brand —
// mirrors the backend's identical fix in prompt_expander.py.
const PLATFORM_WORDS = new Set([
  'shopify', 'amazon', 'stripe', 'tiktok', 'meta', 'instagram', 'facebook',
  'google', 'youtube', 'twitter', 'linkedin', 'pinterest', 'snapchat',
  'woocommerce', 'salesforce', 'hubspot', 'square', 'paypal', 'etsy',
]);

// Generic filler adjectives and bare category/descriptor words don't make a
// believable brand on their own ("Premium Analytics" reads as a category
// label, not a product name) — used to decide when to synthesize instead.
const GENERIC_FILLER_WORDS = new Set([
  'premium', 'modern', 'simple', 'new', 'pro', 'smart', 'best', 'top',
  'quick', 'easy', 'great', 'amazing', 'awesome', 'advanced', 'ultimate',
]);
const CATEGORY_DESCRIPTOR_WORDS = new Set([
  'analytics', 'metrics', 'insights', 'insight', 'commerce', 'retail',
  'store', 'shop', 'fashion', 'apparel', 'boutique', 'tool', 'data',
  'reporting', 'kpi',
]);

const BRAND_PREFIXES = ['Thread', 'Loom', 'Atelier', 'Mercer', 'Bolt', 'Drape', 'Selvage', 'Weft'];
const BRAND_SUFFIXES = ['Metrics', 'Ledger', 'Insight', 'Pulse', 'Signal', 'IQ', 'Command'];

export function brandWordsFromPrompt(prompt: string): string[] {
  return (prompt || '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !BRAND_STOPWORDS.has(w.toLowerCase()))
    .filter((w) => !PLATFORM_WORDS.has(w.toLowerCase()));
}

function hasBelievableBrand(words: string[]): boolean {
  return words.some((w) => !GENERIC_FILLER_WORDS.has(w.toLowerCase()) && !CATEGORY_DESCRIPTOR_WORDS.has(w.toLowerCase()));
}

// A deterministic, product-style brand name for when a prompt names no
// real brand of its own — the same prompt always yields the same name;
// different prompts land on different prefix/suffix pairs. Mirrors the
// backend's `_synthesize_brand()`.
function synthesizeBrand(prompt: string): string {
  const text = prompt || 'korvix';
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed += (i + 1) * text.charCodeAt(i);
  const prefix = BRAND_PREFIXES[seed % BRAND_PREFIXES.length];
  const suffix = BRAND_SUFFIXES[Math.floor(seed / BRAND_PREFIXES.length) % BRAND_SUFFIXES.length];
  return `${prefix} ${suffix}`;
}

// A Title Case brand name for on-page copy, e.g. "Lumen Analytics" — or a
// synthesized product-style name when the prompt names no real brand of
// its own (only a platform + generic/category words).
export function brandNameFromPrompt(prompt: string, fallback = 'Korvix Studio'): string {
  const words = brandWordsFromPrompt(prompt).slice(0, 2);
  if (words.length === 0) return fallback;
  if (!hasBelievableBrand(words)) return synthesizeBrand(prompt);
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// A lowercase, no-space slug for the fake address bar / app URL — derived
// from the same (possibly synthesized) brand name as `brandNameFromPrompt`,
// so the fake domain always matches the on-page brand.
export function brandSlugFromPrompt(prompt: string, fallback = 'yourbrand'): string {
  const words = brandWordsFromPrompt(prompt).slice(0, 2);
  if (words.length === 0) return fallback;
  if (!hasBelievableBrand(words)) return synthesizeBrand(prompt).replace(/\s+/g, '').toLowerCase();
  return words.join('').toLowerCase();
}
