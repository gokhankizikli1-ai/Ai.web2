/**
 * Web Build AGENT layer (Phase 1: Research Agent + UI / Art Director Agent).
 *
 * These are the two real UPSTREAM agents that run before layout/component
 * generation. Each produces a structured, backward-compatible artifact that
 * later agents (Layout Architect, Component Engineer — not built yet) and the
 * current design system / preview / files consume.
 *
 * HONESTY RULES (never violated here):
 *  - The Research Agent reports the REAL backend research status. It never
 *    claims sources it doesn't have and never fabricates citations. When no live
 *    sources exist it uses "strategy inference" language, not "research found".
 *  - The Art Director derives a DYNAMIC visual direction from the prompt + brief
 *    + research + the (already strategy-driven) design system — it is not a fixed
 *    industry theme and does not hardcode example websites.
 *
 * Everything here is a pure, deterministic derivation, so old saved builds
 * recompute the same artifacts and nothing needs to be persisted to work.
 */
import type { WebBuildBrief, WebBuildResearch, WebBuildResearchStatus, WebBuildSource } from '@/lib/webBuildApi';
import { designTokensForBrief, type InferredBrief } from '@/lib/webBuildBrief';
import { deriveDesignSystemFromStrategy } from '@/lib/webBuildDesignSystem';
import type { WebBuildLayoutPlan, HeroComposition, SectionVariant } from '@/lib/webBuildLayoutPlan';

type Lang = 'en' | 'tr' | string;
const L = (lang: Lang, en: string, tr: string) => (lang === 'tr' ? tr : en);
const uniq = (xs: string[]): string[] => Array.from(new Set(xs.map((x) => x.trim()).filter(Boolean)));

/**
 * FEATURE FLAG — the Phase-1 upstream agents (Research + UI/Art Director) are
 * EXPERIMENTAL and OFF by default. When false (the default, including when the
 * env var is unset or invalid), Web Build behaves EXACTLY like the stable
 * non-agent path: no agent derivation runs, the plain brief drives preview/files,
 * and agent artifacts are never produced or required. Never required in prod.
 *
 * Enable only by explicitly setting VITE_WEB_BUILD_AGENTS_ENABLED=true.
 */
export const WEB_BUILD_AGENTS_ENABLED: boolean = (() => {
  try {
    const v = ((import.meta.env?.VITE_WEB_BUILD_AGENTS_ENABLED as string | undefined) ?? '').trim().toLowerCase();
    // ON by default (agents are now purely client-side, deterministic and
    // per-agent guarded, so they cannot mark a build package incomplete).
    // Explicitly kill-switch with VITE_WEB_BUILD_AGENTS_ENABLED=false / 0.
    return v !== 'false' && v !== '0' && v !== 'off';
  } catch {
    return true;
  }
})();

export type AgentStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

/* ── Research Agent artifact ──────────────────────────────────────────── */
export interface ResearchAgentArtifact {
  didResearch: boolean;
  status: WebBuildResearchStatus;
  provider?: string;
  attemptedProviders?: string[];
  queryCount?: number;
  sourceCount?: number;
  sources?: WebBuildSource[];
  researchAngles: string[];
  /** Insights synthesized from what matters for THIS site (source-backed only
   *  when real sources exist — labeled honestly in `summary`). */
  sourceBackedInsights: string[];
  categoryLanguage: string[];
  audienceExpectations: string[];
  conversionPatterns: string[];
  trustSignals: string[];
  visualPatterns: string[];
  competitorOrAdjacentPatterns: string[];
  risksToAvoid: string[];
  differentiationOpportunities: string[];
  summary: string;
  /** Why research did not produce live sources (present when didResearch is
   *  false). Shown in the expandable details / owner debug — never fabricated. */
  fallbackReason?: string;
}

/* ── UI / Art Director artifact ───────────────────────────────────────── */
export interface ArtDirectionColorSystem {
  background: string;
  foreground: string;
  accent: string;
  accent2: string;
  muted: string;
  surface: string;
  border: string;
}

export type ArtDensity = 'minimal' | 'balanced' | 'rich' | 'immersive';

export interface ArtDirectionArtifact {
  visualMood: string;
  brandPersonality: string;
  typographyDirection: string;
  colorSystem: ArtDirectionColorSystem;
  layoutFeeling: string;
  visualMetaphor: string;
  imageryDirection: string;
  motionDirection: string;
  density: ArtDensity;
  premiumDetails: string[];
  avoid: string[];
  uiPrinciples: string[];
  componentStyleHints: string[];
  heroDirection: string;
  sectionRhythmDirection: string;
  summary: string;
}

/* ── Strategy Agent artifact (Phase 2) ────────────────────────────────── */
export interface StrategyCTAHierarchy { primary: string; secondary: string }
export interface StrategySectionIntent { section: string; purpose: string; visitorQuestion: string }

export interface StrategyAgentArtifact {
  positioning: string;
  mainPromise: string;
  audiencePsychology: string;
  visitorIntent: string;
  conversionStrategy: string;
  trustStrategy: string;
  ctaHierarchy: StrategyCTAHierarchy;
  contentHierarchy: string[];
  aboveTheFoldMustProve: string[];
  sectionIntent: StrategySectionIntent[];
  risksToAvoid: string[];
  differentiation: string;
  summary: string;
}

/* ── Layout Architect artifact — the Page Blueprint (Phase 2) ──────────── */
export interface BlueprintHero {
  variant: string;
  layout: string;
  visualModule: string;
  ctaPlacement: string;
  proofPlacement: string;
  density: string;
}
export interface BlueprintSection {
  id: string;
  title: string;
  purpose: string;
  variant: string;
  visualModule: string;
  density: string;
  ctaRole: string;
}
export interface PageBlueprint {
  architecture: string;
  navigationStyle: string;
  hero: BlueprintHero;
  sections: BlueprintSection[];
  sectionRhythm: string;
  trustPlacement: string;
  motionPattern: string;
  responsiveBehavior: string;
  summary: string;
}

export type AgentId = 'research' | 'ui_art_director' | 'strategy' | 'layout_architect';
export type AgentArtifact =
  ResearchAgentArtifact | ArtDirectionArtifact | StrategyAgentArtifact | PageBlueprint | Record<string, unknown>;

export interface WebBuildAgent {
  id: AgentId;
  name: string;
  status: AgentStatus;
  summary: string;
  /** Short live activity line (used by the timeline while running). */
  currentActivity?: string;
  artifact: AgentArtifact;
}

export interface WebBuildArtifacts {
  research?: ResearchAgentArtifact;
  artDirection?: ArtDirectionArtifact;
  strategy?: StrategyAgentArtifact;
  blueprint?: PageBlueprint;
}

export interface WebBuildAgents {
  agents: WebBuildAgent[];
  artifacts: WebBuildArtifacts;
}

/* ── Research Agent ───────────────────────────────────────────────────── */

const ANGLE_LABELS = (lang: Lang): Record<string, string> => ({
  category: L(lang, 'Category & positioning', 'Kategori ve konumlandırma'),
  audience: L(lang, 'Audience expectations', 'Hedef kitle beklentileri'),
  conversion: L(lang, 'Conversion patterns', 'Dönüşüm kalıpları'),
  trust: L(lang, 'Trust & credibility', 'Güven ve itibar'),
  visual: L(lang, 'Visual & UI patterns', 'Görsel ve arayüz kalıpları'),
});

/**
 * Build the Research Agent artifact. Consumes the real backend research metadata
 * (when present) plus the inferred category playbook, and SYNTHESIZES why it
 * matters for the website — it never just passes URLs through. Honest about
 * whether live sources actually informed it.
 */
export function deriveResearchAgent(
  brief: WebBuildBrief,
  research: WebBuildResearch | undefined,
  inferred: InferredBrief,
  lang: Lang = 'en',
): ResearchAgentArtifact {
  const sources = research?.sources || [];
  const sourceCount = research?.sourceCount ?? sources.length;
  const didResearch = !!research?.didResearch && sourceCount > 0;
  const status: WebBuildResearchStatus = research?.status
    || (didResearch ? 'used_sources' : sources.length ? 'no_sources' : 'fallback_strategy');

  const labels = ANGLE_LABELS(lang);
  const researchAngles = research?.angles?.length
    ? research.angles
    : [labels.category, labels.audience, labels.conversion, labels.trust, labels.visual];

  const items = (inferred.items || []).slice(0, 6);
  const categoryLanguage = uniq([brief.type || inferred.businessType, ...items]);
  const audienceExpectations = uniq([
    brief.audience || inferred.targetAudience,
    L(lang, `Understand the offer fast, then a clear next step (${inferred.conversionGoal}).`,
      `Teklifi hızla anlamak, sonra net bir adım (${inferred.conversionGoal}).`),
  ]);
  const conversionPatterns = uniq([
    L(lang, `Single primary action: ${inferred.primaryCTA}.`, `Tek ana eylem: ${inferred.primaryCTA}.`),
    L(lang, `Secondary path: ${inferred.secondaryCTA}.`, `İkincil yol: ${inferred.secondaryCTA}.`),
    inferred.conversionGoal,
  ]);
  const trustSignals = uniq((brief.trustSignals || inferred.trustSignals || '').split(/[,·|]/).map((s) => s.trim()));
  const visualPatterns = uniq([inferred.visualStyle, inferred.previewVisualIdea, inferred.recommendedMotion]);
  const competitorOrAdjacentPatterns = uniq([inferred.strategyNote]);
  const risksToAvoid = uniq([
    L(lang, 'Generic centered hero + three-card grid (reads as a template).',
      'Jenerik ortalanmış hero + üç kart grid (şablon gibi görünür).'),
    L(lang, 'Vague hype copy with no concrete offer or outcome.',
      'Somut teklif/sonuç içermeyen muğlak abartılı metin.'),
    L(lang, 'No single obvious conversion; competing CTAs.',
      'Tek net dönüşüm yok; birbiriyle yarışan CTA\'lar.'),
    L(lang, 'Empty decorative panels / blank placeholder boxes.',
      'Boş dekoratif paneller / boş yer tutucu kutular.'),
  ]);
  const differentiationOpportunities = uniq([
    inferred.previewVisualIdea,
    L(lang, `Lead with the strongest proof this category needs (${inferred.trustSignals}).`,
      `Bu kategorinin ihtiyaç duyduğu en güçlü kanıtla aç (${inferred.trustSignals}).`),
    L(lang, `A visual metaphor tied to the concept, not a stock hero.`,
      `Konsepte bağlı bir görsel metafor; stok bir hero değil.`),
  ]);

  // Insights: phrased as source-backed ONLY when real sources exist.
  const sourceBackedInsights = didResearch
    ? uniq([
        L(lang, `${sourceCount} live source(s) confirm the category conventions above.`,
          `${sourceCount} canlı kaynak yukarıdaki kategori kurallarını doğruluyor.`),
        ...sources.slice(0, 3).map((s) => s.title).filter(Boolean),
      ])
    : uniq([
        L(lang, 'No live sources — the above is strategy inference from the idea + category knowledge.',
          'Canlı kaynak yok — yukarıdakiler fikir + kategori bilgisinden çıkarılan stratejidir.'),
      ]);

  const summary = didResearch
    ? L(lang,
        `Researched ${sourceCount} source(s) across ${researchAngles.length} angles; synthesized category language, audience expectations, conversion patterns, trust signals and risks to avoid.`,
        `${researchAngles.length} açıdan ${sourceCount} kaynak araştırıldı; kategori dili, kitle beklentileri, dönüşüm kalıpları, güven sinyalleri ve kaçınılacak riskler sentezlendi.`)
    : L(lang,
        `No live sources available — inferred category language, audience expectations, conversion patterns and risks from the idea (strategy inference).`,
        `Canlı kaynak yok — fikirden kategori dili, kitle beklentileri, dönüşüm kalıpları ve riskler çıkarıldı (strateji çıkarımı).`);

  return {
    didResearch,
    status,
    provider: research?.provider,
    attemptedProviders: research?.attemptedProviders,
    queryCount: research?.queryCount,
    sourceCount,
    sources: sources.length ? sources : undefined,
    researchAngles,
    sourceBackedInsights,
    categoryLanguage,
    audienceExpectations,
    conversionPatterns,
    trustSignals,
    visualPatterns,
    competitorOrAdjacentPatterns,
    risksToAvoid,
    differentiationOpportunities,
    summary,
    // Only meaningful when research did NOT run — carried through for the
    // expandable details / owner debug so a failure/disabled state is visible.
    fallbackReason: didResearch ? undefined : research?.fallbackReason,
  };
}

/* ── UI / Art Director Agent ──────────────────────────────────────────── */

/** Map the design system's spacing density into the art-direction vocabulary. */
function artDensity(density: 'compact' | 'comfortable' | 'spacious', motion: 'minimal' | 'subtle' | 'expressive'): ArtDensity {
  if (density === 'spacious') return motion === 'expressive' ? 'immersive' : 'minimal';
  if (density === 'compact') return 'rich';
  return 'balanced';
}

const isSerif = (font: string) => /serif|georgia|cambria|times/i.test(font);

/**
 * Build the UI / Art Director artifact. Converts research + brief into a strong,
 * DYNAMIC visual direction. The palette comes from the strategy-driven design
 * system (already prompt/industry/color-hint aware), so two different ideas
 * produce different color systems; the art director wraps it into a full system
 * (foreground/surface/border) and a coherent direction later agents can trust.
 */
export function deriveArtDirection(
  brief: WebBuildBrief,
  research: ResearchAgentArtifact | undefined,
  inferred: InferredBrief,
  lang: Lang = 'en',
): ArtDirectionArtifact {
  const ds = deriveDesignSystemFromStrategy(brief);
  // Resolve the palette from a brief whose mood/color words are populated, so the
  // color system reflects the intended direction (not a bare indigo default when
  // the backend returned no explicit color).
  const moodBrief = {
    ...brief,
    visualMood: brief.visualMood || brief.style || inferred.visualStyle,
    colorDirection: brief.colorDirection || brief.visualMood || brief.style || inferred.visualStyle,
  };
  const tokens = designTokensForBrief(moodBrief);

  const colorSystem: ArtDirectionColorSystem = {
    background: tokens.bg,
    foreground: '#f1f5f9',
    accent: tokens.accent,
    accent2: tokens.accent2,
    muted: '#94a3b8',
    surface: 'rgba(255,255,255,0.04)',
    border: 'rgba(255,255,255,0.10)',
  };

  const visualMood = brief.visualMood || brief.style || inferred.visualStyle;
  const brandPersonality = uniq([inferred.tone, brief.audience || inferred.targetAudience]).join(' · ')
    || L(lang, 'confident, modern, premium', 'kendinden emin, modern, premium');
  const typographyDirection = brief.typographyDirection
    || (isSerif(tokens.headingFont)
      ? L(lang, 'Editorial serif headlines with a clean sans body — refined, premium.',
          'Editoryal serif başlıklar, temiz sans gövde — zarif, premium.')
      : L(lang, 'Modern geometric sans headlines with a neutral sans body — crisp, confident.',
          'Modern geometrik sans başlıklar, nötr sans gövde — net, kendinden emin.'));
  const layoutFeeling = brief.layoutLogic
    || L(lang, `A ${ds.sectionRhythm} rhythm with ${ds.density} spacing that fits the concept.`,
        `Konsepte uygun ${ds.density} boşluklu ${ds.sectionRhythm} bir ritim.`);
  const visualMetaphor = brief.visualMetaphor || inferred.previewVisualIdea;
  const imageryDirection = L(lang,
    `Composed CSS/SVG visuals (${inferred.previewVisualIdea}) — no stock photos, no blank boxes.`,
    `Kompoze CSS/SVG görseller (${inferred.previewVisualIdea}) — stok fotoğraf yok, boş kutu yok.`);
  const motionByLevel = ds.motion === 'minimal'
    ? L(lang, 'Restrained, quiet motion — a single calm reveal, no distraction.', 'Ölçülü, sakin hareket — tek bir sakin beliriş, dikkat dağıtmadan.')
    : ds.motion === 'expressive'
      ? L(lang, 'Expressive, kinetic motion — bold reveals and depth, still tasteful.', 'İfade dolu, kinetik hareket — cesur belirişler ve derinlik, yine de zevkli.')
      : L(lang, 'Subtle premium motion — gentle reveals and hover states.', 'İnce premium hareket — yumuşak belirişler ve hover durumları.');
  const motionDirection = brief.motionDirection || motionByLevel || inferred.recommendedMotion;
  const density = artDensity(ds.density, ds.motion);

  const premiumDetails = uniq([
    L(lang, 'Soft accent glow on primary actions', 'Ana eylemlerde yumuşak vurgu parıltısı'),
    L(lang, 'Consistent surface + border language', 'Tutarlı yüzey + kenarlık dili'),
    ds.cardStyle === 'glass' ? L(lang, 'Subtle glass/blur surfaces', 'İnce cam/blur yüzeyler')
      : ds.cardStyle === 'outline' ? L(lang, 'Precise hairline outlines', 'Hassas ince çizgi kenarlıklar')
      : L(lang, 'Solid, tactile surfaces', 'Dolgun, dokunsal yüzeyler'),
    L(lang, 'Tasteful reveal-on-scroll, never childish', 'Zevkli scroll-belirme, asla çocuksu değil'),
  ]);
  const avoid = uniq([
    ...(research?.risksToAvoid || []).slice(0, 2),
    L(lang, 'Default indigo/cyan when the concept implies another palette',
      'Konsept başka bir palet ima ederken varsayılan indigo/camgöbeği'),
    L(lang, 'Generic stock imagery and flat gray placeholders',
      'Jenerik stok görseller ve düz gri yer tutucular'),
  ]);
  const uiPrinciples = uniq([
    L(lang, 'One obvious conversion path per screen', 'Ekran başına tek net dönüşüm yolu'),
    L(lang, 'Strong typographic hierarchy over decoration', 'Dekorasyon yerine güçlü tipografik hiyerarşi'),
    L(lang, 'Generous, intentional whitespace', 'Cömert, amaçlı boşluk'),
    L(lang, 'A coherent surface language across all sections', 'Tüm bölümlerde tutarlı yüzey dili'),
  ]);
  const componentStyleHints = uniq([
    L(lang, `Cards: ${ds.cardStyle}`, `Kartlar: ${ds.cardStyle}`),
    L(lang, `Corner radius: ${tokens.radius}`, `Köşe yarıçapı: ${tokens.radius}`),
    L(lang, `Heading tracking: ${tokens.tracking}`, `Başlık aralığı: ${tokens.tracking}`),
    L(lang, `Accent used for a single focal action, not everywhere`, `Vurgu her yerde değil, tek odak eyleminde`),
  ]);
  const heroDirection = L(lang,
    `Lead with ${visualMetaphor}; place the primary CTA (${brief.primaryCTA || inferred.primaryCTA}) where the eye lands first.`,
    `${visualMetaphor} ile aç; ana CTA'yı (${brief.primaryCTA || inferred.primaryCTA}) gözün ilk indiği yere koy.`);
  const sectionRhythmDirection = L(lang,
    `Vary section composition (${ds.sectionRhythm}); avoid repeating one card grid down the page.`,
    `Bölüm kompozisyonunu değiştir (${ds.sectionRhythm}); sayfa boyunca tek kart gridini tekrarlama.`);

  const summary = L(lang,
    `Art direction: ${visualMood}. ${isSerif(tokens.headingFont) ? 'Editorial' : 'Modern'} type, ${density} density, ${ds.motion} motion, metaphor "${visualMetaphor}".`,
    `Sanat yönü: ${visualMood}. ${isSerif(tokens.headingFont) ? 'Editoryal' : 'Modern'} tipografi, ${density} yoğunluk, ${ds.motion} hareket, metafor "${visualMetaphor}".`);

  return {
    visualMood,
    brandPersonality,
    typographyDirection,
    colorSystem,
    layoutFeeling,
    visualMetaphor,
    imageryDirection,
    motionDirection: motionDirection || inferred.recommendedMotion,
    density,
    premiumDetails,
    avoid,
    uiPrinciples,
    componentStyleHints,
    heroDirection,
    sectionRhythmDirection,
    summary,
  };
}

/* ── Strategy Agent (Phase 2) ─────────────────────────────────────────── */

/** The single question a visitor asks at each section — used for sectionIntent. */
function sectionQuestion(name: string, lang: Lang): string {
  const n = name.toLowerCase();
  if (/hero|intro/.test(n)) return L(lang, 'What is this and is it for me?', 'Bu nedir ve bana uygun mu?');
  if (/price|pricing|fiyat|paket|plan|program/.test(n)) return L(lang, 'What does it cost and which fits me?', 'Maliyeti ne ve hangisi bana uygun?');
  if (/testimonial|proof|review|referans|yorum|social/.test(n)) return L(lang, 'Can I trust this — do others?', 'Buna güvenebilir miyim — başkaları güveniyor mu?');
  if (/faq|soru/.test(n)) return L(lang, 'What if I still have doubts?', 'Hâlâ tereddütlerim varsa?');
  if (/gallery|work|portfolio|proje|galeri|collection|koleksiyon/.test(n)) return L(lang, 'Is the quality real?', 'Kalite gerçek mi?');
  if (/process|how|süreç|nasıl|adım|workflow/.test(n)) return L(lang, 'How does it actually work?', 'Bu gerçekte nasıl işliyor?');
  if (/cta|contact|book|randevu|iletişim|final|reservation|rezervasyon/.test(n)) return L(lang, 'How do I take the next step?', 'Sonraki adımı nasıl atarım?');
  if (/feature|service|hizmet|özellik|benefit/.test(n)) return L(lang, 'What exactly do I get?', 'Tam olarak ne elde ederim?');
  return L(lang, 'Why should I keep reading?', 'Neden okumaya devam etmeliyim?');
}

/**
 * Build the Strategy Agent artifact. Consumes the brief + Research + Art Direction
 * and reasons about positioning, promise, audience psychology, the conversion +
 * trust strategy, CTA hierarchy, content hierarchy and per-section intent. Dynamic
 * from the idea; honest when no live sources exist (strategy inference).
 */
export function deriveStrategyAgent(
  brief: WebBuildBrief,
  research: ResearchAgentArtifact | undefined,
  inferred: InferredBrief,
  sections: Array<{ id: string; name: string }>,
  lang: Lang = 'en',
): StrategyAgentArtifact {
  const audience = brief.audience || inferred.targetAudience;
  const primary = brief.primaryCTA || inferred.primaryCTA;
  const secondary = brief.secondaryCTA || inferred.secondaryCTA;
  const positioning = brief.coreIdea || `${inferred.businessType} ${L(lang, 'for', 'için')} ${audience}`;
  const mainPromise = brief.strategyInsight || inferred.heroHeadline;
  const conversionStrategy = brief.conversionStrategy
    || uniq(research?.conversionPatterns || []).join(' · ')
    || L(lang, `Lead the visitor to one action: ${primary}.`, `Ziyaretçiyi tek eyleme yönlendir: ${primary}.`);
  const trustStrategy = brief.trustSignals
    || uniq(research?.trustSignals || []).join(' · ')
    || inferred.trustSignals;
  const differentiation = (research?.differentiationOpportunities || [])[0]
    || inferred.previewVisualIdea;

  const contentHierarchy = [
    L(lang, `Promise: ${mainPromise}`, `Vaat: ${mainPromise}`),
    L(lang, 'Proof it is real (trust signals)', 'Gerçek olduğunun kanıtı (güven sinyalleri)'),
    L(lang, 'How it works / what you get', 'Nasıl çalışır / ne elde edersin'),
    L(lang, `The offer and single action: ${primary}`, `Teklif ve tek eylem: ${primary}`),
  ];
  const aboveTheFoldMustProve = uniq([
    mainPromise,
    (research?.trustSignals || [])[0] || inferred.trustSignals,
    differentiation,
  ]).slice(0, 3);

  const sectionIntent: StrategySectionIntent[] = sections.slice(0, 12).map((s) => ({
    section: s.name,
    purpose: L(lang, `Move the visitor from "${sectionQuestion(s.name, lang)}" toward ${primary}.`,
      `Ziyaretçiyi "${sectionQuestion(s.name, lang)}" sorusundan ${primary} eylemine taşı.`),
    visitorQuestion: sectionQuestion(s.name, lang),
  }));

  const summary = L(lang,
    `Positioning: ${positioning}. One promise, one path to "${primary}", proven by ${aboveTheFoldMustProve.length} above-the-fold signals.`,
    `Konumlandırma: ${positioning}. Tek vaat, "${primary}" için tek yol, ${aboveTheFoldMustProve.length} ilk-ekran sinyaliyle kanıtlanır.`);

  return {
    positioning,
    mainPromise,
    audiencePsychology: uniq([audience, ...(research?.audienceExpectations || [])]).join(' · '),
    visitorIntent: brief.visitorIntent || (research?.audienceExpectations || [])[0]
      || L(lang, `Decide quickly whether this fits, then ${primary}.`, `Bunun uygun olup olmadığına hızlıca karar ver, sonra ${primary}.`),
    conversionStrategy,
    trustStrategy,
    ctaHierarchy: { primary, secondary },
    contentHierarchy,
    aboveTheFoldMustProve,
    sectionIntent,
    risksToAvoid: research?.risksToAvoid || [],
    differentiation,
    summary,
  };
}

/* ── Layout Architect Agent — the Page Blueprint (Phase 2) ─────────────── */

/** Map the plan's canonical hero composition to the blueprint's reusable
 *  primitive vocabulary. */
const HERO_DISPLAY: Record<HeroComposition, string> = {
  'split-editorial': 'editorial_split',
  'asymmetric-visual': 'asymmetric_immersive',
  'dashboard-product': 'dashboard_product',
  'immersive-full-bleed': 'story_cinematic',
  'membership-application': 'membership_application',
  'catalog-collection': 'catalog_collection',
  'data-map': 'data_map',
  'luxury-service': 'luxury_service',
  'story-editorial': 'story_cinematic',
  'event-experience': 'event_experience',
  centered: 'editorial_split',
};
const SECTION_DISPLAY: Record<SectionVariant, string> = {
  'feature-grid': 'feature_grid',
  'editorial-split': 'editorial_split',
  'process-timeline': 'process_timeline',
  'proof-strip': 'proof_strip',
  'catalog-grid': 'catalog_showcase',
  comparison: 'comparison_module',
  'application-form': 'application_reservation',
  'dashboard-data': 'dashboard_data',
  'quote-story': 'quote_story',
  'collection-archive': 'archive_collection',
  'spatial-floorplan': 'spatial_floorplan',
  'pricing-membership': 'pricing_membership',
  'faq-cta': 'faq_final_cta',
  showcase: 'immersive_visual_break',
};

/**
 * Build the Page Blueprint from the resolved layout plan + strategy. The blueprint
 * expresses the SAME composition the renderer will use (mapped to reusable layout
 * primitives), so it accurately describes what preview/files render — and the
 * strategy that shaped the plan (via the enriched brief) is reflected here.
 */
export function deriveLayoutArchitect(
  sections: Array<{ id: string; name: string }>,
  plan: WebBuildLayoutPlan,
  _art: ArtDirectionArtifact | undefined,
  strategy: StrategyAgentArtifact | undefined,
  lang: Lang = 'en',
): PageBlueprint {
  const heroVariant = HERO_DISPLAY[plan.heroComposition] || 'editorial_split';
  const intentByName = new Map((strategy?.sectionIntent || []).map((si) => [si.section.toLowerCase(), si]));
  const titleById = new Map(sections.map((s) => [s.id, s.name]));

  const blueSections: BlueprintSection[] = plan.sections
    .filter((s) => s.kind !== 'hero')
    .map((s) => {
      const title = titleById.get(s.id) || s.name;
      const si = intentByName.get(title.toLowerCase());
      const ctaRole = (s.kind === 'cta' || s.kind === 'pricing') ? 'primary'
        : (s.kind === 'footer') ? 'none' : 'supporting';
      return {
        id: s.id,
        title,
        purpose: si?.purpose || L(lang, `Advance the visitor toward the primary action.`, `Ziyaretçiyi ana eyleme yaklaştır.`),
        variant: SECTION_DISPLAY[s.variant] || 'feature_grid',
        visualModule: s.hostsPrimaryModule ? plan.primaryVisualModule : (plan.secondaryVisualModules[0] || '—'),
        density: plan.contentDensity,
        ctaRole,
      };
    });

  return {
    architecture: plan.pageArchitecture,
    navigationStyle: plan.navigationStyle,
    hero: {
      variant: heroVariant,
      layout: `${plan.visualSystem.headingAlign}-aligned · ${plan.contentDensity}`,
      visualModule: plan.primaryVisualModule,
      ctaPlacement: plan.ctaPlacement,
      proofPlacement: plan.trustPlacement,
      density: plan.contentDensity,
    },
    sections: blueSections,
    sectionRhythm: plan.rhythm,
    trustPlacement: plan.trustPlacement,
    motionPattern: plan.motionPattern,
    responsiveBehavior: L(lang,
      'Single column on mobile; multi-column grids collapse; the hero visual stacks under the copy.',
      'Mobilde tek sütun; grid\'ler tek sütuna iner; hero görseli metnin altına yığılır.'),
    summary: L(lang,
      `${heroVariant.replace(/_/g, ' ')} hero · ${plan.rhythm} rhythm · ${blueSections.length} sections · ${plan.visualSystem.background} backdrop.`,
      `${heroVariant.replace(/_/g, ' ')} hero · ${plan.rhythm} ritim · ${blueSections.length} bölüm · ${plan.visualSystem.background} arka plan.`),
  };
}

/* ── Brief enrichment (agents → design system / preview / files) ──────── */

/**
 * Fold the Art Direction + Strategy into the brief so the existing design system,
 * preview and file synthesizer are driven by them. Fills GAPS only (the model's
 * own values always win), so it is additive and backward compatible.
 */
export function enrichBriefWithAgents(
  brief: WebBuildBrief,
  art: ArtDirectionArtifact | undefined,
  strategy: StrategyAgentArtifact | undefined,
): WebBuildBrief {
  let b: WebBuildBrief = { ...brief };
  if (art && art.colorSystem) {
    b = {
      ...b,
      artAccent: b.artAccent || art.colorSystem.accent,
      artAccent2: b.artAccent2 || art.colorSystem.accent2,
      artBg: b.artBg || art.colorSystem.background,
      artHeadingSerif: b.artHeadingSerif ?? /serif/i.test(art.typographyDirection || ''),
      visualMood: b.visualMood || art.visualMood,
      colorDirection: b.colorDirection || art.visualMood,
      motionDirection: b.motionDirection || art.motionDirection,
      visualMetaphor: b.visualMetaphor || art.visualMetaphor,
      typographyDirection: b.typographyDirection || art.typographyDirection,
      layoutLogic: b.layoutLogic || art.layoutFeeling,
    };
  }
  if (strategy) {
    b = {
      ...b,
      coreIdea: b.coreIdea || strategy.positioning,
      strategyInsight: b.strategyInsight || strategy.differentiation,
      visitorIntent: b.visitorIntent || strategy.visitorIntent,
      conversionStrategy: b.conversionStrategy || strategy.conversionStrategy,
      trustSignals: b.trustSignals || strategy.trustStrategy,
      primaryCTA: b.primaryCTA || strategy.ctaHierarchy.primary,
      secondaryCTA: b.secondaryCTA || strategy.ctaHierarchy.secondary,
    };
  }
  return b;
}

/* ── Orchestration (each agent is INDEPENDENTLY guarded — non-blocking) ── */

export interface UpstreamAgentsResult {
  agents: WebBuildAgent[];
  artifacts: WebBuildArtifacts;
  enrichedBrief: WebBuildBrief;
}

const AGENT_NAME: Record<AgentId, [string, string]> = {
  research: ['Research Agent', 'Araştırma Ajanı'],
  ui_art_director: ['UI / Art Director Agent', 'UI / Sanat Yönetmeni Ajanı'],
  strategy: ['Strategy Agent', 'Strateji Ajanı'],
  layout_architect: ['Layout Architect Agent', 'Yerleşim Mimarı Ajanı'],
};

function agentRow(id: AgentId, lang: Lang, artifact: (AgentArtifact & { summary?: string }) | undefined): WebBuildAgent {
  const name = L(lang, AGENT_NAME[id][0], AGENT_NAME[id][1]);
  if (!artifact) {
    return { id, name, status: 'skipped', summary: L(lang, 'Skipped — safe defaults used.', 'Atlandı — güvenli varsayılanlar kullanıldı.'), artifact: {} };
  }
  return { id, name, status: 'done', summary: (artifact.summary as string) || '', artifact };
}

/**
 * Run the upstream agents (Research → UI / Art Director → Strategy). Each agent is
 * wrapped independently: a failure marks THAT agent skipped and the pipeline
 * continues, so no single agent can block the build. Returns the enriched brief
 * that the design system / preview / files consume.
 */
export function runUpstreamAgents(
  _prompt: string,
  brief: WebBuildBrief,
  research: WebBuildResearch | undefined,
  inferred: InferredBrief,
  sections: Array<{ id: string; name: string }>,
  lang: Lang = 'en',
): UpstreamAgentsResult {
  const artifacts: WebBuildArtifacts = {};

  let researchArtifact: ResearchAgentArtifact | undefined;
  try { researchArtifact = deriveResearchAgent(brief, research, inferred, lang); } catch { researchArtifact = undefined; }
  artifacts.research = researchArtifact;

  let art: ArtDirectionArtifact | undefined;
  try { art = deriveArtDirection(brief, researchArtifact, inferred, lang); } catch { art = undefined; }
  artifacts.artDirection = art;

  let strategy: StrategyAgentArtifact | undefined;
  try { strategy = deriveStrategyAgent(brief, researchArtifact, inferred, sections, lang); } catch { strategy = undefined; }
  artifacts.strategy = strategy;

  const agents: WebBuildAgent[] = [
    agentRow('research', lang, researchArtifact),
    agentRow('ui_art_director', lang, art),
    agentRow('strategy', lang, strategy),
  ];

  return { agents, artifacts, enrichedBrief: enrichBriefWithAgents(brief, art, strategy) };
}

/**
 * Run the Layout Architect after the layout plan is resolved. Guarded — on any
 * failure it returns a skipped row and no blueprint, and the build continues on
 * the derived plan.
 */
export function runLayoutArchitect(
  sections: Array<{ id: string; name: string }>,
  plan: WebBuildLayoutPlan,
  art: ArtDirectionArtifact | undefined,
  strategy: StrategyAgentArtifact | undefined,
  lang: Lang = 'en',
): { agent: WebBuildAgent; blueprint?: PageBlueprint } {
  try {
    const blueprint = deriveLayoutArchitect(sections, plan, art, strategy, lang);
    return { agent: agentRow('layout_architect', lang, blueprint), blueprint };
  } catch {
    return { agent: agentRow('layout_architect', lang, undefined) };
  }
}
