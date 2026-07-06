/**
 * Web Build SECTION ARCHITECTURE enforcement.
 *
 * The upstream agents (Research → UI/Art Director → Strategy) now produce a rich,
 * concept-specific brief — but the actual page section LIST is still mostly the
 * backend's "Page Sections", which is often generic (Features / Services / About /
 * Final CTA). So even with concept-specific styling the site can still read as the
 * same template.
 *
 * This layer fixes that at the STRUCTURE level: for a fresh build whose section
 * architecture is weak or mismatched, it replaces the section list with a
 * concept-specific architecture selected from the agents' structured signals —
 * BEFORE the layout plan and files are derived, so Preview AND All Files render the
 * new structure. It is pure, deterministic and NON-BLOCKING: it never throws, never
 * fabricates facts (bullets are the concept's real offerings/proof needs or honest
 * structural UI labels — never fake metrics, names, sources or compliance), and it
 * preserves good backend copy (hero headline/sub, CTAs, language) and good backend
 * sections when they are already concept-specific.
 *
 * All cross-module imports are TYPE-ONLY, so there is no runtime import cycle.
 */
import type { WebBuildBrief } from '@/lib/webBuildApi';
import type { WebBuildSectionItem } from '@/lib/webBuildPayload';
import type { InferredBrief } from '@/lib/webBuildBrief';
import type { ResearchAgentArtifact, ArtDirectionArtifact, StrategyAgentArtifact } from '@/lib/webBuildAgents';

type Lang = string;
const L = (lang: Lang, en: string, tr: string) => (lang === 'tr' ? tr : en);
const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9çğıöşü]+/gi, ' ').trim();
const uniq = (xs: (string | undefined)[]): string[] => Array.from(new Set(xs.map((x) => (x || '').trim()).filter(Boolean)));
const pascal = (id: string) => id.replace(/(^|[-_ ]+)(\w)/g, (_m, _s, c: string) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '') || 'Section';
const humanize = (id: string) => id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** The section-architecture playbook modes — the surface families that get a
 *  genuinely different page STRUCTURE. Deterministic and reusable. */
export type ArchMode =
  | 'archive' | 'landscaping' | 'hospitality' | 'trustService' | 'productSaas'
  | 'marketplace' | 'education' | 'community' | 'event' | 'industrial'
  | 'portfolio' | 'localService' | 'generic';

export interface SectionArchInput {
  prompt: string;
  sectionItems: WebBuildSectionItem[];
  brief: WebBuildBrief;
  inferred: InferredBrief;
  research?: ResearchAgentArtifact;
  artDirection?: ArtDirectionArtifact;
  strategy?: StrategyAgentArtifact;
  lang?: Lang;
  isRevision?: boolean;
}

export interface SectionArchResult {
  sectionItems: WebBuildSectionItem[];
  didRewrite: boolean;
  reason?: string;
  mode?: ArchMode;
}

/* ── Mode selection (structured signals, most authoritative first) ──────── */

const CATEGORY_TO_MODE: Record<string, ArchMode> = {
  archive: 'archive', hospitality: 'hospitality', landscaping: 'landscaping', local_service: 'localService',
  legal: 'trustService', medical: 'trustService', finance: 'trustService', ai: 'productSaas', saas: 'productSaas',
  marketplace: 'marketplace', education: 'education', nonprofit: 'community', portfolio: 'portfolio',
  industrial: 'industrial', event: 'event', real_estate: 'marketplace',
};
const ARTKEY_TO_MODE: Record<string, ArchMode> = {
  'editorial-archive': 'archive', 'real-estate': 'marketplace', 'landscaping-nature': 'landscaping',
  'legal-medical-trust': 'trustService', 'fintech-trust': 'trustService', 'local-service-premium': 'localService',
  'wellness-retreat': 'hospitality', 'restaurant-hospitality': 'hospitality', 'high-conversion-saas': 'productSaas',
  'ai-tool': 'productSaas', 'founder-startup': 'productSaas', 'marketplace-catalog': 'marketplace',
  'education-platform': 'education', 'community-membership': 'community', 'nonprofit-campaign': 'community',
  'industrial-b2b': 'industrial', 'event-conference': 'event', 'cinematic-studio': 'portfolio',
  'creative-agency': 'portfolio', 'portfolio-showcase': 'portfolio', 'luxury-boutique': 'portfolio', 'modern-brand': 'generic',
};
const LAYOUT_TO_MODE: Record<string, ArchMode> = {
  archive: 'archive', editorial: 'archive', hospitality: 'hospitality', 'luxury-service': 'trustService',
  dashboard: 'productSaas', 'data-platform': 'productSaas', technical: 'industrial', marketplace: 'marketplace',
  membership: 'education', community: 'community', event: 'event', portfolio: 'portfolio', standard: 'generic',
};
const INDUSTRY_TO_MODE: Record<string, ArchMode> = {
  ai_saas: 'productSaas', fitness: 'trustService', landscaping: 'landscaping', furniture: 'marketplace',
  automotive: 'marketplace', restaurant: 'hospitality', portfolio: 'portfolio', agency: 'portfolio',
  ecommerce: 'marketplace', local_service: 'localService', generic: 'generic',
};
const PROMPT_MODE_RULES: Array<[RegExp, ArchMode]> = [
  [/archive|museum|catalog|catalogue|collection|library|exhibit|manuscript|arşiv|müze|koleksiyon|kütüphane/, 'archive'],
  [/landscap|garden|lawn|outdoor|nursery|peyzaj|bahçe/, 'landscaping'],
  [/restaurant|cafe|coffee|menu|dining|bistro|bakery|hotel|restoran|kafe|menü|lokanta/, 'hospitality'],
  [/legal|law|lawyer|attorney|medical|clinic|health|dental|doctor|therap|avukat|hukuk|klinik|sağlık|diş/, 'trustService'],
  [/marketplace|ecommerce|e-?commerce|store|shop|storefront|retail|product|mağaza|ürün|e-?ticaret/, 'marketplace'],
  [/course|education|academy|learn|curriculum|bootcamp|eğitim|kurs|akademi|müfredat/, 'education'],
  [/nonprofit|charity|donate|campaign|foundation|volunteer|bağış|vakıf|dernek|gönüllü/, 'community'],
  [/event|conference|summit|festival|expo|webinar|etkinlik|konferans|zirve|fuar/, 'event'],
  [/industrial|manufactur|logistics|machinery|engineering|construction|b2b|sanayi|üretim|fabrika|inşaat/, 'industrial'],
  [/portfolio|showcase|studio|creative|agency|photograph|portfolyo|stüdyo|ajans/, 'portfolio'],
  [/saas|dashboard|\bai\b|software|platform|api|analytics|automation|yazılım|otomasyon/, 'productSaas'],
];

function detectMode(input: SectionArchInput): ArchMode {
  const cat = input.research?.conceptProfile?.category;
  if (cat && CATEGORY_TO_MODE[cat]) return CATEGORY_TO_MODE[cat];
  const artKey = input.artDirection?.designArchetype?.key || input.brief.artDesignArchetype;
  if (artKey && ARTKEY_TO_MODE[artKey]) return ARTKEY_TO_MODE[artKey];
  const layoutKey = input.brief.agentArchetype;
  if (layoutKey && LAYOUT_TO_MODE[layoutKey]) return LAYOUT_TO_MODE[layoutKey];
  const byIndustry = INDUSTRY_TO_MODE[input.inferred.industry];
  if (byIndustry && byIndustry !== 'generic') return byIndustry;
  const hay = [input.prompt, input.brief.type, input.brief.coreIdea, input.brief.style].filter(Boolean).join(' ').toLowerCase();
  for (const [re, mode] of PROMPT_MODE_RULES) if (re.test(hay)) return mode;
  return byIndustry || 'generic';
}

/* ── Section catalog (id → label + content role). Reused across playbooks so a
 *  shared id (process, faq, footer…) is defined once. `role` selects the honest
 *  bullet source. Any id missing here falls back to a humanized label + 'offer'. */
type Role = 'offer' | 'browse' | 'proof' | 'process' | 'filter' | 'materials'
  | 'location' | 'venue' | 'people' | 'story' | 'faq' | 'cta' | 'info';

interface SectionMeta { name: [string, string]; role: Role }
const SECTIONS: Record<string, SectionMeta> = {
  // archive
  'collection-index': { name: ['Collection', 'Koleksiyon'], role: 'browse' },
  'document-types': { name: ['Document types', 'Belge türleri'], role: 'offer' },
  'research-filters': { name: ['Search & filters', 'Arama ve filtreler'], role: 'filter' },
  provenance: { name: ['Provenance & curation', 'Menşe ve küratörlük'], role: 'proof' },
  'researcher-access': { name: ['Researcher access', 'Araştırmacı erişimi'], role: 'cta' },
  // landscaping
  'project-gallery': { name: ['Projects', 'Projeler'], role: 'browse' },
  'before-after': { name: ['Before & after', 'Önce & sonra'], role: 'proof' },
  materials: { name: ['Materials', 'Malzemeler'], role: 'materials' },
  'local-proof': { name: ['Real, local proof', 'Gerçek, yerel kanıt'], role: 'proof' },
  'quote-cta': { name: ['Request a quote', 'Teklif iste'], role: 'cta' },
  // hospitality
  menu: { name: ['Menu', 'Menü'], role: 'offer' },
  ambience: { name: ['Ambience', 'Ambiyans'], role: 'browse' },
  reservation: { name: ['Reservations', 'Rezervasyon'], role: 'cta' },
  'location-hours': { name: ['Location & hours', 'Konum & saatler'], role: 'location' },
  // trust service / legal / medical
  credentials: { name: ['Credentials', 'Referanslar'], role: 'proof' },
  services: { name: ['Services', 'Hizmetler'], role: 'offer' },
  'trust-proof': { name: ['Trust & proof', 'Güven & kanıt'], role: 'proof' },
  contact: { name: ['Contact', 'İletişim'], role: 'cta' },
  // product / saas / ai
  'product-demo': { name: ['Product demo', 'Ürün demosu'], role: 'browse' },
  'use-cases': { name: ['Use cases', 'Kullanım senaryoları'], role: 'offer' },
  workflow: { name: ['How it works', 'Nasıl çalışır'], role: 'process' },
  integrations: { name: ['Integrations', 'Entegrasyonlar'], role: 'offer' },
  'security-proof': { name: ['Security & trust', 'Güvenlik & güven'], role: 'proof' },
  pricing: { name: ['Pricing', 'Fiyatlandırma'], role: 'offer' },
  // marketplace
  'collection-grid': { name: ['Collections', 'Koleksiyonlar'], role: 'browse' },
  'featured-products': { name: ['Featured', 'Öne çıkanlar'], role: 'browse' },
  'trust-shipping': { name: ['Shipping & returns', 'Kargo & iade'], role: 'proof' },
  'pricing-cart-cta': { name: ['Start shopping', 'Alışverişe başla'], role: 'cta' },
  // education
  outcomes: { name: ['Outcomes', 'Kazanımlar'], role: 'offer' },
  curriculum: { name: ['Curriculum', 'Müfredat'], role: 'process' },
  'instructor-proof': { name: ['Your instructors', 'Eğitmenleriniz'], role: 'proof' },
  'pricing-enroll': { name: ['Pricing & enroll', 'Fiyat & kayıt'], role: 'cta' },
  // community / nonprofit
  story: { name: ['Our story', 'Hikâyemiz'], role: 'story' },
  impact: { name: ['Impact', 'Etki'], role: 'proof' },
  programs: { name: ['Programs', 'Programlar'], role: 'offer' },
  donation: { name: ['Ways to give', 'Bağış yolları'], role: 'cta' },
  volunteers: { name: ['Get involved', 'Katıl'], role: 'cta' },
  // event
  speakers: { name: ['Speakers', 'Konuşmacılar'], role: 'people' },
  agenda: { name: ['Agenda', 'Program'], role: 'process' },
  venue: { name: ['Venue', 'Mekan'], role: 'venue' },
  sponsors: { name: ['Sponsors', 'Sponsorlar'], role: 'proof' },
  tickets: { name: ['Register', 'Kayıt ol'], role: 'cta' },
  // industrial
  capabilities: { name: ['Capabilities', 'Yetenekler'], role: 'offer' },
  specifications: { name: ['Specifications', 'Teknik özellikler'], role: 'offer' },
  certifications: { name: ['Certifications', 'Sertifikalar'], role: 'proof' },
  'case-studies': { name: ['Case studies', 'Vaka çalışmaları'], role: 'browse' },
  'request-quote': { name: ['Request a quote', 'Teklif iste'], role: 'cta' },
  // portfolio
  'selected-work': { name: ['Selected work', 'Seçili işler'], role: 'browse' },
  process: { name: ['Process', 'Süreç'], role: 'process' },
  testimonials: { name: ['Testimonials', 'Yorumlar'], role: 'proof' },
  'start-project': { name: ['Start a project', 'Projeye başla'], role: 'cta' },
  // shared
  reviews: { name: ['Reviews', 'Yorumlar'], role: 'proof' },
  faq: { name: ['FAQ', 'Sıkça sorulanlar'], role: 'faq' },
  'final-cta': { name: ['Get started', 'Hemen başla'], role: 'cta' },
};

const PLAYBOOKS: Record<Exclude<ArchMode, 'generic'>, string[]> = {
  archive: ['hero', 'collection-index', 'document-types', 'research-filters', 'provenance', 'researcher-access', 'final-cta', 'footer'],
  landscaping: ['hero', 'project-gallery', 'before-after', 'materials', 'process', 'local-proof', 'quote-cta', 'footer'],
  hospitality: ['hero', 'menu', 'ambience', 'reservation', 'location-hours', 'reviews', 'final-cta', 'footer'],
  trustService: ['hero', 'credentials', 'services', 'process', 'trust-proof', 'faq', 'contact', 'footer'],
  productSaas: ['hero', 'product-demo', 'use-cases', 'workflow', 'integrations', 'security-proof', 'pricing', 'final-cta', 'footer'],
  marketplace: ['hero', 'collection-grid', 'featured-products', 'trust-shipping', 'reviews', 'pricing-cart-cta', 'footer'],
  education: ['hero', 'outcomes', 'curriculum', 'instructor-proof', 'pricing-enroll', 'faq', 'final-cta', 'footer'],
  community: ['hero', 'story', 'impact', 'programs', 'donation', 'volunteers', 'final-cta', 'footer'],
  event: ['hero', 'speakers', 'agenda', 'venue', 'sponsors', 'tickets', 'faq', 'footer'],
  industrial: ['hero', 'capabilities', 'specifications', 'process', 'certifications', 'case-studies', 'request-quote', 'footer'],
  portfolio: ['hero', 'selected-work', 'case-studies', 'process', 'testimonials', 'start-project', 'footer'],
  localService: ['hero', 'services', 'process', 'local-proof', 'reviews', 'faq', 'quote-cta', 'footer'],
};

/** Concept-specific keyword expectations per mode — used to detect a mismatch
 *  (a clear mode but no concept-specific section). */
const MODE_KEYWORDS: Partial<Record<ArchMode, string[]>> = {
  archive: ['collection', 'catalog', 'index', 'filter', 'document', 'provenance', 'research', 'access', 'koleksiyon', 'arşiv', 'belge', 'menşe'],
  landscaping: ['gallery', 'project', 'before', 'after', 'material', 'process', 'quote', 'galeri', 'proje', 'önce', 'sonra', 'malzeme', 'süreç', 'teklif'],
  hospitality: ['menu', 'reservation', 'location', 'ambien', 'review', 'menü', 'rezervasyon', 'konum', 'ambiyans'],
  trustService: ['credential', 'process', 'faq', 'contact', 'proof', 'trust', 'referans', 'süreç', 'iletişim', 'kanıt', 'güven'],
  productSaas: ['demo', 'use', 'case', 'integration', 'security', 'pricing', 'workflow', 'entegrasyon', 'güvenlik', 'fiyat'],
  marketplace: ['collection', 'product', 'shipping', 'review', 'cart', 'checkout', 'pricing', 'ürün', 'kargo', 'sepet', 'fiyat'],
  education: ['curriculum', 'outcome', 'instructor', 'enroll', 'pricing', 'müfredat', 'kazanım', 'eğitmen', 'kayıt'],
  community: ['story', 'impact', 'program', 'donat', 'volunteer', 'hikaye', 'etki', 'bağış', 'gönüllü'],
  event: ['speaker', 'agenda', 'venue', 'ticket', 'sponsor', 'konuşmacı', 'program', 'mekan', 'bilet'],
  industrial: ['capabilit', 'specification', 'spec', 'certification', 'case', 'quote', 'yetenek', 'teknik', 'sertifika', 'teklif'],
  portfolio: ['work', 'case', 'project', 'process', 'testimonial', 'iş', 'vaka', 'proje', 'süreç', 'referans'],
  localService: ['service', 'process', 'proof', 'review', 'quote', 'faq', 'hizmet', 'süreç', 'kanıt', 'yorum', 'teklif'],
};

/** Generic id tokens that do not express a concept. */
const GENERIC = new Set([
  'features', 'feature', 'services', 'service', 'benefits', 'benefit', 'content', 'section', 'overview',
  'final', 'testimonials', 'testimonial', 'about', 'academic', 'faq', 'contact', 'cta', 'process', 'home', 'info', 'details', 'more',
]);
const firstToken = (s: string) => norm(s).split(' ')[0] || '';
const isGeneric = (s: WebBuildSectionItem) => GENERIC.has(norm(s.id)) || GENERIC.has(firstToken(s.id)) || GENERIC.has(firstToken(s.name));

function findHero(items: WebBuildSectionItem[]): WebBuildSectionItem | undefined {
  return items.find((s) => /hero/i.test(s.id) || /hero|intro/i.test(s.name || ''));
}

/* ── Concept-coverage measurement against the mode's playbook ───────────────
 *
 * The soft check below (short / mostly-generic / one keyword hit) let weak
 * backend sets through: a few non-generic labels plus a single concept keyword
 * were enough to "preserve", so generic sets like Academic / About / Services /
 * Final leaked past for clear concepts. Instead we compare the current sections
 * against the REQUIRED playbook for the mode and only preserve when they cover a
 * meaningful portion of it (and clear the mode's must-have gate). */

/** Required content ids for a mode = its playbook minus hero/footer. */
function requiredContentIds(mode: ArchMode): string[] {
  const pb = PLAYBOOKS[mode as Exclude<ArchMode, 'generic'>];
  return pb ? pb.filter((id) => id !== 'hero' && id !== 'footer') : [];
}

/** Match tokens that mean "this required section is present": the id, its tokens,
 *  its localized names, and any mode synonym that belongs to this id. */
function synonymsForRequired(id: string, mode: ArchMode): string[] {
  const meta = SECTIONS[id];
  const toks = [
    norm(id),
    ...norm(id).split(' '),
    ...(meta ? norm(meta.name[0]).split(' ') : []),
    ...(meta ? norm(meta.name[1]).split(' ') : []),
  ].filter((t) => t.length >= 3);
  const nameHay = norm(`${id} ${meta ? `${meta.name[0]} ${meta.name[1]}` : ''}`);
  for (const k of MODE_KEYWORDS[mode] || []) if (nameHay.includes(k)) toks.push(k);
  return uniq(toks);
}

/** True when a single current section satisfies at least one required id. */
function itemCoversRequired(s: WebBuildSectionItem, mode: ArchMode): boolean {
  const hay = norm(`${s.id} ${s.name}`);
  return requiredContentIds(mode).some((id) => synonymsForRequired(id, mode).some((t) => hay.includes(t)));
}

/** Fraction of the mode's required sections that the current set covers (0..1). */
function conceptCoverageRatio(items: WebBuildSectionItem[], mode: ArchMode): number {
  const req = requiredContentIds(mode);
  if (!req.length) return 1;
  const hay = items.map((s) => norm(`${s.id} ${s.name}`)).join(' | ');
  const covered = req.filter((id) => synonymsForRequired(id, mode).some((t) => hay.includes(t))).length;
  return covered / req.length;
}

/** Concept-specific content sections = non-hero/footer sections that are either a
 *  concept label or a legit playbook-required section (so shared required labels
 *  like services / process / faq / contact are not under-counted). */
function conceptSectionCount(items: WebBuildSectionItem[], mode: ArchMode): number {
  return items
    .filter((s) => !/hero|footer/i.test(s.id))
    .filter((s) => !isGeneric(s) || itemCoversRequired(s, mode)).length;
}

/** Generic leakage = generic content sections that the mode's playbook does NOT
 *  require (so playbook-required shared sections are never counted as leak). */
function genericLeakRatio(items: WebBuildSectionItem[], mode: ArchMode): number {
  const content = items.filter((s) => !/hero|footer/i.test(s.id));
  if (!content.length) return 1;
  const reqTokens = new Set<string>();
  for (const id of requiredContentIds(mode)) {
    reqTokens.add(norm(id));
    for (const t of norm(id).split(' ')) reqTokens.add(t);
  }
  const leaks = content.filter((s) => {
    if (!isGeneric(s)) return false;
    return !(reqTokens.has(norm(s.id)) || reqTokens.has(firstToken(s.id)) || reqTokens.has(firstToken(s.name)));
  });
  return leaks.length / content.length;
}

/** Exact generic labels that must never survive for the strict concept modes. */
const HARD_LEAK = /^(academic|about|services?|features?|final)$/i;
function hasHardLeak(items: WebBuildSectionItem[]): boolean {
  return items
    .filter((s) => !/hero|footer/i.test(s.id))
    .some((s) => HARD_LEAK.test((s.id || '').trim()) || HARD_LEAK.test((s.name || '').trim()));
}

/** Mode must-have gates: each entry is a group of interchangeable keywords; the
 *  mode is satisfied only when at least `MUST_HAVE_MIN[mode]` groups are present.
 *  Archive & landscaping are deliberately strict. */
const MUST_HAVES: Partial<Record<ArchMode, string[][]>> = {
  archive: [['collection-index', 'collection', 'catalog'], ['document-types', 'document'], ['research-filters', 'search', 'filter'], ['provenance', 'curation', 'authenticity'], ['researcher-access', 'access']],
  landscaping: [['project-gallery', 'projects', 'gallery'], ['before-after', 'before', 'after'], ['materials'], ['process'], ['local-proof', 'proof', 'reviews'], ['quote-cta', 'quote', 'consultation']],
  hospitality: [['menu'], ['ambience', 'gallery'], ['reservation'], ['location-hours', 'location', 'hours'], ['reviews']],
  productSaas: [['product-demo', 'demo'], ['use-cases', 'use case'], ['workflow'], ['integrations', 'integration'], ['security-proof', 'security'], ['pricing']],
  trustService: [['credentials', 'credential'], ['services', 'service'], ['process'], ['trust-proof', 'trust'], ['faq'], ['contact']],
};
const MUST_HAVE_MIN: Partial<Record<ArchMode, number>> = {
  archive: 3, landscaping: 3, hospitality: 3, productSaas: 4, trustService: 3,
};

function mustHaveGateFails(items: WebBuildSectionItem[], mode: ArchMode): boolean {
  const groups = MUST_HAVES[mode];
  const min = MUST_HAVE_MIN[mode];
  if (!groups || !min) return false; // no gate for this mode
  const hay = items.map((s) => norm(`${s.id} ${s.name}`)).join(' | ');
  const satisfied = groups.filter((g) => g.some((k) => hay.includes(k))).length;
  return satisfied < min;
}

/**
 * Decide whether the current backend architecture is strong enough to preserve
 * for a clear (non-generic) mode, or should be rewritten from the playbook.
 * Returns a rewrite flag + an informative (internal, non-UI) reason.
 */
function sectionArchitectureDecision(
  items: WebBuildSectionItem[],
  mode: ArchMode,
): { rewrite: boolean; reason: string } {
  const content = items.filter((s) => !/hero|footer/i.test(s.id));
  if (content.length < 4) return { rewrite: true, reason: 'too-short' };

  // Mode's essential sections absent — the clearest reason to rewrite.
  if (mustHaveGateFails(items, mode)) return { rewrite: true, reason: 'missing-must-haves' };

  const coverage = conceptCoverageRatio(items, mode);
  const concept = conceptSectionCount(items, mode);
  const isLocal = mode === 'localService';
  const minCoverage = isLocal ? 0.5 : 0.6;
  const minSections = isLocal ? 3 : 4;
  if (coverage < minCoverage || concept < minSections) return { rewrite: true, reason: 'low-coverage' };

  // Generic labels dominate and coverage is not strong → rewrite.
  if (genericLeakRatio(items, mode) > 0.35 && coverage < 0.7) return { rewrite: true, reason: 'generic-leak' };
  // Exact generic leaks (Academic/About/Services/Features/Final) in the strict modes.
  if ((mode === 'archive' || mode === 'landscaping') && hasHardLeak(items) && coverage < 0.7) {
    return { rewrite: true, reason: 'generic-leak' };
  }

  return { rewrite: false, reason: 'covered' };
}

/* ── Honest, concept-specific bullet sources ────────────────────────────── */

const pick = (xs: string[] | undefined, n: number) => (xs || []).map((x) => (x || '').trim()).filter(Boolean).slice(0, n);
const trustBits = (brief: WebBuildBrief, inferred: InferredBrief) =>
  (brief.trustSignals || inferred.trustSignals || '').split(/[,·|/]|\bve\b|\band\b/i).map((s) => s.trim()).filter((s) => s.length >= 2);

function bulletsFor(role: Role, ctx: SectionArchInput): string[] {
  const lang = ctx.lang || 'en';
  const items = ctx.inferred.items || [];
  const proofNeeded = ctx.research?.conceptProfile?.proofNeeded || [];
  const compNames = (ctx.research?.recommendedComponents || []).map((c) => c.name);
  switch (role) {
    case 'offer':
    case 'browse':
      return pick(items, 4).length ? pick(items, 4) : (pick(compNames, 3).length ? pick(compNames, 3)
        : [L(lang, 'Browse everything', 'Tümüne göz at'), L(lang, 'By category', 'Kategoriye göre'), L(lang, 'Newest first', 'En yeniden')]);
    case 'proof':
      return uniq([...pick(proofNeeded, 3), ...trustBits(ctx.brief, ctx.inferred)]).slice(0, 3).length
        ? uniq([...pick(proofNeeded, 3), ...trustBits(ctx.brief, ctx.inferred)]).slice(0, 3)
        : [L(lang, 'Real, verifiable proof', 'Gerçek, doğrulanabilir kanıt'), L(lang, 'A clear track record', 'Net bir geçmiş'), L(lang, 'A transparent process', 'Şeffaf bir süreç')];
    case 'process':
      return [L(lang, 'Discovery', 'Keşif'), L(lang, 'Plan', 'Planlama'), L(lang, 'Delivery', 'Uygulama'), L(lang, 'Support', 'Destek')];
    case 'filter':
      return [L(lang, 'Filter by category', 'Kategoriye göre filtrele'), L(lang, 'Filter by type', 'Türe göre filtrele'), L(lang, 'Search by keyword', 'Anahtar kelimeyle ara')];
    case 'materials':
      return pick(items, 3).length ? pick(items, 3)
        : [L(lang, 'Planting & greenery', 'Bitki ve yeşillik'), L(lang, 'Stone & hardscape', 'Taş ve sert zemin'), L(lang, 'Lighting & water', 'Aydınlatma ve su')];
    case 'location':
      return [L(lang, 'Address & directions', 'Adres ve ulaşım'), L(lang, 'Opening hours', 'Çalışma saatleri'), L(lang, 'Parking & access', 'Otopark ve erişim')];
    case 'venue':
      return [L(lang, 'Venue & map', 'Mekan ve harita'), L(lang, 'Getting there', 'Ulaşım'), L(lang, 'Accommodation', 'Konaklama')];
    case 'people':
      return [L(lang, 'Keynotes', 'Ana konuşmalar'), L(lang, 'Workshops', 'Atölyeler'), L(lang, 'Panels', 'Paneller')];
    case 'story': {
      const s = uniq([...(ctx.strategy?.aboveTheFoldMustProve || []), ...(ctx.artDirection?.mustEmphasize || [])]).slice(0, 3);
      if (s.length) return s;
      return pick(items, 2).length ? pick(items, 2)
        : [L(lang, 'What we do', 'Ne yapıyoruz'), L(lang, 'Why it matters', 'Neden önemli')];
    }
    case 'faq':
      return [L(lang, 'How does it work?', 'Nasıl çalışır?'), L(lang, 'What does it cost?', 'Maliyeti nedir?'), L(lang, 'How do I get started?', 'Nasıl başlarım?')];
    case 'cta':
      return uniq([ctx.strategy?.ctaHierarchy?.secondary || ctx.brief.secondaryCTA || ctx.inferred.secondaryCTA]);
    case 'info':
    default:
      return pick(items, 3);
  }
}

/** True when a headline reads as a real, specific line (not a generic placeholder). */
const GENERIC_HEADLINE = /^(your website|welcome|hoş geldin|your headline|section|başlık)/i;
const specific = (s?: string) => !!s && s.trim().length >= 10 && !GENERIC_HEADLINE.test(s.trim());

/** Merge the best available hero copy — keep good backend copy, else strategy /
 *  inferred. Never discards a specific backend headline/sub/CTA. */
function heroItem(hero: WebBuildSectionItem | undefined, ctx: SectionArchInput): WebBuildSectionItem {
  const primary = (specific(hero?.cta) && hero?.cta) || ctx.strategy?.ctaHierarchy?.primary || ctx.brief.primaryCTA || ctx.inferred.primaryCTA;
  const secondary = ctx.strategy?.ctaHierarchy?.secondary || ctx.brief.secondaryCTA || ctx.inferred.secondaryCTA;
  const headline = (specific(hero?.headline) && hero?.headline) || ctx.strategy?.mainPromise || ctx.brief.strategyInsight || ctx.inferred.heroHeadline;
  const sub = (specific(hero?.sub) && hero?.sub) || ctx.brief.coreIdea || ctx.inferred.heroSub;
  const proof0 = (ctx.research?.conceptProfile?.proofNeeded || [])[0] || (ctx.strategy?.aboveTheFoldMustProve || [])[0]
    || ctx.brief.trustSignals || ctx.inferred.trustSignals;
  return {
    id: 'hero', name: 'Hero', component: 'Hero.tsx',
    headline, sub, cta: primary,
    bullets: uniq([secondary, proof0]),
    copyPreview: headline,
  };
}

function footerItem(ctx: SectionArchInput): WebBuildSectionItem {
  const primary = ctx.strategy?.ctaHierarchy?.primary || ctx.brief.primaryCTA || ctx.inferred.primaryCTA;
  const secondary = ctx.strategy?.ctaHierarchy?.secondary || ctx.brief.secondaryCTA || ctx.inferred.secondaryCTA;
  return {
    id: 'footer', name: L(ctx.lang || 'en', 'Footer', 'Alt bilgi'), component: 'Footer.tsx',
    headline: ctx.brief.type || ctx.inferred.businessType,
    bullets: uniq([primary, secondary]),
    copyPreview: ctx.brief.type || ctx.inferred.businessType,
  };
}

/** Build one concept section from the catalog + honest bullet sources. */
function sectionFromPlaybook(id: string, ctx: SectionArchInput): WebBuildSectionItem {
  const lang = ctx.lang || 'en';
  const meta = SECTIONS[id];
  const name = meta ? L(lang, meta.name[0], meta.name[1]) : humanize(id);
  const role: Role = meta?.role || 'offer';
  const bullets = bulletsFor(role, ctx);
  const item: WebBuildSectionItem = {
    id, name, component: `${pascal(id)}.tsx`,
    headline: name, // guarantees an H2 in both preview and generated files
    bullets,
    copyPreview: name,
  };
  if (role === 'cta') {
    item.cta = ctx.strategy?.ctaHierarchy?.primary || ctx.brief.primaryCTA || ctx.inferred.primaryCTA;
    item.sub = ctx.strategy?.mainPromise || ctx.inferred.heroSub;
  }
  return item;
}

/**
 * Decide + build the section architecture. Returns the (possibly rewritten)
 * sectionItems, whether a rewrite happened, and why. Pure, deterministic, never
 * throws. Preserves good backend architecture and revision structures.
 */
export function deriveAgentSectionArchitecture(input: SectionArchInput): SectionArchResult {
  const current = Array.isArray(input.sectionItems) ? input.sectionItems : [];
  try {
    const mode = detectMode(input);
    // A revision keeps its structure unless it is empty/unusable.
    if (input.isRevision && current.length >= 3) {
      return { sectionItems: current, didRewrite: false, reason: 'revision-preserved', mode };
    }
    // Without a clear concept we cannot do better than the existing/fallback set.
    if (mode === 'generic' || !PLAYBOOKS[mode as Exclude<ArchMode, 'generic'>]) {
      return { sectionItems: current, didRewrite: false, reason: 'generic-mode', mode };
    }
    // Preserve an already concept-specific backend architecture that covers a
    // meaningful portion of the mode's playbook and clears its must-have gate.
    const decision = current.length ? sectionArchitectureDecision(current, mode) : { rewrite: true, reason: 'empty' };
    if (current.length && !decision.rewrite) {
      return { sectionItems: current, didRewrite: false, reason: `backend-specific-covered-${mode}`, mode };
    }
    // Rewrite from the concept playbook, keeping the best backend hero copy + CTAs.
    const hero = findHero(current);
    const built = PLAYBOOKS[mode as Exclude<ArchMode, 'generic'>].map((id) =>
      id === 'hero' ? heroItem(hero, input)
        : id === 'footer' ? footerItem(input)
          : sectionFromPlaybook(id, input));
    if (built.length < 5) return { sectionItems: current, didRewrite: false, reason: 'too-few', mode };
    return { sectionItems: built, didRewrite: true, reason: `rewrote-to-${mode}-${decision.reason}`, mode };
  } catch {
    return { sectionItems: current, didRewrite: false, reason: 'error' };
  }
}
