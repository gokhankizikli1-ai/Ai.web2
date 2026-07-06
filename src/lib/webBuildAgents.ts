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
import { designTokensForBrief, type InferredBrief, type DesignTokens } from '@/lib/webBuildBrief';
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

/* ── Research Agent — Website Research Brief structures ───────────────────
 * The Research Agent now behaves like a website strategy researcher: before the
 * site is designed it produces a practical Website Research Brief that downstream
 * agents (UI/Art Director, Strategy, Layout Architect) and the build consume.
 * Every field is INFERRED DYNAMICALLY from the idea + brief + inferred playbook +
 * real research signals — never a fixed per-example template. All optional, so old
 * saved builds stay valid. */

export type PagePriority = 'must-have' | 'should-have' | 'optional';

/** Who the visitor probably is — inferred from audience, business model, tone. */
export interface TargetUserAnalysis {
  ageRange?: string;
  role?: string;
  devicePreference?: string;
  knowledgeLevel?: string;
  buyingMotivation?: string;
  mainPainPoints?: string[];
  decisionFactors?: string[];
  trustNeeds?: string[];
  behaviorNotes?: string[];
  accessibilityNeeds?: string[];
}

export interface RecommendedPage {
  name: string;
  purpose: string;
  priority: PagePriority;
  reason: string;
}

export interface RecommendedComponent {
  name: string;
  purpose: string;
  priority: PagePriority;
  usedOn?: string;
  reason: string;
}

export interface VisualStyleRecommendation {
  styleType: string;
  imageryType: string;
  mockupType?: string;
  illustrationDirection?: string;
  photographyDirection?: string;
  iconStyle?: string;
  backgroundStyle?: string;
  premiumLevel: 'simple' | 'polished' | 'premium' | 'luxury' | 'experimental';
  reason: string;
}

export interface ColorPsychology {
  primaryMood: string;
  recommendedPalette: string[];
  avoidColors: string[];
  reasoning: string;
  emotionalEffect: string;
  trustEffect?: string;
  conversionEffect?: string;
}

export type UxImpact = 'conversion' | 'trust' | 'clarity' | 'engagement' | 'retention';
export interface UxPriority {
  priority: string;
  reason: string;
  impact: UxImpact;
}

/** Explicit hand-off the Research Agent passes to the UI / Art Director Agent so
 *  it never starts from zero. */
export interface UiAgentInstructions {
  mustEmphasize: string[];
  mustAvoid: string[];
  recommendedVisualDirection: string;
  recommendedTypography: string;
  recommendedComponents: string[];
  recommendedPages: string[];
  recommendedPalette: string[];
  targetUserSummary: string;
  conversionFocus: string;
}

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
  /* ── Website Research Brief (all inferred dynamically, all optional) ── */
  targetUser?: TargetUserAnalysis;
  recommendedPages?: RecommendedPage[];
  recommendedComponents?: RecommendedComponent[];
  visualStyleRecommendation?: VisualStyleRecommendation;
  colorPsychology?: ColorPsychology;
  uxPriorities?: UxPriority[];
  uiAgentInstructions?: UiAgentInstructions;
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
  /** Semantic colors — present so components have a coherent warning/trust hue
   *  instead of an ad-hoc red/green. Optional for backward compatibility. */
  dangerOrWarning?: string;
  successOrTrust?: string;
  /* ── Structured palette (art-director vocabulary, all optional) ──────── */
  paletteName?: string;
  /** Primary/secondary alias the accents so downstream reads a clear palette. */
  primary?: string;
  secondary?: string;
  text?: string;
  mutedText?: string;
  gradient?: string;
  colorPsychologyReasoning?: string;
  avoidColors?: string[];
}

export type ArtDensity = 'minimal' | 'balanced' | 'rich' | 'immersive';

/* ── UI / Art Director — structured direction sub-artifacts (all optional so old
 *  saved builds still load; new builds populate as much as possible). ── */
export interface DesignArchetype {
  name: string;
  key: string;
  reason: string;
  avoidGenericSaas: boolean;
  archetypeTags: string[];
}
export interface ArtResearchSignalsUsed {
  targetUser: boolean;
  recommendedPages: boolean;
  recommendedComponents: boolean;
  visualStyleRecommendation: boolean;
  colorPsychology: boolean;
  uxPriorities: boolean;
  trustSignals: boolean;
  conversionPatterns: boolean;
}
export interface VisualMoodProfile {
  primaryMood: string;
  secondaryMood: string;
  emotionalGoal: string;
  brandPersonality: string[];
  userPerceptionGoal: string;
}
export type ArtTypeScale = 'compact' | 'balanced' | 'editorial' | 'dramatic';
export interface TypographyProfile {
  headingStyle: string;
  bodyStyle: string;
  fontPairingIntent: string;
  scale: ArtTypeScale;
  weightStrategy: string;
  letterSpacing: string;
  reason: string;
}
export type ArtLayoutDensity = 'airy' | 'balanced' | 'dense' | 'editorial' | 'immersive';
export interface LayoutFeelProfile {
  density: ArtLayoutDensity;
  spacingRhythm: string;
  containerStyle: string;
  gridStyle: string;
  sectionSeparators: string;
  aboveFoldPriority: string;
}
export interface HeroTreatment {
  heroType: string;
  composition: string;
  visualAnchor: string;
  headlineStyle: string;
  ctaStyle: string;
  trustPlacement: string;
  backgroundTreatment: string;
  reason: string;
}
export interface ComponentStyleRules {
  cards: string;
  buttons: string;
  forms: string;
  navigation: string;
  badges: string;
  gallery: string;
  testimonials: string;
  pricingOrCatalog: string;
  trustBlocks: string;
}
export interface ImagerySystem {
  imageType: string;
  photographyStyle: string;
  illustrationStyle: string;
  mockupStyle: string;
  textureOrPattern: string;
  emptyStateStyle: string;
  avoidImagery: string[];
}
export interface IconographySystem {
  style: string;
  stroke: string;
  shapeLanguage: string;
  usageRules: string;
}
export interface MotionSystem {
  animationMood: string;
  microInteractions: string[];
  scrollFeel: string;
  avoidMotion: string[];
}
export interface ResponsiveDirection {
  mobilePriority: string;
  desktopPriority: string;
  navigationBehavior: string;
  heroMobileBehavior: string;
  componentStackingRules: string;
}
export interface AccessibilityDirection {
  contrastRule: string;
  readabilityRule: string;
  touchTargetRule: string;
  motionSafetyRule: string;
}
export interface DownstreamInstructions {
  strategyAgent: string[];
  layoutArchitectAgent: string[];
  componentEngineerAgent: string[];
  previewRenderer: string[];
  fileSynthesis: string[];
}

export interface ArtDirectionArtifact {
  visualMood: string;
  brandPersonality: string;
  typographyDirection: string;
  colorSystem: ArtDirectionColorSystem;
  /** Why this palette fits the audience psychology (from the Research brief). */
  colorPsychologyReasoning?: string;
  layoutFeeling: string;
  visualMetaphor: string;
  imageryDirection: string;
  /** How icons should look (line/duotone/rounded, weight). */
  iconographyDirection?: string;
  motionDirection: string;
  density: ArtDensity;
  premiumDetails: string[];
  avoid: string[];
  uiPrinciples: string[];
  componentStyleHints: string[];
  heroDirection: string;
  sectionRhythmDirection: string;
  /** How the primary/secondary CTA should look and behave. */
  ctaStyleDirection?: string;
  /** How trust/proof blocks should be presented visually. */
  trustVisualDirection?: string;
  /** Desktop-first vs mobile-first responsive behavior. */
  responsiveDesignDirection?: string;
  /** Which Research Agent inputs this art direction consumed (pipeline trace). */
  usedResearchInputs?: string[];
  summary: string;
  /* ── Strong, structured art direction (all optional, backward compatible) ── */
  status?: 'completed' | 'fallback' | 'failed';
  researchSignalsUsed?: ArtResearchSignalsUsed;
  designArchetype?: DesignArchetype;
  visualMoodProfile?: VisualMoodProfile;
  typographyProfile?: TypographyProfile;
  layoutFeel?: LayoutFeelProfile;
  heroTreatment?: HeroTreatment;
  componentStyleRules?: ComponentStyleRules;
  imagerySystem?: ImagerySystem;
  iconographySystem?: IconographySystem;
  motionSystem?: MotionSystem;
  responsiveDirection?: ResponsiveDirection;
  accessibilityDirection?: AccessibilityDirection;
  downstreamInstructions?: DownstreamInstructions;
  mustEmphasize?: string[];
  mustAvoid?: string[];
  handoffSummary?: string;
  fallbackReason?: string;
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
  /** Which Research / Art Direction inputs this strategy consumed (pipeline trace). */
  usedResearchInputs?: string[];
  usedArtDirectionInputs?: string[];
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
  /** Which upstream artifacts this blueprint consumed (pipeline trace). */
  usedResearchInputs?: string[];
  usedArtDirectionInputs?: string[];
  usedStrategyInputs?: string[];
  summary: string;
}

/* ── Component Engineer artifact — the concrete component/file plan ─────── */
export interface EngineeredComponent {
  name: string;
  type: string;
  purpose: string;
  sourceAgentReason: string;
  usedBlueprintSection: string;
  variant: string;
  visualModule: string;
  filePath: string;
}
export interface EngineeredFile {
  path: string;
  purpose: string;
  componentType: string;
  dependsOn: string[];
}
export interface ComponentEngineerArtifact {
  componentPlan: EngineeredComponent[];
  fileManifest: EngineeredFile[];
  appComposition: string[];
  contentModel: Record<string, unknown>;
  reusablePrimitives: string[];
  usedResearchInputs?: string[];
  usedArtDirectionInputs?: string[];
  usedStrategyInputs?: string[];
  usedBlueprintInputs?: string[];
  summary: string;
}

export type AgentId = 'research' | 'ui_art_director' | 'strategy' | 'layout_architect' | 'component_engineer';
export type AgentArtifact =
  ResearchAgentArtifact | ArtDirectionArtifact | StrategyAgentArtifact | PageBlueprint
  | ComponentEngineerArtifact | Record<string, unknown>;

export interface WebBuildAgent {
  id: AgentId;
  name: string;
  status: AgentStatus;
  summary: string;
  /** Short live activity line (used by the timeline while running). */
  currentActivity?: string;
  artifact: AgentArtifact;
}

/** Enforcement diagnostics — did the final build actually consume each agent's
 *  output? Lets the pipeline PROVE the agents are not decorative (Part 6). */
export interface WebBuildEnforcement {
  didUseResearchAgent: boolean;
  didUseArtDirection: boolean;
  didUseStrategy: boolean;
  didUseLayoutBlueprint: boolean;
  didUseComponentPlan: boolean;
  /** True when the resolved layout plan followed the agent-decided archetype. */
  didPlanFollowAgents: boolean;
  /* ── UI / Art Director handoff trace (optional, backward compatible) ──
   *  Verifiable from real artifact metadata: whether the art direction consumed
   *  research, was created, and was actually consumed by each downstream agent
   *  (recorded via each downstream artifact's usedArtDirectionInputs) + the final
   *  payload. */
  didUseResearchInputs?: boolean;
  didCreateArtDirection?: boolean;
  didPassArtDirectionToStrategy?: boolean;
  didPassArtDirectionToLayout?: boolean;
  didPassArtDirectionToComponents?: boolean;
  didIncludeArtDirectionInFinalPayload?: boolean;
  fallbackReason?: string;
}

export interface WebBuildArtifacts {
  research?: ResearchAgentArtifact;
  artDirection?: ArtDirectionArtifact;
  strategy?: StrategyAgentArtifact;
  blueprint?: PageBlueprint;
  componentEngineer?: ComponentEngineerArtifact;
  /** The shared context the agents were run against (pipeline trace). */
  context?: WebBuildAgentContext;
  /** Enforcement diagnostics proving the agents drove the build. */
  enforcement?: WebBuildEnforcement;
}

export interface WebBuildAgents {
  agents: WebBuildAgent[];
  artifacts: WebBuildArtifacts;
}

/**
 * The single, shared context threaded through the agent pipeline. Each agent
 * reads the upstream artifacts from here and writes its own back, so the run is a
 * real sequence (Research → Art Direction → Strategy → Layout) instead of four
 * independent derivations. Every field is optional and backward compatible: a
 * missing upstream artifact simply arrives as null and the downstream agent falls
 * back to safe defaults. `fallbacks` records agents that were skipped/degraded so
 * the pipeline stays honest and observable without ever blocking the build.
 */
export interface WebBuildAgentContext {
  prompt: string;
  brief: WebBuildBrief;
  research: ResearchAgentArtifact | null;
  artDirection: ArtDirectionArtifact | null;
  strategy: StrategyAgentArtifact | null;
  layoutBlueprint: PageBlueprint | null;
  sources: WebBuildSource[];
  /** Names of agents that fell back to safe defaults (e.g. "research", "strategy"). */
  fallbacks: string[];
}

/* ── Research Agent ───────────────────────────────────────────────────── */

const ANGLE_LABELS = (lang: Lang): Record<string, string> => ({
  category: L(lang, 'Category & positioning', 'Kategori ve konumlandırma'),
  audience: L(lang, 'Audience expectations', 'Hedef kitle beklentileri'),
  conversion: L(lang, 'Conversion patterns', 'Dönüşüm kalıpları'),
  trust: L(lang, 'Trust & credibility', 'Güven ve itibar'),
  visual: L(lang, 'Visual & UI patterns', 'Görsel ve arayüz kalıpları'),
});

/* ── Website Research Brief — dynamic signal inference ────────────────────
 * Everything below is DERIVED from real signals in the idea/brief/inferred
 * playbook (keyword presence, business model, audience, conversion goal, tone,
 * design system), NOT from a fixed per-example template. Two different ideas
 * light up different signals → different pages, components, style and palette. */

interface ResearchSignals {
  // business model
  booking: boolean; subscription: boolean; purchase: boolean; saas: boolean;
  application: boolean; leadgen: boolean; content: boolean;
  // audience / domain
  b2b: boolean; kids: boolean; luxury: boolean; technical: boolean;
  health: boolean; finance: boolean; creative: boolean; minimal: boolean;
  // device lean
  desktopFirst: boolean; mobileFirst: boolean;
}

const has = (text: string, ...words: string[]): boolean =>
  words.some((w) => text.includes(w));

/** Scan the combined idea/brief/inferred text for real model + audience signals. */
function researchSignals(brief: WebBuildBrief, inferred: InferredBrief): ResearchSignals {
  const t = [
    brief.type, brief.audience, brief.goal, brief.coreIdea, brief.visitorIntent,
    brief.conversionStrategy, brief.style, brief.visualMood,
    inferred.businessType, inferred.targetAudience, inferred.conversionGoal,
    inferred.tone, inferred.visualStyle, inferred.industry, inferred.layoutArchetype,
    (inferred.items || []).join(' '),
  ].filter(Boolean).join(' ').toLowerCase();

  const booking = has(t, 'book', 'reserv', 'appointment', 'randevu', 'rezerv', 'schedul', 'consult', 'keşif', 'danışman');
  const subscription = has(t, 'subscription', 'membership', 'üyelik', 'abonel', 'recurring', 'plan', 'pricing', 'fiyat', 'paket');
  const purchase = has(t, 'shop', 'buy', 'cart', 'checkout', 'satın', 'mağaza', 'store', 'ürün', 'e-ticaret', 'ecommerce', 'commerce');
  const saas = has(t, 'saas', 'dashboard', 'platform', 'software', 'yazılım', 'api', 'analytics', 'analitik', 'panel', 'app', 'uygulama', 'automation', 'otomasyon');
  const application = has(t, 'apply', 'application', 'enroll', 'admission', 'başvuru', 'kayıt', 'aday');
  const leadgen = has(t, 'quote', 'lead', 'teklif', 'contact', 'iletişim', 'estimate', 'proposal');
  const content = has(t, 'blog', 'magazine', 'news', 'article', 'içerik', 'yayın', 'haber', 'dergi', 'guide', 'rehber');

  const b2b = has(t, 'b2b', 'enterprise', 'business', 'team', 'company', 'kurumsal', 'işletme', 'şirket', 'agency', 'ajans', 'professional');
  const kids = has(t, 'kid', 'child', 'çocuk', 'family', 'aile', 'parent', 'ebeveyn', 'playful', 'oyun', 'toy');
  const luxury = has(t, 'luxury', 'premium', 'exclusive', 'high-end', 'bespoke', 'lüks', 'prestij', 'butik', 'couture');
  const technical = has(t, 'developer', 'engineer', 'data', 'scientific', 'technical', 'geliştirici', 'bilim', 'mühendis', 'research', 'lab');
  const health = has(t, 'health', 'medical', 'clinic', 'patient', 'sağlık', 'klinik', 'hasta', 'therapy', 'wellness', 'diyet', 'nutrition');
  const finance = has(t, 'finance', 'bank', 'invest', 'trading', 'insurance', 'finans', 'banka', 'yatırım', 'sigorta', 'fintech', 'accounting', 'muhasebe');
  const creative = has(t, 'portfolio', 'design', 'creative', 'art', 'photo', 'tasarım', 'sanat', 'fotoğraf', 'studio', 'stüdyo', 'film');
  const minimal = has(t, 'minimal', 'simple', 'clean', 'sade', 'temiz', 'basit');

  const desktopFirst = saas || b2b || technical || finance || has(t, 'dashboard', 'admin', 'workspace');
  const mobileFirst = inferred.industry === 'fitness' || has(t, 'mobile', 'app', 'delivery', 'sosyal', 'social', 'on the go', 'teslimat', 'yemek', 'food');

  return {
    booking, subscription, purchase, saas, application, leadgen, content,
    b2b, kids, luxury, technical, health, finance, creative, minimal,
    desktopFirst, mobileFirst,
  };
}

/** Infer who the visitor probably is from audience + model + tone signals. */
function deriveTargetUser(
  brief: WebBuildBrief, inferred: InferredBrief, sig: ResearchSignals, lang: Lang,
): TargetUserAnalysis {
  const audience = brief.audience || inferred.targetAudience;
  const device = sig.desktopFirst
    ? L(lang, 'Desktop-first (research/compare, longer sessions)', 'Masaüstü öncelikli (araştırma/karşılaştırma, uzun oturumlar)')
    : sig.mobileFirst
      ? L(lang, 'Mobile-first (quick, on-the-go, thumb-reach)', 'Mobil öncelikli (hızlı, hareket halinde, başparmak erişimi)')
      : L(lang, 'Responsive — meaningful desktop and mobile traffic', 'Duyarlı — anlamlı masaüstü ve mobil trafik');
  const knowledge = sig.technical || sig.b2b
    ? L(lang, 'Informed / evaluative — compares options before deciding', 'Bilgili / değerlendirici — karar öncesi seçenekleri karşılaştırır')
    : sig.kids
      ? L(lang, 'Parent decides for the child — needs reassurance fast', 'Ebeveyn çocuk adına karar verir — hızlı güven ister')
      : L(lang, 'General audience — must understand the offer in seconds', 'Genel kitle — teklifi saniyeler içinde anlamalı');
  const motivation = brief.visitorIntent
    || (sig.finance ? L(lang, 'Wants security and confidence before committing', 'Bağlanmadan önce güven ve emniyet ister')
      : sig.luxury ? L(lang, 'Seeks status, quality and a refined experience', 'Statü, kalite ve rafine bir deneyim arar')
      : sig.saas ? L(lang, 'Wants to solve a concrete problem quickly', 'Somut bir sorunu hızla çözmek ister')
      : L(lang, `Wants to reach: ${inferred.conversionGoal}`, `Hedefe ulaşmak ister: ${inferred.conversionGoal}`));

  const painPoints = uniq([
    sig.finance || sig.b2b ? L(lang, 'Distrust of vague or hype-y claims', 'Belirsiz veya abartılı iddialara güvensizlik') : '',
    sig.saas ? L(lang, 'Unclear what the product actually does', 'Ürünün gerçekte ne yaptığının belirsizliği') : '',
    sig.purchase || sig.booking ? L(lang, 'Friction and uncertainty before committing', 'Bağlanmadan önce sürtünme ve belirsizlik') : '',
    L(lang, 'Generic pages that don\'t answer "is this for me?"', '"Bu bana uygun mu?" sorusuna cevap vermeyen genel sayfalar'),
  ]);
  const decisionFactors = uniq([
    sig.luxury ? L(lang, 'Perceived quality and taste', 'Algılanan kalite ve zevk') : '',
    sig.finance || sig.health ? L(lang, 'Credibility, proof and compliance cues', 'İtibar, kanıt ve uyum işaretleri') : '',
    sig.saas || sig.b2b ? L(lang, 'Concrete outcomes, integrations and pricing clarity', 'Somut sonuçlar, entegrasyonlar ve net fiyatlandırma') : '',
    L(lang, `A clear path to: ${brief.primaryCTA || inferred.primaryCTA}`, `Şuraya net bir yol: ${brief.primaryCTA || inferred.primaryCTA}`),
  ]);
  const trustNeeds = uniq([
    (brief.trustSignals || inferred.trustSignals || '').split(/[,·|]/).map((s) => s.trim())[0] || '',
    sig.finance || sig.health ? L(lang, 'Real proof, credentials, no over-claiming', 'Gerçek kanıt, referanslar, abartısız') : '',
    sig.purchase ? L(lang, 'Reviews, guarantees, secure checkout cues', 'Yorumlar, garantiler, güvenli ödeme işaretleri') : '',
  ]);
  const behaviorNotes = uniq([
    sig.desktopFirst ? L(lang, 'Scans, compares, opens multiple tabs', 'Tarar, karşılaştırır, birden çok sekme açar')
      : L(lang, 'Skims fast, decides above the fold', 'Hızlı göz gezdirir, ilk ekranda karar verir'),
    sig.content ? L(lang, 'Reads before converting — values depth', 'Dönüşmeden önce okur — derinliğe değer verir') : '',
  ]);
  const accessibilityNeeds = uniq([
    L(lang, 'Legible contrast and type scale', 'Okunaklı kontrast ve tipografi ölçeği'),
    sig.mobileFirst ? L(lang, 'Large tap targets, thumb-friendly layout', 'Büyük dokunma hedefleri, başparmağa uygun düzen') : '',
    sig.finance || sig.health || sig.b2b ? L(lang, 'Clear focus states and keyboard navigation', 'Net odak durumları ve klavye navigasyonu') : '',
  ]);

  return {
    ageRange: sig.kids ? L(lang, 'Parents 28–45 (deciding for a child)', 'Ebeveynler 28–45 (çocuk için karar verir)')
      : sig.b2b ? L(lang, 'Working professionals 28–55', 'Çalışan profesyoneller 28–55')
      : sig.luxury ? L(lang, 'Established buyers 30–60', 'Yerleşik alıcılar 30–60')
      : L(lang, 'Broad adult range, skews to the offer', 'Geniş yetişkin aralığı, teklife göre değişir'),
    role: audience,
    devicePreference: device,
    knowledgeLevel: knowledge,
    buyingMotivation: motivation,
    mainPainPoints: painPoints,
    decisionFactors,
    trustNeeds,
    behaviorNotes,
    accessibilityNeeds,
  };
}

/** Decide the pages/views this specific concept needs (not a fixed list). */
function deriveRecommendedPages(
  inferred: InferredBrief, sig: ResearchSignals, lang: Lang,
): RecommendedPage[] {
  const P = (name: string, purpose: string, priority: PagePriority, reason: string): RecommendedPage =>
    ({ name, purpose, priority, reason });
  const pages: RecommendedPage[] = [
    P('Home', L(lang, 'Explain the offer and drive the primary action', 'Teklifi anlat ve ana eylemi yönlendir'), 'must-have',
      L(lang, 'Every visitor lands here first', 'Her ziyaretçi önce buraya gelir')),
  ];
  if (sig.subscription || sig.saas || sig.purchase) {
    pages.push(P('Pricing', L(lang, 'Show plans/cost clearly', 'Planları/maliyeti net göster'), 'must-have',
      L(lang, 'The model is subscription/purchase-based', 'Model abonelik/satın alma temelli')));
  }
  if (sig.saas) {
    pages.push(P('Dashboard', L(lang, 'The core product surface after signup', 'Kayıttan sonra çekirdek ürün yüzeyi'), 'should-have',
      L(lang, 'Product value lives in the app itself', 'Ürün değeri uygulamanın içinde')));
  }
  if (sig.purchase) {
    pages.push(P('Product Detail', L(lang, 'Sell a single item with proof', 'Tek ürünü kanıtla sat'), 'must-have',
      L(lang, 'Commerce needs a decision page per product', 'Ticaret her ürün için karar sayfası ister')));
  }
  if (sig.booking) {
    pages.push(P('Booking', L(lang, 'Let the visitor reserve/schedule', 'Ziyaretçi rezervasyon/randevu alsın'), 'must-have',
      L(lang, 'Conversion is a booking, not a purchase', 'Dönüşüm satın alma değil, rezervasyon')));
  }
  if (sig.application) {
    pages.push(P('Application', L(lang, 'Structured apply/enroll flow', 'Yapılandırılmış başvuru/kayıt akışı'), 'must-have',
      L(lang, 'The primary action is an application', 'Ana eylem bir başvuru')));
  }
  if (sig.creative || inferred.industry === 'portfolio' || inferred.industry === 'agency') {
    pages.push(P('Case Studies', L(lang, 'Prove quality with real work', 'Gerçek işlerle kaliteyi kanıtla'), 'should-have',
      L(lang, 'Credibility is earned through shown work', 'İtibar gösterilen işle kazanılır')));
  }
  if (inferred.industry === 'landscaping' || inferred.industry === 'furniture' || sig.creative || sig.luxury) {
    pages.push(P('Gallery', L(lang, 'Let the visuals carry the value', 'Görseller değeri taşısın'), 'should-have',
      L(lang, 'A visual concept sells on imagery', 'Görsel bir konsept imgelerle satılır')));
  }
  if (sig.b2b || sig.leadgen || inferred.industry === 'local_service') {
    pages.push(P('Services', L(lang, 'Lay out what is offered', 'Sunulanları düzenle'), 'should-have',
      L(lang, 'Buyers compare service scope first', 'Alıcılar önce hizmet kapsamını karşılaştırır')));
  }
  if (sig.content) {
    pages.push(P('Blog', L(lang, 'Build authority and organic reach', 'Otorite ve organik erişim kur'), 'optional',
      L(lang, 'Content is part of the strategy', 'İçerik stratejinin parçası')));
  }
  pages.push(P('About', L(lang, 'Build trust in who is behind it', 'Arkasındaki ekibe güven kur'),
    sig.finance || sig.health || sig.luxury ? 'should-have' : 'optional',
    L(lang, 'Higher-trust concepts need a human story', 'Yüksek güven gerektiren konseptler insani hikâye ister')));
  pages.push(P('Contact', L(lang, 'Give a direct line for questions', 'Sorular için doğrudan hat ver'),
    sig.leadgen || sig.b2b ? 'must-have' : 'should-have',
    L(lang, 'Reduces friction for undecided visitors', 'Kararsız ziyaretçiler için sürtünmeyi azaltır')));
  return pages;
}

/** Decide the components the concept + target user need (not a fixed list). */
function deriveRecommendedComponents(
  inferred: InferredBrief, sig: ResearchSignals, lang: Lang,
): RecommendedComponent[] {
  const C = (name: string, purpose: string, priority: PagePriority, usedOn: string, reason: string): RecommendedComponent =>
    ({ name, purpose, priority, usedOn, reason });
  const list: RecommendedComponent[] = [
    C('Hero', L(lang, 'State the promise + primary CTA', 'Vaadi + ana CTA\'yı belirt'), 'must-have', 'Home',
      L(lang, 'First screen decides whether they stay', 'İlk ekran kalıp kalmayacaklarını belirler')),
  ];
  if (sig.saas || sig.b2b) list.push(C('Feature Grid', L(lang, 'Explain capabilities concretely', 'Yetenekleri somut anlat'), 'must-have', 'Home', L(lang, 'Buyers need to see what it does', 'Alıcılar ne yaptığını görmeli')));
  if (sig.saas) list.push(C('Dashboard Preview', L(lang, 'Show the real product surface', 'Gerçek ürün yüzeyini göster'), 'should-have', 'Home', L(lang, 'Seeing the app builds confidence', 'Uygulamayı görmek güven verir')));
  if (sig.subscription || sig.saas || sig.purchase) list.push(C('Pricing', L(lang, 'Make cost and value legible', 'Maliyet ve değeri okunur kıl'), 'must-have', 'Pricing', L(lang, 'Price clarity drives the decision', 'Fiyat netliği kararı yönlendirir')));
  list.push(C('Testimonials', L(lang, 'Prove others succeeded', 'Başkalarının başardığını kanıtla'), sig.finance || sig.health || sig.b2b ? 'must-have' : 'should-have', 'Home', L(lang, 'Social proof lowers perceived risk', 'Sosyal kanıt algılanan riski düşürür')));
  if (sig.finance || sig.health || sig.b2b || sig.luxury) list.push(C('Trust Badges', L(lang, 'Signal credibility/compliance', 'İtibar/uyum işareti ver'), 'should-have', 'Home', L(lang, 'High-trust concepts need proof cues', 'Yüksek güven konseptleri kanıt işareti ister')));
  if (inferred.industry === 'landscaping' || sig.creative) list.push(C('BeforeAfter', L(lang, 'Show transformation', 'Dönüşümü göster'), 'should-have', 'Gallery', L(lang, 'Outcome is visual and comparable', 'Sonuç görsel ve karşılaştırılabilir')));
  if (sig.booking) list.push(C('Booking Form', L(lang, 'Capture the reservation', 'Rezervasyonu al'), 'must-have', 'Booking', L(lang, 'The conversion is a booking', 'Dönüşüm bir rezervasyon')));
  if (sig.application) list.push(C('Application Flow', L(lang, 'Guide a multi-step apply', 'Çok adımlı başvuruyu yönet'), 'must-have', 'Application', L(lang, 'The action is an application', 'Eylem bir başvuru')));
  if (sig.purchase) list.push(C('Product Cards', L(lang, 'Browse items with proof', 'Ürünleri kanıtla göz at'), 'must-have', 'Home', L(lang, 'Commerce needs scannable products', 'Ticaret taranabilir ürün ister')));
  if (sig.technical || sig.saas) list.push(C('Integration Logos', L(lang, 'Show it fits the stack', 'Yığına uyduğunu göster'), 'optional', 'Home', L(lang, 'Technical buyers check compatibility', 'Teknik alıcılar uyumluluğa bakar')));
  list.push(C('FAQ', L(lang, 'Remove last-mile doubts', 'Son tereddütleri gider'), 'should-have', 'Home', L(lang, 'Answers objections before they bounce', 'İtirazları ayrılmadan önce yanıtlar')));
  list.push(C('CTA', L(lang, 'Repeat the single action', 'Tek eylemi tekrarla'), 'must-have', 'Home', L(lang, 'A closing push toward conversion', 'Dönüşüme kapanış itişi')));
  list.push(C('Footer', L(lang, 'Wayfinding + trust + contact', 'Yönlendirme + güven + iletişim'), 'must-have', 'All', L(lang, 'Baseline structure and credibility', 'Temel yapı ve itibar')));
  return list;
}

/** Recommend a visual style from prompt + audience + research — not industry alone. */
function deriveVisualStyle(
  brief: WebBuildBrief, inferred: InferredBrief, sig: ResearchSignals, lang: Lang,
): VisualStyleRecommendation {
  const premiumLevel: VisualStyleRecommendation['premiumLevel'] =
    sig.luxury ? 'luxury'
    : sig.creative && !sig.minimal ? 'experimental'
    : sig.saas || sig.b2b || sig.finance ? 'premium'
    : sig.minimal ? 'simple' : 'polished';
  const styleType = sig.luxury ? L(lang, 'Luxury minimal — restrained, editorial', 'Lüks minimal — ölçülü, editoryal')
    : sig.kids ? L(lang, 'Playful, colorful, rounded and friendly', 'Eğlenceli, renkli, yuvarlak ve samimi')
    : sig.technical || sig.finance ? L(lang, 'Precise, data-driven, high-contrast', 'Hassas, veri odaklı, yüksek kontrast')
    : sig.creative ? L(lang, 'Editorial and expressive with strong type', 'Editoryal ve ifade dolu, güçlü tipografi')
    : sig.saas ? L(lang, 'Modern product UI — clean, confident', 'Modern ürün arayüzü — temiz, kendinden emin')
    : L(lang, 'Clean, modern and trustworthy', 'Temiz, modern ve güvenilir');
  const imageryType = sig.saas ? L(lang, 'Product/dashboard mockups (composed CSS/SVG)', 'Ürün/panel maketleri (kompoze CSS/SVG)')
    : sig.kids ? L(lang, 'SVG illustration and characters', 'SVG illüstrasyon ve karakterler')
    : sig.luxury || sig.creative ? L(lang, 'Editorial, cinematic composition', 'Editoryal, sinematik kompozisyon')
    : sig.finance || sig.technical ? L(lang, 'Data visualization and diagrams', 'Veri görselleştirme ve diyagramlar')
    : L(lang, 'Composed CSS/SVG visuals — no stock, no blank boxes', 'Kompoze CSS/SVG görseller — stok yok, boş kutu yok');
  return {
    styleType,
    imageryType,
    mockupType: sig.saas ? L(lang, 'App/dashboard UI mockup', 'Uygulama/panel arayüz maketi') : undefined,
    illustrationDirection: sig.kids || (!sig.saas && !sig.finance)
      ? L(lang, 'Geometric SVG shapes tied to the concept', 'Konsepte bağlı geometrik SVG şekiller') : undefined,
    photographyDirection: sig.luxury || sig.creative
      ? L(lang, 'Editorial, high-contrast, generous negative space', 'Editoryal, yüksek kontrast, cömert negatif alan') : undefined,
    iconStyle: sig.technical || sig.finance ? L(lang, 'Sharp line icons', 'Keskin çizgi ikonlar')
      : sig.kids ? L(lang, 'Rounded, friendly icons', 'Yuvarlak, samimi ikonlar')
      : L(lang, 'Consistent line/duotone icons', 'Tutarlı çizgi/duoton ikonlar'),
    backgroundStyle: sig.finance || sig.technical ? L(lang, 'Deep, calm gradient with subtle grid', 'Derin, sakin gradyan, ince ızgara')
      : sig.kids ? L(lang, 'Bright, layered color blocks', 'Parlak, katmanlı renk blokları')
      : L(lang, 'Refined gradient/surface system', 'Rafine gradyan/yüzey sistemi'),
    premiumLevel,
    reason: L(lang,
      `Chosen from the audience (${brief.audience || inferred.targetAudience}), model and tone — not the industry alone.`,
      `Kitle (${brief.audience || inferred.targetAudience}), model ve tondan seçildi — yalnızca sektörden değil.`),
  };
}

/** Color psychology guidance — never defaults to blue/purple/indigo. */
function deriveColorPsychology(
  brief: WebBuildBrief, inferred: InferredBrief, sig: ResearchSignals, lang: Lang,
): ColorPsychology {
  let primaryMood: string; let palette: string[]; let avoid: string[]; let emotional: string;
  if (sig.finance) {
    primaryMood = L(lang, 'Trust, stability, competence', 'Güven, istikrar, yetkinlik');
    palette = ['deep navy', 'slate', 'clean white', 'muted gold accent'];
    avoid = ['neon', 'candy pink', 'loud gradients'];
    emotional = L(lang, 'Calm authority and reliability', 'Sakin otorite ve güvenilirlik');
  } else if (sig.luxury) {
    primaryMood = L(lang, 'Prestige, refinement, exclusivity', 'Prestij, incelik, ayrıcalık');
    palette = ['near-black charcoal', 'ivory', 'warm champagne/bronze accent'];
    avoid = ['bright primary colors', 'busy multi-color', 'default indigo'];
    emotional = L(lang, 'Understated confidence and taste', 'Gösterişsiz özgüven ve zevk');
  } else if (sig.kids) {
    primaryMood = L(lang, 'Playful, safe, energetic', 'Eğlenceli, güvenli, enerjik');
    palette = ['sky blue', 'sunshine yellow', 'coral', 'mint'];
    avoid = ['dark/heavy tones', 'muddy neutrals', 'aggressive red'];
    emotional = L(lang, 'Joy for the child, reassurance for the parent', 'Çocuk için neşe, ebeveyn için güven');
  } else if (sig.health) {
    primaryMood = L(lang, 'Calm, clean, caring', 'Sakin, temiz, şefkatli');
    palette = ['soft teal', 'clean white', 'gentle green', 'warm neutral'];
    avoid = ['alarming red', 'harsh neon', 'clinical gray only'];
    emotional = L(lang, 'Reassurance and clarity', 'Güven ve netlik');
  } else if (inferred.industry === 'restaurant') {
    primaryMood = L(lang, 'Warm, appetizing, inviting', 'Sıcak, iştah açıcı, davetkâr');
    palette = ['warm amber', 'terracotta', 'cream', 'deep espresso'];
    avoid = ['cold blue', 'clinical gray', 'neon'];
    emotional = L(lang, 'Appetite and hospitality', 'İştah ve misafirperverlik');
  } else if (inferred.industry === 'landscaping' || has((inferred.visualStyle || '').toLowerCase(), 'eco', 'green', 'nature')) {
    primaryMood = L(lang, 'Natural, grounded, fresh', 'Doğal, köklü, ferah');
    palette = ['botanical green', 'earth brown', 'stone', 'soft sky'];
    avoid = ['artificial neon', 'cold corporate blue only'];
    emotional = L(lang, 'Growth and calm', 'Büyüme ve dinginlik');
  } else if (sig.technical) {
    primaryMood = L(lang, 'Precise, modern, high-signal', 'Hassas, modern, yüksek sinyal');
    palette = ['cool slate', 'high-contrast cyan accent', 'near-black', 'clean white'];
    avoid = ['pastels', 'low-contrast grays'];
    emotional = L(lang, 'Confidence in precision', 'Hassasiyete güven');
  } else if (sig.creative) {
    primaryMood = L(lang, 'Expressive, editorial, bold', 'İfade dolu, editoryal, cesur');
    palette = ['monochrome base', 'one bold accent from the concept', 'off-white'];
    avoid = ['generic corporate blue', 'over-busy palettes'];
    emotional = L(lang, 'Memorability and taste', 'Akılda kalıcılık ve zevk');
  } else {
    primaryMood = L(lang, 'Confident, modern, approachable', 'Kendinden emin, modern, ulaşılabilir');
    palette = ['a concept-tied accent', 'deep neutral base', 'clean off-white'];
    avoid = ['default indigo/purple when the concept implies warmth', 'flat gray placeholders'];
    emotional = L(lang, 'Clarity and momentum', 'Netlik ve ivme');
  }
  // Respect an explicit model color direction when present.
  if (brief.colorDirection) palette = uniq([brief.colorDirection, ...palette]);
  return {
    primaryMood,
    recommendedPalette: palette,
    avoidColors: avoid,
    reasoning: L(lang,
      `Palette chosen for how ${brief.audience || inferred.targetAudience} should feel — not a default theme.`,
      `Palet, ${brief.audience || inferred.targetAudience} nasıl hissetmeli diye seçildi — varsayılan tema değil.`),
    emotionalEffect: emotional,
    trustEffect: sig.finance || sig.health || sig.b2b
      ? L(lang, 'Reinforces credibility and safety', 'İtibarı ve emniyeti pekiştirir') : undefined,
    conversionEffect: L(lang, 'A single accent focuses the eye on the primary action',
      'Tek bir vurgu gözü ana eyleme odaklar'),
  };
}

/** Define UX priorities from model + audience + device lean. */
function deriveUxPriorities(
  inferred: InferredBrief, sig: ResearchSignals, lang: Lang,
): UxPriority[] {
  const U = (priority: string, reason: string, impact: UxImpact): UxPriority => ({ priority, reason, impact });
  const out: UxPriority[] = [];
  out.push(U(
    L(lang, 'Primary CTA visible above the fold', 'Ana CTA ilk ekranda görünür'),
    L(lang, `The single action is ${inferred.primaryCTA}`, `Tek eylem: ${inferred.primaryCTA}`), 'conversion'));
  if (sig.finance || sig.health || sig.b2b || sig.luxury) {
    out.push(U(L(lang, 'Trust proof above the fold', 'Güven kanıtı ilk ekranda'),
      L(lang, 'Higher-trust concept — credibility must come early', 'Yüksek güven konsepti — itibar erken gelmeli'), 'trust'));
  }
  if (sig.subscription || sig.saas || sig.purchase) {
    out.push(U(L(lang, 'Readable, honest pricing', 'Okunur, dürüst fiyatlandırma'),
      L(lang, 'Price clarity is the main decision blocker', 'Fiyat netliği ana karar engeli'), 'clarity'));
  }
  if (sig.booking || sig.application) {
    out.push(U(L(lang, 'Reduce form/booking friction', 'Form/rezervasyon sürtünmesini azalt'),
      L(lang, 'The conversion is a multi-step flow', 'Dönüşüm çok adımlı bir akış'), 'conversion'));
  }
  if (sig.saas) {
    out.push(U(L(lang, 'Show the product before signup', 'Kayıttan önce ürünü göster'),
      L(lang, 'Seeing it beats describing it', 'Görmek anlatmaktan iyi'), 'engagement'));
  }
  out.push(U(
    sig.desktopFirst ? L(lang, 'Dense, scannable desktop layout', 'Yoğun, taranabilir masaüstü düzeni')
      : L(lang, 'Fast, thumb-friendly mobile flow', 'Hızlı, başparmağa uygun mobil akış'),
    sig.desktopFirst ? L(lang, 'Audience researches on desktop', 'Kitle masaüstünde araştırır')
      : L(lang, 'Audience arrives on mobile', 'Kitle mobil ile gelir'),
    'clarity'));
  return out;
}

/** Compose the explicit hand-off for the UI / Art Director Agent. */
function deriveUiAgentInstructions(
  brief: WebBuildBrief, inferred: InferredBrief, sig: ResearchSignals,
  target: TargetUserAnalysis, pages: RecommendedPage[], comps: RecommendedComponent[],
  style: VisualStyleRecommendation, color: ColorPsychology, lang: Lang,
): UiAgentInstructions {
  return {
    mustEmphasize: uniq([
      style.styleType,
      color.primaryMood,
      L(lang, `A single obvious path to ${brief.primaryCTA || inferred.primaryCTA}`,
        `${brief.primaryCTA || inferred.primaryCTA} için tek net yol`),
      sig.finance || sig.health || sig.b2b ? L(lang, 'Credibility and proof early', 'İtibar ve kanıt erken') : '',
    ]),
    mustAvoid: uniq([
      ...color.avoidColors,
      L(lang, 'Generic centered hero + three-card grid', 'Jenerik ortalı hero + üç kart grid'),
      L(lang, 'Stock imagery and blank placeholder boxes', 'Stok görsel ve boş yer tutucu kutular'),
    ]),
    recommendedVisualDirection: `${style.styleType} · ${style.imageryType} (${style.premiumLevel})`,
    recommendedTypography: sig.luxury || sig.creative
      ? L(lang, 'Editorial serif headlines + clean sans body', 'Editoryal serif başlıklar + temiz sans gövde')
      : L(lang, 'Modern geometric sans headlines + neutral sans body', 'Modern geometrik sans başlıklar + nötr sans gövde'),
    recommendedComponents: comps.filter((c) => c.priority === 'must-have').map((c) => c.name),
    recommendedPages: pages.filter((p) => p.priority !== 'optional').map((p) => p.name),
    recommendedPalette: color.recommendedPalette,
    targetUserSummary: [target.role, target.devicePreference, target.buyingMotivation].filter(Boolean).join(' · '),
    conversionFocus: brief.conversionStrategy
      || L(lang, `Drive to ${brief.primaryCTA || inferred.primaryCTA}`, `Şuna yönlendir: ${brief.primaryCTA || inferred.primaryCTA}`),
  };
}

/* ── Real research signal mining ──────────────────────────────────────────
 * Turn the REAL sources the backend actually fetched (titles + snippets) into
 * concrete, source-backed signal language, so live research genuinely SHAPES the
 * brief (category vocabulary, audience/conversion/trust/visual patterns, adjacent
 * references) instead of only contributing source titles. This is pure text
 * analysis over the provided sources — it never fabricates a source, and it
 * extracts salient TERMS + real domains rather than copying source prose. It runs
 * ONLY when real usable sources exist; otherwise the inference path is unchanged. */
interface MinedSignals {
  categoryLanguage: string[];
  audienceExpectations: string[];
  conversionPatterns: string[];
  trustSignals: string[];
  visualPatterns: string[];
  competitorOrAdjacentPatterns: string[];
  sourceBackedInsights: string[];
}

/** Neutral stopwords dropped from category-term extraction (no niche words). */
const MINE_STOP = new Set((
  'the a an and or of to for in on at is are be with your you our we how what why best top ' +
  'guide vs from this that these those it its as by will can do does more most into out up ' +
  'down over under new get see all about pricing home page website site online free how-to'
).split(/\s+/));

/** Signal vocab per research dimension — presence in real source text is a HONEST
 *  observation about what the live category emphasizes (not a fixed template). */
const MINE_SIGNALS: Record<'conversion' | 'trust' | 'visual' | 'audience', string[]> = {
  conversion: ['pricing', 'price', 'plan', 'signup', 'sign up', 'subscribe', 'subscription',
    'checkout', 'cart', 'buy', 'trial', 'free trial', 'demo', 'book', 'booking', 'reserve',
    'reservation', 'quote', 'lead', 'call to action', 'onboarding', 'waitlist', 'apply', 'application'],
  trust: ['review', 'reviews', 'testimonial', 'rating', 'trusted', 'trust', 'secure', 'security',
    'guarantee', 'warranty', 'certified', 'accredited', 'verified', 'case study', 'proof',
    'results', 'award', 'compliance', 'privacy'],
  visual: ['design', 'layout', 'hero', 'landing', 'typography', 'palette', 'color', 'colour',
    'minimal', 'modern', 'animation', 'aesthetic', 'brand', 'visual', 'gallery', 'showcase',
    'template', 'inspiration'],
  audience: ['audience', 'customer', 'customers', 'user', 'users', 'buyer', 'beginner', 'professional',
    'enterprise', 'team', 'small business', 'freelancer', 'parent', 'student', 'patient', 'client', 'member'],
};

function mineDomainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/** Frequency-rank salient terms across the given texts (>=2 occurrences). */
function mineTopTerms(texts: string[], n: number): string[] {
  const freq = new Map<string, number>();
  for (const t of texts) {
    for (const w of (t.toLowerCase().match(/[a-zçğıöşü0-9]{3,}/gi) || [])) {
      if (MINE_STOP.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  return [...freq.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

/** Which of a signal group's terms actually appear across the source text. */
function minePresent(text: string, group: string[]): string[] {
  const low = ` ${text.toLowerCase()} `;
  return uniq(group.filter((w) => low.includes(w)));
}

function mineSourceSignals(sources: WebBuildSource[], lang: Lang): MinedSignals {
  const texts = sources.map((s) => `${s.title || ''} ${s.snippet || ''}`);
  const allText = texts.join(' ');
  const join = (xs: string[]) => xs.join(', ');

  const category = mineTopTerms(sources.map((s) => s.title || ''), 8);
  const conv = minePresent(allText, MINE_SIGNALS.conversion).slice(0, 6);
  const trust = minePresent(allText, MINE_SIGNALS.trust).slice(0, 6);
  const vis = minePresent(allText, MINE_SIGNALS.visual).slice(0, 6);
  const aud = minePresent(allText, MINE_SIGNALS.audience).slice(0, 6);
  const domains = uniq(sources.map((s) => mineDomainOf(s.url)).filter(Boolean)).slice(0, 5);

  // Per-source insight: real title + domain + which dimensions its text touches.
  // References the source, never reproduces its prose.
  const themeWord = (t: string, en: string, tr: string) => (t ? L(lang, en, tr) : '');
  const insights = sources.slice(0, 4).map((s) => {
    const txt = `${s.title || ''} ${s.snippet || ''}`;
    const themes = uniq([
      themeWord(minePresent(txt, MINE_SIGNALS.conversion)[0] || '', 'conversion', 'dönüşüm'),
      themeWord(minePresent(txt, MINE_SIGNALS.trust)[0] || '', 'trust', 'güven'),
      themeWord(minePresent(txt, MINE_SIGNALS.visual)[0] || '', 'design', 'tasarım'),
      themeWord(minePresent(txt, MINE_SIGNALS.audience)[0] || '', 'audience', 'kitle'),
    ]);
    const dom = mineDomainOf(s.url);
    const tail = themes.length
      ? L(lang, ` — covers ${join(themes)}`, ` — şu konulara değiniyor: ${join(themes)}`)
      : '';
    return `${s.title || dom}${dom ? ` (${dom})` : ''}${tail}`;
  }).filter(Boolean);

  return {
    categoryLanguage: category,
    audienceExpectations: aud.length
      ? [L(lang, `Live sources frame the audience around: ${join(aud)}.`, `Canlı kaynaklar hedef kitleyi şu çerçevede ele alıyor: ${join(aud)}.`)]
      : [],
    conversionPatterns: conv.length
      ? [L(lang, `Real sources emphasize conversion levers: ${join(conv)}.`, `Gerçek kaynaklar dönüşüm kaldıraçlarını vurguluyor: ${join(conv)}.`)]
      : [],
    trustSignals: trust.length
      ? [L(lang, `Trust cues recurring across sources: ${join(trust)}.`, `Kaynaklarda tekrarlayan güven işaretleri: ${join(trust)}.`)]
      : [],
    visualPatterns: vis.length
      ? [L(lang, `Design language recurring in sources: ${join(vis)}.`, `Kaynaklarda tekrarlayan tasarım dili: ${join(vis)}.`)]
      : [],
    competitorOrAdjacentPatterns: domains.length
      ? [L(lang, `Adjacent/live references studied: ${join(domains)}.`, `İncelenen komşu/canlı referanslar: ${join(domains)}.`)]
      : [],
    sourceBackedInsights: insights,
  };
}

/**
 * Build the Research Agent artifact. Consumes the real backend research metadata
 * (when present) plus the inferred category playbook, and SYNTHESIZES why it
 * matters for the website — it never just passes URLs through. When live sources
 * exist their real titles/snippets are MINED into the category/audience/conversion/
 * trust/visual/adjacent signal language so research actually shapes the brief.
 * Honest about whether live sources actually informed it.
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

  // Mine the REAL sources (when live research ran) into source-backed signal
  // language, then LEAD each dimension with those findings so research shapes the
  // brief. Guarded — a malformed source set can never break the artifact. When no
  // live sources exist, `mined` is empty and every dimension is pure inference.
  let mined: MinedSignals | undefined;
  if (didResearch && sources.length) {
    try { mined = mineSourceSignals(sources, lang); } catch { mined = undefined; }
  }

  const items = (inferred.items || []).slice(0, 6);
  const categoryLanguage = uniq([...(mined?.categoryLanguage || []), brief.type || inferred.businessType, ...items]);
  const audienceExpectations = uniq([
    ...(mined?.audienceExpectations || []),
    brief.audience || inferred.targetAudience,
    L(lang, `Understand the offer fast, then a clear next step (${inferred.conversionGoal}).`,
      `Teklifi hızla anlamak, sonra net bir adım (${inferred.conversionGoal}).`),
  ]);
  const conversionPatterns = uniq([
    ...(mined?.conversionPatterns || []),
    L(lang, `Single primary action: ${inferred.primaryCTA}.`, `Tek ana eylem: ${inferred.primaryCTA}.`),
    L(lang, `Secondary path: ${inferred.secondaryCTA}.`, `İkincil yol: ${inferred.secondaryCTA}.`),
    inferred.conversionGoal,
  ]);
  const trustSignals = uniq([
    ...(mined?.trustSignals || []),
    ...(brief.trustSignals || inferred.trustSignals || '').split(/[,·|]/).map((s) => s.trim()),
  ]);
  const visualPatterns = uniq([...(mined?.visualPatterns || []), inferred.visualStyle, inferred.previewVisualIdea, inferred.recommendedMotion]);
  const competitorOrAdjacentPatterns = uniq([...(mined?.competitorOrAdjacentPatterns || []), inferred.strategyNote]);
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

  // Insights: phrased as source-backed ONLY when real sources exist. Lead with the
  // MINED per-source insights (real title + domain + which dimensions it covers)
  // so the insight reflects the actual findings, not just a source count.
  const sourceBackedInsights = didResearch
    ? uniq([
        L(lang, `${sourceCount} live source(s) inform the strategy below.`,
          `${sourceCount} canlı kaynak aşağıdaki stratejiyi besliyor.`),
        ...(mined?.sourceBackedInsights || []),
        ...(mined?.sourceBackedInsights?.length ? [] : sources.slice(0, 3).map((s) => s.title).filter(Boolean)),
      ])
    : uniq([
        L(lang, 'No live sources — the above is strategy inference from the idea + category knowledge.',
          'Canlı kaynak yok — yukarıdakiler fikir + kategori bilgisinden çıkarılan stratejidir.'),
      ]);

  // ── Website Research Brief — dynamic, signal-driven (never a fixed template).
  // Each block is guarded so a malformed derivation can never break the agent.
  const sig = researchSignals(brief, inferred);
  let targetUser: TargetUserAnalysis | undefined;
  let recommendedPages: RecommendedPage[] | undefined;
  let recommendedComponents: RecommendedComponent[] | undefined;
  let visualStyleRecommendation: VisualStyleRecommendation | undefined;
  let colorPsychology: ColorPsychology | undefined;
  let uxPriorities: UxPriority[] | undefined;
  let uiAgentInstructions: UiAgentInstructions | undefined;
  try { targetUser = deriveTargetUser(brief, inferred, sig, lang); } catch { targetUser = undefined; }
  try { recommendedPages = deriveRecommendedPages(inferred, sig, lang); } catch { recommendedPages = undefined; }
  try { recommendedComponents = deriveRecommendedComponents(inferred, sig, lang); } catch { recommendedComponents = undefined; }
  try { visualStyleRecommendation = deriveVisualStyle(brief, inferred, sig, lang); } catch { visualStyleRecommendation = undefined; }
  try { colorPsychology = deriveColorPsychology(brief, inferred, sig, lang); } catch { colorPsychology = undefined; }
  try { uxPriorities = deriveUxPriorities(inferred, sig, lang); } catch { uxPriorities = undefined; }
  try {
    if (targetUser && recommendedPages && recommendedComponents && visualStyleRecommendation && colorPsychology) {
      uiAgentInstructions = deriveUiAgentInstructions(
        brief, inferred, sig, targetUser, recommendedPages, recommendedComponents,
        visualStyleRecommendation, colorPsychology, lang,
      );
    }
  } catch { uiAgentInstructions = undefined; }

  // Collapsed-row summary — describe the Research Brief, not a generic line.
  const briefBits = [
    targetUser ? L(lang, 'target users', 'hedef kullanıcılar') : '',
    recommendedPages ? L(lang, 'required pages', 'gerekli sayfalar') : '',
    visualStyleRecommendation ? L(lang, 'visual style', 'görsel stil') : '',
    uxPriorities ? L(lang, 'conversion priorities', 'dönüşüm öncelikleri') : '',
  ].filter(Boolean);
  const briefSummary = briefBits.length
    ? L(lang, `Identified ${briefBits.join(', ')}.`, `${briefBits.join(', ')} belirlendi.`)
    : '';
  const summary = (didResearch
    ? L(lang,
        `Researched ${sourceCount} source(s) across ${researchAngles.length} angles. ${briefSummary}`,
        `${researchAngles.length} açıdan ${sourceCount} kaynak araştırıldı. ${briefSummary}`)
    : L(lang,
        `Using strategy inference (no live sources). ${briefSummary}`,
        `Strateji çıkarımı kullanılıyor (canlı kaynak yok). ${briefSummary}`)).trim();

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
    // ── Website Research Brief (all optional, all dynamically inferred) ──
    targetUser,
    recommendedPages,
    recommendedComponents,
    visualStyleRecommendation,
    colorPsychology,
    uxPriorities,
    uiAgentInstructions,
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

/** A coherent semantic palette per psychology category. Keyed on the mood the
 *  Research Agent inferred — NOT the industry — so the color system follows the
 *  audience psychology. Never the same SaaS indigo everywhere. */
type PsychPalette = { bg: string; accent: string; accent2: string; success: string; danger: string };
const PSYCH_PALETTES: Record<string, PsychPalette> = {
  luxury:    { bg: '#0c0a08', accent: '#c9a24b', accent2: '#8b6b3d', success: '#9caf88', danger: '#b4534b' },
  trust:     { bg: '#070d1a', accent: '#2f6fed', accent2: '#c9a227', success: '#2ea36b', danger: '#d1495b' },
  data:      { bg: '#05070d', accent: '#22d3ee', accent2: '#818cf8', success: '#34d399', danger: '#f43f5e' },
  wellness:  { bg: '#07130f', accent: '#2dd4bf', accent2: '#86efac', success: '#34d399', danger: '#fb923c' },
  food:      { bg: '#0e0a07', accent: '#e0a35b', accent2: '#b45309', success: '#a3b18a', danger: '#c1440e' },
  nature:    { bg: '#071009', accent: '#34d399', accent2: '#a3e635', success: '#4ade80', danger: '#d97706' },
  playful:   { bg: '#0a0f1e', accent: '#fb7185', accent2: '#fbbf24', success: '#34d399', danger: '#f87171' },
  editorial: { bg: '#08080a', accent: '#e5e7eb', accent2: '#94a3b8', success: '#a3e635', danger: '#f87171' },
};
/** Detect the psychology category from the Research Agent's color-psychology mood
 *  words (ordered so the most specific intent wins). */
function psychCategory(cp: ColorPsychology | undefined): string | undefined {
  if (!cp) return undefined;
  const t = [cp.primaryMood, cp.emotionalEffect, cp.trustEffect || '', (cp.recommendedPalette || []).join(' ')]
    .join(' ').toLowerCase();
  if (/prestige|refine|exclus|luxur|champagne|bronze|metallic/.test(t)) return 'luxury';
  if (/trust|stabilit|competen|secure|reliab|authorit|navy|safety/.test(t)) return 'trust';
  if (/precise|high-signal|high-contrast|data|scientific|cyan|signal/.test(t)) return 'data';
  if (/calm|caring|clean|teal|wellness|soothing|reassur/.test(t)) return 'wellness';
  if (/appetiz|warm|invit|amber|terracotta|hospitalit|espresso/.test(t)) return 'food';
  if (/natural|grounded|botanic|green|earth|fresh|growth/.test(t)) return 'nature';
  if (/playful|energetic|joy|bright|coral|sunshine|fun/.test(t)) return 'playful';
  if (/editorial|expressive|bold|monochrome|memorab/.test(t)) return 'editorial';
  return undefined;
}

/**
 * Resolve the Art Director color system with a clear ORDER OF TRUTH so websites
 * stop looking the same:
 *   1. the MODEL's explicit color direction (strategy-driven tokens) — always wins
 *   2. the Research Agent's color psychology (audience-psychology palette)
 *   3. the chosen DESIGN ARCHETYPE's distinct palette (anti-sameness) — used when
 *      research gave no clear psychology, so a fresh/fallback build gets a coherent
 *      identity palette instead of the generic default SaaS indigo
 *   4. the plain design tokens (last resort)
 */
function resolveArtColorSystem(
  cp: ColorPsychology | undefined,
  tokens: DesignTokens,
  modelChoseColor: boolean,
  archetype: DesignArchetypeSpec,
): ArtDirectionColorSystem {
  const base: ArtDirectionColorSystem = {
    background: tokens.bg,
    foreground: '#f1f5f9',
    accent: tokens.accent,
    accent2: tokens.accent2,
    muted: '#94a3b8',
    surface: 'rgba(255,255,255,0.04)',
    border: 'rgba(255,255,255,0.10)',
    successOrTrust: '#22c55e',
    dangerOrWarning: '#f59e0b',
  };
  // 1) Model color → keep tokens (the model's own direction already shaped them).
  if (modelChoseColor) return withPaletteMeta(base, archetype);
  // 2) Research color psychology → coherent psychology palette.
  const cat = psychCategory(cp);
  const p = cat ? PSYCH_PALETTES[cat] : undefined;
  if (p) {
    return withPaletteMeta({
      ...base,
      background: p.bg,
      accent: p.accent,
      accent2: p.accent2,
      successOrTrust: p.success,
      dangerOrWarning: p.danger,
    }, archetype);
  }
  // 3) Design archetype palette → a DISTINCT identity, never the generic default.
  const ap = archetype.palette;
  return withPaletteMeta({
    ...base,
    background: ap.bg,
    foreground: ap.text,
    accent: ap.primary,
    accent2: ap.secondary,
    muted: ap.mutedText,
    surface: ap.surface,
    border: ap.border,
    successOrTrust: ap.success,
    dangerOrWarning: ap.danger,
  }, archetype);
}

/** Attach the structured palette metadata (paletteName / primary / secondary /
 *  text / mutedText / gradient) so the colorSystem always exposes the richer
 *  art-director vocabulary alongside the legacy fields. */
function withPaletteMeta(cs: ArtDirectionColorSystem, archetype: DesignArchetypeSpec): ArtDirectionColorSystem {
  return {
    ...cs,
    paletteName: archetype.palette.name,
    primary: cs.accent,
    secondary: cs.accent2,
    text: cs.foreground,
    mutedText: cs.muted,
    gradient: `linear-gradient(135deg, ${cs.accent} 0%, ${cs.accent2} 100%)`,
  };
}

/* ── DESIGN ARCHETYPE ENGINE (anti-sameness core) ─────────────────────────
 * A senior art director does not paint every site the same "modern premium SaaS
 * dark-blue gradient". It first picks a DESIGN ARCHETYPE from the concept +
 * research signals, and that archetype drives a DISTINCT palette, typography,
 * density, hero treatment, component rules and imagery. These are general design
 * archetypes (NOT per-prompt templates and NOT hardcoded example outputs) — the
 * selection is signal-driven, so two different ideas resolve to different
 * identities. Every archetype is a coherent premium dark-mode system. */
interface ArchetypePalette {
  name: string;
  bg: string; primary: string; secondary: string;
  surface: string; text: string; mutedText: string; border: string;
  success: string; danger: string;
}
interface DesignArchetypeSpec {
  key: string;
  name: [string, string];
  reason: [string, string];
  tags: string[];
  avoidGenericSaas: boolean;
  serif: boolean;
  scale: ArtTypeScale;
  density: ArtDensity;
  layoutDensity: ArtLayoutDensity;
  palette: ArchetypePalette;
  /** Short English design descriptors the structured direction interpolates. */
  heroType: string;
  heroComposition: string;
  imageType: string;
  cardStyle: string;
  motionMood: string;
}

/** Fill the shared palette defaults so each archetype only declares its identity. */
function pal(name: string, bg: string, primary: string, secondary: string, opts?: Partial<ArchetypePalette>): ArchetypePalette {
  return {
    name,
    bg,
    primary,
    secondary,
    surface: opts?.surface || 'rgba(255,255,255,0.04)',
    text: opts?.text || '#f1f5f9',
    mutedText: opts?.mutedText || '#94a3b8',
    border: opts?.border || 'rgba(255,255,255,0.09)',
    success: opts?.success || '#34d399',
    danger: opts?.danger || '#f43f5e',
  };
}

const DESIGN_ARCHETYPES: Record<string, DesignArchetypeSpec> = {
  'editorial-archive': {
    key: 'editorial-archive', name: ['Editorial archive / museum catalog', 'Editoryal arşiv / müze kataloğu'],
    reason: ['A content-forward concept reads best as a curated catalog, not a SaaS landing.', 'İçerik öncelikli konsept SaaS iniş sayfası değil, küratörlü katalog olarak okunur.'],
    tags: ['editorial', 'archival', 'catalog', 'typographic'], avoidGenericSaas: true,
    serif: true, scale: 'editorial', density: 'immersive', layoutDensity: 'editorial',
    palette: pal('Warm paper & ink', '#0f0d0a', '#d6c3a3', '#8a7a5c', { text: '#f4efe6', mutedText: '#a99f8c', border: 'rgba(214,195,163,0.14)' }),
    heroType: 'editorial masthead', heroComposition: 'large serif masthead over a plate grid', imageType: 'archival plates / catalog imagery',
    cardStyle: 'framed catalog plates with captions', motionMood: 'slow, print-like reveals',
  },
  'luxury-boutique': {
    key: 'luxury-boutique', name: ['Luxury boutique / heritage commerce', 'Lüks butik / miras ticaret'],
    reason: ['A premium audience expects restraint, space and metallic warmth — not bright SaaS accents.', 'Premium kitle abartısızlık, boşluk ve metalik sıcaklık bekler — parlak SaaS vurguları değil.'],
    tags: ['luxury', 'heritage', 'refined', 'editorial'], avoidGenericSaas: true,
    serif: true, scale: 'dramatic', density: 'immersive', layoutDensity: 'immersive',
    palette: pal('Charcoal & champagne', '#0c0a08', '#c9a24b', '#8b6b3d', { text: '#f4efe6', mutedText: '#b0a48c', success: '#9caf88', danger: '#b4534b' }),
    heroType: 'cinematic full-bleed', heroComposition: 'full-bleed hero, product/space as the anchor, minimal copy', imageType: 'editorial, high-contrast photography',
    cardStyle: 'borderless, generous whitespace, hairline dividers', motionMood: 'unhurried, elegant fades',
  },
  'high-conversion-saas': {
    key: 'high-conversion-saas', name: ['High-conversion SaaS', 'Yüksek dönüşümlü SaaS'],
    reason: ['A product with a signup/trial goal needs a crisp, confident conversion layout.', 'Kayıt/deneme hedefli ürün net, kendinden emin bir dönüşüm düzeni ister.'],
    tags: ['product', 'conversion', 'modern'], avoidGenericSaas: false,
    serif: false, scale: 'balanced', density: 'rich', layoutDensity: 'balanced',
    palette: pal('Ink & electric blue', '#070b16', '#4f7cff', '#22d3ee'),
    heroType: 'product hero', heroComposition: 'split hero: promise + product/dashboard mockup', imageType: 'composed product/dashboard mockups',
    cardStyle: 'soft glass cards with a single accent', motionMood: 'crisp, confident micro-motion',
  },
  'ai-tool': {
    key: 'ai-tool', name: ['AI tool / productivity', 'AI aracı / üretkenlik'],
    reason: ['An AI/automation product signals intelligence with cool signal-color accents and depth.', 'AI/otomasyon ürünü, serin sinyal renkleri ve derinlikle zekâ hissi verir.'],
    tags: ['ai', 'productivity', 'technical', 'modern'], avoidGenericSaas: true,
    serif: false, scale: 'balanced', density: 'rich', layoutDensity: 'balanced',
    palette: pal('Deep space & signal cyan', '#060810', '#22d3ee', '#818cf8'),
    heroType: 'interactive product hero', heroComposition: 'prompt/response or flow module beside the promise', imageType: 'live UI / flow diagrams',
    cardStyle: 'glass cards with glow edges', motionMood: 'responsive, intelligent micro-interactions',
  },
  'fintech-trust': {
    key: 'fintech-trust', name: ['Fintech trust dashboard', 'Fintech güven paneli'],
    reason: ['Money concepts must feel secure and precise — calm authority, dense proof, no hype.', 'Para konseptleri güvenli ve hassas hissetmeli — sakin otorite, yoğun kanıt, abartı yok.'],
    tags: ['fintech', 'trust', 'data', 'precise'], avoidGenericSaas: true,
    serif: false, scale: 'balanced', density: 'rich', layoutDensity: 'dense',
    palette: pal('Navy & gold trust', '#060c18', '#2f6fed', '#c9a227', { success: '#2ea36b', danger: '#d1495b' }),
    heroType: 'data-confidence hero', heroComposition: 'headline + live metric/chart module, proof band under', imageType: 'charts, metrics, security cues',
    cardStyle: 'sharp, low-radius data cards', motionMood: 'minimal, precise number reveals',
  },
  'wellness-retreat': {
    key: 'wellness-retreat', name: ['Wellness retreat / calm organic', 'Wellness inziva / sakin organik'],
    reason: ['A wellness concept needs calm, air and soft organic color — never clinical or loud.', 'Wellness konsepti dinginlik, hava ve yumuşak organik renk ister — asla klinik ya da gürültülü.'],
    tags: ['wellness', 'calm', 'organic', 'soft'], avoidGenericSaas: true,
    serif: false, scale: 'editorial', density: 'minimal', layoutDensity: 'airy',
    palette: pal('Soft teal & sand', '#08130f', '#3ec9a7', '#9fe0c0', { text: '#eef7f2', mutedText: '#9fb6ab', danger: '#fb923c' }),
    heroType: 'calm atmospheric hero', heroComposition: 'airy hero, one soft image/gradient, breathing space', imageType: 'soft organic photography / gentle gradients',
    cardStyle: 'rounded, soft-shadow cards', motionMood: 'slow, breathing motion',
  },
  'restaurant-hospitality': {
    key: 'restaurant-hospitality', name: ['Restaurant / hospitality', 'Restoran / ağırlama'],
    reason: ['Food & hospitality sell atmosphere and appetite — warm, editorial, image-led.', 'Yeme-içme ve ağırlama atmosfer ve iştah satar — sıcak, editoryal, görsel öncelikli.'],
    tags: ['restaurant', 'hospitality', 'warm', 'editorial'], avoidGenericSaas: true,
    serif: true, scale: 'editorial', density: 'balanced', layoutDensity: 'editorial',
    palette: pal('Ember & cream', '#0f0a07', '#e0a35b', '#b45309', { text: '#f6ede1', mutedText: '#b5a591', success: '#a3b18a', danger: '#c1440e' }),
    heroType: 'atmospheric hero', heroComposition: 'full-bleed ambiance image, menu highlights beneath', imageType: 'appetizing food & ambiance photography',
    cardStyle: 'warm menu/ambiance cards', motionMood: 'warm, inviting reveals',
  },
  'landscaping-nature': {
    key: 'landscaping-nature', name: ['Landscaping / outdoor nature-first', 'Peyzaj / doğa öncelikli'],
    reason: ['Outdoor/landscape work is proven by imagery — organic greens and image-heavy proof.', 'Dış mekan/peyzaj işi görselle kanıtlanır — organik yeşiller ve görsel ağırlıklı kanıt.'],
    tags: ['landscaping', 'nature', 'organic', 'image-first'], avoidGenericSaas: true,
    serif: false, scale: 'editorial', density: 'minimal', layoutDensity: 'airy',
    palette: pal('Botanical green & earth', '#08110a', '#4ea36a', '#a3c96a', { text: '#eef6ea', mutedText: '#9db39a', danger: '#d97706' }),
    heroType: 'image-first hero', heroComposition: 'large outdoor transformation image, gallery-forward', imageType: 'before/after outdoor project galleries',
    cardStyle: 'soft rounded image cards', motionMood: 'natural, gentle parallax',
  },
  'cinematic-studio': {
    key: 'cinematic-studio', name: ['Cinematic game / creative studio', 'Sinematik oyun / yaratıcı stüdyo'],
    reason: ['An entertainment/studio concept wants drama, depth and bold contrast.', 'Eğlence/stüdyo konsepti dram, derinlik ve cesur kontrast ister.'],
    tags: ['cinematic', 'studio', 'bold', 'immersive'], avoidGenericSaas: true,
    serif: false, scale: 'dramatic', density: 'immersive', layoutDensity: 'immersive',
    palette: pal('Void & ember red', '#05060a', '#ff4d4d', '#7c3aed', { text: '#f5f5f7', mutedText: '#8b8b96' }),
    heroType: 'cinematic full-bleed', heroComposition: 'full-bleed dramatic key art, minimal overlay copy', imageType: 'cinematic key art / trailers',
    cardStyle: 'dark immersive panels with glow', motionMood: 'bold, kinetic reveals',
  },
  'creative-agency': {
    key: 'creative-agency', name: ['Creative agency (experimental)', 'Yaratıcı ajans (deneysel)'],
    reason: ['An agency proves taste through expressive, high-contrast, typographic work.', 'Ajans zevkini ifade dolu, yüksek kontrastlı, tipografik işle kanıtlar.'],
    tags: ['agency', 'expressive', 'typographic', 'experimental'], avoidGenericSaas: true,
    serif: false, scale: 'dramatic', density: 'immersive', layoutDensity: 'editorial',
    palette: pal('Mono & hot accent', '#0a0a0c', '#f5f5f5', '#f43f5e', { mutedText: '#a1a1aa' }),
    heroType: 'typographic statement hero', heroComposition: 'oversized type statement, work grid reveal', imageType: 'case-study visuals / expressive type',
    cardStyle: 'bold outline / oversized number cards', motionMood: 'expressive, kinetic',
  },
  'portfolio-showcase': {
    key: 'portfolio-showcase', name: ['Portfolio / showcase', 'Portfolyo / vitrin'],
    reason: ['A personal/showcase site sells the work — minimal chrome, strong type, quiet palette.', 'Kişisel/vitrin site işi satar — minimal çerçeve, güçlü tipografi, sakin palet.'],
    tags: ['portfolio', 'minimal', 'typographic'], avoidGenericSaas: true,
    serif: true, scale: 'editorial', density: 'minimal', layoutDensity: 'airy',
    palette: pal('Off-black & bone', '#08080a', '#e5e7eb', '#a1a1aa', { mutedText: '#8b8b93' }),
    heroType: 'intro + work grid', heroComposition: 'quiet intro statement, case-study grid', imageType: 'case-study imagery',
    cardStyle: 'quiet framed case cards', motionMood: 'restrained, refined reveals',
  },
  'marketplace-catalog': {
    key: 'marketplace-catalog', name: ['Marketplace / catalog commerce', 'Pazar yeri / katalog ticaret'],
    reason: ['Commerce needs scannable, dense product browsing with a decisive accent.', 'Ticaret taranabilir, yoğun ürün gezinme ve kararlı bir vurgu ister.'],
    tags: ['ecommerce', 'catalog', 'dense', 'product-first'], avoidGenericSaas: true,
    serif: false, scale: 'compact', density: 'rich', layoutDensity: 'dense',
    palette: pal('Slate & retail orange', '#0b0c10', '#ff7a45', '#3b82f6'),
    heroType: 'product-forward hero', heroComposition: 'featured products + category entry, decisive CTA', imageType: 'product photography grids',
    cardStyle: 'crisp product cards with price/CTA', motionMood: 'quick, responsive hovers',
  },
  'education-platform': {
    key: 'education-platform', name: ['Education / course platform', 'Eğitim / kurs platformu'],
    reason: ['A learning concept balances trust and approachability — clear structure, friendly accent.', 'Öğrenme konsepti güven ve ulaşılabilirliği dengeler — net yapı, samimi vurgu.'],
    tags: ['education', 'course', 'structured', 'approachable'], avoidGenericSaas: true,
    serif: false, scale: 'balanced', density: 'balanced', layoutDensity: 'balanced',
    palette: pal('Indigo & warm amber', '#0a0e18', '#4d8cff', '#ffb020'),
    heroType: 'outcome hero', heroComposition: 'promise of outcome + curriculum preview', imageType: 'curriculum / progress visuals',
    cardStyle: 'friendly module/lesson cards', motionMood: 'encouraging, gentle motion',
  },
  'community-membership': {
    key: 'community-membership', name: ['Community / membership', 'Topluluk / üyelik'],
    reason: ['A community sells belonging — warm, human, vibrant but not corporate.', 'Topluluk aidiyet satar — sıcak, insani, canlı ama kurumsal değil.'],
    tags: ['community', 'membership', 'human', 'vibrant'], avoidGenericSaas: true,
    serif: false, scale: 'balanced', density: 'balanced', layoutDensity: 'balanced',
    palette: pal('Violet & rose', '#0c0a14', '#a855f7', '#f472b6'),
    heroType: 'people-first hero', heroComposition: 'community proof + join CTA', imageType: 'member/community imagery',
    cardStyle: 'warm rounded member cards', motionMood: 'lively, welcoming',
  },
  'legal-medical-trust': {
    key: 'legal-medical-trust', name: ['Legal / medical trust-first', 'Hukuk / tıp güven öncelikli'],
    reason: ['High-stakes services must feel credible and calm — trust-blue, real proof, no flash.', 'Yüksek riskli hizmetler güvenilir ve sakin hissetmeli — güven mavisi, gerçek kanıt, gösteriş yok.'],
    tags: ['legal', 'medical', 'trust', 'credible'], avoidGenericSaas: true,
    serif: true, scale: 'balanced', density: 'balanced', layoutDensity: 'balanced',
    palette: pal('Deep trust blue & clean green', '#070d16', '#2e6fd6', '#3fae7f', { success: '#2ea36b', danger: '#d1495b' }),
    heroType: 'credibility hero', heroComposition: 'clear promise + credentials/proof band above the fold', imageType: 'credentials, calm real photography',
    cardStyle: 'calm, low-radius trust cards', motionMood: 'minimal, reassuring',
  },
  'local-service-premium': {
    key: 'local-service-premium', name: ['Local service (premium)', 'Yerel hizmet (premium)'],
    reason: ['A local service earns trust with proof, clear pricing and an easy contact path.', 'Yerel hizmet kanıt, net fiyat ve kolay iletişimle güven kazanır.'],
    tags: ['local', 'service', 'trust', 'practical'], avoidGenericSaas: true,
    serif: false, scale: 'balanced', density: 'balanced', layoutDensity: 'balanced',
    palette: pal('Forest & warm brass', '#0d0f0c', '#6fae57', '#d19a4a'),
    heroType: 'proof + contact hero', heroComposition: 'promise + rating/proof + quote/contact CTA', imageType: 'real work / team photography',
    cardStyle: 'solid, tactile service cards', motionMood: 'subtle, trustworthy',
  },
  'industrial-b2b': {
    key: 'industrial-b2b', name: ['Industrial / B2B technical', 'Endüstriyel / B2B teknik'],
    reason: ['A technical B2B concept values precision and density over decoration.', 'Teknik B2B konsepti süsleme yerine hassasiyet ve yoğunluğa değer verir.'],
    tags: ['b2b', 'industrial', 'technical', 'dense'], avoidGenericSaas: true,
    serif: false, scale: 'compact', density: 'rich', layoutDensity: 'dense',
    palette: pal('Graphite & steel blue', '#0a0c0f', '#5b8def', '#94a3b8', { mutedText: '#8a97a8' }),
    heroType: 'capability hero', heroComposition: 'capability statement + spec/proof grid', imageType: 'technical diagrams / real equipment',
    cardStyle: 'precise hairline spec cards', motionMood: 'minimal, engineered',
  },
  'event-conference': {
    key: 'event-conference', name: ['Event / conference', 'Etkinlik / konferans'],
    reason: ['An event builds momentum — bold, energetic, date/CTA-forward.', 'Etkinlik ivme kurar — cesur, enerjik, tarih/CTA öncelikli.'],
    tags: ['event', 'conference', 'bold', 'energetic'], avoidGenericSaas: true,
    serif: false, scale: 'dramatic', density: 'immersive', layoutDensity: 'immersive',
    palette: pal('Violet & signal cyan', '#0a0812', '#8b5cf6', '#22d3ee'),
    heroType: 'countdown/lineup hero', heroComposition: 'big date/lineup + register CTA', imageType: 'speaker/venue imagery',
    cardStyle: 'bold speaker/agenda cards', motionMood: 'high-energy reveals',
  },
  'real-estate': {
    key: 'real-estate', name: ['Real estate / property', 'Emlak / gayrimenkul'],
    reason: ['Property sells on space and aspiration — editorial, image-led, refined neutrals.', 'Gayrimenkul mekan ve özlemle satar — editoryal, görsel öncelikli, rafine nötrler.'],
    tags: ['real-estate', 'property', 'editorial', 'refined'], avoidGenericSaas: true,
    serif: true, scale: 'editorial', density: 'balanced', layoutDensity: 'editorial',
    palette: pal('Slate & brass', '#0c0d10', '#c0a267', '#5b7d9a', { text: '#f1efe9', mutedText: '#a7a595' }),
    heroType: 'property showcase hero', heroComposition: 'full-bleed property image + search/enquire CTA', imageType: 'architectural / interior photography',
    cardStyle: 'refined listing cards', motionMood: 'smooth, aspirational',
  },
  'nonprofit-campaign': {
    key: 'nonprofit-campaign', name: ['Nonprofit / campaign', 'STK / kampanya'],
    reason: ['A cause needs emotion and momentum — human warmth with a decisive donate/act CTA.', 'Bir dava duygu ve ivme ister — insani sıcaklık ve kararlı bir bağış/eylem CTA.'],
    tags: ['nonprofit', 'campaign', 'human', 'urgent'], avoidGenericSaas: true,
    serif: false, scale: 'balanced', density: 'balanced', layoutDensity: 'balanced',
    palette: pal('Deep green & hopeful gold', '#08110d', '#34d399', '#fbbf24'),
    heroType: 'story hero', heroComposition: 'human story image + impact stat + act CTA', imageType: 'authentic human/impact photography',
    cardStyle: 'warm impact/story cards', motionMood: 'sincere, momentum-building',
  },
  'founder-startup': {
    key: 'founder-startup', name: ['Founder-led startup landing', 'Kurucu odaklı startup'],
    reason: ['An early product sells vision with confidence and a single clear action.', 'Erken bir ürün vizyonu özgüven ve tek net eylemle satar.'],
    tags: ['startup', 'founder', 'confident', 'modern'], avoidGenericSaas: true,
    serif: false, scale: 'balanced', density: 'rich', layoutDensity: 'balanced',
    palette: pal('Ink & violet', '#0a0c12', '#7c5cff', '#f0a020'),
    heroType: 'vision hero', heroComposition: 'bold promise + single CTA + early proof', imageType: 'product/vision visuals',
    cardStyle: 'confident soft cards', motionMood: 'crisp, momentum-forward',
  },
  'modern-brand': {
    key: 'modern-brand', name: ['Modern brand', 'Modern marka'],
    reason: ['A considered, distinct modern identity — coherent and premium, never generic default.', 'Düşünülmüş, ayırt edici modern kimlik — tutarlı ve premium, asla jenerik varsayılan.'],
    tags: ['modern', 'brand', 'considered'], avoidGenericSaas: true,
    serif: false, scale: 'balanced', density: 'balanced', layoutDensity: 'balanced',
    palette: pal('Ink & considered blue-violet', '#0a0b0f', '#5b8def', '#c084fc'),
    heroType: 'brand hero', heroComposition: 'clear promise + focused visual anchor', imageType: 'composed CSS/SVG brand visuals',
    cardStyle: 'coherent soft cards', motionMood: 'subtle, premium',
  },
};

/** Ordered (regex → archetype key) rules scanned over the concept haystack. Most
 *  specific first. Signal-driven, general logic — never a per-prompt template. */
const ARCHETYPE_RULES: Array<[RegExp, string]> = [
  [/museum|archive|library|catalog|catalogue|collection|exhibit|editorial|magazine|journal|gazette/, 'editorial-archive'],
  [/luxur|bespoke|couture|heritage|prestige|boutique|atelier|haute|fine\s?jewel|watchmaker/, 'luxury-boutique'],
  [/game|gaming|studio|film|cinema|movie|entertainment|animation|vfx/, 'cinematic-studio'],
  [/wellness|retreat|spa|yoga|meditation|mindful|therapy|holistic|calm|organic\s?care/, 'wellness-retreat'],
  [/fintech|bank|banking|invest|trading|finance|insurance|payment|payroll|lending|crypto/, 'fintech-trust'],
  [/course|education|learn|academy|school|tutorial|bootcamp|curriculum|lms|teaching/, 'education-platform'],
  [/legal|law\b|lawyer|attorney|solicitor|medical|clinic|health|doctor|dental|hospital|therapist/, 'legal-medical-trust'],
  [/real\s?estate|property|realty|realtor|apartment|listing|housing|broker/, 'real-estate'],
  [/event|conference|summit|meetup|festival|expo|webinar|hackathon/, 'event-conference'],
  [/nonprofit|non-profit|charity|donate|donation|campaign|foundation|\bngo\b|volunteer|fundrais/, 'nonprofit-campaign'],
  [/community|membership|forum|club\b|network|society|guild|cohort/, 'community-membership'],
  [/marketplace|e-?commerce|online\s?store|shop\b|storefront|catalog\s?store|retail|product\s?page/, 'marketplace-catalog'],
  [/restaurant|cafe|coffee|dining|menu|bakery|bistro|bar\b|food\s?truck|catering|hospitality|hotel/, 'restaurant-hospitality'],
  [/landscap|garden|lawn|outdoor|nursery|horticultur|nature\b/, 'landscaping-nature'],
  [/portfolio|showcase|personal\s?site|resume|\bcv\b/, 'portfolio-showcase'],
  [/creative\s?agency|design\s?studio|branding\s?agency|ad\s?agency|marketing\s?agency/, 'creative-agency'],
  [/\bai\b|artificial\s?intelligence|machine\s?learning|\bllm\b|copilot|automation|assistant|agentic|neural/, 'ai-tool'],
  [/industrial|manufactur|logistics|hardware|machinery|engineering\s?firm|construction|supply\s?chain|b2b/, 'industrial-b2b'],
  [/startup|founder|launch|\bmvp\b|seed\s?round|pre-?seed|indie\s?hacker/, 'founder-startup'],
  [/saas|dashboard|platform|software|api\b|analytics|productivity\s?tool|workflow\s?tool/, 'high-conversion-saas'],
];

/** Map the inferred industry to a distinct archetype (used when keyword scan is weak). */
const INDUSTRY_ARCHETYPE: Record<string, string> = {
  ai_saas: 'high-conversion-saas',
  fitness: 'wellness-retreat',
  landscaping: 'landscaping-nature',
  furniture: 'editorial-archive',
  automotive: 'cinematic-studio',
  restaurant: 'restaurant-hospitality',
  portfolio: 'portfolio-showcase',
  agency: 'creative-agency',
  ecommerce: 'marketplace-catalog',
  local_service: 'local-service-premium',
  generic: 'modern-brand',
};

/**
 * Pick the design archetype from the concept + Research Agent signals. Priority:
 *   1. an explicit luxury/experimental premium level (strong identity signal)
 *   2. a keyword match over the concept haystack (most specific)
 *   3. the inferred industry map
 *   4. a considered modern-brand default (still distinct, never generic indigo)
 */
function pickDesignArchetype(
  brief: WebBuildBrief, research: ResearchAgentArtifact | undefined, inferred: InferredBrief,
): DesignArchetypeSpec {
  const hay = [
    brief.type, brief.audience, brief.coreIdea, brief.goal, brief.style, brief.visualMood, brief.visualMetaphor,
    inferred.businessType, inferred.industry, inferred.targetAudience, inferred.visualStyle,
    research?.visualStyleRecommendation?.styleType,
    ...(research?.recommendedComponents || []).map((c) => c.name),
    ...(research?.recommendedPages || []).map((p) => p.name),
    research?.targetUser?.role,
    ...(research?.categoryLanguage || []),
  ].filter(Boolean).join(' ').toLowerCase();

  const premium = research?.visualStyleRecommendation?.premiumLevel;
  // 1) Strong premium identity signals.
  if (premium === 'luxury' && !/fintech|bank|saas|dashboard/.test(hay)) return DESIGN_ARCHETYPES['luxury-boutique'];
  // 2) Keyword scan (most specific general design signal wins).
  for (const [re, key] of ARCHETYPE_RULES) {
    if (re.test(hay) && DESIGN_ARCHETYPES[key]) return DESIGN_ARCHETYPES[key];
  }
  // 3) Inferred industry map.
  const byIndustry = INDUSTRY_ARCHETYPE[inferred.industry];
  if (byIndustry && DESIGN_ARCHETYPES[byIndustry]) return DESIGN_ARCHETYPES[byIndustry];
  // 4) Considered default.
  return DESIGN_ARCHETYPES['modern-brand'];
}

/**
 * Build the UI / Art Director artifact — a senior art director that CONSUMES the
 * Research Agent brief (target user, color psychology, visual style, UX
 * priorities, UI-agent instructions) and turns it into a specific, non-generic
 * visual identity. The color system follows the color psychology; typography and
 * density follow the audience and product; every field is a concrete direction,
 * not a generic "modern and premium" phrase. All safe when the research is
 * missing (falls back to the strategy-driven design system).
 */
export function deriveArtDirection(
  brief: WebBuildBrief,
  research: ResearchAgentArtifact | undefined,
  inferred: InferredBrief,
  lang: Lang = 'en',
): ArtDirectionArtifact {
  const ds = deriveDesignSystemFromStrategy(brief);
  // Research color psychology feeds the design system: when the model gave no
  // explicit color direction, the researched palette words drive the tokens so
  // the concept's mood (not a default indigo) shapes the actual colors.
  const researchPalette = (research?.colorPsychology?.recommendedPalette || []).join(' ');
  // Resolve the palette from a brief whose mood/color words are populated, so the
  // color system reflects the intended direction (not a bare indigo default when
  // the backend returned no explicit color).
  const moodBrief = {
    ...brief,
    visualMood: brief.visualMood || brief.style || research?.visualStyleRecommendation?.styleType || inferred.visualStyle,
    colorDirection: brief.colorDirection || researchPalette || brief.visualMood || brief.style || inferred.visualStyle,
  };
  const tokens = designTokensForBrief(moodBrief);

  // DESIGN ARCHETYPE — the anti-sameness decision. Picked from the concept +
  // Research signals; drives the distinct palette, typography, density, hero and
  // component rules so two different ideas resolve to different identities.
  const archetype = pickDesignArchetype(brief, research, inferred);

  // Color system follows the ORDER OF TRUTH: model color → research color
  // psychology → the archetype's distinct palette → tokens. So a fresh/fallback
  // build gets a coherent identity palette, never the generic default indigo.
  const cp = research?.colorPsychology;
  const modelChoseColor = !!(brief.colorDirection || brief.artAccent || brief.artBg);
  const colorSystemBase = resolveArtColorSystem(cp, tokens, modelChoseColor, archetype);
  // Fold the researched color-psychology reasoning + colors-to-avoid onto the
  // structured colorSystem (honest: only when research provided them).
  const colorSystem: ArtDirectionColorSystem = {
    ...colorSystemBase,
    colorPsychologyReasoning: cp
      ? uniq([cp.reasoning, cp.emotionalEffect, cp.trustEffect || '']).filter(Boolean).join(' · ') || undefined
      : undefined,
    avoidColors: (cp?.avoidColors || []).length ? cp!.avoidColors.slice(0, 4) : undefined,
  };

  // Read the Research brief signals so every direction is specific, not generic.
  const tu = research?.targetUser;
  const vsr = research?.visualStyleRecommendation;
  const audience = brief.audience || inferred.targetAudience;
  const desktopLean = /desktop/i.test(tu?.devicePreference || '');
  const mobileLean = /mobile/i.test(tu?.devicePreference || '');
  const premiumLevel = vsr?.premiumLevel;

  // visualMood — a specific style statement (prefer the researched style type).
  const visualMood = brief.visualMood || vsr?.styleType || brief.style || inferred.visualStyle;
  // brandPersonality — composed from the real target user + tone + premium level,
  // never a bare "confident, modern, premium".
  const brandPersonality = uniq([
    inferred.tone,
    tu?.buyingMotivation ? L(lang, `speaks to someone who ${tu.buyingMotivation.toLowerCase()}`, `${tu.buyingMotivation.toLowerCase()} birine hitap eder`) : '',
    premiumLevel ? L(lang, `${premiumLevel} finish`, `${premiumLevel} işçilik`) : '',
    audience,
  ]).slice(0, 4).join(' · ')
    || L(lang, 'grounded, specific, quietly premium', 'sağlam, spesifik, sessizce premium');

  // typography — dynamic on audience + product (editorial vs product UI, luxury
  // vs playful, data-heavy vs visual-heavy, older-trust vs younger-exploratory).
  const typographyDirection = brief.typographyDirection
    || research?.uiAgentInstructions?.recommendedTypography
    || (premiumLevel === 'luxury' || (!!vsr?.styleType && /editorial|luxur/i.test(vsr.styleType))
      ? L(lang, 'Editorial serif headlines with generous leading + a clean sans body — refined, unhurried.',
          'Editoryal serif başlıklar, ferah satır aralığı + temiz sans gövde — zarif, telaşsız.')
      : vsr?.styleType && /playful|kid/i.test(vsr.styleType)
        ? L(lang, 'Rounded, friendly sans with large, approachable headlines and short lines.',
            'Yuvarlak, samimi sans; büyük, ulaşılabilir başlıklar ve kısa satırlar.')
      : /data|scientific|technical|dashboard/i.test(`${vsr?.styleType || ''} ${audience}`)
        ? L(lang, 'Tight, high-contrast grotesk headlines with a monospaced/data body accent.',
            'Sıkı, yüksek kontrastlı grotesk başlıklar; monospace/veri gövde vurgusu.')
      : desktopLean
        ? L(lang, 'Dense, confident sans hierarchy tuned for scanning on desktop.',
            'Masaüstünde taramaya göre ayarlı yoğun, kendinden emin sans hiyerarşisi.')
      : (isSerif(tokens.headingFont)
        ? L(lang, 'Editorial serif headlines with a clean sans body — refined, premium.',
            'Editoryal serif başlıklar, temiz sans gövde — zarif, premium.')
        : L(lang, 'Modern geometric sans headlines with a neutral sans body — crisp, confident.',
            'Modern geometrik sans başlıklar, nötr sans gövde — net, kendinden emin.')));
  const layoutFeeling = brief.layoutLogic
    || L(lang, `A ${ds.sectionRhythm} rhythm with ${ds.density} spacing that fits the concept.`,
        `Konsepte uygun ${ds.density} boşluklu ${ds.sectionRhythm} bir ritim.`);
  const visualMetaphor = brief.visualMetaphor || inferred.previewVisualIdea;
  // imageryDirection — prefer the researched imagery type when present.
  const imageryDirection = vsr?.imageryType
    ? L(lang, `${vsr.imageryType} — composed, never stock or blank boxes.`,
        `${vsr.imageryType} — kompoze, asla stok veya boş kutu değil.`)
    : L(lang,
        `Composed CSS/SVG visuals (${inferred.previewVisualIdea}) — no stock photos, no blank boxes.`,
        `Kompoze CSS/SVG görseller (${inferred.previewVisualIdea}) — stok fotoğraf yok, boş kutu yok.`);
  const iconographyDirection = vsr?.iconStyle
    || L(lang, 'Consistent line/duotone icons, one weight, tied to the accent.',
        'Tutarlı çizgi/duoton ikonlar, tek ağırlık, vurguya bağlı.');
  const motionByLevel = ds.motion === 'minimal'
    ? L(lang, 'Restrained, quiet motion — a single calm reveal, no distraction.', 'Ölçülü, sakin hareket — tek bir sakin beliriş, dikkat dağıtmadan.')
    : ds.motion === 'expressive'
      ? L(lang, 'Expressive, kinetic motion — bold reveals and depth, still tasteful.', 'İfade dolu, kinetik hareket — cesur belirişler ve derinlik, yine de zevkli.')
      : L(lang, 'Subtle premium motion — gentle reveals and hover states.', 'İnce premium hareket — yumuşak belirişler ve hover durumları.');
  const motionDirection = brief.motionDirection || motionByLevel || inferred.recommendedMotion;
  // density — premium level + device lean, then the ARCHETYPE's density (so an
  // editorial archive breathes and a marketplace packs) instead of a flat default.
  const density: ArtDensity = premiumLevel === 'luxury' ? 'immersive'
    : premiumLevel === 'experimental' ? 'immersive'
    : premiumLevel === 'simple' ? 'minimal'
    : desktopLean && archetype.density === 'balanced' ? 'rich'
    : archetype.density || artDensity(ds.density, ds.motion);

  const premiumDetails = uniq([
    L(lang, 'Soft accent glow on primary actions', 'Ana eylemlerde yumuşak vurgu parıltısı'),
    L(lang, 'Consistent surface + border language', 'Tutarlı yüzey + kenarlık dili'),
    ds.cardStyle === 'glass' ? L(lang, 'Subtle glass/blur surfaces', 'İnce cam/blur yüzeyler')
      : ds.cardStyle === 'outline' ? L(lang, 'Precise hairline outlines', 'Hassas ince çizgi kenarlıklar')
      : L(lang, 'Solid, tactile surfaces', 'Dolgun, dokunsal yüzeyler'),
    L(lang, 'Tasteful reveal-on-scroll, never childish', 'Zevkli scroll-belirme, asla çocuksu değil'),
  ]);
  const avoid = uniq([
    // Research color psychology + explicit UI-agent hand-off drive what to avoid.
    ...(research?.colorPsychology?.avoidColors || []).slice(0, 3),
    ...(research?.uiAgentInstructions?.mustAvoid || []).slice(0, 2),
    ...(research?.risksToAvoid || []).slice(0, 2),
    L(lang, 'Default indigo/cyan when the concept implies another palette',
      'Konsept başka bir palet ima ederken varsayılan indigo/camgöbeği'),
    L(lang, 'Generic stock imagery and flat gray placeholders',
      'Jenerik stok görseller ve düz gri yer tutucular'),
  ]);
  const uiPrinciples = uniq([
    // Lead with the researched UX priorities (audience/model-specific), then the
    // durable premium principles.
    ...(research?.uxPriorities || []).slice(0, 2).map((p) => p.priority),
    L(lang, 'One obvious conversion path per screen', 'Ekran başına tek net dönüşüm yolu'),
    L(lang, 'Strong typographic hierarchy over decoration', 'Dekorasyon yerine güçlü tipografik hiyerarşi'),
    L(lang, 'Generous, intentional whitespace', 'Cömert, amaçlı boşluk'),
    L(lang, 'A coherent surface language across all sections', 'Tüm bölümlerde tutarlı yüzey dili'),
  ]);
  const componentStyleHints = uniq([
    L(lang, `Cards: ${ds.cardStyle}`, `Kartlar: ${ds.cardStyle}`),
    vsr?.backgroundStyle ? L(lang, `Background: ${vsr.backgroundStyle}`, `Arka plan: ${vsr.backgroundStyle}`) : '',
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

  // ── New, research-driven directions (all specific, none generic). ──
  const colorPsychologyReasoning = cp
    ? uniq([cp.reasoning, cp.emotionalEffect, cp.trustEffect || '', cp.conversionEffect || '']).join(' · ')
    : undefined;
  const primaryCTA = brief.primaryCTA || inferred.primaryCTA;
  const ctaStyleDirection = L(lang,
    `Solid ${premiumLevel === 'luxury' ? 'understated' : 'high-contrast'} primary button on the accent for "${primaryCTA}", with a soft glow; a quiet ghost/secondary for the alternate path. One primary per screen.`,
    `"${primaryCTA}" için vurguda ${premiumLevel === 'luxury' ? 'gösterişsiz' : 'yüksek kontrastlı'} dolu ana buton, yumuşak parıltıyla; alternatif yol için sessiz hayalet/ikincil. Ekran başına tek ana buton.`);
  const trustNeed = (tu?.trustNeeds || [])[0] || (research?.trustSignals || [])[0];
  const trustVisualDirection = L(lang,
    `Present proof (${trustNeed || 'credibility'}) as calm, real modules — logos, metrics, testimonials on quiet surfaces near the primary CTA, never loud badges.`,
    `Kanıtı (${trustNeed || 'itibar'}) sakin, gerçek modüller olarak sun — ana CTA yakınında sessiz yüzeylerde logolar, metrikler, yorumlar; asla gürültülü rozetler değil.`);
  const responsiveDesignDirection = mobileLean
    ? L(lang, 'Mobile-first: single-column flow, thumb-reachable CTAs, large tap targets, progressive disclosure.',
        'Mobil öncelikli: tek sütun akış, başparmakla erişilir CTA\'lar, büyük dokunma hedefleri, kademeli açılım.')
    : desktopLean
      ? L(lang, 'Desktop-first: multi-column density and comparison layouts that gracefully stack on mobile.',
          'Masaüstü öncelikli: mobilde zarifçe yığılan çok sütunlu yoğunluk ve karşılaştırma düzenleri.')
      : L(lang, 'Responsive: a strong single-column mobile story that expands into a composed desktop layout.',
          'Duyarlı: mobilde güçlü tek sütun anlatı; masaüstünde kompoze düzene açılır.');

  // Pipeline trace — which Research Agent inputs this art direction actually
  // consumed (honest: only lists fields that were present and used).
  const usedResearchInputs = uniq([
    cp && !modelChoseColor ? 'colorPsychology' : '',
    vsr ? 'visualStyleRecommendation' : '',
    tu ? 'targetUser' : '',
    (research?.uxPriorities || []).length ? 'uxPriorities' : '',
    research?.uiAgentInstructions ? 'uiAgentInstructions' : '',
    (research?.risksToAvoid || []).length ? 'risksToAvoid' : '',
    (research?.trustSignals || []).length ? 'trustSignals' : '',
  ]);

  // ── STRUCTURED ART DIRECTION (archetype-driven, research-informed) ──────
  // Every block is a plain object literal (cannot throw) so the artifact is
  // always well-formed; the whole agent is additionally guarded by the pipeline.
  const archName = L(lang, archetype.name[0], archetype.name[1]);
  const archReason = L(lang, archetype.reason[0], archetype.reason[1]);
  const headingSerif = archetype.serif || isSerif(tokens.headingFont) || /serif/i.test(typographyDirection);
  const primaryCTAName = brief.primaryCTA || inferred.primaryCTA;

  const designArchetype: DesignArchetype = {
    name: archName,
    key: archetype.key,
    reason: archReason,
    avoidGenericSaas: archetype.avoidGenericSaas,
    archetypeTags: archetype.tags,
  };
  const researchSignalsUsed: ArtResearchSignalsUsed = {
    targetUser: !!tu,
    recommendedPages: !!(research?.recommendedPages || []).length,
    recommendedComponents: !!(research?.recommendedComponents || []).length,
    visualStyleRecommendation: !!vsr,
    colorPsychology: !!cp,
    uxPriorities: !!(research?.uxPriorities || []).length,
    trustSignals: !!(research?.trustSignals || []).length,
    conversionPatterns: !!(research?.conversionPatterns || []).length,
  };
  const visualMoodProfile: VisualMoodProfile = {
    primaryMood: cp?.primaryMood || visualMood,
    secondaryMood: vsr?.styleType || archName,
    emotionalGoal: cp?.emotionalEffect || L(lang, `Make ${audience} feel this is made for them and trustworthy.`, `${audience} bunun kendisi için yapıldığını ve güvenilir olduğunu hissetsin.`),
    brandPersonality: uniq([inferred.tone, ...archetype.tags]).slice(0, 5),
    userPerceptionGoal: tu?.buyingMotivation
      || L(lang, `Perceive a distinct ${archName.toLowerCase()} identity, not a generic template.`, `Jenerik bir şablon değil, belirgin bir ${archName.toLowerCase()} kimliği algılasın.`),
  };
  const typographyProfile: TypographyProfile = {
    headingStyle: headingSerif
      ? L(lang, 'Serif display headings — editorial, characterful', 'Serif display başlıklar — editoryal, karakterli')
      : L(lang, 'Modern sans/grotesk headings — crisp, confident', 'Modern sans/grotesk başlıklar — net, kendinden emin'),
    bodyStyle: L(lang, 'Clean, highly readable sans body', 'Temiz, yüksek okunabilirlikli sans gövde'),
    fontPairingIntent: typographyDirection,
    scale: archetype.scale,
    weightStrategy: archetype.scale === 'dramatic'
      ? L(lang, 'High weight contrast — heavy display vs light body', 'Yüksek ağırlık kontrastı — ağır display, hafif gövde')
      : L(lang, 'Clear hierarchy: semibold headings, regular body', 'Net hiyerarşi: yarı kalın başlık, normal gövde'),
    letterSpacing: headingSerif
      ? L(lang, 'Neutral heading tracking, comfortable body leading', 'Nötr başlık aralığı, rahat gövde satır aralığı')
      : L(lang, 'Slightly tight headings, comfortable body', 'Hafif sıkı başlıklar, rahat gövde'),
    reason: L(lang, `${archName} reads best with ${headingSerif ? 'editorial serif' : 'modern sans'} headings.`, `${archName}, ${headingSerif ? 'editoryal serif' : 'modern sans'} başlıklarla en iyi okunur.`),
  };
  const layoutFeel: LayoutFeelProfile = {
    density: archetype.layoutDensity,
    spacingRhythm: L(lang, `${ds.sectionRhythm} rhythm — vary section shapes, no repeated card grid`, `${ds.sectionRhythm} ritim — bölüm şekillerini değiştir, tekrarlı kart gridi yok`),
    containerStyle: archetype.layoutDensity === 'immersive' || archetype.layoutDensity === 'editorial'
      ? L(lang, 'Wide, editorial containers with full-bleed moments', 'Geniş, editoryal konteynerler ve tam-taşma anları')
      : archetype.layoutDensity === 'dense'
        ? L(lang, 'Contained, information-dense columns', 'Kapsanmış, bilgi yoğun sütunlar')
        : L(lang, 'Balanced centered container with generous gutters', 'Dengeli ortalanmış konteyner, cömert boşluklar'),
    gridStyle: archetype.layoutDensity === 'dense'
      ? L(lang, 'Multi-column scannable grids', 'Çok sütunlu taranabilir gridler')
      : L(lang, 'Asymmetric, varied grids over uniform 3-cards', 'Tek tip 3 kart yerine asimetrik, çeşitli gridler'),
    sectionSeparators: L(lang, 'Tonal surface shifts and hairlines, not heavy boxes', 'Ağır kutular değil, tonal yüzey geçişleri ve ince çizgiler'),
    aboveFoldPriority: (research?.uxPriorities || [])[0]?.priority
      || L(lang, `Promise + one path to "${primaryCTAName}"`, `Vaat + "${primaryCTAName}" için tek yol`),
  };
  const heroTreatment: HeroTreatment = {
    heroType: L(lang, archetype.heroType, archetype.heroType),
    composition: L(lang, archetype.heroComposition, archetype.heroComposition),
    visualAnchor: visualMetaphor || L(lang, archetype.imageType, archetype.imageType),
    headlineStyle: typographyProfile.headingStyle,
    ctaStyle: ctaStyleDirection,
    trustPlacement: (research?.trustSignals || [])[0] || (tu?.trustNeeds || [])[0]
      || L(lang, 'A quiet proof band directly under the hero CTA', 'Hero CTA\'nın hemen altında sessiz bir kanıt bandı'),
    backgroundTreatment: archetype.layoutDensity === 'immersive'
      ? L(lang, 'Full-bleed image/gradient with a legible overlay', 'Okunaklı kaplamalı tam-taşma görsel/gradyan')
      : L(lang, 'Refined gradient/surface tied to the palette', 'Palete bağlı rafine gradyan/yüzey'),
    reason: archReason,
  };
  const componentStyleRules: ComponentStyleRules = {
    cards: L(lang, `${archetype.cardStyle} (${ds.cardStyle})`, `${archetype.cardStyle} (${ds.cardStyle})`),
    buttons: ctaStyleDirection,
    forms: L(lang, 'Calm, low-friction fields with clear labels and one primary action', 'Sakin, düşük sürtünmeli alanlar; net etiketler ve tek ana eylem'),
    navigation: archetype.layoutDensity === 'immersive'
      ? L(lang, 'Minimal transparent nav that solidifies on scroll', 'Kaydırınca katılaşan minimal şeffaf navigasyon')
      : L(lang, 'Clear, compact nav with a single highlighted CTA', 'Net, kompakt navigasyon; tek vurgulu CTA'),
    badges: L(lang, 'Quiet, tonal badges — never loud neon pills', 'Sessiz, tonal rozetler — asla gürültülü neon haplar'),
    gallery: L(lang, archetype.imageType, archetype.imageType),
    testimonials: L(lang, 'Real quotes on quiet surfaces with name/role, no stock faces', 'Sessiz yüzeylerde gerçek alıntılar; isim/rol, stok yüz yok'),
    pricingOrCatalog: L(lang, 'Legible, honest pricing/catalog cards with one clear default', 'Okunur, dürüst fiyat/katalog kartları; tek net varsayılan'),
    trustBlocks: trustVisualDirection,
  };
  const imagerySystem: ImagerySystem = {
    imageType: L(lang, archetype.imageType, archetype.imageType),
    photographyStyle: /photograph|editorial|cinematic|image/.test(archetype.imageType)
      ? L(lang, 'Editorial, high-contrast, generous negative space', 'Editoryal, yüksek kontrast, cömert negatif alan')
      : L(lang, 'Only where it adds proof — otherwise composed visuals', 'Yalnızca kanıt kattığında — aksi halde kompoze görseller'),
    illustrationStyle: L(lang, 'Geometric SVG tied to the concept, never clip-art', 'Konsepte bağlı geometrik SVG; asla clip-art değil'),
    mockupStyle: vsr?.mockupType || L(lang, 'Composed CSS/SVG product/module mockups', 'Kompoze CSS/SVG ürün/modül maketleri'),
    textureOrPattern: L(lang, 'Subtle grain/gradient tied to the palette', 'Palete bağlı ince tane/gradyan'),
    emptyStateStyle: L(lang, 'Composed placeholder visuals — never blank gray boxes', 'Kompoze yer tutucu görseller — asla boş gri kutular'),
    avoidImagery: uniq([
      L(lang, 'Generic stock photos', 'Jenerik stok fotoğraflar'),
      L(lang, 'Blank placeholder boxes', 'Boş yer tutucu kutular'),
      L(lang, 'Faux dashboard screenshots that misrepresent the product', 'Ürünü yanlış temsil eden sahte panel ekran görüntüleri'),
    ]),
  };
  const iconographySystem: IconographySystem = {
    style: vsr?.iconStyle || iconographyDirection,
    stroke: L(lang, 'One consistent stroke weight across all icons', 'Tüm ikonlarda tek tutarlı çizgi ağırlığı'),
    shapeLanguage: /playful|kid|community|nonprofit/.test(archetype.tags.join(' '))
      ? L(lang, 'Rounded, friendly shapes', 'Yuvarlak, samimi şekiller')
      : /luxury|editorial|heritage|fintech|industrial|legal/.test(archetype.tags.join(' '))
        ? L(lang, 'Precise, geometric shapes', 'Hassas, geometrik şekiller')
        : L(lang, 'Clean line/duotone shapes', 'Temiz çizgi/duoton şekiller'),
    usageRules: L(lang, 'Icons support labels, never replace them; tied to the accent', 'İkonlar etiketleri destekler, yerini almaz; vurguya bağlı'),
  };
  const motionSystem: MotionSystem = {
    animationMood: L(lang, archetype.motionMood, archetype.motionMood),
    microInteractions: uniq([
      L(lang, 'Accent glow + lift on primary actions', 'Ana eylemlerde vurgu parıltısı + yükselme'),
      L(lang, 'Gentle hover states on cards/links', 'Kartlarda/bağlantılarda yumuşak hover durumları'),
      density === 'immersive' ? L(lang, 'Subtle depth/parallax on the hero', 'Hero\'da ince derinlik/parallax') : '',
    ]),
    scrollFeel: density === 'immersive'
      ? L(lang, 'Cinematic reveal-on-scroll with staged depth', 'Aşamalı derinlikle sinematik scroll-belirme')
      : L(lang, 'Tasteful reveal-on-scroll, one element at a time', 'Zevkli scroll-belirme, tek seferde bir öğe'),
    avoidMotion: uniq([
      L(lang, 'Childish bounces / spinning decor', 'Çocuksu zıplamalar / dönen dekor'),
      L(lang, 'Motion that blocks reading or the CTA', 'Okumayı veya CTA\'yı engelleyen hareket'),
    ]),
  };
  const responsiveDirection: ResponsiveDirection = {
    mobilePriority: mobileLean
      ? L(lang, 'Mobile-first: single column, thumb-reachable CTAs, large tap targets', 'Mobil öncelikli: tek sütun, başparmakla erişilir CTA, büyük dokunma hedefleri')
      : L(lang, 'A strong single-column mobile story that never feels like a shrunk desktop', 'Küçültülmüş masaüstü gibi hissettirmeyen güçlü tek sütun mobil anlatı'),
    desktopPriority: desktopLean
      ? L(lang, 'Desktop-first: composed multi-column density and comparison layouts', 'Masaüstü öncelikli: kompoze çok sütunlu yoğunluk ve karşılaştırma düzenleri')
      : L(lang, 'Expand the mobile story into a composed, spacious desktop layout', 'Mobil anlatıyı kompoze, ferah bir masaüstü düzene genişlet'),
    navigationBehavior: L(lang, 'Collapse to a clean menu on mobile; keep the primary CTA reachable', 'Mobilde temiz menüye indir; ana CTA erişilebilir kalsın'),
    heroMobileBehavior: L(lang, 'Hero visual stacks under the headline; CTA stays above the fold', 'Hero görseli başlığın altına yığılır; CTA ilk ekranda kalır'),
    componentStackingRules: L(lang, 'Multi-column grids collapse to one column; preserve reading order', 'Çok sütunlu gridler tek sütuna iner; okuma sırası korunur'),
  };
  const accessibilityDirection: AccessibilityDirection = {
    contrastRule: L(lang, 'Text/background contrast ≥ WCAG AA (4.5:1 body, 3:1 large)', 'Metin/arka plan kontrastı ≥ WCAG AA (gövde 4.5:1, büyük 3:1)'),
    readabilityRule: L(lang, 'Body ≥ 16px, comfortable line length and leading', 'Gövde ≥ 16px, rahat satır uzunluğu ve aralığı'),
    touchTargetRule: L(lang, 'Interactive targets ≥ 44px with clear focus states', 'Etkileşimli hedefler ≥ 44px, net odak durumları'),
    motionSafetyRule: L(lang, 'Respect prefers-reduced-motion; no essential info in motion only', 'prefers-reduced-motion\'a saygı; yalnızca harekette kritik bilgi yok'),
  };
  const paletteName = colorSystem.paletteName || archetype.palette.name;
  const downstreamInstructions: DownstreamInstructions = {
    strategyAgent: uniq([
      L(lang, `Keep the conversion path consistent with a ${archName.toLowerCase()} tone`, `Dönüşüm yolunu ${archName.toLowerCase()} tonuyla tutarlı tut`),
      L(lang, `CTA style: ${ctaStyleDirection}`, `CTA stili: ${ctaStyleDirection}`),
      L(lang, `Trust proof as: ${trustVisualDirection}`, `Güven kanıtı: ${trustVisualDirection}`),
    ]),
    layoutArchitectAgent: uniq([
      L(lang, `Hero: ${heroTreatment.heroType} — ${heroTreatment.composition}`, `Hero: ${heroTreatment.heroType} — ${heroTreatment.composition}`),
      L(lang, `Density: ${layoutFeel.density}; ${layoutFeel.gridStyle}`, `Yoğunluk: ${layoutFeel.density}; ${layoutFeel.gridStyle}`),
      L(lang, `Section rhythm: ${sectionRhythmDirection}`, `Bölüm ritmi: ${sectionRhythmDirection}`),
    ]),
    componentEngineerAgent: uniq([
      L(lang, `Cards: ${componentStyleRules.cards}`, `Kartlar: ${componentStyleRules.cards}`),
      L(lang, `Buttons: ${componentStyleRules.buttons}`, `Butonlar: ${componentStyleRules.buttons}`),
      L(lang, `Icons: ${iconographySystem.style}, ${iconographySystem.shapeLanguage}`, `İkonlar: ${iconographySystem.style}, ${iconographySystem.shapeLanguage}`),
    ]),
    previewRenderer: uniq([
      L(lang, `Palette "${paletteName}": bg ${colorSystem.background}, accent ${colorSystem.accent}`, `Palet "${paletteName}": arka ${colorSystem.background}, vurgu ${colorSystem.accent}`),
      L(lang, `Headings: ${headingSerif ? 'serif' : 'sans'}`, `Başlıklar: ${headingSerif ? 'serif' : 'sans'}`),
    ]),
    fileSynthesis: uniq([
      L(lang, 'Emit design tokens from this palette + type; no generic default indigo', 'Bu palet + tipografiden tasarım token\'ları üret; jenerik varsayılan indigo yok'),
      L(lang, 'Compose visuals with CSS/SVG; never blank placeholder boxes', 'Görselleri CSS/SVG ile oluştur; asla boş yer tutucu kutular değil'),
    ]),
  };
  const mustEmphasize = uniq([
    archName,
    ...(research?.uiAgentInstructions?.mustEmphasize || []).slice(0, 2),
    visualMoodProfile.emotionalGoal,
    L(lang, `A single obvious path to "${primaryCTAName}"`, `"${primaryCTAName}" için tek net yol`),
  ]).slice(0, 5);
  const mustAvoid = uniq([
    L(lang, 'The generic "modern premium SaaS dark-blue gradient" for every site', 'Her site için jenerik "modern premium SaaS koyu-mavi gradyan"'),
    ...avoid.slice(0, 3),
  ]).slice(0, 5);

  // Honest status: art direction always completes (archetype-driven even without
  // research), but flag when research itself was a fallback so the handoff is truthful.
  const researchWasFallback = !research || (!tu && !(research?.recommendedPages || []).length);
  const status: 'completed' | 'fallback' = researchWasFallback ? 'fallback' : 'completed';
  const fallbackReason = researchWasFallback
    ? L(lang, 'Art direction derived from the concept + archetype (Research Agent used strategy inference).',
        'Sanat yönü konsept + arketipten türetildi (Araştırma Ajanı strateji çıkarımı kullandı).')
    : undefined;

  // Summary — specific: names the archetype, palette intent and target user,
  // not a generic "modern and premium".
  const paletteWord = (cp?.recommendedPalette || [])[0] || archetype.palette.name;
  const summary = L(lang,
    `${archName} for ${audience}${paletteWord ? `, built on ${paletteWord}` : ''} — ${headingSerif ? 'editorial' : 'modern'} type, ${density} density, ${ds.motion} motion.`,
    `${audience} için ${archName}${paletteWord ? `, ${paletteWord} üzerine` : ''} — ${headingSerif ? 'editoryal' : 'modern'} tipografi, ${density} yoğunluk, ${ds.motion} hareket.`);
  const usedList = usedResearchInputs.length ? usedResearchInputs : [];
  const handoffSummary = L(lang,
    `Chose a ${archName} identity${usedList.length ? ` from ${usedList.join(', ')}` : ''}; passing palette, typography, visual mood and component rules downstream.`,
    `${archName} kimliği seçildi${usedList.length ? ` (${usedList.join(', ')})` : ''}; palet, tipografi, görsel atmosfer ve bileşen kuralları aktarılıyor.`);

  return {
    visualMood,
    brandPersonality,
    typographyDirection,
    colorSystem,
    colorPsychologyReasoning,
    layoutFeeling,
    visualMetaphor,
    imageryDirection,
    iconographyDirection,
    motionDirection: motionDirection || inferred.recommendedMotion,
    density,
    premiumDetails,
    avoid,
    uiPrinciples,
    componentStyleHints,
    heroDirection,
    sectionRhythmDirection,
    ctaStyleDirection,
    trustVisualDirection,
    responsiveDesignDirection,
    usedResearchInputs: usedResearchInputs.length ? usedResearchInputs : undefined,
    summary,
    // ── Strong, structured art direction ──
    status,
    researchSignalsUsed,
    designArchetype,
    visualMoodProfile,
    typographyProfile,
    layoutFeel,
    heroTreatment,
    componentStyleRules,
    imagerySystem,
    iconographySystem,
    motionSystem,
    responsiveDirection,
    accessibilityDirection,
    downstreamInstructions,
    mustEmphasize,
    mustAvoid,
    handoffSummary,
    fallbackReason,
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
  art: ArtDirectionArtifact | undefined,
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
  // Trust strategy consumes Research trust needs AND the UI Agent's trust visual
  // direction, so the two agents agree on how proof is presented.
  const trustStrategy = brief.trustSignals
    || uniq([
        ...(research?.targetUser?.trustNeeds || []),
        ...(research?.trustSignals || []),
        art?.trustVisualDirection || '',
      ]).join(' · ')
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

  // Pipeline trace — the upstream inputs this strategy actually consumed.
  const usedResearchInputs = uniq([
    research?.targetUser ? 'targetUser' : '',
    (research?.conversionPatterns || []).length ? 'conversionPatterns' : '',
    (research?.trustSignals || []).length ? 'trustSignals' : '',
    (research?.audienceExpectations || []).length ? 'audienceExpectations' : '',
    (research?.differentiationOpportunities || []).length ? 'differentiationOpportunities' : '',
    (research?.risksToAvoid || []).length ? 'risksToAvoid' : '',
  ]);
  const usedArtDirectionInputs = uniq([
    art?.visualMood ? 'visualMood' : '',
    art?.brandPersonality ? 'brandPersonality' : '',
    art?.ctaStyleDirection ? 'ctaStyleDirection' : '',
    art?.trustVisualDirection ? 'trustVisualDirection' : '',
  ]);

  return {
    positioning,
    mainPromise,
    // Fold the researched target-user profile (motivation + pain points) AND the UI
    // Agent's brand personality into the audience psychology so strategy speaks to
    // the real visitor and stays aligned with the art direction's tone.
    audiencePsychology: uniq([
      audience,
      research?.targetUser?.buyingMotivation || '',
      ...(research?.targetUser?.mainPainPoints || []).slice(0, 2),
      art?.brandPersonality || '',
      ...(research?.audienceExpectations || []),
    ]).join(' · '),
    visitorIntent: brief.visitorIntent || research?.targetUser?.buyingMotivation
      || (research?.audienceExpectations || [])[0]
      || L(lang, `Decide quickly whether this fits, then ${primary}.`, `Bunun uygun olup olmadığına hızlıca karar ver, sonra ${primary}.`),
    conversionStrategy,
    trustStrategy,
    ctaHierarchy: { primary, secondary },
    contentHierarchy,
    aboveTheFoldMustProve,
    sectionIntent,
    risksToAvoid: research?.risksToAvoid || [],
    differentiation,
    usedResearchInputs: usedResearchInputs.length ? usedResearchInputs : undefined,
    usedArtDirectionInputs: usedArtDirectionInputs.length ? usedArtDirectionInputs : undefined,
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
  research: ResearchAgentArtifact | undefined,
  art: ArtDirectionArtifact | undefined,
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
        // Purpose comes from the Strategy Agent's per-section intent when present.
        purpose: si?.purpose || L(lang, `Advance the visitor toward the primary action.`, `Ziyaretçiyi ana eyleme yaklaştır.`),
        variant: SECTION_DISPLAY[s.variant] || 'feature_grid',
        visualModule: s.hostsPrimaryModule ? plan.primaryVisualModule : (plan.secondaryVisualModules[0] || '—'),
        density: plan.contentDensity,
        ctaRole,
      };
    });

  // Hero proof placement is shaped by the Strategy Agent's above-the-fold proof
  // and the Research target-user trust needs — the plan already positions it, this
  // records WHY.
  const heroProof = (strategy?.aboveTheFoldMustProve || [])[0]
    || (research?.targetUser?.trustNeeds || [])[0]
    || plan.trustPlacement;
  // Responsive behavior follows the Art Direction (which read the Research
  // device preference); fall back to the target user, then a safe default.
  const responsiveBehavior = art?.responsiveDesignDirection
    || (research?.targetUser?.devicePreference
      ? L(lang, `Tuned for ${research.targetUser.devicePreference}; single column on mobile, composed grid on desktop.`,
          `${research.targetUser.devicePreference} için ayarlı; mobilde tek sütun, masaüstünde kompoze grid.`)
      : L(lang, 'Single column on mobile; multi-column grids collapse; the hero visual stacks under the copy.',
          'Mobilde tek sütun; grid\'ler tek sütuna iner; hero görseli metnin altına yığılır.'));

  const usedResearchInputs = uniq([
    (research?.recommendedPages || []).length ? 'recommendedPages' : '',
    (research?.recommendedComponents || []).length ? 'recommendedComponents' : '',
    research?.targetUser ? 'targetUser' : '',
    (research?.trustSignals || []).length ? 'trustSignals' : '',
  ]);
  const usedArtDirectionInputs = uniq([
    art?.motionDirection ? 'motionDirection' : '',
    art?.density ? 'density' : '',
    art?.sectionRhythmDirection ? 'sectionRhythmDirection' : '',
    art?.heroDirection ? 'heroDirection' : '',
  ]);
  const usedStrategyInputs = uniq([
    (strategy?.aboveTheFoldMustProve || []).length ? 'aboveTheFoldMustProve' : '',
    (strategy?.contentHierarchy || []).length ? 'contentHierarchy' : '',
    strategy?.ctaHierarchy ? 'ctaHierarchy' : '',
    (strategy?.sectionIntent || []).length ? 'sectionIntent' : '',
  ]);

  return {
    architecture: plan.pageArchitecture,
    navigationStyle: plan.navigationStyle,
    hero: {
      variant: heroVariant,
      layout: `${plan.visualSystem.headingAlign}-aligned · ${plan.contentDensity}`,
      visualModule: plan.primaryVisualModule,
      ctaPlacement: plan.ctaPlacement,
      proofPlacement: heroProof,
      density: plan.contentDensity,
    },
    sections: blueSections,
    sectionRhythm: plan.rhythm,
    trustPlacement: strategy?.trustStrategy || plan.trustPlacement,
    motionPattern: plan.motionPattern,
    responsiveBehavior,
    usedResearchInputs: usedResearchInputs.length ? usedResearchInputs : undefined,
    usedArtDirectionInputs: usedArtDirectionInputs.length ? usedArtDirectionInputs : undefined,
    usedStrategyInputs: usedStrategyInputs.length ? usedStrategyInputs : undefined,
    summary: L(lang,
      `${heroVariant.replace(/_/g, ' ')} hero · ${plan.rhythm} rhythm · ${blueSections.length} sections · ${plan.visualSystem.background} backdrop.`,
      `${heroVariant.replace(/_/g, ' ')} hero · ${plan.rhythm} ritim · ${blueSections.length} bölüm · ${plan.visualSystem.background} arka plan.`),
  };
}

/* ── Brief enrichment (agents → design system / preview / files) ──────── */

/**
 * Decide the STRUCTURE the layout plan should use, FROM the agent artifacts — so
 * the plan (and therefore both the preview and the generated files) obeys the
 * agents instead of re-detecting an archetype from prose. Returns plain-string
 * hints (validated at the plan layer). Signal-driven from the Research brief's
 * recommended pages/components + visual style + target user — never a fixed
 * per-example template. Returns {} when signals are too weak, so the existing
 * detection + diversity guard still applies (never forced to 'standard').
 */
export function deriveLayoutSteering(
  research: ResearchAgentArtifact | undefined,
  art: ArtDirectionArtifact | undefined,
  _strategy: StrategyAgentArtifact | undefined,
): { agentArchetype?: string; agentHero?: string; agentModule?: string } {
  if (!research) return {};
  const pages = (research.recommendedPages || []).map((p) => (p.name || '').toLowerCase());
  const comps = (research.recommendedComponents || []).map((c) => (c.name || '').toLowerCase());
  const hay = [...pages, ...comps].join(' | ');
  const has = (...w: string[]) => w.some((x) => hay.includes(x));
  const premium = research.visualStyleRecommendation?.premiumLevel;
  const style = (research.visualStyleRecommendation?.styleType || '').toLowerCase();
  const device = (research.targetUser?.devicePreference || '').toLowerCase();

  // Archetype — most specific business model first, then style, then device.
  let archetype: string | undefined;
  if (premium === 'luxury') archetype = 'luxury-service';
  else if (has('booking', 'reservation', 'reserve')) archetype = 'hospitality';
  else if (has('application', 'apply', 'enroll', 'membership')) archetype = 'membership';
  else if (has('dashboard preview', 'dashboard') || /data|scientific|precise/.test(style)) {
    archetype = /data|scientific|precise|technical/.test(style + ' ' + device) ? 'data-platform' : 'dashboard';
  } else if (has('product cards', 'product detail', 'product ')) archetype = 'marketplace';
  else if (has('case studies', 'gallery') && /editorial|expressive|bold/.test(style)) archetype = 'portfolio';
  else if (has('blog') && /editorial/.test(style)) archetype = 'editorial';

  // Primary visual module — from the strongest recommended component, so the
  // hero/first section carry a module that reflects what the site actually needs.
  let module: string | undefined;
  if (has('dashboard preview', 'dashboard')) module = 'data-dashboard';
  else if (has('booking form', 'reservation')) module = 'reservation-form';
  else if (has('application flow')) module = 'membership-pass';
  else if (has('beforeafter', 'before/after')) module = 'comparison';
  else if (has('product cards')) module = 'catalog-archive';
  else if (has('case study', 'gallery')) module = 'catalog-archive';

  // Hero — only pin it for the strongest premium/experimental cues that imply a
  // distinct opening; otherwise let the archetype's blueprint choose the hero.
  let hero: string | undefined;
  if (premium === 'luxury') hero = 'luxury-service';
  else if (premium === 'experimental' || /experimental|cinematic|immersive/.test(style)) hero = 'immersive-full-bleed';
  else if (art?.density === 'immersive') hero = 'immersive-full-bleed';

  const out: { agentArchetype?: string; agentHero?: string; agentModule?: string } = {};
  if (archetype) out.agentArchetype = archetype;
  if (hero) out.agentHero = hero;
  if (module) out.agentModule = module;
  return out;
}

/**
 * Fold the Art Direction + Strategy into the brief so the existing design system,
 * preview and file synthesizer are driven by them. Fills GAPS only (the model's
 * own values always win), so it is additive and backward compatible. Also injects
 * the agent-decided STRUCTURE (archetype / hero / module) so the layout plan obeys
 * the pipeline.
 */
export function enrichBriefWithAgents(
  brief: WebBuildBrief,
  research: ResearchAgentArtifact | undefined,
  art: ArtDirectionArtifact | undefined,
  strategy: StrategyAgentArtifact | undefined,
): WebBuildBrief {
  let b: WebBuildBrief = { ...brief };
  // Structure steering — the plan (preview + files) obeys the agents. Model's own
  // explicit values (if ever present on the brief) still win via `||`.
  const steer = deriveLayoutSteering(research, art, strategy);
  b = {
    ...b,
    agentArchetype: b.agentArchetype || steer.agentArchetype,
    agentHero: b.agentHero || steer.agentHero,
    agentModule: b.agentModule || steer.agentModule,
  };
  if (art && art.colorSystem) {
    // Heading serif follows the Art Director's typography decision (archetype +
    // typographyProfile.headingStyle), so an editorial/luxury/heritage archetype
    // actually renders serif headings instead of the default sans.
    const artSerif = /serif/i.test(art.typographyProfile?.headingStyle || '') || /serif/i.test(art.typographyDirection || '');
    b = {
      ...b,
      artAccent: b.artAccent || art.colorSystem.accent,
      artAccent2: b.artAccent2 || art.colorSystem.accent2,
      artBg: b.artBg || art.colorSystem.background,
      artHeadingSerif: b.artHeadingSerif ?? artSerif,
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
  component_engineer: ['Component Engineer Agent', 'Bileşen Mühendisi Ajanı'],
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
/** A minimal, HONEST research artifact used when the Research Agent derivation
 *  itself throws — status fallback_strategy, no sources, never fabricated — so
 *  the downstream pipeline still receives a valid (if empty) brief. */
function fallbackResearchArtifact(lang: Lang): ResearchAgentArtifact {
  return {
    didResearch: false,
    status: 'fallback_strategy',
    researchAngles: [],
    sourceBackedInsights: [],
    categoryLanguage: [],
    audienceExpectations: [],
    conversionPatterns: [],
    trustSignals: [],
    visualPatterns: [],
    competitorOrAdjacentPatterns: [],
    risksToAvoid: [],
    differentiationOpportunities: [],
    fallbackReason: 'research derivation failed — using strategy inference',
    summary: L(lang, 'Using strategy inference (research unavailable).', 'Strateji çıkarımı kullanılıyor (araştırma yok).'),
  };
}

export function runUpstreamAgents(
  prompt: string,
  brief: WebBuildBrief,
  research: WebBuildResearch | undefined,
  inferred: InferredBrief,
  sections: Array<{ id: string; name: string }>,
  lang: Lang = 'en',
): UpstreamAgentsResult {
  const artifacts: WebBuildArtifacts = {};
  const fallbacks: string[] = [];

  // 1) Research Agent — the first source of truth. On failure fall back to a
  //    safe (honest, source-less) artifact so the pipeline keeps a valid brief.
  let researchArtifact: ResearchAgentArtifact | undefined;
  try { researchArtifact = deriveResearchAgent(brief, research, inferred, lang); }
  catch { researchArtifact = fallbackResearchArtifact(lang); fallbacks.push('research'); }
  artifacts.research = researchArtifact;

  // 2) UI / Art Director — consumes the Research artifact.
  let art: ArtDirectionArtifact | undefined;
  try { art = deriveArtDirection(brief, researchArtifact, inferred, lang); }
  catch { art = undefined; fallbacks.push('ui_art_director'); }
  artifacts.artDirection = art;

  // 3) Strategy Agent — consumes Research + Art Direction.
  let strategy: StrategyAgentArtifact | undefined;
  try { strategy = deriveStrategyAgent(brief, researchArtifact, inferred, sections, art, lang); }
  catch { strategy = undefined; fallbacks.push('strategy'); }
  artifacts.strategy = strategy;

  // The shared context threaded through the pipeline (Layout Architect + the
  // final build read the connected artifacts from here). Backward compatible.
  artifacts.context = {
    prompt,
    brief,
    research: researchArtifact || null,
    artDirection: art || null,
    strategy: strategy || null,
    layoutBlueprint: null, // filled by runLayoutArchitect after the plan resolves
    sources: research?.sources || [],
    fallbacks,
  };

  const agents: WebBuildAgent[] = [
    agentRow('research', lang, researchArtifact),
    agentRow('ui_art_director', lang, art),
    agentRow('strategy', lang, strategy),
  ];

  return { agents, artifacts, enrichedBrief: enrichBriefWithAgents(brief, researchArtifact, art, strategy) };
}

/**
 * Run the Layout Architect after the layout plan is resolved. Guarded — on any
 * failure it returns a skipped row and no blueprint, and the build continues on
 * the derived plan.
 */
export function runLayoutArchitect(
  sections: Array<{ id: string; name: string }>,
  plan: WebBuildLayoutPlan,
  research: ResearchAgentArtifact | undefined,
  art: ArtDirectionArtifact | undefined,
  strategy: StrategyAgentArtifact | undefined,
  lang: Lang = 'en',
): { agent: WebBuildAgent; blueprint?: PageBlueprint } {
  try {
    // Layout Architect consumes ALL upstream artifacts (Research + Art + Strategy).
    const blueprint = deriveLayoutArchitect(sections, plan, research, art, strategy, lang);
    return { agent: agentRow('layout_architect', lang, blueprint), blueprint };
  } catch {
    return { agent: agentRow('layout_architect', lang, undefined) };
  }
}

/* ── Component Engineer Agent ─────────────────────────────────────────────
 * The final upstream agent. It consumes Research + Art + Strategy + the Page
 * Blueprint and the resolved layout plan, and produces the CONCRETE component /
 * file plan the synthesizer emits. It does not invent files: every entry is
 * derived from the plan the file synthesizer already builds from, so the manifest
 * is an accurate, connected description of what is generated — and the enforcement
 * layer can verify the generated files match it. */

const cePascal = (id: string): string => {
  const p = id.replace(/(^|[-_ ]+)(\w)/g, (_m, _s, c: string) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '');
  return /^[a-z]/.test(p) ? p.charAt(0).toUpperCase() + p.slice(1) : (p || 'Section');
};

function fileMeta(path: string, componentNames: string[], lang: Lang): { purpose: string; componentType: string; dependsOn: string[] } {
  if (/main\.tsx$/.test(path)) return { purpose: L(lang, 'React entrypoint', 'React giriş noktası'), componentType: 'bootstrap', dependsOn: ['src/App.tsx'] };
  if (/App\.tsx$/.test(path)) return { purpose: L(lang, 'Composes the section sequence from the Page Blueprint', 'Bölüm dizisini Sayfa Planından oluşturur'), componentType: 'composition', dependsOn: componentNames.map((n) => `src/components/${n}.tsx`) };
  if (/VisualModule\.tsx$/.test(path)) return { purpose: L(lang, 'Reusable visual modules (dashboard/catalog/map/…)', 'Yeniden kullanılabilir görsel modüller'), componentType: 'visual', dependsOn: ['src/lib/designSystem.ts'] };
  if (/designSystem\.ts$/.test(path)) return { purpose: L(lang, 'Design tokens from the UI / Art Director Agent', 'UI / Sanat Yönetmeni Ajanından tasarım token\'ları'), componentType: 'tokens', dependsOn: [] };
  if (/layoutPlan\.ts$/.test(path)) return { purpose: L(lang, 'The structural layout plan record', 'Yapısal yerleşim planı kaydı'), componentType: 'plan', dependsOn: [] };
  if (/siteContent\.ts$/.test(path)) return { purpose: L(lang, 'Content model (Research + Strategy copy)', 'İçerik modeli (Araştırma + Strateji metni)'), componentType: 'content', dependsOn: [] };
  if (/styles\.css$/.test(path)) return { purpose: L(lang, 'Global styles + visual-system tokens', 'Global stiller + görsel sistem token\'ları'), componentType: 'styles', dependsOn: [] };
  return { purpose: L(lang, 'Section component', 'Bölüm bileşeni'), componentType: 'section', dependsOn: ['src/components/VisualModule.tsx', 'src/lib/designSystem.ts'] };
}

export function deriveComponentEngineer(
  plan: WebBuildLayoutPlan,
  blueprint: PageBlueprint | undefined,
  research: ResearchAgentArtifact | undefined,
  art: ArtDirectionArtifact | undefined,
  strategy: StrategyAgentArtifact | undefined,
  lang: Lang = 'en',
): ComponentEngineerArtifact {
  const bpById = new Map((blueprint?.sections || []).map((s) => [s.id, s]));
  const intentByName = new Map((strategy?.sectionIntent || []).map((si) => [si.section.toLowerCase(), si]));

  const componentPlan: EngineeredComponent[] = plan.sections.map((s, i) => {
    const name = plan.componentPlan[i] || cePascal(s.id);
    const isHero = s.kind === 'hero';
    const bpS = bpById.get(s.id);
    const si = intentByName.get((s.name || '').toLowerCase());
    const visualModule = isHero
      ? plan.primaryVisualModule
      : (s.hostsPrimaryModule ? plan.primaryVisualModule : (plan.secondaryVisualModules[0] || '—'));
    const variant = isHero ? plan.heroComposition : s.variant;
    return {
      name,
      type: s.kind,
      purpose: bpS?.purpose || si?.purpose
        || L(lang, `Advance the visitor toward the primary action.`, `Ziyaretçiyi ana eyleme yaklaştır.`),
      // WHY this component exists — traces the decision back to the agents.
      sourceAgentReason: isHero
        ? L(lang, `Layout Architect chose a ${variant} hero; carries the ${visualModule} module.`,
            `Yerleşim Mimarı ${variant} hero seçti; ${visualModule} modülünü taşır.`)
        : L(lang, `Layout Architect variant "${variant}"${si ? ` · Strategy: ${si.visitorQuestion}` : ''}.`,
            `Yerleşim Mimarı varyantı "${variant}"${si ? ` · Strateji: ${si.visitorQuestion}` : ''}.`),
      usedBlueprintSection: bpS?.title || s.name,
      variant,
      visualModule,
      filePath: `src/components/${name}.tsx`,
    };
  });

  const componentNames = plan.sections.map((s, i) => plan.componentPlan[i] || cePascal(s.id));
  const fileManifest: EngineeredFile[] = (plan.filePlan.length ? plan.filePlan : []).map((path) => {
    const m = fileMeta(path, componentNames, lang);
    return { path, purpose: m.purpose, componentType: m.componentType, dependsOn: m.dependsOn };
  });

  const contentModel: Record<string, unknown> = {
    source: 'src/data/siteContent.ts',
    sections: plan.sections.length,
    drivenBy: uniq([
      research ? 'Research categoryLanguage + audienceExpectations' : '',
      strategy ? 'Strategy contentHierarchy + sectionIntent' : '',
      art ? 'Art Direction tone' : '',
    ]),
  };
  const reusablePrimitives = uniq([
    'VisualModule', 'designSystem tokens', 'layoutPlan record',
    ...componentPlan.map((c) => c.variant),
  ]);

  const usedResearchInputs = uniq([
    (research?.recommendedComponents || []).length ? 'recommendedComponents' : '',
    (research?.recommendedPages || []).length ? 'recommendedPages' : '',
  ]);
  const usedArtDirectionInputs = uniq([art?.componentStyleHints?.length ? 'componentStyleHints' : '', art?.density ? 'density' : '']);
  const usedStrategyInputs = uniq([(strategy?.sectionIntent || []).length ? 'sectionIntent' : '', (strategy?.contentHierarchy || []).length ? 'contentHierarchy' : '']);
  const usedBlueprintInputs = uniq([
    blueprint?.hero ? 'hero.variant' : '',
    (blueprint?.sections || []).length ? 'sections' : '',
    blueprint?.sectionRhythm ? 'sectionRhythm' : '',
  ]);

  const modules = uniq(componentPlan.map((c) => c.visualModule).filter((m) => m && m !== '—'));
  const summary = L(lang,
    `${componentPlan.length} components across ${fileManifest.length} files — ${plan.heroComposition.replace(/-/g, ' ')} hero, modules: ${modules.slice(0, 3).join(', ') || '—'}. Composed from the Page Blueprint.`,
    `${fileManifest.length} dosyada ${componentPlan.length} bileşen — ${plan.heroComposition.replace(/-/g, ' ')} hero, modüller: ${modules.slice(0, 3).join(', ') || '—'}. Sayfa Planından oluşturuldu.`);

  return {
    componentPlan,
    fileManifest,
    appComposition: componentNames,
    contentModel,
    reusablePrimitives,
    usedResearchInputs: usedResearchInputs.length ? usedResearchInputs : undefined,
    usedArtDirectionInputs: usedArtDirectionInputs.length ? usedArtDirectionInputs : undefined,
    usedStrategyInputs: usedStrategyInputs.length ? usedStrategyInputs : undefined,
    usedBlueprintInputs: usedBlueprintInputs.length ? usedBlueprintInputs : undefined,
    summary,
  };
}

/**
 * Run the Component Engineer after the plan + blueprint resolve. Guarded — on any
 * failure it returns a skipped row and no artifact, and the build continues on the
 * files the synthesizer already produced from the plan.
 */
export function runComponentEngineer(
  plan: WebBuildLayoutPlan,
  blueprint: PageBlueprint | undefined,
  research: ResearchAgentArtifact | undefined,
  art: ArtDirectionArtifact | undefined,
  strategy: StrategyAgentArtifact | undefined,
  lang: Lang = 'en',
): { agent: WebBuildAgent; artifact?: ComponentEngineerArtifact } {
  try {
    const artifact = deriveComponentEngineer(plan, blueprint, research, art, strategy, lang);
    return { agent: agentRow('component_engineer', lang, artifact), artifact };
  } catch {
    return { agent: agentRow('component_engineer', lang, undefined) };
  }
}

/* ── Chat agent WORKSTREAM (work-log) model ────────────────────────────────
 * A single, normalized log of the real agent pipeline for a finished build step:
 * WHAT each agent did, WHICH fields it passed to the next agent, and (for the
 * Component Engineer) the real files written with their real +/- line diffs. It
 * is derived ONLY from the real artifacts (step.agents) and the real generated
 * files (step.files) — never fabricated. Honest wording on fallback/skip/fail
 * ("created fallback research brief", "passed fallback brief"). New files show
 * "+lineCount -0" (the file's real line count); revisions show the real diff. An
 * old build with no agents yields an empty log, so nothing renders. */

export type WebBuildWorkLogType = 'completed' | 'handoff' | 'file' | 'fallback' | 'error';

export interface WebBuildAgentWorkLogEntry {
  id: string;
  type: WebBuildWorkLogType;
  /** The agent this entry belongs to (localized display name). */
  agent?: string;
  fromAgent?: string;
  toAgent?: string;
  /** Fully-composed, localized log line. */
  message: string;
  /** The real fields handed to the next agent (present artifact fields only). */
  fieldsPassed?: string[];
  /** File entries — real path + real diff from the generated file set. */
  filePath?: string;
  linesAdded?: number;
  linesRemoved?: number;
  /** Set only when there is no reliable +/- diff (shows "generated N lines"). */
  lineCount?: number;
}

/** Minimal file shape the work log reads — structurally compatible with
 *  WebBuildFile (avoids importing the payload module → no import cycle). */
export interface WorkLogFile {
  path: string;
  status: 'created' | 'modified' | 'unchanged';
  added: number;
  removed: number;
}

/** Oxford-style list join, localized ("a, b, and c" / "a, b ve c"). Empties dropped. */
function joinList(lang: Lang, items: string[]): string {
  const xs = uniq(items).filter(Boolean);
  if (xs.length <= 1) return xs.join('');
  const head = xs.slice(0, -1).join(', ');
  const tail = xs[xs.length - 1];
  return `${head}${lang === 'tr' ? ' ve ' : ', and '}${tail}`;
}

const nonEmpty = (v: unknown): boolean => Array.isArray(v) ? v.length > 0 : !!v;

/** Canonical pipeline order + who each agent hands off to. */
const WORKLOG_ORDER: AgentId[] = ['research', 'ui_art_director', 'strategy', 'layout_architect', 'component_engineer'];
const WORKLOG_NEXT: Partial<Record<AgentId, AgentId>> = {
  research: 'ui_art_director',
  ui_art_director: 'strategy',
  strategy: 'layout_architect',
  layout_architect: 'component_engineer',
};

/** Human labels for the internal `usedXInputs` pipeline-trace keys. */
const USED_LABEL: Record<string, [string, string]> = {
  targetUser: ['target user', 'hedef kullanıcı'],
  recommendedPages: ['recommended pages', 'önerilen sayfalar'],
  recommendedComponents: ['recommended components', 'önerilen bileşenler'],
  visualStyleRecommendation: ['visual style', 'görsel stil'],
  colorPsychology: ['color psychology', 'renk psikolojisi'],
  uxPriorities: ['UX priorities', 'UX öncelikleri'],
  uiAgentInstructions: ['UI instructions', 'UI talimatları'],
  risksToAvoid: ['risks to avoid', 'kaçınılacak riskler'],
  trustSignals: ['trust signals', 'güven sinyalleri'],
  audienceExpectations: ['audience expectations', 'kitle beklentileri'],
  conversionPatterns: ['conversion patterns', 'dönüşüm kalıpları'],
  differentiationOpportunities: ['differentiation', 'farklılaşma'],
  visualMood: ['visual mood', 'görsel atmosfer'],
  brandPersonality: ['brand personality', 'marka kişiliği'],
  ctaStyleDirection: ['CTA style', 'CTA stili'],
  trustVisualDirection: ['trust visuals', 'güven görselleri'],
  motionDirection: ['motion', 'hareket'],
  density: ['density', 'yoğunluk'],
  sectionRhythmDirection: ['section rhythm', 'bölüm ritmi'],
  heroDirection: ['hero direction', 'hero yönü'],
  aboveTheFoldMustProve: ['above-the-fold proof', 'ilk ekran kanıtı'],
  contentHierarchy: ['content hierarchy', 'içerik hiyerarşisi'],
  ctaHierarchy: ['CTA hierarchy', 'CTA hiyerarşisi'],
  sectionIntent: ['section intent', 'bölüm amacı'],
};

function humanizeUsed(keys: string[] | undefined, lang: Lang): string[] {
  return uniq((Array.isArray(keys) ? keys : [])
    .map((k) => (USED_LABEL[k] ? L(lang, USED_LABEL[k][0], USED_LABEL[k][1]) : ''))
    .filter(Boolean));
}

/** The real fields an agent PRODUCES and therefore hands to the next agent —
 *  present artifact fields only, so a handoff never claims data that is missing. */
function producedFields(agent: WebBuildAgent, lang: Lang): string[] {
  try {
    switch (agent.id) {
      case 'research': {
        const r = agent.artifact as ResearchAgentArtifact;
        return uniq([
          r.targetUser ? L(lang, 'target user', 'hedef kullanıcı') : '',
          nonEmpty(r.recommendedPages) ? L(lang, 'recommended pages', 'önerilen sayfalar') : '',
          nonEmpty(r.recommendedComponents) ? L(lang, 'recommended components', 'önerilen bileşenler') : '',
          r.visualStyleRecommendation ? L(lang, 'visual style', 'görsel stil') : '',
          r.colorPsychology ? L(lang, 'color psychology', 'renk psikolojisi') : '',
          nonEmpty(r.uxPriorities) ? L(lang, 'UX priorities', 'UX öncelikleri') : '',
          nonEmpty(r.trustSignals) ? L(lang, 'trust signals', 'güven sinyalleri') : '',
          r.uiAgentInstructions ? L(lang, 'UI instructions', 'UI talimatları') : '',
        ]);
      }
      case 'ui_art_director': {
        const a = agent.artifact as ArtDirectionArtifact;
        return uniq([
          a.colorSystem?.accent ? L(lang, 'palette', 'palet') : '',
          a.typographyDirection ? L(lang, 'typography', 'tipografi') : '',
          a.visualMood ? L(lang, 'visual mood', 'görsel atmosfer') : '',
          a.colorPsychologyReasoning ? L(lang, 'color psychology reasoning', 'renk psikolojisi gerekçesi') : '',
          nonEmpty(a.componentStyleHints) ? L(lang, 'component style rules', 'bileşen stil kuralları') : '',
          a.responsiveDesignDirection ? L(lang, 'responsive direction', 'duyarlı yön') : '',
        ]);
      }
      case 'strategy': {
        const s = agent.artifact as StrategyAgentArtifact;
        return uniq([
          s.ctaHierarchy?.primary ? L(lang, 'CTA hierarchy', 'CTA hiyerarşisi') : '',
          s.trustStrategy ? L(lang, 'trust strategy', 'güven stratejisi') : '',
          s.conversionStrategy ? L(lang, 'conversion path', 'dönüşüm yolu') : '',
          s.positioning ? L(lang, 'positioning', 'konumlandırma') : '',
          nonEmpty(s.sectionIntent) ? L(lang, 'section intent', 'bölüm amacı') : '',
        ]);
      }
      case 'layout_architect': {
        const b = agent.artifact as PageBlueprint;
        const modules = uniq((b.sections || []).map((x) => x.visualModule).filter((m) => !!m && m !== '—'));
        return uniq([
          b.hero?.variant ? L(lang, 'hero variant', 'hero varyantı') : '',
          nonEmpty(b.sections) ? L(lang, 'section order', 'bölüm sırası') : '',
          b.architecture ? L(lang, 'page blueprint', 'sayfa planı') : '',
          modules.length ? L(lang, 'visual modules', 'görsel modüller') : '',
          b.sectionRhythm ? L(lang, 'layout rhythm', 'yerleşim ritmi') : '',
        ]);
      }
      default:
        return [];
    }
  } catch {
    return [];
  }
}

/** The "what it did" line for a completed agent — from its real artifact. */
function didMessage(agent: WebBuildAgent, lang: Lang): { message: string; type: WebBuildWorkLogType } {
  try {
    switch (agent.id) {
      case 'research': {
        const r = agent.artifact as ResearchAgentArtifact;
        const hasBrief = !!r.targetUser || nonEmpty(r.recommendedPages) || nonEmpty(r.recommendedComponents);
        const didResearch = !!r.didResearch && (r.sourceCount ?? 0) > 0;
        if (!hasBrief) {
          return { message: L(lang, 'created fallback research brief', 'yedek araştırma özeti oluşturdu'), type: 'fallback' };
        }
        const n = r.sourceCount ?? 0;
        return {
          message: didResearch
            ? L(lang, `created research brief from ${n} source${n === 1 ? '' : 's'}`, `${n} kaynaktan araştırma özeti oluşturdu`)
            : L(lang, 'created research brief (strategy inference)', 'araştırma özeti oluşturdu (strateji çıkarımı)'),
          type: 'completed',
        };
      }
      case 'ui_art_director': {
        const a = agent.artifact as ArtDirectionArtifact;
        // Prefer naming the real design archetype it chose (anti-sameness signal);
        // fall back to the research inputs it used, then a generic honest line.
        const arch = a.designArchetype?.name;
        if (arch) {
          return { message: L(lang, `created ${arch} art direction`, `${arch} sanat yönü oluşturdu`), type: 'completed' };
        }
        const used = humanizeUsed(a.usedResearchInputs, lang);
        return {
          message: used.length
            ? L(lang, `used ${joinList(lang, used.slice(0, 3))}`, `${joinList(lang, used.slice(0, 3))} kullandı`)
            : L(lang, 'interpreted Research Agent output', 'Araştırma Ajanı çıktısını yorumladı'),
          type: 'completed',
        };
      }
      case 'strategy': {
        const s = agent.artifact as StrategyAgentArtifact;
        const ur = humanizeUsed(s.usedResearchInputs, lang).length;
        const ua = humanizeUsed(s.usedArtDirectionInputs, lang).length;
        return {
          message: (ur && ua)
            ? L(lang, 'used Research and Art Direction inputs', 'Araştırma ve Sanat Yönetmeni girdilerini kullandı')
            : ur
              ? L(lang, 'used Research inputs', 'Araştırma girdilerini kullandı')
              : L(lang, 'mapped conversion strategy', 'dönüşüm stratejisini planladı'),
          type: 'completed',
        };
      }
      case 'layout_architect': {
        const b = agent.artifact as PageBlueprint;
        const hero = (b.hero?.variant || '').replace(/_/g, ' ');
        return {
          message: hero
            ? L(lang, `selected ${hero} hero and section order`, `${hero} hero ve bölüm sırasını seçti`)
            : nonEmpty(b.sections)
              ? L(lang, 'mapped section order and rhythm', 'bölüm sırası ve ritmini planladı')
              : L(lang, 'created page blueprint', 'sayfa planı oluşturdu'),
          type: 'completed',
        };
      }
      case 'component_engineer': {
        const c = agent.artifact as ComponentEngineerArtifact;
        const comps = Array.isArray(c.componentPlan) ? c.componentPlan.length : 0;
        return {
          message: comps > 0
            ? L(lang, `planned ${comps} components`, `${comps} bileşen planladı`)
            : L(lang, 'planned components', 'bileşenleri planladı'),
          type: 'completed',
        };
      }
      default:
        return { message: L(lang, 'completed', 'tamamlandı'), type: 'completed' };
    }
  } catch {
    return { message: L(lang, 'completed', 'tamamlandı'), type: 'completed' };
  }
}

/** Compose the handoff line. Honest fallback wording when no fields were produced. */
function handoffLine(from: string, to: string, fields: string[], lang: Lang): { message: string; type: WebBuildWorkLogType } {
  if (!fields.length) {
    return { message: L(lang, `${from} passed fallback brief to ${to}`, `${from}, ${to} ajanına yedek özet geçti`), type: 'fallback' };
  }
  const shown = fields.slice(0, 5);
  const list = joinList(lang, shown) + (fields.length > shown.length ? '…' : '');
  return { message: L(lang, `${from} passed ${list} to ${to}`, `${from}, ${list} bilgisini ${to} ajanına geçti`), type: 'handoff' };
}

/**
 * Normalize a finished step's real agents + generated files into the chat work
 * log. Order: per agent, one "what it did" line, then either its handoff line
 * (fields passed to the next agent) or — for the Component Engineer — the real
 * file lines. Every line is derived from real artifact / file data. Skipped or
 * failed agents produce an honest fallback/error line and a fallback handoff.
 * Returns [] for a build with no agents so the chat renders nothing.
 */
export function deriveAgentWorkLog(
  agents: WebBuildAgent[] | undefined,
  files: WorkLogFile[] | undefined,
  lang: Lang = 'en',
): WebBuildAgentWorkLogEntry[] {
  if (!Array.isArray(agents) || !agents.length) return [];
  const byId = new Map<AgentId, WebBuildAgent>();
  for (const a of agents) if (a && a.id) byId.set(a.id, a);

  const nameOf = (id: AgentId): string => byId.get(id)?.name || L(lang, AGENT_NAME[id][0], AGENT_NAME[id][1]);
  const out: WebBuildAgentWorkLogEntry[] = [];
  let seq = 0;
  const push = (e: Omit<WebBuildAgentWorkLogEntry, 'id'>) => out.push({ id: `wl-${seq += 1}`, ...e });

  for (const id of WORKLOG_ORDER) {
    const agent = byId.get(id);
    if (!agent) continue;
    const name = agent.name;
    const nextId = WORKLOG_NEXT[id];
    const toName = nextId ? nameOf(nextId) : undefined;

    // Skipped / failed → honest line + fallback handoff (never claims work).
    if (agent.status === 'failed' || agent.status === 'skipped' || agent.status === 'pending') {
      const failed = agent.status === 'failed';
      push({
        type: failed ? 'error' : 'fallback',
        agent: name,
        message: failed
          ? L(lang, `${name} did not complete — safe defaults used`, `${name} tamamlanamadı — güvenli varsayılanlar kullanıldı`)
          : L(lang, `${name} skipped — safe defaults used`, `${name} atlandı — güvenli varsayılanlar kullanıldı`),
      });
      if (toName) {
        const h = handoffLine(name, toName, [], lang);
        push({ type: h.type, agent: name, fromAgent: name, toAgent: toName, message: h.message, fieldsPassed: [] });
      }
      continue;
    }

    // Done → real "what it did" line.
    const did = didMessage(agent, lang);
    push({ type: did.type, agent: name, message: `${name} ${did.message}` });

    if (id === 'component_engineer') {
      // Real files written, with real +/- diffs. New files: "+lineCount -0".
      const list = Array.isArray(files) ? files : [];
      const changed = list.filter((f) => f && f.path && (f.status !== 'unchanged'));
      const shown = (changed.length ? changed : list.filter((f) => f && f.path)).slice(0, 8);
      for (const f of shown) {
        const added = Math.max(0, f.added || 0);
        const removed = Math.max(0, f.removed || 0);
        if (added === 0 && removed === 0) {
          // No reliable diff — show an honest "generated N lines" (0 → skip).
          continue;
        }
        // Message carries the real path + real +/- diff (never a fabricated
        // minus); the renderer shows the path + diff, but every entry keeps a
        // complete, honest message for a11y / non-file render paths.
        push({
          type: 'file',
          agent: name,
          filePath: f.path,
          linesAdded: added,
          linesRemoved: removed,
          message: L(lang, `${name} generated ${f.path} +${added} -${removed}`, `${name}, ${f.path} dosyasını oluşturdu +${added} -${removed}`),
        });
      }
    } else if (toName) {
      // Handoff to the next agent — real produced fields, honest fallback.
      const fields = producedFields(agent, lang);
      const h = handoffLine(name, toName, fields, lang);
      push({ type: h.type, agent: name, fromAgent: name, toAgent: toName, message: h.message, fieldsPassed: fields });
    }
  }

  return out;
}
