/* ────────────────────────────────────────────────────────────────────────────
 * experienceIntelligence.ts — EXPERIENCE INTELLIGENCE (shared, canonical)
 *
 * The ONE authority that decides, BEFORE generation and for BOTH build types,
 * what KIND of experience the request actually needs:
 *
 *   • what carries the experience (typography / imagery / interface / editorial /
 *     catalogue / data / narrative / raw utility) — the "lead"
 *   • whether media is genuinely useful at all, and if so WHICH media
 *   • how dense the surface should be, and how its hierarchy should behave
 *   • what content ROLES the product needs (never which facts to invent)
 *   • how the build should be optimized WITHOUT damaging the experience
 *
 * WHY IT EXISTS
 * Korvix already owns each of these decisions somewhere — but only for ONE build
 * type, and never as one comparable verdict:
 *
 *   decision                     web owner                     app owner
 *   ───────────────────────────  ────────────────────────────  ─────────────────────────
 *   kind of product              designIntelligence.archetype  appArchitecture.appType
 *   brand/visual character       designIntelligence.brand      appVisual.hierarchy
 *   page/screen composition      composition                   appVisual.screenComposition
 *   imagery floor                imageCoverage                 (none)
 *   imagery taste                visualConcept                 appVisual.imageStrategy (boolean)
 *   content roles                designIntelligence.content    (none)
 *   truth policy                 designIntelligence.content    spec.honestyRules only
 *   anti-repetition              designIntelligence.antiRepetition  appVisual.antiPatterns
 *   optimization                 webBuildOptimizationPass (POST-generation only)  same
 *
 * Two real gaps follow from that table, and this module closes exactly those two:
 *   1. APP BUILD has no media-necessity verdict (only a boolean), no content-role /
 *      fabrication policy of its own, and no repetition budget.
 *   2. NEITHER build type has an optimization STRATEGY before generation. Optimization
 *      existed only as a post-hoc repair advisory, so every build first generated
 *      oversized eager media, unbudgeted motion and over-nested DOM and only then was
 *      told to clean it up — inside a repair budget it usually could not win.
 *
 * OWNERSHIP BOUNDARY (this module composes; it never re-decides)
 *   • site archetype / sector / business model → designIntelligence + verticalIntelligence
 *   • app type / screens / flows / routes      → appArchitecture + appNavigation
 *   • per-section composition families         → composition
 *   • colour + type tokens                     → visualSystem
 *   • the REQUIRED photography floor           → imageCoverage
 *   • per-image art direction                  → visualConcept
 *   • acceptance / repair / re-verify          → Web Build Quality V2
 * It reads those authorities as EVIDENCE and emits one bounded, typed direction.
 *
 * Where its subject genuinely touches an existing authority, ONE of them renders it:
 * on a web build the image-intent tier already states imagery subjects, crops and
 * forbidden treatments, so the media block renders the VERDICT (is media needed, in
 * what medium, on which surfaces, when is type stronger) and defers the vocabulary
 * to that tier (`media.vocabularyOwnedElsewhere`); likewise the web content ROLES are
 * adopted from the design-intelligence content architecture rather than restated
 * (`content.rolesOwnedElsewhere`). An app build has neither owner, so it renders both
 * itself — which is precisely the gap this layer exists to close.
 *
 * ISOLATION
 * `web` and `app` are mutually exclusive on the contract, by construction and by
 * regression test: a web build never carries app direction, and an app build never
 * carries hero/marketing/page direction. Shared decisions stay in the core blocks.
 *
 * COST
 * ZERO new model/provider/network calls. Every input already exists on the assembled
 * specification. Pure: no Date/Math.random/network/dynamic import; JSON-safe;
 * hard-bounded throughout; every path fails open (returns undefined, never throws).
 * ──────────────────────────────────────────────────────────────────────────── */
import type { BuildType } from '@/lib/buildType';
import type { AppArchitectureContract } from '@/lib/appArchitecture';
import type { FrontendSpecSection, FrontendBindingRequirements } from '@/lib/webBuildAgents';
import {
  MAX_LIST, MAX_SURFACES, MAX_EVIDENCE,
  clipText, boundedList, boundBlock,
} from '@/lib/experienceIntelligenceCore';
import type {
  ExperienceLead, ExperienceDensity, ExperienceHierarchy, PrimaryInteraction, CompositionStrategy,
  VisualAnchorNeed, MediaNecessity, MediaKind, SurfaceMediaPolicy, NarrativeMode, InformationDensity,
  MotionLevel, ShadowDepth, ExperienceSignatureDirection, MediaSurfacePolicy, MediaDirection,
  ContentDirection, AboveFoldBudget, MotionBudget, VisualComplexityBudget, OptimizationDirection,
  ExperienceIntelligenceContract, ExperienceIntelligenceInput,
} from '@/lib/experienceIntelligenceCore';
import { deriveWebExperienceDirection } from '@/lib/experienceIntelligenceWeb';
import { deriveAppExperienceDirection } from '@/lib/experienceIntelligenceApp';

/* Re-export the whole shared vocabulary so every consumer imports from ONE module. */
export type {
  ExperienceLead, ExperienceDensity, ExperienceHierarchy, PrimaryInteraction, CompositionStrategy,
  VisualAnchorNeed, MediaNecessity, MediaKind, SurfaceMediaPolicy, NarrativeMode, InformationDensity,
  MotionLevel, ShadowDepth, ExperienceSignatureDirection, MediaSurfacePolicy, MediaDirection,
  ContentDirection, AboveFoldBudget, MotionBudget, VisualComplexityBudget, OptimizationDirection,
  ExperienceIntelligenceContract, ExperienceIntelligenceInput,
};
export { clipText, boundedList, boundBlock } from '@/lib/experienceIntelligenceCore';

/* ── Rendered-block ceilings ─────────────────────────────────────────────────────
 * Documented, enforced by `boundBlock`, and regression-tested against the real fixtures.
 * They were raised from an initial 2200/1500 after measurement showed those values silently
 * truncated the two things that must never be lost: the app build's fabrication policy (the
 * tail of the core block) and the optimization preservation clauses (the tail of the
 * optimization block). Both blocks now also LEAD with their binding material, so a future
 * overflow costs a tactical directive rather than a protection. */
const CORE_CHAR_CEILING = 3000;          // experience signature + media verdict + content direction
const OPTIMIZATION_CHAR_CEILING = 2700;  // preservation order + optimization strategy
const ANTI_CHAR_CEILING = 1100;          // the evidence-scoped signature ban
/** What a WEB request pays: core + optimization + anti-pattern + the web adapter tier. */
export const EXPERIENCE_INTELLIGENCE_WEB_CHAR_CEILING =
  CORE_CHAR_CEILING + OPTIMIZATION_CHAR_CEILING + ANTI_CHAR_CEILING + 1200;
/** What an APP request pays: core + optimization + anti-pattern + the app adapter tier. */
export const EXPERIENCE_INTELLIGENCE_APP_CHAR_CEILING =
  CORE_CHAR_CEILING + OPTIMIZATION_CHAR_CEILING + ANTI_CHAR_CEILING + 1200;

/** Does this lexicon fire at all? Turkish is matched WITHOUT `\b` (JS word boundaries are
 *  ASCII-only and would never fire before "ş"/"ö"/"ğ"), so both lexicons are written to be
 *  distinctive enough for substring matching. */
function matches(hay: string, re: RegExp): boolean {
  try {
    return re.test(hay);
  } catch {
    return false;
  }
}

/**
 * Count DISTINCT matched terms, not raw occurrences.
 *
 * The evidence text is the prompt plus the derived brief, and the brief routinely repeats the
 * prompt's own words — so a raw occurrence count double-counted every signal that appeared once.
 * Measured: "randevu yönetimi uygulaması" (an appointment-MANAGEMENT app) scored 2 transaction
 * hits from one word and was read as a purchase product. Distinct terms measure what the phrase
 * actually says: two different transaction words is real evidence, the same word twice is not.
 */
function distinctHits(hay: string, re: RegExp): number {
  try {
    const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
    const m = hay.match(new RegExp(re.source, flags));
    if (!m) return 0;
    return new Set(m.map((x) => x.toLowerCase())).size;
  } catch {
    return 0;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 1. MEDIA EVIDENCE
 *
 * Scored from what the request actually says, NOT from a category→preset table.
 * The same archetype with different evidence yields a different verdict: a SaaS
 * that asks for customer photography gets photography; a SaaS that asks for an API
 * and a CLI gets interface evidence and an explicit ban on stock lifestyle imagery.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * REFINEMENT signals only — deliberately NOT a classifier.
 *
 * An earlier revision of this module carried a full weighted subject lexicon (restaurant, hotel,
 * ceramics, magazine, photographer, streaming…). That was a second classification authority
 * sitting beside the site-archetype and app-type authorities, and it had the failure mode every
 * duplicate classifier has: it drifted. It was English + Turkish only, so a correctly classified
 * German request still produced the wrong medium, and every new language would have had to be
 * taught to it as well as to the real classifiers.
 *
 * The medium is now READ from the owning classification (site archetype for web, app type for an
 * app) and only refined here by the two subjects a classification genuinely cannot express:
 * whether the request asked for ILLUSTRATION rather than photography, and whether the people
 * themselves are the subject. Those are properties of the request, not of the category — a
 * restaurant that wants illustrated dishes and one that wants room photography are the same
 * archetype.
 */
interface MediaRefinement { kind: MediaKind; re: RegExp; label: string }

const MEDIA_REFINEMENTS: MediaRefinement[] = [
  {
    kind: 'illustration',
    re: /\b(illustrat(?:ion|ions|ed|or)|hand[-\s]drawn|hand[-\s]painted|mascot|character\s+design|comic|storybook)\b|illüstrasyon|çizim|maskot|karakter tasarım|illustration(?:en)?|handgezeichnet|maskottchen/i,
    label: 'the request asked for illustration rather than photography',
  },
  {
    kind: 'people-photography',
    re: /\b(portrait(?:s|ure)?|headshots?|wedding\s+photo\w*|our\s+team|team\s+(?:page|section|photos?)|staff\s+photos?|the\s+people\s+behind)\b|portre|vesikalık|ekibimiz|kadromuz|düğün fotoğraf|porträt|teamfotos?|unser team|mitarbeiterfotos?/i,
    label: 'the people themselves are the subject',
  },
];

/** Evidence that real INTERFACE/product proof beats decorative photography. */
const INTERFACE_EVIDENCE_EN = /\b(api|sdk|\bcli\b|command[-\s]line|developer(?:s)?|devtool|open[-\s]?source|library|framework|database|postgres|kubernetes|serverless|observability|ci\/cd|terminal|code\s+editor|dashboard|admin\s+panel|analytics|reporting|workflow|automation|integration|webhook|query|pipeline|internal\s+tool|crm\b|erp\b|spreadsheet|kanban|issue\s+tracker)\b/i;
const INTERFACE_EVIDENCE_TR = /(geliştirici|yazılımcı|arayüz|kod|terminal|veritabanı|yönetim paneli|panel|raporlama|iş akışı|otomasyon|entegrasyon|analitik|kütüphane|açık kaynak)/i;

/** Explicit instructions that there should be NO photography at all. */
const NO_IMAGE_EVIDENCE_EN = /\b(no\s+(?:images?|photos?|photography|pictures?)|without\s+(?:images?|photos?|photography)|text[-\s]only|typography[-\s]only|type[-\s]only|image[-\s]free|avoid\s+(?:all\s+)?(?:photographs?|photos?|photography|imagery))\b/i;
const NO_IMAGE_EVIDENCE_TR = /(görselsiz|fotoğrafsız|fotoğraf olmadan|görsel kullanma|sadece metin|sadece tipografi|stok fotoğraf istemiyorum)/i;

/** Evidence that the surface is a working tool rather than a presentation. */
const OPERATIONAL_EVIDENCE_EN = /\b(manage|track(?:ing)?|monitor|operate|assign|schedule|pipeline|records?|entries|inventory|tickets?|workflow|approve|filter|bulk\s+(?:edit|action)|admin)\b/i;
const OPERATIONAL_EVIDENCE_TR = /(yönet|takip et|izleme|atama|planla|kayıtlar|stok|talep|onayla|filtrele)/i;

/** Evidence the visitor is here to READ. */
const READING_EVIDENCE_EN = /\b(read|article|essays?|stories|longform|guides?|documentation|docs\b|blog|newsletter|research|report(?:s)?\b)\b/i;
const READING_EVIDENCE_TR = /(okuma|okuyucu|makale|köşe yazı|yazıları|rehber|dokümantasyon|blog|bülten|araştırma)/i;

/** Evidence the visitor is here to BUY / BOOK. */
const TRANSACTION_EVIDENCE_EN = /\b(buy|purchase|checkout|cart|shop|order|book(?:ing)?|reserve|reservations?|subscribe|pricing|plans?\b)\b/i;
const TRANSACTION_EVIDENCE_TR = /(satın al|sepet|sipariş|rezervasyon|randevu|abone|fiyatland|paketler)/i;

/** Explicit motion / animation appetite (and its opposite). */
const MOTION_WANTED = /\b(animat(?:ed|ion|e)|motion|parallax|cinematic|interactive\s+(?:scene|visual)|scroll[-\s]triggered|micro[-\s]interaction|hareketli|animasyon|sinematik)\b/i;
const MOTION_UNWANTED = /\b(no\s+(?:animation|motion)|without\s+(?:animation|motion)|motionless|reduce(?:d)?\s+motion|minimal\s+motion|animasyon(?:suz| olmadan)|hareketsiz|durağan)\b/i;

/** Explicitly dense/rich vs explicitly minimal appetite. */
const DENSE_WANTED = /\b(dense|information[-\s]dense|data[-\s]rich|comprehensive|detailed|packed|yoğun|detaylı|kapsamlı)\b/i;
const SPARSE_WANTED = /\b(minimal|minimalist|simple|clean|sparse|understated|one[-\s]pager?|single\s+page|sade|yalın|basit|minimalist)\b/i;

interface MediaEvidence {
  /** Subjects the classification cannot express (illustration requested, people are the subject). */
  refinements: MediaRefinement[];
  labels: string[];
  interfaceHits: number;
  noImage: boolean;
  reading: number;
  transaction: number;
  operational: number;
  motionWanted: boolean;
  motionUnwanted: boolean;
  denseWanted: boolean;
  sparseWanted: boolean;
}

/**
 * Read the evidence.
 *
 * `subjectText` = prompt + derived brief text. The brief's core idea / type / audience genuinely
 * describe the SUBJECT, so it is a legitimate second channel for subject signals.
 *
 * `promptText` = the USER'S OWN WORDS only. Every APPETITE and EXCLUSION signal below reads from
 * this channel alone, because the derived brief is machine-written and routinely contains generic
 * style adjectives ("clean", "modern", "simple"). Reading appetite from it made almost every build
 * — including a dense CRM — resolve to `sparse` density purely because an inferred brief said
 * "clean". Only what the user actually wrote may state that they want something minimal, dense,
 * animated, static, or free of photography.
 */
function readEvidence(subjectText: string, promptText: string): MediaEvidence {
  const text = subjectText;
  const refinements: MediaRefinement[] = [];
  const labels: string[] = [];
  for (const sig of MEDIA_REFINEMENTS) {
    if (matches(text, sig.re)) {
      refinements.push(sig);
      if (labels.length < MAX_EVIDENCE) labels.push(sig.label);
    }
  }
  return {
    refinements,
    labels,
    interfaceHits: distinctHits(text, INTERFACE_EVIDENCE_EN) + distinctHits(text, INTERFACE_EVIDENCE_TR),
    reading: distinctHits(text, READING_EVIDENCE_EN) + distinctHits(text, READING_EVIDENCE_TR),
    transaction: distinctHits(text, TRANSACTION_EVIDENCE_EN) + distinctHits(text, TRANSACTION_EVIDENCE_TR),
    operational: distinctHits(text, OPERATIONAL_EVIDENCE_EN) + distinctHits(text, OPERATIONAL_EVIDENCE_TR),
    /* ── User-stated appetite + exclusions: PROMPT ONLY (see the note above). ── */
    noImage: NO_IMAGE_EVIDENCE_EN.test(promptText) || NO_IMAGE_EVIDENCE_TR.test(promptText),
    motionWanted: MOTION_WANTED.test(promptText),
    motionUnwanted: MOTION_UNWANTED.test(promptText),
    denseWanted: DENSE_WANTED.test(promptText),
    sparseWanted: SPARSE_WANTED.test(promptText),
  };
}

/** The refined medium, when the request named one the classification cannot express. */
function refinedMediaKind(ev: MediaEvidence): MediaKind | undefined {
  return ev.refinements.length ? ev.refinements[0].kind : undefined;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. EXPERIENCE SIGNATURE
 * ──────────────────────────────────────────────────────────────────────────── */

/** Composition strategies the WEB archetype authority already chose, mapped onto the
 *  shared coarse axis. We MAP so the two can never contradict each other; we never
 *  re-decide the page strategy (designIntelligence owns it). */
const WEB_COMPOSITION_MAP: Record<string, CompositionStrategy> = {
  'editorial-masthead': 'sequential',
  'product-led-demonstration': 'split-asymmetric',
  'immersive-visual': 'anchored',
  'catalogue-grid-commerce': 'grid-systematic',
  'split-narrative': 'split-asymmetric',
  'dense-information-system': 'panelled',
  'typographic-minimal': 'anchored',
  'portfolio-case-study': 'sequential',
  'local-service-credibility': 'anchored',
  'storytelling-sequence': 'sequential',
  'asymmetric-art-direction': 'split-asymmetric',
};

/** App types whose surfaces are working tools rather than presentations. */
const FUNCTIONAL_APP_TYPES = new Set(['crm', 'analytics-dashboard', 'ecommerce-admin', 'productivity']);
/** App types whose value is content the user consumes. */
const CONTENT_APP_TYPES = new Set(['media-content']);

/**
 * What carries the experience.
 *
 * Read entirely from the OWNING classification (site archetype + its imagery role for web, app
 * type for an app) plus the user's own stated appetite. It contains no category lexicon of its
 * own, which is why a concise English, Turkish or German request that the classifiers understood
 * identically also gets the same lead here — the languages are taught in ONE place, upstream.
 */
function leadFor(input: ExperienceIntelligenceInput, ev: MediaEvidence): ExperienceLead {
  if (ev.noImage) return 'typography-led';

  if (input.buildType === 'app') {
    const t = input.appArchitecture?.appType;
    if (t === 'utility') return 'utility-led';
    if (t === 'analytics-dashboard') return 'data-led';
    if (t === 'crm' || t === 'ecommerce-admin') return ev.operational >= 2 ? 'data-led' : 'interface-led';
    if (t && CONTENT_APP_TYPES.has(t)) return 'editorial-led';
    if (t === 'messaging' || t === 'productivity' || t === 'booking' || t === 'fitness') return 'interface-led';
    // generic-app — the app-type authority found nothing decisive, so read the request's intent.
    if (ev.reading >= 2) return 'editorial-led';
    if (ev.operational >= 2 || ev.interfaceHits >= 2) return 'interface-led';
    return 'utility-led';
  }

  // WEB — the archetype authority's imagery role is the strongest structural signal.
  const role = input.designIntelligence?.image?.role;
  const archetype = input.designIntelligence?.archetype;
  const coverage = input.imageCoverage?.mode;
  // An editorial publication is carried by its writing unless a hard media floor says otherwise
  // (a photo-essay-led request reaches that floor through the binding/coverage authorities) — or
  // unless the request itself repeatedly describes a working INTERFACE **that is operated**. The
  // archetype lexicon matches ordinary operations vocabulary ("reporting") as journalism, so an
  // internal dashboard product could resolve to `editorial-media` and then be typed as a
  // publication before the interface evidence below was ever read. Interface hits ALONE are not
  // enough to overturn the archetype: a magazine that mentions its API and its automation would
  // clear that bar without being a tool. The override therefore also requires OPERATIONAL
  // evidence (manage / track / filter / records / approve …) — something a publication does not
  // say about itself. The archetype verdict still wins everywhere else.
  const operatedInterface = ev.interfaceHits >= 2 && ev.operational >= 1;
  if (archetype === 'editorial-media' && coverage !== 'image-led' && !operatedInterface) return 'editorial-led';
  if (coverage === 'image-led' || coverage === 'required' || role === 'central') return 'image-led';
  if (ev.reading >= 3) return 'editorial-led';
  if (archetype === 'ecommerce-brand' || archetype === 'marketplace') return 'catalogue-led';
  // A software product's site is carried by the product itself. The archetype authority already
  // decided this IS a software product, so the request need not also say "API".
  const softwareArchetype = archetype === 'developer-product' || archetype === 'saas-software' || archetype === 'ai-product';
  if (softwareArchetype || ev.interfaceHits >= 2) return 'interface-led';
  if (role === 'unnecessary' || ev.sparseWanted) return 'typography-led';
  if (role === 'supporting' && VISUAL_ARCHETYPES.has(String(archetype))) return 'image-led';
  return 'narrative-led';
}

/** Archetypes whose imagery, when the archetype authority rates it at least SUPPORTING, is
 *  what the visitor actually came to look at. Consumed, never re-derived. */
const VISUAL_ARCHETYPES = new Set<string>([
  'restaurant-hospitality', 'portfolio', 'agency-studio', 'ecommerce-brand', 'event',
]);

function densityFor(input: ExperienceIntelligenceInput, ev: MediaEvidence, lead: ExperienceLead): ExperienceDensity {
  if (ev.sparseWanted && !ev.denseWanted) return 'sparse';
  if (ev.denseWanted && !ev.sparseWanted) return 'dense';
  if (input.buildType === 'app') {
    const t = input.appArchitecture?.appType;
    if (t === 'utility') return 'sparse';
    if (t && FUNCTIONAL_APP_TYPES.has(t)) return 'dense';
    return 'measured';
  }
  const declared = input.designIntelligence?.product?.contentDensity;
  if (declared === 'high') return 'dense';
  if (declared === 'low') return 'sparse';
  if (lead === 'catalogue-led' || lead === 'data-led') return 'dense';
  if (lead === 'utility-led' || lead === 'typography-led') return 'sparse';
  return 'measured';
}

function hierarchyFor(lead: ExperienceLead, density: ExperienceDensity, buildType: BuildType): ExperienceHierarchy {
  if (lead === 'utility-led') return 'single-focus';
  if (lead === 'catalogue-led') return 'flat-scan';
  if (lead === 'data-led') return 'multi-region';
  if (lead === 'interface-led') return buildType === 'app' ? 'multi-region' : 'primary-with-support';
  if (density === 'sparse') return 'single-focus';
  return 'primary-with-support';
}

function primaryInteractionFor(input: ExperienceIntelligenceInput, ev: MediaEvidence, lead: ExperienceLead): PrimaryInteraction {
  if (input.buildType === 'app') {
    const t = input.appArchitecture?.appType;
    if (t === 'messaging') return 'converse';
    if (t === 'productivity') return 'create';
    if (t === 'media-content') return 'browse';
    if (t === 'booking') return ev.transaction >= 2 ? 'purchase' : 'operate';
    if (t === 'utility') return 'operate';
    if (t && FUNCTIONAL_APP_TYPES.has(t)) return 'operate';
    if (ev.reading >= 2) return 'read';
    if (ev.transaction >= 2) return 'purchase';
    return 'operate';
  }
  const archetype = input.designIntelligence?.archetype;
  if (archetype === 'ecommerce-brand' || archetype === 'marketplace' || ev.transaction >= 3) return 'purchase';
  if (archetype === 'editorial-media' || lead === 'editorial-led') return 'read';
  if (lead === 'catalogue-led') return 'browse';
  if (archetype === 'portfolio' || archetype === 'agency-studio') return 'explore';
  if (lead === 'interface-led' && ev.interfaceHits >= 3) return 'explore';
  return 'evaluate-and-contact';
}

function compositionFor(input: ExperienceIntelligenceInput, lead: ExperienceLead, hierarchy: ExperienceHierarchy): CompositionStrategy {
  if (input.buildType === 'web') {
    const declared = input.designIntelligence?.composition?.strategy;
    const mapped = declared ? WEB_COMPOSITION_MAP[declared] : undefined;
    if (mapped) return mapped;
  }
  if (lead === 'utility-led') return 'single-surface';
  if (lead === 'catalogue-led') return 'grid-systematic';
  if (lead === 'data-led') return 'panelled';
  if (lead === 'editorial-led' || lead === 'narrative-led') return 'sequential';
  if (lead === 'image-led') return 'anchored';
  if (lead === 'interface-led') return input.buildType === 'app' ? 'panelled' : 'split-asymmetric';
  return hierarchy === 'single-focus' ? 'anchored' : 'sequential';
}

/** Are repeated card/tile treatments the right instrument for THIS product? A `false`
 *  is never a global ban — the rendered direction says "not the default instrument
 *  here", and a genuine set of comparable peer items may still use one. */
function cardsAppropriateFor(lead: ExperienceLead, hierarchy: ExperienceHierarchy, density: ExperienceDensity): boolean {
  if (hierarchy === 'flat-scan' || hierarchy === 'multi-region') return true;
  if (lead === 'editorial-led' || lead === 'typography-led' || lead === 'utility-led') return false;
  if (density === 'sparse') return false;
  return true;
}

const CHART_EVIDENCE = /\b(chart|graph|metric|kpi|analytic|report|statistic|progress|trend|forecast|revenue|conversion\s+rate|metrik|istatistik|ilerleme|gelir)\b|grafik(?!\s*tasarım)|rapor(?:lama|u|lar)/i;

function chartsJustifiedFor(input: ExperienceIntelligenceInput, text: string, ev: MediaEvidence): boolean {
  if (CHART_EVIDENCE.test(text)) return true;
  if (input.buildType === 'app') {
    const t = input.appArchitecture?.appType;
    if (t === 'analytics-dashboard' || t === 'ecommerce-admin' || t === 'crm' || t === 'fitness') return true;
    return false;
  }
  return ev.operational >= 3;
}

function visualAnchorFor(lead: ExperienceLead, media: { necessity: MediaNecessity }, density: ExperienceDensity): VisualAnchorNeed {
  if (lead === 'image-led' || media.necessity === 'required') return 'required';
  if (lead === 'utility-led') return 'unnecessary';
  if (lead === 'typography-led' && density === 'sparse') return 'unnecessary';
  return 'beneficial';
}

const CHARACTER_BY_LEAD: Record<ExperienceLead, string> = {
  'typography-led': 'restrained and typographic — the words and the spacing carry the confidence',
  'image-led': 'photographic and atmospheric — the imagery is the argument, the chrome stays quiet',
  'interface-led': 'precise and technical — real interface evidence, tight alignment, no decoration',
  'editorial-led': 'editorial and considered — reading rhythm, measure and pacing come first',
  'catalogue-led': 'systematic and product-forward — the items are the design',
  'data-led': 'operational and legible — density with clear structure, never a decorated dashboard',
  'narrative-led': 'deliberate and progressive — each surface advances one argument',
  'utility-led': 'sharp and focused — one job, no chrome, no ornament',
};

/* ────────────────────────────────────────────────────────────────────────────
 * 3. MEDIA DIRECTION — "is an image actually useful here, and which one?"
 *
 * This is the canonical verdict for BOTH build types. It never sources, generates
 * or names an image URL, and it never lowers the required-photography FLOOR that
 * `imageCoverage` owns — a `required` coverage mode always yields `required` here.
 * ──────────────────────────────────────────────────────────────────────────── */

const PHOTOGRAPHIC_KINDS: MediaKind[] = [
  'hero-photography', 'product-photography', 'editorial-photography',
  'people-photography', 'place-photography',
];

/**
 * Which SECTIONS carry media.
 *
 * Read from the page-composition contract's per-section `mediaRole`, which is the authority that
 * already decided it. The previous implementation regex-matched section NAMES against an
 * English + Turkish word list ("hero|gallery|menu|team|galeri|menü|ekip…") — a third
 * language-dependent lexicon, with no German, deciding something another authority already owned.
 * Removing it means a new language is taught upstream once and this layer needs no words at all.
 *
 * The fallback (a build with no composition contract — a legacy or failed-open spec) is
 * deliberately conservative: the FIRST section carries the lead visual when one is required, and
 * nothing else is asserted, rather than guessing from names.
 */
function surfacesForWeb(
  sections: FrontendSpecSection[] | undefined,
  composition: ExperienceIntelligenceInput['composition'],
  necessity: MediaNecessity,
  primaryKind: MediaKind,
  leadVisual: MediaDirection['leadVisual'],
): MediaSurfacePolicy[] {
  const list = (sections || []).slice(0, MAX_SURFACES);
  const roleById = new Map<string, string>();
  for (const cs of (composition?.sections || [])) {
    const id = clipText((cs as { id?: string })?.id, 60);
    const role = clipText((cs as { mediaRole?: string })?.mediaRole, 20);
    if (id && role) roleById.set(id, role);
  }
  const supporting: SurfaceMediaPolicy = necessity === 'required' ? 'required'
    : necessity === 'beneficial' ? 'beneficial' : 'optional';

  const out: MediaSurfacePolicy[] = [];
  for (const s of list) {
    const id = clipText(s?.id, 60);
    if (!id) continue;
    if (leadVisual === 'forbidden' || necessity === 'unnecessary' || primaryKind === 'none') {
      out.push({ id, policy: 'none', kind: 'none' });
      continue;
    }
    const role = roleById.get(id);
    if (role === undefined) {
      // No composition verdict for this section: assert only the lead visual, never a guess.
      const isFirst = out.length === 0;
      out.push(isFirst && leadVisual === 'required'
        ? { id, policy: 'required', kind: primaryKind }
        : { id, policy: 'none', kind: 'none' });
      continue;
    }
    if (role === 'none') { out.push({ id, policy: 'none', kind: 'none' }); continue; }
    if (role === 'anchor') {
      out.push({ id, policy: leadVisual === 'required' ? 'required' : supporting, kind: primaryKind });
      continue;
    }
    // 'support' / 'background' — media belongs here, but it is never the required floor.
    out.push({ id, policy: supporting === 'required' ? 'beneficial' : supporting, kind: primaryKind });
  }
  return out;
}

/** Screen roles whose content genuinely benefits from imagery. */
const SCREEN_MEDIA_ROLES = new Set(['list', 'detail', 'content', 'home', 'profile']);

/** Media kinds that are attached to CONTENT ITEMS. `interface-preview`, `iconography` and
 *  `diagram` are not: in an app the interface IS the screen, so listing a screen as "carrying
 *  an interface preview" would be meaningless (and would read as an instruction to draw a
 *  picture of the app inside the app). Only these kinds produce a per-screen media policy. */
const CONTENT_BEARING_KINDS: ReadonlySet<MediaKind> = new Set<MediaKind>([
  'content-thumbnail', 'product-photography', 'people-photography',
  'place-photography', 'editorial-photography', 'illustration',
]);

function surfacesForApp(arch: AppArchitectureContract | undefined, necessity: MediaNecessity, primaryKind: MediaKind): MediaSurfacePolicy[] {
  const out: MediaSurfacePolicy[] = [];
  for (const s of (arch?.screens || []).slice(0, MAX_SURFACES)) {
    const id = clipText(s?.id, 60);
    if (!id) continue;
    const usable = SCREEN_MEDIA_ROLES.has(String(s?.role)) && CONTENT_BEARING_KINDS.has(primaryKind);
    if (!usable || necessity === 'unnecessary' || primaryKind === 'none') { out.push({ id, policy: 'none', kind: 'none' }); continue; }
    out.push({
      id,
      policy: necessity === 'required' ? 'required' : necessity === 'beneficial' ? 'beneficial' : 'optional',
      kind: primaryKind,
    });
  }
  return out;
}

/** Media requirements the user explicitly asked for (binding authority). */
function bindingMediaCount(binding: FrontendBindingRequirements | undefined): number {
  return (binding?.requirements || []).filter((r) => r && r.kind === 'media' && r.required).length;
}

/**
 * The MEDIUM, read from the owning classification.
 *
 * These are not a classifier — they are the answer to "given that the archetype authority already
 * decided this is X, what kind of picture would X's imagery even be?". Every language the product
 * supports is taught to the archetype authority once; this map never needs to know about any of
 * them. `general` is deliberately absent: an unresolved archetype falls through to the lead.
 */
const MEDIA_KIND_BY_ARCHETYPE: Record<string, MediaKind> = {
  'restaurant-hospitality': 'place-photography',
  'ecommerce-brand': 'product-photography',
  marketplace: 'product-photography',
  portfolio: 'editorial-photography',
  'agency-studio': 'editorial-photography',
  'editorial-media': 'editorial-photography',
  event: 'place-photography',
  'local-service': 'place-photography',
  education: 'people-photography',
  community: 'people-photography',
  'professional-services': 'people-photography',
  'saas-software': 'interface-preview',
  'developer-product': 'interface-preview',
  'ai-product': 'interface-preview',
};

/** The same, for the app-type authority. */
const MEDIA_KIND_BY_APP_TYPE: Record<string, MediaKind> = {
  'media-content': 'content-thumbnail',
  utility: 'iconography',
  crm: 'interface-preview',
  'analytics-dashboard': 'interface-preview',
  'ecommerce-admin': 'interface-preview',
  productivity: 'interface-preview',
  messaging: 'interface-preview',
  booking: 'interface-preview',
  fitness: 'interface-preview',
};

/** The archetype authority's imagery ROLE, mapped onto the shared necessity vocabulary. This is
 *  the primary source for a web build: it is the verdict the archetype authority already made. */
const NECESSITY_BY_IMAGERY_ROLE: Record<string, MediaNecessity> = {
  central: 'required',
  supporting: 'beneficial',
  incidental: 'optional',
  unnecessary: 'unnecessary',
};

function deriveMedia(
  input: ExperienceIntelligenceInput,
  ev: MediaEvidence,
  lead: ExperienceLead,
  chartsJustified: boolean,
): MediaDirection {
  const isApp = input.buildType === 'app';
  const explicitMedia = bindingMediaCount(input.binding);
  const coverage = input.imageCoverage;
  const evidence = boundedList([
    ...ev.labels,
    ev.interfaceHits >= 2 ? 'the request describes an interface, not a scene' : '',
    explicitMedia > 0 ? `${explicitMedia} explicit media requirement(s) in the request` : '',
    coverage && (coverage.mode === 'required' || coverage.mode === 'image-led') ? `image-coverage floor: ${coverage.mode}` : '',
    ev.noImage ? 'the request explicitly asked for no photography' : '',
  ], MAX_EVIDENCE);

  /* ── Explicit "no images". It wins outright — EXCEPT against the two authorities that own a
   * hard media FLOOR: an explicit media requirement extracted from the request itself, and the
   * image-coverage contract. Without this guard a broadly-worded exclusion could contradict a
   * floor this module does not own, and the generation request would carry two opposite
   * instructions about the same image. When a floor exists the exclusion is dropped and the
   * normal verdict below runs (the coverage authority applies its own, narrower, no-photo rule). */
  const floorOverridesExclusion = explicitMedia > 0
    || (!isApp && (coverage?.mode === 'required' || coverage?.mode === 'image-led'));
  if (ev.noImage && !floorOverridesExclusion) {
    return {
      necessity: 'unnecessary',
      leadVisual: 'forbidden',
      primaryKind: 'none',
      supportingKinds: ['iconography'],
      forbiddenKinds: [...PHOTOGRAPHIC_KINDS, 'background-media', 'illustration'],
      imageryPriority: 'none',
      surfaces: isApp ? surfacesForApp(input.appArchitecture, 'unnecessary', 'none') : surfacesForWeb(input.sections, input.composition, 'unnecessary', 'none', 'forbidden'),
      strongerWithoutMedia: [
        'The request asked for no photography: carry the first viewport with type, scale, spacing and colour.',
        'Where an image would have gone, use real structured content (a list, a table, a specimen, a quote) — not a gradient placeholder.',
      ],
      rationale: 'The request explicitly excluded photography, so every visual decision is carried by typography, layout and colour.',
      evidence,
      deferralNote: 'imageCoverage owns the required floor; visualConcept owns per-image art direction.',
      vocabularyOwnedElsewhere: false,
    };
  }

  /* ── Necessity, read from the OWNING authority for this build type, then raised (never
   *    lowered) by the hard floors. Web: the archetype authority already rated imagery
   *    central/supporting/incidental/unnecessary — that IS the verdict, so it is consumed rather
   *    than recomputed from a second lexicon. App: the app visual adapter already decided whether
   *    photography suits this product class. ── */
  const archetype = String(input.designIntelligence?.archetype || '');
  const appType = String(input.appArchitecture?.appType || '');
  let necessity: MediaNecessity;
  if (isApp) {
    if (appType === 'media-content') necessity = 'beneficial';          // the catalogue IS the product
    else if (input.appVisual?.imageStrategy?.usePhotography === false) {
      necessity = ev.interfaceHits >= 1 || lead === 'data-led' || lead === 'interface-led' ? 'beneficial' : 'optional';
    } else necessity = 'optional';
  } else {
    const role = input.designIntelligence?.image?.role;
    necessity = (role && NECESSITY_BY_IMAGERY_ROLE[role]) || (ev.interfaceHits >= 2 ? 'beneficial' : 'optional');
  }

  if (explicitMedia > 0) necessity = 'required';
  if (!isApp && coverage) {
    if (coverage.mode === 'image-led' || coverage.mode === 'required') necessity = 'required';
    else if (coverage.mode === 'none') necessity = 'unnecessary';
  }

  /* ── Primary medium. CLASSIFICATION first (the archetype / app-type authority already knows
   *    what this product is, in every language it supports), then the LEAD when the
   *    classification was not decisive, then the request's own REFINEMENT when it named a
   *    subject no category can express (illustration, or the people themselves). ── */
  let primaryKind: MediaKind = (isApp ? MEDIA_KIND_BY_APP_TYPE[appType] : MEDIA_KIND_BY_ARCHETYPE[archetype]) || 'none';
  if (primaryKind === 'none') {
    if (lead === 'interface-led' || lead === 'data-led') primaryKind = 'interface-preview';
    else if (lead === 'utility-led') primaryKind = 'iconography';
    else if (lead === 'editorial-led') primaryKind = 'editorial-photography';
    else if (lead === 'catalogue-led') primaryKind = 'product-photography';
    else if (lead === 'image-led' || necessity === 'required') primaryKind = 'hero-photography';
    else primaryKind = 'iconography';
  }
  const refined = refinedMediaKind(ev);
  // A refinement never overrides an INTERFACE medium: "our team" on a devtool site adds a team
  // photo, it does not make the product's evidence photographic.
  if (refined && primaryKind !== 'interface-preview') primaryKind = refined;
  // …but an EXPLICIT media requirement extracted from the request does. When the user asks a
  // software product for photography, the category default (a product screenshot) is no longer
  // the primary medium — the thing they asked to see is. The subject is not re-classified here:
  // the binding authority owns what was asked for, and the interface evidence stays as support.
  if (explicitMedia > 0 && (primaryKind === 'interface-preview' || primaryKind === 'iconography')) {
    primaryKind = refined || 'hero-photography';
  }

  /* ── Lead visual. An app NEVER inherits a marketing hero requirement. ── */
  let leadVisual: MediaDirection['leadVisual'];
  if (isApp) {
    const t = input.appArchitecture?.appType;
    const functional = !!t && (FUNCTIONAL_APP_TYPES.has(t) || t === 'utility');
    leadVisual = functional ? 'forbidden' : (necessity === 'required' ? 'required' : 'optional');
  } else if (coverage?.heroRequired || explicitMedia > 0) {
    // A REQUIRED lead visual is a hard build instruction, so it may only come from the authority
    // that also owns the floor and the sourcing: the image-coverage contract, or an explicit
    // media requirement in the request. A high NECESSITY on its own says imagery matters here —
    // it must not conscript a hero image that nothing downstream is going to source, which would
    // leave the builder with a required slot it can only fill with a placeholder.
    leadVisual = 'required';
  } else {
    // A web build without a REQUIRED coverage floor never forces a lead image: the page may
    // still open with one when the design calls for it, so this stays 'optional' rather than
    // becoming a soft ban that would fight the image-coverage authority.
    leadVisual = 'optional';
  }

  /* ── Supporting + forbidden kinds. ── */
  const supporting: MediaKind[] = [];
  if (primaryKind !== 'iconography') supporting.push('iconography');
  if (chartsJustified) supporting.push('diagram');
  if (lead === 'interface-led' && primaryKind !== 'interface-preview') supporting.push('interface-preview');
  if (primaryKind === 'interface-preview') supporting.push('diagram');
  if (lead === 'editorial-led' && primaryKind !== 'editorial-photography') supporting.push('editorial-photography');

  const forbidden: MediaKind[] = [];
  if (lead === 'interface-led' || lead === 'data-led' || lead === 'utility-led') {
    forbidden.push('hero-photography', 'background-media');
    if (!ev.refinements.some((r) => r.kind === 'people-photography')) forbidden.push('people-photography');
  }
  if (isApp) {
    const t = input.appArchitecture?.appType;
    if (t && (FUNCTIONAL_APP_TYPES.has(t) || t === 'utility')) forbidden.push('hero-photography', 'background-media', 'place-photography');
  }
  if (necessity === 'optional' && primaryKind === 'iconography') forbidden.push('background-media');
  if (!chartsJustified) forbidden.push('diagram');

  const imageryPriority: MediaDirection['imageryPriority'] =
    necessity === 'required' ? 'lead'
      : necessity === 'beneficial' ? 'support'
        : necessity === 'optional' ? 'incidental' : 'none';

  const strongerWithoutMedia = boundedList([
    lead === 'interface-led' || lead === 'data-led'
      ? 'A real, labelled interface (a table, a query, a result, a state change) proves more here than any photograph — build the evidence, do not photograph it.'
      : '',
    lead === 'typography-led' || lead === 'editorial-led'
      ? 'Where an image would only decorate, use type scale, measure and whitespace instead — a decorative photograph weakens an editorial surface.'
      : '',
    necessity === 'optional'
      ? 'Media is optional here: add an image only where it answers a question the copy cannot. Never add one to fill a gap.'
      : '',
    'Never use an abstract gradient, blurred blob or generic 3D shape as a stand-in for a missing image.',
  ], 4, 240);

  const rationale = clipText(
    necessity === 'required'
      ? `Imagery is core to this product (${primaryKind.replace(/-/g, ' ')}): the request is about something real that must be seen.`
      : necessity === 'beneficial'
        ? `Imagery helps but is not the argument: ${primaryKind.replace(/-/g, ' ')} supports the content rather than carrying it.`
        : necessity === 'unnecessary'
          ? 'This product does not need photography; its evidence is structural, not pictorial.'
          : `Imagery is optional here — use ${primaryKind.replace(/-/g, ' ')} only where it earns its place.`,
    240,
  );

  return {
    necessity,
    leadVisual,
    primaryKind,
    supportingKinds: boundedList(supporting, 4) as MediaKind[],
    forbiddenKinds: boundedList(forbidden, 5) as MediaKind[],
    imageryPriority,
    surfaces: isApp ? surfacesForApp(input.appArchitecture, necessity, primaryKind) : surfacesForWeb(input.sections, input.composition, necessity, primaryKind, leadVisual),
    strongerWithoutMedia,
    rationale,
    evidence,
    deferralNote: isApp
      ? 'The app visual adapter owns per-screen visual treatment; this verdict decides whether media belongs at all.'
      : 'imageCoverage owns the required photography floor; visualConcept owns per-image art direction. This verdict never lowers that floor.',
    // A web build whose Design Intelligence already carries subject guidance / crop roles /
    // forbidden treatments owns the imagery VOCABULARY; we then render only the verdict.
    vocabularyOwnedElsewhere: !isApp && !!input.designIntelligence?.image?.subjectGuidance?.length,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4. CONTENT DIRECTION
 *
 * Content ROLES and STRUCTURE only. Never facts. "a pricing structure is required"
 * is a valid decision; "the Pro plan costs $29" is not, and `factualPolicy` says so
 * explicitly for every slot the request did not supply.
 *
 * For a WEB build the structural roles are ALREADY owned by designIntelligence's
 * content architecture — we adopt them and set `rolesOwnedElsewhere`, so the
 * rendered block never restates a list the request already carries.
 * ──────────────────────────────────────────────────────────────────────────── */

/** The information a product of this class must genuinely model. STRUCTURE, never data. */
const APP_CONTENT_ROLES: Record<string, string[]> = {
  crm: [
    'a person/company record model carrying the fields a salesperson actually decides on',
    'a pipeline stage vocabulary that means something for this business',
    'an activity history with real timestamps and authorship',
  ],
  'analytics-dashboard': [
    'a metric definition for every number shown (what it measures, over what period)',
    'a comparison basis (previous period / target) so a number can be read as good or bad',
    'a breakdown dimension the user can actually segment by',
  ],
  'ecommerce-admin': [
    'an order model with status, line items and a customer reference',
    'a product/inventory model with the attributes that drive a stock decision',
    'a fulfilment state vocabulary',
  ],
  fitness: [
    'a programme/session model with real exercise or activity names',
    'a progress history the user can read a trend from',
    'a personal target the progress is measured against',
  ],
  booking: [
    'a bookable resource model (service, staff member, table, room) with duration',
    'an availability model with real time slots',
    'a confirmation summary carrying everything the user just committed to',
  ],
  productivity: [
    'a task/item model with the attributes this workflow actually sorts and filters by',
    'a grouping vocabulary (project, list, status) that matches the request',
    'a completion state that changes what the user sees',
  ],
  messaging: [
    'a conversation model with participants and a last-activity time',
    'a message model with author, time and read state',
    'an unread/notification state that is genuinely derived, not decorative',
  ],
  'media-content': [
    'a content item model with title, creator, duration/length and a real description',
    'a browse taxonomy (shelf, category, collection) that reflects the catalogue',
    'a saved/continue state the user can return to',
  ],
  utility: [
    'the input vocabulary and units the calculation actually needs',
    'a result presentation that shows how the answer was reached',
  ],
  'generic-app': [
    'the primary record model this product is about, with the fields the user decides on',
    'the state vocabulary that changes what the user sees',
  ],
};

const APP_NEVER_FABRICATE = [
  'a real user account, sign-in, session or identity',
  'a real backend, sync, notification, email or payment',
  'another person’s real records, messages or history presented as genuine',
];

function narrativeModeFor(lead: ExperienceLead, interaction: PrimaryInteraction, buildType: BuildType): NarrativeMode {
  if (buildType === 'app') return interaction === 'read' || interaction === 'browse' ? 'informational' : 'operational';
  if (lead === 'editorial-led' || interaction === 'read') return 'editorial';
  if (interaction === 'purchase' || lead === 'catalogue-led') return 'transactional';
  if (lead === 'interface-led' || lead === 'data-led') return 'instructional';
  if (lead === 'utility-led') return 'operational';
  return 'persuasive';
}

function deriveContent(
  input: ExperienceIntelligenceInput,
  lead: ExperienceLead,
  density: ExperienceDensity,
  interaction: PrimaryInteraction,
  media: MediaDirection,
  chartsJustified: boolean,
): ContentDirection {
  const isApp = input.buildType === 'app';
  const di = input.designIntelligence;
  const informationDensity: InformationDensity = density === 'dense' ? 'high' : density === 'sparse' ? 'low' : 'medium';

  const webRoles = !isApp ? boundedList(di?.content?.requiredContent || [], MAX_LIST, 200) : [];
  const rolesOwnedElsewhere = webRoles.length > 0;
  const appType = input.appArchitecture?.appType || 'generic-app';
  const requiredContentRoles = rolesOwnedElsewhere
    ? webRoles
    : boundedList(isApp ? (APP_CONTENT_ROLES[appType] || APP_CONTENT_ROLES['generic-app']) : [
      'a concrete statement of what this is and who it is for, in the first viewport',
      'the real substance of the offer, described specifically enough to be checked',
      'one honest next step with everything the visitor needs to take it',
    ], MAX_LIST, 200);

  const optionalContentRoles = boundedList(isApp ? [
    'an empty state that explains what to do next, for every collection that can be empty',
    'an error/failed state that says what went wrong in the product’s own words',
  ] : [
    interaction === 'evaluate-and-contact' ? 'a credibility surface that uses only material the request actually supplied' : '',
    lead === 'editorial-led' ? 'an index or archive surface so the catalogue of writing is browsable' : '',
  ], 4, 200);

  const avoidPatterns = boundedList([
    interaction !== 'purchase' && !/pricing|plans?|subscri|fiyat|abone/i.test(input.prompt || '')
      ? 'a pricing/plan comparison this product was never described as having'
      : '',
    'a testimonial or logo wall built from invented customers',
    'a statistics band whose numbers were invented to look impressive',
    !chartsJustified ? 'a decorative dashboard, chart or gauge that measures nothing real' : '',
    isApp ? 'marketing sections (feature grids, testimonials, pricing) inside a working application' : '',
    !isApp && lead === 'interface-led' ? 'generic "powerful / seamless / effortless" capability cards in place of real product evidence' : '',
    media.necessity === 'unnecessary' ? 'placeholder image frames standing in for images this product does not need' : '',
  ], 6, 200);

  const factualSlots = rolesOwnedElsewhere
    ? boundedList(di?.content?.factualSlots || [], MAX_LIST, 120)
    : boundedList(isApp ? [
      'record names, values, dates, counts and history shown inside the app',
    ] : [
      'names, prices, dates, addresses, credentials and counts the copy refers to',
    ], 4, 160);

  const factualPolicy = rolesOwnedElsewhere && di?.content?.factualPolicy
    ? clipText(di.content.factualPolicy, 240)
    : isApp
      ? 'Any record the request did not supply is SAMPLE local data. Populate it with plausible, clearly-sample content and label it as sample — never present it as a real user’s data, and never fabricate a real person, company or transaction.'
      : 'Any fact the request did not supply stays a neutrally-labelled slot. Never invent a price, a date, an address, a credential or a customer to fill it.';

  const additionalNeverFabricate = boundedList(
    isApp ? APP_NEVER_FABRICATE : (di?.content?.additionalNeverFabricate || []),
    6, 200,
  );

  return {
    narrativeMode: narrativeModeFor(lead, interaction, input.buildType),
    informationDensity,
    requiredContentRoles,
    optionalContentRoles,
    avoidPatterns,
    factualSlots,
    factualPolicy,
    additionalNeverFabricate,
    rolesOwnedElsewhere,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 5. OPTIMIZATION DIRECTION — decided WITH the experience, never against it.
 * ──────────────────────────────────────────────────────────────────────────── */

/** The binding conflict-resolution order. Index 0 wins. Stated once, here, and
 *  carried into generation, the deterministic optimization pass and the repair. */
export const OPTIMIZATION_PRIORITY_ORDER: string[] = [
  '1. product & experience correctness — the product must still be what was asked for',
  '2. visual quality & hierarchy — the design must still read as intentional',
  '3. usability & accessibility — it must still be operable and legible',
  '4. performance & payload — only then, make it lighter',
  '5. implementation cleanliness — last, and never at the cost of the four above',
];

function motionBudgetFor(ev: MediaEvidence, lead: ExperienceLead, density: ExperienceDensity, buildType: BuildType): MotionBudget {
  let level: MotionLevel;
  if (ev.motionUnwanted) level = 'none';
  else if (buildType === 'app') level = 'minimal';
  else if (ev.motionWanted) level = 'expressive';
  else if (lead === 'utility-led' || lead === 'data-led' || lead === 'interface-led') level = 'minimal';
  else if (lead === 'editorial-led' || density === 'sparse') level = 'restrained';
  else level = 'restrained';
  const maxSimultaneousAnimations = level === 'none' ? 0 : level === 'minimal' ? 1 : level === 'restrained' ? 2 : 3;
  const note = level === 'none'
    ? 'The request asked for no animation: use state changes and transitions of ≤150ms only, nothing decorative.'
    : level === 'minimal'
      ? 'Motion is functional only — it explains a state change (open, switch, select, load). Nothing loops, nothing scrolls on its own.'
      : level === 'restrained'
        ? 'One deliberate signature moment plus short functional transitions. No autoplaying loops, no motion on elements the user is trying to read.'
        : 'Motion is part of the argument here, but it stays purposeful: one signature scene, entrance choreography where it aids comprehension, and nothing that blocks reading or interaction.';
  return { level, maxSimultaneousAnimations, note };
}

function visualComplexityFor(lead: ExperienceLead, density: ExperienceDensity, ev: MediaEvidence): VisualComplexityBudget {
  const austere = lead === 'utility-led' || lead === 'data-led' || lead === 'interface-led';
  const maxBlurLayers = austere ? 0 : ev.motionWanted || lead === 'image-led' ? 2 : 1;
  const shadowDepth: ShadowDepth = austere ? 'flat' : density === 'sparse' ? 'subtle' : 'subtle';
  return {
    maxBlurLayers,
    shadowDepth,
    note: maxBlurLayers === 0
      ? 'No backdrop blur and no stacked glows: depth comes from spacing, borders and value contrast. A blur layer over a working surface costs paint time and buys nothing.'
      : `At most ${maxBlurLayers} blurred/backdrop layer in the whole build, and ${shadowDepth} elevation — depth should come from spacing and contrast before it comes from effects.`,
  };
}

function deriveOptimization(
  input: ExperienceIntelligenceInput,
  ev: MediaEvidence,
  lead: ExperienceLead,
  density: ExperienceDensity,
  media: MediaDirection,
  chartsJustified: boolean,
): OptimizationDirection {
  const isApp = input.buildType === 'app';
  const hasMedia = media.necessity !== 'unnecessary' && media.primaryKind !== 'none' && media.primaryKind !== 'iconography';
  const motion = motionBudgetFor(ev, lead, density, input.buildType);

  const imageStrategy = !hasMedia
    ? 'This build needs no photographic payload: do not introduce remote image requests, decorative background images or placeholder image services at all.'
    : media.necessity === 'required'
      ? 'Request every image at the size it actually renders (the lead visual at most ~1600px wide, in-flow images at most ~1000px). Never request a 2000px+ source for a thumbnail, and never resize a supplied, pre-approved source URL away.'
      : 'Request each image at the size of the box it renders in. Prefer one strong image over several weak ones.';

  const responsiveMedia = !hasMedia
    ? 'Not applicable — there is no media payload to size.'
    : 'Give every image an intrinsic width/height or an aspect-ratio box so nothing reflows while loading, and use a smaller source below 768px rather than downscaling a desktop asset on the phone.';

  const lazyLoading: OptimizationDirection['lazyLoading'] = !hasMedia
    ? 'not-applicable'
    : (media.leadVisual === 'required' ? 'below-fold' : 'all-non-lead');

  const aboveFold: AboveFoldBudget = {
    maxMediaAssets: !hasMedia ? 0 : media.leadVisual === 'required' ? 1 : isApp ? 0 : 1,
    maxAnimatedLayers: motion.maxSimultaneousAnimations === 0 ? 0 : 1,
    note: isApp
      ? 'The entry screen must reach a usable, readable state without waiting on media: real content first, imagery after.'
      : 'The first viewport carries at most one eagerly-loaded image and one animated layer. Everything below it loads lazily.',
  };

  const mobileSimplification = boundedList([
    density === 'dense'
      ? 'On a narrow screen, reduce the number of simultaneous regions rather than shrinking every one of them — move secondary regions behind a control instead of stacking six dense blocks.'
      : 'On a narrow screen, keep the same hierarchy but increase spacing and type size rather than compressing the desktop layout.',
    isApp
      ? 'Below 768px the shell adapts (sidebar → drawer or bottom tabs); the primary action stays reachable with one thumb.'
      : 'Below 768px the navigation becomes a real, operable control and the primary action stays reachable without scrolling back up.',
    hasMedia ? 'Drop purely decorative imagery on narrow screens before you drop content or controls.' : '',
    motion.level === 'none' ? '' : 'Reduce motion further on narrow screens, and honour prefers-reduced-motion everywhere.',
    chartsJustified ? 'A chart that cannot be read at 390px becomes a compact summary with the same numbers — never a horizontally scrolling wall.' : '',
  ], 5, 240);

  /* ── What optimization may never touch. This is the concrete data the deterministic
   *    optimization pass and the repair-authority digest enforce. ── */
  const primaryCta = clipText(input.primaryCTA, 60);
  const protectedElements = boundedList([
    isApp
      ? 'the primary navigation and every route it targets (an app whose navigation is trimmed is broken, not faster)'
      : `the primary call to action${primaryCta ? ` ("${primaryCta}")` : ''} and the navigation that reaches it`,
    isApp
      ? 'the product-defining interaction on every screen (control → handler → state → visible consequence)'
      : 'every interactive experience the request explicitly asked for',
    media.necessity === 'required' || media.leadVisual === 'required'
      ? 'every required image: it may be resized or lazily loaded, never removed or replaced with a placeholder'
      : '',
    isApp
      ? 'every planned screen and its distinct composition'
      : 'every planned section and its distinct composition',
    ...(input.binding?.requirements || [])
      .filter((r) => r && r.required && (r.kind === 'interactive-experience' || r.kind === 'section' || r.kind === 'behavior-navigation'))
      .slice(0, 3)
      .map((r) => `the explicitly requested "${clipText(r.label, 60)}"`),
  ], 7, 200);

  const protectedMediaSlotIds = boundedList([
    ...((input.imageCoverage?.targets || []).filter((t) => t && t.required).map((t) => clipText(t.slotId || t.id, 80))),
    ...((input.imageSlots || []).filter((s) => s && !!s.url).map((s) => clipText(s.id, 80))),
  ], 10, 80);

  return {
    imageStrategy,
    responsiveMedia,
    lazyLoading,
    aboveFold,
    motion,
    visualComplexity: visualComplexityFor(lead, density, ev),
    mobileSimplification,
    dependencyPolicy:
      'Build with what the runtime already provides (React, Tailwind, the installed Radix/lucide/framer-motion/recharts set). Do NOT introduce a new package — the runtime import allowlist rejects it and the build fails. A carousel, chart, date picker, icon or animation is not a reason to add a dependency.',
    domPolicy:
      'Do not wrap elements in attribute-less containers that carry no class, style or handler. Depth in the tree must buy layout, grouping or behaviour — nothing else.',
    priorityOrder: OPTIMIZATION_PRIORITY_ORDER,
    protectedElements,
    protectedFiles: boundedList(input.requiredComponentFiles || [], 24, 200),
    protectedMediaSlotIds,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 6. GENERIC AI-DESIGN SIGNATURES
 *
 * Scoped by evidence, never banned globally. A centred hero over a gradient is a
 * fine answer for a launch campaign; it is a failure for a journal, a devtool or a
 * working application. Each entry below is emitted ONLY when this build's own
 * evidence says the pattern would be wrong here.
 * ──────────────────────────────────────────────────────────────────────────── */
function avoidSignaturesFor(
  buildType: BuildType,
  lead: ExperienceLead,
  hierarchy: ExperienceHierarchy,
  density: ExperienceDensity,
  cardsAppropriate: boolean,
  chartsJustified: boolean,
  media: MediaDirection,
  ev: MediaEvidence,
): string[] {
  const shared: string[] = [
    'an abstract gradient blob, glow or generic 3D shape used as a stand-in for artwork this build does not have',
    !chartsJustified ? 'a chart, gauge or dashboard whose numbers were invented so the surface would look substantial' : '',
    !cardsAppropriate ? 'a row of identical rounded cards used because a layout was needed, not because the items are peers' : '',
    density === 'sparse' ? 'vast empty bands of whitespace that hold nothing and only postpone the content' : '',
  ];

  if (buildType === 'app') {
    return boundedList([
      ...shared,
      media.leadVisual === 'forbidden' ? 'a marketing hero, oversized display headline or landing-page banner at the top of a working screen' : '',
      !chartsJustified ? 'a wall of KPI tiles across the top of every screen regardless of what the screen is for' : '',
      hierarchy !== 'flat-scan' ? 'card soup — every block wrapped in the same bordered, rounded container so nothing reads as dominant' : '',
      'the default AI-SaaS shape (purple/blue gradient, left sidebar, three KPI tiles, a chart) applied to a product that is not that',
      'badge/pill chips scattered on headings and rows to add visual interest they do not earn',
    ], 7, 200);
  }

  return boundedList([
    ...shared,
    lead !== 'narrative-led' || ev.sparseWanted
      ? 'a centred hero headline over a glowing gradient, with two buttons and nothing else in the first viewport'
      : '',
    lead === 'interface-led' || lead === 'editorial-led'
      ? 'a three- or four-card "features" grid of generic capability claims standing in for real product evidence'
      : '',
    'mirrored 50/50 split sections repeated down the page with the image simply alternating sides',
    'a fabricated product dashboard screenshot presented as if it were the real interface',
    density !== 'dense' ? 'pill badges and icon chips attached to every heading, row and card' : '',
    'the same section rhythm (eyebrow → heading → paragraph → three cards) reused for every section on the page',
  ], 8, 200);
}

/* ────────────────────────────────────────────────────────────────────────────
 * 7. DERIVATION (the single entry point)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Derive the canonical Experience Intelligence contract. Pure, deterministic,
 * network-free, bounded, JSON-serializable and FAIL-OPEN — any problem returns
 * `undefined` and the specification simply omits the field (legacy behaviour).
 *
 * `web` and `app` are mutually exclusive by construction: the adapter for the OTHER
 * build type is never derived, so web direction can never reach an app request and
 * app direction can never reach a web request.
 */
export function deriveExperienceIntelligence(
  input: ExperienceIntelligenceInput,
): ExperienceIntelligenceContract | undefined {
  try {
    if (!input || (input.buildType !== 'web' && input.buildType !== 'app')) return undefined;
    const promptText = clipText(input.prompt, 1600);
    const text = `${promptText} ${clipText(input.briefText, 400)}`.slice(0, 2000);

    const ev = readEvidence(text, promptText);
    const lead = leadFor(input, ev);
    const density = densityFor(input, ev, lead);
    const hierarchy = hierarchyFor(lead, density, input.buildType);
    const primaryInteraction = primaryInteractionFor(input, ev, lead);
    const composition = compositionFor(input, lead, hierarchy);
    const chartsJustified = chartsJustifiedFor(input, text, ev);
    const cardsAppropriate = cardsAppropriateFor(lead, hierarchy, density);

    const media = deriveMedia(input, ev, lead, chartsJustified);
    const content = deriveContent(input, lead, density, primaryInteraction, media, chartsJustified);
    const optimization = deriveOptimization(input, ev, lead, density, media, chartsJustified);

    const archetypeRef: ExperienceSignatureDirection['archetypeRef'] = input.buildType === 'app'
      ? (input.appArchitecture?.appType
        ? { value: input.appArchitecture.appType, owner: 'appArchitecture' }
        : { value: clipText(input.identity?.siteType, 60) || 'application', owner: 'identity' })
      : (input.designIntelligence?.archetype
        ? { value: input.designIntelligence.archetype, owner: 'designIntelligence' }
        : { value: clipText(input.identity?.siteType, 60) || 'adaptive', owner: input.identity?.siteType ? 'identity' : 'adaptive' });

    const experience: ExperienceSignatureDirection = {
      lead,
      visualCharacter: CHARACTER_BY_LEAD[lead],
      density,
      hierarchy,
      primaryInteraction,
      composition,
      visualAnchor: visualAnchorFor(lead, media, density),
      cardsAppropriate,
      chartsJustified,
      archetypeRef,
      rationale: clipText(
        `${lead.replace(/-/g, ' ')} at ${density} density, ${hierarchy.replace(/-/g, ' ')} hierarchy, because the user's primary act is to ${primaryInteraction.replace(/-/g, ' ')}.`,
        240,
      ),
      evidence: boundedList([
        ...ev.labels,
        ev.interfaceHits >= 2 ? 'interface/product vocabulary dominates the request' : '',
        ev.reading >= 2 ? 'the request is about material to read' : '',
        ev.transaction >= 2 ? 'the request is about a purchase or booking' : '',
        ev.operational >= 2 ? 'the request is about operating on records' : '',
        ev.sparseWanted ? 'minimal/simple was explicitly asked for' : '',
        ev.denseWanted ? 'dense/comprehensive was explicitly asked for' : '',
      ], MAX_EVIDENCE),
    };

    const contract: ExperienceIntelligenceContract = {
      version: 'experience-intelligence-v1',
      buildType: input.buildType,
      experience,
      media,
      content,
      optimization,
      avoidSignatures: avoidSignaturesFor(input.buildType, lead, hierarchy, density, cardsAppropriate, chartsJustified, media, ev),
    };

    if (input.buildType === 'web') {
      const web = deriveWebExperienceDirection({ experience, media, content, input });
      if (web) contract.web = web;
    } else {
      const app = deriveAppExperienceDirection({ experience, media, content, input });
      if (app) contract.app = app;
    }

    return contract;
  } catch {
    return undefined;
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 8. GENERATION BLOCKS
 *
 * Rendered as SEPARATE tiers so each carries its honest priority in the request
 * builder's budget-shedding order:
 *   P1  core       — what carries this experience, and whether media belongs at all
 *   P2  adapter    — the web page / app surface translation of that decision
 *   P3  optimize   — the optimization strategy (performance is 4th in the priority order)
 *   P4  anti       — the evidence-scoped generic-signature ban (first to be shed)
 *
 * Each block DEFERS to the owning authority instead of restating it, so adding this
 * layer does not multiply the request. In particular the web content roles are
 * rendered by designIntelligence and are deliberately NOT repeated here.
 * ──────────────────────────────────────────────────────────────────────────── */

const kindLabel = (k: MediaKind): string => k.replace(/-/g, ' ');

/** P1 — the experience signature + the canonical media verdict + the content roles
 *  this module actually owns. */
export function renderExperienceCoreBlock(contract: ExperienceIntelligenceContract | undefined): string[] {
  if (!contract) return [];
  const { experience: x, media: m, content: c } = contract;
  const lines: string[] = [
    `EXPERIENCE DIRECTION (experience-intelligence-v1 · ${contract.buildType} · ${x.archetypeRef.owner}: ${x.archetypeRef.value}):`,
    `This experience is ${x.lead.replace(/-/g, ' ')} — ${x.visualCharacter}.`,
    `Density: ${x.density}. Hierarchy: ${x.hierarchy.replace(/-/g, ' ')}. The user is here to ${x.primaryInteraction.replace(/-/g, ' ')}. Composition strategy: ${x.composition.replace(/-/g, ' ')}.`,
    `Strong visual anchor: ${x.visualAnchor}.`,
    x.cardsAppropriate
      ? 'Repeated card/tile treatments are appropriate here — but only for genuinely comparable peer items, and not as the answer to every section.'
      : 'A repeated card/tile grid is NOT the right instrument for this product. Use it only if a set of genuinely comparable peer items exists; otherwise compose with type, rules, lists or a real working surface.',
    x.chartsJustified
      ? 'Charts/metrics are justified by this product — every number must be defined and derived from the local data, never invented.'
      : 'Charts, gauges and dashboard tiles are NOT justified by this product. Do not add one for visual weight — an invented metric is a fabrication.',
    '',
    `MEDIA VERDICT — imagery is ${m.necessity.toUpperCase()} for this product (${m.imageryPriority} priority).`,
    `Primary medium: ${kindLabel(m.primaryKind)}. ${m.rationale}`,
    // Media VOCABULARY (which subjects, which treatments) is rendered here only when no other
    // authority owns it — on a web build the image-intent tier already states subject guidance,
    // crop roles and forbidden treatments, and repeating them would send two overlapping lists.
    ...(m.vocabularyOwnedElsewhere ? [
      'The image-intent direction elsewhere in this request states the subjects, crops and forbidden',
      'treatments; it is authoritative for those. This verdict is authoritative for WHETHER media is',
      'needed, which surfaces carry it, and where type or a real working surface is the stronger answer.',
    ] : [
      m.supportingKinds.length ? `Supporting media: ${m.supportingKinds.map(kindLabel).join(', ')}.` : '',
      m.forbiddenKinds.length ? `WRONG for this product: ${m.forbiddenKinds.map(kindLabel).join(', ')}.` : '',
    ]),
    ...m.strongerWithoutMedia.map((s) => `- ${s}`),
    m.surfaces.some((s) => s.policy !== 'none')
      ? `Media belongs on: ${m.surfaces.filter((s) => s.policy !== 'none').map((s) => `${s.id} (${s.policy})`).join(', ')}. Every other surface carries no image.`
      : 'No surface in this build needs a photograph.',
    m.deferralNote,
    '',
  ];

  /* Content roles are rendered ONLY when this module owns them (every app build, and a
   * web build with no design-intelligence content architecture). When designIntelligence
   * already states them, repeating them here would be a second authority saying the same
   * thing and would grow the request for nothing. */
  if (!c.rolesOwnedElsewhere) {
    lines.push(
      `CONTENT DIRECTION — ${c.narrativeMode} register at ${c.informationDensity} information density.`,
      'This product must genuinely carry the following. These are STRUCTURAL obligations — they are',
      'never an instruction to invent the facts inside them:',
      ...c.requiredContentRoles.map((r) => `- ${r}`),
      // The truth boundary is stated BEFORE the optional extras: if the ceiling ever bites, it
      // must cost a "worth adding" suggestion, never the rule about what may not be invented.
      ...(c.factualSlots.length ? [`Facts these structures need: ${c.factualSlots.join('; ')}.`] : []),
      c.factualPolicy,
      ...(c.additionalNeverFabricate.length
        ? [`NEVER invent, in addition to the honesty rules below: ${c.additionalNeverFabricate.join('; ')}.`]
        : []),
      ...(c.optionalContentRoles.length ? [`Worth adding where the request supports it: ${c.optionalContentRoles.join('; ')}.`] : []),
      '',
    );
  }
  if (c.avoidPatterns.length) {
    lines.push(
      'Content shapes that would be FILLER for this specific product — do not produce them:',
      ...c.avoidPatterns.map((p) => `- ${p}`),
      '',
    );
  }
  return boundBlock(lines.filter((l) => l !== ''), CORE_CHAR_CEILING).concat('');
}

/** P3 — the optimization strategy, including the binding rule that an optimization
 *  which damages a higher-order goal is REJECTED rather than applied. */
export function renderExperienceOptimizationBlock(contract: ExperienceIntelligenceContract | undefined): string[] {
  if (!contract) return [];
  const o = contract.optimization;
  const lines: string[] = [
    'OPTIMIZATION STRATEGY (decided with the design, not after it). Build it right the first time.',
    'OPTIMIZATION IS NEVER ALLOWED TO DAMAGE THE PRODUCT. When two goals conflict, this order decides:',
    ...o.priorityOrder.map((p) => `  ${p}`),
    'Never remove, weaken or replace with a placeholder:',
    ...o.protectedElements.map((p) => `  - ${p}`),
    'Within those limits:',
    `- Images: ${o.imageStrategy}`,
    `- Responsive media: ${o.responsiveMedia}`,
    o.lazyLoading === 'not-applicable'
      ? '- Loading: no media payload to defer.'
      : o.lazyLoading === 'below-fold'
        ? '- Loading: the lead visual loads eagerly (it is the first paint); every other image gets loading="lazy" and decoding="async".'
        : '- Loading: every image gets loading="lazy" and decoding="async" — none of them is a first-paint asset.',
    `- First viewport budget: at most ${o.aboveFold.maxMediaAssets} eagerly-loaded media asset(s) and ${o.aboveFold.maxAnimatedLayers} animated layer(s). ${o.aboveFold.note}`,
    `- Motion budget (${o.motion.level}, at most ${o.motion.maxSimultaneousAnimations} animation(s) running at once): ${o.motion.note}`,
    `- Effects budget: ${o.visualComplexity.note}`,
    ...o.mobileSimplification.map((s) => `- Mobile: ${s}`),
    `- Dependencies: ${o.dependencyPolicy}`,
    `- DOM: ${o.domPolicy}`,
    '- Styling: reuse a shared class/constant instead of repeating the same long class string or declaration block many times. This must not change how anything looks.',
    '',
  ];
  return boundBlock(lines, OPTIMIZATION_CHAR_CEILING).concat('');
}

/** P4 — the evidence-scoped generic-signature ban. First tier to be shed. */
export function renderExperienceAntiPatternBlock(contract: ExperienceIntelligenceContract | undefined): string[] {
  if (!contract || !contract.avoidSignatures.length) return [];
  return boundBlock([
    'This build must NOT reproduce these generic AI-design signatures (each one is listed because',
    'this product’s own evidence says it would be wrong here — not as a blanket rule):',
    ...contract.avoidSignatures.map((s) => `- ${s}`),
  ], ANTI_CHAR_CEILING).concat('');
}

/* ────────────────────────────────────────────────────────────────────────────
 * 9. OPTIMIZATION GUARD — the bridge into the EXISTING deterministic optimization
 *    pass (Quality V2). It does not create a second optimizer: it hands the one
 *    optimizer the experience's protection list and its budgets, so a finding that
 *    would damage a higher-order goal is never raised in the first place.
 * ──────────────────────────────────────────────────────────────────────────── */
export interface OptimizationGuardPolicy {
  /** Component files an optimization may never propose deleting. */
  protectedFiles: string[];
  /** Image slot ids that must survive (they may be resized/lazied, never removed). */
  protectedMediaSlotIds: string[];
  /** True when a required lead visual exists (it must stay eagerly loaded). */
  leadVisualRequired: boolean;
  /** Budgets carried from the experience direction. */
  maxSimultaneousAnimations: number;
  maxAboveFoldMedia: number;
  maxBlurLayers: number;
  /** Rendered into the single advisory repair instruction so a repair cannot over-reach. */
  protectedElements: string[];
  /** The component file that renders the first viewport (a website's hero, an app's entry
   *  screen). Supplied by the caller because only it knows the generated file layout. Absent ⇒
   *  the first-viewport budget check is skipped rather than guessed. */
  firstViewportPath?: string;
}

/** Build the guard policy for the deterministic optimization pass. Returns undefined
 *  when there is no contract, so the pass keeps its exact pre-existing behaviour. */
export function buildOptimizationGuardPolicy(
  contract: ExperienceIntelligenceContract | undefined,
  firstViewportPath?: string,
  /**
   * Media ids that were actually PLACED in this build (slot ids + their stable data-korvix ids).
   * The contract is derived at PLANNING time, before any image is resolved, so its own
   * `protectedMediaSlotIds` can only name planned targets. Without this the optimizer could
   * propose lazy-loading the very lead image the design requires, purely because the id it now
   * carries did not exist when the direction was derived. Supplied by the caller because only it
   * sees the enriched specification. Absent ⇒ exactly the previous behaviour.
   */
  placedMediaIds?: string[],
): OptimizationGuardPolicy | undefined {
  if (!contract) return undefined;
  const o = contract.optimization;
  return {
    ...(firstViewportPath ? { firstViewportPath } : {}),
    protectedFiles: o.protectedFiles.slice(0, 24),
    protectedMediaSlotIds: boundedList([...o.protectedMediaSlotIds, ...(placedMediaIds || [])], 16, 120),
    leadVisualRequired: contract.media.leadVisual === 'required',
    maxSimultaneousAnimations: o.motion.maxSimultaneousAnimations,
    maxAboveFoldMedia: o.aboveFold.maxMediaAssets,
    maxBlurLayers: o.visualComplexity.maxBlurLayers,
    protectedElements: o.protectedElements.slice(0, 7),
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 10. REPAIR PRESERVATION — the bounded digest entry so a repair cannot casually
 *     destroy the selected experience direction. Consumed by the EXISTING
 *     `buildRepairAuthorityDigest`; this module adds no repair system of its own.
 * ──────────────────────────────────────────────────────────────────────────── */
export function buildExperienceRepairDigest(
  contract: ExperienceIntelligenceContract | undefined,
): Record<string, unknown> | undefined {
  if (!contract) return undefined;
  const d: Record<string, unknown> = {
    lead: contract.experience.lead,
    density: contract.experience.density,
    hierarchy: contract.experience.hierarchy,
    composition: contract.experience.composition,
    cardsAppropriate: contract.experience.cardsAppropriate,
    chartsJustified: contract.experience.chartsJustified,
    mediaNecessity: contract.media.necessity,
    leadVisual: contract.media.leadVisual,
    primaryMedium: contract.media.primaryKind,
  };
  if (contract.media.forbiddenKinds.length) d.forbiddenMedia = contract.media.forbiddenKinds.slice(0, 5);
  if (contract.optimization.protectedElements.length) d.neverRemove = contract.optimization.protectedElements.slice(0, 7);
  d.optimizationPriority = 'experience correctness > visual quality > usability/accessibility > performance > cleanliness';
  return d;
}

/* ── Bounded, secret-free diagnostics (counts + bounded codes only). ─────────── */
export interface ExperienceIntelligenceDiagnostics {
  version: 'experience-intelligence-v1';
  buildType: BuildType;
  lead: ExperienceLead;
  density: ExperienceDensity;
  hierarchy: ExperienceHierarchy;
  primaryInteraction: PrimaryInteraction;
  composition: CompositionStrategy;
  mediaNecessity: MediaNecessity;
  leadVisual: MediaDirection['leadVisual'];
  primaryMedium: MediaKind;
  narrativeMode: NarrativeMode;
  motionLevel: MotionLevel;
  adapter: 'web' | 'app' | 'none';
  avoidSignatureCount: number;
  protectedElementCount: number;
}

export function buildExperienceIntelligenceDiagnostics(
  contract: ExperienceIntelligenceContract | undefined,
): ExperienceIntelligenceDiagnostics | undefined {
  if (!contract) return undefined;
  return {
    version: 'experience-intelligence-v1',
    buildType: contract.buildType,
    lead: contract.experience.lead,
    density: contract.experience.density,
    hierarchy: contract.experience.hierarchy,
    primaryInteraction: contract.experience.primaryInteraction,
    composition: contract.experience.composition,
    mediaNecessity: contract.media.necessity,
    leadVisual: contract.media.leadVisual,
    primaryMedium: contract.media.primaryKind,
    narrativeMode: contract.content.narrativeMode,
    motionLevel: contract.optimization.motion.level,
    adapter: contract.web ? 'web' : contract.app ? 'app' : 'none',
    avoidSignatureCount: contract.avoidSignatures.length,
    protectedElementCount: contract.optimization.protectedElements.length,
  };
}
