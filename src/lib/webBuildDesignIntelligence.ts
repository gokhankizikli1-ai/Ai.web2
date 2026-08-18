/* ────────────────────────────────────────────────────────────────────────────
 * webBuildDesignIntelligence.ts — DESIGN INTELLIGENCE V3
 * The authoritative, pre-generation SITE ARCHETYPE + BRAND CHARACTER + DESIGN
 * DIRECTION contract for a WEB build's FIRST generation.
 *
 * WHY THIS MODULE EXISTS
 * Korvix already owns, in separate authorities:
 *   • verticalIntelligence → the operator SECTOR / business model (13 sectors)
 *   • researchDirection    → sector evidence + claim policy
 *   • composition          → per-section family, page rhythm, hero LAYOUT
 *   • visualSystem         → colour/type tokens, surfaces, anti-slop execution
 *   • visualConcept        → the dominant visual idea + per-image art direction
 *   • experienceIdentity   → product story, demonstration, trust architecture
 *   • contentNarrative     → per-section message jobs + CTA hierarchy
 *   • imageCoverage        → the required FLOOR of semantic photography
 *
 * But NOBODY owns the layer ABOVE all of them: WHAT KIND OF WEBSITE IS THIS, and
 * what does that make true about its composition, brand character, content
 * architecture, imagery and mobile design — BEFORE any of the above derive.
 *
 * Measured consequence of that gap (pre-V3, real requests):
 *   • "a two-day AI engineering conference in Lisbon"        → software-saas /
 *     subscription / "Book a Demo" / "build a working input→output demo"
 *   • "an independent longform journalism publication"       → general /
 *     "Product essence: feature cards + strong CTA"
 *   • "an online shop selling handmade stoneware ceramics"   → two-sided marketplace
 *   • agency and photography portfolio                       → one merged profile
 * The generation prompt therefore converged on the same product-marketing shape:
 * the "AI SaaS website" fingerprint the product is trying to escape.
 *
 * WHAT THIS MODULE ADDS (deterministic, no model/network call)
 *   1. SITE ARCHETYPE — 15 real archetypes + an explicitly ADAPTIVE `general`,
 *      scored from prompt lexicon + the EXISTING identity/business-model/section
 *      structural signals, with evidence, confidence and a recorded runner-up.
 *      Archetypes the sector taxonomy structurally cannot express (event,
 *      education, editorial, community, professional-services, developer-product,
 *      single-brand ecommerce, landing campaign) can WIN over the sector vote —
 *      that is the fix for "everything becomes SaaS".
 *   2. BRAND CHARACTER — the 7 axes the brief keeps asserting but never decides,
 *      derived from prompt lexicon over an archetype baseline. Rendered as WORDS,
 *      never as numeric scores (no fake precision reaches a user or the model).
 *   3. VISUAL DIRECTION — 14 concrete decisions (typography character, scale,
 *      measure, grid, rhythm, whitespace, borders, radius philosophy, imagery
 *      role, navigation, transitions, contrast, CTA hierarchy, motion restraint)
 *      computed as a FUNCTION of archetype × character. Not a lookup table: the
 *      same archetype with a different character yields different decisions.
 *   4. PAGE COMPOSITION STRATEGY — a page-level strategy synthesized from the
 *      archetype's ranked candidates using brand character (never random, never
 *      a fixed 1:1 archetype→template map), plus the concrete section-shape
 *      obligations it implies.
 *   5. ANTI-REPETITION POLICY — within-build rules scaled to the real section
 *      count (max repeats of one card pattern, forbidden uniform geometry, where
 *      CTAs may appear, when NOT to use icons/cards).
 *   6. CONTENT ARCHITECTURE + TRUTH POLICY — archetype-specific content the site
 *      must actually carry, plus the fabrication ban list and the banned generic
 *      marketing verbs.
 *   7. IMAGE INTENT — central / supporting / unnecessary, subject kinds, crop
 *      roles, and when a repeated stock grid would actively hurt the site.
 *   8. RESPONSIVE INTENT — mobile as a designed state: navigation transformation,
 *      hierarchy changes, reorder, crop change, density, touch targets, CTA
 *      placement, and the sections whose GEOMETRY must structurally change.
 *
 * OWNERSHIP BOUNDARY (must not duplicate)
 *   • sector / business model            → verticalIntelligence (we READ it)
 *   • per-section family + page rhythm   → composition (we STEER it via
 *                                          `archetypeCompositionSteer`, we never
 *                                          re-derive or re-render section families)
 *   • colour/type tokens, anti-slop      → visualSystem (we set CHARACTER, not tokens)
 *   • per-image art direction, hero idea → visualConcept (we set the ROLE of imagery)
 *   • required photo FLOOR               → imageCoverage (we never re-count)
 *   • acceptance / repair / re-verify    → Web Build Quality V2 (this module has NO
 *                                          acceptance surface at all, by design)
 *
 * SCOPE: WEB builds only. `deriveDesignIntelligence` is never called for
 * buildType='app', so an App Build specification and request are byte-for-byte
 * unchanged.
 *
 * Pure: no Date/Math.random/network/import(); JSON-safe; hard-bounded throughout;
 * every path fails open (returns undefined rather than throwing).
 * ──────────────────────────────────────────────────────────────────────────── */
import type { FrontendSpecIdentity, FrontendSpecSection } from '@/lib/webBuildAgents';

/* ── Bounds ──────────────────────────────────────────────────────────────────── */
const MAX_TEXT = 150;
const MAX_LIST = 8;
const MAX_EVIDENCE = 6;
/* Documented hard ceilings, ONE PER PRIORITY TIER. The direction is rendered as four
 * separate blocks so the request builder can give each its honest priority; sizing them
 * individually means a tier can never be clipped by an unrelated tier's growth, and the
 * combined ceiling is the sum. Each is set above the measured worst case for its tier. */
const P1_CHAR_CEILING = 3600;   // identity + required structure + facts policy + truth policy
const P2_CHAR_CEILING = 5000;   // strategy + brand character + visual direction + anti-repeat + responsive
const P3_CHAR_CEILING = 1300;    // image intent
const P4_CHAR_CEILING = 700;    // generic fingerprint ban
/** The combined ceiling of all four tiers — what an un-budgeted request carries. Exported
 *  so the regression tests bound the rendered direction against the real constant. */
export const DESIGN_INTELLIGENCE_CHAR_CEILING =
  P1_CHAR_CEILING + P2_CHAR_CEILING + P3_CHAR_CEILING + P4_CHAR_CEILING;
const PLANNING_CHAR_CEILING = 2000; // documented hard ceiling for the planning-prompt block

/* ────────────────────────────────────────────────────────────────────────────
 * PUBLIC VOCABULARY
 * ──────────────────────────────────────────────────────────────────────────── */

/** The kind of website this is. `general` is ADAPTIVE, never a SaaS stand-in. */
export type SiteArchetype =
  | 'saas-software'
  | 'developer-product'
  | 'ai-product'
  | 'ecommerce-brand'
  | 'marketplace'
  | 'restaurant-hospitality'
  | 'portfolio'
  | 'agency-studio'
  | 'local-service'
  | 'professional-services'
  | 'event'
  | 'education'
  | 'editorial-media'
  | 'landing-campaign'
  | 'community'
  | 'general';

/** How the whole experience should read. Drives register, not decoration. */
export type ExperienceRegister =
  | 'editorial' | 'commercial' | 'technical' | 'luxurious'
  | 'playful' | 'utilitarian' | 'institutional';

/** Page-level composition STRATEGY (a contextual approach, never a template). */
export type PageCompositionStrategy =
  | 'editorial-masthead'
  | 'product-led-demonstration'
  | 'immersive-visual'
  | 'catalogue-grid-commerce'
  | 'split-narrative'
  | 'dense-information-system'
  | 'typographic-minimal'
  | 'portfolio-case-study'
  | 'local-service-credibility'
  | 'storytelling-sequence'
  | 'asymmetric-art-direction';

/** How much of the site's job imagery carries. */
export type ImageryRole = 'central' | 'supporting' | 'incidental' | 'unnecessary';

export type ArchetypeConfidence = 'high' | 'medium' | 'low';

/** WHY the archetype was chosen — makes a wrong classification debuggable. */
export type ArchetypeBasis =
  | 'explicit-prompt'      // the prompt itself named the kind of site
  | 'structural-identity'  // the already-derived sector / business model decided it
  | 'section-evidence'     // the planned sections decided it
  | 'adaptive-fallback';   // nothing decisive — reason from the concept, do not template

/** The 7 brand-character axes. Values are stored as a discrete WORD, never a score. */
export interface BrandCharacter {
  /** restrained ↔ expressive */
  expression: 'restrained' | 'balanced' | 'expressive';
  /** editorial ↔ product-driven */
  emphasis: 'editorial' | 'balanced' | 'product-driven';
  /** serious ↔ playful */
  demeanour: 'serious' | 'balanced' | 'playful';
  /** dense ↔ spacious */
  spacing: 'dense' | 'balanced' | 'spacious';
  /** warm ↔ technical */
  temperature: 'warm' | 'balanced' | 'technical';
  /** classic ↔ experimental */
  convention: 'classic' | 'balanced' | 'experimental';
  /** premium ↔ accessible */
  positioning: 'premium' | 'balanced' | 'accessible';
  /** A short human phrase summarizing the above — used in prose instructions. */
  summary: string;
}

/** The concrete visual decisions the generator must make on purpose. */
export interface VisualDirection {
  typographyCharacter: string;
  scaleHierarchy: string;
  contentWidth: string;
  gridBehavior: string;
  rhythm: string;
  whitespace: string;
  borderUsage: string;
  cornerRadiusPhilosophy: string;
  imageryRole: string;
  navigationBehavior: string;
  sectionTransitions: string;
  contrastStrategy: string;
  ctaHierarchy: string;
  density: string;
  motionRestraint: string;
}

export interface ProductUnderstanding {
  category: string;
  businessModel: string;
  primaryVisitor: string;
  visitorIntent: string;
  conversionGoal: string;
  trustRequirement: string;
  contentDensity: 'low' | 'medium' | 'high';
  emotionalTone: string;
  register: ExperienceRegister;
}

export interface CompositionStrategyPlan {
  strategy: PageCompositionStrategy;
  /** Why THIS strategy for THIS request (archetype + character, in words). */
  rationale: string;
  /** Strategies deliberately considered and not chosen — proves it was a decision. */
  consideredAndRejected: string[];
  /** What the first viewport must actually do under this strategy. */
  entryObligation: string;
  /** Concrete section-shape obligations this strategy implies. */
  sectionShapeRules: string[];
}

export interface AntiRepetitionPolicy {
  /** Max sections that may share one repeated card/tile pattern. */
  maxRepeatedCardSections: number;
  /** Max sections that may share the exact same grid geometry. */
  maxIdenticalGridSections: number;
  rules: string[];
}

export interface ContentArchitecturePolicy {
  /**
   * STRUCTURAL obligations: the sections and information architecture a site of this
   * kind needs to be a real site of its type. Deliberately phrased as structure, never
   * as facts — "a menu structure", not "the menu with dishes and prices" — so a required
   * section can never read as an instruction to invent the business's real data.
   */
  requiredContent: string[];
  /**
   * The specific FACTS the structures above have slots for (dish names, prices, dates,
   * addresses, bylines…). These come from the request or they are neutrally labelled;
   * `factualPolicy` states exactly what to do when the request did not supply them.
   */
  factualSlots: string[];
  /** The binding rule for an unsupplied fact. Rendered next to `factualSlots`. */
  factualPolicy: string;
  /** Content shapes that are wrong for this archetype. */
  forbiddenContent: string[];
  /** The COMPLETE set of claims that may never be invented (contract + diagnostics surface). */
  neverFabricate: string[];
  /**
   * The subset of `neverFabricate` that the specification's existing honesty rules and output
   * contract do NOT already forbid. Only this subset is rendered, so Design Intelligence adds
   * coverage rather than becoming a second, competing statement of the same policy.
   */
  additionalNeverFabricate: string[];
  /** Generic marketing verbs to avoid unless the concept genuinely warrants them. */
  bannedPhrasing: string[];
  copyDirection: string;
}

export interface ImageIntentPolicy {
  role: ImageryRole;
  /** photography | illustration | product-ui | editorial-art | diagram | none */
  preferredMedia: string[];
  subjectGuidance: string[];
  cropRoles: string[];
  forbidden: string[];
}

/**
 * The mobile DESIGN decisions. Deliberately does NOT carry the mechanical responsive floor
 * (column collapse, reading/tab order, minimum type size, touch-target size, overflow) — the
 * integrated-experience authority owns and enforces those, and stating them twice would make
 * two blocks responsible for the same rule.
 */
export interface ResponsiveIntent {
  navigationTransformation: string;
  hierarchyChange: string;
  stackingOrder: string;
  imageCropChange: string;
  densityChange: string;
  ctaPlacement: string;
  simplification: string;
  /** Sections whose GEOMETRY must structurally change, not just stack. */
  structuralChanges: string[];
}

/** Steering hints the composition authority consumes (it stays the family owner). */
export interface ArchetypeCompositionSteer {
  /** The composition family the FIRST section should take under this archetype. */
  heroFamily: string;
  /** Families this archetype should reach for when a section is ambiguous. */
  preferredFamilies: string[];
  /** Families that are wrong for this archetype and must not be auto-selected. */
  discouragedFamilies: string[];
  /**
   * Whether the FIRST viewport should be carried by media or by text. Derived from the
   * archetype's imagery role so the hero anchor, and therefore every downstream visual
   * authority that reads it, agrees with the image intent — without this, a developer
   * product whose image intent is "prefer code and tables over photography" could still
   * be handed a photographic hero anchor by the planned asset slots, and the request
   * would carry two contradictory instructions. NEVER overrides a REQUIRED hero image:
   * the image-coverage authority still owns the photography floor.
   */
  heroMediaPreference: 'media-led' | 'text-led' | 'either';
}

export interface DesignIntelligenceContract {
  version: 'design-intelligence-v3';
  archetype: SiteArchetype;
  archetypeLabel: string;
  confidence: ArchetypeConfidence;
  basis: ArchetypeBasis;
  /** The archetype that came second — recorded so a misread is visible in diagnostics. */
  runnerUp?: SiteArchetype;
  evidence: string[];
  product: ProductUnderstanding;
  brand: BrandCharacter;
  visual: VisualDirection;
  composition: CompositionStrategyPlan;
  antiRepetition: AntiRepetitionPolicy;
  content: ContentArchitecturePolicy;
  image: ImageIntentPolicy;
  responsive: ResponsiveIntent;
  compositionSteer: ArchetypeCompositionSteer;
  /** The universal AI-website fingerprints this build must not reproduce. */
  forbiddenFingerprints: string[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * HELPERS (pure, bounded)
 * ──────────────────────────────────────────────────────────────────────────── */
const clip = (s: string, n = MAX_TEXT): string => {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const list = (xs: Array<string | undefined>, n = MAX_LIST): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const t = clip(typeof x === 'string' ? x : '');
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= n) break;
  }
  return out;
};

/** "a"/"an" for a following word — the archetype labels are interpolated into prose. */
const article = (word: string): string => (/^[aeiou]/i.test((word || '').trim()) ? 'an' : 'a');

/** Word-boundary hit count for a keyword group over a haystack. */
function hits(hay: string, re: RegExp): number {
  try {
    const m = hay.match(new RegExp(re.source, `${re.flags.includes('g') ? re.flags : `${re.flags}g`}`));
    return m ? m.length : 0;
  } catch {
    return 0;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 1. SITE ARCHETYPE
 *
 * Scored, NOT an allowlist lookup. Three independent signal channels:
 *   • prompt lexicon      — what the user actually asked for (strongest)
 *   • structural identity — the already-derived sector / business model / experience
 *   • section evidence    — what the planned page is actually made of
 * A tie or a weak winner degrades to `general` + adaptive-fallback rather than
 * silently defaulting to a software product.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Prompt lexicon. Deliberately multi-word and role-bearing so it stays meaningful
 *  as vocabulary drifts; each archetype also has structural fallbacks below. */
const PROMPT_LEXICON: Record<Exclude<SiteArchetype, 'general'>, RegExp> = {
  'saas-software': /\b(saas|software\s+(?:product|platform|company)|b2b\s+(?:platform|software|tool)|subscription\s+software|crm\b|erp\b|project\s+management\s+tool|analytics\s+platform|workflow\s+(?:tool|platform)|productivity\s+(?:app|tool)|dashboard\s+product|internal\s+tool)\b/i,
  'developer-product': /\b(developer(?:s|\s+tool|\s+platform|\s+product|\s+experience)?|devtool|dev\s+tool|\bapi\b|sdk\b|cli\b|open[-\s]?source|infrastructure|database|postgres|kubernetes|serverless|observability|ci\/cd|deployment\s+platform|edge\s+(?:network|runtime)|library\s+for|framework\s+for|documentation\s+site)\b/i,
  'ai-product': /\b(ai\s+(?:product|assistant|agent|copilot|tool|app|startup|model|platform)|artificial\s+intelligence|machine\s+learning|\bllm\b|generative\s+ai|ai[-\s]powered|chatbot|prompt\s+engineering)\b/i,
  // NOTE: "boutique" is deliberately NOT an ecommerce signal — "boutique hotel" and
  // "boutique agency" are far more common than "boutique" meaning a shop.
  'ecommerce-brand': /\b(online\s+(?:shop|store)|e-?commerce|web\s?shop|storefront|sell(?:s|ing)?\s+(?:handmade|our|its|their|products?|goods|clothing|furniture|ceramics|jewell?ery|coffee|skincare)|product\s+(?:catalog|catalogue)|shopify|direct[-\s]to[-\s]consumer|\bdtc\b|checkout|add\s+to\s+cart|homeware|apparel\s+brand)\b/i,
  marketplace: /\b(marketplace|two[-\s]sided|buyers?\s+and\s+sellers?|listing\s+platform|classifieds|book\s+(?:a\s+)?(?:provider|freelancer)|connect\w*\s+(?:\w+\s+){0,2}with\s+\w+)\b/i,
  'restaurant-hospitality': /\b(restaurant|bistro|brasserie|trattoria|osteria|tasting\s+menu|michelin|chef|caf[eé]|coffee\s+shop|bakery|patisserie|\bbar\b|cocktail|winery|vineyard|hotel|\binn\b|\bresort\b|\bspa\b|guest\s?house|bed\s+and\s+breakfast|dining|eatery|food\s+truck)\b/i,
  portfolio: /\b(portfolio|personal\s+site|my\s+work|photograph(?:y|er)|illustrator|\bartist\b|architect(?:ure)?\s+(?:portfolio|practice|studio)|freelance\s+\w+|showreel|case[-\s]stud(?:y|ies)\s+site|cv\s+site|r[eé]sum[eé]\s+site)\b/i,
  // NOTE: bare "studio" is deliberately NOT a signal — "a portfolio for a studio",
  // "a photography studio" and "a yoga studio" are all something else. Only a QUALIFIED
  // studio (design/creative/digital/branding/production) names an agency.
  'agency-studio': /\b(agency|(?:design|creative|digital|branding|film|motion|product)\s+studio|branding\s+(?:agency|studio)|production\s+company|creative\s+consultancy)\b/i,
  'local-service': /\b(plumb(?:er|ing)|electrician|roofing|landscap(?:er|ing)|garden(?:er|ing)\s+service|cleaning\s+(?:service|company)|hvac|locksmith|removals?|moving\s+company|handy(?:man|person)|garage|auto\s+repair|\bmot\b|barber|hair\s+salon|nail\s+salon|dentist|dental\s+(?:clinic|practice)|clinic|physio(?:therapy)?|chiropract|veterinar|\bvet\b|dog\s+walk\w*|pet\s+(?:sitting|care|grooming|walking)|childcare|nursery|gym\b|personal\s+train\w+|pilates|yoga\s+studio|driving\s+(?:school|instructor)|pest\s+control|catering\s+service|near\s+me|local\s+business|serving\s+\w+\s+(?:area|county|borough))\b/i,
  'professional-services': /\b(law\s+firm|solicitors?|attorney|barrister|legal\s+practice|accountan(?:t|cy)|bookkeep|tax\s+advis|financial\s+advis|wealth\s+management|insurance\s+broker|architects?\s+practice|engineering\s+consultanc|management\s+consult|recruitment\s+firm|notary|surveyor)\b/i,
  event: /\b(conference|summit|symposium|festival|meetup|hackathon|expo\b|trade\s+show|workshop\s+series|\bgala\b|awards?\s+night|retreat|webinar\s+series|\bkeynote|speakers?\s+lineup|ticket(?:s|ing)?|agenda\s+and\s+speakers|two[-\s]day|three[-\s]day|annual\s+(?:conference|event))\b/i,
  education: /\b(course|courses|curriculum|syllabus|bootcamp|academy|school\b|university|college|\bmooc\b|e-?learning|online\s+learning|tutoring|lesson\s+plans?|certification\s+program|training\s+program|student(?:s)?\b|enroll?ment|admissions)\b/i,
  'editorial-media': /\b(magazine|publication|journal(?:ism)?|newsroom|news\s+site|editorial|\bblog\b|newsletter\s+(?:site|archive)|longform|essays?\b|reporting|columnists?|podcast\s+(?:site|network)|documentary|zine\b|articles?\s+(?:site|archive))\b/i,
  'landing-campaign': /\b(landing\s+page|campaign\s+page|waitlist|coming\s+soon|pre[-\s]?launch|launch\s+page|early\s+access\s+page|one[-\s]pager|squeeze\s+page|lead\s+magnet|sign[-\s]?up\s+page)\b/i,
  community: /\b(community|forum|discord|non-?profit|charity|\bngo\b|volunteer|association|society\b|club\b|membership\s+(?:org|community)|open\s+collective|user\s+group|co-?operative|mutual\s+aid)\b/i,
};

/**
 * Turkish lexicon. Korvix treats Turkish as a first-class prompt language (see
 * `getWebBuildRequestLocale` / the `tr` copy paths), and an English-only archetype
 * lexicon silently degraded every Turkish request to the adaptive fallback — measured:
 * "bir İstanbul lokantası için web sitesi" → general. Matched WITHOUT `\b` anchors
 * because JS word boundaries are ASCII-only and would never fire before "ş"/"ö"/"ğ";
 * the terms are distinctive enough that substring matching is safe.
 */
const PROMPT_LEXICON_TR: Record<Exclude<SiteArchetype, 'general'>, RegExp> = {
  'saas-software': /(yazılımı?\b|yazılım (?:ürünü|firması|platformu)|abonelik|kurumsal yazılım|crm|erp|iş akışı (?:aracı|platformu)|yönetim paneli ürünü)/i,
  'developer-product': /(geliştirici|yazılımcı|altyapı|veritabanı|kütüphane|dokümantasyon sitesi|açık kaynak|sunucusuz)/i,
  'ai-product': /(yapay zek[âa]|makine öğrenmesi|üretken yapay|sohbet botu|ai asistan)/i,
  'ecommerce-brand': /(e-?ticaret|online (?:mağaza|satış)|internet mağazası|ürün katalo|sepete ekle|mağazamız|el yapımı ürün)/i,
  marketplace: /(pazaryeri|ilan sitesi|alıcı ve satıcı|çift taraflı)/i,
  'restaurant-hospitality': /(lokanta|restoran|meyhane|kahvaltı|kafe|kahve dükkan|pastane|fırın|otel|pansiyon|butik otel|tatil köyü|şarap|mutfağı|menü)/i,
  portfolio: /(portföy|fotoğrafçı|fotoğraf stüdyo|mimar|sanatçı|illüstratör|serbest çalışan|işlerim)/i,
  // Symmetric with the English lexicon: bare "stüdyo" is NOT an agency signal — a yoga,
  // pilates, photography, dance or recording studio is something else entirely. Only a
  // QUALIFIED studio, or "ajans", names an agency.
  'agency-studio': /(ajans|(?:reklam|tasarım|kreatif|dijital|marka|prodüksiyon|film|animasyon)\s+(?:ajansı|stüdyosu|stüdyo)|prodüksiyon şirketi)/i,
  'local-service': /(tesisatçı|elektrikçi|kuaför|berber|diş (?:klinik|hekim)|klinik|veteriner|spor salonu|yoga stüdyo|pilates stüdyo|nakliyat|oto servis|çilingir|temizlik (?:şirketi|hizmeti)|randevu)/i,
  'professional-services': /(hukuk bürosu|avukat|muhasebe|mali müşavir|danışmanlık firması|noter|sigorta acente)/i,
  event: /(konferans|zirve|festival|etkinlik|bilet|konuşmacı|program akışı|fuar|çalıştay)/i,
  education: /(kurs|eğitim programı|akademi|okul|üniversite|müfredat|öğrenci|kayıt olma|ders programı|bootcamp)/i,
  'editorial-media': /(dergi|gazete|haber sitesi|makale|yayın|köşe yazı|editoryal)/i,
  'landing-campaign': /(açılış sayfası|tanıtım sayfası|bekleme listesi|kampanya sayfası|yakında|erken erişim)/i,
  community: /(dernek|vakıf|topluluk|gönüllü|kulüb?ü?|üyelik|kooperatif)/i,
};

/**
 * German lexicon. Symmetric with the Turkish one above, and added for the same measured
 * reason: the archetype scorer had EN + TR channels only, so a concise German request
 * matched nothing and degraded to the adaptive fallback — measured: "eine Website für einen
 * Klempner" → general, "ein Onlineshop für Keramik" → general, "ein Online-Magazin" → general,
 * while their English and Turkish twins resolved correctly. The few German requests that DID
 * resolve only did so through accidental English cognates ("Restaurant", "Portfolio", "SaaS"),
 * which is not coverage — it is luck.
 *
 * Matched WITHOUT `\b` anchors, for two reasons: JS word boundaries are ASCII-only and would
 * never fire before "ä"/"ö"/"ü"/"ß", and German compounds glue the meaningful stem inside a
 * longer word ("Aufgabenverwaltung", "Verwaltungssoftware", "Fotografie-Portfolio"). Every term
 * below is therefore chosen to be long and distinctive enough that substring matching is safe —
 * short, ambiguous stems ("kurs" inside "Diskurs", "art" inside "Artikel") are deliberately
 * absent, exactly as the Turkish table avoids "ata" and "oku".
 */
const PROMPT_LEXICON_DE: Record<Exclude<SiteArchetype, 'general'>, RegExp> = {
  'saas-software': /(saas|softwareprodukt|software-produkt|softwarefirma|softwareunternehmen|unternehmenssoftware|abonnement|projektmanagement|verwaltungssoftware|workflow-tool|crm|erp)/i,
  'developer-product': /(entwickler|programmierschnittstelle|open source|quelloffen|datenbank|bibliothek für|dokumentationsseite|infrastruktur|serverlos|kommandozeile)/i,
  'ai-product': /(künstliche intelligenz|kuenstliche intelligenz|maschinelles lernen|sprachmodell|ki-assistent|ki-produkt|ki-plattform|chatbot|generative ki)/i,
  'ecommerce-brand': /(onlineshop|online-shop|webshop|onlineladen|e-commerce|warenkorb|produktkatalog|handgemacht|handgefertigt|versandkosten|zum warenkorb)/i,
  marketplace: /(marktplatz|kleinanzeigen|anbieter und käufer|vermittlungsplattform)/i,
  'restaurant-hospitality': /(restaurant|gaststätte|wirtshaus|brauhaus|bistro|café|cafe|kaffeehaus|bäckerei|konditorei|speisekarte|feinschmecker|weingut|hotel|pension|gasthof|herberge)/i,
  portfolio: /(portfolio|fotograf|fotografie|illustratorin|illustrator|künstlerin|künstler|architekturbüro|freiberuflich|arbeitsproben)/i,
  'agency-studio': /(agentur|werbeagentur|designstudio|kreativagentur|markenagentur|produktionsfirma|digitalagentur)/i,
  'local-service': /(klempner|installateur|elektriker|friseur|frisör|zahnarzt|arztpraxis|tierarzt|physiotherapie|reinigungsfirma|gebäudereinigung|umzugsunternehmen|schlüsseldienst|malerbetrieb|kfz-werkstatt|autowerkstatt|fitnessstudio|kosmetikstudio|hundesalon)/i,
  'professional-services': /(kanzlei|rechtsanwalt|rechtsanwältin|steuerberat|wirtschaftsprüf|notariat|unternehmensberatung|versicherungsmakler|ingenieurbüro)/i,
  event: /(konferenz|kongress|fachmesse|festival|tagung|symposium|veranstaltungsreihe|eintrittskarten|referentinnen|referenten|programm und redner)/i,
  education: /(lehrplan|kursangebot|online-kurs|onlinekurs|weiterbildung|akademie|hochschule|universität|studierende|anmeldung zum kurs|bildungsangebot)/i,
  'editorial-media': /(magazin|zeitschrift|zeitung|redaktion|journalismus|reportage|feuilleton|kolumne|nachrichtenseite)/i,
  'landing-campaign': /(landingpage|landing-page|kampagnenseite|warteliste|demnächst verfügbar|vorab-zugang|produktstart)/i,
  community: /(verein|gemeinnützig|stiftung|ehrenamt|mitgliedschaft|genossenschaft|nachbarschaftsinitiative)/i,
};

/** Structural votes from the ALREADY-derived identity (never re-derived here). A sector
 *  that this module deliberately SPLITS into more than one archetype votes for each side
 *  at reduced weight, so an upstream merged sector can never pick a side on its own —
 *  the prompt decides. (`portfolio-agency` is one sector upstream but two very different
 *  websites here: the work is the argument vs. the point of view is the argument.) */
const SECTOR_VOTE: Record<string, SiteArchetype[]> = {
  'restaurant-hospitality': ['restaurant-hospitality'],
  'travel-tourism': ['restaurant-hospitality'],
  jewelry: ['ecommerce-brand'],
  'furniture-interiors': ['ecommerce-brand'],
  'automotive-dealership': ['local-service'],
  landscaping: ['local-service'],
  'clinic-healthcare': ['local-service'],
  'local-service': ['local-service'],
  'real-estate': ['professional-services'],
  'portfolio-agency': ['portfolio', 'agency-studio'],
  'ai-saas': ['ai-product'],
  marketplace: ['marketplace'],
};

const BUSINESS_MODEL_VOTE: Record<string, SiteArchetype> = {
  'inventory-led-sales': 'ecommerce-brand',
  'catalog-showroom': 'ecommerce-brand',
  'reservation-led': 'restaurant-hospitality',
  'two-sided-marketplace': 'marketplace',
  'subscription-product': 'saas-software',
  'contact-sales-product': 'saas-software',
  'quote-led-service': 'local-service',
  'appointment-led': 'local-service',
  'service-booking': 'local-service',
  'listing-lead-generation': 'professional-services',
  'project-inquiry': 'agency-studio',
  'catalog-consultation': 'ecommerce-brand',
};

/** Section-id evidence — what the planned page is actually made of. */
const SECTION_LEXICON: Array<{ archetype: SiteArchetype; re: RegExp }> = [
  { archetype: 'event', re: /\b(speakers?|schedule|agenda|venue|tickets?|sponsors?|line-?up|programme?)\b/i },
  { archetype: 'education', re: /\b(curriculum|syllabus|courses?|modules?|lessons?|instructors?|enroll?|admissions|tuition)\b/i },
  { archetype: 'editorial-media', re: /\b(articles?|stories|issues?|archive|columns?|contributors?|latest|editions?|desks?)\b/i },
  { archetype: 'restaurant-hospitality', re: /\b(menu|reservations?|dishes|wine|rooms?|chef|opening-?hours|tasting)\b/i },
  { archetype: 'ecommerce-brand', re: /\b(products?|shop|collections?|catalog|cart|shipping|materials|care|sizing)\b/i },
  { archetype: 'portfolio', re: /\b(work|projects?|case-?stud|selected|gallery|commissions?)\b/i },
  { archetype: 'developer-product', re: /\b(docs|documentation|api|sdk|quickstart|install|changelog|benchmarks?)\b/i },
  { archetype: 'local-service', re: /\b(services?|areas?-served|book(ing)?|appointments?|contact|location|hours|team)\b/i },
  { archetype: 'community', re: /\b(members?|join|chapters?|volunteer|donate|events?|code-?of-?conduct)\b/i },
];

interface ArchetypeScore { archetype: SiteArchetype; score: number; evidence: string[] }

/**
 * Archetypes the SECTOR taxonomy structurally cannot express. For these, decisive
 * prompt evidence MUST be able to beat the sector vote — otherwise a conference,
 * a journal or a course platform is permanently misread as the nearest sector
 * (measured: "AI engineering conference" → ai-saas). Sector-expressible archetypes
 * keep the conservative behaviour where the sector vote carries equal weight.
 */
const SECTOR_BLIND: ReadonlySet<SiteArchetype> = new Set<SiteArchetype>([
  'event', 'education', 'editorial-media', 'community',
  'professional-services', 'developer-product', 'ecommerce-brand', 'landing-campaign',
]);

/**
 * The software archetypes. The upstream sector classifier resolves a very wide range of
 * concepts to `ai-saas` (measured: "a one page site for my dog walking business" →
 * sector `ai-saas`), and letting that structural vote alone decide would reintroduce the
 * exact "everything is a software product" failure this module exists to remove. So a
 * software archetype needs SOME corroboration from the request itself; with none, its
 * structural vote is deliberately held below the decisive threshold and the build falls
 * back to the ADAPTIVE `general` direction ("derive the kind of site from this request")
 * rather than asserting a software product that was never asked for.
 */
const SOFTWARE_ARCHETYPES: ReadonlySet<SiteArchetype> = new Set<SiteArchetype>([
  'saas-software', 'developer-product', 'ai-product',
]);

const PROMPT_WEIGHT = 4;
const PROMPT_BLIND_BONUS = 3;   // lets a sector-blind archetype overcome the sector vote
const SECTOR_WEIGHT = 5;
const MODEL_WEIGHT = 3;
const SECTION_WEIGHT = 2;
/** Minimum winning score for a NAMED archetype; below this we stay adaptive. */
const MIN_DECISIVE_SCORE = 4;

export interface DesignIntelligenceInput {
  prompt: string;
  identity?: FrontendSpecIdentity;
  sections?: FrontendSpecSection[];
  /** Free brief text (core idea / audience / style) — additional prompt-channel signal. */
  briefText?: string;
}

function scoreArchetypes(input: DesignIntelligenceInput): ArchetypeScore[] {
  const promptText = `${input.prompt || ''} ${input.briefText || ''}`.slice(0, 2000);
  const identity = input.identity;
  const sectionText = (input.sections || [])
    .slice(0, 30)
    .map((s) => `${s.id || ''} ${s.name || ''}`)
    .join(' ')
    .slice(0, 1200);

  const acc = new Map<SiteArchetype, ArchetypeScore>();
  const bump = (a: SiteArchetype, n: number, why: string): void => {
    if (n <= 0) return;
    const cur = acc.get(a) || { archetype: a, score: 0, evidence: [] };
    cur.score += n;
    if (cur.evidence.length < MAX_EVIDENCE) cur.evidence.push(why);
    acc.set(a, cur);
  };

  // Channel 1 — prompt lexicon (what the user asked for), English + Turkish + German.
  // All three are matched against EVERY request, never selected by the declared language: that
  // language is inferred, and a request routinely mixes languages ("bir SaaS landing page yap",
  // "eine Website für ein Bistro"). Selecting one channel by a possibly-wrong inference would
  // blind the strongest evidence source the scorer has.
  const promptBacked = new Set<SiteArchetype>();
  for (const key of Object.keys(PROMPT_LEXICON) as Array<Exclude<SiteArchetype, 'general'>>) {
    const n = hits(promptText, PROMPT_LEXICON[key])
      + hits(promptText, PROMPT_LEXICON_TR[key])
      + hits(promptText, PROMPT_LEXICON_DE[key]);
    if (n <= 0) continue;
    promptBacked.add(key);
    const capped = Math.min(n, 3);
    const bonus = SECTOR_BLIND.has(key) ? PROMPT_BLIND_BONUS : 0;
    bump(key, capped * PROMPT_WEIGHT + bonus, `prompt names a ${key.replace(/-/g, ' ')} (${capped} signal${capped > 1 ? 's' : ''})`);
  }

  /** A software archetype with no corroboration in the request gets a sub-decisive vote. */
  const structuralWeight = (a: SiteArchetype, full: number): number =>
    (SOFTWARE_ARCHETYPES.has(a) && !promptBacked.has(a) ? Math.min(full, MIN_DECISIVE_SCORE - 1) : full);

  // Channel 2 — structural identity already derived upstream. A split sector shares its
  // weight between the archetypes it covers, so it cannot decide between them alone.
  const sectorVotes = identity?.sector ? SECTOR_VOTE[identity.sector] : undefined;
  if (sectorVotes?.length) {
    const share = Math.round(SECTOR_WEIGHT / sectorVotes.length);
    for (const v of sectorVotes) bump(v, structuralWeight(v, share), `sector "${identity?.sector}"`);
  }
  const modelVote = identity?.businessModel ? BUSINESS_MODEL_VOTE[identity.businessModel] : undefined;
  if (modelVote) bump(modelVote, structuralWeight(modelVote, MODEL_WEIGHT), `business model "${identity?.businessModel}"`);

  // Channel 3 — what the planned page is made of.
  for (const { archetype, re } of SECTION_LEXICON) {
    const n = hits(sectionText, re);
    if (n >= 2) bump(archetype, SECTION_WEIGHT, `planned sections read as ${archetype.replace(/-/g, ' ')}`);
  }

  return [...acc.values()].sort((a, b) => (b.score - a.score) || a.archetype.localeCompare(b.archetype));
}

/** Resolve the archetype from the scores, degrading to adaptive `general` when weak. */
function resolveArchetype(input: DesignIntelligenceInput): {
  archetype: SiteArchetype; confidence: ArchetypeConfidence; basis: ArchetypeBasis;
  runnerUp?: SiteArchetype; evidence: string[];
} {
  const ranked = scoreArchetypes(input);
  const top = ranked[0];
  const second = ranked[1];
  if (!top || top.score < MIN_DECISIVE_SCORE) {
    return {
      archetype: 'general',
      confidence: 'low',
      basis: 'adaptive-fallback',
      runnerUp: top?.archetype,
      evidence: list([
        'no decisive archetype signal — reason from the concept itself',
        ...(top ? top.evidence : []),
      ]),
    };
  }
  const margin = top.score - (second?.score || 0);
  const confidence: ArchetypeConfidence = margin >= 4 ? 'high' : margin >= 2 ? 'medium' : 'low';
  const lead = top.evidence[0] || '';
  const basis: ArchetypeBasis = /^prompt names/.test(lead)
    ? 'explicit-prompt'
    : /^sector|^business model/.test(lead)
      ? 'structural-identity'
      : /^planned sections/.test(lead)
        ? 'section-evidence'
        : 'adaptive-fallback';
  return { archetype: top.archetype, confidence, basis, runnerUp: second?.archetype, evidence: list(top.evidence) };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. ARCHETYPE PROFILES
 * Each profile states what is TRUE about this kind of site. It is deliberately
 * NOT a layout template: it fixes the product understanding, the candidate
 * composition strategies (plural, ranked) and the content the site must carry.
 * ──────────────────────────────────────────────────────────────────────────── */
interface ArchetypeProfile {
  label: string;
  category: string;
  businessModel: string;
  visitor: string;
  visitorIntent: string;
  conversionGoal: string;
  trustRequirement: string;
  contentDensity: 'low' | 'medium' | 'high';
  emotionalTone: string;
  register: ExperienceRegister;
  /** Ranked candidates — the strategy is SYNTHESIZED from these by brand character. */
  strategies: PageCompositionStrategy[];
  imagery: ImageryRole;
  preferredMedia: string[];
  /** STRUCTURE only — never a fact. See ContentArchitecturePolicy.requiredContent. */
  requiredContent: string[];
  /** The facts those structures have slots for. Governed by FACTUAL_POLICY. */
  factualSlots: string[];
  forbiddenContent: string[];
  /** Baseline character leanings before the prompt modifies them. */
  baseline: Partial<Record<keyof Omit<BrandCharacter, 'summary'>, BrandCharacter[keyof Omit<BrandCharacter, 'summary'>]>>;
  heroFamily: string;
  preferredFamilies: string[];
  discouragedFamilies: string[];
}

const PROFILES: Record<SiteArchetype, ArchetypeProfile> = {
  'saas-software': {
    label: 'Software product site',
    category: 'software product',
    businessModel: 'subscription or contract software sold to a business buyer',
    visitor: 'an evaluator comparing tools for their team',
    visitorIntent: 'understand what the product actually does and whether it fits their workflow',
    conversionGoal: 'start a trial or book a walkthrough',
    trustRequirement: 'the product must be shown working, not described',
    contentDensity: 'medium',
    emotionalTone: 'competent, specific, unhurried',
    register: 'technical',
    strategies: ['product-led-demonstration', 'split-narrative', 'dense-information-system'],
    imagery: 'supporting',
    preferredMedia: ['real product UI', 'diagram where it explains something true'],
    requiredContent: ['a concrete capability section — what the product does, not adjectives', 'the workflow it replaces, shown as a sequence', 'a real interface view', 'an access/pricing section', 'an integration or technical-fit section'],
    factualSlots: ['plan names and prices', 'named integrations', 'customer names'],
    forbiddenContent: ['invented customer logos', 'invented usage metrics', 'a floating glass dashboard that shows nothing real'],
    baseline: { emphasis: 'product-driven', temperature: 'technical' },
    heroFamily: 'editorial-split',
    preferredFamilies: ['focused-tool', 'comparison-band', 'sequential-steps', 'editorial-split'],
    discouragedFamilies: ['gallery-strip', 'immersive-hero'],
  },
  'developer-product': {
    label: 'Developer product site',
    category: 'developer / infrastructure product',
    businessModel: 'usage-based or open-core adoption led by individual engineers',
    visitor: 'an engineer deciding whether to try this in the next hour',
    visitorIntent: 'see the interface, the code, the constraints and the cost quickly',
    conversionGoal: 'read the docs, install, or run the first command',
    trustRequirement: 'real code, real limits, real numbers — marketing language destroys credibility here',
    contentDensity: 'high',
    emotionalTone: 'direct, precise, unembellished',
    register: 'technical',
    strategies: ['dense-information-system', 'product-led-demonstration', 'typographic-minimal'],
    imagery: 'incidental',
    preferredMedia: ['syntax-highlighted code', 'terminal output', 'architecture diagram', 'real console UI'],
    requiredContent: ['a copyable code or install example above the fold or immediately below it', 'a scope section: what it does and what it explicitly does not do', 'a limits/performance section', 'docs and reference entry points', 'an access/pricing section'],
    factualSlots: ['the install command and code sample', 'concrete limits and performance numbers', 'plan names, prices and free-tier terms'],
    forbiddenContent: ['abstract 3D blobs standing in for architecture', 'benchmark numbers that were not supplied', 'enterprise logo walls that were not supplied'],
    baseline: { emphasis: 'product-driven', temperature: 'technical', spacing: 'dense', expression: 'restrained' },
    heroFamily: 'editorial-split',
    preferredFamilies: ['focused-tool', 'sequential-steps', 'comparison-band', 'narrative-rail'],
    discouragedFamilies: ['immersive-hero', 'gallery-strip', 'full-bleed-transition'],
  },
  'ai-product': {
    label: 'AI product site',
    category: 'AI product',
    businessModel: 'a product whose value is an AI capability applied to a real task',
    visitor: 'someone with a specific task who is sceptical of AI claims',
    visitorIntent: 'see the model do the actual task, on real-looking input',
    conversionGoal: 'try the product on their own input',
    trustRequirement: 'demonstration beats description; capability limits stated honestly',
    contentDensity: 'medium',
    emotionalTone: 'confident but grounded — no mysticism',
    register: 'technical',
    strategies: ['product-led-demonstration', 'split-narrative', 'storytelling-sequence'],
    imagery: 'supporting',
    preferredMedia: ['real product UI', 'input→output comparison', 'restrained diagram'],
    requiredContent: ['the task the AI performs, named concretely', 'an input→output demonstration built from illustrative sample data', 'a limits section: what it cannot do', 'a data-handling section', 'a clear way to start'],
    factualSlots: ['accuracy or quality figures', 'named customers', 'specific data-retention or compliance claims'],
    forbiddenContent: ['neon brain/neural-network clip art', 'glowing orb mysticism', 'invented accuracy percentages'],
    baseline: { emphasis: 'product-driven' },
    heroFamily: 'editorial-split',
    preferredFamilies: ['focused-tool', 'sequential-steps', 'editorial-split', 'comparison-band'],
    discouragedFamilies: ['catalog-index', 'gallery-strip'],
  },
  'ecommerce-brand': {
    label: 'Single-brand commerce site',
    category: 'own-brand retail',
    businessModel: 'the brand makes or curates the goods and sells them directly',
    visitor: 'a shopper deciding whether this object is worth owning',
    visitorIntent: 'see the goods clearly, understand materials, price, delivery and returns',
    conversionGoal: 'view a product and add it to a basket',
    trustRequirement: 'material honesty, real pricing, real delivery and returns terms',
    contentDensity: 'medium',
    emotionalTone: 'tactile, considered, close to the object',
    register: 'commercial',
    strategies: ['catalogue-grid-commerce', 'immersive-visual', 'editorial-masthead'],
    imagery: 'central',
    preferredMedia: ['product photography on a consistent surface', 'in-use lifestyle photography', 'material close-ups'],
    requiredContent: ['a browsable collection or category structure', 'a product grid whose tiles have real name / image / price slots', 'a product detail view', 'a materials, making and care section', 'a delivery and returns section'],
    factualSlots: ['product names', 'prices and currency', 'materials and dimensions', 'delivery times and returns terms'],
    forbiddenContent: ['a feature-card grid instead of products', 'a SaaS pricing table', 'invented review counts or star ratings'],
    baseline: { emphasis: 'editorial', temperature: 'warm' },
    heroFamily: 'immersive-hero',
    preferredFamilies: ['catalog-index', 'gallery-strip', 'editorial-split', 'asymmetric-media'],
    discouragedFamilies: ['focused-tool', 'comparison-band'],
  },
  marketplace: {
    label: 'Marketplace site',
    category: 'two-sided marketplace',
    businessModel: 'supply and demand meet on the platform; both sides need a reason to join',
    visitor: 'either a buyer looking for supply or a supplier looking for demand',
    visitorIntent: 'judge whether there is enough on the other side to be worth it',
    conversionGoal: 'search/browse listings, or start listing',
    trustRequirement: 'liquidity signals, safety of transaction, dispute handling',
    contentDensity: 'high',
    emotionalTone: 'active, plentiful, dependable',
    register: 'commercial',
    strategies: ['catalogue-grid-commerce', 'dense-information-system', 'split-narrative'],
    imagery: 'central',
    preferredMedia: ['listing imagery', 'category imagery'],
    requiredContent: ['a working search or browse entry point', 'a listing grid whose cards have real title / image / price / location slots', 'the value for each side, addressed separately', 'a how-a-transaction-works sequence', 'a trust and safety section'],
    factualSlots: ['listing titles, prices and locations', 'listing or member counts', 'fees and payout terms'],
    forbiddenContent: ['invented listing counts or GMV', 'a single-product hero that hides the marketplace'],
    baseline: {},
    heroFamily: 'editorial-split',
    preferredFamilies: ['catalog-index', 'sequential-steps', 'comparison-band', 'proof-ledger'],
    discouragedFamilies: ['immersive-hero'],
  },
  'restaurant-hospitality': {
    label: 'Restaurant / hospitality site',
    category: 'hospitality',
    businessModel: 'people physically come, at a time, to a place',
    visitor: 'someone choosing where to spend an evening or a stay',
    visitorIntent: 'feel the place, read the menu, check hours and location, book',
    conversionGoal: 'make a reservation or get directions',
    trustRequirement: 'real address, real hours, real menu — atmosphere carries the rest',
    contentDensity: 'low',
    emotionalTone: 'atmospheric, sensory, inviting',
    register: 'luxurious',
    strategies: ['immersive-visual', 'editorial-masthead', 'storytelling-sequence'],
    imagery: 'central',
    preferredMedia: ['food and room photography', 'available light interiors', 'detail shots'],
    requiredContent: ['a menu or offering structured by real courses/categories, with a name/description/price slot per item', 'a location and hours section', 'a reservation or contact path', 'a section that conveys the character of the place'],
    factualSlots: ['dish and drink names', 'prices', 'the address and directions', 'opening hours', "the chef's or owner's name"],
    forbiddenContent: ['feature cards with icons', 'a dashboard or product-UI mock', 'invented awards or Michelin claims'],
    baseline: { emphasis: 'editorial', temperature: 'warm', spacing: 'spacious', positioning: 'premium' },
    heroFamily: 'immersive-hero',
    preferredFamilies: ['gallery-strip', 'asymmetric-media', 'editorial-split', 'narrative-rail'],
    discouragedFamilies: ['focused-tool', 'comparison-band', 'feature-mosaic'],
  },
  portfolio: {
    label: 'Portfolio site',
    category: 'individual or studio portfolio',
    businessModel: 'the work itself is the argument for hiring',
    visitor: 'a prospective client or employer scanning for quality in seconds',
    visitorIntent: 'see the strongest work immediately, then judge range and process',
    conversionGoal: 'open a project, then make contact',
    trustRequirement: 'the work must be shown at a size that lets it be judged',
    contentDensity: 'low',
    emotionalTone: 'assured, unhurried, self-evident',
    register: 'editorial',
    strategies: ['portfolio-case-study', 'asymmetric-art-direction', 'typographic-minimal'],
    imagery: 'central',
    preferredMedia: ['the work itself at full quality', 'process imagery where it adds meaning'],
    requiredContent: ['a selected-work index with a title / year / discipline slot per piece', 'a project or case detail view', 'a short statement of practice', 'a direct contact route'],
    factualSlots: ['project and client names', 'years and locations', 'the practitioner’s own name and biography'],
    forbiddenContent: ['a feature grid describing skills as product features', 'invented client testimonials', 'stock photography standing in for the work'],
    baseline: { emphasis: 'editorial', expression: 'restrained', spacing: 'spacious' },
    heroFamily: 'gallery-strip',
    preferredFamilies: ['gallery-strip', 'asymmetric-media', 'editorial-split', 'narrative-rail'],
    discouragedFamilies: ['comparison-band', 'focused-tool', 'feature-mosaic'],
  },
  'agency-studio': {
    label: 'Agency / studio site',
    category: 'creative or professional studio',
    businessModel: 'projects won through demonstrated point of view and capability',
    visitor: 'a client deciding whether this studio understands their problem',
    visitorIntent: 'see the work, understand the approach, judge fit and scale',
    conversionGoal: 'start a project conversation',
    trustRequirement: 'named work, named capability, a real point of view',
    contentDensity: 'medium',
    emotionalTone: 'opinionated, crafted, confident',
    register: 'editorial',
    strategies: ['asymmetric-art-direction', 'portfolio-case-study', 'storytelling-sequence'],
    imagery: 'central',
    preferredMedia: ['case-study imagery', 'expressive typography as image'],
    requiredContent: ['a selected-work or case-study index with a client / discipline / outcome slot per entry', 'a capability section: what the studio actually does', 'a how-we-work-with-clients sequence', 'a real enquiry route'],
    factualSlots: ['client names and logos', 'campaign results and outcome figures', 'team names', 'fees'],
    forbiddenContent: ['three identical service cards with icons', 'invented client logos', 'invented awards'],
    baseline: { expression: 'expressive', emphasis: 'editorial', convention: 'experimental' },
    heroFamily: 'immersive-hero',
    preferredFamilies: ['gallery-strip', 'asymmetric-media', 'narrative-rail', 'editorial-split'],
    discouragedFamilies: ['comparison-band', 'focused-tool'],
  },
  'local-service': {
    label: 'Local service site',
    category: 'local trade or practice',
    businessModel: 'local demand converted to a booking or a call',
    visitor: 'someone nearby with an immediate, often urgent need',
    visitorIntent: 'confirm this business is real, competent, nearby and available — then contact it',
    conversionGoal: 'call, book an appointment, or request a quote',
    trustRequirement: 'address, hours, coverage area, credentials, and a phone number that is easy to find',
    contentDensity: 'medium',
    emotionalTone: 'reassuring, plain-spoken, immediate',
    register: 'utilitarian',
    strategies: ['local-service-credibility', 'split-narrative', 'dense-information-system'],
    imagery: 'supporting',
    preferredMedia: ['real premises and team photography', 'before/after of actual work'],
    requiredContent: ['a services section describing what each service involves', 'a coverage-area or address section', 'an opening-hours block', 'a prominent phone/booking route', 'a credentials block where the trade requires one'],
    factualSlots: ['the address, phone number and coverage area', 'opening hours', 'registration, licence or insurance numbers', 'staff names', 'prices and call-out fees'],
    forbiddenContent: ['an abstract SaaS hero', 'invented review scores or patient counts', 'invented certifications'],
    baseline: { convention: 'classic', positioning: 'accessible', expression: 'restrained' },
    heroFamily: 'editorial-split',
    preferredFamilies: ['feature-mosaic', 'sequential-steps', 'proof-ledger', 'editorial-split'],
    discouragedFamilies: ['immersive-hero', 'focused-tool'],
  },
  'professional-services': {
    label: 'Professional services site',
    category: 'regulated or advisory professional practice',
    businessModel: 'engagements won on expertise, standing and specificity',
    visitor: 'someone with a consequential problem assessing competence and discretion',
    visitorIntent: 'confirm relevant expertise, understand the process, judge whether to make contact',
    conversionGoal: 'request a consultation',
    trustRequirement: 'named practitioners, real credentials, regulatory standing, clarity on process and fees',
    contentDensity: 'high',
    emotionalTone: 'measured, authoritative, discreet',
    register: 'institutional',
    strategies: ['dense-information-system', 'editorial-masthead', 'split-narrative'],
    imagery: 'supporting',
    preferredMedia: ['portraits of named people', 'restrained environmental photography'],
    requiredContent: ['a practice-areas section in specific terms', 'a people section with a name / role / credential slot per person', 'a how-an-engagement-works sequence', 'a fees section', 'a formal contact route'],
    factualSlots: ['practitioner names, titles and qualifications', 'regulatory registration numbers', 'fees and rates', 'office address and hours', 'case outcomes'],
    forbiddenContent: ['playful illustration', 'invented case outcomes or win rates', 'invented accreditations'],
    baseline: { convention: 'classic', expression: 'restrained', demeanour: 'serious', temperature: 'balanced' },
    heroFamily: 'editorial-split',
    preferredFamilies: ['narrative-rail', 'proof-ledger', 'feature-mosaic', 'editorial-split'],
    discouragedFamilies: ['immersive-hero', 'gallery-strip', 'focused-tool'],
  },
  event: {
    label: 'Event site',
    category: 'a dated event',
    businessModel: 'attendance sold or registered before a fixed date',
    visitor: 'someone deciding whether to spend time and money to attend',
    visitorIntent: 'know when, where, who is speaking, what it costs and whether it is worth it',
    conversionGoal: 'register or buy a ticket',
    trustRequirement: 'dates, venue, programme and price must be unmissable and specific',
    contentDensity: 'high',
    emotionalTone: 'anticipatory, concrete, time-bound',
    register: 'commercial',
    strategies: ['dense-information-system', 'editorial-masthead', 'storytelling-sequence'],
    imagery: 'supporting',
    preferredMedia: ['speaker portraits', 'venue and past-edition photography'],
    requiredContent: ['a prominent date-and-location block in the first viewport', 'a programme or schedule structured by day and slot', 'a speaker or line-up grid with a name / role / session slot per entry', 'a ticket section with a tier / inclusions / price slot per tier', 'a venue and travel section'],
    factualSlots: ['the dates and times', 'the venue name and address', 'speaker names and affiliations', 'session titles', 'ticket prices and deadlines'],
    forbiddenContent: ['a product demo surface', 'a "Book a demo" CTA', 'invented attendee numbers or sponsor logos'],
    baseline: { spacing: 'dense', emphasis: 'editorial' },
    heroFamily: 'editorial-split',
    preferredFamilies: ['sequential-steps', 'catalog-index', 'comparison-band', 'proof-ledger'],
    discouragedFamilies: ['focused-tool'],
  },
  education: {
    label: 'Education site',
    category: 'teaching or training provider',
    businessModel: 'enrolment into structured learning',
    visitor: 'a prospective learner (or a parent/employer paying) assessing outcome and effort',
    visitorIntent: 'understand what is taught, by whom, over how long, at what cost, to what outcome',
    conversionGoal: 'apply, enrol, or request the syllabus',
    trustRequirement: 'curriculum detail, instructor credentials, honest outcomes, real cost and duration',
    contentDensity: 'high',
    emotionalTone: 'clear, encouraging, substantive',
    register: 'institutional',
    strategies: ['dense-information-system', 'split-narrative', 'editorial-masthead'],
    imagery: 'supporting',
    preferredMedia: ['instructor portraits', 'real learning-environment photography'],
    requiredContent: ['a curriculum section structured module by module', 'an instructor section with a name / background slot per person', 'a duration, format and start-date block', 'a cost and funding section', 'an entry-requirements and how-to-apply section'],
    factualSlots: ['module titles and contents', 'instructor names and backgrounds', 'dates, duration and cohort size', 'tuition, fees and funding terms', 'outcome or placement figures'],
    forbiddenContent: ['invented graduate salaries or placement rates', 'invented accreditation', 'a SaaS feature grid instead of a curriculum'],
    baseline: { spacing: 'dense', convention: 'classic', positioning: 'accessible' },
    heroFamily: 'editorial-split',
    preferredFamilies: ['sequential-steps', 'narrative-rail', 'comparison-band', 'feature-mosaic'],
    discouragedFamilies: ['immersive-hero', 'focused-tool'],
  },
  'editorial-media': {
    label: 'Editorial / media site',
    category: 'publication',
    businessModel: 'attention earned by writing, sometimes converted to a subscription',
    visitor: 'a reader arriving for a piece, or scanning for something worth reading',
    visitorIntent: 'find and read the best available piece; judge whether to come back',
    conversionGoal: 'read an article, then subscribe or follow',
    trustRequirement: 'bylines, dates, sourcing, and an editorial identity that is legible',
    contentDensity: 'high',
    emotionalTone: 'considered, textual, opinionated',
    register: 'editorial',
    strategies: ['editorial-masthead', 'dense-information-system', 'typographic-minimal'],
    imagery: 'supporting',
    preferredMedia: ['commissioned editorial art', 'reportage photography', 'no image where the text is the point'],
    requiredContent: ['a lead story treated as the lead', 'an article index with a headline / byline / date / standfirst slot per entry', 'a sections/desks or topic structure', 'an article reading view', 'a subscribe or follow route'],
    factualSlots: ['headlines and standfirsts', 'author bylines', 'publication dates', 'subscription prices'],
    forbiddenContent: ['a hero with two CTA buttons', 'feature cards instead of headlines', 'invented readership numbers'],
    baseline: { emphasis: 'editorial', spacing: 'dense', expression: 'restrained' },
    heroFamily: 'editorial-split',
    preferredFamilies: ['narrative-rail', 'catalog-index', 'editorial-split', 'gallery-strip'],
    discouragedFamilies: ['focused-tool', 'comparison-band', 'immersive-hero'],
  },
  'landing-campaign': {
    label: 'Campaign landing page',
    category: 'single-purpose campaign page',
    businessModel: 'one message, one action, measured',
    visitor: 'someone arriving from a specific ad, post or email',
    visitorIntent: 'understand one proposition and decide once',
    conversionGoal: 'complete the single action the page exists for',
    trustRequirement: 'the promise must be specific and the action must be honest about what happens next',
    contentDensity: 'low',
    emotionalTone: 'focused, direct, unpadded',
    register: 'commercial',
    strategies: ['typographic-minimal', 'storytelling-sequence', 'split-narrative'],
    imagery: 'incidental',
    preferredMedia: ['one supporting image at most, if it earns its place'],
    requiredContent: ['one proposition stated plainly', 'the single action, repeated at most twice', 'a what-happens-next explanation', 'the minimum proof this claim needs — and no proof section at all if none can be truthful'],
    factualSlots: ['the offer terms and any price', 'launch or availability dates', 'any proof or endorsement'],
    forbiddenContent: ['a full marketing site pretending to be a landing page', 'six competing CTAs', 'invented social proof'],
    baseline: { spacing: 'spacious', expression: 'restrained' },
    heroFamily: 'editorial-split',
    preferredFamilies: ['narrative-rail', 'sequential-steps', 'conversion-finale'],
    discouragedFamilies: ['catalog-index', 'gallery-strip', 'feature-mosaic'],
  },
  community: {
    label: 'Community / organisation site',
    category: 'community, association or non-profit',
    businessModel: 'participation, membership or donation rather than sale',
    visitor: 'someone deciding whether these are their people, or whether to give',
    visitorIntent: 'understand the purpose, see the activity, find the way in',
    conversionGoal: 'join, attend, volunteer or donate',
    trustRequirement: 'real activity, real people, honest use of funds',
    contentDensity: 'medium',
    emotionalTone: 'human, welcoming, unslick',
    register: 'institutional',
    strategies: ['storytelling-sequence', 'split-narrative', 'editorial-masthead'],
    imagery: 'central',
    preferredMedia: ['photographs of actual members and activity'],
    requiredContent: ['a purpose section in the group’s own words', 'an activities section with a what / when / where slot per activity', 'a how-to-take-part route', 'an organisers section', 'a where-the-money-goes section whenever money is asked for'],
    factualSlots: ['meeting times and places', 'organiser names', 'member counts', 'donation figures and how funds are used'],
    forbiddenContent: ['corporate SaaS styling', 'invented member counts or donation totals', 'stock photography of unrelated people'],
    baseline: { temperature: 'warm', positioning: 'accessible', expression: 'balanced' },
    heroFamily: 'editorial-split',
    preferredFamilies: ['gallery-strip', 'narrative-rail', 'sequential-steps', 'feature-mosaic'],
    discouragedFamilies: ['focused-tool', 'comparison-band'],
  },
  general: {
    label: 'Adaptive (archetype not decisive)',
    category: 'derive the category from the request itself',
    businessModel: 'derive from what the request says the site is for',
    visitor: 'derive from the request; do not assume a software buyer',
    visitorIntent: 'derive from the request',
    conversionGoal: 'derive the single most valuable action from the request',
    trustRequirement: 'whatever this specific concept must prove to be believed',
    contentDensity: 'medium',
    emotionalTone: 'derive from the concept, not from a default',
    register: 'editorial',
    strategies: ['split-narrative', 'editorial-masthead', 'storytelling-sequence'],
    imagery: 'supporting',
    preferredMedia: ['choose the medium the concept actually needs'],
    requiredContent: ['the substance of what this site is for', 'the concrete offering', 'the single most valuable action', 'the proof this concept specifically needs — omitted entirely if none can be truthful'],
    factualSlots: ['whatever real-world facts this concept’s sections have slots for'],
    forbiddenContent: ['defaulting to a software-product structure', 'a feature grid chosen because nothing else came to mind'],
    baseline: {},
    heroFamily: 'editorial-split',
    preferredFamilies: ['editorial-split', 'narrative-rail', 'asymmetric-media'],
    discouragedFamilies: [],
  },
};

/* ────────────────────────────────────────────────────────────────────────────
 * 3. BRAND CHARACTER
 * Prompt lexicon modifies the archetype baseline. Stored and rendered as WORDS.
 * ──────────────────────────────────────────────────────────────────────────── */
type Axis = keyof Omit<BrandCharacter, 'summary'>;

const AXIS_CUES: Record<Axis, { low: RegExp; high: RegExp; lowWord: string; highWord: string }> = {
  expression: {
    low: /\b(minimal|understated|restrained|quiet|subtle|clean|discreet|sober|calm)\b/i,
    high: /\b(bold|loud|expressive|striking|dramatic|maximal|vibrant|daring|statement)\b/i,
    lowWord: 'restrained', highWord: 'expressive',
  },
  emphasis: {
    low: /\b(editorial|magazine|story|storytelling|narrative|essay|journal|curated)\b/i,
    high: /\b(product|features?|demo|platform|tool|dashboard|workflow|app)\b/i,
    lowWord: 'editorial', highWord: 'product-driven',
  },
  demeanour: {
    low: /\b(serious|formal|professional|corporate|regulated|clinical|institutional|authoritative)\b/i,
    high: /\b(playful|fun|quirky|friendly|cheerful|whimsical|irreverent|casual)\b/i,
    lowWord: 'serious', highWord: 'playful',
  },
  spacing: {
    low: /\b(dense|compact|information[-\s]rich|data[-\s]heavy|detailed|comprehensive)\b/i,
    high: /\b(spacious|airy|breathing|generous\s+(?:space|whitespace)|sparse|uncluttered)\b/i,
    lowWord: 'dense', highWord: 'spacious',
  },
  temperature: {
    low: /\b(warm|human|handmade|craft|artisan|cosy|cozy|homely|natural|organic|earthy)\b/i,
    high: /\b(technical|engineering|precise|systematic|industrial|infrastructure|scientific)\b/i,
    lowWord: 'warm', highWord: 'technical',
  },
  convention: {
    low: /\b(classic|traditional|timeless|heritage|established|conventional)\b/i,
    high: /\b(experimental|unconventional|avant[-\s]?garde|unusual|weird|brutalist|art[-\s]directed)\b/i,
    lowWord: 'classic', highWord: 'experimental',
  },
  positioning: {
    low: /\b(luxury|luxurious|premium|high[-\s]end|exclusive|refined|bespoke|michelin|couture)\b/i,
    high: /\b(affordable|accessible|budget|everyday|no[-\s]nonsense|straightforward|for\s+everyone|free)\b/i,
    lowWord: 'premium', highWord: 'accessible',
  },
};

/**
 * Turkish character cues — the same seven axes. Without these a Turkish request expressed
 * every bit as clearly as an English one ("minimal ve ferah", "lüks", "eğlenceli", "deneysel")
 * silently fell through to the archetype baseline, so Turkish users could not steer the design
 * at all. Deliberately BOUNDED — a handful of unambiguous, high-signal terms per pole, not a
 * keyword dump — and matched without `\b`, which is ASCII-only in JS and would never fire
 * before "ş"/"ö"/"ğ". Terms that collide across axes (e.g. "samimi" reads as both warm and
 * playful) are assigned to ONE axis only, so a single word never moves two axes at once.
 */
const AXIS_CUES_TR: Record<Axis, { low: RegExp; high: RegExp }> = {
  expression: {
    low: /(minimal|sade|yalın|ölçülü|gösterişsiz)/i,
    high: /(cesur|çarpıcı|iddialı|gösterişli|dikkat çekici)/i,
  },
  emphasis: {
    low: /(editoryal|hikaye|anlatı|dergi tarzı|kürasyon)/i,
    high: /(ürün odaklı|özellik odaklı|demo|yönetim paneli|yazılım ürünü)/i,
  },
  demeanour: {
    low: /(ciddi|kurumsal|resmi|profesyonel)/i,
    high: /(eğlenceli|samimi|neşeli|esprili|cana yakın)/i,
  },
  spacing: {
    low: /(yoğun|kompakt|bilgi dolu|detaylı içerik)/i,
    high: /(ferah|havadar|geniş boşluk|nefes alan)/i,
  },
  temperature: {
    low: /(sıcak|el yapımı|zanaat|doğal|organik|ahşap)/i,
    high: /(teknik|mühendislik|hassas|sistematik|altyapı)/i,
  },
  convention: {
    low: /(klasik|geleneksel|zamansız|köklü)/i,
    high: /(deneysel|sıra ?dışı|alışılmadık|avangart)/i,
  },
  positioning: {
    low: /(lüks|premium|üst segment|seçkin|butik lüks)/i,
    high: /(uygun fiyatlı|ekonomik|herkes için|erişilebilir|bütçe dostu)/i,
  },
};

function deriveBrandCharacter(archetype: SiteArchetype, text: string): BrandCharacter {
  const base = PROFILES[archetype].baseline;
  const out: Record<Axis, string> = {
    expression: 'balanced', emphasis: 'balanced', demeanour: 'balanced',
    spacing: 'balanced', temperature: 'balanced', convention: 'balanced', positioning: 'balanced',
  };
  for (const axis of Object.keys(AXIS_CUES) as Axis[]) {
    const cue = AXIS_CUES[axis];
    const tr = AXIS_CUES_TR[axis];
    // English and Turkish cues score into the SAME poles, so a mixed-language prompt
    // ("minimal ve ferah bir lokanta sitesi") is read once, not twice.
    const lo = hits(text, cue.low) + hits(text, tr.low);
    const hi = hits(text, cue.high) + hits(text, tr.high);
    if (lo > hi) out[axis] = cue.lowWord;
    else if (hi > lo) out[axis] = cue.highWord;
    else out[axis] = (base[axis] as string) || 'balanced';
  }
  // A short human phrase — the two most distinctive non-balanced axes.
  const distinctive = (Object.keys(out) as Axis[]).filter((a) => out[a] !== 'balanced').slice(0, 3).map((a) => out[a]);
  const summary = distinctive.length
    ? distinctive.join(', ')
    : 'evenly balanced — let the subject matter, not a style preset, decide the character';
  return { ...(out as unknown as Omit<BrandCharacter, 'summary'>), summary };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4. VISUAL DIRECTION — a FUNCTION of archetype × character (not a lookup).
 * ──────────────────────────────────────────────────────────────────────────── */
function deriveVisualDirection(archetype: SiteArchetype, b: BrandCharacter): VisualDirection {
  const p = PROFILES[archetype];
  const editorial = b.emphasis === 'editorial';
  const expressive = b.expression === 'expressive';
  const restrained = b.expression === 'restrained';
  const dense = b.spacing === 'dense';
  const spacious = b.spacing === 'spacious';
  const technical = b.temperature === 'technical';
  const warm = b.temperature === 'warm';
  const classic = b.convention === 'classic';
  const experimental = b.convention === 'experimental';
  const premium = b.positioning === 'premium';
  const playful = b.demeanour === 'playful';

  const typographyCharacter = experimental
    ? 'a distinctive display face plus one neutral text face — the pairing is the brand signal'
    : editorial && (classic || premium)
      ? 'serif headlines with a quiet sans for interface text; type does the brand work, not colour'
      : technical
        ? 'one precise grotesque site-wide, plus a real monospace for code, identifiers and numbers'
        : warm
          ? 'a humanist sans or soft serif with warmth in the letterforms; no geometric-neutral default'
          : 'one sans used across a real weight range; hierarchy from weight and size, not decoration';

  const scaleHierarchy = expressive
    ? 'a wide range — one dominant display size then a decisive drop; no timid mid-sizes'
    : dense
      ? 'a compressed scale of many differentiated small steps; hierarchy from weight and rules'
      : 'four to five steps, each visibly different from its neighbour';

  const contentWidth = editorial || archetype === 'editorial-media'
    ? 'a 60–75 character reading measure for prose inside a wider frame that lets media break out'
    : dense
      ? 'a wide working container for real information, prose still held to a readable measure'
      : 'a contained page with deliberate exceptions where a section should break the frame';

  const gridBehavior = experimental || expressive
    ? 'an asymmetric grid with intentional offsets and overlap; felt, not perfectly regular'
    : dense
      ? 'a strict multi-column grid that different sections subdivide differently'
      : 'a grid whose column count changes with content type instead of staying at three';

  const rhythm = spacious
    ? 'long intervals with one clear climax; vary section heights so the page has a pulse'
    : dense
      ? 'tight regular intervals punctuated by two or three deliberate releases'
      : 'alternating intervals — never the same vertical padding on every section';

  const whitespace = spacious
    ? 'generous space used as composition — it must group and separate, not merely pad'
    : dense
      ? 'space is scarce and therefore meaningful; group with rules and alignment, not padding'
      : 'space allocated unevenly on purpose: more around the important, less around the routine';

  const borderUsage = technical || dense
    ? 'hairline rules and dividers as the primary structural device'
    : editorial
      ? 'rules used typographically — under a section label, not as a box around everything'
      : restrained
        ? 'almost no borders; separate with space, background shifts and alignment'
        : 'borders only where a real boundary exists, never on every element by default';

  const cornerRadiusPhilosophy = technical || classic
    ? 'sharp or near-sharp corners; radius reserved for interactive controls'
    : playful || warm
      ? 'one soft radius on controls and imagery, never on every text block'
      : 'one radius on controls and media, NOT on sections, text blocks or the page frame';

  const imageryRole = p.imagery === 'central'
    ? 'imagery carries the argument — it is content, sized to be judged, never filler'
    : p.imagery === 'supporting'
      ? 'imagery supports specific claims — each image shows something the text asserts'
      : p.imagery === 'incidental'
        ? 'imagery is largely unnecessary; code, data and typography communicate better'
        : 'no decorative imagery — add an image only where it carries information';

  const navigationBehavior = archetype === 'editorial-media' || archetype === 'ecommerce-brand' || archetype === 'marketplace'
    ? 'navigation exposes the real structure (sections, collections, categories), not a marketing menu'
    : archetype === 'landing-campaign'
      ? 'minimal — a wordmark and at most the single action; do not build a site menu'
      : dense
        ? 'a persistent, information-dense header that keeps orientation on a long page'
        : 'a quiet header that recedes on scroll and does not repeat the CTA in every state';

  const sectionTransitions = expressive || experimental
    ? 'strong transitions — background inversion, full-bleed breaks, scale changes'
    : restrained
      ? 'transitions by alignment and measure change rather than background colour swaps'
      : 'vary the device: some sections change background, some measure, some alignment';

  const contrastStrategy = premium
    ? 'a narrow palette with one decisive accent; contrast from scale and material, not colour count'
    : technical
      ? 'high text contrast, low chrome contrast; colour reserved for state and meaning'
      : 'a small palette with one accent used rarely enough to still mean something';

  const ctaHierarchy = archetype === 'landing-campaign'
    ? 'exactly one primary action, appearing at most twice on the page'
    : p.imagery === 'central' && editorial
      ? 'one primary action where the visitor is actually convinced — not after every section'
      : 'one primary action with a genuinely different secondary; supporting sections end with content';

  const density = p.contentDensity === 'high'
    ? 'high — this audience wants information; do not strip content to look calm'
    : p.contentDensity === 'low'
      ? 'low — a few things shown large and well; resist adding sections to fill space'
      : 'moderate — enough to answer the visitor\'s real questions, no padding sections';

  const motionRestraint = restrained || technical
    ? 'motion only where it clarifies state or continuity; no entrance animation on every section'
    : expressive
      ? 'one signature motion idea executed well, quiet functional transitions elsewhere'
      : 'restrained, purposeful motion; never a universal fade-up on every block';

  return {
    typographyCharacter, scaleHierarchy, contentWidth, gridBehavior, rhythm, whitespace,
    borderUsage, cornerRadiusPhilosophy, imageryRole, navigationBehavior, sectionTransitions,
    contrastStrategy, ctaHierarchy, density, motionRestraint,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 5. PAGE COMPOSITION STRATEGY — synthesized, deterministic, non-random.
 * ──────────────────────────────────────────────────────────────────────────── */
const STRATEGY_ENTRY: Record<PageCompositionStrategy, string> = {
  'editorial-masthead': 'lead with a masthead and a real lead item (a story, a programme, a headline offering) — not a centred slogan',
  'product-led-demonstration': 'the first viewport must show the product doing its actual job, with copy supporting the interface',
  'immersive-visual': 'the first viewport is one committed image or scene at full bleed, with type set into it, not floating above a gradient',
  'catalogue-grid-commerce': 'get real goods on screen immediately — a category or product grid may begin above the fold',
  'split-narrative': 'a decisive split: claim on one side, evidence on the other; the split ratio must be asymmetric, not 50/50',
  'dense-information-system': 'front-load the concrete facts this visitor came for — whatever they are for this site — as structured information, not as a slogan',
  'typographic-minimal': 'type and space do all the work; one statement, set large and well, with no decorative accompaniment',
  'portfolio-case-study': 'open on the strongest single piece of work at a size that lets it be judged',
  'local-service-credibility': 'immediately establish who, where, what and how to reach them — contact detail is content, not chrome',
  'storytelling-sequence': 'open a sequence that pays off further down the page; the hero is the first beat, not a summary',
  'asymmetric-art-direction': 'an art-directed opening composition with deliberate imbalance, overlap and off-grid placement',
};

const STRATEGY_SHAPES: Record<PageCompositionStrategy, string[]> = {
  'editorial-masthead': ['one lead item given clearly more weight than everything else', 'an index or list treated as real editorial content, not as cards', 'section labels set typographically'],
  'product-led-demonstration': ['at least one section that is a real working surface, not a screenshot of one', 'a before/after or input→output comparison', 'specification or integration detail rendered as a table or list, not as cards'],
  'immersive-visual': ['at least two full-bleed image moments at different scales', 'one quiet typographic section between them so the images do not blur together', 'detail information given a plain, legible treatment'],
  'catalogue-grid-commerce': ['a product/collection grid with an inconsistent tile rhythm (a featured item breaking the grid)', 'one product shown in detail', 'practical information (materials, delivery, returns) as plain structured content'],
  'split-narrative': ['alternating split sections with the media side changing sides and ratio', 'one full-width interruption to break the alternation', 'a closing section that is not another split'],
  'dense-information-system': ['a real table, schedule or specification block', 'a filterable or grouped list', 'at most one card-based section in the entire page'],
  'typographic-minimal': ['sections separated by measure and alignment, not by boxes', 'no more than one image in the whole page unless the content demands it', 'a closing statement rather than a CTA block'],
  'portfolio-case-study': ['work shown at large scale with varied crops', 'one project opened up in depth', 'a short index of remaining work'],
  'local-service-credibility': ['services described in specific terms, not as icon cards', 'a genuine location/coverage block', 'credentials and contact presented as content'],
  'storytelling-sequence': ['sections that read in order and depend on each other', 'a visual change of state at the turning point', 'the resolution carries the action'],
  'asymmetric-art-direction': ['no two consecutive sections sharing an alignment', 'at least one overlapping or off-grid composition', 'one deliberately quiet section as relief'],
};

function pickStrategy(archetype: SiteArchetype, b: BrandCharacter): CompositionStrategyPlan {
  const p = PROFILES[archetype];
  const candidates = p.strategies;
  // Character-driven synthesis over the archetype's ranked candidates. Deterministic:
  // the same (archetype, character) always yields the same strategy, but different
  // characters within one archetype yield DIFFERENT strategies — so an archetype is
  // never a 1:1 template.
  const scored = candidates.map((s, i) => {
    let score = candidates.length - i; // rank preference
    if (b.expression === 'expressive' && (s === 'asymmetric-art-direction' || s === 'immersive-visual')) score += 2;
    if (b.expression === 'restrained' && s === 'typographic-minimal') score += 2;
    if (b.emphasis === 'editorial' && (s === 'editorial-masthead' || s === 'storytelling-sequence' || s === 'portfolio-case-study')) score += 2;
    if (b.emphasis === 'product-driven' && (s === 'product-led-demonstration' || s === 'dense-information-system')) score += 2;
    if (b.spacing === 'dense' && s === 'dense-information-system') score += 2;
    if (b.spacing === 'spacious' && (s === 'typographic-minimal' || s === 'immersive-visual')) score += 2;
    if (b.convention === 'experimental' && s === 'asymmetric-art-direction') score += 2;
    if (b.convention === 'classic' && (s === 'editorial-masthead' || s === 'split-narrative')) score += 1;
    if (b.positioning === 'premium' && (s === 'immersive-visual' || s === 'typographic-minimal')) score += 2;
    return { s, score };
  }).sort((x, y) => (y.score - x.score) || candidates.indexOf(x.s) - candidates.indexOf(y.s));

  const chosen = scored[0].s;
  const rejected = scored.slice(1).map((x) => x.s);
  return {
    strategy: chosen,
    rationale: clip(`${p.label.toLowerCase()} with a ${b.summary} character — ${STRATEGY_ENTRY[chosen]}`, 220),
    consideredAndRejected: list(rejected, 3),
    entryObligation: STRATEGY_ENTRY[chosen],
    sectionShapeRules: STRATEGY_SHAPES[chosen],
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 6. ANTI-REPETITION — scaled to the real section count.
 * ──────────────────────────────────────────────────────────────────────────── */
function deriveAntiRepetition(sectionCount: number, archetype: SiteArchetype): AntiRepetitionPolicy {
  const n = Math.max(1, sectionCount || 6);
  // At most a quarter of the page may be repeated-card sections, floor 1, ceiling 2.
  const maxRepeatedCardSections = Math.max(1, Math.min(2, Math.floor(n / 4)));
  const maxIdenticalGridSections = Math.max(1, Math.min(2, Math.floor(n / 3)));
  const p = PROFILES[archetype];
  return {
    maxRepeatedCardSections,
    maxIdenticalGridSections,
    rules: list([
      `at most ${maxRepeatedCardSections} section${maxRepeatedCardSections > 1 ? 's' : ''} in the whole page may use a repeated card/tile pattern`,
      `at most ${maxIdenticalGridSections} section${maxIdenticalGridSections > 1 ? 's' : ''} may share the same grid geometry — vary column counts and tile proportions by content type`,
      'do not apply the same corner radius and shadow treatment to every component; reserve elevation for surfaces that genuinely float',
      'a text block is not a card — only box content that is a discrete, comparable unit',
      'use an icon only where it labels a repeated, scannable item; never one icon per paragraph as decoration',
      'do not end every section with a button; supporting sections end with content',
      'do not repeat the heading + subheading + three-item-grid pattern more than once in the page',
      p.imagery === 'central'
        ? 'vary image crop and scale between sections; never a row of identically-cropped stock photos'
        : 'do not add an image to a section merely because it looks empty — change the composition instead',
    ], 8),
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 7. CONTENT ARCHITECTURE + TRUTH POLICY
 * ──────────────────────────────────────────────────────────────────────────── */
/**
 * Claims that may never be invented, under any archetype.
 *
 * This list and every profile's `requiredContent` are deliberately kept CONSISTENT: a
 * required item names a STRUCTURE (a menu, a schedule, a people section), never a fact,
 * and the facts those structures hold are listed separately in `factualSlots` and governed
 * by FACTUAL_POLICY below. Without that split the contract contradicted itself — an event
 * site was told both "put the date, venue and ticket price in the first viewport" and
 * "never invent dates or prices", and the model had to break one of the two.
 */
const NEVER_FABRICATE = [
  'testimonials, reviews, ratings or attributed quotes',
  'customer / user / member / attendee / subscriber counts',
  'revenue, funding, growth, accuracy or performance figures',
  'certifications, accreditations, licences or registration numbers',
  'awards or press mentions',
  'company history or founding dates',
  'addresses, phone numbers, email addresses, opening hours or service areas',
  'names of people — team, staff, practitioners, instructors, speakers, authors, clients',
  'partner, client or "trusted by" logos',
  'prices, fees, rates or discounts',
  'dates, times, schedules or deadlines',
  'product, dish, course, session or listing names presented as the real catalogue',
];

/**
 * The classes above that the specification's existing `honestyRules` and
 * `outputContract.forbiddenPatterns` do NOT already cover. Those already forbid invented
 * metrics, reviews, testimonials, logos, certifications, prices, inventory and listings, so
 * only these are rendered — Design Intelligence extends the protection instead of restating it.
 */
const ADDITIONAL_NEVER_FABRICATE = [
  'names of people — team, staff, practitioners, instructors, speakers, authors, clients',
  'addresses, phone numbers, email addresses, opening hours or service areas',
  'dates, times, schedules or deadlines',
  'product, dish, course, session or listing names presented as the real catalogue',
  'company history or founding dates',
];

/**
 * What to do when a structure has a slot and the request did not supply the fact for it.
 * The site must still be STRUCTURALLY complete and honest — a real menu with clearly
 * provisional dish names is a usable site; a menu with invented prices is a liability.
 */
const FACTUAL_POLICY =
  'Use ONLY facts the request supplied. Where one was not supplied, still build the structure and fill '
  + 'the slot with an obviously provisional label the owner will replace ("Address to be confirmed", '
  + '"Price on request", "Speaker to be announced", "Sample item"), or omit that single field where a '
  + 'placeholder would read as dishonest. Never invent a plausible-looking value, never use lorem ipsum, '
  + 'and never delete a required section because its facts are missing.';
const BANNED_PHRASING = [
  'elevate', 'unlock', 'revolutionise', 'transform your workflow', 'seamless',
  'powerful', 'next-generation', 'cutting-edge', 'game-changing', 'supercharge', 'effortless',
];

function deriveContentPolicy(archetype: SiteArchetype, b: BrandCharacter): ContentArchitecturePolicy {
  const p = PROFILES[archetype];
  const copyDirection = clip(
    `write for ${p.visitor} — ${p.emotionalTone}; ${p.register} register, ${b.summary} character. Every headline `
    + 'must say something only THIS site could say. Where a fact was not supplied, write the sentence that is true '
    + 'without it — never invent it.',
    360,
  );
  return {
    requiredContent: list(p.requiredContent, 6),
    factualSlots: list(p.factualSlots, 6),
    factualPolicy: FACTUAL_POLICY,
    forbiddenContent: list(p.forbiddenContent),
    neverFabricate: NEVER_FABRICATE.slice(0, 12),
    additionalNeverFabricate: ADDITIONAL_NEVER_FABRICATE.slice(0, 6),
    bannedPhrasing: BANNED_PHRASING.slice(0, 12),
    copyDirection,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 8. IMAGE INTENT
 * ──────────────────────────────────────────────────────────────────────────── */
function deriveImageIntent(archetype: SiteArchetype, b: BrandCharacter): ImageIntentPolicy {
  const p = PROFILES[archetype];
  // A dense/technical character pulls imagery down one step; a premium/editorial
  // character can pull a supporting role up.
  let role: ImageryRole = p.imagery;
  if (role === 'supporting' && b.temperature === 'technical' && b.spacing === 'dense') role = 'incidental';
  if (role === 'supporting' && b.positioning === 'premium' && b.emphasis === 'editorial') role = 'central';

  const subject = role === 'central'
    ? [
      'photograph the actual subject of this site (the goods, the place, the work, the people) — never a generic stand-in',
      'the hero image must be specific enough that it could not be swapped for another business in this category',
    ]
    : role === 'supporting'
      ? [
        'every image must depict something the adjacent text actually claims',
        'prefer one considered image over three interchangeable ones',
      ]
      : role === 'incidental'
        ? [
          'prefer code, data, tables or diagrams over photography',
          'add an image only where it shows something words cannot',
        ]
        : ['do not add decorative imagery at all; carry the page on type, space and structure'];

  const cropRoles = role === 'unnecessary' ? [] : list([
    'hero / full-bleed: wide landscape (about 16:9 to 21:9), composed with space for type',
    'editorial pair: portrait or 4:5 alongside text, aligned to the type baseline',
    role === 'central' ? 'index or grid unit: one consistent aspect ratio per grid, with one deliberate exception' : undefined,
    'detail: square or near-square close-up used sparingly for texture or proof',
  ], 4);

  return {
    role,
    preferredMedia: list(p.preferredMedia, 4),
    subjectGuidance: list(subject, 3),
    cropRoles,
    forbidden: list([
      'a repeated grid of interchangeable stock photographs',
      'an image placeholder, empty box or "image here" label in delivered output',
      'the same image reused for two different semantic purposes',
      role === 'incidental' || role === 'unnecessary'
        ? 'abstract gradient meshes or glowing blobs used as a substitute for content'
        : 'a decorative gradient or glow standing in for a real photograph',
    ], 4),
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 9. RESPONSIVE INTENT — mobile as a designed state, not a squeeze.
 * ──────────────────────────────────────────────────────────────────────────── */
function deriveResponsiveIntent(
  archetype: SiteArchetype,
  b: BrandCharacter,
  strategy: PageCompositionStrategy,
): ResponsiveIntent {
  const p = PROFILES[archetype];
  const dense = p.contentDensity === 'high' || b.spacing === 'dense';

  const structural = list([
    strategy === 'split-narrative' || strategy === 'asymmetric-art-direction'
      ? 'each split becomes one column with the media deliberately placed before OR after the text — decide per section'
      : undefined,
    strategy === 'catalogue-grid-commerce'
      ? 'the product grid drops to two columns (not one) so it still reads as a catalogue; the featured tile goes full width'
      : undefined,
    strategy === 'dense-information-system'
      ? 'tables and schedules become grouped, labelled rows — never a horizontally scrolling desktop table'
      : undefined,
    strategy === 'immersive-visual'
      ? 'full-bleed scenes re-crop taller and type moves out of the image if legibility drops'
      : undefined,
    strategy === 'editorial-masthead'
      ? 'the lead keeps its dominance; the index becomes a one-column list with visible dates and bylines'
      : undefined,
    strategy === 'portfolio-case-study'
      ? 'work stays large — one piece per screen, never shrunken thumbnails'
      : undefined,
    strategy === 'local-service-credibility'
      ? 'the phone/booking action becomes a persistent, thumb-reachable element'
      : undefined,
    strategy === 'product-led-demonstration'
      ? 'the product surface is re-laid out as a mobile-shaped view, not a scaled desktop screenshot'
      : undefined,
    'any side-by-side comparison becomes a stacked comparison with the differences still adjacent',
  ], 4);

  return {
    navigationTransformation: archetype === 'landing-campaign'
      ? 'no menu on mobile — the single action stays reachable'
      : dense
        ? 'a compact sticky bar with a full-screen menu exposing the real structure, not a bare hamburger'
        : 'a drawer/full-screen menu mirroring the desktop structure; the primary action stays reachable',
    hierarchyChange: 'decide the mobile hierarchy separately — what is secondary on desktop may be primary on a phone (hours, price, dates, contact)',
    stackingOrder: 'stacking order is a per-section design decision, not source order — reorder where the mobile argument differs',
    imageCropChange: p.imagery === 'unnecessary'
      ? 'no imagery to re-crop; keep type size and measure comfortable instead'
      : 'crop to portrait/square where a wide crop loses the subject; never letterbox into a thin strip',
    densityChange: dense
      ? 'keep the information — regroup it into progressive sections rather than deleting it'
      : 'reduce ornament, not substance; remove decorative sections before content',
    ctaPlacement: 'the primary action appears once early and once at the decision point, not trailing the visitor down the page',
    simplification: 'simplify by removing decoration and collapsing depth — never the content the visitor came for',
    structuralChanges: structural,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * THE UNIVERSAL FINGERPRINT BAN
 * ──────────────────────────────────────────────────────────────────────────── */
/* The AI-website fingerprints NOT already covered elsewhere in the request. The centred
 * gradient hero, the three-identical-feature-cards grid and the default indigo palette are
 * already forbidden by the spec's own `templateTrapsToAvoid` / `mustAvoid`, so they are
 * deliberately NOT restated here — no duplicate authority, no wasted tokens. */
const FORBIDDEN_FINGERPRINTS = [
  'a glowing blob / aurora / mesh gradient behind the hero',
  'pill badges above the headline ("New", "Introducing", "v2")',
  'a fake dashboard floating inside a tilted glass card',
  'a bento grid used because it looks modern rather than because the content is uneven',
  'rounded cards and drop shadows applied uniformly to every block',
  'copy of the "Transform your workflow" family',
  'large whitespace with no compositional intent',
];

/* ────────────────────────────────────────────────────────────────────────────
 * DERIVATION ENTRY POINT
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Derive the Design Intelligence V3 contract. Pure, deterministic, no model or
 * network call. Returns `undefined` only when there is no usable prompt at all,
 * or on any unexpected failure — callers then attach nothing and behaviour is
 * unchanged. NEVER called for buildType='app'.
 */
export function deriveDesignIntelligence(input: DesignIntelligenceInput): DesignIntelligenceContract | undefined {
  try {
    const prompt = (input.prompt || '').trim();
    if (!prompt) return undefined;

    const resolved = resolveArchetype(input);
    const archetype = resolved.archetype;
    const profile = PROFILES[archetype];
    const characterText = `${prompt} ${input.briefText || ''}`.slice(0, 2000);
    const brand = deriveBrandCharacter(archetype, characterText);
    const visual = deriveVisualDirection(archetype, brand);
    const composition = pickStrategy(archetype, brand);
    const sectionCount = Array.isArray(input.sections) ? input.sections.length : 0;
    const image = deriveImageIntent(archetype, brand);

    return {
      version: 'design-intelligence-v3',
      archetype,
      archetypeLabel: profile.label,
      confidence: resolved.confidence,
      basis: resolved.basis,
      runnerUp: resolved.runnerUp,
      evidence: resolved.evidence,
      product: {
        category: profile.category,
        businessModel: profile.businessModel,
        primaryVisitor: profile.visitor,
        visitorIntent: profile.visitorIntent,
        conversionGoal: profile.conversionGoal,
        trustRequirement: profile.trustRequirement,
        contentDensity: profile.contentDensity,
        emotionalTone: profile.emotionalTone,
        register: profile.register,
      },
      brand,
      visual,
      composition,
      antiRepetition: deriveAntiRepetition(sectionCount, archetype),
      content: deriveContentPolicy(archetype, brand),
      image,
      responsive: deriveResponsiveIntent(archetype, brand, composition.strategy),
      compositionSteer: {
        heroFamily: profile.heroFamily,
        preferredFamilies: list(profile.preferredFamilies, 5),
        discouragedFamilies: list(profile.discouragedFamilies, 4),
        heroMediaPreference: image.role === 'central'
          ? 'media-led'
          : (image.role === 'incidental' || image.role === 'unnecessary') ? 'text-led' : 'either',
      },
      forbiddenFingerprints: FORBIDDEN_FINGERPRINTS.slice(0, 10),
    };
  } catch {
    return undefined;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * RENDERING — the builder block (P1/P2 priority) and the planning block.
 * Both hard-bounded; both return [] / '' when the contract is absent.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Bound a rendered block to its documented ceiling without cutting mid-line. */
function boundLines(lines: string[], ceiling: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (const l of lines) {
    const cost = l.length + 1;
    if (used + cost > ceiling) break;
    out.push(l);
    used += cost;
  }
  return out;
}

/**
 * P1 — WHAT THIS SITE IS, what it must genuinely contain, and what may never be
 * invented. This is business intent + content hierarchy + truthfulness: the tier
 * that must survive every budget cut, and the only Design Intelligence material
 * that may sit above the canonical composition / content / visual-system
 * authorities. Everything else this module produces is rendered at its own,
 * lower, honest priority by the three functions below — so a budget cut can never
 * drop a canonical authority while keeping Design Intelligence decoration.
 */
export function renderDesignIntelligenceP1Block(contract: DesignIntelligenceContract | undefined): string[] {
  if (!contract) return [];
  const c = contract;
  const lines: string[] = [
    `BINDING SITE DESIGN DIRECTION (design-intelligence-v3 · archetype: ${c.archetype} · ${c.confidence} confidence via ${c.basis}):`,
    `This is ${article(c.archetypeLabel)} ${c.archetypeLabel.toLowerCase()} — ${c.product.category}. Business model: ${c.product.businessModel}.`,
    `Primary visitor: ${c.product.primaryVisitor}. They came to: ${c.product.visitorIntent}.`,
    `The single conversion: ${c.product.conversionGoal}. Trust requirement: ${c.product.trustRequirement}.`,
    `Register: ${c.product.register} · tone: ${c.product.emotionalTone} · content density: ${c.product.contentDensity}.`,
    ...(c.archetype === 'general'
      ? ['NO archetype was decisive: derive the structure from THIS request. Do NOT fall back to a software-product/marketing-page shape.']
      : []),
    'MUST genuinely contain — these are STRUCTURAL obligations (build the section and its real',
    'information architecture). They are NEVER an instruction to invent the facts inside them:',
    ...c.content.requiredContent.map((r) => `- ${r}`),
    ...(c.content.factualSlots.length ? [
      `Facts these sections need: ${c.content.factualSlots.join('; ')}.`,
      c.content.factualPolicy,
    ] : []),
    'WRONG for this kind of site (do not produce these even if they are common on the web):',
    ...c.content.forbiddenContent.map((r) => `- ${r}`),
    // The spec's own honestyRules / outputContract.forbiddenPatterns already forbid invented
    // metrics, reviews, testimonials, logos, certifications, prices, inventory and listings —
    // restating them here would be a second authority saying the same thing. Only the classes
    // NOT covered there are named, so this line adds coverage instead of noise.
    `NEVER invent, in addition to the honesty rules below: ${c.content.additionalNeverFabricate.join('; ')}.`,
    `Copy: ${c.content.copyDirection}`,
    `Avoid this vocabulary unless the concept genuinely warrants it: ${c.content.bannedPhrasing.slice(0, 10).join(', ')}.`,
    '',
  ];
  return boundLines(lines, P1_CHAR_CEILING);
}

/**
 * P2 — brand/design direction and responsive behaviour. Peer of the canonical
 * composition / visualSystem / contentNarrative / experienceQuality authorities:
 * it sets page-level STRATEGY and character, never per-section families (composition
 * owns those) and never colour/type tokens (visualSystem owns those).
 */
export function renderDesignIntelligenceP2Block(contract: DesignIntelligenceContract | undefined): string[] {
  if (!contract) return [];
  const c = contract;
  const v = c.visual;
  const lines: string[] = [
    `PAGE COMPOSITION STRATEGY: ${c.composition.strategy} — ${c.composition.rationale}`,
    `First viewport obligation: ${c.composition.entryObligation}.`,
    ...c.composition.sectionShapeRules.map((r) => `- ${r}`),
    ...(c.composition.consideredAndRejected.length
      ? [`Also viable here, deliberately not chosen: ${c.composition.consideredAndRejected.join(', ')}.`]
      : []),
    `BRAND CHARACTER (drives real decisions, never printed on the page): ${v0(c)}`,

    'VISUAL DIRECTION — the CHARACTER each decision must express. Where the visual-system block',
    'states a concrete token (radius scale, type scale, colour role, shadow, spacing), that token is',
    'authoritative — express this character by choosing WITHIN it, never by contradicting it:',
    `- Typography: ${v.typographyCharacter}`,
    `- Scale hierarchy: ${v.scaleHierarchy}`,
    `- Content width / measure: ${v.contentWidth}`,
    `- Grid: ${v.gridBehavior}`,
    `- Vertical rhythm: ${v.rhythm}`,
    `- Whitespace: ${v.whitespace}`,
    `- Borders: ${v.borderUsage}`,
    `- Corner radius: ${v.cornerRadiusPhilosophy}`,
    `- Contrast: ${v.contrastStrategy}`,
    `- Navigation: ${v.navigationBehavior}`,
    `- Section transitions: ${v.sectionTransitions}`,
    `- CTA hierarchy: ${v.ctaHierarchy}`,
    `- Density: ${v.density}`,
    `- Motion: ${v.motionRestraint}`,

    'WITHIN THIS BUILD, DO NOT REPEAT YOURSELF — these govern repeated TREATMENT (card pattern, grid',
    'geometry, elevation, icon and CTA reuse). Per-section composition families and their adjacency',
    'rule belong to the page-composition block; do not re-decide them here:',
    ...c.antiRepetition.rules.map((r) => `- ${r}`),

    'RESPONSIVE — design the mobile experience, do not shrink the desktop one:',
    `- Navigation: ${c.responsive.navigationTransformation}`,
    `- Hierarchy: ${c.responsive.hierarchyChange}`,
    `- Stacking: ${c.responsive.stackingOrder}`,
    `- Images: ${c.responsive.imageCropChange}`,
    `- Density: ${c.responsive.densityChange}`,
    `- CTA: ${c.responsive.ctaPlacement}`,
    `- Simplify by: ${c.responsive.simplification}`,
    ...c.responsive.structuralChanges.map((r) => `- Structural change: ${r}`),
    'These are the mobile DESIGN decisions. The integrated-experience block owns the mechanical floor',
    '(column collapse, reading/tab order, minimum type size, touch-target size, overflow) — satisfy both.',
    '',
  ];
  return boundLines(lines, P2_CHAR_CEILING);
}

/** P3 — imagery guidance. Peer of visualConcept / motionExecution / research. */
export function renderDesignIntelligenceP3Block(contract: DesignIntelligenceContract | undefined): string[] {
  if (!contract) return [];
  const c = contract;
  const lines = [
    `IMAGE INTENT — imagery is ${c.image.role} to this site. ${c.visual.imageryRole}. ${c.image.subjectGuidance.join('; ')}.`,
    ...(c.image.preferredMedia.length ? [`- Preferred media: ${c.image.preferredMedia.join('; ')}.`] : []),
    ...(c.image.cropRoles.length ? [`- Crop roles: ${c.image.cropRoles.join(' | ')}.`] : []),
    `- Never: ${c.image.forbidden.join('; ')}.`,
    'This is imagery INTENT. Any required-image-coverage block below states the mandatory floor and the',
    'approved slots — it always wins; never drop a required image because intent here says imagery is light.',
    '',
  ];
  return boundLines(lines, P3_CHAR_CEILING);
}

/** P4 — the generic fingerprint ban. The least specific guidance here, and
 *  therefore the first thing a budget cut should lose. */
export function renderDesignIntelligenceP4Block(contract: DesignIntelligenceContract | undefined): string[] {
  if (!contract) return [];
  const lines = [
    `DO NOT REPRODUCE THE GENERIC AI-WEBSITE FINGERPRINT: ${contract.forbiddenFingerprints.join('; ')}.`,
    'None of this licenses random styling — every decision above must be justified by this business, its visitor and its content.',
    '',
  ];
  return boundLines(lines, P4_CHAR_CEILING);
}

/**
 * The COMPLETE rendered direction, P1→P4 in order. This is what an un-budgeted
 * request carries. The request builder emits the four tiers SEPARATELY, each at
 * its own priority, so this is the concatenation — never a fifth representation.
 */
export function renderDesignIntelligenceBlock(contract: DesignIntelligenceContract | undefined): string[] {
  if (!contract) return [];
  return [
    ...renderDesignIntelligenceP1Block(contract),
    ...renderDesignIntelligenceP2Block(contract),
    ...renderDesignIntelligenceP3Block(contract),
    ...renderDesignIntelligenceP4Block(contract),
  ];
}

/** The brand character rendered as words (never numbers). */
function v0(c: DesignIntelligenceContract): string {
  const b = c.brand;
  return [
    `${b.expression} (restrained↔expressive)`,
    `${b.emphasis} (editorial↔product-driven)`,
    `${b.demeanour} (serious↔playful)`,
    `${b.spacing} (dense↔spacious)`,
    `${b.temperature} (warm↔technical)`,
    `${b.convention} (classic↔experimental)`,
    `${b.positioning} (premium↔accessible)`,
  ].join(' · ');
}

/**
 * The COMPACT direction block for the stage-1 PLANNING prompt, derived from the raw
 * idea alone (no spec exists yet). It tells the planner what kind of site it is
 * reasoning about so the plan itself stops converging on a product-marketing shape.
 * Hard-bounded to PLANNING_CHAR_CEILING. Empty when no contract could be derived.
 */
export function renderDesignIntelligencePlanningBlock(contract: DesignIntelligenceContract | undefined): string[] {
  if (!contract) return [];
  const c = contract;
  const lines = [
    `SITE DIRECTION (Korvix-derived, ${c.confidence} confidence — treat as context, correct it if the idea clearly says otherwise):`,
    c.archetype === 'general'
      ? 'No standard archetype was decisive. Derive the site kind from the idea itself; do NOT default to a software-product/marketing-page structure.'
      : `Kind of site: ${c.archetypeLabel} (${c.product.category}). Business model: ${c.product.businessModel}.`,
    `Primary visitor: ${c.product.primaryVisitor}; they came to ${c.product.visitorIntent}.`,
    `The conversion that matters: ${c.product.conversionGoal}. Trust requirement: ${c.product.trustRequirement}.`,
    `Register: ${c.product.register}; brand character: ${c.brand.summary}; content density: ${c.product.contentDensity}.`,
    `Composition strategy to plan for: ${c.composition.strategy} — ${c.composition.entryObligation}.`,
    `The section architecture must genuinely cover: ${c.content.requiredContent.slice(0, 5).join('; ')}.`,
    'Those are STRUCTURAL requirements. Plan the sections and their real information architecture,',
    'but never invent the business facts inside them (prices, dates, addresses, hours, names,',
    'menu/product items, credentials, statistics) — plan a provisional label the owner replaces.',
    `Wrong for this kind of site: ${c.content.forbiddenContent.slice(0, 3).join('; ')}.`,
    'Do NOT plan a centred-hero + three-feature-cards + testimonials + CTA page unless this specific idea genuinely calls for it.',
    '',
  ];
  return boundLines(lines, PLANNING_CHAR_CEILING);
}

/** Compact, JSON-safe diagnostics (no prose duplication of the block). */
export interface DesignIntelligenceDiagnostics {
  version: 'design-intelligence-v3';
  archetype: SiteArchetype;
  confidence: ArchetypeConfidence;
  basis: ArchetypeBasis;
  runnerUp?: SiteArchetype;
  strategy: PageCompositionStrategy;
  imageryRole: ImageryRole;
  brandSummary: string;
  blockChars: number;
}

export function buildDesignIntelligenceDiagnostics(
  contract: DesignIntelligenceContract | undefined,
): DesignIntelligenceDiagnostics | undefined {
  if (!contract) return undefined;
  return {
    version: 'design-intelligence-v3',
    archetype: contract.archetype,
    confidence: contract.confidence,
    basis: contract.basis,
    runnerUp: contract.runnerUp,
    strategy: contract.composition.strategy,
    imageryRole: contract.image.role,
    brandSummary: contract.brand.summary,
    blockChars: renderDesignIntelligenceBlock(contract).join('\n').length,
  };
}
