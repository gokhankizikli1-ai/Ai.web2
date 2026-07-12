/**
 * SHARED PRODUCT-INTENT AUTHORITY (Phase 12F).
 *
 * The single deterministic source of truth for WHAT a generated site actually is —
 * a compliance/reporting workflow, a generic software product, an explicit chatbot, a
 * dashboard, a calculator, an assessment, a store/catalog, a booking flow or a content
 * site — and, from that, the honest front-end demo family, the concept-native section
 * labels, and the drift labels/tokens that must never appear.
 *
 * This module is a LEAF utility: it imports nothing from webBuildAgents, webBuildPayload,
 * React, stores or browser APIs. Every export is pure, deterministic, synchronous,
 * network-free, non-mutating and fail-open (never throws; a blank/uncertain input yields
 * a safe, non-chat default — never a chatbot or a storefront by accident).
 *
 * Root problem it fixes: a non-chat AI/SaaS product must not become a chatbot, shopping
 * assistant or storefront merely because it contains "AI", "SaaS", "assistant",
 * "automation", "platform", "software" or an ecommerce TARGET vertical. Chat and store
 * surfaces require EXPLICIT evidence; the original prompt + authoritative concept win
 * over generic category defaults and over a model plan that drifts to "chat".
 */

export type ProductLang = 'en' | 'tr';

/** The honest front-end demo family a concept resolves to. Superset-compatible with
 *  the ledger's DemoSurfaceIntent (same string values), plus workflow/calculator/
 *  assessment. */
export type ProductDemoFamily =
  | 'chat-demo'
  | 'workflow-demo'
  | 'product-flow-demo'
  | 'dashboard-demo'
  | 'catalog-demo'
  | 'booking-demo'
  | 'calculator-demo'
  | 'assessment-demo'
  | 'content-demo'
  | 'none';

export interface ProductIntentInput {
  /** The original product prompt — highest authority. */
  prompt?: string;
  /** Secondary text (brief core idea / type / goal / audience joined). */
  briefText?: string;
  /** The resolved primary concept category (from Concept Authority), any casing. */
  primaryConcept?: string;
  /** The resolved target vertical/customer (informs copy only, never the surface). */
  targetVertical?: string;
  /** The model's own demo-module decision, if any (e.g. 'data-dashboard'). */
  modelDemoModule?: string;
  lang?: ProductLang;
}

export interface ProductIntent {
  demoFamily: ProductDemoFamily;

  explicitChat: boolean;
  explicitDashboard: boolean;
  workflowOriented: boolean;
  complianceOriented: boolean;
  catalogOriented: boolean;
  bookingOriented: boolean;
  calculatorOriented: boolean;
  assessmentOriented: boolean;
  contentOriented: boolean;
  /** True when the concept family is AI/SaaS/software (a product-marketing site). */
  softwareProduct: boolean;

  /** Concept-family preferred section labels (localized, deduped, bounded). */
  preferredSectionLabels: string[];
  /** Lowercased drift labels/tokens that must NOT appear for this intent. */
  forbiddenDriftLabels: string[];
  /** Domain-native demo requirements. */
  demoMustShow: string[];
  demoMustAvoid: string[];

  /** Honest one-line diagnostic. */
  reason: string;
}

const pick = (lang: ProductLang, en: string, tr: string): string => (lang === 'tr' ? tr : en);
const norm = (s: string | undefined): string => ` ${(s || '').toLowerCase()} `;
const dedupe = (xs: string[]): string[] => Array.from(new Set(xs.filter((x) => x && x.trim())));

/* ── Explicit evidence patterns ──────────────────────────────────────────────
 * STRONG conversational evidence only. A standalone "assistant"/"asistan"/"copilot"/
 * "agent"/"AI"/"SaaS" describes a product ROLE, not a chat surface, so it is NOT here. */
const CHAT_EVIDENCE_RE = new RegExp(
  [
    'chatbot', 'chat\\s*bot', 'conversational\\s*ai', 'chat\\s*interface', 'live\\s*chat',
    'customer[-\\s]*support\\s*bot', 'support\\s*chat\\s*bot', 'conversational\\s*assistant',
    'messaging\\s*assistant', 'chat\\s*widget', 'chat\\s*flow\\s*demo',
    'sohbet\\s*botu', 'canl[ıi]\\s*sohbet', 'konu[şs]mal[ıi]\\s*asistan',
    'm[üu][şs]teri\\s*destek\\s*botu',
  ].join('|'),
  'i',
);

/** EXPLICIT dashboard/admin/analytics-workspace request — never fired by bare
 *  "analytics" or by the product merely being SaaS. */
const DASHBOARD_EVIDENCE_RE = new RegExp(
  [
    '\\bdashboard\\b', 'admin\\s*panel', 'control\\s*panel', 'analytics\\s*(dashboard|workspace|panel)',
    'reporting\\s*dashboard', '\\bbi\\s*tool\\b', 'g[öo]sterge\\s*panel', 'y[öo]netim\\s*panel',
    'analitik\\s*panel', 'kontrol\\s*panel',
  ].join('|'),
  'i',
);

const CALCULATOR_EVIDENCE_RE = new RegExp(
  ['\\bcalculator\\b', 'calculate\\b', 'estimator', 'pricing\\s*calculator', 'cost\\s*calculator',
    'roi\\s*calculator', 'hesaplama\\s*arac', 'hesap\\s*makine', 'maliyet\\s*hesap'].join('|'), 'i',
);

const ASSESSMENT_EVIDENCE_RE = new RegExp(
  ['\\bassessment\\b', 'readiness\\s*(check|assessment|score)?', '\\baudit\\b', 'scorecard',
    'self[-\\s]*assessment', 'maturity\\s*(model|assessment)', 'compliance\\s*check', 'eligibility\\s*check',
    'de[ğg]erlendirme', 'haz[ıi]rl[ıi]k\\s*(kontrol|de[ğg]erlendir)', 'denetim'].join('|'), 'i',
);

const COMPLIANCE_EVIDENCE_RE = new RegExp(
  ['complian', 'regulat', '\\bcbam\\b', 'emission', 'carbon\\s*(border|report|tax)?', 'tax\\s*(complian|filing|report)',
    'audit\\s*readiness', 'certification\\s*(prep|readiness)?', 'regulatory\\s*(filing|report)', 'privacy\\s*(complian|regulation)',
    '\\bgdpr\\b', '\\bkvkk\\b', '\\besg\\b', 'reporting\\s*(tool|software|platform|obligation|requirement)',
    'uyumluluk', 'mevzuat', 'd[üu]zenleme', 'raporlama', 'vergi\\s*(uyum|beyan)', 'karbon', 'emisyon', 'sertifika'].join('|'), 'i',
);

const WORKFLOW_EVIDENCE_RE = new RegExp(
  ['workflow', 'multi[-\\s]*step', 'process\\s*(automation|management)', '\\bpipeline\\b', 'operations\\b',
    'onboarding\\s*flow', 'data\\s*(collection|entry)', 'approval\\s*flow', 'case\\s*management', 'step[-\\s]*by[-\\s]*step',
    'i[şs]\\s*ak[ıi][şs]', 's[üu]re[çc]', 'operasyon', '[çc]ok\\s*ad[ıi]m', 've[şs]\\s*ak[ıi][şs]'].join('|'), 'i',
);

const BOOKING_EVIDENCE_RE = new RegExp(
  ['booking', 'reservation', 'reserve\\s*a', 'appointment', 'schedul(e|ing)', 'book\\s*a\\s*(table|room|slot|call|demo\\b)?',
    'randevu', 'rezervasyon'].join('|'), 'i',
);

/** Commerce as the PRIMARY concept (the product itself IS a store/marketplace), never a
 *  mere target vertical. Concept Authority already resolves this into primaryConcept. */
const COMMERCE_PRIMARY_RE = new RegExp(
  ['marketplace', 'storefront', 'online\\s*store', 'e-?commerce\\s*(store|site|platform)', 'shopping\\s*site',
    'ma[ğg]aza', '[üu]r[üu]n\\s*katalo[ğg]u'].join('|'), 'i',
);

const CONTENT_CONCEPTS = new Set(['archive', 'portfolio', 'education', 'nonprofit', 'publication']);
const SOFTWARE_CONCEPTS = new Set(['ai', 'saas']);
const SOFTWARE_TOKEN_RE = /\bai\b|artificial\s*intelligence|\bsaas\b|software|platform|automation|\bapi\b|\bsdk\b|tool\b|yaz[ıi]l[ıi]m|yapay\s*zek/i;

/* ── Public predicates (pure) ──────────────────────────────────────────────── */

/** True ONLY with strong conversational evidence. "AI"/"assistant"/"copilot"/"SaaS"
 *  alone are NOT proof of chat intent. */
export function hasExplicitChatIntent(text: string): boolean {
  return CHAT_EVIDENCE_RE.test(text || '');
}

export function hasExplicitDashboardIntent(text: string): boolean {
  return DASHBOARD_EVIDENCE_RE.test(text || '');
}

export function isComplianceOriented(text: string): boolean {
  return COMPLIANCE_EVIDENCE_RE.test(text || '');
}

export function isWorkflowOriented(text: string): boolean {
  return WORKFLOW_EVIDENCE_RE.test(text || '') || COMPLIANCE_EVIDENCE_RE.test(text || '');
}

/* ── Section-label + drift vocabularies (deterministic per family) ───────────── */

function complianceWorkflowLabels(lang: ProductLang): string[] {
  return [
    pick(lang, 'Product Overview', 'Ürün Genel Bakış'),
    pick(lang, 'Scope & Eligibility', 'Kapsam & Uygunluk'),
    pick(lang, 'Data Collection Workflow', 'Veri Toplama Akışı'),
    pick(lang, 'Report Readiness', 'Rapor Hazırlığı'),
    pick(lang, 'Compliance Checklist', 'Uyumluluk Kontrol Listesi'),
    pick(lang, 'Trust & Methodology', 'Güven & Metodoloji'),
    pick(lang, 'Request a Demo', 'Demo Talep Et'),
  ];
}

function genericSoftwareLabels(lang: ProductLang): string[] {
  return [
    pick(lang, 'Product Workflow', 'Ürün Akışı'),
    pick(lang, 'Core Capabilities', 'Temel Yetenekler'),
    pick(lang, 'How It Works', 'Nasıl Çalışır'),
    pick(lang, 'Product Preview', 'Ürün Önizleme'),
    pick(lang, 'Trust & Reliability', 'Güven & Güvenilirlik'),
    pick(lang, 'Get Started', 'Başla'),
  ];
}

function chatLabels(lang: ProductLang): string[] {
  return [
    pick(lang, 'Chat Experience', 'Sohbet Deneyimi'),
    pick(lang, 'Conversation Flow', 'Konuşma Akışı'),
    pick(lang, 'Human Handoff', 'İnsana Devir'),
    pick(lang, 'Chat Channels', 'Sohbet Kanalları'),
    pick(lang, 'Messaging Integrations', 'Mesajlaşma Entegrasyonları'),
  ];
}

function catalogLabels(lang: ProductLang): string[] {
  return [
    pick(lang, 'Shopper Flow', 'Alışveriş Akışı'),
    pick(lang, 'Store Integrations', 'Mağaza Entegrasyonları'),
    pick(lang, 'Product Recommendations', 'Ürün Önerileri'),
    pick(lang, 'Product Discovery', 'Ürün Keşfi'),
  ];
}

function dashboardLabels(lang: ProductLang): string[] {
  return [
    pick(lang, 'Dashboard Overview', 'Panel Genel Bakış'),
    pick(lang, 'Key Metrics', 'Temel Metrikler'),
    pick(lang, 'Data Views', 'Veri Görünümleri'),
    pick(lang, 'Reporting', 'Raporlama'),
    pick(lang, 'Trust & Reliability', 'Güven & Güvenilirlik'),
    pick(lang, 'Book a Demo', 'Demo Ayarla'),
  ];
}

function calculatorLabels(lang: ProductLang): string[] {
  return [
    pick(lang, 'How It Works', 'Nasıl Çalışır'),
    pick(lang, 'Inputs', 'Girdiler'),
    pick(lang, 'Calculation', 'Hesaplama'),
    pick(lang, 'Results Preview', 'Sonuç Önizleme'),
    pick(lang, 'Trust & Methodology', 'Güven & Metodoloji'),
    pick(lang, 'Try Calculator', 'Hesaplayıcıyı Dene'),
  ];
}

function assessmentLabels(lang: ProductLang): string[] {
  return [
    pick(lang, 'Overview', 'Genel Bakış'),
    pick(lang, 'Scope', 'Kapsam'),
    pick(lang, 'Assessment Steps', 'Değerlendirme Adımları'),
    pick(lang, 'Readiness Score', 'Hazırlık Skoru'),
    pick(lang, 'Methodology', 'Metodoloji'),
    pick(lang, 'Check Readiness', 'Hazırlığı Kontrol Et'),
  ];
}

function bookingLabels(lang: ProductLang): string[] {
  return [
    pick(lang, 'Overview', 'Genel Bakış'),
    pick(lang, 'Availability', 'Uygunluk'),
    pick(lang, 'Booking Flow', 'Rezervasyon Akışı'),
    pick(lang, 'Details', 'Ayrıntılar'),
    pick(lang, 'Trust', 'Güven'),
    pick(lang, 'Book Now', 'Şimdi Ayırt'),
  ];
}

function contentLabels(lang: ProductLang): string[] {
  return [
    pick(lang, 'Overview', 'Genel Bakış'),
    pick(lang, 'Highlights', 'Öne Çıkanlar'),
    pick(lang, 'Collection', 'Koleksiyon'),
    pick(lang, 'About', 'Hakkında'),
    pick(lang, 'Contact', 'İletişim'),
  ];
}

/** Lowercased chat drift tokens (never allowed unless explicit chat). */
const CHAT_DRIFT_TOKENS = [
  'chat experience', 'conversation flow', 'human handoff', 'chat channels', 'messaging integrations',
  'chat widget', 'chat-flow', 'chat flow', 'answer routing', 'support handoff', 'storefront chat',
  'chat demo', 'conversation overview', 'live chat',
];
/** Lowercased store/shopper drift tokens (never allowed unless the concept is a store). */
const STORE_DRIFT_TOKENS = [
  'shopper flow', 'store integrations', 'product recommendations', 'product recommendation',
  'storefront chat', 'product discovery', 'add to cart', 'shopping cart', 'shopper assistant',
  'shopping assistant', 'checkout flow',
];

/** Localized section labels for a resolved demo family. `compliance` picks the
 *  regulatory workflow vocabulary; every generic non-chat software product uses the
 *  neutral product vocabulary. */
export function preferredSectionLabelsFor(
  family: ProductDemoFamily,
  lang: ProductLang,
  compliance: boolean,
): string[] {
  switch (family) {
    case 'chat-demo': return chatLabels(lang);
    case 'catalog-demo': return catalogLabels(lang);
    case 'dashboard-demo': return dashboardLabels(lang);
    case 'calculator-demo': return calculatorLabels(lang);
    case 'assessment-demo': return assessmentLabels(lang);
    case 'booking-demo': return bookingLabels(lang);
    case 'content-demo': return contentLabels(lang);
    case 'workflow-demo': return compliance ? complianceWorkflowLabels(lang) : genericSoftwareLabels(lang);
    case 'product-flow-demo': return genericSoftwareLabels(lang);
    default: return genericSoftwareLabels(lang);
  }
}

/** Drift labels/tokens that must never appear for this intent (lowercased). Chat tokens
 *  are forbidden unless chat is explicit; store tokens unless the concept is a store. */
export function forbiddenDriftLabelsFor(explicitChat: boolean, catalogOriented: boolean): string[] {
  const out: string[] = [];
  if (!explicitChat) out.push(...CHAT_DRIFT_TOKENS);
  if (!catalogOriented) out.push(...STORE_DRIFT_TOKENS);
  return dedupe(out);
}

/* ── Demo requirements per family ────────────────────────────────────────────── */

function demoRequirements(family: ProductDemoFamily, lang: ProductLang, compliance: boolean): { mustShow: string[]; mustAvoid: string[] } {
  const avoidCommon = [
    pick(lang, 'fake metrics, logos or testimonials', 'sahte metrik, logo veya referans'),
    pick(lang, 'fake AI / compliance (SOC2/ISO) claims', 'sahte AI / uyumluluk (SOC2/ISO) iddiaları'),
  ];
  const noChatAvoid = pick(lang, 'a chatbot / conversation / human-handoff surface', 'sohbet botu / konuşma / insana-devir yüzeyi');
  const noStoreAvoid = pick(lang, 'a storefront / shopper / product-recommendation flow', 'mağaza / alışveriş / ürün-öneri akışı');

  switch (family) {
    case 'chat-demo':
      return {
        mustShow: [
          pick(lang, 'A real conversation flow (question → routed answer)', 'Gerçek bir konuşma akışı (soru → yönlendirilmiş yanıt)'),
          pick(lang, 'A clear support handoff moment', 'Net bir destek devri anı'),
          pick(lang, 'Channel / integration context', 'Kanal / entegrasyon bağlamı'),
        ],
        mustAvoid: [...avoidCommon, noStoreAvoid],
      };
    case 'workflow-demo':
      return {
        mustShow: compliance
          ? [
              pick(lang, 'Scope & eligibility for the regulation', 'Düzenleme için kapsam & uygunluk'),
              pick(lang, 'A data-collection / entry workflow', 'Veri toplama / giriş akışı'),
              pick(lang, 'Report preparation and readiness', 'Rapor hazırlama ve hazırlık durumu'),
              pick(lang, 'A compliance readiness checklist', 'Uyumluluk hazırlık kontrol listesi'),
            ]
          : [
              pick(lang, 'The core product workflow, step by step', 'Çekirdek ürün akışı, adım adım'),
              pick(lang, 'What the product actually does', 'Ürünün gerçekte ne yaptığı'),
            ],
        mustAvoid: [...avoidCommon, noChatAvoid, noStoreAvoid],
      };
    case 'catalog-demo':
      return {
        mustShow: [pick(lang, 'A real catalog / browse experience', 'Gerçek bir katalog / gezinme deneyimi')],
        mustAvoid: [...avoidCommon, noChatAvoid],
      };
    case 'dashboard-demo':
      return {
        mustShow: [pick(lang, 'A representative dashboard / metrics view', 'Temsili bir panel / metrik görünümü')],
        mustAvoid: [...avoidCommon, noChatAvoid, noStoreAvoid],
      };
    case 'calculator-demo':
      return {
        mustShow: [pick(lang, 'Inputs → calculation → an honest result preview', 'Girdiler → hesaplama → dürüst bir sonuç önizleme')],
        mustAvoid: [...avoidCommon, noChatAvoid, noStoreAvoid],
      };
    case 'assessment-demo':
      return {
        mustShow: [pick(lang, 'Assessment steps → a readiness result', 'Değerlendirme adımları → hazırlık sonucu')],
        mustAvoid: [...avoidCommon, noChatAvoid, noStoreAvoid],
      };
    case 'booking-demo':
      return {
        mustShow: [pick(lang, 'An availability → booking flow', 'Uygunluk → rezervasyon akışı')],
        mustAvoid: [...avoidCommon, noChatAvoid],
      };
    case 'content-demo':
      return {
        mustShow: [pick(lang, 'The core content / collection the concept presents', 'Konseptin sunduğu çekirdek içerik / koleksiyon')],
        mustAvoid: [...avoidCommon, noChatAvoid, noStoreAvoid],
      };
    case 'product-flow-demo':
      return {
        mustShow: [
          pick(lang, 'The core product flow, end to end', 'Çekirdek ürün akışı, baştan sona'),
          pick(lang, 'What the product actually does', 'Ürünün gerçekte ne yaptığı'),
        ],
        mustAvoid: [...avoidCommon, noChatAvoid, noStoreAvoid],
      };
    default:
      return { mustShow: [pick(lang, 'The core experience this concept promises', 'Bu konseptin vaat ettiği çekirdek deneyim')], mustAvoid: avoidCommon };
  }
}

/* ── Demo-family resolution (strict deterministic precedence) ─────────────────── */

/** Resolve the honest demo family. Explicit chat/dashboard/calculator/assessment win
 *  first; then compliance/workflow; then a store concept; then booking; then generic
 *  software; then content; else none. A model demo-module may refine WITHIN non-chat
 *  families but can NEVER introduce chat without explicit chat evidence. */
export function resolveDemoFamily(input: ProductIntentInput): ProductDemoFamily {
  const text = `${input.prompt || ''} ${input.briefText || ''}`;
  const concept = (input.primaryConcept || '').toLowerCase();

  const explicitChat = hasExplicitChatIntent(text);
  const explicitDashboard = hasExplicitDashboardIntent(text);
  const calculator = CALCULATOR_EVIDENCE_RE.test(text);
  const assessment = ASSESSMENT_EVIDENCE_RE.test(text);
  const compliance = COMPLIANCE_EVIDENCE_RE.test(text);
  const workflow = WORKFLOW_EVIDENCE_RE.test(text) || compliance;
  const catalog = concept === 'marketplace' || COMMERCE_PRIMARY_RE.test(input.prompt || '');
  const booking = (concept === 'hospitality' || BOOKING_EVIDENCE_RE.test(text)) && !SOFTWARE_CONCEPTS.has(concept);
  const software = SOFTWARE_CONCEPTS.has(concept) || SOFTWARE_TOKEN_RE.test(text);
  const content = CONTENT_CONCEPTS.has(concept);

  let family: ProductDemoFamily;
  if (explicitChat) family = 'chat-demo';
  else if (explicitDashboard) family = 'dashboard-demo';
  else if (calculator) family = 'calculator-demo';
  else if (assessment) family = 'assessment-demo';
  else if (workflow) family = 'workflow-demo';
  else if (catalog) family = 'catalog-demo';
  else if (booking) family = 'booking-demo';
  else if (software) family = 'product-flow-demo';
  else if (content) family = 'content-demo';
  else family = 'none';

  // A model demo-module may REFINE presentation but never override explicit correctness
  // and never introduce chat without explicit chat evidence.
  const dm = (input.modelDemoModule || '').toLowerCase();
  if (dm && !explicitChat) {
    if (dm === 'data-dashboard' && (family === 'product-flow-demo' || family === 'workflow-demo')) family = 'dashboard-demo';
    else if (dm === 'catalog-archive' && (family === 'product-flow-demo' || family === 'content-demo')) family = 'catalog-demo';
    else if (dm === 'product-showcase' && family === 'none') family = 'product-flow-demo';
  }
  return family;
}

/**
 * Resolve the full product intent. Pure/deterministic/fail-open. The original prompt +
 * authoritative concept take priority over generic category defaults; a model plan that
 * drifts to "chat" is rejected unless the prompt carries explicit chat evidence.
 */
export function resolveProductIntent(input: ProductIntentInput): ProductIntent {
  const lang: ProductLang = input.lang === 'tr' ? 'tr' : 'en';
  const text = `${input.prompt || ''} ${input.briefText || ''}`;
  const concept = (input.primaryConcept || '').toLowerCase();

  const explicitChat = hasExplicitChatIntent(text);
  const explicitDashboard = hasExplicitDashboardIntent(text);
  const calculatorOriented = CALCULATOR_EVIDENCE_RE.test(text);
  const assessmentOriented = ASSESSMENT_EVIDENCE_RE.test(text);
  const complianceOriented = COMPLIANCE_EVIDENCE_RE.test(text);
  const workflowOriented = WORKFLOW_EVIDENCE_RE.test(text) || complianceOriented;
  const catalogOriented = concept === 'marketplace' || COMMERCE_PRIMARY_RE.test(input.prompt || '');
  const bookingOriented = (concept === 'hospitality' || BOOKING_EVIDENCE_RE.test(text)) && !SOFTWARE_CONCEPTS.has(concept);
  const contentOriented = CONTENT_CONCEPTS.has(concept);
  const softwareProduct = SOFTWARE_CONCEPTS.has(concept) || SOFTWARE_TOKEN_RE.test(text);

  const demoFamily = resolveDemoFamily(input);
  const compliance = complianceOriented && (demoFamily === 'workflow-demo');
  const { mustShow, mustAvoid } = demoRequirements(demoFamily, lang, compliance);

  const reason = pick(
    lang,
    `Product intent: ${demoFamily}${explicitChat ? ' (explicit chat)' : ''}${complianceOriented ? ' · compliance/regulatory' : ''}${input.targetVertical ? ` · vertical: ${input.targetVertical}` : ''}. Chat/store surfaces require explicit evidence.`,
    `Ürün niyeti: ${demoFamily}${explicitChat ? ' (açık sohbet)' : ''}${complianceOriented ? ' · uyumluluk/mevzuat' : ''}${input.targetVertical ? ` · dikey: ${input.targetVertical}` : ''}. Sohbet/mağaza yüzeyleri açık kanıt gerektirir.`,
  );

  return {
    demoFamily,
    explicitChat,
    explicitDashboard,
    workflowOriented,
    complianceOriented,
    catalogOriented,
    bookingOriented,
    calculatorOriented,
    assessmentOriented,
    contentOriented,
    softwareProduct,
    preferredSectionLabels: dedupe(preferredSectionLabelsFor(demoFamily, lang, compliance)),
    forbiddenDriftLabels: forbiddenDriftLabelsFor(explicitChat, catalogOriented),
    demoMustShow: dedupe(mustShow),
    demoMustAvoid: dedupe(mustAvoid),
    reason,
  };
}

/**
 * Decide whether a model-plan / free-text demo decision that mentions "chat" is allowed.
 * Deterministic correctness wins: a "chat" decision is rejected when the authoritative
 * text carries no explicit chat evidence. Returns true when the chat decision is allowed.
 */
export function chatDecisionAllowed(authoritativeText: string): boolean {
  return hasExplicitChatIntent(authoritativeText || '');
}

/**
 * Detect whether a candidate label/token is a forbidden drift for this intent (case-
 * insensitive substring match against the resolved forbidden set). Pure helper for the
 * downstream architecture/spec guards.
 */
export function isForbiddenDriftLabel(label: string, forbidden: string[]): boolean {
  const l = norm(label);
  return forbidden.some((f) => l.includes(f.toLowerCase()));
}
