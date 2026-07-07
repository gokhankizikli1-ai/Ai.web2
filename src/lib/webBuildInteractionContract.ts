/**
 * Web Build INTERACTION CONTRACT layer (Phase 1 — contract only).
 *
 * `webBuildInteraction.ts` routes CTAs to scroll anchors, which prevents dead
 * links but cannot express the richer, app-like behaviour a real concept needs
 * (open a chat demo, open a detail modal, filter a catalog, open a quote form,
 * request archive access …). This module derives a small, STRUCTURED and
 * DETERMINISTIC "Interaction Contract" — a declaration of which actions each
 * section SHOULD support and which stateful components they imply — so a later
 * phase (Preview + generated files) can implement the real behaviour safely.
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

export interface InteractionContract {
  /** The concept category the contract was derived for (echoes the input). */
  conceptCategory: string;
  primaryAction: InteractionAction;
  secondaryActions: InteractionAction[];
  /** sectionId → the actions that section should support. */
  sectionActions: Record<string, InteractionAction[]>;
  /** Stateful components a later phase must build to honour the contract (e.g.
   *  "chat-demo-panel", "filter-controls", "record-detail-modal"). Never a claim
   *  about existing features — a to-build list for Phase 2. */
  requiredStatefulComponents: string[];
  notes: string[];
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

  // Safe default primary: scroll to the conversion section (or first content) when
  // the concept did not resolve to a richer, section-backed primary action.
  if (!primary) {
    const target = find(RE.cta) || firstContent();
    primary = mk('scroll-to-section', primaryLabel, { targetSectionId: target?.id, priority: 'primary', reason: 'Safe default — scroll to the primary conversion section.' });
  }

  notes.push(L(lang, 'Phase 1 contract only — no interaction UI is implemented yet.', 'Yalnızca Faz 1 sözleşmesi — henüz etkileşim arayüzü uygulanmadı.'));
  notes.push(family === 'general'
    ? L(lang, 'General concept — scroll-only interactions by default.', 'Genel konsept — varsayılan olarak yalnızca kaydırma etkileşimleri.')
    : L(lang, `Concept family: ${family}.`, `Konsept ailesi: ${family}.`));

  return {
    conceptCategory: clean(input.conceptCategory) || family,
    primaryAction: primary,
    secondaryActions,
    sectionActions,
    requiredStatefulComponents: Array.from(required),
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
