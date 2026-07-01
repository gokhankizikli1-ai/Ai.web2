// designBrief — the "Design Brief" step shown before Korvix generates a
// site/app/dashboard. Pure logic (types, smart defaults, prompt
// enhancement) shared by the Design Brief panel and every page that
// triggers a build (Project Workspace, App Builder, Website Builder).
//
// Nothing here calls the backend — it only decides WHEN to show the brief
// and HOW to fold the user's (or the smart-default) answers into the exact
// same prompt string already sent through the existing run/orchestrator.

export interface DesignBriefAnswers {
  visualStyle: string;
  colorDirection: string;
  layoutType: string;
  buttonStyle: string;
  density: string;
  targetFeel: string;
  sections: string[];
}

export const VISUAL_STYLES = [
  'Luxury Dark', 'Apple Clean', 'Linear SaaS', 'Futuristic Glass',
  'Minimal Light', 'Editorial Premium', 'Cyber/AI Neon',
] as const;

export const COLOR_DIRECTIONS = [
  'Black + Gold', 'Black + Cyan', 'Purple + Indigo', 'White + Graphite',
  'Emerald + Dark', 'Warm Ecommerce', 'Custom',
] as const;

export const LAYOUT_TYPES = [
  'Landing Page', 'Dashboard App', 'SaaS App Shell', 'Split Hero',
  'Product Showcase', 'Data/Analytics Workspace',
] as const;

export const BUTTON_STYLES = [
  'Rounded Pill', 'Sharp Enterprise', 'Soft Glass', 'Gradient CTA', 'Minimal Text Buttons',
] as const;

export const DENSITIES = [
  'Clean Minimal', 'Balanced', 'Data Heavy', 'Highly Detailed',
] as const;

export const TARGET_FEELS = [
  'Investor-ready', 'Premium SaaS', 'Startup launch',
  'Enterprise product', 'Ecommerce conversion', 'Creator/portfolio',
] as const;

export const SECTION_OPTIONS = [
  'Hero', 'Features', 'Pricing', 'Testimonials', 'FAQ', 'Dashboard',
  'Reports', 'Settings', 'Analytics', 'Integrations', 'Team', 'Activity',
] as const;

// ── Smart defaults — keyword-sniffed from the user's own prompt, no LLM. ──

const SMART_DEFAULT_BUCKETS: Array<[RegExp, DesignBriefAnswers]> = [
  [/financ\w*|analytics?|trading|invest\w*|hedge\s*fund|portfolio\s*manag\w*/i, {
    visualStyle: 'Luxury Dark', colorDirection: 'Black + Gold', layoutType: 'Data/Analytics Workspace',
    buttonStyle: 'Rounded Pill', density: 'Data Heavy', targetFeel: 'Investor-ready',
    sections: ['Dashboard', 'Reports', 'Analytics', 'Settings'],
  }],
  [/e-?commerce|shopify|online\s*store|storefront|retail\w*|merchant\w*|\bshop\b|\bstore\b/i, {
    visualStyle: 'Apple Clean', colorDirection: 'Warm Ecommerce', layoutType: 'Product Showcase',
    buttonStyle: 'Gradient CTA', density: 'Balanced', targetFeel: 'Ecommerce conversion',
    sections: ['Hero', 'Features', 'Pricing', 'Testimonials', 'FAQ'],
  }],
  [/\bcrm\b|sales\s*(?:pipeline|team)|leads?\b|\bsaas\b/i, {
    visualStyle: 'Linear SaaS', colorDirection: 'Purple + Indigo', layoutType: 'SaaS App Shell',
    buttonStyle: 'Rounded Pill', density: 'Balanced', targetFeel: 'Premium SaaS',
    sections: ['Dashboard', 'Reports', 'Settings', 'Activity'],
  }],
  [/\bai\b|artificial\s*intelligence|automation|assistant|copilot/i, {
    visualStyle: 'Futuristic Glass', colorDirection: 'Black + Cyan', layoutType: 'Split Hero',
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

// ── Should we even show the brief? ────────────────────────────────────────

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

// ── Fold the answers into the exact prompt string sent to the backend ────

export function buildEnhancedPrompt(prompt: string, answers: DesignBriefAnswers): string {
  const sections = answers.sections.length ? answers.sections.join(', ') : 'best-fit sections for this product';
  const brief = [
    'DESIGN_BRIEF:',
    `Visual style: ${answers.visualStyle}`,
    `Color direction: ${answers.colorDirection}`,
    `Layout type: ${answers.layoutType}`,
    `Button style: ${answers.buttonStyle}`,
    `Density: ${answers.density}`,
    `Target feel: ${answers.targetFeel}`,
    `Required sections/pages: ${sections}`,
    'Quality target: Kimi AI-level premium generated UI. Avoid generic templates, avoid plain gray boxes, avoid empty space, use strong hierarchy and real product structure.',
  ].join('\n');
  return `${(prompt || '').trim()}\n\n${brief}`;
}
