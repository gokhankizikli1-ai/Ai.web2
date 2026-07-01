// designBrief — the "Design Brief" step shown before Korvix generates a
// site/app/dashboard. Pure logic (types, smart defaults, prompt
// enhancement, and reverse-parsing for clean display) shared by the
// compact step-by-step Design Brief card and every page that triggers a
// build (Project Workspace, App Builder, Website Builder).
//
// Nothing here calls the backend — it only decides WHEN to ask, WHAT the
// visible chip choices are, and HOW to fold the (asked or smart-defaulted)
// answers into the exact same prompt string already sent through the
// existing run/orchestrator. `parseVisiblePrompt()` is the other half: it
// strips the DESIGN_BRIEF block back out at DISPLAY time, so a persisted
// `user_request` (which IS the enhanced prompt, by design — there's no
// separate backend field for it) never has to be shown to the user raw.

export interface DesignBriefAnswers {
  visualStyle: string;
  colorDirection: string;
  layoutType: string;
  buttonStyle: string;
  density: string;
  targetFeel: string;
  sections: string[];
}

// ── The 4 compact, step-by-step questions (Part 1) ────────────────────
// Deliberately short lists — this is what keeps the flow to one quick tap
// per question instead of a wall of chips.

export const VISUAL_STYLES = ['Luxury Dark', 'Apple Clean', 'Linear SaaS', 'Futuristic Glass'] as const;
export const COLOR_DIRECTIONS = ['Black + Gold', 'Black + Cyan', 'White + Graphite', 'Purple + Indigo'] as const;
export const LAYOUT_TYPES = ['Landing Page', 'Data Dashboard', 'SaaS App Shell', 'Product Showcase'] as const;
export const DENSITIES = ['Clean', 'Balanced', 'Data Heavy', 'Highly Detailed'] as const;

// Not asked interactively — auto-derived from the prompt (see
// smartDefaultsFromPrompt) but still part of the enhanced prompt sent to
// the backend (Part 4).
export const BUTTON_STYLES = ['Rounded Pill', 'Sharp Enterprise', 'Soft Glass', 'Gradient CTA', 'Minimal Text Buttons'] as const;
export const TARGET_FEELS = [
  'Investor-ready', 'Premium SaaS', 'Startup launch',
  'Enterprise product', 'Ecommerce conversion', 'Creator/portfolio',
] as const;
export const SECTION_OPTIONS = [
  'Hero', 'Features', 'Pricing', 'Testimonials', 'FAQ', 'Dashboard',
  'Reports', 'Settings', 'Analytics', 'Integrations', 'Team', 'Activity',
] as const;

// A lightweight hint for which color chip to pre-highlight given the
// chosen visual style — used only to order/suggest, never to restrict.
export function suggestedColorDirection(visualStyle: string): string {
  switch (visualStyle) {
    case 'Luxury Dark': return 'Black + Gold';
    case 'Futuristic Glass': return 'Black + Cyan';
    case 'Apple Clean': return 'White + Graphite';
    case 'Linear SaaS': return 'Black + Cyan';
    default: return 'Black + Gold';
  }
}

// ── Smart defaults — keyword-sniffed from the user's own prompt, no LLM. ──

const SMART_DEFAULT_BUCKETS: Array<[RegExp, DesignBriefAnswers]> = [
  [/financ\w*|analytics?|trading|invest\w*|hedge\s*fund|portfolio\s*manag\w*/i, {
    visualStyle: 'Luxury Dark', colorDirection: 'Black + Gold', layoutType: 'Data Dashboard',
    buttonStyle: 'Rounded Pill', density: 'Data Heavy', targetFeel: 'Investor-ready',
    sections: ['Dashboard', 'Reports', 'Analytics', 'Settings'],
  }],
  [/e-?commerce|shopify|online\s*store|storefront|retail\w*|merchant\w*|\bshop\b|\bstore\b/i, {
    visualStyle: 'Apple Clean', colorDirection: 'White + Graphite', layoutType: 'Product Showcase',
    buttonStyle: 'Gradient CTA', density: 'Balanced', targetFeel: 'Ecommerce conversion',
    sections: ['Hero', 'Features', 'Pricing', 'Testimonials', 'FAQ'],
  }],
  [/\bcrm\b|sales\s*(?:pipeline|team)|leads?\b|\bsaas\b/i, {
    visualStyle: 'Linear SaaS', colorDirection: 'Black + Cyan', layoutType: 'SaaS App Shell',
    buttonStyle: 'Rounded Pill', density: 'Balanced', targetFeel: 'Premium SaaS',
    sections: ['Dashboard', 'Reports', 'Settings', 'Activity'],
  }],
  [/\bai\b|artificial\s*intelligence|automation|assistant|copilot/i, {
    visualStyle: 'Futuristic Glass', colorDirection: 'Black + Cyan', layoutType: 'Landing Page',
    buttonStyle: 'Soft Glass', density: 'Balanced', targetFeel: 'Startup launch',
    sections: ['Hero', 'Features', 'Pricing', 'FAQ'],
  }],
];

const FALLBACK_DEFAULTS: DesignBriefAnswers = {
  visualStyle: 'Apple Clean', colorDirection: 'White + Graphite', layoutType: 'Landing Page',
  buttonStyle: 'Rounded Pill', density: 'Balanced', targetFeel: 'Premium SaaS',
  sections: ['Hero', 'Features', 'Pricing', 'FAQ'],
};

export function smartDefaultsFromPrompt(prompt: string): DesignBriefAnswers {
  const text = prompt || '';
  for (const [pattern, answers] of SMART_DEFAULT_BUCKETS) {
    if (pattern.test(text)) return { ...answers, sections: [...answers.sections] };
  }
  return { ...FALLBACK_DEFAULTS, sections: [...FALLBACK_DEFAULTS.sections] };
}

// Fold the 4 interactively-answered fields with the auto-derived ones
// (button style / target feel / sections) that the compact flow doesn't
// ask about directly — keyed off the prompt's own content, independent of
// which style chip the user picked.
export function fillBriefDefaults(
  compact: Pick<DesignBriefAnswers, 'visualStyle' | 'colorDirection' | 'layoutType' | 'density'>,
  prompt: string,
): DesignBriefAnswers {
  const derived = smartDefaultsFromPrompt(prompt);
  return {
    visualStyle: compact.visualStyle,
    colorDirection: compact.colorDirection,
    layoutType: compact.layoutType,
    density: compact.density,
    buttonStyle: derived.buttonStyle,
    targetFeel: derived.targetFeel,
    sections: derived.sections,
  };
}

// A short "Luxury Dark · Black + Gold · Data Dashboard · Data Heavy" line.
export function summarizeAnswers(answers: DesignBriefAnswers): string {
  return [answers.visualStyle, answers.colorDirection, answers.layoutType, answers.density].join(' · ');
}

// ── Should we even ask? ────────────────────────────────────────────────

const BUILD_INTENT_RE = /\b(build|create|design|generate|make|develop)\b[\s\S]{0,50}\b(website|site|landing|app|dashboard|platform|store|shop|tool|saas|crm|product|prototype|page)\b/i;

// Only relevant for general-purpose composers (Project Workspace) that
// also accept non-build requests ("research X", "draft a plan"). App
// Builder / Website Builder are dedicated build tools — every submission
// there is already build intent.
export function isBuildIntentPrompt(prompt: string): boolean {
  return BUILD_INTENT_RE.test(prompt || '');
}

const DESIGN_DETAIL_WORDS = [
  'dark mode', 'light mode', 'luxury', 'minimal', 'glass', 'neon', 'pill button', 'rounded button',
  'sharp enterprise', 'gradient', 'black and gold', 'black and cyan', 'purple and indigo',
  'graphite', 'emerald', 'dashboard app', 'saas app shell', 'split hero', 'data heavy',
  'investor-ready', 'investor ready', 'enterprise product', 'ecommerce conversion', 'portfolio site',
];

// True when the prompt already carries enough explicit design direction
// that asking again would be redundant — Korvix should generate straight
// away in that case.
export function promptHasDesignDetail(prompt: string): boolean {
  const text = (prompt || '').toLowerCase();
  const hits = DESIGN_DETAIL_WORDS.filter((w) => text.includes(w)).length;
  return hits >= 2;
}

// ── Chat-native refinement intent ──────────────────────────────────────
// Editing a completed build is just continuing the conversation — "make
// the dashboard denser", "change the brand name to Thread Metrics" — so
// the composer needs to tell an EDIT of the latest build apart from a NEW
// build request. Deterministic, ordered rules (same spirit as the intent
// classifier on the backend): an explicit "build/create me a(n) X" always
// reads as a fresh product; otherwise require an explicit edit verb. Bare
// references like "this" and "it" are too ambiguous because the Project
// Workspace also accepts general chat/research turns.
// Callers only apply this when a completed build actually exists.

const NEW_BUILD_RE =
  /\b(?:build|create|design|generate|make|develop)\s+(?:me\s+|us\s+)?(?:a|an|another|new)\b/i;

const REFINE_VERB_RE =
  /^\s*(?:please\s+|now\s+|also\s+|then\s+|and\s+)*(?:(?:can|could|would)\s+you\s+)?(?:change|swap|replace|rename|rewrite|reword|adjust|update|improve|refine|polish|remove|delete|drop|hide|show|add|insert|include|make|turn|set|use|tweak|shorten|lengthen|expand|tighten|simplify|increase|decrease|reduce|darken|lighten|convert|emphasize|emphasise)\b/i;

export function isRefineIntentPrompt(prompt: string): boolean {
  const p = (prompt || '').trim();
  if (!p) return false;
  if (NEW_BUILD_RE.test(p)) return false;
  return REFINE_VERB_RE.test(p);
}

// ── Fold the answers into the exact prompt string sent to the backend ────
//
// Kept deliberately parseable (one "- Label: value" line per field) so
// parseVisiblePrompt() below can losslessly strip it back out at display
// time — the backend stores/returns this exact string as `user_request`,
// there is no separate "original prompt" field, so display-time parsing is
// what keeps the visible bubble clean across a page reload too.
const BRIEF_MARKER = '\n\nDESIGN_BRIEF:';

export function buildEnhancedPrompt(prompt: string, answers: DesignBriefAnswers): string {
  const sections = answers.sections.length ? answers.sections.join(', ') : 'best-fit sections for this product';
  const lines = [
    'DESIGN_BRIEF:',
    `- Visual style: ${answers.visualStyle}`,
    `- Color direction: ${answers.colorDirection}`,
    `- Layout: ${answers.layoutType}`,
    `- Button style: ${answers.buttonStyle}`,
    `- Density: ${answers.density}`,
    `- Target feel: ${answers.targetFeel}`,
    `- Required pages/sections: ${sections}`,
    '- UI rules:',
    '  - no raw emojis',
    '  - no generic placeholder dashboard',
    '  - no plain gray boxes',
    '  - no huge empty spaces',
    '  - create distinct page layouts',
    '  - use premium hierarchy',
    '  - use inline SVG/CSS icons, not emoji',
    '  - match the selected style and color direction',
  ];
  return `${(prompt || '').trim()}${BRIEF_MARKER}\n${lines.slice(1).join('\n')}`;
}

export interface ParsedPrompt {
  visible: string;
  summary: string | null;
}

// Split an (possibly design-brief-enhanced) prompt back into the clean
// visible text + a compact "Luxury Dark · Black + Gold · ..." summary,
// for rendering in a message bubble. Prompts with no DESIGN_BRIEF block
// (design brief skipped, or an older/plain run) pass through unchanged.
export function parseVisiblePrompt(text: string): ParsedPrompt {
  const raw = text || '';
  const idx = raw.indexOf(BRIEF_MARKER);
  if (idx === -1) return { visible: raw, summary: null };

  const visible = raw.slice(0, idx).trim();
  const briefBlock = raw.slice(idx + BRIEF_MARKER.length);
  const field = (label: string): string | null => {
    const m = briefBlock.match(new RegExp(`^-\\s*${label}:\\s*(.+)$`, 'mi'));
    return m ? m[1].trim() : null;
  };
  const parts = [field('Visual style'), field('Color direction'), field('Layout'), field('Density')]
    .filter((v): v is string => !!v);
  return { visible, summary: parts.length ? parts.join(' · ') : null };
}

// Full reverse-parse of every DESIGN_BRIEF field (not just the compact
// summary) — used by the generated-preview layer so the visual style,
// color direction, density and required sections chosen in the interview
// actually drive the generated content, not just its display summary.
// Returns null when the prompt carries no DESIGN_BRIEF block at all.
export function parseBriefAnswers(text: string): DesignBriefAnswers | null {
  const raw = text || '';
  const idx = raw.indexOf(BRIEF_MARKER);
  if (idx === -1) return null;

  const briefBlock = raw.slice(idx + BRIEF_MARKER.length);
  const field = (label: string): string | null => {
    const m = briefBlock.match(new RegExp(`^-\\s*${label}:\\s*(.+)$`, 'mi'));
    return m ? m[1].trim() : null;
  };
  const sectionsRaw = field('Required pages/sections');
  const sections = sectionsRaw && sectionsRaw !== 'best-fit sections for this product'
    ? sectionsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  return {
    visualStyle: field('Visual style') || FALLBACK_DEFAULTS.visualStyle,
    colorDirection: field('Color direction') || FALLBACK_DEFAULTS.colorDirection,
    layoutType: field('Layout') || FALLBACK_DEFAULTS.layoutType,
    buttonStyle: field('Button style') || FALLBACK_DEFAULTS.buttonStyle,
    density: field('Density') || FALLBACK_DEFAULTS.density,
    targetFeel: field('Target feel') || FALLBACK_DEFAULTS.targetFeel,
    sections: sections.length ? sections : [...FALLBACK_DEFAULTS.sections],
  };
}

// Resolve the effective design-brief answers for a (possibly enhanced)
// prompt: parse an explicit DESIGN_BRIEF block if present (interview was
// shown), otherwise fall back to the same keyword-sniffed smart defaults
// used when the interview is skipped — so generation is always driven by
// a real DesignBriefAnswers object, never left to guess.
export function resolveBriefAnswers(promptOrEnhanced: string): DesignBriefAnswers {
  return parseBriefAnswers(promptOrEnhanced) || smartDefaultsFromPrompt(promptOrEnhanced);
}
