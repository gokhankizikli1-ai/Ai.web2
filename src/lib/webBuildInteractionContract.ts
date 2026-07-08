/**
 * Web Build INTERACTION CONTRACT layer (Phase 1 — contract only).
 *
 * `webBuildInteraction.ts` routes CTAs to scroll anchors, which prevents dead
 * links but cannot express the richer, demo-like behaviour a marketing site needs
 * (open a chat DEMO, open a detail modal, filter a catalog, open a quote FORM
 * SHELL, request archive access …). This module derives a small, STRUCTURED and
 * DETERMINISTIC "Interaction Contract" — a declaration of which FRONT-END /
 * WEBSITE-DEMO actions each section should support and which preview/demo UI
 * components they imply — so a later phase (Preview + generated files) can
 * implement them as local, client-side illustrations.
 *
 * SCOPE — WEBSITE + FRONT-END DEMO ONLY. Korvix Web Build is a WEBSITE builder,
 * not a product/backend builder. Every declared action is a front-end experience
 * that COMMUNICATES/DEMONSTRATES the product (sample chat bubbles, listing cards,
 * a record preview, a request-form shell) — never the real thing. Nothing here
 * implies a backend, database, payments, auth, a real search engine, or real AI
 * conversation logic, and Preview/Files must keep it local + honest (no fake AI
 * output, no fake successful submissions, no claim the product is running).
 *
 * PHASE 1 SCOPE: this is the contract only. Nothing here renders UI, changes the
 * preview, or changes generated files. It is a pure function of its inputs, is
 * fully guarded (never throws), fabricates nothing (only declares interactions
 * that make sense from the real concept + the sections that actually exist), and
 * falls back to the safe `scroll-to-section` default for unknown concepts.
 *
 * Type-only import of WebBuildBrief (leaf module → no import cycle).
 */
import type { WebBuildBrief } from '@/lib/webBuildApi';

export type InteractionActionType =
  | 'scroll-to-section'
  | 'open-chat-demo'
  | 'open-detail-modal'
  | 'open-quote-form'
  | 'open-contact-form'
  | 'filter-list'
  | 'toggle-before-after'
  | 'open-record-detail'
  | 'request-info'
  | 'request-access'
  | 'submit-lead';

export interface InteractionAction {
  id: string;
  label: string;
  type: InteractionActionType;
  /** The section this action targets (the record list, the demo panel host, …). */
  targetSectionId?: string;
  /** The section that hosts/triggers the action (a card grid, a CTA band, …). */
  sourceSectionId?: string;
  priority: 'primary' | 'secondary' | 'supporting';
  reason: string;
}

/** How the primary website/demo experience should be presented — a DATA hint for a
 *  later Preview/Files phase (front-end only; never a real product surface). */
export type ExperienceMode =
  | 'scroll' | 'inline' | 'modal' | 'drawer' | 'dedicated-page'
  | 'multi-page-tabs' | 'dashboard-shell' | 'catalog-detail-shell';

export interface InteractionContract {
  /** The concept category the contract was derived for (echoes the input). */
  conceptCategory: string;
  primaryAction: InteractionAction;
  secondaryActions: InteractionAction[];
  /** sectionId → the actions that section should support. */
  sectionActions: Record<string, InteractionAction[]>;
  /** Preview/DEMO UI components a later phase should build to honour the contract
   *  (e.g. "chat-demo-panel", "filter-controls", "record-detail-modal"). These are
   *  FRONT-END, client-side demo surfaces only — never a real backend/AI/database
   *  feature, and never a claim about an existing/running product. */
  requiredStatefulComponents: string[];
  /* ── Model-native Website Experience Plan (Phase 3), carried as DATA for a later
   *  Preview/Files phase. All optional; present only when the model decided them. */
  websiteExperienceModel?: string;
  pageScreenModel?: string;
  primaryWebsiteExperience?: string;
  navigationModel?: string;
  /** How to present the primary experience (dedicated page / drawer / modal / …). */
  experienceMode?: ExperienceMode;
  /** Website pages/screens the model implied — front-end demo screens only. */
  suggestedScreens?: Array<{ id: string; name: string; purpose: string; demoOnly: true }>;
  /* ── Entry Flow (Phase 6B) — how the visitor ENTERS the experience. Derived
   *  deterministically from the model's entry fields → WEP/suggestedScreens →
   *  concept family → single-page fallback. All optional & backward compatible.
   *  Front-end demo only — the "entry" is a local screen transition, never a route
   *  change, auth gate, or real product surface. */
  entryFlowModel?: string;
  landingRequired?: boolean;
  entryScreen?: string;
  postEntryScreen?: string;
  primaryEntryCTA?: string;
  secondaryEntryCTA?: string;
  navigationBehavior?: string;
  /** Semantic hint the Preview maps to a real internal screen: 'home' or a screen
   *  KIND token (product-demo | chat | catalog | collection | projects | quote …). */
  initialScreenId?: string;
  /** The screen KIND opened after the primary entry CTA (same token vocabulary). */
  postEntryScreenId?: string;
  /** The action the primary entry CTA runs (usually the primary action). */
  entryAction?: InteractionAction;
  /* ── Conversion Journey (Phase 6F) — the single primary conversion path. The
   *  lead/email step is a LOCAL static form shell only (never a real signup/auth/
   *  backend/submission). All optional & backward compatible. */
  conversionJourneyModel?: string;
  primaryConversionIntent?: string;
  /** Normalized, locale-aware primary CTA label derived from the conversion intent. */
  primaryConversionCTA?: string;
  leadCaptureRequired?: boolean;
  leadCaptureFields?: string;
  afterLeadCaptureScreen?: string;
  ctaConsistencyRule?: string;
  /** Screen KIND tokens the Preview maps to real internal screens. */
  leadCaptureScreenId?: string;
  afterLeadCaptureScreenId?: string;
  /** The action the primary conversion CTA runs (opens the lead gate or the demo). */
  leadCaptureAction?: InteractionAction;
  notes: string[];
}

/** The model's Website Experience Plan as consumed by the contract (structurally a
 *  subset of the Strategy artifact's WebsiteExperiencePlan; kept local so this leaf
 *  module never imports webBuildAgents → no import cycle). */
export interface ExperiencePlanInput {
  websiteExperienceModel?: string;
  pageScreenModel?: string;
  primaryWebsiteExperience?: string;
  demoSurfaces?: string[];
  statefulDemoComponents?: string[];
  navigationModel?: string;
  mediaMotionPlan?: string;
  /* ── Entry Flow (Phase 6B) — how the visitor ENTERS the experience. All
   *  optional; front-end demo only (no real backend/AI/db/payments). */
  entryFlowModel?: string;
  landingRequired?: string;
  entryScreen?: string;
  postEntryScreen?: string;
  primaryEntryCTA?: string;
  secondaryEntryCTA?: string;
  navigationBehavior?: string;
  /* ── Conversion Journey (Phase 6F). All optional; lead step is a local shell. */
  conversionJourneyModel?: string;
  primaryConversionIntent?: string;
  leadCaptureRequired?: string;
  leadCaptureFields?: string;
  afterLeadCaptureScreen?: string;
  ctaConsistencyRule?: string;
}

export interface InteractionContractInput {
  prompt?: string;
  brief?: WebBuildBrief;
  /** The Research Agent's detected concept category (strongest signal). */
  conceptCategory?: string;
  /** Research recommended component / page names (optional, advisory). */
  recommendedComponents?: string[];
  recommendedPages?: string[];
  /** The Strategy Agent's CTA hierarchy — real CTA copy for the primary action. */
  ctaHierarchy?: { primary?: string; secondary?: string };
  /** The MODEL's own Website Experience Plan — PREFERRED over the keyword fallback. */
  experiencePlan?: ExperiencePlanInput;
  /** The FINAL section list the contract reasons about. */
  sections: Array<{ id: string; name: string }>;
  /** Art render mode / concept hint, when available. */
  artMode?: string;
  lang?: string;
}

type Lang = string;
const L = (lang: Lang | undefined, en: string, tr: string) => (lang === 'tr' ? tr : en);
const clean = (s?: string) => (s || '').replace(/\s+/g, ' ').trim();

/** The interaction "family" — the small set of surface behaviours that actually
 *  differ. Broader than the ~17 concept categories on purpose. */
type Family = 'ai' | 'saas' | 'local-service' | 'marketplace' | 'archive' | 'hospitality' | 'general';

/** Concept category (Research conceptProfile.category) → interaction family. */
const CATEGORY_FAMILY: Record<string, Family> = {
  ai: 'ai',
  saas: 'saas',
  landscaping: 'local-service',
  local_service: 'local-service',
  legal: 'local-service',
  medical: 'local-service',
  finance: 'local-service',
  marketplace: 'marketplace',
  real_estate: 'marketplace',
  archive: 'archive',
  hospitality: 'hospitality',
};

/** Keyword fallback when no concept category is supplied. Ordered most-specific
 *  first so "AI chatbot" wins over "platform" and "used car" wins over generic. */
const FAMILY_KEYWORDS: Array<[Family, RegExp]> = [
  ['ai', /(chatbot|chat ?bot|\bassistant\b|copilot|conversational|\bllm\b|\bai\b|artificial intelligence|yapay ?zek)/i],
  ['archive', /(archive|museum|catalogue|collection|library|manuscript|heritage|provenance|ottoman|osmanl|arşiv|müze|koleksiyon|kütüphane)/i],
  ['marketplace', /(marketplace|e-?commerce|e-?ticaret|online store|storefront|used ?car|second[- ]hand|ikinci ?el|dealership|oto ?galeri|vehicle|\bcars?\b|araç|araba|real estate|emlak|gayrimenkul|listing|inventory|envanter)/i],
  ['hospitality', /(restaurant|restoran|cafe|kafe|\bmenu\b|menü|reservation|rezervasyon|dining|bistro|hotel|otel|lokanta)/i],
  ['local-service', /(landscap|peyzaj|garden|bahçe|lawn|nursery|quote|teklif|consultation|danış|clinic|klinik|law ?firm|avukat|plumb|tesisat|contractor|renovation|tadilat)/i],
  ['saas', /(saas|dashboard|platform|software|\bapi\b|analytics|automation|workflow|\bcrm\b|yazılım|panel|otomasyon)/i],
];

/** Section-role keyword tests (matched against `id name`). */
const RE = {
  demo: /(product-?demo|\bdemo\b|chatbot|\bchat\b|playground|sandbox|assistant|try-?it)/i,
  pricing: /(pricing|\bprice\b|\bplan\b|fiyat|paket|enroll|subscribe)/i,
  security: /(security|güvenlik|compliance|privacy|trust-?proof)/i,
  integrations: /(integration|entegrasyon)/i,
  gallery: /(gallery|galeri|project|proje|portfolio|portfolyo|selected-?work|showcase|before-?after|work\b)/i,
  beforeAfter: /(before-?after|önce-?sonra|transformation|dönüşüm)/i,
  catalog: /(catalog|collection-?grid|inventory|envanter|featured|listings?|products?|vehicles?|araç|araba|\bcars?\b|shop|store|mağaza)/i,
  listing: /(card|listing|product|vehicle|araç|araba|\bitem\b|ürün|featured)/i,
  collection: /(collection|koleksiyon|catalog|\bindex\b|archive|arşiv|records?|belge|document|manuscript|elyazma)/i,
  research: /(research|filter|filtre|search|arama|browse|gözat)/i,
  access: /(access|erişim|researcher|araştırmacı|request|başvuru|contact|iletişim)/i,
  menu: /(\bmenu\b|menü)/i,
  quote: /(quote|teklif|estimate|consultation|danış|request-?quote|quote-?cta)/i,
  contact: /(contact|iletişim|reservation|rezervasyon|\bbook\b|randevu|başvuru|final-?cta|get-?started|başla)/i,
  cta: /(cta|contact|quote|request|reservation|book|iletişim|teklif|randevu|başvuru|\blead\b|final-?cta|start|enroll|access|checkout|cart|sepet)/i,
};

/* ── Model-native Website Experience Plan → contract data (Phase 3) ───────────
 * These read the MODEL's own decisions (primaryWebsiteExperience / statefulDemo
 * components / navigation model) and map them to the contract's action + presentation
 * vocabulary. They are DATA-only; a later Preview/Files phase decides how to render.
 * Everything stays website/front-end demo — never a real product surface. */

/** The primary action TYPE the model asked for, from its own words. Undefined when
 *  the plan is silent (then the deterministic concept family decides). */
function planPrimaryActionType(plan?: ExperiencePlanInput): InteractionActionType | undefined {
  if (!plan) return undefined;
  const hay = `${plan.primaryWebsiteExperience || ''} ${(plan.statefulDemoComponents || []).join(' ')} ${plan.websiteExperienceModel || ''} ${(plan.demoSurfaces || []).join(' ')}`.toLowerCase();
  if (!hay.trim()) return undefined;
  if (/chat|assistant|conversation|copilot|\bbot\b/.test(hay)) return 'open-chat-demo';
  if (/quote/.test(hay)) return 'open-quote-form';
  if (/access|researcher/.test(hay)) return 'request-access';
  if (/reservation|booking|contact/.test(hay)) return 'open-contact-form';
  if (/record[- ]?detail/.test(hay)) return 'open-record-detail';
  if (/detail[- ]?(preview|modal|page)|listing[- ]?detail|product[- ]?detail/.test(hay)) return 'open-detail-modal';
  if (/\blead\b|request[- ]?info|enquir|inquir/.test(hay)) return 'request-info';
  if (/filter|search|catalog|listing|browse/.test(hay)) return 'filter-list';
  return undefined;
}

/** How the model wants the primary experience presented (data hint for Phase 4). */
function planExperienceMode(plan?: ExperiencePlanInput): ExperienceMode | undefined {
  if (!plan) return undefined;
  const nav = (plan.navigationModel || '').toLowerCase();
  const model = (plan.websiteExperienceModel || '').toLowerCase();
  const prim = (plan.primaryWebsiteExperience || '').toLowerCase();
  const hay = `${nav} ${model} ${prim}`;
  if (/dashboard/.test(hay)) return 'dashboard-shell';
  if (/catalog|listing|detail[- ]?shell/.test(hay)) return 'catalog-detail-shell';
  if (/multi-?page|internal page tab|page tab/.test(hay)) return 'multi-page-tabs';
  if (/dedicated (demo )?page|demo page|demo screen|product demo site/.test(hay)) return 'dedicated-page';
  if (/drawer/.test(prim)) return 'drawer';
  if (/modal|pop-?up/.test(prim)) return 'modal';
  if (/inline/.test(prim)) return 'inline';
  if (/single-?page|anchors?|\blanding\b/.test(hay)) return 'scroll';
  return undefined;
}

/** Front-end demo SCREENS the model implied, parsed from its page/screen model.
 *  demoOnly is always true — these are website demo screens, never real app pages. */
function planScreens(plan?: ExperiencePlanInput): InteractionContract['suggestedScreens'] {
  const raw = clean(plan?.pageScreenModel);
  if (!raw) return undefined;
  const parts = raw.split(/[,;、|]|\band\b|\bve\b|\+|→|>/i).map((x) => clean(x)).filter((x) => x.length >= 2).slice(0, 8);
  if (!parts.length) return undefined;
  return parts.map((name) => ({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'screen',
    name,
    purpose: name,
    demoOnly: true as const,
  }));
}

/* ── Entry Flow (Phase 6B) — how the visitor ENTERS the experience ───────────
 * A DATA-only decision (landing → demo/catalog/collection/quote, or straight in).
 * Derived deterministically: A) the model's own entry fields, B) the WEP /
 * suggestedScreens, C) the concept family, D) single-page fallback. The Preview
 * maps `initialScreenId`/`postEntryScreenId` (screen KIND tokens) to real internal
 * screens — a local transition, never a route change, auth gate or real product. */
const ENTRY_MODELS = [
  'single-page', 'landing-gated-experience', 'direct-demo', 'dashboard-first',
  'catalog-first', 'service-lead-flow', 'archive-exploration',
] as const;

function normalizeEntryModel(raw?: string): string | undefined {
  const s = (raw || '').toLowerCase();
  if (!s.trim()) return undefined;
  const exact = ENTRY_MODELS.find((m) => s.includes(m));
  if (exact) return exact;
  if (/landing.*gat|gat.*experience|landing.*demo/.test(s)) return 'landing-gated-experience';
  if (/direct.*demo|straight.*demo/.test(s)) return 'direct-demo';
  if (/dashboard/.test(s)) return 'dashboard-first';
  if (/catalog|listing|inventory|storefront/.test(s)) return 'catalog-first';
  if (/service.*lead|lead.*flow|quote.*flow/.test(s)) return 'service-lead-flow';
  if (/archive|exploration|collection/.test(s)) return 'archive-exploration';
  if (/single.*page|scroll|one-?page/.test(s)) return 'single-page';
  return undefined;
}

/** The post-entry screen KIND token for a concept family (Preview maps it to a
 *  real internal screen). Undefined when the family has no distinct experience. */
function familyPostEntryKind(family: Family, chat: boolean): string | undefined {
  switch (family) {
    case 'ai':
    case 'saas': return chat ? 'chat' : 'product-demo';
    case 'marketplace': return 'catalog';
    case 'archive': return 'collection';
    case 'local-service': return 'projects';
    default: return undefined;
  }
}

/** Default entry-flow model for a concept family (used when the model is silent). */
function familyEntryModel(family: Family): string {
  switch (family) {
    case 'ai':
    case 'saas': return 'landing-gated-experience';
    case 'marketplace': return 'catalog-first';
    case 'archive': return 'archive-exploration';
    case 'local-service': return 'service-lead-flow';
    default: return 'single-page';
  }
}

function navBehaviorFor(model: string): string {
  switch (model) {
    case 'landing-gated-experience': return 'landing-to-demo';
    case 'catalog-first': return 'catalog shell';
    case 'archive-exploration': return 'archive shell';
    case 'service-lead-flow': return 'service flow';
    case 'dashboard-first': return 'dashboard shell';
    case 'direct-demo': return 'internal screen tabs';
    default: return 'scroll anchors';
  }
}

function entryCtaLabels(family: Family, chat: boolean, lang?: string): { primary: string; secondary: string } {
  switch (family) {
    case 'ai':
    case 'saas': return {
      primary: chat ? L(lang, 'Launch chat experience', 'Sohbet deneyimini başlat') : L(lang, 'Open product demo', 'Ürün demosunu aç'),
      secondary: L(lang, 'See how it works', 'Nasıl çalıştığını gör'),
    };
    case 'marketplace': return { primary: L(lang, 'Browse inventory', 'Envantere göz at'), secondary: L(lang, 'Request info', 'Bilgi iste') };
    case 'archive': return { primary: L(lang, 'Explore the collection', 'Koleksiyonu keşfet'), secondary: L(lang, 'Request access', 'Erişim iste') };
    case 'local-service': return { primary: L(lang, 'View projects', 'Projeleri gör'), secondary: L(lang, 'Request a quote', 'Teklif iste') };
    default: return { primary: L(lang, 'Get started', 'Başla'), secondary: L(lang, 'Learn more', 'Daha fazla') };
  }
}

interface EntryFlowResult {
  entryFlowModel: string;
  landingRequired: boolean;
  entryScreen: string;
  postEntryScreen?: string;
  primaryEntryCTA: string;
  secondaryEntryCTA: string;
  navigationBehavior: string;
  initialScreenId: string;
  postEntryScreenId?: string;
}

function deriveEntryFlow(
  plan: ExperiencePlanInput | undefined,
  family: Family,
  chat: boolean,
  primaryLabel: string,
  secondaryLabel: string,
  lang?: string,
): EntryFlowResult {
  // A) the model's own entry model → B/C) family fallback → D) single-page.
  const model = normalizeEntryModel(plan?.entryFlowModel) || familyEntryModel(family);
  const postEntryScreenId = familyPostEntryKind(family, chat);

  // landingRequired: honour an explicit model yes/no, else infer from the model.
  const rawLanding = (plan?.landingRequired || '').toLowerCase().trim();
  const landingRequired = /^(yes|true|evet|gerek|required|zorunlu)/.test(rawLanding) ? true
    : /^(no|false|hay[ıi]r|gerekmez|gerekmiyor|not\s)/.test(rawLanding) ? false
    : (model === 'landing-gated-experience' || model === 'service-lead-flow' || model === 'single-page');

  // initialScreenId: start on Home when a landing is required / single-page / there
  // is no distinct post-entry screen; otherwise start directly inside the screen.
  const initialScreenId = (landingRequired || model === 'single-page' || !postEntryScreenId) ? 'home' : postEntryScreenId;

  const labels = entryCtaLabels(family, chat, lang);
  const primaryEntryCTA = clean(plan?.primaryEntryCTA) || clean(primaryLabel) || labels.primary;
  const secondaryEntryCTA = clean(plan?.secondaryEntryCTA) || clean(secondaryLabel) || labels.secondary;
  const navigationBehavior = clean(plan?.navigationBehavior) || navBehaviorFor(model);
  const entryScreen = clean(plan?.entryScreen) || (initialScreenId === 'home' ? 'Home / Landing' : initialScreenId);
  const postEntryScreen = clean(plan?.postEntryScreen) || postEntryScreenId;

  return {
    entryFlowModel: model,
    landingRequired,
    entryScreen,
    postEntryScreen,
    primaryEntryCTA,
    secondaryEntryCTA,
    navigationBehavior,
    initialScreenId,
    postEntryScreenId,
  };
}

/* ── Conversion Journey (Phase 6F) — the single primary conversion path ───────
 * Decides whether the landing gates the experience behind a LOCAL lead-capture
 * form shell (Landing → Lead Capture → Demo/Catalog/…) or converts directly.
 * Deterministic: A) the model's own conversion fields, B) the entry flow, C) the
 * concept family, D) no-gate. The lead step is a front-end static shell only —
 * never a real signup/auth/backend/submission. */
const CONVERSION_MODELS = [
  'direct-cta', 'lead-capture-gated-demo', 'book-demo', 'contact-request',
  'catalog-request', 'archive-access', 'quote-request', 'no-gate',
] as const;

function normalizeConversionModel(raw?: string): string | undefined {
  const s = (raw || '').toLowerCase();
  if (!s.trim()) return undefined;
  const exact = CONVERSION_MODELS.find((m) => s.includes(m));
  if (exact) return exact;
  if (/lead.*captur|email.*gat|gat.*demo|sign.?up.*gate/.test(s)) return 'lead-capture-gated-demo';
  if (/book.*demo|schedule.*demo/.test(s)) return 'book-demo';
  if (/contact.*(sales|request)|talk.*sales/.test(s)) return 'contact-request';
  if (/quote/.test(s)) return 'quote-request';
  if (/catalog|browse|inventory/.test(s)) return 'catalog-request';
  if (/archive|access|research/.test(s)) return 'archive-access';
  if (/direct/.test(s)) return 'direct-cta';
  if (/no.?gate|none/.test(s)) return 'no-gate';
  return undefined;
}

/** Default conversion model for a concept family (used when the model is silent).
 *  AI/SaaS default to a lead-capture-gated demo (Landing → Lead Capture → Demo). */
function familyConversionModel(family: Family): string {
  switch (family) {
    case 'ai':
    case 'saas': return 'lead-capture-gated-demo';
    case 'marketplace': return 'catalog-request';
    case 'archive': return 'archive-access';
    case 'local-service': return 'quote-request';
    default: return 'no-gate';
  }
}

/** Normalized, human CTA label per conversion intent — kills awkward auto-labels. */
function conversionCtaLabel(intent: string, family: Family, chat: boolean, lang?: string): string {
  const s = (intent || '').toLowerCase();
  if (/free\s*trial|try|get\s*started|start\s*free|free/.test(s)) return L(lang, 'Get started free', 'Ücretsiz başla');
  if (/book\s*demo|schedule/.test(s)) return L(lang, 'Book a demo', 'Demo ayarla');
  if (/contact\s*sales|talk\s*to\s*sales|contact/.test(s)) return L(lang, 'Contact sales', 'Satışla iletişime geç');
  if (/quote/.test(s)) return L(lang, 'Request a quote', 'Teklif iste');
  if (/browse|catalog|inventory/.test(s)) return L(lang, 'Browse catalog', 'Kataloğa göz at');
  if (/access|research/.test(s)) return L(lang, 'Request access', 'Erişim iste');
  if (/learn\s*more|how\s*it\s*works/.test(s)) return L(lang, 'See how it works', 'Nasıl çalıştığını gör');
  // No explicit intent → family default.
  switch (family) {
    case 'ai':
    case 'saas': return chat ? L(lang, 'Try it free', 'Ücretsiz dene') : L(lang, 'Get started free', 'Ücretsiz başla');
    case 'marketplace': return L(lang, 'Browse catalog', 'Kataloğa göz at');
    case 'archive': return L(lang, 'Explore the collection', 'Koleksiyonu keşfet');
    case 'local-service': return L(lang, 'Request a quote', 'Teklif iste');
    default: return L(lang, 'Get started', 'Başla');
  }
}

interface ConversionJourneyResult {
  conversionJourneyModel: string;
  primaryConversionIntent: string;
  leadCaptureRequired: boolean;
  leadCaptureFields: string;
  afterLeadCaptureScreen?: string;
  ctaConsistencyRule: string;
  primaryConversionCTA: string;
  leadCaptureScreenId?: string;
  afterLeadCaptureScreenId?: string;
}

function deriveConversionJourney(
  plan: ExperiencePlanInput | undefined,
  family: Family,
  chat: boolean,
  entry: EntryFlowResult,
  lang?: string,
): ConversionJourneyResult {
  // A) model conversion fields → B) entry flow → C) family → D) no-gate.
  const model = normalizeConversionModel(plan?.conversionJourneyModel) || familyConversionModel(family);
  const intent = clean(plan?.primaryConversionIntent)
    || (model === 'book-demo' ? 'book demo' : model === 'quote-request' ? 'request quote'
      : model === 'catalog-request' ? 'browse catalog' : model === 'archive-access' ? 'request access'
      : model === 'contact-request' ? 'contact sales'
      : (family === 'ai' || family === 'saas') ? 'free trial' : 'learn more');

  // leadCaptureRequired: explicit model yes/no, else true only for the gated model.
  const rawLead = (plan?.leadCaptureRequired || '').toLowerCase().trim();
  const leadCaptureRequired = /^(yes|true|evet|gerek|required|zorunlu)/.test(rawLead) ? true
    : /^(no|false|hay[ıi]r|gerekmez|gerekmiyor|not\s)/.test(rawLead) ? false
    : model === 'lead-capture-gated-demo';

  const leadCaptureFields = clean(plan?.leadCaptureFields)
    || ((family === 'ai' || family === 'saas') ? 'email only' : 'none');
  // Where the lead gate leads (a screen KIND token). Prefer the model's own screen,
  // else the entry flow's post-entry screen (the demo/catalog/collection).
  const afterTokenRaw = (plan?.afterLeadCaptureScreen || '').toLowerCase();
  const afterLeadCaptureScreenId = /chat|assistant/.test(afterTokenRaw) ? 'chat'
    : /product|demo/.test(afterTokenRaw) ? 'product-demo'
    : /catalog|inventory/.test(afterTokenRaw) ? 'catalog'
    : /collection|record/.test(afterTokenRaw) ? 'collection'
    : /quote/.test(afterTokenRaw) ? 'quote'
    : /project/.test(afterTokenRaw) ? 'projects'
    : entry.postEntryScreenId;
  const leadCaptureScreenId = leadCaptureRequired ? 'lead-capture' : undefined;
  const primaryConversionCTA = conversionCtaLabel(intent, family, chat, lang);
  const ctaConsistencyRule = clean(plan?.ctaConsistencyRule)
    || L(lang, `Primary CTA "${primaryConversionCTA}"; secondary CTAs stay supporting (See how it works / See pricing / View security).`,
        `Birincil CTA "${primaryConversionCTA}"; ikincil CTA'lar destekleyici kalır (Nasıl çalışır / Fiyatlandırma / Güvenlik).`);

  return {
    conversionJourneyModel: model,
    primaryConversionIntent: intent,
    leadCaptureRequired,
    leadCaptureFields,
    afterLeadCaptureScreen: clean(plan?.afterLeadCaptureScreen) || afterLeadCaptureScreenId,
    ctaConsistencyRule,
    primaryConversionCTA,
    leadCaptureScreenId,
    afterLeadCaptureScreenId,
  };
}

/** The front-end demo component a given action implies (to-build list for Phase 4). */
const COMPONENT_FOR_TYPE: Partial<Record<InteractionActionType, string>> = {
  'open-chat-demo': 'chat-demo-panel',
  'open-quote-form': 'quote-form',
  'open-contact-form': 'contact-form',
  'request-access': 'access-request-form',
  'open-record-detail': 'record-detail-modal',
  'open-detail-modal': 'detail-modal',
  'filter-list': 'filter-controls',
  'request-info': 'lead-form',
  'submit-lead': 'lead-form',
};

const ACTION_LABELS: Record<InteractionActionType, [string, string]> = {
  'scroll-to-section': ['Learn more', 'Daha fazla'],
  'open-chat-demo': ['Try the live demo', 'Canlı demoyu dene'],
  'open-detail-modal': ['View details', 'Ayrıntıları gör'],
  'open-quote-form': ['Request a quote', 'Teklif iste'],
  'open-contact-form': ['Contact us', 'İletişime geç'],
  'filter-list': ['Filter', 'Filtrele'],
  'toggle-before-after': ['Compare before & after', 'Önce & sonrayı karşılaştır'],
  'open-record-detail': ['Open record', 'Kaydı aç'],
  'request-info': ['Request info', 'Bilgi iste'],
  'request-access': ['Request access', 'Erişim iste'],
  'submit-lead': ['Get started', 'Başla'],
};
const actionLabel = (type: InteractionActionType, lang?: string) => L(lang, ACTION_LABELS[type][0], ACTION_LABELS[type][1]);

function resolveFamily(input: InteractionContractInput): { family: Family; chat: boolean } {
  const cat = (input.conceptCategory || '').toLowerCase().trim();
  const text = `${input.prompt || ''} ${input.brief?.type || ''} ${input.brief?.coreIdea || ''} ${input.brief?.style || ''} ${input.artMode || ''}`.toLowerCase();
  const chat = cat === 'ai' || /(chatbot|chat ?bot|\bassistant\b|copilot|conversational|sohbet|yapay ?zek)/i.test(text);
  let family: Family | undefined = CATEGORY_FAMILY[cat];
  if (!family) {
    for (const [f, re] of FAMILY_KEYWORDS) { if (re.test(text)) { family = f; break; } }
  }
  return { family: family || 'general', chat };
}

/**
 * Derive the deterministic Interaction Contract. Concept-specific but honest: it
 * only declares an action when a MATCHING section actually exists, and falls back
 * to `scroll-to-section` for unknown concepts. Pure and total — never throws.
 */
export function deriveInteractionContract(input: InteractionContractInput): InteractionContract {
  try {
    return build(input);
  } catch {
    return safeFallback(input);
  }
}

function build(input: InteractionContractInput): InteractionContract {
  const lang = input.lang;
  const { family, chat } = resolveFamily(input);
  const sections = (input.sections || []).filter((s): s is { id: string; name: string } =>
    !!s && typeof s === 'object' && typeof s.id === 'string' && !!s.id.trim());

  const hay = (s: { id: string; name: string }) => `${s.id} ${s.name || ''}`;
  const find = (re: RegExp) => sections.find((s) => re.test(hay(s)));
  const findAll = (re: RegExp) => sections.filter((s) => re.test(hay(s)));
  const isShell = (s: { id: string; name: string }) => /hero|footer/i.test(s.id);
  const firstContent = () => sections.find((s) => !isShell(s));

  const primaryLabel = clean(input.ctaHierarchy?.primary) || clean(input.brief?.primaryCTA);
  const sectionActions: Record<string, InteractionAction[]> = {};
  const required = new Set<string>();
  const secondaryActions: InteractionAction[] = [];
  const notes: string[] = [];
  let primary: InteractionAction | null = null;

  const mk = (
    type: InteractionActionType,
    label: string,
    opts: { targetSectionId?: string; sourceSectionId?: string; priority: InteractionAction['priority']; reason: string },
  ): InteractionAction => ({
    id: `${type}:${opts.sourceSectionId || opts.targetSectionId || 'page'}`,
    label: clean(label) || actionLabel(type, lang),
    type,
    targetSectionId: opts.targetSectionId,
    sourceSectionId: opts.sourceSectionId,
    priority: opts.priority,
    reason: opts.reason,
  });
  const addSection = (id: string, action: InteractionAction) => { (sectionActions[id] || (sectionActions[id] = [])).push(action); };

  if (family === 'ai' || family === 'saas') {
    const demo = find(RE.demo);
    if (chat && demo) {
      primary = mk('open-chat-demo', primaryLabel, { targetSectionId: demo.id, priority: 'primary', reason: 'AI/chat concept — the hero CTA opens a real chat/demo panel, not a scroll.' });
      addSection(demo.id, mk('open-chat-demo', clean(demo.name), { sourceSectionId: demo.id, targetSectionId: demo.id, priority: 'primary', reason: 'The product-demo section becomes an interactive chat/demo panel.' }));
      required.add('chat-demo-panel');
    }
    const pricing = find(RE.pricing);
    const security = find(RE.security);
    const integrations = find(RE.integrations);
    if (pricing) secondaryActions.push(mk('scroll-to-section', clean(pricing.name), { targetSectionId: pricing.id, priority: 'secondary', reason: 'Jump to pricing.' }));
    if (security) secondaryActions.push(mk('scroll-to-section', clean(security.name), { targetSectionId: security.id, priority: 'secondary', reason: 'Jump to security & trust proof.' }));
    if (integrations) secondaryActions.push(mk('scroll-to-section', clean(integrations.name), { targetSectionId: integrations.id, priority: 'secondary', reason: 'Jump to integrations.' }));
  } else if (family === 'local-service') {
    const quote = find(RE.quote);
    const contact = find(RE.contact);
    if (quote) {
      primary = mk('open-quote-form', primaryLabel, { targetSectionId: quote.id, priority: 'primary', reason: 'Local service — the primary CTA opens a real quote-request form.' });
      addSection(quote.id, mk('open-quote-form', clean(quote.name), { sourceSectionId: quote.id, targetSectionId: quote.id, priority: 'primary', reason: 'Quote section opens a quote-request form.' }));
      required.add('quote-form');
    } else if (contact) {
      primary = mk('open-contact-form', primaryLabel, { targetSectionId: contact.id, priority: 'primary', reason: 'The primary CTA opens a contact form.' });
      addSection(contact.id, mk('open-contact-form', clean(contact.name), { sourceSectionId: contact.id, targetSectionId: contact.id, priority: 'primary', reason: 'Contact section opens a contact form.' }));
      required.add('contact-form');
    }
    for (const g of findAll(RE.gallery)) {
      addSection(g.id, mk('open-detail-modal', clean(g.name), { sourceSectionId: g.id, targetSectionId: g.id, priority: 'supporting', reason: 'Project/gallery items open a detail modal.' }));
      required.add('project-detail-modal');
    }
    const ba = find(RE.beforeAfter);
    if (ba) {
      addSection(ba.id, mk('toggle-before-after', clean(ba.name), { sourceSectionId: ba.id, targetSectionId: ba.id, priority: 'supporting', reason: 'Before/after section gets an interactive comparison toggle.' }));
      required.add('before-after-slider');
    }
  } else if (family === 'marketplace') {
    const catalog = find(RE.catalog);
    if (catalog) {
      addSection(catalog.id, mk('filter-list', clean(catalog.name), { sourceSectionId: catalog.id, targetSectionId: catalog.id, priority: 'primary', reason: 'Catalog/inventory gets real filter controls.' }));
      required.add('filter-controls');
    }
    for (const l of findAll(RE.listing)) {
      addSection(l.id, mk('open-detail-modal', clean(l.name), { sourceSectionId: l.id, targetSectionId: l.id, priority: 'supporting', reason: 'Listing cards open a detail modal.' }));
      required.add('detail-modal');
    }
    const ctaSec = find(RE.cta);
    if (ctaSec) {
      primary = mk('request-info', primaryLabel, { targetSectionId: ctaSec.id, priority: 'primary', reason: 'Marketplace CTA requests info / submits a lead on a listing.' });
      addSection(ctaSec.id, mk('request-info', clean(ctaSec.name), { sourceSectionId: ctaSec.id, targetSectionId: ctaSec.id, priority: 'primary', reason: 'Request info about a listing.' }));
      addSection(ctaSec.id, mk('submit-lead', clean(ctaSec.name), { sourceSectionId: ctaSec.id, targetSectionId: ctaSec.id, priority: 'supporting', reason: 'Submit an enquiry lead.' }));
      required.add('lead-form');
    }
  } else if (family === 'archive') {
    const filterable = find(RE.research) || find(RE.collection);
    if (filterable) {
      addSection(filterable.id, mk('filter-list', clean(filterable.name), { sourceSectionId: filterable.id, targetSectionId: filterable.id, priority: 'primary', reason: 'Collection/research surface gets search + filters.' }));
      required.add('archive-filter');
    }
    for (const c of findAll(RE.collection)) {
      addSection(c.id, mk('open-record-detail', clean(c.name), { sourceSectionId: c.id, targetSectionId: c.id, priority: 'supporting', reason: 'Collection rows open a record detail view.' }));
      required.add('record-detail-modal');
    }
    const access = find(RE.access);
    if (access) {
      primary = mk('request-access', primaryLabel, { targetSectionId: access.id, priority: 'primary', reason: 'Archive access is gated — the CTA requests researcher access.' });
      addSection(access.id, mk('request-access', clean(access.name), { sourceSectionId: access.id, targetSectionId: access.id, priority: 'primary', reason: 'Request researcher / archive access.' }));
      required.add('access-request-form');
    }
  } else if (family === 'hospitality') {
    const menu = find(RE.menu);
    if (menu) {
      addSection(menu.id, mk('filter-list', clean(menu.name), { sourceSectionId: menu.id, targetSectionId: menu.id, priority: 'primary', reason: 'Menu gets category filters (and items can open detail).' }));
      addSection(menu.id, mk('open-detail-modal', clean(menu.name), { sourceSectionId: menu.id, targetSectionId: menu.id, priority: 'supporting', reason: 'A menu item opens a detail view.' }));
      required.add('menu-filter');
    }
    const resv = find(RE.contact);
    if (resv) {
      primary = mk('open-contact-form', primaryLabel, { targetSectionId: resv.id, priority: 'primary', reason: 'Reservation/contact opens a booking form.' });
      addSection(resv.id, mk('submit-lead', clean(resv.name), { sourceSectionId: resv.id, targetSectionId: resv.id, priority: 'primary', reason: 'Reservation submits a booking lead.' }));
      required.add('reservation-form');
    }
  }

  // ── Decision order A: PREFER the model's Website Experience Plan for the PRIMARY
  // action over the deterministic concept family (C). Only when the model actually
  // stated a primary experience; otherwise the family choice stands. Website/demo
  // only — every mapped action is a front-end surface, never a real product.
  const plan = input.experiencePlan;
  const planType = planPrimaryActionType(plan);
  if (planType) {
    const targetForType = (t: InteractionActionType): { id: string; name: string } | undefined => {
      switch (t) {
        case 'open-chat-demo': return find(RE.demo);
        case 'open-quote-form': return find(RE.quote);
        case 'open-contact-form': return find(RE.contact);
        case 'request-access': return find(RE.access);
        case 'open-record-detail': return find(RE.collection) || find(RE.gallery);
        case 'open-detail-modal': return find(RE.listing) || find(RE.gallery) || find(RE.catalog);
        case 'filter-list': return find(RE.research) || find(RE.catalog) || find(RE.collection);
        case 'request-info':
        case 'submit-lead': return find(RE.cta);
        default: return undefined;
      }
    };
    const host = targetForType(planType)
      || (primary?.targetSectionId ? sections.find((s) => s.id === primary!.targetSectionId) : undefined)
      || firstContent();
    primary = mk(planType, primaryLabel, { targetSectionId: host?.id, priority: 'primary', reason: 'Model Website Experience Plan — the primary website/demo experience the model chose.' });
    if (host && !(sectionActions[host.id] || []).some((a) => a.type === planType)) {
      addSection(host.id, mk(planType, clean(host.name), { sourceSectionId: host.id, targetSectionId: host.id, priority: 'primary', reason: 'Model Website Experience Plan — primary experience host.' }));
    }
    const comp = COMPONENT_FOR_TYPE[planType];
    if (comp) required.add(comp);
  }
  // Record the model's own front-end demo components as a to-build hint (normalized
  // slugs only; still website/demo — never a backend/AI/db feature).
  for (const c of (plan?.statefulDemoComponents || [])) {
    const slug = clean(c).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (slug && slug.length >= 2 && slug.length <= 40) required.add(slug);
  }

  // Safe default primary: scroll to the conversion section (or first content) when
  // neither the model plan (A) nor the concept family (C) produced a primary action.
  if (!primary) {
    const target = find(RE.cta) || firstContent();
    primary = mk('scroll-to-section', primaryLabel, { targetSectionId: target?.id, priority: 'primary', reason: 'Safe default — scroll to the primary conversion section.' });
  }

  notes.push(L(lang,
    'Website + front-end demo only — actions are local, client-side illustrations (no backend, AI, database, payments or real submissions).',
    'Yalnızca web sitesi + ön yüz demosu — eylemler yerel, istemci tarafı örneklerdir (arka uç, yapay zekâ, veritabanı, ödeme veya gerçek gönderim yok).'));
  notes.push(family === 'general'
    ? L(lang, 'General concept — scroll-only interactions by default.', 'Genel konsept — varsayılan olarak yalnızca kaydırma etkileşimleri.')
    : L(lang, `Concept family: ${family}.`, `Konsept ailesi: ${family}.`));

  const experienceMode = planExperienceMode(plan);
  const suggestedScreens = planScreens(plan);
  if (plan && (planType || plan.websiteExperienceModel || plan.navigationModel || plan.primaryWebsiteExperience)) {
    notes.push(L(lang,
      `Model Website Experience Plan applied${experienceMode ? ` (${experienceMode})` : ''} — website / front-end demo only.`,
      `Model Web Sitesi Deneyim Planı uygulandı${experienceMode ? ` (${experienceMode})` : ''} — yalnızca web sitesi / ön yüz demosu.`));
  }

  // ── Entry Flow (Phase 6B) — decide how the visitor ENTERS (landing → experience
  // or straight in). Deterministic; front-end demo only. entryAction reuses the
  // primary action so the hero CTA can transition to the post-entry screen.
  const secondaryLabel = clean(input.ctaHierarchy?.secondary) || clean(input.brief?.secondaryCTA);
  const entry = deriveEntryFlow(plan, family, chat, primary.label, secondaryLabel, lang);
  const entryAction = (entry.initialScreenId === 'home' && !!entry.postEntryScreenId && primary.type !== 'scroll-to-section')
    ? primary : undefined;

  // ── Conversion Journey (Phase 6F) — the single primary conversion path. When a
  // lead gate is required, the primary CTA opens a LOCAL lead-capture screen that
  // then opens the demo/catalog; otherwise it converts directly. Static shell only.
  const journey = deriveConversionJourney(plan, family, chat, entry, lang);
  // leadCaptureAction reuses the primary action; the Preview routes it through the
  // lead-capture screen when leadCaptureRequired, else straight to the experience.
  const leadCaptureAction = journey.leadCaptureRequired && entryAction ? entryAction : undefined;

  return {
    conceptCategory: clean(input.conceptCategory) || family,
    primaryAction: primary,
    secondaryActions,
    sectionActions,
    requiredStatefulComponents: Array.from(required),
    websiteExperienceModel: clean(plan?.websiteExperienceModel) || undefined,
    pageScreenModel: clean(plan?.pageScreenModel) || undefined,
    primaryWebsiteExperience: clean(plan?.primaryWebsiteExperience) || undefined,
    navigationModel: clean(plan?.navigationModel) || undefined,
    experienceMode,
    suggestedScreens,
    // Entry Flow fields (all deterministic; consumed by the Preview resolver).
    entryFlowModel: entry.entryFlowModel,
    landingRequired: entry.landingRequired,
    entryScreen: entry.entryScreen,
    postEntryScreen: entry.postEntryScreen,
    primaryEntryCTA: entry.primaryEntryCTA,
    secondaryEntryCTA: entry.secondaryEntryCTA,
    navigationBehavior: entry.navigationBehavior,
    initialScreenId: entry.initialScreenId,
    postEntryScreenId: entry.postEntryScreenId,
    entryAction,
    // Conversion Journey fields (deterministic; consumed by the Preview lead gate).
    conversionJourneyModel: journey.conversionJourneyModel,
    primaryConversionIntent: journey.primaryConversionIntent,
    primaryConversionCTA: journey.primaryConversionCTA,
    leadCaptureRequired: journey.leadCaptureRequired,
    leadCaptureFields: journey.leadCaptureFields,
    afterLeadCaptureScreen: journey.afterLeadCaptureScreen,
    ctaConsistencyRule: journey.ctaConsistencyRule,
    leadCaptureScreenId: journey.leadCaptureScreenId,
    afterLeadCaptureScreenId: journey.afterLeadCaptureScreenId,
    leadCaptureAction,
    notes,
  };
}

/** Absolute fallback — a valid, scroll-only contract that never throws. */
function safeFallback(input: InteractionContractInput): InteractionContract {
  const lang = input?.lang;
  const label = clean(input?.ctaHierarchy?.primary) || clean(input?.brief?.primaryCTA) || actionLabel('scroll-to-section', lang);
  return {
    conceptCategory: clean(input?.conceptCategory) || 'general',
    primaryAction: { id: 'scroll-to-section:page', label, type: 'scroll-to-section', priority: 'primary', reason: 'Safe default.' },
    secondaryActions: [],
    sectionActions: {},
    requiredStatefulComponents: [],
    notes: [L(lang, 'Interaction contract fell back to scroll-only (input was unusable).', 'Etkileşim sözleşmesi yalnızca kaydırmaya geri döndü (girdi kullanılamazdı).')],
  };
}
