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
import { deriveDesignSystemFromStrategy, selectPaletteFamily, PALETTE_FAMILIES, type PaletteFamily } from '@/lib/webBuildDesignSystem';
import type { WebBuildLayoutPlan, HeroComposition, SectionVariant } from '@/lib/webBuildLayoutPlan';
import { deriveInteractionContract, type InteractionContract } from '@/lib/webBuildInteractionContract';
import {
  resolveProductIntent, hasExplicitChatIntent,
  type ProductIntent, type ProductLang,
} from '@/lib/webBuildProductIntent';

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
  /* ── Stronger, category-aware hand-off (all optional → backward compatible). ── */
  /** What proof/trust the Art Director must foreground for this concept. */
  trustFocus?: string;
  /** How imagery/visuals should be composed for this concept. */
  imageryDirection?: string;
  /** A concrete anti-template warning tied to the detected concept category. */
  layoutWarning?: string;
}

/** The Research Agent's precise concept understanding — a compact, structured
 *  read of WHAT the site is, WHO it's for, and the visitor's decision/conversion/
 *  proof model. Consumed by the UI / Art Director and Strategy agents. All fields
 *  are plain strings so it persists safely; the whole field is optional so old
 *  saved builds still load. Inferred deterministically from prompt + brief +
 *  category signals — never a fixed per-example template. */
export interface ConceptProfile {
  /** Detected concept category key (e.g. 'archive', 'hospitality', 'saas'). */
  category: string;
  /** A precise one-line statement of what the site is. */
  whatItIs: string;
  /** The primary audience this concept serves. */
  whoFor: string;
  /** What the visitor is actually trying to do on this site. */
  visitorIntent: string;
  /** The business/content model (service, catalog, product, editorial, event…). */
  businessModel: string;
  /** The decision the visitor must make before converting. */
  keyDecision: string;
  /** The single primary conversion the site drives toward. */
  mainConversion: string;
  /** The proof/trust this specific concept must show to earn the conversion. */
  proofNeeded: string[];
  /** The dominant content type (catalog, editorial, product, service, event…). */
  contentType: string;
}

/* ── Concept Authority (Phase 5) ──────────────────────────────────────────
 * Separates the THREE things the pipeline used to conflate:
 *   1. primaryConcept  — the product/concept category that OWNS the visual
 *      archetype/layout/hero/component style (e.g. an "AI chatbot product").
 *   2. targetVertical  — the industry/customer the product SERVES; it may only
 *      influence copy / proof / examples, NEVER the visual identity (e.g. the
 *      "ecommerce stores" in "AI chatbot for ecommerce stores").
 *   3. contentModel    — the dominant content/domain the site presents.
 * The general grammar rule is "<product/concept> for <industry/customer>": the
 * product/concept has authority; the industry/customer is the target vertical —
 * UNLESS the whole concept is itself a store/marketplace. All optional &
 * backward compatible: when authority cannot be determined it is simply omitted
 * and the pipeline keeps its previous behavior. */
export interface ConceptAuthority {
  /** The concept category that CONTROLS the visual archetype/layout/hero. */
  primaryConcept: ConceptCategory | string;
  /** The industry/customer the product serves (informs copy/proof only). */
  targetVertical?: ConceptCategory | string;
  /** A human-readable phrase for the target vertical when it isn't a category. */
  audienceVertical?: string;
  /** The product/business model (e.g. "SaaS/product demo", "catalog/listing site"). */
  productModel?: string;
  /** The dominant content model (e.g. "product marketing + front-end demo"). */
  contentModel?: string;
  confidence: 'high' | 'medium' | 'low';
  /** Honest one-line explanation of the read (owner/dev diagnostic). */
  reason: string;
  /** Archetype keys the visual identity must NOT drift to (guard the art dir). */
  mustNotDriftTo?: string[];
}

/* ── Strategic Thinking Ledger (Phase 8A) ─────────────────────────────────
 * The single, structured "Think" decision the pipeline COMMITS to before it
 * builds — deterministic, derived from the prompt + brief + Research (Concept
 * Authority) + inferred playbook, NEVER a model call. It is the strategic contract
 * the downstream agents (Art Direction, Strategy, Layout Steering, Quality
 * Director, Fixer) READ and obey, so the build stops drifting into a generic
 * SaaS/dashboard/agency template and keeps all copy in ONE language. Every field
 * is plain data; the whole artifact is optional and backward compatible (absent →
 * the pipeline keeps its previous behaviour). */
export type DemoSurfaceIntent =
  | 'chat-demo' | 'product-flow-demo' | 'dashboard-demo' | 'catalog-demo'
  | 'booking-demo' | 'content-demo' | 'none'
  // Phase 12F — additive, backward-compatible families for non-chat products.
  | 'workflow-demo' | 'calculator-demo' | 'assessment-demo';

/* ── Model-native Design Plan (Phase 9A) ──────────────────────────────────
 * The model's OWN design decisions (from the visible `## Design Thinking Plan`),
 * normalized to the layout/palette vocabulary the downstream agents obey. When
 * present it CONTROLS taste/composition (hero, palette, demo surface); the
 * deterministic Concept Authority still protects correctness. Entirely optional —
 * old builds simply carry no modelDesignPlan and the deterministic ledger applies. */
export interface ModelDesignPlan {
  designThesis?: string;
  firstImpression?: string;
  selectedVisualDirection?: string;
  /** Raw rejected-directions line + the split, meaningful items. */
  rejectedDirections?: string;
  rejectedLooks: string[];
  heroCompositionDecision?: string;
  sectionRhythmDecision?: string;
  paletteDecision?: string;
  typographyDecision?: string;
  templateTrapsToAvoid?: string;
  templateTraps: string[];
  differentiationMove?: string;
  qualityBar?: string;
  /** Normalized to the layout plan's hero vocabulary (validated downstream). */
  heroComposition?: string;
  /** Normalized to a visual-module key (product-showcase / data-dashboard / …). */
  demoModule?: string;
  /** Normalized palette family the art direction should apply, if the model named one. */
  paletteFamily?: string;
  /** True when the model explicitly rejected gold/amber (or a dark-grid+gold look). */
  avoidGold: boolean;
  /** 0–100 — how concrete/meaningful the model's plan is (anti-generic gate). */
  planSpecificityScore: number;
  /** Honest warnings when the plan is vague/generic (used by Quality Director). */
  weakDesignPlanWarnings: string[];
  /** True when the model rejected ≥2 specific directions. */
  hasMeaningfulRejectedDirections: boolean;
}

export interface StrategicThinkingLedger {
  /** Detected output language for ALL website copy (mixed-language is forbidden). */
  languageIntent: string;
  /** One precise sentence: what this site IS. */
  conceptThesis: string;
  /** The primary concept category that OWNS the visual identity. */
  primaryConcept: string;
  /** The industry/customer the product serves (informs copy/proof only). */
  targetVertical?: string;
  /** Identities this site must NOT drift into (e.g. dashboard/marketplace/agency). */
  mustNotBecome: string[];
  /** What the visitor must be able to decide above the fold. */
  visitorDecision: string;
  /** The primary conversion path (e.g. Landing → Lead Capture → Chat/Product Demo). */
  primaryConversionPath: string;
  /** The kind of front-end-only demo surface this concept needs. */
  demoSurfaceIntent: DemoSurfaceIntent;
  /** What the front-end-only demo must make clear. */
  demoSurfaceMustShow: string[];
  /** What the demo must avoid (fake metrics/logos/AI claims/unrelated dashboards). */
  demoSurfaceMustAvoid: string[];
  /** What EVERY section must prove to avoid generic filler. */
  sectionSpecificityBar: string;
  /** Generic labels (lowercased tokens) that must be repaired for this concept. */
  forbiddenGenericLabels: string[];
  /** Honest, concept-specific labels the Fixer can swap generic filler for. */
  preferredSectionLabels: string[];
  /** No mixed-language fallback labels; copy follows the prompt language. */
  languageRules: string;
  /** What "premium enough" means for this concept. */
  qualityBar: string;
  /** Honest one-line explanation of the read (owner/dev diagnostic). */
  reason: string;
  /** The model's OWN design plan (Phase 9A) — controls taste/composition when present. */
  modelDesignPlan?: ModelDesignPlan;
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
  /** Precise concept understanding — the strongest single signal downstream
   *  agents can read to avoid a generic build. Optional → backward compatible. */
  conceptProfile?: ConceptProfile;
  /** Concept Authority (Phase 5) — separates the primary concept (owns the
   *  visual archetype) from the target vertical (informs copy/proof only), so a
   *  "<product> for <vertical>" prompt never drifts the identity to the vertical.
   *  Optional → backward compatible. */
  conceptAuthority?: ConceptAuthority;
}

/* ── Visual Asset & Motion Plan (Phase 5) — DATA ONLY ─────────────────────
 * A concept-specific, prompt-ready description of the visual assets the site
 * needs. THIS PHASE NEVER CALLS AN IMAGE/VIDEO API — it only produces CSS/SVG/
 * motion direction plus prompt-ready asset slots that a LATER phase can either
 * compose (css-svg-now) or hand to an external image/video generator. All fields
 * are plain data; consumed by the preview/file layers in a future phase. */
export type HeroVisualType =
  | 'css-abstract' | 'svg-illustration' | 'product-mockup' | 'dashboard-mockup'
  | 'photo-direction' | 'pattern-system' | 'canvas-motion';

export interface VisualAssetSlot {
  id: string;
  purpose: string;
  type: 'hero' | 'section' | 'card' | 'background' | 'mockup';
  /** Whether the asset is composed now (CSS/SVG) or reserved for a later external
   *  image/video generation phase. */
  generationMode: 'css-svg-now' | 'external-image-later' | 'external-video-later';
  /** A prompt-ready description of the asset (for CSS/SVG now or an image model later). */
  prompt: string;
}

export interface VisualAssetPlan {
  heroVisualType: HeroVisualType;
  animatedBackground?: string;
  /** Prompt-ready text for a future external image generator (never called now). */
  imageGenerationPrompt?: string;
  /** Prompt-ready text for a future external video/motion generator (never called now). */
  videoMotionPrompt?: string;
  assetSlots: VisualAssetSlot[];
  constraints: string[];
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
  /* ── Richer Research Agent signals (optional → backward compatible). ── */
  conceptProfile?: boolean;
  trustFocus?: boolean;
  imageryDirection?: boolean;
  layoutWarning?: boolean;
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

/* ── Visual Exploration (Phase 7B) — explore multiple directions, choose one ──
 * The Art Director produces 3 candidate visual directions (safe / premium-
 * differentiated / unexpected-but-appropriate), then selects one and records why
 * — so the build stops defaulting to the same dark/gold/dashboard template. All
 * optional & backward compatible. */
export interface VisualDirectionCandidate {
  id: string;
  name: string;
  paletteIntent: string;
  accentStrategy: string;
  backgroundStrategy: string;
  heroComposition: string;
  mockupStrategy: string;
  motionMood: string;
  typographyMood: string;
  whyItFits: string;
  risks: string[];
  /** The palette family this candidate maps to (drives the concrete tokens). */
  paletteFamily?: string;
}

export interface VisualExplorationArtifact {
  candidates: VisualDirectionCandidate[];
  selectedCandidateId: string;
  rejectedCandidateIds: string[];
  selectionReason: string;
  antiTemplateNotes: string[];
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
  /* ── Visual identity system + anti-template diagnosis (all optional, backward
   *  compatible). Populated by deriveArtDirection and surfaced to downstream
   *  agents via downstreamInstructions; safe to ignore on old saved builds. ── */
  /** A one-line design thesis / visual signature for the chosen identity. */
  visualSignature?: string;
  /** Why this direction is NOT a generic SaaS template (concept + archetype). */
  antiTemplateDiagnosis?: string;
  /** Concrete, visible differentiators (palette, hero, imagery, card language). */
  visualDifferentiators?: string[];
  /** Section-rhythm / composition grammar rules for the Layout Architect. */
  compositionRules?: string[];
  /** Surface / material rules for the Component Engineer + preview. */
  surfaceRules?: string[];
  /** How proof/trust must be presented for this concept. */
  proofRules?: string[];
  /* ── Phase 5: Concept Authority + Visual Asset Plan (all optional) ── */
  /** The Concept Authority this art direction obeyed — the primary concept
   *  controls the archetype; the target vertical only informs copy/proof. Echoed
   *  here so downstream + the Reviewer can detect concept drift. */
  conceptAuthority?: ConceptAuthority;
  /** Set true when the archetype was re-asserted after a target-vertical drift
   *  (e.g. an AI/SaaS product that was resolving to a marketplace identity). */
  correctedConceptDrift?: boolean;
  /** Data-only visual asset & motion plan (CSS/SVG now, external gen later). */
  visualAssetPlan?: VisualAssetPlan;
  /* ── Phase 7B: Visual Exploration + anti-template (all optional) ── */
  /** 3 explored visual directions + the selected one (anti-sameness). */
  visualExploration?: VisualExplorationArtifact;
  /** The concrete palette family chosen for this build (anti-sameness color). */
  paletteFamily?: string;
  /** Set true when the Fixer corrected a same-template (dark/gold/dashboard) drift. */
  correctedAntiTemplateDrift?: boolean;
}

/* ── Strategy Agent artifact (Phase 2) ────────────────────────────────── */
export interface StrategyCTAHierarchy { primary: string; secondary: string }
export interface StrategySectionIntent { section: string; purpose: string; visitorQuestion: string }

/** The MODEL's AI-native Website Experience Plan (Phase 3) — its own decision about
 *  the website + FRONT-END DEMO architecture, carried from the parsed brief. Never a
 *  real product/backend; all fields optional. Consumed by the Interaction Contract. */
export interface WebsiteExperiencePlan {
  websiteExperienceModel?: string;
  pageScreenModel?: string;
  primaryWebsiteExperience?: string;
  demoSurfaces?: string[];
  statefulDemoComponents?: string[];
  navigationModel?: string;
  mediaMotionPlan?: string;
  /* ── Entry Flow (Phase 6B) — how the visitor ENTERS the experience. All
   *  optional & backward compatible; populated from the model's brief fields and
   *  consumed by the Interaction Contract → Preview entry-flow resolver. */
  entryFlowModel?: string;
  landingRequired?: string;
  entryScreen?: string;
  postEntryScreen?: string;
  primaryEntryCTA?: string;
  secondaryEntryCTA?: string;
  navigationBehavior?: string;
  /* ── Conversion Journey (Phase 6F) — the single primary conversion path
   *  (Landing → optional Lead Capture → Demo/Catalog/…). All optional; the lead
   *  step is a LOCAL static form shell only (never a real signup/auth/backend). */
  conversionJourneyModel?: string;
  primaryConversionIntent?: string;
  leadCaptureRequired?: string;
  leadCaptureFields?: string;
  afterLeadCaptureScreen?: string;
  ctaConsistencyRule?: string;
  summary: string;
}

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
  /** Phase 1 Interaction Contract — the structured, concept-specific declaration
   *  of which actions each section should support (open-chat-demo, filter-list,
   *  open-record-detail …). Optional → old saved builds still load. Downstream
   *  Preview/Files DO NOT consume it yet (contract-only phase). */
  interactionContract?: InteractionContract;
  /** Phase 3 — the model's own Website Experience Plan (experience model, page/
   *  screen model, navigation model, demo surfaces…). Optional → old builds load.
   *  The Interaction Contract PREFERS this over deterministic keyword fallbacks. */
  websiteExperiencePlan?: WebsiteExperiencePlan;
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

/* ── Reviewer Agent artifact — a real quality gate (Phase 5) ─────────────
 * A structured, ADVISORY review of the finished build. It inspects the real
 * upstream artifacts + the final section list / layout plan / generated files and
 * records honest findings + fix instructions for a future Fixer Agent. It never
 * rewrites the site, never fabricates claims, and never blocks Preview/All Files. */
export type ReviewSeverity = 'info' | 'warning' | 'critical';
export type ReviewStatus = 'passed' | 'needs-fixes' | 'failed-open';

export interface ReviewerFinding {
  id: string;
  severity: ReviewSeverity;
  category: string;
  title: string;
  /** What in the real artifacts/data triggered this (honest, no fabrication). */
  evidence: string;
  /** Actionable recommendation for the future Fixer Agent. */
  recommendation: string;
  /** Optional target (section id, file path, artifact field). */
  target?: string;
}

export interface ReviewerChecklist {
  conceptFit: boolean;
  antiTemplate: boolean;
  visualIdentity: boolean;
  sectionArchitecture: boolean;
  contentHonesty: boolean;
  fakeDataGuard: boolean;
  interactionReadiness: boolean;
  motionFit: boolean;
  accessibilityBasics: boolean;
  responsiveBasics: boolean;
  /** Only true when the agent actually had both sections AND files to compare. */
  previewFilesParity: boolean;
}

export interface ReviewerAgentArtifact {
  status: ReviewStatus;
  checklist: ReviewerChecklist;
  findings: ReviewerFinding[];
  passed: string[];
  risks: string[];
  fixInstructions: string[];
  futureFixerScope: string[];
  usedResearchInputs?: string[];
  usedArtDirectionInputs?: string[];
  usedStrategyInputs?: string[];
  usedBlueprintInputs?: string[];
  usedComponentInputs?: string[];
  summary: string;
}

/* ── Fixer Agent (Phase 6) ─────────────────────────────────────────────────
 * The first Fixer runs AFTER the Reviewer. It consumes the Reviewer artifact
 * and applies a NARROW set of SAFE, deterministic repairs to the FINAL build
 * data (generated files + section items). It never redesigns, never invents
 * content/metrics/proof/sources, and always fails OPEN — so Preview / All Files
 * always render, unchanged if the Fixer cannot safely help. */
export type FixerStatus = 'applied' | 'no-op' | 'failed-open';

/** One safe repair the Fixer actually performed (before/after are real). */
export interface FixerAppliedChange {
  id: string;
  category: string;
  /** File path or section id the change touched. */
  target: string;
  before?: string;
  after?: string;
  reason: string;
}

/** A repair the Fixer deliberately did NOT perform (out of safe v1 scope). */
export interface FixerSkippedChange {
  id: string;
  category: string;
  target?: string;
  reason: string;
}

export interface FixerAgentArtifact {
  status: FixerStatus;
  appliedChanges: FixerAppliedChange[];
  skippedChanges: FixerSkippedChange[];
  /** Reviewer finding ids/titles the Fixer actually consumed. */
  consumedReviewerFindings: string[];
  /** Reviewer fixInstructions the Fixer actually acted on. */
  consumedFixInstructions: string[];
  /** The categories of repair this v1 Fixer is allowed to perform. */
  safeRepairScope: string[];
  /** The categories of repair the Fixer refused (reserved for future phases). */
  refusedScope: string[];
  /* ── Quality Director consumption (Phase 7A, optional) ── */
  /** Quality Director issue ids/categories the Fixer actually consumed. */
  consumedQualityIssues?: string[];
  /** Public-facing copy/label/CTA repairs applied from the Quality Director. */
  qualityAppliedChanges?: FixerAppliedChange[];
  /** Quality repairs deliberately NOT performed (out of safe scope). */
  qualitySkippedChanges?: FixerSkippedChange[];
  summary: string;
}

/* ── Quality Director (Phase 7A) ───────────────────────────────────────────
 * A senior quality judge that runs AFTER the Reviewer and BEFORE the Fixer. It
 * scores the finished build across premium-quality dimensions and records honest,
 * actionable issues (raw/model-internal labels, CTA inconsistency, generic copy,
 * flow confusion, concept drift, honesty risk). It inspects REAL artifacts only,
 * never fabricates facts, never blocks the build, and fails OPEN. The Fixer
 * consumes its issues to safely repair public-facing copy/label/CTA language. */
export type QualityIssueCategory =
  | 'raw-label' | 'cta-inconsistency' | 'generic-copy' | 'weak-hero'
  | 'flow-confusion' | 'demo-unclear' | 'visual-density' | 'concept-drift' | 'honesty-risk'
  /* ── Phase 7B: anti-template visual checks ── */
  | 'same-template-risk' | 'accent-overuse' | 'dashboard-overuse' | 'palette-mismatch'
  | 'visual-monotony' | 'weak-visual-exploration'
  /* ── Phase 9A: model-native design plan quality ── */
  | 'weak-design-plan'
  /* ── Phase 9C-1: public-facing copy/label quality ── */
  | 'public-copy-smell'
  /* ── Phase 9C-2: generic content-depth quality ── */
  | 'generic-content-depth';

export interface QualityIssue {
  id: string;
  severity: ReviewSeverity;
  category: QualityIssueCategory;
  /** Optional target (section id, artifact field, label). */
  target?: string;
  /** What in the real artifacts/data triggered this (honest, no fabrication). */
  evidence: string;
  recommendation: string;
}

export interface QualityDimensions {
  copyClarity: number;
  ctaConsistency: number;
  flowCoherence: number;
  visualPremiumFit: number;
  conceptSpecificity: number;
  demoUsefulness: number;
  honesty: number;
}

export interface QualityDirectorArtifact {
  status: 'passed' | 'needs-fixes' | 'failed-open';
  /** 0–100 overall premium-quality score. */
  score: number;
  dimensions: QualityDimensions;
  issues: QualityIssue[];
  approvedPrinciples: string[];
  /** Safe, public-facing rewrite guidance for the Fixer (labels/CTA/flow only). */
  rewriteInstructions: string[];
  summary: string;
}

/* ── Asset Director (Phase 10A) — PLANS visual assets before rendering ─────────
 * Decides WHAT visual assets the site needs (hero/section visuals, motion needs,
 * image needs, CSS/SVG slots, future image-generation slots) + honesty/safety
 * constraints. THIS PHASE NEVER GENERATES IMAGES, calls an image/video API, adds
 * video, or touches the backend — it is planning/data + diagnostics only. Slots
 * are consumed by a LATER phase (10B motion / 10C image pipeline). */
export type AssetGenerationMode =
  | 'css-svg-now'
  | 'motion-css-now'
  | 'image-prompt-later'
  | 'image-provider-later'
  | 'manual-upload-later'
  | 'none';

export type AssetSlotType =
  | 'hero-visual'
  | 'hero-background'
  | 'product-mockup'
  | 'section-illustration'
  | 'motion-background'
  | 'gallery-image'
  | 'before-after'
  | 'icon-system'
  | 'trust-visual'
  | 'integration-map'
  | 'catalog-preview'
  | 'archive-document'
  | 'local-project-photo'
  | 'abstract-brand-shape';

export interface AssetSlot {
  id: string;
  type: AssetSlotType;
  /** hero, a section id, a screen id, or 'global'. */
  target: string;
  purpose: string;
  generationMode: AssetGenerationMode;
  /** Prompt-ready description (for CSS/SVG now or an image model later). Never a
   *  real person/brand/institution; illustrative only. */
  prompt: string;
  negativePrompt?: string;
  styleNotes: string;
  motionNotes?: string;
  safetyNotes: string[];
  required: boolean;
  priority: 'high' | 'medium' | 'low';
}

export interface AssetStyleSystem {
  visualLanguage: string;
  paletteFamily?: string;
  materialStyle: string;
  cameraOrComposition?: string;
  lighting?: string;
  texture?: string;
  shapeLanguage?: string;
  iconStyle?: string;
  motionMood?: string;
  consistencyRules: string[];
}

export interface AssetDirectorArtifact {
  status: 'planned' | 'partial' | 'failed-open';
  assetStrategy: string;
  styleSystem: AssetStyleSystem;
  slots: AssetSlot[];
  cssSvgNowSlots: string[];
  motionNowSlots: string[];
  imageLaterSlots: string[];
  forbiddenAssets: string[];
  honestyConstraints: string[];
  providerReadiness: {
    imageProviderNeeded: boolean;
    motionProviderNeeded: boolean;
    manualUploadUseful: boolean;
    reason: string;
  };
  summary: string;
}

/* ── Motion Composer (Phase 10B) — composes SUBTLE CSS/SVG motion ──────────────
 * Consumes the Asset Director's `motion-css-now` slots and decides concept-specific
 * motion LAYERS (pattern + intensity + target) the Preview renders with framer-
 * motion / CSS only. THIS IS NOT VIDEO, not image generation, not a provider, and
 * touches no backend. Motion is subtle by default, respects prefers-reduced-motion,
 * and never fakes real backend work (no fake loading/progress/inventory). */
export type MotionPattern =
  | 'ambient-gradient'
  | 'floating-cards'
  | 'chat-typing'
  | 'integration-orbit'
  | 'before-after-reveal'
  | 'organic-drift'
  | 'document-scan'
  | 'catalog-filter-shift'
  | 'menu-reveal'
  | 'timeline-progress'
  | 'trust-pulse'
  | 'none';

export interface MotionLayer {
  id: string;
  /** hero, global, a section id ('section:<id>'), or a screen id. */
  target: string;
  pattern: MotionPattern;
  intensity: 'minimal' | 'subtle' | 'expressive';
  purpose: string;
  /** Loop/transition duration in seconds. */
  duration: number;
  delay?: number;
  reducedMotionFallback: string;
  safetyNotes: string[];
}

export interface MotionComposerArtifact {
  status: 'composed' | 'partial' | 'failed-open';
  motionStrategy: string;
  layers: MotionLayer[];
  globalMotion: MotionLayer[];
  heroMotion: MotionLayer[];
  sectionMotion: MotionLayer[];
  consumedAssetSlots: string[];
  reducedMotionPolicy: string;
  forbiddenMotion: string[];
  summary: string;
}

/* ── Image Pipeline (Phase 10C) — turns Asset Director image slots into a ─────────
 * structured, provider-READY plan + honest Preview placeholders. THIS PHASE DOES
 * NOT call any image API, generate real images, upload to a backend, or add video.
 * It consumes the Asset Director's image-prompt-later / image-provider-later /
 * manual-upload-later slots and produces prompt-ready / provider-ready / manual-
 * upload / CSS-placeholder image slots. Any generated imagery is illustrative-only;
 * proof-heavy visuals are marked manual-upload-recommended. */
export type ImageAssetSource =
  | 'manual-upload'
  | 'provider-ready'
  | 'prompt-ready'
  | 'css-placeholder'
  | 'none';

export type ImageAssetKind =
  | 'hero-image'
  | 'hero-background'
  | 'project-photo'
  | 'gallery-photo'
  | 'before-after-pair'
  | 'food-photo'
  | 'restaurant-space'
  | 'product-listing-image'
  | 'catalog-cover'
  | 'archive-scan'
  | 'portfolio-work-image'
  | 'team-or-studio-photo'
  | 'abstract-brand-image'
  | 'illustrative-product-scene';

export interface ImageAssetPrompt {
  positive: string;
  negative: string;
  style: string;
  aspectRatio: '16:9' | '4:3' | '3:2' | '1:1' | '9:16' | '21:9';
  consistencySeedHint?: string;
  safetyNotes: string[];
}

export interface ImageAssetSlot {
  id: string;
  sourceAssetSlotId?: string;
  kind: ImageAssetKind;
  /** hero, a section id ('section:<id>'), a screen id, or 'global'. */
  target: string;
  source: ImageAssetSource;
  title: string;
  purpose: string;
  prompt: ImageAssetPrompt;
  placeholderLabel: string;
  previewTreatment:
    | 'large-hero-frame'
    | 'gallery-grid'
    | 'before-after-frame'
    | 'catalog-card'
    | 'archive-document-frame'
    | 'ambient-background'
    | 'small-inline-frame';
  required: boolean;
  priority: 'high' | 'medium' | 'low';
  manualUploadRecommended: boolean;
  providerReady: boolean;
  honestyLabel: string;
}

export interface ImagePipelineArtifact {
  status: 'planned' | 'partial' | 'failed-open';
  imageStrategy: string;
  styleConsistencyRules: string[];
  slots: ImageAssetSlot[];
  manualUploadSlots: string[];
  providerReadySlots: string[];
  promptReadySlots: string[];
  cssPlaceholderSlots: string[];
  forbiddenImageContent: string[];
  generatedImagePolicy: string;
  providerReadiness: {
    readyForProvider: boolean;
    recommendedProviderType: 'image-generation' | 'stock-search' | 'manual-upload' | 'none';
    reason: string;
  };
  summary: string;
}

export type AgentId = 'research' | 'ui_art_director' | 'strategy' | 'vertical_intelligence' | 'layout_architect' | 'component_engineer' | 'reviewer' | 'quality_director' | 'asset_director' | 'motion_composer' | 'image_pipeline' | 'fixer';
export type AgentArtifact =
  ResearchAgentArtifact | ArtDirectionArtifact | StrategyAgentArtifact | PageBlueprint
  | ComponentEngineerArtifact | ReviewerAgentArtifact | QualityDirectorArtifact | AssetDirectorArtifact | MotionComposerArtifact | ImagePipelineArtifact | VerticalIntelligenceArtifact | FixerAgentArtifact | Record<string, unknown>;

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
  /* ── Reviewer gate trace (Phase 5, optional, backward compatible) ── */
  didRunReviewer?: boolean;
  didReviewerFindCriticalIssues?: boolean;
  didIncludeReviewerInFinalPayload?: boolean;
  /* ── Fixer trace (Phase 6, optional, backward compatible) ── */
  didRunFixer?: boolean;
  didFixerApplyChanges?: boolean;
  didIncludeFixerInFinalPayload?: boolean;
  /* ── Concept Authority + Visual Quality gate (Phase 5, optional) ── */
  /** The resolved primary concept (owns the visual archetype). */
  primaryConcept?: string;
  /** The resolved target vertical (informs copy/proof only). */
  targetVertical?: string;
  conceptAuthorityConfidence?: 'high' | 'medium' | 'low';
  /** True when the Reviewer flagged concept/visual drift (art ≠ primary concept). */
  didDetectConceptDrift?: boolean;
  /** True when the Fixer safely corrected concept/visual drift in the artifacts. */
  didFixConceptDrift?: boolean;
  /** True when a concept-specific Visual Asset Plan was produced (data only). */
  didCreateVisualAssetPlan?: boolean;
  /* ── Quality Director + Copy/CTA Fixer (Phase 7A, optional) ── */
  didRunQualityDirector?: boolean;
  qualityScore?: number;
  qualityStatus?: 'passed' | 'needs-fixes' | 'failed-open';
  qualityCriticalCount?: number;
  qualityWarningCount?: number;
  didFixCopyLabels?: boolean;
  didFixCtaConsistency?: boolean;
  didFixFlowLabels?: boolean;
  /* ── Visual Exploration + anti-template gate (Phase 7B, optional) ── */
  visualCandidateCount?: number;
  selectedVisualCandidate?: string;
  rejectedVisualCandidates?: string[];
  selectionReason?: string;
  paletteFamily?: string;
  antiTemplateWarnings?: number;
  correctedAntiTemplateDrift?: boolean;
  qualitySameTemplateIssues?: number;
  /* ── Asset Director trace (Phase 10A, optional, backward compatible) ── */
  didRunAssetDirector?: boolean;
  assetSlotCount?: number;
  cssSvgAssetSlotCount?: number;
  motionAssetSlotCount?: number;
  imageLaterAssetSlotCount?: number;
  manualUploadAssetSlotCount?: number;
  imageProviderNeeded?: boolean;
  motionProviderNeeded?: boolean;
  /* ── Motion Composer trace (Phase 10B, optional, backward compatible) ── */
  didRunMotionComposer?: boolean;
  motionLayerCount?: number;
  globalMotionLayerCount?: number;
  heroMotionLayerCount?: number;
  sectionMotionLayerCount?: number;
  consumedMotionAssetSlotCount?: number;
  reducedMotionReady?: boolean;
  /* ── Image Pipeline trace (Phase 10C, optional, backward compatible) ── */
  didRunImagePipeline?: boolean;
  imageAssetSlotCount?: number;
  manualUploadImageSlotCount?: number;
  providerReadyImageSlotCount?: number;
  promptReadyImageSlotCount?: number;
  cssPlaceholderImageSlotCount?: number;
  imageProviderReady?: boolean;
  generatedImagePolicy?: string;
  /* ── Vertical Intelligence trace (Phase 11A/11B, optional, backward compatible) ──
   *  Deterministic sector classification diagnostics — planning/data only. The
   *  frontend runs no network request; Phase 11B surfaces the EXISTING Web Build
   *  research result (source-backed only when real URLs exist). */
  didDeriveVerticalIntelligence?: boolean;
  verticalSector?: VerticalSector;
  verticalSubsector?: string;
  verticalAudienceSector?: VerticalSector;
  verticalClassificationBasis?: VerticalClassificationBasis;
  verticalBusinessModel?: VerticalBusinessModel;
  verticalConfidence?: 'high' | 'medium' | 'low';
  verticalRequiredSectionCount?: number;
  verticalRecommendedSectionCount?: number;
  verticalForbiddenSectionCount?: number;
  verticalRealSourceVisualCount?: number;
  verticalAiIllustrativeVisualCount?: number;
  verticalCssSvgVisualCount?: number;
  verticalMotionSuitableCount?: number;
  verticalResearchRecommended?: boolean;
  /** Real research status (Phase 11B) or 'not-run' when no research artifact. */
  verticalResearchStatus?: WebBuildResearchStatus | 'not-run';
  /** Whether genuine, source-backed vertical research evidence exists (real URLs). */
  verticalResearchDidUseSources?: boolean;
  /** Count of validated, deduped real sources backing the vertical read. */
  verticalResearchSourceCount?: number;
  /** The research provider that returned sources, when present. */
  verticalResearchProvider?: string;
  /* ── Frontend Build Specification trace (Phase 12A, optional, backward compatible) ──
   *  Diagnostics for the model-native generation CONTRACT only. No model/backend/
   *  network runs in this phase; frontendGenerationStatus is always 'not-run'. */
  didCreateFrontendBuildSpec?: boolean;
  frontendBuildSpecStatus?: FrontendBuildSpecStatus;
  frontendBuildSpecSectionCount?: number;
  frontendBuildSpecRequiredFileCount?: number;
  frontendBuildSpecResearchSourceCount?: number;
  frontendGenerationStatus?: FrontendGenerationStatus;
  /* ── Dedicated Frontend Builder trace (Phase 12B, optional, backward compatible) ──
   *  Diagnostics for the raw `frontend_builder` model call. didRunFrontendBuilder is
   *  true ONLY when a real network request was attempted (a 'skipped' artifact is
   *  false). validationStatus is always 'not-run' in this phase. */
  didRunFrontendBuilder?: boolean;
  frontendBuilderRawStatus?: FrontendBuilderRawStatus;
  frontendBuilderResponseCharCount?: number;
  frontendBuilderValidationStatus?: FrontendBuilderValidationStatus;
  frontendBuilderMode?: string;
  frontendBuilderModel?: string;
  frontendBuilderProvider?: string;
  /* ── Frontend Builder validation trace (Phase 12C, optional, backward compatible) ──
   *  Static parse + contract validation diagnostics. STATIC only — a valid result is
   *  NOT proven to compile or render, and it never replaces payload.files. */
  didValidateFrontendBuilder?: boolean;
  frontendBuilderParsedFileCount?: number;
  frontendBuilderParsedCharCount?: number;
  frontendBuilderValidationErrorCount?: number;
  frontendBuilderValidationWarningCount?: number;
  frontendBuilderMissingRequiredFileCount?: number;
  frontendBuilderMissingSectionFileCount?: number;
  frontendBuilderUnresolvedImportCount?: number;
  frontendBuilderUnsupportedPackageCount?: number;
  frontendBuilderReadyForConsumption?: boolean;
  /* ── Frontend Builder consumption trace (Phase 12D, optional, backward compatible) ──
   *  Whether validated model-native files replaced the active file set + drive All
   *  Files and the isolated runtime Preview. `didConsumeFrontendBuilderFiles` is true
   *  ONLY on a real model-native consumption; a fallback must never claim consumption.
   *  Consumption ≠ runtime compilation ≠ visual review (Phase 12E). */
  didConsumeFrontendBuilderFiles?: boolean;
  frontendBuilderConsumptionStatus?: FrontendBuilderConsumptionStatus;
  frontendBuilderFileSource?: FrontendBuilderFileSource;
  frontendBuilderAllFilesSource?: FrontendBuilderFileSource;
  frontendBuilderPreviewSource?: FrontendBuilderPreviewSource;
  frontendBuilderConsumedFileCount?: number;
  frontendBuilderConsumedCharCount?: number;
  frontendBuilderConsumptionReason?: string;
  fallbackReason?: string;
  /* ── Frontend Builder quality review + repair trace (Phase 12E, optional) ──────
   *  STATIC model design-quality review, one bounded repair, static post-repair
   *  review and guarded acceptance. These are SEPARATE facts from generation,
   *  validation and consumption — never reuse those flags. `renderedVisualTest`
   *  stays 'pending-manual-test': no screenshot/DOM/runtime was observed. */
  didRunFrontendBuilderInitialReview?: boolean;
  frontendBuilderInitialReviewStatus?: string;
  frontendBuilderInitialReviewPassed?: boolean;
  frontendBuilderInitialReviewScore?: number;
  frontendBuilderInitialBlockerCount?: number;
  frontendBuilderInitialMajorCount?: number;
  frontendBuilderInitialMinorCount?: number;

  didAttemptFrontendBuilderRepair?: boolean;
  didAcceptFrontendBuilderRepair?: boolean;
  frontendBuilderRepairStatus?: string;
  frontendBuilderRepairValidationStatus?: string;

  didRunFrontendBuilderFinalReview?: boolean;
  frontendBuilderFinalReviewStatus?: string;
  frontendBuilderFinalReviewPassed?: boolean;
  frontendBuilderFinalReviewScore?: number;

  frontendBuilderAcceptanceStatus?: string;
  frontendBuilderActiveProject?: string;
  frontendBuilderRenderedVisualTestStatus?: 'pending-manual-test';
  /* ── Frontend Builder STRUCTURAL contract-repair trace (Phase 12F, optional) ────
   *  SEPARATE from the Phase 12E design-quality repair flags — a structural repair
   *  fixes machine-contract errors so a valid model-native project can exist. */
  didAttemptFrontendBuilderContractRepair?: boolean;
  didAcceptFrontendBuilderContractRepair?: boolean;
  frontendBuilderContractRepairStatus?: string;
  frontendBuilderContractRepairInitialErrorCount?: number;
  frontendBuilderContractRepairInitialErrorCodes?: string[];
  frontendBuilderContractRepairFinalValidationStatus?: string;
  frontendBuilderContractRepairFinalErrorCount?: number;
}

/* ── Frontend Build Specification (Phase 12A) ─────────────────────────────────
 * The single, typed, implementation-ready CONTRACT that consolidates every planning
 * artifact into one authoritative input for a FUTURE dedicated Frontend Builder
 * model (Phase 12B). Additive + backward compatible + JSON-serializable (no
 * functions/Maps/Sets); all arrays are bounded + deduped. Phase 12A only DERIVES
 * this contract — it never calls a model/backend/network, never generates code, and
 * never alters files/Preview/synthesis. `generation.status` is always 'not-run'. */
export type FrontendBuildSpecStatus = 'ready' | 'partial' | 'failed-open';
export type FrontendGenerationStatus = 'not-run' | 'generated' | 'failed';

export interface FrontendSpecIdentity {
  siteType: string;
  primaryConcept?: string;
  sector?: VerticalSector;
  subsector?: string;
  audienceSector?: VerticalSector;
  classificationBasis?: VerticalClassificationBasis;
  businessModel?: VerticalBusinessModel;
  websiteExperienceModel?: string;
  pageScreenModel?: string;
  primaryWebsiteExperience?: string;
  primaryConversionIntent?: string;
}

export interface FrontendSpecDesignSystem {
  designThesis?: string;
  selectedVisualDirection?: string;
  rejectedDirections: string[];
  firstImpression?: string;

  paletteFamily?: string;
  paletteDecision?: string;
  colorTokens: Record<string, string>;

  typographyDecision?: string;
  typographyDirection?: string;

  heroComposition?: string;
  sectionRhythm?: string;
  visualSignature?: string;
  visualMetaphor?: string;

  compositionRules: string[];
  surfaceRules: string[];
  componentStyleRules: string[];
  proofRules: string[];
  responsiveRules: string[];
  accessibilityRules: string[];

  templateTrapsToAvoid: string[];
  mustAvoid: string[];
  differentiationMoves: string[];
}

export interface FrontendSpecSection {
  id: string;
  name: string;
  order: number;
  purpose?: string;

  headline?: string;
  subheadline?: string;
  primaryCTA?: string;
  bullets: string[];

  componentHint?: string;
  layoutVariant?: string;
  visualModule?: string;
  density?: string;
  interactionHints: string[];
  assetSlotIds: string[];
  motionLayerIds: string[];
}

export interface FrontendSpecArchitecture {
  architecture?: string;
  navigationModel?: string;
  navigationBehavior?: string;
  entryFlowModel?: string;
  entryScreen?: string;
  postEntryScreen?: string;

  conversionJourneyModel?: string;
  primaryCTA?: string;
  secondaryCTA?: string;

  demoSurfaces: string[];
  statefulDemoComponents: string[];

  sectionOrder: string[];
  sections: FrontendSpecSection[];
}

export interface FrontendSpecImageSlot {
  id: string;
  target: string;
  kind: string;
  source: string;
  purpose: string;
  prompt?: string;
  placeholderLabel?: string;
  manualUploadRecommended: boolean;
  providerReady: boolean;
}

export interface FrontendSpecMotionLayer {
  id: string;
  target: string;
  pattern: string;
  intensity: string;
  purpose: string;
  reducedMotionFallback: string;
}

export interface FrontendSpecAssetPlan {
  strategy?: string;
  visualLanguage?: string;

  cssSvgSlots: string[];
  imageSlots: FrontendSpecImageSlot[];
  motionLayers: FrontendSpecMotionLayer[];

  realSourceRequired: string[];
  aiIllustrativeAllowed: string[];
  forbiddenGenerated: string[];
  honestyConstraints: string[];
}

export interface FrontendSpecResearchEvidence {
  status: WebBuildResearchStatus | 'not-run';
  didUseRealSources: boolean;
  provider?: string;
  sources: WebBuildSource[];
  sourceBackedInsights: string[];
  audienceExpectations: string[];
  conversionPatterns: string[];
  trustSignals: string[];
  visualPatterns: string[];
  risksToAvoid: string[];
  differentiationOpportunities: string[];
}

export interface FrontendSpecOutputContract {
  format: 'frontend-files-v1';
  framework: 'react';
  language: 'typescript';
  styling: 'tailwind-css';

  requiredFiles: string[];
  recommendedFiles: string[];
  requiredSectionComponentFiles: string[];

  allowedExtensions: Array<'tsx' | 'ts' | 'css'>;

  requirements: string[];
  forbiddenPatterns: string[];
  successCriteria: string[];
}

export interface FrontendBuildSpecification {
  version: 'frontend-spec-v1';
  status: FrontendBuildSpecStatus;
  language: string;
  prompt: string;

  identity: FrontendSpecIdentity;
  designSystem: FrontendSpecDesignSystem;
  architecture: FrontendSpecArchitecture;
  assets: FrontendSpecAssetPlan;
  researchEvidence: FrontendSpecResearchEvidence;
  outputContract: FrontendSpecOutputContract;

  honestyRules: string[];
  sourceTrace: string[];
  missingInputs: string[];
  warnings: string[];

  generation: {
    status: FrontendGenerationStatus;
    provider?: string;
    model?: string;
    reason: string;
  };

  summary: string;
}

/* ── Dedicated Frontend Builder raw response (Phase 12B) ───────────────────────
 * The RAW result of the dedicated `frontend_builder` model call that consumes the
 * Phase 12A FrontendBuildSpecification. Phase 12B persists the raw response ONLY —
 * it does NOT parse the file envelope, validate imports/code, or feed the current
 * Preview / All Files (those are Phase 12C+). The honest distinction is kept:
 * a raw response received ≠ a validated frontend project ≠ Preview consuming
 * model-native code. Additive + optional + backward compatible. */
export type FrontendBuilderRawStatus = 'completed' | 'failed' | 'skipped';
export type FrontendBuilderValidationStatus = 'not-run' | 'valid' | 'invalid';

export interface FrontendBuilderRawArtifact {
  version: 'frontend-builder-raw-v1';
  status: FrontendBuilderRawStatus;
  requestedFormat: 'frontend-files-v1';
  mode: 'frontend_builder';

  provider?: string;
  model?: string;
  requestId?: string;

  /** The raw (possibly bounded) builder response. Absent for skipped calls. */
  rawResponse?: string;
  responseCharCount: number;
  truncatedForStorage: boolean;

  /** The raw generation's validation status. 'not-run' until Phase 12C runs the
   *  parser + static validator; then 'valid' or 'invalid'. It stays 'not-run' when
   *  validation is skipped (no completed/usable raw response to validate). */
  validationStatus: FrontendBuilderValidationStatus;
  reason: string;
  warnings: string[];
}

/* ── Frontend Builder validation (Phase 12C) ──────────────────────────────────
 * The result of statically PARSING the raw frontend-files-v1 envelope and
 * VALIDATING the parsed project against the Phase 12A output contract. STATIC only:
 * no compilation, execution, dynamic import, DOM/iframe, network or model call — a
 * structurally-valid result is NOT proven to compile or render. Parsed files live
 * ONLY inside this artifact (never `payload.files`) until Phase 12D. Additive +
 * optional + backward compatible; all arrays bounded + deduped; JSON-serializable. */
export type FrontendBuilderValidationArtifactStatus = 'valid' | 'invalid' | 'skipped';
export type FrontendGeneratedFileLanguage = 'tsx' | 'ts' | 'css';
export type FrontendBuilderIssueSeverity = 'error' | 'warning';

export interface FrontendGeneratedFile {
  path: string;
  language: FrontendGeneratedFileLanguage;
  content: string;
  charCount: number;
  lineCount: number;
}

export interface FrontendBuilderValidationIssue {
  severity: FrontendBuilderIssueSeverity;
  code: string;
  message: string;
  path?: string;
  specifier?: string;
}

export interface FrontendBuilderValidationArtifact {
  version: 'frontend-builder-validation-v1';
  status: FrontendBuilderValidationArtifactStatus;
  format: 'frontend-files-v1';

  sourceRawStatus: FrontendBuilderRawStatus;
  didParse: boolean;
  readyForConsumption: boolean;

  files: FrontendGeneratedFile[];
  fileCount: number;
  totalCharCount: number;

  requiredFileCount: number;
  requiredSectionFileCount: number;
  presentRequiredFileCount: number;
  presentRequiredSectionFileCount: number;

  missingRequiredFiles: string[];
  missingRequiredSectionFiles: string[];
  duplicatePaths: string[];
  unresolvedRelativeImports: string[];
  unsupportedPackageImports: string[];
  unreachableRequiredSectionFiles: string[];
  missingCriticalCopy: string[];
  missingSupportingCopy: string[];
  forbiddenPatternMatches: string[];

  errors: FrontendBuilderValidationIssue[];
  warnings: FrontendBuilderValidationIssue[];

  reason: string;
}

/* ── Frontend Builder consumption (Phase 12D) ─────────────────────────────────
 * Records whether the Phase 12C validated model-native files became the ACTIVE
 * frontend project — replacing the temporary internal synthesis in `payload.files`
 * / All Files and driving the isolated Sandpack runtime Preview. Consumption is a
 * DISTINCT fact from generation (did the model reply), validation (did the static
 * contract pass), runtime preview (did the sandbox compile), and visual review
 * (Phase 12E). A fallback never claims consumption. Additive + optional + backward
 * compatible; JSON-serializable. */
export type FrontendBuilderConsumptionStatus = 'model-native' | 'fallback';
export type FrontendBuilderFileSource = 'model-native' | 'internal-synthesis';
export type FrontendBuilderPreviewSource = 'model-native-sandbox' | 'legacy-section-renderer';

export interface FrontendBuilderConsumptionArtifact {
  version: 'frontend-builder-consumption-v1';
  status: FrontendBuilderConsumptionStatus;

  fileSource: FrontendBuilderFileSource;
  allFilesSource: FrontendBuilderFileSource;
  previewSource: FrontendBuilderPreviewSource;

  consumedFileCount: number;
  consumedCharCount: number;

  validationStatus: FrontendBuilderValidationArtifactStatus;
  readyForConsumption: boolean;

  reason: string;
  fallbackReason?: string;
}

/* ── Frontend Builder quality review + repair (Phase 12E) ──────────────────────
 * A bounded STATIC model design-quality review of the Phase 12D active model-native
 * project (specification + generated SOURCE files only), an optional single bounded
 * repair, an unchanged Phase 12C re-validation of that repair, a static post-repair
 * review, and a guarded repaired-file acceptance record.
 *
 * This is NOT screenshot analysis, browser observation, runtime compilation, DOM
 * inspection, Sandpack error detection, automated visual regression or human visual
 * approval. Every artifact honestly records `renderedScreenshotReviewed: false`,
 * `runtimeCompilationReviewed: false` and `renderedVisualTestStatus:
 * 'pending-manual-test'`. A real rendered visual test is performed MANUALLY after
 * Phase 12E merges.
 *
 * Generation, validation, consumption, static design review, repair, final acceptance,
 * runtime rendering and manual visual testing remain SEPARATE facts — none is ever
 * collapsed into another. All fields additive + optional + backward compatible;
 * JSON-serializable; every string/array is bounded. Old saved builds still load. */
export type FrontendBuilderReviewStage = 'initial' | 'post-repair';
export type FrontendBuilderReviewVerdict = 'pass' | 'repair';
export type FrontendBuilderReviewSeverity = 'blocker' | 'major' | 'minor';
export type FrontendBuilderReviewCategory =
  | 'concept-fidelity'
  | 'concept-drift'
  | 'generic-template'
  | 'visual-hierarchy'
  | 'layout-rhythm'
  | 'typography'
  | 'palette-and-surfaces'
  | 'component-composition'
  | 'motion-and-interaction'
  | 'responsive-intent'
  | 'accessibility-intent'
  | 'copy-fidelity'
  | 'contract-fidelity'
  | 'honesty'
  | 'maintainability';

export interface FrontendBuilderReviewIssue {
  id: string;
  severity: FrontendBuilderReviewSeverity;
  category: FrontendBuilderReviewCategory;
  files: string[];
  evidence: string;
  repairInstruction: string;
}

export interface FrontendBuilderReviewDimensions {
  conceptSpecificity: number;
  visualHierarchy: number;
  layoutRhythm: number;
  typography: number;
  paletteAndSurfaces: number;
  componentComposition: number;
  motionAndInteraction: number;
  responsiveIntent: number;
  accessibilityIntent: number;
  copyAndContractFidelity: number;
  honesty: number;
  maintainability: number;
}

/** The persisted, parsed review artifact (initial or post-repair). `passed` is
 *  computed INDEPENDENTLY of the model's own `verdict` (verdict==='pass' AND
 *  score>=82 AND blockerCount===0 AND majorCount===0). A 'failed'/'skipped' status
 *  means the reviewer call/parse did not yield a trustworthy review. */
export interface FrontendBuilderReviewArtifact {
  version: 'frontend-review-v1';
  stage: FrontendBuilderReviewStage;

  status: 'completed' | 'failed' | 'skipped';

  reviewKind: 'model-static-design-review';
  renderedScreenshotReviewed: false;
  runtimeCompilationReviewed: false;

  verdict?: FrontendBuilderReviewVerdict;
  score?: number;
  dimensions?: FrontendBuilderReviewDimensions;

  strengths: string[];
  issues: FrontendBuilderReviewIssue[];
  resolvedIssueIds: string[];

  blockerCount: number;
  majorCount: number;
  minorCount: number;

  passed: boolean;
  summary?: string;
  reason: string;

  mode: 'frontend_builder';
  model?: string;
  provider?: string;
  requestId?: string;
  responseCharCount: number;
}

/** The persisted, bounded record of the single Phase 12E repair attempt. Never
 *  carries the full repair raw response twice — only bounded metadata + the score
 *  deltas needed to prove the repaired project was validated and accepted. */
export interface FrontendBuilderRepairArtifact {
  version: 'frontend-repair-v1';

  status: 'not-run' | 'completed' | 'failed' | 'rejected' | 'accepted';

  attempted: boolean;
  accepted: boolean;

  validationStatus: 'not-run' | 'valid' | 'invalid';

  generatedFileCount: number;
  generatedCharCount: number;

  initialScore?: number;
  finalScore?: number;

  reason: string;

  mode: 'frontend_builder';
  model?: string;
  provider?: string;
  requestId?: string;
}

/** The final Phase 12E acceptance record. `renderedVisualTestStatus` is ALWAYS
 *  'pending-manual-test' — a static design review never certifies a rendered page. */
export interface FrontendBuilderAcceptanceArtifact {
  version: 'frontend-acceptance-v1';

  status: 'approved' | 'repaired-approved' | 'manual-review-required' | 'skipped';

  activeProject: 'initial-model-native' | 'repaired-model-native' | 'internal-fallback'
    // Phase 12F — the active project after an accepted STRUCTURAL contract repair (before
    // any Phase 12E design-quality repair). A structurally repaired project is NEVER
    // described as internal-fallback.
    | 'contract-repaired-model-native';

  initialReviewPassed: boolean;
  repairAttempted: boolean;
  repairAccepted: boolean;
  finalReviewPassed: boolean;

  renderedVisualTestStatus: 'pending-manual-test';
  renderedScreenshotReviewed: false;
  runtimeCompilationReviewed: false;

  reason: string;
}

/* ── Frontend Builder STRUCTURAL contract repair (Phase 12F) ───────────────────
 * The bounded record of the single structural contract-repair attempt that runs when
 * the INITIAL model-native project parsed but FAILED Phase 12C static validation, BEFORE
 * falling back to internal synthesis. This is a SEPARATE fact from the Phase 12E
 * design-quality repair: contract repair fixes machine-contract / structural errors so a
 * valid model-native project can exist; quality repair fixes design-quality issues AFTER a
 * valid project exists. Never collapse them into one artifact or status. Additive +
 * optional + backward compatible; all arrays/strings bounded. */
export interface FrontendBuilderContractRepairArtifact {
  version: 'frontend-contract-repair-v1';

  status: 'not-run' | 'completed' | 'failed' | 'rejected' | 'accepted';

  attempted: boolean;
  accepted: boolean;

  initialValidationStatus: 'invalid' | 'not-run';
  initialErrorCount: number;
  initialWarningCount: number;
  initialErrorCodes: string[];

  finalValidationStatus: 'not-run' | 'valid' | 'invalid';
  finalErrorCount: number;
  finalWarningCount: number;

  generatedFileCount: number;
  generatedCharCount: number;

  reason: string;

  mode: 'frontend_builder';
  model?: string;
  provider?: string;
  requestId?: string;
}

/* ── Transient Phase 12E raw review response (NOT persisted) ───────────────────
 * The raw reviewer `/chat` result, parsed EXACTLY ONCE by
 * parseFrontendBuilderReview into a FrontendBuilderReviewArtifact. It lives only
 * inside the quality pipeline; it is never stored on a step/payload. */
export interface FrontendBuilderReviewRawArtifact {
  version: 'frontend-review-raw-v1';
  stage: FrontendBuilderReviewStage;
  status: 'completed' | 'failed' | 'skipped';
  mode: 'frontend_builder';
  provider?: string;
  model?: string;
  requestId?: string;
  /** The raw reviewer body. Absent for failed/skipped calls. */
  rawResponse?: string;
  responseCharCount: number;
  reason: string;
}

/* ── Intermediate Phase 12E pipeline result (NOT persisted directly) ───────────
 * The value returned by runFrontendBuilderQualityPipeline's internal computation and
 * consumed by attachFrontendBuilderQualityResult. Persisted artifacts are the fields
 * inside it (review/repair/acceptance). When a repaired project is accepted, it also
 * carries the repaired validated files + their re-validation so the payload helper can
 * atomically replace the active file set. */
export interface FrontendBuilderQualityPipelineResult {
  ran: boolean;
  initialReview?: FrontendBuilderReviewArtifact;
  repair?: FrontendBuilderRepairArtifact;
  finalReview?: FrontendBuilderReviewArtifact;
  acceptance: FrontendBuilderAcceptanceArtifact;
  /** Present ONLY when acceptance.status === 'repaired-approved': the repaired,
   *  re-validated project that must replace the active initial model-native files. */
  acceptedRepairedFiles?: FrontendGeneratedFile[];
  acceptedRepairedValidation?: FrontendBuilderValidationArtifact;
}

export interface WebBuildArtifacts {
  research?: ResearchAgentArtifact;
  /** The strategic decision the downstream agents obey (Phase 8A). Optional →
   *  old builds still load; absent = previous behaviour. */
  thinkingLedger?: StrategicThinkingLedger;
  artDirection?: ArtDirectionArtifact;
  strategy?: StrategyAgentArtifact;
  blueprint?: PageBlueprint;
  componentEngineer?: ComponentEngineerArtifact;
  /** Advisory quality-gate review (Phase 5). Optional → old builds still load. */
  reviewer?: ReviewerAgentArtifact;
  /** Premium-quality judge (Phase 7A). Optional → old builds still load. */
  qualityDirector?: QualityDirectorArtifact;
  /** Asset plan (Phase 10A) — decides the visual assets the site needs (CSS/SVG
   *  now, motion-CSS now, image-later slots) + honesty constraints. PLANNING/DATA
   *  ONLY: never generates images or calls a provider. Optional → old builds load. */
  assetDirector?: AssetDirectorArtifact;
  /** Motion plan (Phase 10B) — composes SUBTLE CSS/SVG motion layers from the Asset
   *  Director's motion-css-now slots. Consumed by the Preview only (framer-motion/
   *  CSS). Never video/image/provider/backend. Optional → old builds load. */
  motionComposer?: MotionComposerArtifact;
  /** Image plan (Phase 10C) — turns the Asset Director's image-*-later / manual-
   *  upload-later slots into a provider-READY plan + honest Preview placeholders.
   *  NEVER calls an image API, generates real images, or uploads. Optional → old
   *  builds load. */
  imagePipeline?: ImagePipelineArtifact;
  /** Safe reviewer-driven repairs (Phase 6). Optional → old builds still load. */
  fixer?: FixerAgentArtifact;
  /** Intent-aware page architecture decision (Phase 9D-1). Optional → old builds load. */
  pageArchitecture?: PageArchitectureDecision;
  /** High-level website experience blueprint (Phase 9D-2) — decides the site
   *  experience TYPE + page mode + required/forbidden page groups + CTA strategy
   *  BEFORE section-level decisions. Optional → old builds load. Data/planning only. */
  experienceBlueprint?: ExperienceBlueprint;
  /** Deterministic sector contract (Phase 11A) — refines the Experience Blueprint
   *  into a sector/subsector-specific decision contract (business model, conversion
   *  model, trust model, section policy, visual truth policy, future-research
   *  readiness). PLANNING/DATA ONLY: derived BEFORE the intent-aware Page
   *  Architecture; never runs live research, never alters the renderer/image/motion
   *  behaviour in this phase. Optional → old builds load. Consumed by Phase 11B+. */
  verticalIntelligence?: VerticalIntelligenceArtifact;
  /** Concept-specific visual signature plan (Phase 9E-1) — CSS/SVG-only visual
   *  direction (hero motif, per-section visuals, motion hints). Optional → old
   *  builds load. Never an image/video API; consumed by the preview visual layer. */
  visualSignaturePlan?: VisualSignaturePlan;
  /** Model-native Frontend Build Specification (Phase 12A) — one authoritative,
   *  implementation-ready CONTRACT consolidating identity, design, architecture,
   *  final copy, interactions, assets, motion, research evidence and honesty rules
   *  for a future dedicated Frontend Builder model (Phase 12B). PLANNING/DATA ONLY:
   *  no model/backend/network runs here; generation.status is always 'not-run', and
   *  it never alters files/Preview/synthesis. Optional → old builds load. */
  frontendBuildSpec?: FrontendBuildSpecification;
  /** Raw dedicated Frontend Builder response (Phase 12B) — the raw output of the
   *  `frontend_builder` model call that consumed the spec. PERSISTED ONLY: not
   *  parsed/validated, and never feeds the current Preview / All Files (Phase 12C+).
   *  Optional → old builds load. */
  frontendBuilderRaw?: FrontendBuilderRawArtifact;
  /** Static parse + contract validation of the raw builder response (Phase 12C).
   *  STATIC only (no compile/execute/consume); the parsed files live here, never in
   *  `payload.files`, until Phase 12D. Optional → old builds load. */
  frontendBuilderValidation?: FrontendBuilderValidationArtifact;
  /** Whether the Phase 12C validated model-native files became the active project
   *  (Phase 12D). 'model-native' → payload.files/All Files/Preview use the generated
   *  React project; 'fallback' → the deterministic section renderer + synthesized
   *  files remain active. Optional → old builds load. */
  frontendBuilderConsumption?: FrontendBuilderConsumptionArtifact;
  /** Phase 12F — the single STRUCTURAL contract-repair record. Present only when the
   *  initial model-native project parsed but failed Phase 12C validation and a bounded
   *  contract repair was attempted before fallback. SEPARATE from the Phase 12E design-
   *  quality repair. Optional → old builds load. */
  frontendBuilderContractRepair?: FrontendBuilderContractRepairArtifact;
  /** Phase 12E — the STATIC model design-quality review of the active model-native
   *  project (initial stage). STATIC only: no screenshot/DOM/runtime/Sandpack. Present
   *  only when Phase 12E ran (consumption was model-native). Optional → old builds load. */
  frontendBuilderInitialReview?: FrontendBuilderReviewArtifact;
  /** Phase 12E — the single bounded repair record (at most one repair per turn).
   *  Optional → old builds load. */
  frontendBuilderRepair?: FrontendBuilderRepairArtifact;
  /** Phase 12E — the STATIC post-repair review of the repaired project. Present only
   *  when a repair was attempted and re-validated. Optional → old builds load. */
  frontendBuilderFinalReview?: FrontendBuilderReviewArtifact;
  /** Phase 12E — the final acceptance record (approved / repaired-approved /
   *  manual-review-required / skipped). `renderedVisualTestStatus` is always
   *  'pending-manual-test'. Optional → old builds load. */
  frontendBuilderAcceptance?: FrontendBuilderAcceptanceArtifact;
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
  /** The strategic decision the downstream agents obeyed (Phase 8A). Optional. */
  thinkingLedger?: StrategicThinkingLedger | null;
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

/** The precise concept category the site belongs to. Detected deterministically
 *  by weighted keyword scoring over the prompt + brief + inferred text, so two
 *  different ideas resolve to different categories — the anchor for concept-
 *  specific pages, components, trust proof and the anti-generic guard. */
export type ConceptCategory =
  | 'archive' | 'hospitality' | 'landscaping' | 'local_service' | 'legal'
  | 'medical' | 'ai' | 'saas' | 'marketplace' | 'education' | 'nonprofit'
  | 'portfolio' | 'industrial' | 'event' | 'real_estate' | 'finance' | 'general';

/** Weighted keyword table (EN + TR). Ordered so the most specific categories are
 *  scanned first; ties break toward the earlier (more specific) entry. Reusable
 *  and deterministic — never a per-prompt hack. */
const CONCEPT_KEYWORDS: Array<{ cat: ConceptCategory; weight: number; words: string[] }> = [
  { cat: 'archive', weight: 3, words: ['archive', 'museum', 'catalogue', 'catalog', 'collection', 'library', 'exhibit', 'manuscript', 'heritage', 'provenance', 'artifact', 'ottoman', 'historical', 'digital archive', 'arşiv', 'müze', 'koleksiyon', 'kütüphane', 'elyazma', 'osmanlı', 'tarihî', 'tarihi eser'] },
  { cat: 'hospitality', weight: 3, words: ['restaurant', 'restoran', 'cafe', 'kafe', 'menu', 'menü', 'reservation', 'rezervasyon', 'dining', 'bistro', 'brasserie', 'bakery', 'fırın', 'catering', 'hotel', 'otel', 'coffee shop', 'lokanta', 'brunch', 'patisserie'] },
  { cat: 'landscaping', weight: 3, words: ['landscap', 'peyzaj', 'garden', 'bahçe', 'lawn', 'nursery', 'horticultur', 'terrace', 'teras', 'hardscape', 'çevre düzenleme', 'yeşil alan'] },
  { cat: 'legal', weight: 3, words: ['law firm', 'lawyer', 'attorney', 'legal', 'solicitor', 'notary', 'litigation', 'avukat', 'hukuk', 'noter', 'dava', 'hukuki'] },
  { cat: 'medical', weight: 3, words: ['medical', 'clinic', 'doctor', 'dental', 'dentist', 'health', 'therapy', 'patient', 'klinik', 'doktor', 'diş', 'sağlık', 'hasta', 'terapi', 'psikolog', 'fizyoterapi', 'poliklinik'] },
  { cat: 'ai', weight: 3, words: ['artificial intelligence', 'machine learning', 'llm', 'copilot', 'neural', 'chatbot', 'agentic', 'yapay zeka', 'makine öğren', 'yapay zekâ'] },
  { cat: 'saas', weight: 2, words: ['saas', 'dashboard', 'platform', 'software', 'api', 'analytics', 'automation', 'workflow', 'crm', 'yazılım', 'panel', 'otomasyon', 'analitik'] },
  { cat: 'marketplace', weight: 3, words: ['ecommerce', 'e-commerce', 'e-ticaret', 'marketplace', 'online store', 'storefront', 'checkout', 'add to cart', 'mağaza', 'online satış', 'ürün kataloğu'] },
  { cat: 'education', weight: 3, words: ['course', 'education', 'academy', 'curriculum', 'bootcamp', 'lms', 'e-learning', 'eğitim', 'kurs', 'okul', 'akademi', 'müfredat', 'online ders'] },
  { cat: 'nonprofit', weight: 3, words: ['nonprofit', 'non-profit', 'charity', 'donate', 'donation', 'foundation', 'volunteer', 'fundrais', 'bağış', 'vakıf', 'dernek', 'gönüllü', 'kampanya', 'yardım kuruluşu'] },
  { cat: 'portfolio', weight: 2, words: ['portfolio', 'portfolyo', 'showcase', 'photographer', 'fotoğraf', 'designer', 'tasarımcı', 'creative studio', 'stüdyo', 'freelance', 'case study', 'vaka çalışması'] },
  { cat: 'industrial', weight: 3, words: ['industrial', 'manufactur', 'logistics', 'machinery', 'factory', 'engineering firm', 'construction', 'supply chain', 'fabrika', 'üretim', 'lojistik', 'makine', 'inşaat', 'sanayi', 'endüstri'] },
  { cat: 'event', weight: 3, words: ['conference', 'summit', 'festival', 'expo', 'webinar', 'meetup', 'hackathon', 'symposium', 'etkinlik', 'konferans', 'zirve', 'fuar', 'lansman'] },
  { cat: 'real_estate', weight: 3, words: ['real estate', 'property', 'realtor', 'listing', 'apartment', 'emlak', 'gayrimenkul', 'konut', 'daire', 'satılık', 'kiralık'] },
  { cat: 'finance', weight: 3, words: ['fintech', 'bank', 'invest', 'trading', 'insurance', 'accounting', 'finans', 'banka', 'yatırım', 'sigorta', 'muhasebe'] },
];

/** Score every category over the text and return the strongest match (or
 *  'general' when nothing clears the bar). Pure and deterministic. */
export function detectConceptCategory(text: string): ConceptCategory {
  const low = ` ${(text || '').toLowerCase()} `;
  let best: ConceptCategory = 'general';
  let bestScore = 0;
  for (const { cat, weight, words } of CONCEPT_KEYWORDS) {
    let score = 0;
    for (const w of words) if (low.includes(w)) score += weight;
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  return best;
}

/* ── Concept Authority resolution (Phase 5) ───────────────────────────────
 * The single most important fix for concept drift: derive the PRIMARY concept
 * from the product noun in the prompt — NOT from the blended full text, which is
 * often saturated with target-vertical / content-domain language (an "AI chatbot
 * FOR ecommerce stores" prompt mentions store/cart/checkout many times, which
 * used to over-weight the marketplace category and flip the visual identity). */

/** Product/concept nouns that, when present in the PRODUCT part of a
 *  "<product> for <vertical>" prompt, keep the primary concept as commerce
 *  (the product itself IS a store/marketplace). */
const COMMERCE_PRODUCT_RE = /\b(marketplace|market\s?place|storefront|store|shop|e-?commerce|e-?ticaret|online\s?store|catalog\s?store|mağaza)\b/;

interface ConceptAuthoritySplit {
  primary: ConceptCategory;
  vertical: ConceptCategory | 'general';
  verticalPhrase: string;
  hadForSplit: boolean;
  productIsCommerce: boolean;
}

/** Split a prompt into its product/concept part and its target-vertical part on a
 *  "<product> for <vertical>" (EN) / "<vertical> için <product>" (TR) grammar,
 *  and resolve which concept has authority. Pure and deterministic. */
function splitConceptAuthority(prompt: string, fullText: string): ConceptAuthoritySplit {
  const p = ` ${(prompt || '').toLowerCase().replace(/\s+/g, ' ').trim()} `;
  const fullCat = detectConceptCategory(fullText || prompt || '');
  if (!p.trim()) {
    return { primary: fullCat, vertical: 'general', verticalPhrase: '', hadForSplit: false, productIsCommerce: false };
  }

  // Identify a product-vs-vertical split. English: "<product> for <vertical>".
  // Turkish: "<vertical> için <product>" (the vertical comes first).
  let productPart = '';
  let verticalPart = '';
  const trIdx = p.indexOf(' için ');
  if (trIdx >= 0) {
    verticalPart = p.slice(0, trIdx);
    productPart = p.slice(trIdx + 6);
  } else {
    const m = p.match(/^(.*?)\bfor\b(.*)$/);
    if (m && m[2].trim().length > 1) { productPart = m[1]; verticalPart = m[2]; }
  }
  const hadForSplit = !!(productPart.trim() && verticalPart.trim());

  if (hadForSplit) {
    const productCat = detectConceptCategory(productPart);
    const productIsCommerce = COMMERCE_PRODUCT_RE.test(` ${productPart} `) || productCat === 'marketplace';
    if (!productIsCommerce && productCat !== 'general') {
      // "<product/concept> for <industry/customer>" → the product has authority.
      const verticalCat = detectConceptCategory(verticalPart);
      return { primary: productCat, vertical: verticalCat, verticalPhrase: verticalPart.trim(), hadForSplit, productIsCommerce };
    }
    // Product part is itself a store/marketplace, or too generic ("a website
    // for restaurants") → fall through to the whole-prompt read below.
  }

  // No decisive split → prefer the PROMPT-only category (the product noun) over
  // the blended full text, which can over-weight the vertical/content domain.
  const promptCat = detectConceptCategory(p);
  const primary = promptCat !== 'general' ? promptCat : fullCat;
  return { primary, vertical: 'general', verticalPhrase: '', hadForSplit, productIsCommerce: primary === 'marketplace' };
}

/** Human-readable label for a target vertical category (owner/dev diagnostic). */
const VERTICAL_LABEL: Record<string, [string, string]> = {
  marketplace: ['ecommerce/marketplace', 'e-ticaret/pazaryeri'],
  hospitality: ['restaurants/hospitality', 'restoran/konaklama'],
  medical: ['healthcare', 'sağlık'],
  legal: ['legal', 'hukuk'],
  finance: ['finance', 'finans'],
  real_estate: ['real estate', 'gayrimenkul'],
  education: ['education', 'eğitim'],
  industrial: ['industrial/B2B', 'sanayi/B2B'],
  event: ['events', 'etkinlik'],
  nonprofit: ['nonprofit', 'sivil toplum'],
  landscaping: ['landscaping', 'peyzaj'],
  archive: ['archive/heritage', 'arşiv/miras'],
};

/** The product/business model per primary concept (Concept Authority hand-off). */
const PRODUCT_MODEL_BY_CONCEPT: Record<string, [string, string]> = {
  ai: ['SaaS/product demo', 'SaaS/ürün demosu'],
  saas: ['SaaS/product demo', 'SaaS/ürün demosu'],
  marketplace: ['catalog/listing site', 'katalog/liste sitesi'],
  archive: ['editorial archive / collection', 'editoryal arşiv / koleksiyon'],
  portfolio: ['portfolio / case-study site', 'portfolyo / vaka sitesi'],
  landscaping: ['portfolio / service lead-gen', 'portfolyo / hizmet talep'],
  local_service: ['service lead-gen site', 'hizmet talep sitesi'],
  legal: ['credibility lead-gen site', 'itibar/talep sitesi'],
  medical: ['credibility lead-gen site', 'itibar/talep sitesi'],
  hospitality: ['atmosphere + reservation site', 'atmosfer + rezervasyon sitesi'],
  education: ['course / enrollment site', 'kurs / kayıt sitesi'],
  real_estate: ['listing / detail site', 'ilan / detay sitesi'],
  event: ['event / registration site', 'etkinlik / kayıt sitesi'],
  finance: ['product / trust site', 'ürün / güven sitesi'],
  industrial: ['capability / quote site', 'yetkinlik / teklif sitesi'],
  nonprofit: ['cause / donation site', 'amaç / bağış sitesi'],
};

/** The dominant content model per primary concept. */
const CONTENT_MODEL_BY_CONCEPT: Record<string, [string, string]> = {
  ai: ['product marketing + front-end demo', 'ürün pazarlama + ön-yüz demo'],
  saas: ['product marketing + front-end demo', 'ürün pazarlama + ön-yüz demo'],
  marketplace: ['inventory/listing/detail preview', 'envanter/liste/detay önizleme'],
  archive: ['editorial archive / collection browsing', 'editoryal arşiv / koleksiyon gezinme'],
  landscaping: ['portfolio / before-after / service', 'portfolyo / önce-sonra / hizmet'],
  portfolio: ['selected work / case detail', 'seçili işler / vaka detayı'],
};

/** Archetype keys an AI/SaaS product must NEVER drift toward (target-vertical
 *  commerce language must not flip the visual identity). */
const AI_SAAS_DRIFT_GUARD = ['marketplace-catalog', 'storefront', 'catalog commerce'];

/**
 * Derive the Concept Authority for a build. Separates the primary concept (owns
 * the visual archetype) from the target vertical (informs copy/proof only). Pure
 * and deterministic; returns undefined only when there is genuinely no signal.
 */
export function deriveConceptAuthority(
  prompt: string, brief: WebBuildBrief, inferred: InferredBrief, lang: Lang = 'en',
): ConceptAuthority | undefined {
  const promptText = (prompt || brief.coreIdea || brief.type || inferred.businessType || '').trim();
  if (!promptText) return undefined;
  const fullText = [prompt, brief.coreIdea, brief.type, brief.audience, inferred.businessType, inferred.targetAudience]
    .filter(Boolean).join(' ');
  const split = splitConceptAuthority(promptText, fullText);

  const primaryConcept = split.primary;
  const hasVertical = split.hadForSplit && split.vertical !== 'general' && !split.productIsCommerce && split.vertical !== primaryConcept;
  const targetVertical = hasVertical ? split.vertical : undefined;
  const audienceVertical = split.verticalPhrase && !split.productIsCommerce ? split.verticalPhrase.slice(0, 60) : undefined;

  const productModel = PRODUCT_MODEL_BY_CONCEPT[primaryConcept]
    ? L(lang, PRODUCT_MODEL_BY_CONCEPT[primaryConcept][0], PRODUCT_MODEL_BY_CONCEPT[primaryConcept][1]) : undefined;
  const contentModel = CONTENT_MODEL_BY_CONCEPT[primaryConcept]
    ? L(lang, CONTENT_MODEL_BY_CONCEPT[primaryConcept][0], CONTENT_MODEL_BY_CONCEPT[primaryConcept][1]) : undefined;

  const mustNotDriftTo = (primaryConcept === 'ai' || primaryConcept === 'saas')
    ? AI_SAAS_DRIFT_GUARD : undefined;

  // Confidence: a clean "<product> for <vertical>" split with a concrete product
  // concept is HIGH; a decisive whole-prompt concept is MEDIUM; a general read LOW.
  const confidence: ConceptAuthority['confidence'] = (split.hadForSplit && !!targetVertical)
    ? 'high'
    : (primaryConcept !== 'general' ? 'medium' : 'low');

  const vLabel = targetVertical && VERTICAL_LABEL[targetVertical]
    ? L(lang, VERTICAL_LABEL[targetVertical][0], VERTICAL_LABEL[targetVertical][1])
    : audienceVertical;
  const reason = targetVertical
    ? L(lang,
        `Reads as a "${primaryConcept}" product for the ${vLabel} vertical; the primary concept controls the visual archetype/layout, the vertical only informs copy/proof/examples.`,
        `"${primaryConcept}" ürünü, ${vLabel} dikeyi için okunuyor; görsel arketip/düzeni birincil konsept belirler, dikey yalnızca metin/kanıt/örnekleri etkiler.`)
    : split.productIsCommerce
      ? L(lang, `Reads as a "${primaryConcept}" concept (a store/marketplace itself) — commerce IS the primary concept.`,
          `"${primaryConcept}" konsepti (mağaza/pazaryerinin kendisi) — ticaret birincil konsept.`)
      : L(lang, `Reads as a "${primaryConcept}" concept; no separate target vertical detected.`,
          `"${primaryConcept}" konsepti; ayrı bir hedef dikey tespit edilmedi.`);

  return {
    primaryConcept,
    targetVertical,
    audienceVertical,
    productModel,
    contentModel,
    confidence,
    reason,
    mustNotDriftTo,
  };
}

/* ── Strategic Thinking Ledger derivation (Phase 8A) ──────────────────────── */

/** Generic service-agency / filler section labels that read as template
 *  scaffolding on an AI/product site (EN + TR, lowercased). Detected by the
 *  Quality Director and repaired by the Fixer to concept-specific labels. */
const GENERIC_FILLER_LABELS = [
  'discovery', 'plan', 'delivery', 'support', 'quality service', 'detailed information',
  'saas landing page', 'our process', 'what we do',
  'keşif', 'teslim', 'destek', 'kaliteli hizmet', 'detaylı bilgi', 'süreçlerimiz', 'ne yapıyoruz',
];

/* ── Model-native Design Plan normalization (Phase 9A) ────────────────────── */

/** Split a comma/semicolon/• list line into trimmed, non-empty items. */
function splitPlanList(s?: string): string[] {
  return (s || '').split(/[;,•·]|\s\/\s|\s—\s|\s-\s(?=[A-ZÇĞİÖŞÜ])/).map((x) => x.trim()).filter((x) => x.length > 2);
}

/** Map the model's hero-composition sentence to the layout plan's hero vocabulary. */
function heroFromDecision(text?: string): string | undefined {
  const t = (text || '').toLowerCase();
  if (!t) return undefined;
  if (/asymmetr/.test(t)) return 'asymmetric-visual';
  if (/split|editorial\s*split|two[-\s]?column|side[-\s]?by[-\s]?side|left\s*copy/.test(t)) return 'split-editorial';
  if (/story|narrative|editorial/.test(t)) return 'story-editorial';
  if (/immersive|full[-\s]?bleed|cinematic/.test(t)) return 'immersive-full-bleed';
  if (/catalog|collection|gallery\s*grid/.test(t)) return 'catalog-collection';
  if (/dashboard|product\s*panel|control\s*panel/.test(t)) return 'dashboard-product';
  if (/centered|center/.test(t)) return 'centered';
  return undefined;
}

/** Map the model's demo-surface sentence to a visual-module key. */
function demoModuleFromDecision(text?: string): string | undefined {
  const t = (text || '').toLowerCase();
  if (!t) return undefined;
  if (/chat|conversation|product[-\s]?flow|assistant|sohbet/.test(t)) return 'product-showcase';
  if (/dashboard|analytics|metrics/.test(t)) return 'data-dashboard';
  if (/catalog|listing|storefront|collection/.test(t)) return 'catalog-archive';
  if (/timeline|process|steps?/.test(t)) return 'timeline-process';
  if (/product/.test(t)) return 'product-showcase';
  return undefined;
}

/** Map the model's palette decision to a PaletteFamily + an explicit avoid-gold flag. */
function paletteFromDecision(text?: string, rejected?: string, traps?: string): { family?: string; avoidGold: boolean } {
  const t = `${text || ''} ${rejected || ''} ${traps || ''}`.toLowerCase();
  const avoidGold = /no\s*gold|not\s*gold|avoid\s*gold|without\s*gold|no\s*amber|anti[-\s]?gold|monochrome|graphite|cyan|slate|porcelain|no\s*warm|drop\s*the\s*gold|dark\s*grid\s*\+\s*gold|gold\s*accent/.test(t);
  const named = (text || '').toLowerCase();
  let family: string | undefined;
  if (/graphite|cyan/.test(named)) family = 'graphite-cyan';
  else if (/porcelain/.test(named)) family = 'porcelain-blue';
  else if (/slate|violet|purple/.test(named)) family = 'slate-violet';
  else if (/midnight|deep\s*blue|navy/.test(named)) family = 'midnight-blue';
  else if (/black.*white.*red|monochrome.*red|red\s*accent/.test(named)) family = 'black-white-red';
  else if (/ink|lime/.test(named)) family = 'ink-lime';
  else if (/sage|botanical/.test(named)) family = 'botanical-sage';
  else if (/warm.*green|neutral.*green/.test(named)) family = 'warm-neutral-green';
  else if (/cream|editorial\s*ink/.test(named)) family = 'editorial-cream';
  else if (/sepia|archive/.test(named)) family = 'archive-sepia';
  else if (/silver|automotive/.test(named)) family = 'automotive-silver';
  else if (/amber|gold|warm\s*hospitality/.test(named) && !avoidGold) family = 'hospitality-amber';
  // Named a cool/blue palette without a specific family → a restrained cool default.
  if (!family && avoidGold) family = 'graphite-cyan';
  return { family, avoidGold };
}

/** Score the model's Design Thinking Plan for concreteness (anti-generic gate). */
function scoreDesignPlan(b: WebBuildBrief): { score: number; warnings: string[]; rejectedLooks: string[]; meaningfulRejected: boolean } {
  const warnings: string[] = [];
  const vague = /^(modern|premium|clean|sleek|minimal|elegant|nice|beautiful|professional|user[-\s]?friendly|modern\s*premium|clean\s*layout|premium\s*modern)\.?$/i;
  const concrete = (s?: string): boolean => !!s && s.trim().length > 8 && !vague.test(s.trim());
  const rejectedLooks = splitPlanList(b.rejectedDirections);
  const meaningfulRejected = rejectedLooks.length >= 2;
  let score = 0;
  if (concrete(b.designThesis)) score += 12; else warnings.push('vague/absent design thesis');
  if (concrete(b.selectedVisualDirection)) score += 14; else warnings.push('vague/absent visual direction ("modern premium" is not a direction)');
  if (meaningfulRejected) score += 18; else warnings.push('fewer than 2 meaningful rejected directions');
  if (concrete(b.heroCompositionDecision)) score += 14; else warnings.push('no concrete hero composition decision');
  if (concrete(b.paletteDecision)) score += 12; else warnings.push('no concrete palette decision');
  if (concrete(b.typographyDecision)) score += 8; else warnings.push('no concrete typography decision');
  if ((b.templateTrapsToAvoid || '').trim().length > 6) score += 12; else warnings.push('no template traps named');
  if (concrete(b.differentiationMove)) score += 10; else warnings.push('no differentiation move');
  return { score: Math.min(100, score), warnings, rejectedLooks, meaningfulRejected };
}

/** Build the normalized Model Design Plan from the parsed brief fields. Returns
 *  undefined when the model produced no Design Thinking Plan at all (old builds). */
function deriveModelDesignPlan(b: WebBuildBrief): ModelDesignPlan | undefined {
  const has = b.designThesis || b.selectedVisualDirection || b.heroCompositionDecision
    || b.paletteDecision || b.rejectedDirections || b.templateTrapsToAvoid
    || b.differentiationMove || b.firstImpression || b.primaryDemoSurface || b.typographyDecision;
  if (!has) return undefined;
  const { family, avoidGold } = paletteFromDecision(b.paletteDecision, b.rejectedDirections, b.templateTrapsToAvoid);
  const { score, warnings, rejectedLooks, meaningfulRejected } = scoreDesignPlan(b);
  return {
    designThesis: b.designThesis,
    firstImpression: b.firstImpression,
    selectedVisualDirection: b.selectedVisualDirection,
    rejectedDirections: b.rejectedDirections,
    rejectedLooks,
    heroCompositionDecision: b.heroCompositionDecision,
    sectionRhythmDecision: b.sectionRhythmDecision,
    paletteDecision: b.paletteDecision,
    typographyDecision: b.typographyDecision,
    templateTrapsToAvoid: b.templateTrapsToAvoid,
    templateTraps: splitPlanList(b.templateTrapsToAvoid),
    differentiationMove: b.differentiationMove,
    qualityBar: b.designQualityBar,
    heroComposition: heroFromDecision(b.heroCompositionDecision),
    demoModule: demoModuleFromDecision(b.primaryDemoSurface || b.heroCompositionDecision),
    paletteFamily: family,
    avoidGold,
    planSpecificityScore: score,
    weakDesignPlanWarnings: warnings,
    hasMeaningfulRejectedDirections: meaningfulRejected,
  };
}

/**
 * Derive the Strategic Thinking Ledger — a deterministic strategic decision MERGED
 * with the model-native Design Thinking Plan (Phase 9A). Concept Authority still
 * protects correctness; when the model plan is present it controls taste (hero,
 * palette, demo surface). Pure and deterministic (no model call, no Date/random);
 * returns undefined only when there is genuinely no prompt/brief signal.
 */
export function deriveThinkingLedger(
  prompt: string,
  brief: WebBuildBrief,
  research: ResearchAgentArtifact | undefined,
  inferred: InferredBrief,
  lang: Lang = 'en',
): StrategicThinkingLedger | undefined {
  const promptText = (prompt || brief.coreIdea || brief.type || inferred.businessType || '').trim();
  if (!promptText) return undefined;

  // Reuse the already-resolved Concept Authority when present, else derive it — so
  // the ledger's primary concept ALWAYS matches the concept-authority read.
  let authority = research?.conceptAuthority;
  if (!authority) { try { authority = deriveConceptAuthority(prompt, brief, inferred, lang); } catch { authority = undefined; } }
  const primaryConcept = String(authority?.primaryConcept || detectConceptCategory(promptText) || 'general');
  const primaryLc = primaryConcept.toLowerCase();
  const targetVertical = authority?.targetVertical ? String(authority.targetVertical) : (authority?.audienceVertical || undefined);
  const verticalLabel = targetVertical || '';

  const hay = [prompt, brief.coreIdea, brief.type, brief.goal, brief.audience].filter(Boolean).join(' ').toLowerCase();

  // Phase 9A: the model's OWN Design Thinking Plan (visible, structured) — normalized
  // to the layout/palette vocabulary. When present it controls taste/composition.
  const modelDesignPlan = deriveModelDesignPlan(brief);

  // Phase 12F — the shared product-intent authority resolves the honest demo family,
  // domain-native section labels and drift guards. Chat and store surfaces require
  // EXPLICIT evidence; the original prompt + authoritative concept win over generic
  // AI/SaaS/"assistant"/ecommerce-vertical defaults, and a model plan that drifts to
  // "chat" is rejected when the prompt carries no explicit chat evidence.
  const intent: ProductIntent = resolveProductIntent({
    prompt,
    briefText: [brief.coreIdea, brief.type, brief.goal, brief.audience].filter(Boolean).join(' '),
    primaryConcept: primaryLc,
    targetVertical,
    modelDemoModule: modelDesignPlan?.demoModule,
    lang: (lang === 'tr' ? 'tr' : 'en') as ProductLang,
  });
  const explicitChat = intent.explicitChat;
  const isAiSaas = primaryLc === 'ai' || primaryLc === 'saas' || intent.softwareProduct;
  // Dashboard is the demo surface ONLY when the prompt EXPLICITLY asks for it.
  const dashboardRequested = intent.explicitDashboard;

  const languageIntent = L(lang, lang === 'tr' ? 'Turkish' : 'English', lang === 'tr' ? 'Türkçe' : 'İngilizce');

  // The demo surface IS the resolved product-intent family — never 'chat-demo' without
  // explicit chat evidence, never a storefront without an actual store concept.
  const demoSurfaceIntent: DemoSurfaceIntent = intent.demoFamily as DemoSurfaceIntent;

  const mustNotBecome: string[] = [];
  if (!explicitChat) mustNotBecome.push(L(lang, 'a chatbot / conversational assistant surface', 'sohbet botu / konuşmalı asistan yüzeyi'));
  if (!intent.catalogOriented) mustNotBecome.push(L(lang, 'a storefront / shopping assistant flow', 'mağaza / alışveriş asistanı akışı'));
  if (isAiSaas) {
    if (!dashboardRequested) mustNotBecome.push(L(lang, 'analytics/admin dashboard', 'analitik/yönetim paneli'));
    mustNotBecome.push(L(lang, 'generic agency-service site', 'genel ajans-hizmet sitesi'));
  } else if (intent.catalogOriented) {
    mustNotBecome.push(L(lang, 'AI analytics dashboard', 'AI analitik paneli'));
  }

  const conceptThesis = explicitChat
    ? L(lang, `A premium marketing site for an AI chatbot product${verticalLabel ? ` for ${verticalLabel}` : ''}, with a front-end-only chat demo.`,
        `Bir AI sohbet botu ürünü${verticalLabel ? ` (${verticalLabel} için)` : ''} için, yalnızca ön-yüz sohbet demolu premium bir tanıtım sitesi.`)
    : isAiSaas
      ? L(lang, `A premium product-marketing site for a ${primaryConcept} product${verticalLabel ? ` for ${verticalLabel}` : ''}, with a focused front-end-only product demo.`,
          `Bir ${primaryConcept} ürünü${verticalLabel ? ` (${verticalLabel} için)` : ''} için, odaklı ve yalnızca ön-yüz ürün demolu premium bir ürün-pazarlama sitesi.`)
      : L(lang, `A premium ${primaryConcept} site${verticalLabel ? ` for ${verticalLabel}` : ''}.`,
          `${verticalLabel ? `${verticalLabel} için ` : ''}premium bir ${primaryConcept} sitesi.`);

  const visitorDecision = isAiSaas
    ? L(lang, 'Is this product right for me, and can I try the experience now?',
        'Bu ürün bana uygun mu ve deneyimi hemen deneyebilir miyim?')
    : L(lang, 'Is this the right choice, and what is the next step?',
        'Doğru seçim bu mu ve sonraki adım ne?');

  // The conversion path names the RESOLVED demo family, never a hardcoded "Chat / Product demo".
  const demoLabelBare = intent.demoFamily.replace('-demo', '').replace('-', ' ');
  const primaryConversionPath = isAiSaas
    ? L(lang, `Landing → preview-only lead capture → ${demoLabelBare} demo`,
        `İniş → yalnızca-önizleme kayıt → ${demoLabelBare} demosu`)
    : L(lang, 'Landing → primary action', 'İniş → birincil eylem');

  const demoSurfaceMustShow = intent.demoMustShow.slice();

  const demoSurfaceMustAvoid = [
    L(lang, 'fake metrics / counts', 'sahte metrik / sayı'),
    L(lang, 'fake logos or testimonials', 'sahte logo veya referans'),
    L(lang, 'fake AI / compliance (SOC2/ISO) claims', 'sahte AI / uyumluluk (SOC2/ISO) iddiaları'),
    ...intent.demoMustAvoid,
    ...(isAiSaas && !dashboardRequested ? [L(lang, 'unrelated analytics dashboards', 'ilgisiz analitik panelleri')] : []),
  ];

  // A CONCEPT-SPECIFIC specificity bar — not the old hardcoded "chat, routing,
  // integrations, security, pricing, demo" sentence that assumed every AI product is a chatbot.
  const sectionSpecificityBar = intent.preferredSectionLabels.length
    ? L(lang, `Every section must prove something concept-specific (e.g. ${intent.preferredSectionLabels.slice(0, 4).join(', ')}) — not generic agency filler.`,
        `Her bölüm konsepte özgü bir şey kanıtlamalı (ör. ${intent.preferredSectionLabels.slice(0, 4).join(', ')}) — genel ajans dolgusu değil.`)
    : L(lang, 'Every section must prove something concept-specific, not generic filler.',
        'Her bölüm konsepte özgü bir şey kanıtlamalı, genel dolgu değil.');

  // Generic filler PLUS the intent's forbidden drift tokens (chat labels unless chat is
  // explicit; store labels unless the concept is a store) so the Fixer repairs drift.
  const forbiddenGenericLabels = GENERIC_FILLER_LABELS.concat(intent.forbiddenDriftLabels);
  const preferredSectionLabels = intent.preferredSectionLabels.slice();

  const languageRules = L(lang,
    `Write ALL website copy and fallback labels in ${lang === 'tr' ? 'Turkish' : 'English'}; never mix a fallback label from another language.`,
    `TÜM site metnini ve yedek etiketleri ${lang === 'tr' ? 'Türkçe' : 'İngilizce'} yaz; başka bir dilden yedek etiket karıştırma.`);

  const qualityBar = isAiSaas
    ? L(lang, 'Feels like a real, premium AI product site: focused demo, honest proof, restrained modern visuals — not a generic dark/gold dashboard template.',
        'Gerçek, premium bir AI ürün sitesi gibi hissettirir: odaklı demo, dürüst kanıt, ölçülü modern görseller — genel koyu/altın panel şablonu değil.')
    : L(lang, 'Feels like a real, premium product — concept-specific, honest, and modern.',
        'Gerçek, premium bir ürün gibi hissettirir — konsepte özgü, dürüst ve modern.');

  const reason = L(lang,
    `Committed a "${primaryConcept}" thesis${verticalLabel ? ` for the ${verticalLabel} vertical` : ''}: demo surface = ${demoSurfaceIntent}${dashboardRequested ? ' (dashboard explicitly requested)' : ''}; language = ${lang}.`,
    `"${primaryConcept}" tezi${verticalLabel ? ` (${verticalLabel} dikeyi için)` : ''} sabitlendi: demo yüzeyi = ${demoSurfaceIntent}${dashboardRequested ? ' (panel açıkça istendi)' : ''}; dil = ${lang}.`);

  return {
    languageIntent,
    conceptThesis,
    primaryConcept,
    targetVertical,
    mustNotBecome,
    visitorDecision,
    primaryConversionPath,
    demoSurfaceIntent,
    demoSurfaceMustShow,
    demoSurfaceMustAvoid,
    sectionSpecificityBar,
    forbiddenGenericLabels,
    preferredSectionLabels,
    languageRules,
    qualityBar,
    reason,
    modelDesignPlan,
  };
}

/* ── Intent-Aware Page Architecture Planner (Phase 9D-1) ───────────────────
 * A small, DETERMINISTIC decision about which sections THIS concept actually
 * needs — so the page stops including default SaaS sections (testimonials, case
 * studies, generic process, fake proof) the specific prompt never asked for. It
 * only decides section SELECTION + display labels + order; it never touches
 * section ids/anchors, the layout plan vocabulary, the renderer, or backend, and
 * it never fabricates proof. Applied as a safe selection pass before files/layout.
 * Every field is optional-friendly and backward compatible. */
export type DemoPlacement = 'hero' | 'dedicated-section' | 'gated' | 'none';

export interface PageArchitectureDecision {
  recommendedSections: string[];
  /** Sections to drop, with an honest reason (+ the matched section id when known). */
  removedSections: Array<{ section: string; reason: string; id?: string }>;
  requiredSections: string[];
  optionalSections: string[];
  entryModel: string;
  demoPlacement: DemoPlacement;
  pricingNeeded: boolean;
  pricingReason: string;
  proofNeeded: boolean;
  proofReason: string;
  securityNeeded: boolean;
  securityReason: string;
  integrationsNeeded: boolean;
  integrationsReason: string;
  primaryCTA: string;
  secondaryCTA: string;
  architectureWarnings: string[];
}

/** Section id/name → coarse role, used to decide selection/removal/order. */
const SECTION_ROLE_RE = {
  hero: /hero|banner|masthead/i,
  footer: /footer|colophon/i,
  demo: /demo|chat|assistant|playground|product-?demo|conversation|sohbet/i,
  flow: /how[-\s]?it[-\s]?works|process|workflow|steps?|journey|shopper\s*flow|discovery|plan\b|delivery|süreç|nasıl/i,
  integrations: /integration|connect|shopify|\bapi\b|plugin|webhook|catalog|store\s*integrat|entegrasyon/i,
  security: /security|trust|privacy|compliance|safety|güven|gizlilik/i,
  pricing: /pricing|price|plans?|subscription|tier|packages?|fiyat|abonelik|paket/i,
  testimonials: /testimonial|review|quote|müşteri\s*yorum|yorumlar|referans/i,
  caseStudies: /case[-\s]?stud|success\s*stor|vaka/i,
  certifications: /certificat|accreditat|soc\s?2|\biso\b|compliance\s*badge|sertifika/i,
  contact: /contact|get\s*in\s*touch|book\s*a?\s*demo|contact\s*sales|iletişim|demo\s*ayarla/i,
  features: /^features?$|^benefits?$|^overview$|özellikler/i,
} as const;

/* ── Experience Blueprint (Phase 9D-2) — high-level website experience planner ──
 * Decides the WHOLE-SITE experience type, page mode, conversion path, required /
 * optional / forbidden page groups and CTA strategy BEFORE section-level choices,
 * so a restaurant never gets a SaaS pricing/security spine and a chatbot never
 * gets a menu/gallery. Pure + deterministic + data-only: no routing, no image/
 * video/motion, no backend, no fabricated proof. */
export type SiteExperienceType =
  | 'b2b-product-landing' | 'consumer-product-landing' | 'local-business' | 'restaurant'
  | 'portfolio' | 'developer-tool' | 'mobile-app' | 'marketplace' | 'ecommerce-store'
  | 'startup-waitlist' | 'agency-service' | 'content-publication' | 'event-landing'
  | 'dashboard-preview' | 'unknown';
export type PageMode =
  | 'single-page' | 'multi-section-landing' | 'dashboard-first' | 'catalog-first'
  | 'editorial-scroll' | 'waitlist-funnel' | 'contact-sales-funnel' | 'docs-first'
  | 'portfolio-gallery';

export interface ExperienceBlueprint {
  siteExperienceType: SiteExperienceType;
  pageMode: PageMode;
  primaryUserIntent: string;
  targetAudience: string;
  conversionGoal: string;
  primaryCTA: string;
  secondaryCTA?: string;
  requiredPageGroups: string[];
  optionalPageGroups: string[];
  forbiddenPageGroups: Array<{ group: string; reason: string }>;
  demoNeeded: boolean;
  demoReason: string;
  pricingNeeded: boolean;
  pricingReason: string;
  leadCaptureNeeded: boolean;
  leadCaptureReason: string;
  contactNeeded: boolean;
  contactReason: string;
  proofAllowed: boolean;
  proofReason: string;
  imageVisualNeeded: boolean;
  imageVisualReason: string;
  motionVisualNeeded: boolean;
  motionVisualReason: string;
  recommendedVisualDirection: string;
  blueprintWarnings: string[];
}

/**
 * Derive the high-level Experience Blueprint. Pure + deterministic. Classifies the
 * site experience from the concept authority (product concept wins over the target
 * vertical, so "AI chatbot for ecommerce" is a B2B product landing, not a store),
 * then sets the page mode, CTA strategy and required/forbidden page groups. Honest:
 * proof is only allowed when the user/source actually provides it; any demo is a
 * front-end-only sample. Image/motion needs are HINTS for future phases only.
 */
export function deriveExperienceBlueprint(
  brief: WebBuildBrief,
  sectionItems: Array<{ id: string; name: string }>,
  conceptAuthority: ConceptAuthority | undefined,
  pageArchitecture: PageArchitectureDecision | undefined,
  visualSignaturePlan: VisualSignaturePlan | undefined,
  ledger: StrategicThinkingLedger | undefined,
  lang: Lang = 'en',
): ExperienceBlueprint {
  const secNames = (sectionItems || []).map((s) => s.name).filter(Boolean).join(' ');
  const hay = [brief.coreIdea, brief.type, brief.goal, brief.audience, brief.style, brief.visitorIntent, secNames]
    .filter(Boolean).join(' ').toLowerCase();
  const concept = (ledger?.primaryConcept || conceptAuthority?.primaryConcept || '').toLowerCase();
  const vertical = (conceptAuthority?.targetVertical || conceptAuthority?.audienceVertical || ledger?.targetVertical || '').toLowerCase();
  const vhay = `${hay} ${vertical}`;

  // Prompt-driven inclusion signals (only include when genuinely asked).
  const asksPricing = /pricing|\bprice\b|plans?|subscription|tier|packages?|paywall|fiyat|abonelik|paket/.test(hay);
  const asksTestimonials = /testimonial|customer\s*review|reviews?|referans|yorum/.test(hay);
  const asksCaseStudies = /case[-\s]?stud|success\s*stor|vaka/.test(hay);
  const asksBookDemo = /book\s*a?\s*demo|contact\s*sales|talk\s*to\s*sales|schedule\s*a?\s*(call|demo)|demo\s*ayarla|satış/.test(hay);
  const asksWaitlist = /waitlist|early\s*access|coming\s*soon|beta\s*access|join\s*the\s*list|bekleme\s*listesi/.test(hay);
  const asksDownload = /download|app\s*store|play\s*store|get\s*the\s*app|install/.test(hay);
  const asksIntegrationsHint = /integration|\bapi\b|connect|webhook|zapier|entegrasyon/.test(hay);
  const providedProof = asksTestimonials || asksCaseStudies;

  // Concept signals (concept authority separates PRODUCT from VERTICAL).
  const isAiProduct = concept === 'ai' || concept === 'saas' || /\bai\b|artificial|chatbot|chat\s*bot|assistant|agentic|\bllm\b|copilot|automation/.test(hay);
  const isB2B = /b2b|enterprise|sales\s*team|\bteams?\b|\bsaas\b|platform|merchant|business|kurumsal|workflow|operations/.test(hay);

  // Keyword buckets for non-software concepts (checked only when not an AI/SaaS product).
  const kw = {
    restaurant: /restaurant|\bcafe\b|café|bistro|diner|eatery|\bmenu\b|dining|cuisine|restoran|kafe|lokanta/,
    localBiz: /\bsalon\b|barber|\bspa\b|clinic|dental|dentist|plumb|electrician|landscap|cleaning\s*service|\brepair\b|local\s*business|kuaför|klinik|tamir/,
    portfolio: /portfolio|personal\s*(site|website)|\bdesigner\b|photographer|\bartist\b|freelanc|resume|\bcv\b|showreel|portföy/,
    devTool: /developer|\bdev\s*tool|\bcli\b|\bapi\b|\bsdk\b|library|framework|terminal|command\s*line|open\s*source|programming|deploy|devops|yazılımcı/,
    mobileApp: /mobile\s*app|ios\s*app|android\s*app|app\s*store|play\s*store|download\s*the\s*app|app\s*launch|uygulama\s*indir/,
    marketplace: /marketplace|multi-?vendor|classifieds?|listings?|buyers?\s*and\s*sellers|two-?sided|pazaryeri/,
    ecommerce: /ecommerce|e-?commerce|storefront|online\s*store|\bshop\b|retail|dropship|e-?ticaret|mağaza/,
    waitlist: /waitlist|early\s*access|coming\s*soon|beta\s*access|pre-?launch|bekleme\s*listesi/,
    agency: /\bagency\b|consultanc|marketing\s*firm|creative\s*studio|services\s*firm|\bajans\b/,
    publication: /\bblog\b|magazine|publication|newsletter|news\s*site|editorial|articles|yayın|dergi/,
    event: /\bevent\b|conference|summit|webinar|meetup|festival|expo|etkinlik|konferans/,
    dashboard: /dashboard|analytics\s*(tool|platform)|admin\s*panel|\bbi\b\s*tool|reporting|panel/,
  };
  const hit = (re: RegExp) => re.test(vhay);

  // ── Classify the site experience. Product concept (AI/SaaS) wins over the
  // target vertical, so an "AI chatbot for ecommerce" is a B2B product landing. ──
  let siteExperienceType: SiteExperienceType;
  if (isAiProduct) {
    // An AI product SOLD TO businesses (stores/merchants/teams) is a B2B landing —
    // the ecommerce/store vertical is the CUSTOMER, not the site being a store.
    const servesBusiness = isB2B || asksBookDemo
      || /\bstore\b|stores|merchant|e-?commerce|ecommerce|retail|\bshop\b|\bteams?\b|compan|\bbrand\b|agenc|business|kurumsal/.test(vhay);
    siteExperienceType = servesBusiness ? 'b2b-product-landing' : 'consumer-product-landing';
  } else if (hit(kw.restaurant)) siteExperienceType = 'restaurant';
  else if (hit(kw.portfolio)) siteExperienceType = 'portfolio';
  else if (hit(kw.devTool)) siteExperienceType = 'developer-tool';
  else if (hit(kw.mobileApp)) siteExperienceType = 'mobile-app';
  else if (hit(kw.waitlist) || asksWaitlist) siteExperienceType = 'startup-waitlist';
  else if (hit(kw.marketplace)) siteExperienceType = 'marketplace';
  else if (hit(kw.ecommerce)) siteExperienceType = 'ecommerce-store';
  else if (hit(kw.dashboard)) siteExperienceType = 'dashboard-preview';
  else if (hit(kw.publication)) siteExperienceType = 'content-publication';
  else if (hit(kw.event)) siteExperienceType = 'event-landing';
  else if (hit(kw.agency)) siteExperienceType = 'agency-service';
  else if (hit(kw.localBiz)) siteExperienceType = 'local-business';
  else if (isB2B) siteExperienceType = 'b2b-product-landing';
  else siteExperienceType = 'unknown';

  const T = siteExperienceType;
  const isSaaSLike = T === 'b2b-product-landing' || T === 'consumer-product-landing' || T === 'developer-tool' || T === 'dashboard-preview';
  const isLocalLike = T === 'restaurant' || T === 'local-business';

  // ── Page mode. ──
  const pageMode: PageMode =
    T === 'b2b-product-landing' ? (asksBookDemo ? 'contact-sales-funnel' : 'multi-section-landing')
    : T === 'developer-tool' ? 'docs-first'
    : T === 'portfolio' ? 'portfolio-gallery'
    : T === 'startup-waitlist' ? 'waitlist-funnel'
    : (T === 'marketplace' || T === 'ecommerce-store') ? 'catalog-first'
    : T === 'dashboard-preview' ? 'dashboard-first'
    : T === 'content-publication' ? 'editorial-scroll'
    : T === 'unknown' ? 'single-page'
    : 'multi-section-landing';

  // ── CTA strategy (Task 5) — display/planning level. ──
  // Phase 12F — a B2B product landing's secondary CTA follows the RESOLVED demo family,
  // never a universal "See Chat Flow". Chat is offered only when the ledger resolved an
  // explicit chat demo.
  const df = ledger?.demoSurfaceIntent;
  // A store surface is legitimate ONLY when the store is the primary experience.
  const storeExperience = siteExperienceType === 'ecommerce-store' || siteExperienceType === 'marketplace';
  const b2bSecondaryCTA =
      df === 'chat-demo' ? L(lang, 'See Chat Flow', 'Sohbet Akışını Gör')
    : df === 'dashboard-demo' ? L(lang, 'Preview Dashboard', 'Paneli Önizle')
    : df === 'assessment-demo' ? L(lang, 'Check Readiness', 'Hazırlığı Kontrol Et')
    : df === 'calculator-demo' ? L(lang, 'Try Calculator', 'Hesaplayıcıyı Dene')
    : df === 'workflow-demo' ? L(lang, 'See Product Workflow', 'Ürün Akışını Gör')
    : L(lang, 'See Product Demo', 'Ürün Demosunu Gör');
  const cta = ((): { primary: string; secondary?: string } => {
    switch (T) {
      case 'b2b-product-landing':
        return { primary: L(lang, 'Book a Demo', 'Demo Ayarla'), secondary: b2bSecondaryCTA };
      case 'consumer-product-landing':
      case 'mobile-app':
        return { primary: asksDownload ? L(lang, 'Download', 'İndir') : (asksWaitlist ? L(lang, 'Join Waitlist', 'Listeye Katıl') : L(lang, 'Try the Demo', 'Demoyu Dene')), secondary: L(lang, 'See Features', 'Özellikleri Gör') };
      case 'restaurant':
        return { primary: L(lang, 'Reserve a Table', 'Masa Ayırt'), secondary: L(lang, 'View Menu', 'Menüyü Gör') };
      case 'local-business':
        return { primary: L(lang, 'Call Now', 'Hemen Ara'), secondary: L(lang, 'Get Directions', 'Yol Tarifi Al') };
      case 'developer-tool':
        return { primary: L(lang, 'View Docs', 'Dokümanları Gör'), secondary: L(lang, 'See Examples', 'Örnekleri Gör') };
      case 'portfolio':
        return { primary: L(lang, 'View Work', 'Çalışmaları Gör'), secondary: L(lang, 'Contact', 'İletişim') };
      case 'startup-waitlist':
        return { primary: L(lang, 'Join the Waitlist', 'Bekleme Listesine Katıl'), secondary: L(lang, 'How it works', 'Nasıl çalışır') };
      case 'marketplace':
      case 'ecommerce-store':
        return { primary: L(lang, 'Browse', 'Göz At'), secondary: L(lang, 'How it works', 'Nasıl çalışır') };
      case 'agency-service':
        return { primary: L(lang, 'Start a Project', 'Projeye Başla'), secondary: L(lang, 'See Work', 'Çalışmaları Gör') };
      case 'event-landing':
        return { primary: L(lang, 'Register', 'Kayıt Ol'), secondary: L(lang, 'See Schedule', 'Programı Gör') };
      case 'content-publication':
        return { primary: L(lang, 'Read Now', 'Şimdi Oku'), secondary: L(lang, 'Subscribe', 'Abone Ol') };
      case 'dashboard-preview':
        return { primary: L(lang, 'Book a Demo', 'Demo Ayarla'), secondary: L(lang, 'See Features', 'Özellikleri Gör') };
      default:
        return { primary: L(lang, 'Get in touch', 'İletişime geç'), secondary: L(lang, 'See how it works', 'Nasıl çalıştığını gör') };
    }
  })();

  // ── Required / optional / forbidden page groups per experience type. ──
  let requiredPageGroups: string[] = [];
  let optionalPageGroups: string[] = [];
  const forbiddenPageGroups: Array<{ group: string; reason: string }> = [];
  const forbid = (group: string, reason: string) => forbiddenPageGroups.push({ group, reason });
  const noSourceProof = L(lang, 'No user/source proof provided — would be fabricated.', 'Kullanıcı/kaynak kanıtı yok — uydurma olur.');
  const notThisType = (what: string) => L(lang, `${what} does not fit this site type.`, `${what} bu site türüne uymuyor.`);

  switch (T) {
    case 'b2b-product-landing':
    case 'dashboard-preview': {
      // Phase 12F — concept-specific B2B spine. The demo group name follows the resolved
      // family; Integrations is required only when genuinely signalled; the trust group
      // is methodology-based for a compliance product (never confused with SOC2/ISO).
      const isCompliance = df === 'workflow-demo' && /complian|regulat|cbam|emission|carbon|tax|audit|gdpr|kvkk|esg|uyumluluk|mevzuat|raporlama|karbon|emisyon|sertifika/.test(`${hay} ${vertical}`);
      const demoGroup = df === 'chat-demo' ? 'Chat Experience'
        : df === 'dashboard-demo' ? 'Dashboard Preview'
        : df === 'workflow-demo' ? (isCompliance ? 'Data Collection Workflow' : 'Product Workflow')
        : df === 'calculator-demo' ? 'Calculator'
        : df === 'assessment-demo' ? 'Readiness Check'
        : 'Product Demo';
      const trustGroup = isCompliance ? 'Trust & Methodology' : 'Security & Trust';
      requiredPageGroups = ['Hero', demoGroup, 'How it works', trustGroup, 'Contact Sales / Book Demo'];
      if (isCompliance) requiredPageGroups.splice(2, 0, 'Scope & Eligibility', 'Report Readiness');
      if (asksIntegrationsHint) requiredPageGroups.push('Integrations');
      else optionalPageGroups = ['Integrations'];
      optionalPageGroups = optionalPageGroups.concat(['Pricing', 'FAQ', 'Use Cases']);
      forbid('Menu / Gallery / Reservation', notThisType(L(lang, 'Restaurant/portfolio sections', 'Restoran/portföy bölümleri')));
      if (df !== 'chat-demo') forbid('Chat Experience / Conversation Flow / Human Handoff', notThisType(L(lang, 'A chatbot surface (no explicit chat product)', 'Bir sohbet botu yüzeyi (açık sohbet ürünü yok)')));
      if (!storeExperience) forbid('Shopper Flow / Store Integrations / Product Recommendations', notThisType(L(lang, 'A storefront (the customer vertical is not the product)', 'Bir mağaza (müşteri dikeyi ürün değildir)')));
      if (!providedProof) { forbid('Testimonials', noSourceProof); forbid('Case Studies', noSourceProof); }
      forbid('Fake logo strip', L(lang, 'No real customer logos to show.', 'Gösterilecek gerçek müşteri logosu yok.'));
      forbid('Fake metrics / certifications', L(lang, 'No verified metrics or SOC2/ISO to claim.', 'Doğrulanmış metrik veya SOC2/ISO iddiası yok.'));
      break;
    }
    case 'consumer-product-landing':
    case 'mobile-app':
      requiredPageGroups = ['Hero', 'Features', 'How it works', asksDownload ? 'Download' : (asksWaitlist ? 'Waitlist' : 'Product Demo'), 'FAQ'];
      optionalPageGroups = ['Screenshots', 'Pricing'];
      forbid('Contact Sales', notThisType(L(lang, 'B2B sales funnel', 'B2B satış hunisi')));
      if (!providedProof) forbid('Testimonials', noSourceProof);
      break;
    case 'restaurant':
      requiredPageGroups = ['Hero', 'Menu', 'Location', 'Hours', 'Reservation / Contact', 'Gallery'];
      optionalPageGroups = ['About', 'Events'];
      forbid('Pricing Plans', notThisType(L(lang, 'SaaS pricing', 'SaaS fiyatlandırması')));
      forbid('Integrations', notThisType(L(lang, 'SaaS integrations', 'SaaS entegrasyonları')));
      forbid('Security & Compliance', notThisType(L(lang, 'SaaS security', 'SaaS güvenliği')));
      forbid('Chat / Dashboard Demo', notThisType(L(lang, 'A product demo', 'Bir ürün demosu')));
      forbid('Dashboard Preview', notThisType(L(lang, 'A SaaS dashboard', 'Bir SaaS paneli')));
      forbid('Fake metrics / certifications', L(lang, 'No verified metrics or SOC2/ISO to claim.', 'İddia edilecek doğrulanmış metrik veya SOC2/ISO yok.'));
      if (!providedProof) { forbid('Testimonials', noSourceProof); forbid('Case Studies', noSourceProof); }
      break;
    case 'local-business':
      // Covers landscaping / garden / outdoor / local service (Task 6).
      requiredPageGroups = ['Hero', 'Services', 'Projects / Before & After', 'Materials / Process', 'Location / Service Area', 'Get a Quote / Contact', 'Gallery'];
      optionalPageGroups = ['About', 'Reviews (only if provided)'];
      forbid('Pricing Plans', notThisType(L(lang, 'SaaS pricing', 'SaaS fiyatlandırması')));
      forbid('Product Demo', notThisType(L(lang, 'A product demo', 'Bir ürün demosu')));
      forbid('Dashboard Preview', notThisType(L(lang, 'A SaaS dashboard', 'Bir SaaS paneli')));
      forbid('Security Compliance', notThisType(L(lang, 'SaaS security/compliance', 'SaaS güvenlik/uyumluluk')));
      if (!asksIntegrationsHint) forbid('Integrations', notThisType(L(lang, 'SaaS integrations', 'SaaS entegrasyonları')));
      forbid('Fake metrics', L(lang, 'No verified metrics to claim.', 'İddia edilecek doğrulanmış metrik yok.'));
      forbid('Fake certifications', L(lang, 'No real SOC2/ISO/certifications to claim.', 'İddia edilecek gerçek SOC2/ISO/sertifika yok.'));
      if (!providedProof) { forbid('Testimonials', noSourceProof); forbid('Case Studies', noSourceProof); }
      break;
    case 'portfolio':
      requiredPageGroups = ['Hero', 'Work / Projects', 'About', 'Skills / Process', 'Contact'];
      optionalPageGroups = ['Services', 'Resume'];
      forbid('Pricing Plans', notThisType(L(lang, 'SaaS pricing', 'SaaS fiyatlandırması')));
      forbid('Security & Compliance', notThisType(L(lang, 'SaaS security', 'SaaS güvenliği')));
      forbid('Integrations', notThisType(L(lang, 'SaaS integrations', 'SaaS entegrasyonları')));
      forbid('Product Demo', notThisType(L(lang, 'A product demo', 'Bir ürün demosu')));
      break;
    case 'developer-tool':
      requiredPageGroups = ['Hero', 'Code Demo / CLI Flow', 'Features by job', 'Docs / Quickstart', 'Integrations / API'];
      optionalPageGroups = ['Pricing', 'Changelog', 'GitHub / Download'];
      forbid('Ecommerce / customer-support sections', notThisType(L(lang, 'A developer tool', 'Bir geliştirici aracı')));
      if (!providedProof) forbid('Testimonials', noSourceProof);
      break;
    case 'startup-waitlist':
      requiredPageGroups = ['Hero', 'Problem', 'Product Teaser', 'How it works', 'Waitlist Form', 'FAQ'];
      optionalPageGroups = ['Team', 'Roadmap'];
      forbid('Pricing', notThisType(L(lang, 'A pre-launch waitlist', 'Bir lansman öncesi bekleme listesi')));
      if (!providedProof) { forbid('Testimonials', noSourceProof); forbid('Case Studies', noSourceProof); }
      break;
    case 'marketplace':
    case 'ecommerce-store':
      requiredPageGroups = ['Hero', 'Catalog / Product Grid', 'Filters', 'How it works', 'Trust & Safety'];
      optionalPageGroups = ['Seller / Buyer value', 'Pricing (marketplace plans only)'];
      if (!providedProof) forbid('Testimonials', noSourceProof);
      break;
    case 'agency-service':
      requiredPageGroups = ['Hero', 'Services', 'Work / Portfolio', 'Process', 'Contact'];
      optionalPageGroups = ['About', 'Pricing'];
      forbid('Product Demo', notThisType(L(lang, 'A product demo', 'Bir ürün demosu')));
      forbid('Fake metrics', L(lang, 'No verified metrics to claim.', 'İddia edilecek doğrulanmış metrik yok.'));
      forbid('Fake awards / certifications', L(lang, 'No real awards/certifications to claim.', 'İddia edilecek gerçek ödül/sertifika yok.'));
      if (!providedProof) { forbid('Fake client logos', noSourceProof); forbid('Testimonials', noSourceProof); forbid('Case Studies', noSourceProof); }
      break;
    case 'event-landing':
      requiredPageGroups = ['Hero', 'Schedule / Agenda', 'Speakers (only if provided)', 'Location', 'Register'];
      optionalPageGroups = ['Sponsors (only if provided)', 'FAQ'];
      break;
    case 'content-publication':
      requiredPageGroups = ['Hero', 'Featured Articles', 'Categories', 'Subscribe'];
      optionalPageGroups = ['About', 'Archive'];
      forbid('Pricing Plans', notThisType(L(lang, 'SaaS pricing', 'SaaS fiyatlandırması')));
      break;
    default:
      requiredPageGroups = ['Hero', 'What it is', 'How it works', 'Contact'];
      optionalPageGroups = ['Features', 'FAQ'];
      break;
  }

  // ── Cross-cutting need decisions (blueprint reasons; honest). ──
  // Note: isSaaSLike already covers consumer-product-landing and isLocalLike
  // already covers restaurant, so those members are omitted from the OR chains
  // (TypeScript narrows them out and flags the redundant comparison as TS2367).
  const demoNeeded = isSaaSLike || T === 'marketplace' || T === 'ecommerce-store';
  const pricingNeeded = asksPricing || (T === 'b2b-product-landing' && /\bsaas\b|subscription|self-?serve|plans?/.test(hay));
  const leadCaptureNeeded = T === 'startup-waitlist' || asksWaitlist || (T === 'b2b-product-landing' && (pageMode === 'contact-sales-funnel' || asksBookDemo));
  const contactNeeded = T !== 'content-publication';
  const proofAllowed = providedProof;
  // Image/motion HINTS only — never implemented here (prep for 9E-3 / 9E-4).
  const imageVisualNeeded = isLocalLike || T === 'portfolio' || T === 'mobile-app' || T === 'event-landing' || T === 'agency-service' || T === 'content-publication';
  const motionVisualNeeded = isSaaSLike || T === 'startup-waitlist';
  const recommendedVisualDirection = visualSignaturePlan?.visualSignature
    || (T === 'developer-tool' ? L(lang, 'Command & deploy rail (code rain / terminal)', 'Komut ve dağıtım rayı (kod yağmuru / terminal)')
      : T === 'b2b-product-landing' ? L(lang, 'Storefront chat flow rail + integration orbit', 'Mağaza sohbet akış rayı + entegrasyon yörüngesi')
      : isLocalLike || T === 'portfolio' ? L(lang, 'Editorial imagery / collage, warm and calm', 'Editoryal görsel / kolaj, sıcak ve sakin')
      : (T === 'marketplace' || T === 'ecommerce-store') ? L(lang, 'Product grid / filter rail', 'Ürün gridi / filtre rayı')
      : L(lang, 'Restrained accent path lines on a tonal surface', 'Tonal yüzeyde ölçülü vurgu çizgileri'));

  // ── Warnings — surface obvious mismatches (guidance, never destructive here). ──
  const blueprintWarnings: string[] = [];
  if (T === 'unknown') blueprintWarnings.push(L(lang, 'Experience type could not be classified with confidence — using a safe single-page default; section guards stay conservative.', 'Deneyim türü güvenle sınıflandırılamadı — güvenli tek sayfa varsayılanı kullanılıyor; bölüm korumaları temkinli kalıyor.'));
  if (isLocalLike && (asksPricing || pageArchitecture?.pricingNeeded)) blueprintWarnings.push(L(lang, 'A local business rarely needs SaaS pricing — keep it only if explicitly requested.', 'Yerel bir işletme nadiren SaaS fiyatlandırmasına ihtiyaç duyar — yalnızca açıkça istenirse tut.'));
  if ((T === 'portfolio' || isLocalLike) && (pageArchitecture?.demoPlacement && pageArchitecture.demoPlacement !== 'none')) blueprintWarnings.push(L(lang, 'This site type should not carry a chat/dashboard product demo unless requested.', 'Bu site türü, istenmedikçe sohbet/panel ürün demosu taşımamalı.'));
  if (!providedProof) blueprintWarnings.push(L(lang, 'Proof sections (testimonials/case studies/logos/metrics) are disallowed — no real source to avoid fabrication.', 'Kanıt bölümleri (referans/vaka/logo/metrik) devre dışı — uydurmayı önlemek için gerçek kaynak yok.'));
  // Phase 12F — product-intent contradiction warnings (non-chat concept with a chat
  // surface, non-store product with a shopper/store surface, workflow product with a
  // storefront/chat hero). Warn honestly; the deterministic architecture already
  // corrects the labels upstream.
  const secLc = secNames.toLowerCase();
  if (df !== 'chat-demo' && /chat\s*experience|conversation\s*flow|human\s*handoff|chat\s*flow/.test(secLc)) {
    blueprintWarnings.push(L(lang, 'Non-chat concept carries a Chat Experience section — the demo should follow the resolved product workflow, not a conversation.', 'Sohbet olmayan konsept bir Sohbet Deneyimi bölümü taşıyor — demo bir konuşma değil, çözümlenen ürün akışını izlemeli.'));
  }
  if (!storeExperience && /shopper\s*flow|store\s*integrat|product\s*recommendation|storefront\s*chat/.test(secLc)) {
    blueprintWarnings.push(L(lang, 'Non-store product carries a Shopper Flow / Store Integrations section — the ecommerce vertical is the customer, not the product.', 'Mağaza olmayan ürün Alışverişçi Akışı / Mağaza Entegrasyonları taşıyor — e-ticaret dikeyi müşteridir, ürün değil.'));
  }
  if ((df === 'workflow-demo' || df === 'calculator-demo' || df === 'assessment-demo') && /storefront|shopper|chat\s*flow/.test(secLc)) {
    blueprintWarnings.push(L(lang, 'Workflow/tool product uses a storefront/chat hero — use a process/workflow/checklist visual language instead.', 'İş akışı/araç ürünü mağaza/sohbet hero kullanıyor — bunun yerine süreç/iş akışı/kontrol listesi görsel dili kullanın.'));
  }

  return {
    siteExperienceType: T,
    pageMode,
    primaryUserIntent: brief.visitorIntent || conceptAuthority?.primaryConcept || (isSaaSLike ? 'evaluate a product' : 'find what they need'),
    targetAudience: brief.audience || conceptAuthority?.audienceVertical || vertical || (isB2B ? 'business buyers' : 'general visitors'),
    conversionGoal: brief.conversionStrategy || cta.primary,
    primaryCTA: cta.primary,
    secondaryCTA: cta.secondary,
    requiredPageGroups: uniq(requiredPageGroups),
    optionalPageGroups: uniq(optionalPageGroups),
    forbiddenPageGroups,
    demoNeeded,
    demoReason: demoNeeded
      ? L(lang, 'A product/interactive concept benefits from a front-end-only sample demo.', 'Ürün/etkileşimli bir konsept, yalnızca ön-yüz örnek demosundan fayda sağlar.')
      : L(lang, 'This site type is explanatory/local — no product demo unless requested.', 'Bu site türü açıklayıcı/yerel — istenmedikçe ürün demosu yok.'),
    pricingNeeded,
    pricingReason: pricingNeeded
      ? L(lang, 'Prompt/concept calls for plans or a conversion page.', 'İstem/konsept planları veya bir dönüşüm sayfasını gerektiriyor.')
      : L(lang, 'Not requested for this experience type; prefer a demo/contact conversion.', 'Bu deneyim türü için istenmedi; demo/iletişim dönüşümü tercih edilir.'),
    leadCaptureNeeded,
    leadCaptureReason: leadCaptureNeeded
      ? L(lang, 'A waitlist / book-a-demo / contact-sales funnel needs a local lead form (front-end only).', 'Bir bekleme listesi / demo-ayarla / satış-iletişim hunisi yerel bir lead formu gerektirir (yalnızca ön-yüz).')
      : L(lang, 'No gated funnel — a simple contact suffices.', 'Kapılı huni yok — basit bir iletişim yeterli.'),
    contactNeeded,
    contactReason: contactNeeded
      ? L(lang, 'Visitors need a clear way to get in touch / take the next step.', 'Ziyaretçilerin iletişime geçmek / sonraki adımı atmak için net bir yola ihtiyacı var.')
      : L(lang, 'A publication leads with reading/subscribe rather than a contact form.', 'Bir yayın, iletişim formu yerine okuma/abone olma ile öncülük eder.'),
    proofAllowed,
    proofReason: proofAllowed
      ? L(lang, 'User/source provided proof — keep only with the real content.', 'Kullanıcı/kaynak kanıt sağladı — yalnızca gerçek içerikle tut.')
      : L(lang, 'No user/source proof — use honest Trust & Safety, never fabricated logos/testimonials/metrics.', 'Kullanıcı/kaynak kanıtı yok — logo/referans/metrik uydurmak yerine dürüst Güven ve Emniyet kullan.'),
    imageVisualNeeded,
    imageVisualReason: imageVisualNeeded
      ? L(lang, 'HINT for a future image phase — this type reads better with real imagery/collage (not generated here).', 'Gelecekteki bir görsel aşaması için İPUCU — bu tür gerçek görsel/kolaj ile daha iyi okunur (burada üretilmez).')
      : L(lang, 'HINT — CSS/SVG signature visuals are enough for this type.', 'İPUCU — bu tür için CSS/SVG imza görselleri yeterli.'),
    motionVisualNeeded,
    motionVisualReason: motionVisualNeeded
      ? L(lang, 'HINT for a future motion phase — subtle staged motion suits a product/launch page (not composed here).', 'Gelecekteki bir hareket aşaması için İPUCU — ince aşamalı hareket bir ürün/lansman sayfasına uyar (burada oluşturulmaz).')
      : L(lang, 'HINT — keep motion minimal for this type.', 'İPUCU — bu tür için hareketi minimum tut.'),
    recommendedVisualDirection,
    blueprintWarnings,
  };
}

/* ── Vertical Intelligence (Phase 11A) — deterministic sector engine ───────────
 * Refines the Concept Authority + Experience Blueprint understanding into a
 * DEEPER, sector-specific decision contract the later phases can consume. It
 * decides the primary sector, subsector, product-vs-audience separation, business
 * model, conversion model, trust model, section policy and — most importantly —
 * the VISUAL TRUTH POLICY (what must be real user material, what may be AI-
 * illustrative, what should be CSS/SVG, what motion is honest, what must never be
 * fabricated). Pure + deterministic + fail-open. The frontend derivation performs
 * NO network request. Phase 11B connects the EXISTING Web Build research result
 * (via the Research Agent artifact): researchPlan carries source-backed evidence
 * ONLY when real source URLs were returned, and remains explicitly 'not-run' /
 * honest no-source otherwise; deterministic profile angles stay recommendations,
 * never findings. PLANNING/DATA ONLY: this artifact never alters the renderer,
 * image pipeline, motion or asset behaviour in this phase — it is persisted and
 * diagnosed for downstream phases. */

/** Stable machine-readable sector slugs. */
export type VerticalSector =
  | 'jewelry'
  | 'landscaping'
  | 'automotive-dealership'
  | 'furniture-interiors'
  | 'restaurant-hospitality'
  | 'real-estate'
  | 'clinic-healthcare'
  | 'ai-saas'
  | 'marketplace'
  | 'portfolio-agency'
  | 'local-service'
  | 'general';

export type VerticalBusinessModel =
  | 'catalog-consultation'
  | 'quote-led-service'
  | 'inventory-led-sales'
  | 'catalog-showroom'
  | 'reservation-led'
  | 'listing-lead-generation'
  | 'appointment-led'
  | 'subscription-product'
  | 'contact-sales-product'
  | 'two-sided-marketplace'
  | 'project-inquiry'
  | 'service-booking'
  | 'unknown';

/** WHY the primary sector was chosen — distinguishes an AI/SaaS product serving a
 *  vertical (product-concept) from the operator business itself (operator-business)
 *  from a genuinely two-sided model (marketplace-model). */
export type VerticalClassificationBasis =
  | 'product-concept'
  | 'operator-business'
  | 'marketplace-model'
  | 'fallback';

export type VerticalConfidence = 'high' | 'medium' | 'low';

export interface VerticalConversionModel {
  goal: string;
  primaryAction: string;
  primaryCTA: string;
  secondaryCTA?: string;
  funnel: string[];
}

export interface VerticalTrustModel {
  drivers: string[];
  /** Proof that requires real user/source material — never fabricated. */
  sourceRequiredProof: string[];
  /** Claims this sector must never invent (fake metrics/awards/certifications/…). */
  forbiddenClaims: string[];
}

export interface VerticalForbiddenSection {
  section: string;
  reason: string;
}

export interface VerticalSectionPolicy {
  required: string[];
  recommended: string[];
  forbidden: VerticalForbiddenSection[];
}

export interface VerticalVisualPolicy {
  /** Visuals that require real user-provided/source material (never generated). */
  realSourceRequired: string[];
  /** Visuals AI may generate ILLUSTRATIVELY (mood/atmosphere/texture, non-literal). */
  aiIllustrativeAllowed: string[];
  /** Visuals best expressed as CSS/SVG mockups (product UI, flows, diagrams). */
  cssSvgPreferred: string[];
  /** Where subtle, honest motion is appropriate. */
  motionSuitable: string[];
  /** Imagery/claims that must NEVER be generated/fabricated for this sector. */
  forbiddenGenerated: string[];
  /** A one-line hero visual recommendation (honest, non-fabricating). */
  heroRecommendation: string;
}

/** Source-backed vertical research evidence (Phase 11B). Present only when the
 *  EXISTING Web Build research pass (surfaced via the Research Agent artifact)
 *  actually returned real, non-empty source URLs. The frontend derivation performs
 *  NO network request — it only consumes what the backend/Research Agent already
 *  produced. Source-backed findings arrays are populated ONLY in the genuine mode;
 *  in every no-source mode they stay empty (never labelled as findings). */
export interface VerticalResearchEvidence {
  didResearch: boolean;
  provider?: string;
  attemptedProviders?: string[];

  sourceCount: number;
  sources: WebBuildSource[];
  coveredAngles: string[];

  sourceBackedInsights: string[];
  categoryLanguage: string[];
  audienceExpectations: string[];
  conversionPatterns: string[];
  trustSignals: string[];
  visualPatterns: string[];
  competitorOrAdjacentPatterns: string[];
  risksToAvoid: string[];
  differentiationOpportunities: string[];

  fallbackReason?: string;
  summary: string;
}

export interface VerticalResearchPlan {
  /** The REAL research status when a Research Agent artifact exists, else 'not-run'.
   *  The frontend derivation still runs no network request (Phase 11B consumes the
   *  existing backend/Research Agent result). */
  status: WebBuildResearchStatus | 'not-run';
  /** Whether a future live sector scan is (still) recommended. */
  recommended: boolean;
  /** Deterministic profile angle suggestions — recommendations, never findings. */
  angles: string[];
  /** Honest one-line explanation (never claims research that did not happen). */
  reason: string;
  /** Source-backed / honest no-source evidence when a Research Agent artifact was
   *  threaded in. Absent for old builds and when no research artifact exists. */
  evidence?: VerticalResearchEvidence;
}

export interface VerticalIntelligenceArtifact {
  status: 'classified' | 'partial' | 'unknown' | 'failed-open';
  version: 'deterministic-v1';

  sector: VerticalSector;
  subsector: string;
  /** The served industry when the site is a product/marketplace serving it. */
  audienceSector?: VerticalSector;
  classificationBasis: VerticalClassificationBasis;
  confidence: VerticalConfidence;

  matchedSignals: string[];
  conflictingSignals: string[];

  businessModel: VerticalBusinessModel;

  conversionModel: VerticalConversionModel;
  trustModel: VerticalTrustModel;
  sectionPolicy: VerticalSectionPolicy;
  visualPolicy: VerticalVisualPolicy;
  researchPlan: VerticalResearchPlan;

  warnings: string[];
  summary: string;
}

export interface VerticalIntelligenceInput {
  prompt: string;
  brief: WebBuildBrief;
  inferred?: InferredBrief;
  sectionItems: Array<{ id: string; name: string }>;
  conceptAuthority?: ConceptAuthority;
  experienceBlueprint?: ExperienceBlueprint;
  ledger?: StrategicThinkingLedger;
  /** The already-normalized Research Agent artifact (Phase 11B). Optional →
   *  backward compatible; when present with real sources it backs the research
   *  evidence block. The frontend derivation never issues a network request. */
  research?: ResearchAgentArtifact;
  lang?: Lang;
}

/** The static sector-profile shape — a COMPLETE deterministic contract per sector.
 *  Immutable planning data (readonly) so a profile is never mutated at runtime. */
interface VerticalSubsectorRule {
  label: string;
  keywords: readonly string[];
}
interface VerticalProfileDefinition {
  businessModel: VerticalBusinessModel;
  subsectorDefault: string;
  subsectors: readonly VerticalSubsectorRule[];
  conversion: {
    goal: string;
    primaryAction: string;
    primaryCTA: string;
    secondaryCTA?: string;
    funnel: readonly string[];
  };
  trust: {
    drivers: readonly string[];
    sourceRequiredProof: readonly string[];
    forbiddenClaims: readonly string[];
  };
  sections: {
    required: readonly string[];
    recommended: readonly string[];
    forbidden: readonly VerticalForbiddenSection[];
  };
  visual: {
    realSourceRequired: readonly string[];
    aiIllustrativeAllowed: readonly string[];
    cssSvgPreferred: readonly string[];
    motionSuitable: readonly string[];
    forbiddenGenerated: readonly string[];
    heroRecommendation: string;
  };
  research: {
    recommended: boolean;
    angles: readonly string[];
    reason: string;
  };
  warnings: readonly string[];
}

/* ── Unicode-safe matching (Turkish letters aren't \w, so plain \b fails). ─── */
function vNormalize(s: string): string {
  return ` ${(s || '').toLowerCase().replace(/\s+/g, ' ').trim()} `;
}
function vWordRe(word: string): RegExp {
  // A trailing '*' marks an explicit Unicode-safe PREFIX/stem token (e.g.
  // 'manufactur*' → manufacturer/manufacturers/manufacturing). The '*' itself is
  // never matched. A stem needs a sensible minimum length (>= 4) so short,
  // ambiguous words ('ai', 'gem', 'car') can never be turned into broad prefixes;
  // a too-short stem falls back to an exact token match. Normal tokens stay exact.
  const isStem = word.endsWith('*');
  const base = isStem ? word.slice(0, -1) : word;
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Letter/number lookarounds keep Turkish letters inside the boundary.
  if (isStem && base.length >= 4) {
    return new RegExp(`(?<![\\p{L}\\p{N}])${esc}[\\p{L}\\p{N}]*(?![\\p{L}\\p{N}])`, 'iu');
  }
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'iu');
}
/** Count how many of `words` appear in `text` (deterministic; no global regex). */
function vCountMatches(text: string, words: readonly string[]): { hits: number; matched: string[] } {
  const low = vNormalize(text);
  let hits = 0;
  const matched: string[] = [];
  for (const w of words) {
    if (!w) continue;
    if (vWordRe(w).test(low)) { hits += 1; matched.push(w); }
  }
  return { hits, matched };
}

/* ── Signal keyword tables per INDUSTRY sector (software/marketplace handled by
 *  dedicated precedence below, but kept here for audience/operator scoring). ── */
type IndustrySector = Exclude<VerticalSector, 'general'>;
const VERTICAL_KEYWORDS: Record<IndustrySector, readonly string[]> = {
  // NOTE: tokens ending with '*' are Unicode-safe PREFIX/stem matches (plural /
  // inflected forms). Short, ambiguous words ('gold', 'gem', 'ring', 'car', 'spa')
  // are deliberately kept EXACT to avoid false positives.
  jewelry: ['jewelry', 'jewellery', 'jeweler*', 'jeweller*', 'goldsmith', 'gold', 'diamond', 'diamonds', 'gemstone', 'gem', 'ring', 'rings', 'necklace', 'bracelet', 'earring', 'earrings', 'pendant', 'engagement ring', 'wedding ring', 'bridal jewelry', 'watch', 'watches', 'karat', 'carat', 'mücevher', 'kuyumcu*', 'takı', 'altın', 'pırlanta', 'elmas', 'yüzük', 'kolye', 'bilezik', 'küpe', 'gümüş', 'alyans', 'saat'],
  landscaping: ['landscaping', 'landscape', 'landscaper*', 'garden', 'gardens', 'gardening', 'lawn', 'hardscape', 'hardscaping', 'patio', 'terrace', 'nursery', 'horticulture', 'irrigation', 'yard', 'outdoor', 'peyzaj', 'peyzajcı*', 'bahçe', 'bahçıvan*', 'çim', 'çevre düzenleme', 'yeşil alan', 'sulama', 'teras'],
  'automotive-dealership': ['dealer*', 'car dealer*', 'auto dealer*', 'used car', 'used cars', 'second-hand car', 'pre-owned', 'vehicle', 'vehicles', 'automotive', 'test drive', 'showroom', 'motors', 'oto galeri', 'galeri', 'galerici*', 'araba', 'araç', 'ikinci el araç', 'sıfır araç', 'otomotiv', 'test sürüşü', 'vasıta'],
  // Generic manufacturing stems ('manufactur*', 'üretici*', 'imalat*') are NOT
  // furniture-specific — they live ONLY in the furniture-manufacturer SUBSECTOR
  // rule, so "Medical device manufacturer" never scores as furniture. The sector is
  // identified by furniture-specific words; manufacturing words only refine the
  // subsector once furniture is already the sector.
  'furniture-interiors': ['furniture', 'furnishings', 'sofa', 'couch', 'armchair', 'cabinet', 'wardrobe', 'kitchen', 'interior', 'interiors', 'interior design', 'interior designer', 'decor', 'decoration', 'upholstery', 'joinery', 'carpentry', 'mobilya', 'mobilyacı*', 'koltuk', 'kanepe', 'dolap', 'mutfak', 'iç mimar', 'iç mimari', 'dekorasyon', 'ahşap', 'marangoz*', 'döşeme'],
  'restaurant-hospitality': ['restaurant*', 'cafe*', 'café', 'bistro', 'brasserie', 'diner', 'eatery', 'menu', 'dining', 'cuisine', 'bakery', 'patisserie', 'pastry', 'catering', 'coffee shop', 'chef', 'fine dining', 'restoran*', 'lokanta', 'kafe*', 'menü', 'mutfak', 'pastane', 'fırın', 'yemek', 'şef', 'kahve'],
  'real-estate': ['real estate', 'real-estate', 'realtor*', 'realty', 'property', 'properties', 'listing', 'listings', 'apartment', 'apartments', 'condo', 'housing', 'rental', 'rentals', 'lease', 'broker*', 'estate agent*', 'floor plan', 'emlak', 'emlakçı*', 'gayrimenkul', 'konut', 'daire', 'satılık', 'kiralık', 'arsa', 'müteahhit', 'kat planı'],
  'clinic-healthcare': ['clinic*', 'dental', 'dentist*', 'dentistry', 'orthodontic', 'doctor*', 'physician*', 'medical', 'healthcare', 'aesthetic', 'dermatolog*', 'physiotherapy', 'physio', 'therapy', 'therapist*', 'psychology', 'psychologist*', 'psychiatry', 'treatment', 'patient', 'polyclinic', 'klinik*', 'diş', 'diş hekimi', 'doktor*', 'tıp', 'sağlık', 'estetik', 'dermatoloji', 'fizyoterapi', 'terapi', 'psikolog', 'tedavi', 'hasta', 'poliklinik', 'muayenehane'],
  'ai-saas': ['ai', 'artificial intelligence', 'machine learning', 'llm', 'gpt', 'chatbot', 'chat bot', 'copilot', 'saas', 'software', 'platform', 'dashboard', 'crm', 'erp', 'api', 'sdk', 'automation', 'workflow', 'no-code', 'low-code', 'yapay zeka', 'yapay zekâ', 'yazılım', 'otomasyon', 'analitik'],
  marketplace: ['marketplace', 'market place', 'multi-vendor', 'multivendor', 'two-sided', 'classifieds', 'classified', 'vendors', 'buyers and sellers', 'pazaryeri', 'çok satıcılı', 'ilan sitesi', 'alıcı ve satıcı'],
  'portfolio-agency': ['portfolio', 'freelance', 'freelancer*', 'designer*', 'photographer*', 'photography', 'illustrator*', 'architect*', 'architecture', 'creative studio', 'design studio', 'agenc*', 'marketing agenc*', 'advertising', 'branding', 'production studio', 'case study', 'showreel', 'portfolyo', 'tasarımcı*', 'fotoğrafçı*', 'mimar', 'mimarlık', 'stüdyo', 'ajans*', 'reklam ajans*', 'markalaşma', 'prodüksiyon'],
  'local-service': ['plumber*', 'plumbing', 'electrician*', 'electrical', 'cleaning', 'cleaner*', 'barber*', 'hairdresser*', 'hair salon', 'beauty salon', 'salon', 'spa', 'repair', 'handyman', 'moving', 'movers', 'locksmith', 'painter', 'pest control', 'consulting', 'consultant*', 'tesisatçı*', 'elektrikçi*', 'temizlik', 'berber*', 'kuaför*', 'güzellik salonu', 'tamir', 'tamirci*', 'nakliyat*', 'çilingir', 'boyacı*', 'danışman*'],
};

/** Software/product signals — when present in the PRODUCT part of a "<product> for
 *  <vertical>" prompt, the software identity controls the primary sector. */
const VERTICAL_SOFTWARE_WORDS: readonly string[] = [
  'ai', 'a.i', 'artificial intelligence', 'machine learning', 'llm', 'gpt', 'chatbot', 'chat bot',
  'copilot', 'saas', 'software', 'platform', 'dashboard', 'analytics', 'crm', 'erp', 'api', 'sdk',
  'automation', 'automate', 'workflow', 'no-code', 'low-code', 'developer tool', 'dev tool', 'cli',
  'yapay zeka', 'yapay zekâ', 'yazılım', 'otomasyon', 'uygulama yazılımı',
];
/** Genuine two-sided / multi-vendor signals → the concept itself IS a marketplace. */
const VERTICAL_MARKETPLACE_WORDS: readonly string[] = [
  'marketplace', 'market place', 'multi-vendor', 'multivendor', 'two-sided', 'two sided',
  'buyers and sellers', 'classifieds', 'classified listings', 'vendors list', 'pazaryeri',
  'çok satıcılı', 'ilan sitesi', 'alıcı ve satıcı',
];
/** Marketplace-MANAGEMENT software signals → software used to operate/manage a
 *  marketplace (an `ai-saas` product), NOT the marketplace model itself. Kept
 *  PHRASE-level and narrow: bare 'management' / 'software' / 'platform' / 'admin'
 *  are deliberately NOT here, to avoid false positives. */
const VERTICAL_MARKETPLACE_TOOL_WORDS: readonly string[] = [
  'marketplace management', 'marketplace software', 'marketplace crm', 'marketplace analytics',
  'marketplace automation', 'marketplace admin', 'marketplace builder', 'marketplace platform software',
  'vendor management', 'seller management', 'multi-vendor management', 'multivendor management',
  'management software', 'management platform', 'pazaryeri yönetim', 'pazaryeri yazılım',
  'satıcı yönetim',
];

/** Direct sector votes from the deterministic InferredBrief industry key. */
const SECTOR_FROM_INFERRED: Record<string, VerticalSector> = {
  ai_saas: 'ai-saas',
  landscaping: 'landscaping',
  furniture: 'furniture-interiors',
  automotive: 'automotive-dealership',
  restaurant: 'restaurant-hospitality',
  portfolio: 'portfolio-agency',
  agency: 'portfolio-agency',
  fitness: 'local-service',
  local_service: 'local-service',
  ecommerce: 'marketplace',
  generic: 'general',
};
/** Direct sector votes from the Experience Blueprint site experience type. */
const SECTOR_FROM_EXPERIENCE: Partial<Record<SiteExperienceType, VerticalSector>> = {
  restaurant: 'restaurant-hospitality',
  'local-business': 'local-service',
  portfolio: 'portfolio-agency',
  'agency-service': 'portfolio-agency',
  marketplace: 'marketplace',
  'developer-tool': 'ai-saas',
  'dashboard-preview': 'ai-saas',
  'b2b-product-landing': 'ai-saas',
  'consumer-product-landing': 'ai-saas',
};
/** Map the Concept Authority / ledger primary concept category → a sector vote. */
const SECTOR_FROM_CONCEPT: Record<string, VerticalSector> = {
  ai: 'ai-saas',
  saas: 'ai-saas',
  marketplace: 'marketplace',
  hospitality: 'restaurant-hospitality',
  landscaping: 'landscaping',
  medical: 'clinic-healthcare',
  real_estate: 'real-estate',
  portfolio: 'portfolio-agency',
  local_service: 'local-service',
};

/** Split a prompt into product vs target-vertical on the "<product> for <vertical>"
 *  (EN) / "<vertical> için <product>" (TR) grammar. Pure + deterministic. */
function vSplitProductVertical(prompt: string): { product: string; vertical: string; hadSplit: boolean } {
  const p = ` ${(prompt || '').toLowerCase().replace(/\s+/g, ' ').trim()} `;
  const trIdx = p.indexOf(' için ');
  if (trIdx >= 0) return { product: p.slice(trIdx + 6).trim(), vertical: p.slice(0, trIdx).trim(), hadSplit: true };
  const enIdx = p.indexOf(' for ');
  if (enIdx >= 0) return { product: p.slice(0, enIdx).trim(), vertical: p.slice(enIdx + 5).trim(), hadSplit: true };
  return { product: p.trim(), vertical: '', hadSplit: false };
}

/** Detect the sector's subsector from the winning-sector profile over the text. */
function vDetectSubsector(profile: VerticalProfileDefinition, text: string): string {
  for (const rule of profile.subsectors) {
    if (vCountMatches(text, rule.keywords).hits > 0) return rule.label;
  }
  return profile.subsectorDefault;
}

/* ── Complete, immutable sector profiles ──────────────────────────────────────
 * Each sector carries a FULL contract (business/conversion/trust/section/visual/
 * research). Content is English-canonical planning data (a machine-readable
 * contract for Phase 11B + owner diagnostics); the artifact's narrative summary /
 * warnings / research reason are localized at derive time. Nothing here fabricates
 * proof: every "real-source" item requires genuine user/source material and every
 * "forbidden" item is an anti-fabrication guard. */
const VERTICAL_PROFILES: Record<VerticalSector, VerticalProfileDefinition> = {
  jewelry: {
    businessModel: 'catalog-consultation',
    subsectorDefault: 'jewelry-retail',
    subsectors: [
      { label: 'luxury-jewelry', keywords: ['luxury', 'fine jewelry', 'haute', 'high-end', 'lüks'] },
      { label: 'custom-jewelry', keywords: ['custom', 'bespoke', 'handmade', 'özel tasarım', 'el yapımı'] },
      { label: 'bridal-jewelry', keywords: ['bridal', 'engagement', 'wedding', 'nişan', 'alyans', 'gelin'] },
      { label: 'watch-showroom', keywords: ['watch', 'watches', 'saat'] },
      { label: 'gold-jewelry', keywords: ['gold', 'altın', 'goldsmith', 'kuyumcu'] },
    ],
    conversion: {
      goal: 'Drive collection browsing and showroom/consultation requests for real pieces',
      primaryAction: 'Browse the collection or book a consultation',
      primaryCTA: 'Browse Collections', secondaryCTA: 'Book a Consultation',
      funnel: ['Land on collection story', 'Browse collections', 'View a piece', 'Ask about it / book a consultation', 'Visit showroom'],
    },
    trust: {
      drivers: ['Material authenticity', 'Craftsmanship', 'Warranty & care', 'Real store & showroom identity', 'Certification when provided'],
      sourceRequiredProof: ['Actual product photography', 'Actual inventory', 'Authenticity certificates', 'Material/hallmark documentation', 'Store/showroom photography', 'Real craftsmanship/production imagery'],
      forbiddenClaims: ['Fabricated authenticity certificates', 'Invented material purity/karat', 'Fake prices or live stock', 'Generated jewelry presented as real inventory'],
    },
    sections: {
      required: ['Hero', 'Collections', 'Featured Pieces', 'Craftsmanship & Materials', 'Care & Warranty', 'Visit / Consultation', 'Store & Contact'],
      recommended: ['About / Heritage', 'Bespoke / Custom', 'Certifications (only if provided)'],
      forbidden: [
        { section: 'SaaS Pricing Plans', reason: 'A jewelry catalog is not a subscription product.' },
        { section: 'Dashboard / Analytics', reason: 'No software surface belongs on a jewelry site.' },
        { section: 'Software Integrations', reason: 'Not relevant to a jewelry retailer.' },
        { section: 'Fake logo strip', reason: 'No real partner/customer logos to show.' },
        { section: 'Fake stock / sales counters', reason: 'Live counts would be fabricated.' },
      ],
    },
    visual: {
      realSourceRequired: ['Sellable product photography', 'Actual inventory', 'Authenticity certificates', 'Store/showroom photography', 'Craftsmanship/production imagery'],
      aiIllustrativeAllowed: ['Luxury metallic textures', 'Light reflections', 'Abstract metallic forms', 'Atmospheric editorial backgrounds', 'Brand mood imagery'],
      cssSvgPreferred: ['Collection grid layout', 'Care/warranty iconography', 'Editorial dividers'],
      motionSuitable: ['Subtle hero light shimmer', 'Soft collection card reveals', 'Calm ambient background drift'],
      forbiddenGenerated: ['Generated sellable jewelry as inventory', 'Fabricated authenticity certificates', 'Fabricated material purity/prices/stock'],
      heroRecommendation: 'Editorial hero with real product photography (or an abstract luxury metallic/light treatment when no product photos are provided) — never generated jewelry presented as real stock.',
    },
    research: {
      recommended: true,
      angles: ['Category expectations for fine jewelry', 'Trust & authenticity requirements', 'Sector-specific visual conventions', 'Common CTA language', 'Proof-sensitive claims (materials/certification)'],
      reason: 'A live sector scan would validate authenticity/craftsmanship conventions and category CTA language.',
    },
    warnings: ['Never present AI-generated jewelry as real, sellable inventory.'],
  },

  landscaping: {
    businessModel: 'quote-led-service',
    subsectorDefault: 'landscape-services',
    subsectors: [
      { label: 'landscape-design', keywords: ['design', 'tasarım'] },
      { label: 'garden-maintenance', keywords: ['maintenance', 'upkeep', 'bakım'] },
      { label: 'hardscape', keywords: ['hardscape', 'patio', 'paving', 'taş'] },
      { label: 'commercial-landscaping', keywords: ['commercial', 'ticari'] },
      { label: 'residential-landscaping', keywords: ['residential', 'home garden', 'konut', 'ev bahçe'] },
    ],
    conversion: {
      goal: 'Turn interest into consultation/quote requests backed by real project work',
      primaryAction: 'Request a quote or consultation',
      primaryCTA: 'Get a Quote', secondaryCTA: 'View Projects',
      funnel: ['Land on transformation story', 'View real projects', 'Understand process/materials', 'Request a consultation', 'Book a site visit'],
    },
    trust: {
      drivers: ['Real completed projects', 'Service area', 'Materials & process', 'Genuine before/after', 'Real team/business identity'],
      sourceRequiredProof: ['Project photos', 'Completed gardens', 'Before/after images', 'Client property photos', 'Real team', 'Real materials/workmanship'],
      forbiddenClaims: ['Fabricated completed projects', 'Fabricated customer properties', 'Fake before/after evidence', 'Invented awards or certifications'],
    },
    sections: {
      required: ['Hero', 'Services', 'Projects / Before & After', 'Materials & Process', 'Service Area', 'Get a Quote / Contact'],
      recommended: ['About / Team', 'Gallery', 'Reviews (only if provided)'],
      forbidden: [
        { section: 'SaaS Pricing Plans', reason: 'A landscaping service is quote-led, not subscription-priced.' },
        { section: 'Product Dashboard', reason: 'No software surface belongs on a landscaping site.' },
        { section: 'Software Integrations', reason: 'Not relevant to a landscaping business.' },
        { section: 'Security & Compliance', reason: 'A SaaS security section does not fit this business.' },
        { section: 'Fake project counts', reason: 'Project totals would be fabricated without real data.' },
        { section: 'Fake before/after results', reason: 'Before/after needs genuine user-provided material.' },
      ],
    },
    visual: {
      realSourceRequired: ['Project photos', 'Completed gardens', 'Before/after images', 'Client properties', 'Real team', 'Real materials/workmanship'],
      aiIllustrativeAllowed: ['Botanical atmosphere', 'Abstract natural texture', 'Mood backgrounds', 'Non-literal landscape concepts'],
      cssSvgPreferred: ['Service/process diagram', 'Service-area map motif', 'Step-by-step process rail'],
      motionSuitable: ['Calm organic hero drift', 'Illustrative before/after reveal (labelled)', 'Process step progression'],
      forbiddenGenerated: ['Fabricated completed projects', 'Fabricated customer properties', 'Fake before/after evidence', 'Invented awards/certifications'],
      heroRecommendation: 'Warm hero with a real completed-project photo (or a botanical/atmospheric AI-illustrative background when none is provided) — before/after only with genuine material.',
    },
    research: {
      recommended: true,
      angles: ['Common conversion patterns for local services', 'Trust & credibility requirements', 'Sector-specific visual conventions', 'Local/regional buying concerns', 'Common CTA language'],
      reason: 'A live sector scan would validate quote-led conversion patterns and regional expectations.',
    },
    warnings: ['Before/after and completed projects require genuine user-provided material — never fabricate them.'],
  },

  'automotive-dealership': {
    businessModel: 'inventory-led-sales',
    subsectorDefault: 'car-dealership',
    subsectors: [
      { label: 'used-car-dealership', keywords: ['used', 'second-hand', 'pre-owned', 'ikinci el'] },
      { label: 'new-vehicle-dealership', keywords: ['new', 'brand new', 'sıfır'] },
      { label: 'premium-dealership', keywords: ['premium', 'luxury', 'prestige', 'lüks'] },
      { label: 'commercial-vehicle-dealer', keywords: ['commercial', 'truck', 'van', 'ticari', 'kamyon'] },
    ],
    conversion: {
      goal: 'Drive vehicle inquiries and test-drive bookings against real inventory',
      primaryAction: 'View inventory and enquire about a vehicle',
      primaryCTA: 'View Inventory', secondaryCTA: 'Book a Test Drive',
      funnel: ['Land on featured inventory', 'Browse vehicles', 'View a listing', 'Ask about this vehicle', 'Book a test drive / contact dealer'],
    },
    trust: {
      drivers: ['Real vehicle inventory', 'Mileage & model year', 'Condition & inspection', 'Service history', 'Financing/warranty when supplied', 'Dealership location & identity'],
      sourceRequiredProof: ['Real listing images', 'Real inventory fields', 'Inspection reports', 'Warranty details when supplied', 'Vehicle documents where appropriate'],
      forbiddenClaims: ['Generated vehicles as inventory', 'Fabricated availability', 'Fabricated mileage/history', 'Fabricated financing offers', 'Fake live stock/sold/reserved states'],
    },
    sections: {
      required: ['Hero', 'Featured Inventory', 'Vehicle Details', 'Financing & Trust', 'Inspection / Warranty (when supplied)', 'Dealership & Contact'],
      recommended: ['About', 'How Buying Works', 'Trade-in / Enquiry'],
      forbidden: [
        { section: 'SaaS Pricing Cards', reason: 'A dealership sells vehicles, not subscriptions.' },
        { section: 'Generic Product Dashboard', reason: 'No software dashboard belongs here.' },
        { section: 'Unrelated Case Studies', reason: 'Software-style case studies do not fit a dealership.' },
        { section: 'Fake live inventory numbers', reason: 'Live stock counts would be fabricated.' },
        { section: 'Fake reviews or awards', reason: 'No verified reviews/awards to claim.' },
      ],
    },
    visual: {
      realSourceRequired: ['Listing images', 'Real vehicles', 'Real inventory fields', 'Inspection reports', 'Warranty/vehicle documents'],
      aiIllustrativeAllowed: ['Ambient showroom atmosphere', 'Abstract motion/road texture backgrounds', 'Brand mood imagery'],
      cssSvgPreferred: ['Inventory grid + filters', 'Financing calculator mockup (illustrative)', 'Vehicle spec/detail layout'],
      motionSuitable: ['Subtle inventory filter transitions', 'Calm hero ambience', 'Soft listing card reveals'],
      forbiddenGenerated: ['Generated vehicles as inventory', 'Fabricated mileage/history', 'Fabricated financing offers', 'Fake live stock/sold states'],
      heroRecommendation: 'Hero anchored on real featured-vehicle photography (or an ambient automotive atmosphere when no photos are provided) — never generated cars presented as available stock.',
    },
    research: {
      recommended: true,
      angles: ['Expected listing fields for vehicles', 'Trust & credibility requirements', 'Common conversion patterns (test drive/enquiry)', 'Local/regional buying concerns', 'Regulated-content risks (financing)'],
      reason: 'A live sector scan would validate expected listing fields and financing/trust conventions.',
    },
    warnings: ['Inventory, mileage, history and financing must come from real data — never generate cars as stock.'],
  },

  'furniture-interiors': {
    businessModel: 'catalog-showroom',
    subsectorDefault: 'furniture-showroom',
    subsectors: [
      { label: 'furniture-manufacturer', keywords: ['manufactur*', 'factory', 'üretim', 'üretici*', 'imalat*', 'fabrika'] },
      { label: 'custom-furniture', keywords: ['custom', 'bespoke', 'özel'] },
      { label: 'interior-design-studio', keywords: ['interior design', 'iç mimar', 'iç mimari'] },
      { label: 'kitchen-manufacturer', keywords: ['kitchen', 'mutfak'] },
      { label: 'office-furniture', keywords: ['office', 'ofis'] },
      { label: 'luxury-furniture', keywords: ['luxury', 'premium', 'lüks'] },
    ],
    conversion: {
      goal: 'Drive collection browsing, showroom visits and project/quote inquiries',
      primaryAction: 'Browse collections or start a project',
      primaryCTA: 'Browse Collections', secondaryCTA: 'Request a Quote',
      funnel: ['Land on collection story', 'Browse collections', 'Explore materials', 'Visit showroom / request a quote', 'Start a project'],
    },
    trust: {
      drivers: ['Real products', 'Materials & dimensions', 'Craftsmanship & manufacturing', 'Completed installations', 'Showroom identity'],
      sourceRequiredProof: ['Product photography', 'Catalog items', 'Completed projects', 'Materials', 'Showroom', 'Manufacturing', 'Real interiors'],
      forbiddenClaims: ['Generated furniture as available inventory', 'Fabricated dimensions/materials/prices', 'Fabricated completed interiors'],
    },
    sections: {
      required: ['Hero', 'Collections', 'Materials', 'Craftsmanship / Manufacturing', 'Completed Projects', 'Visit Showroom / Start a Project'],
      recommended: ['About', 'Custom / Bespoke', 'Care & Delivery'],
      forbidden: [
        { section: 'SaaS Pricing Plans', reason: 'A furniture catalog is not a subscription product.' },
        { section: 'Product Dashboard', reason: 'No software surface belongs on a furniture site.' },
        { section: 'Software Integrations', reason: 'Not relevant to a furniture business.' },
        { section: 'Fake stock counters', reason: 'Live inventory counts would be fabricated.' },
      ],
    },
    visual: {
      realSourceRequired: ['Product photography', 'Catalog items', 'Completed projects', 'Materials', 'Showroom', 'Manufacturing', 'Real interiors'],
      aiIllustrativeAllowed: ['Material textures', 'Abstract interior compositions', 'Editorial lighting', 'Atmospheric backgrounds', 'Conceptual spatial mood'],
      cssSvgPreferred: ['Collection/catalog grid', 'Material swatch system', 'Dimension/spec layout'],
      motionSuitable: ['Soft collection card reveals', 'Calm editorial hero ambience', 'Gentle material swatch transitions'],
      forbiddenGenerated: ['Generated furniture as available inventory', 'Fabricated dimensions/materials/prices', 'Fabricated completed interiors'],
      heroRecommendation: 'Editorial hero with real product/interior photography (or material-texture/atmospheric AI-illustrative art when none is provided) — never generated furniture presented as real catalog stock.',
    },
    research: {
      recommended: true,
      angles: ['Expected product fields (materials/dimensions)', 'Category expectations', 'Sector-specific visual conventions', 'Common CTA language', 'User decision factors'],
      reason: 'A live sector scan would validate catalog/showroom conventions and expected product fields.',
    },
    warnings: ['Catalog products, dimensions and completed interiors require real material — never fabricate them.'],
  },

  'restaurant-hospitality': {
    businessModel: 'reservation-led',
    subsectorDefault: 'restaurant',
    subsectors: [
      { label: 'cafe', keywords: ['cafe', 'café', 'coffee', 'kafe', 'kahve'] },
      { label: 'bakery-patisserie', keywords: ['bakery', 'patisserie', 'pastry', 'pastane', 'fırın'] },
      { label: 'fine-dining', keywords: ['fine dining', 'gourmet', 'michelin', 'gurme'] },
      { label: 'bistro', keywords: ['bistro', 'brasserie'] },
      { label: 'hotel-restaurant', keywords: ['hotel', 'otel'] },
      { label: 'catering', keywords: ['catering'] },
    ],
    conversion: {
      goal: 'Drive reservations and location visits around a real menu and venue',
      primaryAction: 'Reserve a table or view the menu',
      primaryCTA: 'Reserve a Table', secondaryCTA: 'View Menu',
      funnel: ['Land on venue atmosphere', 'View menu', 'See location & hours', 'Reserve a table / get directions', 'Visit'],
    },
    trust: {
      drivers: ['Real menu', 'Real location & hours', 'Real dishes', 'Venue atmosphere', 'Real booking/contact details'],
      sourceRequiredProof: ['Food photography', 'Venue photography', 'Menu items', 'Chef/team when supplied', 'Location', 'Opening hours'],
      forbiddenClaims: ['Fake menu dishes presented as served', 'Fabricated prices', 'Fabricated reservation availability', 'Fabricated reviews', 'Fabricated awards / Michelin recognition'],
    },
    sections: {
      required: ['Hero', 'Menu', 'Location', 'Hours', 'Reservation / Contact', 'Gallery'],
      recommended: ['About', 'Events', 'Chef / Team (only if provided)'],
      forbidden: [
        { section: 'SaaS Pricing', reason: 'A restaurant is not a subscription product.' },
        { section: 'Software Integrations', reason: 'Not relevant to a restaurant.' },
        { section: 'Security & Compliance', reason: 'A SaaS security section does not fit a restaurant.' },
        { section: 'Chat / Dashboard Demo', reason: 'No product demo belongs on a restaurant site.' },
        { section: 'Fake live booking status', reason: 'Live availability would be fabricated.' },
      ],
    },
    visual: {
      realSourceRequired: ['Food photography', 'Venue photography', 'Menu items', 'Chef/team', 'Location', 'Opening hours'],
      aiIllustrativeAllowed: ['Ambient culinary mood', 'Warm texture backgrounds', 'Abstract atmosphere', 'Non-literal background art'],
      cssSvgPreferred: ['Menu layout', 'Hours/location card', 'Reservation form (front-end)'],
      motionSuitable: ['Soft menu reveal', 'Calm ambient hero drift', 'Gentle gallery transitions'],
      forbiddenGenerated: ['Fake dishes presented as served', 'Fabricated prices', 'Fabricated reservation availability', 'Fabricated reviews/awards'],
      heroRecommendation: 'Warm hero with real food/venue photography (or an ambient culinary AI-illustrative mood when none is provided) — never generated dishes presented as actually served.',
    },
    research: {
      recommended: true,
      angles: ['Category expectations for dining', 'Common conversion patterns (reservation)', 'Sector-specific visual conventions', 'Local buying concerns', 'Common CTA language'],
      reason: 'A live sector scan would validate reservation conventions and menu presentation norms.',
    },
    warnings: ['Menu dishes, prices and availability require real material — never fabricate them.'],
  },

  'real-estate': {
    businessModel: 'listing-lead-generation',
    subsectorDefault: 'real-estate-agency',
    subsectors: [
      { label: 'residential-agency', keywords: ['residential', 'home', 'konut', 'ev'] },
      { label: 'commercial-real-estate', keywords: ['commercial', 'office', 'ticari', 'ofis'] },
      { label: 'property-developer', keywords: ['developer', 'development', 'müteahhit', 'proje'] },
      { label: 'luxury-real-estate', keywords: ['luxury', 'premium', 'lüks'] },
      { label: 'rental-agency', keywords: ['rental', 'rent', 'lease', 'kiralık', 'kiralama'] },
      { label: 'property-valuation', keywords: ['valuation', 'appraisal', 'değerleme', 'ekspertiz'] },
    ],
    conversion: {
      goal: 'Generate listing leads, viewings and valuation requests against real properties',
      primaryAction: 'View listings or schedule a viewing',
      primaryCTA: 'View Listings', secondaryCTA: 'Schedule a Viewing',
      funnel: ['Land on featured listings', 'Browse listings', 'View a property', 'Schedule a viewing / contact agent', 'Request a valuation'],
    },
    trust: {
      drivers: ['Real listings & locations', 'Agent identity & local expertise', 'Property details', 'Legal/property info when supplied', 'Real office details'],
      sourceRequiredProof: ['Listing photos', 'Property information', 'Floor plans', 'Agent/team photos', 'Property location', 'Licenses/credentials when relevant'],
      forbiddenClaims: ['Fake properties as available listings', 'Fabricated prices/availability', 'Fabricated floor plans', 'Fabricated agent awards', 'Fabricated transaction counts', 'Neighborhood data stated as fact without source'],
    },
    sections: {
      required: ['Hero', 'Featured Listings', 'Property Details', 'Agent / Team', 'Locations / Areas', 'Schedule a Viewing / Contact'],
      recommended: ['About', 'Valuation Request', 'How Buying/Renting Works'],
      forbidden: [
        { section: 'SaaS Pricing', reason: 'A real-estate agency is not a subscription product.' },
        { section: 'Fake sold counts', reason: 'Transaction totals would be fabricated.' },
        { section: 'Fake awards', reason: 'No verified awards to claim.' },
        { section: 'Unsupported testimonials', reason: 'No real testimonials to show.' },
        { section: 'Product Dashboard', reason: 'No software dashboard belongs here.' },
      ],
    },
    visual: {
      realSourceRequired: ['Listing photos', 'Property information', 'Floor plans', 'Agent/team photos', 'Property/project location', 'Licenses/credentials'],
      aiIllustrativeAllowed: ['Ambient neighbourhood atmosphere', 'Abstract architectural texture', 'Brand mood backgrounds'],
      cssSvgPreferred: ['Listing grid + filters', 'Map/area motif', 'Property detail layout', 'Floor-plan placeholder (illustrative)'],
      motionSuitable: ['Subtle listing filter transitions', 'Calm hero ambience', 'Soft listing card reveals'],
      forbiddenGenerated: ['Fake properties as available listings', 'Fabricated prices/availability', 'Fabricated floor plans', 'Fabricated transaction counts'],
      heroRecommendation: 'Hero anchored on real featured-property photography (or an ambient architectural atmosphere when none is provided) — never generated properties presented as real listings.',
    },
    research: {
      recommended: true,
      angles: ['Expected listing fields for property', 'Trust & credibility requirements', 'Regulated-content risks', 'Local/regional buying concerns', 'Common CTA language'],
      reason: 'A live sector scan would validate expected listing fields and regional trust conventions.',
    },
    warnings: ['Listings, prices, availability and floor plans require real data — never fabricate them.'],
  },

  'clinic-healthcare': {
    businessModel: 'appointment-led',
    subsectorDefault: 'medical-clinic',
    subsectors: [
      { label: 'dental-clinic', keywords: ['dental', 'dentist', 'dentistry', 'orthodontic', 'diş'] },
      { label: 'aesthetic-clinic', keywords: ['aesthetic', 'cosmetic', 'estetik'] },
      { label: 'physiotherapy', keywords: ['physiotherapy', 'physio', 'fizyoterapi'] },
      { label: 'therapy', keywords: ['therapy', 'therapist', 'terapi'] },
      { label: 'psychology', keywords: ['psychology', 'psychologist', 'psikolog', 'psikoloji'] },
      { label: 'dermatology', keywords: ['dermatology', 'dermatolog', 'cilt'] },
      { label: 'general-clinic', keywords: ['clinic', 'polyclinic', 'klinik', 'poliklinik'] },
    ],
    conversion: {
      goal: 'Drive appointment and consultation requests with clear, honest treatment info',
      primaryAction: 'Book an appointment or request a consultation',
      primaryCTA: 'Book an Appointment', secondaryCTA: 'View Treatments',
      funnel: ['Land on clinic overview', 'View treatments', 'Meet the team', 'Book an appointment / request a consultation', 'Visit the clinic'],
    },
    trust: {
      drivers: ['Real practitioners & qualifications', 'Real clinic', 'Treatment clarity', 'Safety information', 'Genuine contact/location', 'Credentials when supplied'],
      sourceRequiredProof: ['Practitioners', 'Team', 'Clinic/facility', 'Medical equipment where appropriate', 'Credentials/certificates', 'Real treatment info', 'Before/after only when genuinely provided and appropriate'],
      forbiddenClaims: ['Fabricated patient results', 'Fabricated before/after outcomes', 'Fabricated doctors/credentials', 'Fabricated medical certificates', 'Guaranteed results', 'Fake patient testimonials', 'Unsupported medical claims'],
    },
    sections: {
      required: ['Hero', 'Treatments / Services', 'Meet the Team', 'Clinic / Facility', 'Safety & Approach', 'Book an Appointment / Contact'],
      recommended: ['About', 'FAQ', 'Credentials (only if supplied)'],
      forbidden: [
        { section: 'Ecommerce Catalog', reason: 'A clinic is appointment-led, not a store (unless explicitly relevant).' },
        { section: 'SaaS Demo', reason: 'No product demo belongs on a clinic site.' },
        { section: 'Software-style Pricing Tiers', reason: 'Treatments are not software subscriptions.' },
        { section: 'Fake medical outcomes', reason: 'Patient results would be fabricated.' },
        { section: 'Unsupported testimonial walls', reason: 'No real patient testimonials to show.' },
        { section: 'Fake live appointment availability', reason: 'Live availability would be fabricated.' },
      ],
    },
    visual: {
      realSourceRequired: ['Practitioners', 'Team', 'Clinic/facility', 'Medical equipment', 'Credentials/certificates', 'Real treatment info', 'Before/after only when genuinely provided'],
      aiIllustrativeAllowed: ['Calm clinical atmosphere', 'Abstract wellbeing texture', 'Soft brand mood backgrounds', 'Non-literal care imagery'],
      cssSvgPreferred: ['Treatment list layout', 'Safety/approach iconography', 'Appointment form (front-end)'],
      motionSuitable: ['Calm hero ambience', 'Soft treatment card reveals', 'Gentle section transitions'],
      forbiddenGenerated: ['Fabricated patient results/before-after', 'Fabricated doctors/credentials/certificates', 'Guaranteed-result claims', 'Fake patient testimonials'],
      heroRecommendation: 'Calm, reassuring hero with real clinic/team photography (or an abstract wellbeing AI-illustrative atmosphere when none is provided) — never generated patients, results or credentials.',
    },
    research: {
      recommended: true,
      angles: ['Category expectations for clinics', 'Trust & credibility requirements', 'Regulated-content risks', 'Proof-sensitive claims (results/credentials)', 'Common CTA language'],
      reason: 'A live sector scan would validate appointment conventions and regulated medical-claim boundaries.',
    },
    warnings: ['Medical results, before/after, doctors and credentials must be genuine — never fabricate them or guarantee outcomes.'],
  },

  'ai-saas': {
    businessModel: 'subscription-product',
    subsectorDefault: 'b2b-saas',
    subsectors: [
      { label: 'chatbot', keywords: ['chatbot', 'chat bot', 'support bot', 'sohbet botu', 'destek botu'] },
      { label: 'developer-tool', keywords: ['developer', 'dev tool', 'cli', 'sdk', 'geliştirici'] },
      { label: 'ai-product', keywords: ['ai', 'artificial intelligence', 'llm', 'gpt', 'yapay zeka'] },
      { label: 'analytics-product', keywords: ['analytics', 'dashboard', 'reporting', 'analitik'] },
      { label: 'automation-platform', keywords: ['automation', 'workflow', 'automate', 'otomasyon'] },
      { label: 'crm', keywords: ['crm', 'sales platform', 'müşteri ilişkileri'] },
      { label: 'api-product', keywords: ['api', 'sdk'] },
      { label: 'consumer-software', keywords: ['consumer', 'personal app'] },
    ],
    conversion: {
      goal: 'Drive product evaluation toward a demo/trial/contact-sales conversion',
      primaryAction: 'Try the demo or book a demo',
      primaryCTA: 'Book a Demo', secondaryCTA: 'See How It Works',
      funnel: ['Land on product value', 'See how it works', 'Explore the (front-end) demo', 'Start free / book a demo', 'Contact sales'],
    },
    trust: {
      drivers: ['Product clarity', 'Workflow clarity', 'Integration clarity', 'Security posture', 'Support process', 'Transparent limits', 'Real compliance only when supplied'],
      sourceRequiredProof: ['Real product screenshots', 'Real customer logos', 'Real metrics/user counts', 'Real compliance badges (SOC2/ISO)', 'Real testimonials', 'Real uptime/analytics'],
      forbiddenClaims: ['Fake screenshots as real UI', 'Fake customer logos', 'Fake metrics/user counts', 'Fake SOC2/ISO/security badges', 'Fake testimonials', 'Fake uptime', 'Fake live activity/analytics'],
    },
    sections: {
      required: ['Hero', 'How it works', 'Product Demo (front-end)', 'Features by job', 'Integrations', 'Security & Trust', 'Contact Sales / Book Demo'],
      recommended: ['Pricing', 'FAQ', 'Use Cases', 'Docs / Quickstart'],
      forbidden: [
        { section: 'Fake customer logo strip', reason: 'No real customer logos to show.' },
        { section: 'Fake metrics / certifications', reason: 'No verified metrics or SOC2/ISO to claim.' },
        { section: 'Fake screenshots as real UI', reason: 'UI must be a labelled CSS/SVG mockup unless real material exists.' },
        { section: 'Fake testimonials', reason: 'No real testimonials to show.' },
      ],
    },
    visual: {
      realSourceRequired: ['Real product screenshots', 'Real customer logos', 'Real compliance badges', 'Real metrics', 'Real testimonials'],
      aiIllustrativeAllowed: ['Abstract AI visuals', 'Ambient product glow', 'Concept/atmosphere backgrounds', 'Visual metaphors'],
      cssSvgPreferred: ['Product UI mockups', 'Workflow diagrams', 'Chat flows', 'Integration maps', 'Product architecture diagrams', 'State transitions'],
      motionSuitable: ['Restrained ambient motion', 'Gently floating product cards', 'Sample chat typing (front-end)', 'Staged flow/timeline progress'],
      forbiddenGenerated: ['Fake screenshots as real UI', 'Fake customer logos', 'Fake metrics/user counts', 'Fake SOC2/ISO/security badges', 'Fake live activity'],
      heroRecommendation: 'Product hero with a CSS/SVG illustrative UI mockup (labelled as a front-end preview) + abstract AI ambience — never a fake screenshot presented as the real product.',
    },
    research: {
      recommended: true,
      angles: ['Competitor information architecture', 'Category-specific UX patterns', 'Common conversion patterns (demo/trial)', 'Market-specific terminology', 'Common CTA language'],
      reason: 'A live sector scan would validate product-page IA and category conversion patterns.',
    },
    warnings: ['Product UI must be described as a CSS/SVG front-end mockup — never claim real screenshots, logos, metrics or compliance without real material.'],
  },

  marketplace: {
    businessModel: 'two-sided-marketplace',
    subsectorDefault: 'marketplace',
    subsectors: [
      { label: 'product-marketplace', keywords: ['product', 'goods', 'ürün'] },
      { label: 'service-marketplace', keywords: ['service', 'services', 'hizmet'] },
      { label: 'property-marketplace', keywords: ['property', 'real estate', 'emlak'] },
      { label: 'automotive-marketplace', keywords: ['car', 'vehicle', 'araç', 'araba'] },
      { label: 'freelancer-marketplace', keywords: ['freelancer', 'talent', 'freelance'] },
      { label: 'classified-listings', keywords: ['classified', 'listings', 'ilan'] },
    ],
    conversion: {
      goal: 'Drive browsing/listing and account signup across a two-sided model',
      primaryAction: 'Browse listings or start selling',
      primaryCTA: 'Browse Listings', secondaryCTA: 'Start Selling',
      funnel: ['Land on value for both sides', 'Browse listings', 'Search/filter', 'Create an account', 'List an item / start a transaction'],
    },
    trust: {
      drivers: ['Transaction clarity', 'Listing quality', 'Moderation & safety', 'Verification', 'Dispute/support process', 'Transparent fees when supplied'],
      sourceRequiredProof: ['Real listings', 'Real listing media', 'Seller information', 'Inventory/data', 'Real transaction terms'],
      forbiddenClaims: ['Fabricated listings', 'Fabricated sellers/buyers', 'Fake live listing counts', 'Fake transaction volume', 'Fabricated reviews', 'Fabricated inventory'],
    },
    sections: {
      required: ['Hero', 'Catalog / Listings', 'Search & Filters', 'How it works', 'Trust & Safety', 'Sign up / List an Item'],
      recommended: ['Seller / Buyer value', 'Categories', 'Fees (only if supplied)'],
      forbidden: [
        { section: 'Fake live listing counts', reason: 'Live listing/transaction counts would be fabricated.' },
        { section: 'Fabricated reviews', reason: 'No real reviews to show.' },
        { section: 'Fabricated inventory', reason: 'Listings require real seller data.' },
        { section: 'SaaS security compliance badges (fake)', reason: 'No verified compliance to claim.' },
      ],
    },
    visual: {
      realSourceRequired: ['Real listings', 'Real listing media', 'Seller information', 'Inventory/data', 'Real transaction terms'],
      aiIllustrativeAllowed: ['Abstract network/atmosphere backgrounds', 'Brand mood imagery', 'Non-literal category art'],
      cssSvgPreferred: ['Marketplace flow diagram', 'Search/filter interaction', 'Seller onboarding flow', 'Transaction process', 'Listing card system', 'Category browsing'],
      motionSuitable: ['Subtle filter/list transitions', 'Soft listing card reveals', 'Calm hero ambience'],
      forbiddenGenerated: ['Fabricated listings/sellers/buyers', 'Fake live listing counts', 'Fake transaction volume', 'Fabricated reviews/inventory'],
      heroRecommendation: 'Hero explaining both sides with a CSS/SVG listing-card/flow system (illustrative) — never fabricated listings, sellers or live counts.',
    },
    research: {
      recommended: true,
      angles: ['Expected listing fields', 'Competitor information architecture', 'Trust & safety requirements', 'Common conversion patterns (list/browse/signup)', 'Common CTA language'],
      reason: 'A live sector scan would validate two-sided IA, expected listing fields and trust/safety norms.',
    },
    warnings: ['Listings, sellers, counts and reviews require real data — never fabricate the two-sided content.'],
  },

  'portfolio-agency': {
    businessModel: 'project-inquiry',
    subsectorDefault: 'portfolio',
    subsectors: [
      { label: 'creative-portfolio', keywords: ['creative', 'artist', 'sanatçı'] },
      { label: 'developer-portfolio', keywords: ['developer', 'engineer', 'yazılımcı'] },
      { label: 'photographer-portfolio', keywords: ['photograph', 'fotoğraf'] },
      { label: 'architecture-portfolio', keywords: ['architect', 'mimar'] },
      { label: 'design-studio', keywords: ['design studio', 'studio', 'stüdyo'] },
      { label: 'marketing-agency', keywords: ['marketing', 'advertising', 'reklam', 'pazarlama'] },
      { label: 'software-agency', keywords: ['software agency', 'dev agency', 'yazılım ajansı'] },
      { label: 'production-studio', keywords: ['production', 'prodüksiyon'] },
    ],
    conversion: {
      goal: 'Turn real work into project inquiries and contact',
      primaryAction: 'View work and start a project',
      primaryCTA: 'View Work', secondaryCTA: 'Start a Project',
      funnel: ['Land on selected work', 'Explore projects/case studies', 'Understand services/process', 'Contact / start a project', 'Discuss the project'],
    },
    trust: {
      drivers: ['Real work', 'Real case studies', 'Real services & process', 'Real team', 'Real client work', 'Results only when supplied'],
      sourceRequiredProof: ['Portfolio projects', 'Screenshots', 'Photography', 'Campaign work', 'Client deliverables', 'Case-study data', 'Team photos'],
      forbiddenClaims: ['Fake client work', 'Fabricated logos', 'Fabricated case studies', 'Fabricated project outcomes', 'Fabricated clients', 'Fabricated awards'],
    },
    sections: {
      required: ['Hero', 'Work / Projects', 'Services / Process', 'About', 'Contact'],
      recommended: ['Case Studies (only if provided)', 'Skills', 'Resume'],
      forbidden: [
        { section: 'SaaS Pricing Plans', reason: 'A portfolio/agency is project-led, not subscription-priced.' },
        { section: 'Fake client logos', reason: 'No real client logos to show.' },
        { section: 'Fabricated case studies', reason: 'Case studies require real client work.' },
        { section: 'Product Demo', reason: 'No software product demo belongs here.' },
      ],
    },
    visual: {
      realSourceRequired: ['Portfolio projects', 'Screenshots', 'Photography', 'Campaign work', 'Client deliverables', 'Case-study data', 'Team photos'],
      aiIllustrativeAllowed: ['Abstract brand identity', 'Brand texture', 'Atmospheric backgrounds', 'Graphic motifs', 'Editorial compositions'],
      cssSvgPreferred: ['Work grid/gallery layout', 'Process/service diagram', 'Editorial dividers'],
      motionSuitable: ['Editorial floating brand shapes', 'Soft work-card reveals', 'Calm hero ambience'],
      forbiddenGenerated: ['Fake client work', 'Fabricated logos/clients', 'Fabricated case studies/outcomes', 'Fabricated awards'],
      heroRecommendation: 'Editorial hero with real selected-work imagery (or abstract brand/atmospheric AI-illustrative art when none is provided) — never fabricated client work or logos.',
    },
    research: {
      recommended: true,
      angles: ['Category-specific UX patterns', 'Competitor information architecture', 'Common conversion patterns (inquiry)', 'Sector-specific visual conventions', 'Common CTA language'],
      reason: 'A live sector scan would validate portfolio/agency IA and inquiry conversion patterns.',
    },
    warnings: ['Client work, logos, case studies and outcomes require real material — never fabricate them.'],
  },

  'local-service': {
    businessModel: 'service-booking',
    subsectorDefault: 'local-service',
    subsectors: [
      { label: 'plumbing', keywords: ['plumber', 'plumbing', 'tesisat'] },
      { label: 'electrical', keywords: ['electrician', 'electrical', 'elektrik'] },
      { label: 'cleaning-service', keywords: ['cleaning', 'cleaner', 'temizlik'] },
      { label: 'barber-salon', keywords: ['barber', 'hairdresser', 'salon', 'berber', 'kuaför'] },
      { label: 'beauty-salon', keywords: ['beauty', 'spa', 'güzellik'] },
      { label: 'repair-service', keywords: ['repair', 'handyman', 'tamir'] },
      { label: 'moving-company', keywords: ['moving', 'movers', 'nakliyat'] },
      { label: 'consulting', keywords: ['consulting', 'consultant', 'danışman'] },
    ],
    conversion: {
      goal: 'Turn interest into bookings, quotes and calls for a real local business',
      primaryAction: 'Book a service, request a quote or call',
      primaryCTA: 'Book Now', secondaryCTA: 'Get a Quote',
      funnel: ['Land on services', 'Understand process/area', 'Request a quote / book', 'Call / contact', 'Confirm the service'],
    },
    trust: {
      drivers: ['Real business & location', 'Service area', 'Services & process', 'Qualifications only when supplied', 'Real work when relevant'],
      sourceRequiredProof: ['Real business identity', 'Real location/service area', 'Real work when relevant', 'Qualifications/licenses when supplied'],
      forbiddenClaims: ['Fabricated reviews', 'Fabricated team', 'Fabricated licenses', 'Fabricated years in business', 'Fabricated service/customer counts', 'Fabricated prices/availability'],
    },
    sections: {
      required: ['Hero', 'Services', 'Process', 'Service Area', 'Get a Quote / Book', 'Contact'],
      recommended: ['About', 'Gallery (only if provided)', 'Reviews (only if provided)'],
      forbidden: [
        { section: 'SaaS Pricing Plans', reason: 'A local service is booking/quote-led, not subscription-priced.' },
        { section: 'Product Dashboard', reason: 'No software surface belongs on a local-service site.' },
        { section: 'Software Integrations', reason: 'Not relevant to a local service.' },
        { section: 'Fake customer counts', reason: 'Customer/service totals would be fabricated.' },
        { section: 'Fake reviews', reason: 'No real reviews to show.' },
      ],
    },
    visual: {
      realSourceRequired: ['Real business identity', 'Real location/service area', 'Real work when relevant', 'Qualifications/licenses when supplied'],
      aiIllustrativeAllowed: ['Ambient service atmosphere', 'Abstract texture backgrounds', 'Brand mood imagery'],
      cssSvgPreferred: ['Service list layout', 'Process/step diagram', 'Service-area map motif', 'Quote/booking form (front-end)'],
      motionSuitable: ['Calm hero ambience', 'Soft service card reveals', 'Process step progression'],
      forbiddenGenerated: ['Fabricated reviews/team/licenses', 'Fabricated years in business', 'Fabricated service/customer counts', 'Fabricated prices/availability'],
      heroRecommendation: 'Clear service hero with real work photography when available (or an ambient AI-illustrative atmosphere when none is provided) — never fabricated reviews, team or licenses.',
    },
    research: {
      recommended: true,
      angles: ['Common conversion patterns for local services', 'Trust & credibility requirements', 'Local/regional buying concerns', 'Common CTA language', 'User decision factors'],
      reason: 'A live sector scan would validate local-service conversion patterns and regional trust cues.',
    },
    warnings: ['Reviews, team, licenses and counts require real material — never fabricate them; avoid SaaS-style assumptions.'],
  },

  general: {
    businessModel: 'unknown',
    subsectorDefault: 'unknown',
    subsectors: [],
    conversion: {
      goal: 'Guide visitors to understand the business and get in touch',
      primaryAction: 'Get in touch',
      primaryCTA: 'Get in Touch', secondaryCTA: 'See How It Works',
      funnel: ['Land on what it is', 'Understand how it works', 'See what is offered', 'Get in touch', 'Take the next step'],
    },
    trust: {
      drivers: ['Clear explanation of what the business is', 'Honest contact/location', 'Real services/offerings when provided'],
      sourceRequiredProof: ['Any real proof (products/work/team/location) the user provides'],
      forbiddenClaims: ['Fabricated proof of any kind', 'Fake logos/testimonials/metrics/certifications', 'Fabricated inventory/listings/results'],
    },
    sections: {
      required: ['Hero', 'What it is', 'How it works', 'Offerings', 'Contact'],
      recommended: ['About', 'FAQ'],
      forbidden: [
        { section: 'SaaS Pricing Plans', reason: 'The sector is unclear — do not assume a subscription product.' },
        { section: 'Fake metrics / logos / testimonials', reason: 'No verified proof to show.' },
        { section: 'Product Dashboard', reason: 'Do not assume a software surface when the sector is unknown.' },
      ],
    },
    visual: {
      realSourceRequired: ['Any real products/work/team/location the user provides'],
      aiIllustrativeAllowed: ['Abstract brand mood', 'Atmospheric backgrounds', 'Non-literal texture'],
      cssSvgPreferred: ['Simple section layouts', 'Generic process diagram', 'Contact form (front-end)'],
      motionSuitable: ['Minimal ambient hero glow', 'Soft section reveals'],
      forbiddenGenerated: ['Fabricated proof of any kind', 'Fake logos/testimonials/metrics/certifications', 'Fabricated inventory/listings/results'],
      heroRecommendation: 'Conservative hero with an abstract brand-mood background — no fabricated proof, no assumed software UI until the sector is validated.',
    },
    research: {
      recommended: true,
      angles: ['Category expectations', 'Market-specific terminology', 'Common conversion patterns', 'Trust & credibility requirements', 'Sector-specific visual conventions'],
      reason: 'Classification is uncertain — a future live sector scan is recommended to validate the sector before strong assumptions.',
    },
    warnings: ['Sector could not be determined with confidence — using a conservative, contact-led, anti-fabrication fallback.'],
  },
};

/** Industry sectors that represent an OPERATOR business or served vertical — the
 *  candidates for the primary (operator) sector and for `audienceSector`. Software
 *  ('ai-saas') and 'marketplace' are decided by dedicated precedence, so they are
 *  excluded from the industry-scoring candidate set. */
const INDUSTRY_ONLY_SECTORS: readonly IndustrySector[] = [
  'jewelry', 'landscaping', 'automotive-dealership', 'furniture-interiors',
  'restaurant-hospitality', 'real-estate', 'clinic-healthcare', 'portfolio-agency', 'local-service',
];

/* ── Vertical research evidence (Phase 11B) ───────────────────────────────────
 * Connects the EXISTING Web Build research result (via the already-normalized
 * Research Agent artifact) to the Vertical Intelligence contract. NO new network
 * request, no scraping, no re-fetch: it only validates + copies what the backend
 * already returned. Source-backed findings appear ONLY when real, non-empty URLs
 * exist; every no-source state stays honest and empty. Fully fail-open. */
const V_RESEARCH_SOURCE_CAP = 8;
const V_RESEARCH_ARRAY_CAP = 6;

/** Normalize a URL for dedupe: protocol + lowercased host + path (trailing slash
 *  stripped) + query. Falls back to the trimmed lowercased string if unparseable. */
function vNormalizeUrl(url: string): string {
  const t = (url || '').trim();
  if (!t) return '';
  try {
    const u = new URL(t);
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return t.toLowerCase();
  }
}

/** Validate + dedupe real sources: require a non-empty URL, dedupe by normalized
 *  URL, trim fields, derive an honest hostname title only when a title is missing.
 *  Never fabricates URLs/titles/snippets; skips malformed entries. Deterministic. */
function vValidateSources(sources: readonly WebBuildSource[] | undefined, cap: number): WebBuildSource[] {
  if (!Array.isArray(sources)) return [];
  const seen = new Set<string>();
  const out: WebBuildSource[] = [];
  for (const s of sources) {
    if (!s) continue;
    const url = (s.url || '').trim();
    if (!url) continue;
    const key = vNormalizeUrl(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    let title = (s.title || '').trim();
    if (!title) {
      try { title = new URL(url).hostname; } catch { title = url; }
    }
    const snippet = (s.snippet || '').trim();
    out.push(snippet ? { title, url, snippet } : { title, url });
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Assemble the vertical research plan (Phase 11B). Pure + deterministic + fail-open.
 *  • No research artifact          → status 'not-run', no evidence.
 *  • Real sources (didResearch +   → source-backed evidence mirroring the real
 *    validated URLs)                 status/provider/angles/findings.
 *  • Research ran/attempted but no  → honest no-source evidence (empty findings),
 *    usable URLs / disabled / failed   real status preserved (used_sources with no
 *    / no_sources                      valid URLs degrades to 'no_sources').
 * The frontend performs NO network request; deterministic profile angles remain
 * recommendations, never findings.
 */
function vBuildResearchPlan(
  profile: VerticalProfileDefinition,
  research: ResearchAgentArtifact | undefined,
  forceRecommend: boolean,
  lang: Lang,
): VerticalResearchPlan {
  const angles = [...profile.research.angles];
  const baseRecommended = profile.research.recommended || forceRecommend;
  const notRun: VerticalResearchPlan = {
    status: 'not-run',
    recommended: baseRecommended,
    angles,
    reason: L(lang,
      `No live research was run. ${profile.research.reason} A future sector scan can validate this with live sources.`,
      `Canlı araştırma yapılmadı. ${profile.research.reason} Gelecekteki bir sektör taraması bunu canlı kaynaklarla doğrulayabilir.`),
  };
  try {
    if (!research) return notRun;

    const validSources = vValidateSources(research.sources, V_RESEARCH_SOURCE_CAP);
    const genuine = research.didResearch === true && validSources.length > 0;
    const attempted = Array.isArray(research.attemptedProviders) && research.attemptedProviders.length
      ? uniq(research.attemptedProviders).slice(0, V_RESEARCH_ARRAY_CAP) : undefined;
    const capArr = (xs: string[] | undefined): string[] =>
      uniq(Array.isArray(xs) ? xs : []).slice(0, V_RESEARCH_ARRAY_CAP);

    if (genuine) {
      const evidence: VerticalResearchEvidence = {
        didResearch: true,
        provider: research.provider,
        attemptedProviders: attempted,
        sourceCount: validSources.length,
        sources: validSources,
        coveredAngles: capArr(research.researchAngles),
        sourceBackedInsights: capArr(research.sourceBackedInsights),
        categoryLanguage: capArr(research.categoryLanguage),
        audienceExpectations: capArr(research.audienceExpectations),
        conversionPatterns: capArr(research.conversionPatterns),
        trustSignals: capArr(research.trustSignals),
        visualPatterns: capArr(research.visualPatterns),
        competitorOrAdjacentPatterns: capArr(research.competitorOrAdjacentPatterns),
        risksToAvoid: capArr(research.risksToAvoid),
        differentiationOpportunities: capArr(research.differentiationOpportunities),
        summary: L(lang,
          `Source-backed: ${validSources.length} real source(s)${research.provider ? ` via ${research.provider}` : ''} inform this sector read.`,
          `Kaynak destekli: ${validSources.length} gerçek kaynak${research.provider ? ` (${research.provider})` : ''} bu sektör okumasını bilgilendiriyor.`),
      };
      return {
        status: research.status,
        recommended: baseRecommended,
        angles,
        reason: L(lang,
          `Source-backed by ${validSources.length} real source(s) from the Web Build research pass. Deterministic profile angles remain recommendations.`,
          `Web Build araştırma geçişinden ${validSources.length} gerçek kaynakla desteklendi. Deterministik profil açıları öneri olarak kalır.`),
        evidence,
      };
    }

    // No genuine sources — honest, non-source-backed. A 'used_sources' status with
    // no valid URLs degrades to 'no_sources'; other real statuses are preserved.
    const degradedStatus: WebBuildResearchStatus =
      research.didResearch === true ? 'no_sources' : research.status;
    const evidence: VerticalResearchEvidence = {
      didResearch: false,
      provider: research.provider,
      attemptedProviders: attempted,
      sourceCount: 0,
      sources: [],
      coveredAngles: [],
      sourceBackedInsights: [],
      categoryLanguage: [],
      audienceExpectations: [],
      conversionPatterns: [],
      trustSignals: [],
      visualPatterns: [],
      competitorOrAdjacentPatterns: [],
      risksToAvoid: [],
      differentiationOpportunities: [],
      fallbackReason: research.fallbackReason,
      summary: L(lang,
        `No source-backed sector scan (${degradedStatus}) — deterministic profile angles remain future recommendations.`,
        `Kaynak destekli sektör taraması yok (${degradedStatus}) — deterministik profil açıları gelecekteki öneriler olarak kalır.`),
    };
    return {
      status: degradedStatus,
      recommended: baseRecommended,
      angles,
      reason: L(lang,
        `No source-backed research (${degradedStatus})${research.fallbackReason ? `: ${research.fallbackReason}` : ''}. ${profile.research.reason} Deterministic profile angles remain recommendations.`,
        `Kaynak destekli araştırma yok (${degradedStatus})${research.fallbackReason ? `: ${research.fallbackReason}` : ''}. ${profile.research.reason} Deterministik profil açıları öneri olarak kalır.`),
      evidence,
    };
  } catch {
    return notRun;
  }
}

/** The honest fail-open artifact — a conservative, contact-led, anti-fabrication
 *  general fallback. Never throws; used when derivation unexpectedly fails. */
function failedOpenVerticalIntelligence(lang: Lang): VerticalIntelligenceArtifact {
  const p = VERTICAL_PROFILES.general;
  return {
    status: 'failed-open',
    version: 'deterministic-v1',
    sector: 'general',
    subsector: 'unknown',
    classificationBasis: 'fallback',
    confidence: 'low',
    matchedSignals: [],
    conflictingSignals: [],
    businessModel: p.businessModel,
    conversionModel: { goal: p.conversion.goal, primaryAction: p.conversion.primaryAction, primaryCTA: p.conversion.primaryCTA, secondaryCTA: p.conversion.secondaryCTA, funnel: [...p.conversion.funnel] },
    trustModel: { drivers: [...p.trust.drivers], sourceRequiredProof: [...p.trust.sourceRequiredProof], forbiddenClaims: [...p.trust.forbiddenClaims] },
    sectionPolicy: { required: [...p.sections.required], recommended: [...p.sections.recommended], forbidden: p.sections.forbidden.map((f) => ({ section: f.section, reason: f.reason })) },
    visualPolicy: { realSourceRequired: [...p.visual.realSourceRequired], aiIllustrativeAllowed: [...p.visual.aiIllustrativeAllowed], cssSvgPreferred: [...p.visual.cssSvgPreferred], motionSuitable: [...p.visual.motionSuitable], forbiddenGenerated: [...p.visual.forbiddenGenerated], heroRecommendation: p.visual.heroRecommendation },
    researchPlan: vBuildResearchPlan(p, undefined, true, lang),
    warnings: [L(lang, 'Vertical classification failed open — using a conservative, contact-led, anti-fabrication fallback.', 'Sektör sınıflandırması güvenli-açık moda düştü — temkinli, iletişim odaklı, uydurma-karşıtı bir yedek kullanılıyor.')],
    summary: L(lang, 'Vertical Intelligence failed open: general sector, low confidence, deterministic (no live research).', 'Sektör Zekâsı güvenli-açık moda düştü: genel sektör, düşük güven, deterministik (canlı araştırma yok).'),
  };
}

/**
 * Derive the deterministic Vertical Intelligence sector contract (Phase 11A/11B).
 * Pure, deterministic, fail-open, EN/TR-aware. Refines the concept/experience
 * understanding into a sector/subsector-specific contract WITHOUT contradicting the
 * Experience Blueprint. The derivation itself issues NO network request; when a
 * Research Agent artifact is threaded in (Phase 11B) it consumes that already-run
 * result to build honest, source-backed research evidence (real URLs only). Never
 * throws; never fetches or fabricates sources. All important arrays are always present.
 */
export function deriveVerticalIntelligence(input: VerticalIntelligenceInput): VerticalIntelligenceArtifact {
  const lang: Lang = input.lang || 'en';
  try {
    const brief = input.brief || ({} as WebBuildBrief);
    const ca = input.conceptAuthority;
    const ledger = input.ledger;
    const eb = input.experienceBlueprint;
    const inferred = input.inferred;
    const prompt = input.prompt || '';
    const sectionNames = (input.sectionItems || []).map((s) => s.name).filter(Boolean).join(' ');
    const briefText = [brief.coreIdea, brief.type, brief.goal, brief.audience, brief.style, brief.visitorIntent].filter(Boolean).join(' ');
    const caPrimary = (ca?.primaryConcept || '').toString().toLowerCase();
    const ledgerPrimary = (ledger?.primaryConcept || '').toString().toLowerCase();

    const split = vSplitProductVertical(prompt);
    // Separate text CHANNELS so the two roles never contaminate each other:
    //  • productText        → product/software/marketplace IDENTITY only.
    //  • audiencePromptText → audience/operator SECTOR scoring only. For an explicit
    //    "<product> for <vertical>" / "<vertical> için <product>" split this is JUST
    //    the vertical side, so product-side industry words (e.g. "interior design" in
    //    "AI interior design tool for real estate agencies") never become the audience.
    const productText = split.hadSplit ? split.product : [prompt, brief.coreIdea, brief.type].filter(Boolean).join(' ');
    const audiencePromptText = split.hadSplit ? split.vertical : prompt;
    const coreText = split.hadSplit ? split.product : [prompt, briefText].filter(Boolean).join(' ');
    const fullText = [prompt, briefText, sectionNames, ca?.targetVertical, ca?.audienceVertical, ledger?.targetVertical].filter(Boolean).join(' ');

    // ── Industry-sector scoring (operator business OR served vertical). ──
    const scores = {} as Record<IndustrySector, number>;
    const matchedBySector = {} as Record<IndustrySector, string[]>;
    for (const s of INDUSTRY_ONLY_SECTORS) { scores[s] = 0; matchedBySector[s] = []; }

    const industrySignals: Array<{ label: string; text: string; w: number }> = [
      // The explicit grammatical target (split.vertical) is the STRONGEST audience
      // signal — it must outrank product-side industry words, the inferred fallback,
      // generic section names and broad brief content. Empty (→ skipped) when no split.
      { label: 'explicitAudienceVertical', text: split.hadSplit ? split.vertical : '', w: 8 },
      { label: 'conceptAuthority.targetVertical', text: (ca?.targetVertical || '').toString(), w: 4 },
      { label: 'conceptAuthority.audienceVertical', text: ca?.audienceVertical || '', w: 4 },
      { label: 'ledger.targetVertical', text: ledger?.targetVertical || '', w: 3 },
      // Audience CHANNEL only (the vertical side of a split, or the whole prompt when
      // there is no split) — never the product side, so it can't self-contaminate.
      { label: 'promptAudience', text: audiencePromptText, w: 4 },
      { label: 'brief', text: briefText, w: 3 },
      { label: 'sections', text: sectionNames, w: 1 },
    ];
    for (const sec of INDUSTRY_ONLY_SECTORS) {
      const words = VERTICAL_KEYWORDS[sec];
      for (const sig of industrySignals) {
        if (!sig.text) continue;
        const m = vCountMatches(sig.text, words);
        if (m.hits > 0) {
          scores[sec] += m.hits * sig.w;
          for (const kw of m.matched.slice(0, 3)) matchedBySector[sec].push(`${sig.label}: ${kw}`);
        }
      }
    }
    // Direct sector votes (only when they resolve to an INDUSTRY_ONLY sector).
    const conceptVote = SECTOR_FROM_CONCEPT[caPrimary];
    if (conceptVote && INDUSTRY_ONLY_SECTORS.includes(conceptVote as IndustrySector)) {
      scores[conceptVote as IndustrySector] += 5;
      matchedBySector[conceptVote as IndustrySector].push(`conceptAuthority.primaryConcept: ${caPrimary}`);
    }
    const inferredVote = inferred ? SECTOR_FROM_INFERRED[inferred.industry] : undefined;
    if (inferredVote && INDUSTRY_ONLY_SECTORS.includes(inferredVote as IndustrySector)) {
      scores[inferredVote as IndustrySector] += 3;
      matchedBySector[inferredVote as IndustrySector].push(`inferred.industry: ${inferred?.industry}`);
    }
    const expVote = eb ? SECTOR_FROM_EXPERIENCE[eb.siteExperienceType] : undefined;
    if (expVote && INDUSTRY_ONLY_SECTORS.includes(expVote as IndustrySector)) {
      scores[expVote as IndustrySector] += 2;
      matchedBySector[expVote as IndustrySector].push(`experienceBlueprint: ${eb?.siteExperienceType}`);
    }

    // Rank industry sectors deterministically (score desc, then declaration order).
    const ranked = INDUSTRY_ONLY_SECTORS
      .map((sec, i) => ({ sec, score: scores[sec], order: i }))
      .sort((a, b) => (b.score - a.score) || (a.order - b.order));
    const industryTop = ranked[0];
    const industrySecond = ranked[1];
    const industryTopScore = industryTop ? industryTop.score : 0;
    const industrySecondScore = industrySecond ? industrySecond.score : 0;

    // ── Software (product-concept) evidence. Product identity has precedence. ──
    const conceptIsSoftware = SECTOR_FROM_CONCEPT[caPrimary] === 'ai-saas';
    const ledgerIsSoftware = SECTOR_FROM_CONCEPT[ledgerPrimary] === 'ai-saas';
    const inferredIsSoftware = inferred?.industry === 'ai_saas';
    const experienceIsSoftware = !!expVote && expVote === 'ai-saas';
    const softwareKw = vCountMatches(productText, VERTICAL_SOFTWARE_WORDS);
    let softwareEvidence = 0;
    const softwareSignals: string[] = [];
    if (conceptIsSoftware) { softwareEvidence += 6; softwareSignals.push(`conceptAuthority.primaryConcept: ${caPrimary}`); }
    if (ledgerIsSoftware) { softwareEvidence += 6; softwareSignals.push(`ledger.primaryConcept: ${ledgerPrimary}`); }
    if (inferredIsSoftware) { softwareEvidence += 3; softwareSignals.push('inferred.industry: ai_saas'); }
    if (experienceIsSoftware) { softwareEvidence += 2; softwareSignals.push(`experienceBlueprint: ${eb?.siteExperienceType}`); }
    if (softwareKw.hits > 0) { softwareEvidence += softwareKw.hits * 2; for (const kw of softwareKw.matched.slice(0, 3)) softwareSignals.push(`product: ${kw}`); }

    // ── Marketplace (two-sided) evidence. ──
    const conceptIsMarketplace = caPrimary === 'marketplace';
    const experienceIsMarketplace = eb?.siteExperienceType === 'marketplace';
    const inferredIsEcommerce = inferred?.industry === 'ecommerce';
    const marketplaceKw = vCountMatches(coreText, VERTICAL_MARKETPLACE_WORDS);
    let marketplaceEvidence = 0;
    const marketplaceSignals: string[] = [];
    if (conceptIsMarketplace) { marketplaceEvidence += 6; marketplaceSignals.push('conceptAuthority.primaryConcept: marketplace'); }
    if (experienceIsMarketplace) { marketplaceEvidence += 2; marketplaceSignals.push('experienceBlueprint: marketplace'); }
    if (inferredIsEcommerce) { marketplaceEvidence += 2; marketplaceSignals.push('inferred.industry: ecommerce'); }
    if (marketplaceKw.hits > 0) { marketplaceEvidence += marketplaceKw.hits * 3; for (const kw of marketplaceKw.matched.slice(0, 3)) marketplaceSignals.push(`core: ${kw}`); }

    // Product/model identity is decisive from a STRUCTURED signal (Concept
    // Authority / ledger / inferred / experience) or the product portion of a
    // "<product> for <vertical>" split. A keyword-only, non-split prompt needs ≥2
    // software hits so a non-software operator that merely mentions "platform" /
    // "dashboard" is not misread as a SaaS product.
    // Marketplace MODEL vs marketplace TOOL: software that operates/manages a
    // marketplace (e.g. "marketplace management software", "pazaryeri yönetim
    // yazılımı", "marketplace analytics platform") is a SaaS product, not the
    // marketplace itself — detected from the PRODUCT side by narrow phrase signals.
    const marketplaceToolKw = vCountMatches(productText, VERTICAL_MARKETPLACE_TOOL_WORDS);
    const marketplaceLooksLikeTool = marketplaceToolKw.hits > 0;
    if (marketplaceLooksLikeTool) { for (const kw of marketplaceToolKw.matched.slice(0, 3)) softwareSignals.push(`product: ${kw}`); }

    const softwareByStructured = conceptIsSoftware || ledgerIsSoftware || inferredIsSoftware || experienceIsSoftware;
    const softwareByKeyword = split.hadSplit ? softwareKw.hits > 0 : softwareKw.hits >= 2;
    // A marketplace-management tool is itself a software product identity.
    const isSoftware = softwareByStructured || softwareByKeyword || marketplaceLooksLikeTool;
    // A genuinely two-sided model needs a real marketplace signal (concept /
    // experience / an explicit marketplace keyword) — a single-brand ecommerce
    // mention alone never forces the marketplace model.
    const isMarketplace = conceptIsMarketplace || experienceIsMarketplace || marketplaceKw.hits > 0;

    // ── Product-side identity precedence (Phase 11C.1) ──────────────────────────
    // For an explicit "<product> for <audience>" / "<audience> için <product>"
    // split, the PRODUCT side controls the primary software-vs-marketplace identity;
    // the audience side — ecommerce/marketplace wording included — only influences
    // `audienceSector`, never the product identity. `marketplaceKw`/`marketplaceToolKw`
    // already scan the PRODUCT side (coreText/productText) for a split, so "AI …
    // assistant for ecommerce stores" / "AI platform for marketplace sellers" keep
    // `marketplaceKw.hits === 0` on the product side and stay software.
    //   • explicitProductMarketplaceModel — the PRODUCT itself is a genuine
    //     marketplace ("AI marketplace …"), and is NOT a marketplace-management tool.
    //   • explicitSplitSoftwareProduct — an explicit split whose product is software
    //     (or a marketplace-management tool) and is NOT a genuine product-side
    //     marketplace; structured marketplace signals must not override it.
    // Genuine product-side marketplaces still win; marketplace-management tools stay
    // software (SaaS). Non-split prompts keep their existing conservative behavior.
    const explicitProductMarketplaceModel = marketplaceKw.hits > 0 && !marketplaceLooksLikeTool;
    const explicitSplitSoftwareProduct = split.hadSplit
      && (softwareKw.hits > 0 || marketplaceLooksLikeTool)
      && !explicitProductMarketplaceModel;
    // Structured (Concept Authority / Experience Blueprint) marketplace signals are
    // suppressed ONLY for an explicit split software product; otherwise they remain
    // strong. A STRONG marketplace model is resolved before software identity.
    const structuredMarketplaceModel = (conceptIsMarketplace || experienceIsMarketplace)
      && !explicitSplitSoftwareProduct;
    const strongMarketplaceModel = explicitProductMarketplaceModel || structuredMarketplaceModel;

    // ── Resolve the primary sector + classification basis + audience sector. ──
    let sector: VerticalSector;
    let basis: VerticalClassificationBasis;
    // Only ever an INDUSTRY_ONLY sector (industryTop.sec) or undefined — typed as
    // IndustrySector so it can safely index the industry-only score/match maps.
    let audienceSector: IndustrySector | undefined;
    const matchedSignals: string[] = [];

    // A strong marketplace MODEL is resolved before software; a plain (non-strong)
    // marketplace signal only wins when the product is not clearly software.
    const resolveMarketplace = strongMarketplaceModel || (isMarketplace && !isSoftware);
    if (resolveMarketplace) {
      sector = 'marketplace';
      basis = 'marketplace-model';
      audienceSector = industryTopScore > 0 ? industryTop.sec : undefined;
      matchedSignals.push(...marketplaceSignals);
      if (audienceSector) matchedSignals.push(...matchedBySector[audienceSector].slice(0, 3));
    } else if (isSoftware) {
      sector = 'ai-saas';
      basis = 'product-concept';
      audienceSector = industryTopScore > 0 ? industryTop.sec : undefined;
      matchedSignals.push(...softwareSignals);
      if (audienceSector) matchedSignals.push(...matchedBySector[audienceSector].slice(0, 3));
    } else if (industryTopScore > 0) {
      sector = industryTop.sec;
      basis = 'operator-business';
      matchedSignals.push(...matchedBySector[industryTop.sec].slice(0, 5));
    } else {
      sector = 'general';
      basis = 'fallback';
    }

    const profile = VERTICAL_PROFILES[sector];

    // ── Subsector (from the winning-sector profile over the most relevant text). ──
    const subText = sector === 'ai-saas' ? productText : sector === 'marketplace' ? coreText : fullText;
    const subsector = vDetectSubsector(profile, subText);

    // ── Confidence (deterministic thresholds; never random/time-based). ──
    let confidence: VerticalConfidence;
    if (basis === 'fallback') {
      confidence = 'low';
    } else if (basis === 'operator-business') {
      const margin = industryTopScore - industrySecondScore;
      confidence = (industryTopScore >= 8 && margin >= 4) ? 'high' : industryTopScore >= 4 ? 'medium' : 'low';
    } else {
      // Use the evidence for the sector that was ACTUALLY selected — both isSoftware
      // and isMarketplace can be true, but the resolved sector decides confidence.
      const primaryEvidence = sector === 'marketplace' ? marketplaceEvidence : softwareEvidence;
      // An explicit, unambiguous grammatical audience target (strong split.vertical
      // match, no close runner-up) supports a confident product/audience read even
      // when the product-identity keyword evidence alone is light.
      const explicitAudienceStrong = split.hadSplit && !!audienceSector
        && industryTopScore >= 8 && (industryTopScore - industrySecondScore) >= 4;
      confidence = (primaryEvidence >= 6 || (primaryEvidence >= 2 && explicitAudienceStrong)) ? 'high'
        : (primaryEvidence >= 3 || explicitAudienceStrong) ? 'medium'
        : 'low';
    }

    // ── Conflicting signals — ONLY a genuine ambiguity: two different candidate
    // audience/operator sectors are close. A strong audience sector for a software/
    // marketplace product is EXPECTED product-vs-audience separation, not a conflict
    // (the audienceSector warning below already explains it), so it is not flagged. ──
    const conflictingSignals: string[] = [];
    if (industrySecondScore > 0 && industrySecond && industrySecond.sec !== sector && industrySecond.sec !== audienceSector
      && (industryTopScore - industrySecondScore) < 3) {
      conflictingSignals.push(`${industrySecond.sec} signals are also present (close to ${industryTop.sec}).`);
    }

    const status: VerticalIntelligenceArtifact['status'] =
      sector === 'general' ? 'unknown' : (confidence === 'low' ? 'partial' : 'classified');

    // ── Warnings (profile guards + honest dynamic notes; localized narrative). ──
    const warnings: string[] = [...profile.warnings];
    if (status === 'unknown') {
      warnings.push(L(lang, 'Sector could not be classified with confidence — the contract is a conservative, anti-fabrication fallback; a future sector scan is recommended.', 'Sektör güvenle sınıflandırılamadı — sözleşme temkinli, uydurma-karşıtı bir yedek; gelecekte bir sektör taraması önerilir.'));
    } else if (confidence === 'low') {
      warnings.push(L(lang, 'Low-confidence classification — treat this sector contract as provisional until validated.', 'Düşük güvenli sınıflandırma — doğrulanana kadar bu sektör sözleşmesini geçici kabul edin.'));
    }
    if (audienceSector) {
      warnings.push(L(lang,
        `Primary identity is ${sector} (${basis}); the served industry ${audienceSector} is stored as audienceSector, not the primary sector.`,
        `Birincil kimlik ${sector} (${basis}); hizmet verilen sektör ${audienceSector} birincil sektör değil, audienceSector olarak saklanır.`));
    }
    for (const c of conflictingSignals) warnings.push(L(lang, `Conflict: ${c}`, `Çelişki: ${c}`));

    const summary = L(lang,
      `Sector: ${sector}${subsector && subsector !== 'unknown' ? ` / ${subsector}` : ''}${audienceSector ? ` · audience ${audienceSector}` : ''} · ${profile.businessModel} · ${basis} · confidence ${confidence}. Primary CTA: ${profile.conversion.primaryCTA}. Deterministic (no live research).`,
      `Sektör: ${sector}${subsector && subsector !== 'unknown' ? ` / ${subsector}` : ''}${audienceSector ? ` · hedef ${audienceSector}` : ''} · ${profile.businessModel} · ${basis} · güven ${confidence}. Ana CTA: ${profile.conversion.primaryCTA}. Deterministik (canlı araştırma yok).`);

    return {
      status,
      version: 'deterministic-v1',
      sector,
      subsector,
      audienceSector,
      classificationBasis: basis,
      confidence,
      matchedSignals: uniq(matchedSignals),
      conflictingSignals: uniq(conflictingSignals),
      businessModel: profile.businessModel,
      conversionModel: {
        goal: profile.conversion.goal,
        primaryAction: profile.conversion.primaryAction,
        primaryCTA: profile.conversion.primaryCTA,
        secondaryCTA: profile.conversion.secondaryCTA,
        funnel: [...profile.conversion.funnel],
      },
      trustModel: {
        drivers: [...profile.trust.drivers],
        sourceRequiredProof: [...profile.trust.sourceRequiredProof],
        forbiddenClaims: [...profile.trust.forbiddenClaims],
      },
      sectionPolicy: {
        required: [...profile.sections.required],
        recommended: [...profile.sections.recommended],
        forbidden: profile.sections.forbidden.map((f) => ({ section: f.section, reason: f.reason })),
      },
      visualPolicy: {
        realSourceRequired: [...profile.visual.realSourceRequired],
        aiIllustrativeAllowed: [...profile.visual.aiIllustrativeAllowed],
        cssSvgPreferred: [...profile.visual.cssSvgPreferred],
        motionSuitable: [...profile.visual.motionSuitable],
        forbiddenGenerated: [...profile.visual.forbiddenGenerated],
        heroRecommendation: profile.visual.heroRecommendation,
      },
      researchPlan: vBuildResearchPlan(profile, input.research, confidence === 'low' || status !== 'classified', lang),
      warnings: uniq(warnings),
      summary,
    };
  } catch {
    return failedOpenVerticalIntelligence(lang);
  }
}

/* ── Vertical Intelligence Agent (Phase 11A) ──────────────────────────────────
 * A real pipeline agent stage. Runs AFTER the Experience Blueprint and BEFORE the
 * intent-aware Page Architecture. Deterministic, typed, fail-open; produces a real
 * artifact ready for Phase 11B consumption. Never calls a provider, never claims
 * live research, never mutates inputs, never blocks the build. */
export interface VerticalIntelligenceAgentInput extends VerticalIntelligenceInput {}

export function runVerticalIntelligence(
  input: VerticalIntelligenceAgentInput,
): { agent: WebBuildAgent; artifact: VerticalIntelligenceArtifact } {
  const lang: Lang = input.lang || 'en';
  const name = L(lang, 'Vertical Intelligence', 'Sektör Zekâsı');
  const activity = L(lang, 'Classifying sector, business model, conversion path, trust and visual truth rules', 'Sektör, iş modeli, dönüşüm yolu, güven ve görsel doğruluk kuralları sınıflandırılıyor');
  try {
    const artifact = deriveVerticalIntelligence(input);
    const status: AgentStatus = artifact.status === 'failed-open' ? 'failed' : 'done';
    return { agent: { id: 'vertical_intelligence', name, status, summary: artifact.summary, currentActivity: activity, artifact }, artifact };
  } catch {
    const artifact = failedOpenVerticalIntelligence(lang);
    return { agent: { id: 'vertical_intelligence', name, status: 'failed', summary: artifact.summary, currentActivity: activity, artifact }, artifact };
  }
}

export function derivePageArchitectureDecision(
  prompt: string,
  brief: WebBuildBrief,
  sectionItems: Array<{ id: string; name: string }>,
  conceptAuthority: ConceptAuthority | undefined,
  strategy: StrategyAgentArtifact | undefined,
  ledger: StrategicThinkingLedger | undefined,
  lang: Lang = 'en',
  blueprint?: ExperienceBlueprint,
): PageArchitectureDecision {
  const hay = [prompt, brief.coreIdea, brief.type, brief.goal, brief.audience, brief.style].filter(Boolean).join(' ').toLowerCase();
  const vhay = `${hay} ${conceptAuthority?.targetVertical || ''} ${conceptAuthority?.audienceVertical || ''} ${ledger?.targetVertical || ''}`.toLowerCase();
  const concept = (ledger?.primaryConcept || conceptAuthority?.primaryConcept || '').toLowerCase();
  const ic = strategy?.interactionContract;

  const isAi = concept === 'ai' || concept === 'saas' || /\bai\b|artificial|chatbot|chat\s*bot|assistant|agentic|\bllm\b|sohbet|asistan/.test(hay);
  const isCommerce = /ecommerce|e-?commerce|storefront|\bstore\b|\bshop\b|retail|marketplace|catalog|mağaza|e-?ticaret/.test(vhay);
  // Phase 12F — the STORE must be the primary concept for storefront/shopper labels;
  // a mere ecommerce/retail TARGET vertical never makes the product a store.
  const storeConcept = concept === 'marketplace' || /\b(marketplace|storefront|online\s*store|e-?commerce\s*store)\b/.test(hay);
  const isB2B = /b2b|enterprise|sales\s*team|\bteams?\b|\bsaas\b|platform|merchant|business|kurumsal/.test(hay);
  const isInteractive = isAi || isCommerce || /dashboard|\btool\b|onboarding|marketplace|catalog|workflow|process|\bsupport\b|assistant/.test(hay);
  // Chat surfaces require EXPLICIT chat evidence — "AI"/"assistant"/"support" alone do not.
  const wantsChat = hasExplicitChatIntent(hay);
  const aiCommerce = wantsChat && isCommerce;

  // Prompt-driven inclusion signals (only include when the prompt genuinely asks).
  const asksPricing = /pricing|\bprice\b|plans?|subscription|tier|packages?|paywall|fiyat|abonelik|paket/.test(hay);
  const asksTestimonials = /testimonial|customer\s*review|reviews?|referans|yorum/.test(hay);
  const asksCaseStudies = /case[-\s]?stud|success\s*stor|vaka/.test(hay);
  const asksBookDemo = /book\s*a?\s*demo|contact\s*sales|talk\s*to\s*sales|schedule\s*a?\s*(call|demo)|demo\s*ayarla|satış/.test(hay);
  // Honest proof gate: proof sections are only kept when the USER asked for them
  // (we have no way to verify external logos/metrics/testimonials otherwise).
  const proofNeeded = asksTestimonials || asksCaseStudies;

  const pricingNeeded = asksPricing || (isB2B && /\bsaas\b|subscription|plans?|self-?serve/.test(hay));
  const securityNeeded = isCommerce || wantsChat || /security|trust|privacy|customer\s*data|compliance|gdpr|kvkk|güven/.test(hay);
  const integrationsNeeded = isCommerce || /integration|shopify|woocommerce|\bcrm\b|helpdesk|catalog|\bapi\b|connect|entegrasyon/.test(hay);

  // Demo placement: only when the concept benefits from interaction.
  const leadGated = ic?.leadCaptureRequired === true || /landing-gated|lead-capture-gated/.test(`${ic?.entryFlowModel || ''} ${ic?.conversionJourneyModel || ''} ${ledger?.primaryConversionPath || ''}`.toLowerCase());
  const demoSurface = ledger?.demoSurfaceIntent;
  let demoPlacement: DemoPlacement = 'none';
  if ((wantsChat || isInteractive) && demoSurface !== 'none') {
    demoPlacement = leadGated ? 'gated' : 'dedicated-section';
  }

  const entryModel = ledger?.demoSurfaceIntent === 'dashboard-demo' ? 'dashboard-first'
    : (brief.entryFlowModel || ic?.entryFlowModel || (leadGated ? 'landing-gated-experience' : (isCommerce ? 'catalog-first' : 'single-page')));

  // CTAs — B2B product → Book Demo / Contact Sales; consumer/simple → Try Demo.
  // Phase 9D-2: when the Experience Blueprint classified the site with confidence,
  // prefer its whole-site CTA strategy so the CTAs match the site type (a
  // restaurant gets Reserve/Call, a dev tool gets View Docs, etc.).
  const bpConfident = !!blueprint && blueprint.siteExperienceType !== 'unknown';
  const primaryCTA = (bpConfident && blueprint!.primaryCTA)
    ? blueprint!.primaryCTA
    : (demoPlacement !== 'none'
      ? (isB2B && asksBookDemo ? L(lang, 'Book a Demo', 'Demo Ayarla') : L(lang, 'Try the Demo', 'Demoyu Dene'))
      : (isB2B ? L(lang, 'Contact Sales', 'Satışla İletişim') : L(lang, 'Get in touch', 'İletişime geç')));
  const secondaryCTA = (bpConfident && blueprint!.secondaryCTA)
    ? blueprint!.secondaryCTA!
    : (pricingNeeded ? L(lang, 'See Pricing', 'Fiyatları Gör')
      : (isB2B ? L(lang, 'Contact Sales', 'Satışla İletişim') : L(lang, 'See how it works', 'Nasıl çalıştığını gör')));

  // Recommended concept-specific section spine (labels only; ids stay original).
  const flowLabel = storeConcept ? L(lang, 'Shopper Flow', 'Alışverişçi Akışı') : L(lang, 'How it works', 'Nasıl çalışır');
  const demoLabel = wantsChat ? L(lang, 'Chat Experience', 'Sohbet Deneyimi') : L(lang, 'Product Demo', 'Ürün Demosu');
  const recommendedSections: string[] = [L(lang, 'Hero', 'Hero')];
  if (demoPlacement !== 'none' && wantsChat) recommendedSections.push(demoLabel);
  recommendedSections.push(flowLabel);
  if (integrationsNeeded) recommendedSections.push(storeConcept ? L(lang, 'Store Integrations', 'Mağaza Entegrasyonları') : L(lang, 'Integrations', 'Entegrasyonlar'));
  if (securityNeeded) recommendedSections.push(storeConcept ? L(lang, 'Security & Store Trust', 'Güvenlik ve Mağaza Güveni') : L(lang, 'Security & Trust', 'Güvenlik ve Güven'));
  recommendedSections.push(pricingNeeded ? L(lang, 'Pricing', 'Fiyatlandırma') : (isB2B ? L(lang, 'Book a Demo', 'Demo Ayarla') : L(lang, 'Try the Demo', 'Demoyu Dene')));
  recommendedSections.push(isB2B ? L(lang, 'Contact Sales', 'Satışla İletişim') : L(lang, 'Contact', 'İletişim'));

  // Removals — scan the REAL sections and drop the ones this concept should not
  // carry (unsupported proof + pricing when irrelevant). Never removes hero/footer/
  // demo/contact. Honest reasons.
  const removedSections: PageArchitectureDecision['removedSections'] = [];
  const architectureWarnings: string[] = [];
  const isRole = (name: string, id: string, re: RegExp) => re.test(`${id} ${name}`);
  for (const s of sectionItems || []) {
    const key = `${s.id} ${s.name}`;
    if (!proofNeeded && SECTION_ROLE_RE.testimonials.test(key) && !SECTION_ROLE_RE.hero.test(key)) {
      removedSections.push({ id: s.id, section: s.name, reason: L(lang, 'Testimonials removed — no user/source proof provided (avoids fabricated proof).', 'Referanslar kaldırıldı — kullanıcı/kaynak kanıtı yok (uydurma kanıttan kaçınır).') });
    } else if (!proofNeeded && (SECTION_ROLE_RE.caseStudies.test(key)) && !SECTION_ROLE_RE.hero.test(key)) {
      removedSections.push({ id: s.id, section: s.name, reason: L(lang, 'Case Studies removed — none provided by user/source (avoids fabricated proof).', 'Vaka çalışmaları kaldırıldı — kullanıcı/kaynak tarafından sağlanmadı (uydurma kanıttan kaçınır).') });
    } else if (SECTION_ROLE_RE.certifications.test(key) && !securityNeeded) {
      removedSections.push({ id: s.id, section: s.name, reason: L(lang, 'Certifications removed — no real compliance provided (no fake SOC2/ISO).', 'Sertifikalar kaldırıldı — gerçek uyumluluk sağlanmadı (sahte SOC2/ISO yok).') });
    } else if (!pricingNeeded && SECTION_ROLE_RE.pricing.test(key) && !SECTION_ROLE_RE.hero.test(key)) {
      removedSections.push({ id: s.id, section: s.name, reason: L(lang, `Pricing removed — not requested for this concept; prefer ${isB2B ? 'Book a Demo / Contact Sales' : 'Try the Demo'}.`, `Fiyatlandırma kaldırıldı — bu konsept için istenmedi; ${isB2B ? 'Demo Ayarla / Satışla İletişim' : 'Demoyu Dene'} tercih edilir.`) });
    }
  }
  // Phase 9D-2 — BLUEPRINT SPINE GUARD: for a NON-SaaS experience type
  // (restaurant / local-business / portfolio) drop SaaS-only sections the model may
  // have added by default (pricing / integrations / security-compliance /
  // certifications / product-demo) UNLESS the prompt explicitly asked. Guidance,
  // not over-deletion: hero / footer / contact are never targeted, and the payload
  // keeps a >= 5 section floor so nothing drops below the quality gate.
  const bpType = blueprint?.siteExperienceType;
  const bpNonSaaS = bpType === 'restaurant' || bpType === 'local-business' || bpType === 'portfolio';
  if (bpNonSaaS) {
    const already = new Set(removedSections.map((r) => r.id));
    for (const s of sectionItems || []) {
      if (already.has(s.id)) continue;
      const key = `${s.id} ${s.name}`;
      if (SECTION_ROLE_RE.hero.test(key) || SECTION_ROLE_RE.footer.test(key) || SECTION_ROLE_RE.contact.test(key)) continue;
      let reason = '';
      if (!asksPricing && SECTION_ROLE_RE.pricing.test(key)) reason = L(lang, `SaaS pricing does not fit a ${bpType} site (not requested).`, `SaaS fiyatlandırması bir ${bpType} sitesine uymuyor (istenmedi).`);
      else if (SECTION_ROLE_RE.integrations.test(key)) reason = L(lang, `SaaS integrations do not fit a ${bpType} site.`, `SaaS entegrasyonları bir ${bpType} sitesine uymuyor.`);
      else if (SECTION_ROLE_RE.certifications.test(key)) reason = L(lang, `A compliance/certification section does not fit a ${bpType} site.`, `Uyumluluk/sertifika bölümü bir ${bpType} sitesine uymuyor.`);
      else if (SECTION_ROLE_RE.security.test(key)) reason = L(lang, `SaaS security/compliance does not fit a ${bpType} site.`, `SaaS güvenlik/uyumluluk bir ${bpType} sitesine uymuyor.`);
      else if (SECTION_ROLE_RE.demo.test(key) && !/\bdemo\b|\bchat\b|assistant|chatbot|dashboard/.test(hay)) reason = L(lang, `A product/chat demo does not fit a ${bpType} site (not requested).`, `Ürün/sohbet demosu bir ${bpType} sitesine uymuyor (istenmedi).`);
      if (reason) { removedSections.push({ id: s.id, section: s.name, reason }); already.add(s.id); }
    }
    if (removedSections.length) architectureWarnings.push(L(lang, `Site classified as "${bpType}" — SaaS/product sections that don't fit were dropped (kept only what the prompt requested).`, `Site "${bpType}" olarak sınıflandırıldı — uymayan SaaS/ürün bölümleri düşürüldü (yalnızca istemin istediği tutuldu).`));
  }

  if (removedSections.some((r) => SECTION_ROLE_RE.testimonials.test(r.section) || SECTION_ROLE_RE.caseStudies.test(r.section))) {
    architectureWarnings.push(L(lang, 'Unsupported proof sections (testimonials/case studies) were dropped — add them only with real user/source proof.', 'Desteklenmeyen kanıt bölümleri (referans/vaka) düşürüldü — yalnızca gerçek kullanıcı/kaynak kanıtıyla ekleyin.'));
  }
  // Phase 9D-2: carry the blueprint's own warnings into the architecture diagnostics.
  if (blueprint?.blueprintWarnings?.length) architectureWarnings.push(...blueprint.blueprintWarnings.slice(0, 2));
  if (aiCommerce && !sectionItems.some((s) => isRole(s.name, s.id, SECTION_ROLE_RE.security)) && securityNeeded) {
    architectureWarnings.push(L(lang, 'No Security & Store Trust section — an AI/ecommerce site should reassure on data/trust (honest, no fake compliance).', 'Güvenlik ve Mağaza Güveni bölümü yok — AI/e-ticaret sitesi veri/güven konusunda güven vermeli (dürüst, sahte uyumluluk yok).'));
  }

  const requiredSections = uniq([L(lang, 'Hero', 'Hero'), ...(demoPlacement !== 'none' && wantsChat ? [demoLabel] : []), flowLabel, (isB2B ? L(lang, 'Contact Sales', 'Satışla İletişim') : L(lang, 'Contact', 'İletişim'))]);
  const optionalSections = uniq([
    ...(pricingNeeded ? [L(lang, 'Pricing', 'Fiyatlandırma')] : []),
    ...(integrationsNeeded ? [storeConcept ? L(lang, 'Store Integrations', 'Mağaza Entegrasyonları') : L(lang, 'Integrations', 'Entegrasyonlar')] : []),
    ...(securityNeeded ? [storeConcept ? L(lang, 'Security & Store Trust', 'Güvenlik ve Mağaza Güveni') : L(lang, 'Security & Trust', 'Güvenlik ve Güven')] : []),
  ]);

  return {
    recommendedSections: uniq(recommendedSections),
    removedSections,
    requiredSections,
    optionalSections,
    entryModel,
    demoPlacement,
    pricingNeeded,
    pricingReason: pricingNeeded
      ? L(lang, 'Prompt/concept calls for plans or a conversion page.', 'İstem/konsept planları veya bir dönüşüm sayfasını gerektiriyor.')
      : L(lang, 'Not requested; prefer a demo/contact conversion instead of a price table.', 'İstenmedi; fiyat tablosu yerine demo/iletişim dönüşümü tercih edilir.'),
    proofNeeded,
    proofReason: proofNeeded
      ? L(lang, 'User asked for testimonials/case studies — keep only with real content.', 'Kullanıcı referans/vaka istedi — yalnızca gerçek içerikle tut.')
      : L(lang, 'No user/source proof — use honest Trust & Safety, not logos/testimonials/metrics.', 'Kullanıcı/kaynak kanıtı yok — logo/referans/metrik yerine dürüst Güven ve Emniyet kullan.'),
    securityNeeded,
    securityReason: securityNeeded
      ? L(lang, 'Handles customer data / chat — reassure honestly (no fake SOC2/ISO).', 'Müşteri verisi / sohbet işliyor — dürüstçe güven ver (sahte SOC2/ISO yok).')
      : L(lang, 'No sensitive-data surface — a security section is optional.', 'Hassas veri yüzeyi yok — güvenlik bölümü isteğe bağlı.'),
    integrationsNeeded,
    integrationsReason: integrationsNeeded
      ? L(lang, 'Ecommerce/store/app concept — show simulated, front-end-only integrations.', 'E-ticaret/mağaza/uygulama konsepti — simüle, yalnızca ön-yüz entegrasyonları göster.')
      : L(lang, 'No integration surface implied by the concept.', 'Konseptin ima ettiği bir entegrasyon yüzeyi yok.'),
    primaryCTA,
    secondaryCTA,
    architectureWarnings,
  };
}

/* ── Visual Signature Plan (Phase 9E-1) — CSS/SVG/front-end-only ───────────────
 * A concept-specific visual signature so the build reads as art-directed, not a
 * generic stack of dark SaaS cards. THIS IS NOT image/video generation and NEVER
 * calls an external API — it only chooses which composed CSS/SVG visual modules
 * the preview should render (chat-flow rail, integration orbit, trust stack, …)
 * plus honest motion hints. Distinct from the Phase-5 art-direction VisualAssetPlan
 * (which stays as-is); this drives the preview's foreground signature visuals. */
export type VisualSignatureHeroType =
  | 'chat-flow' | 'product-flow' | 'integration-orbit' | 'dashboard-glass'
  | 'editorial-collage' | 'code-rain' | 'timeline-rail' | 'abstract-system';

export interface VisualSignaturePlan {
  /** A short, memorable name for the page's visual identity (e.g. "Storefront chat flow rail"). */
  visualSignature: string;
  /** The narrative the visuals explain (e.g. "shopper question → recommendation → policy → handoff"). */
  primaryMotif: string;
  heroVisualType: VisualSignatureHeroType;
  /** Per-section visual direction, matched to real section ids/names where possible. */
  sectionVisuals: Array<{ sectionId?: string; sectionName?: string; visualType: string; purpose: string; motionHint?: string }>;
  backgroundMotif: string;
  motionHints: string[];
  /** Named abstract CSS/SVG assets (never real logos/photos). */
  svgAssets: Array<{ name: string; role: string; description: string }>;
  avoidVisuals: string[];
  assetHonestyRules: string[];
  visualAssetWarnings: string[];
}

/**
 * Derive the concept-specific Visual Signature Plan. Pure + deterministic. Reads
 * the brief/concept/ledger + the page architecture so the preview renders a
 * recognizable motif instead of generic cards. Front-end-only: every visual is a
 * composed CSS/SVG illustration from sample copy — no image/video API, no real
 * logos/metrics/testimonials/compliance.
 */
export function deriveVisualSignaturePlan(
  brief: WebBuildBrief,
  sectionItems: Array<{ id: string; name: string }>,
  conceptAuthority: ConceptAuthority | undefined,
  pageArchitecture: PageArchitectureDecision | undefined,
  artDirection: ArtDirectionArtifact | undefined,
  ledger: StrategicThinkingLedger | undefined,
  lang: Lang = 'en',
): VisualSignaturePlan {
  const hay = [brief.coreIdea, brief.type, brief.goal, brief.audience, brief.style, brief.visualMood]
    .filter(Boolean).join(' ').toLowerCase();
  const concept = (ledger?.primaryConcept || conceptAuthority?.primaryConcept || '').toLowerCase();
  const vertical = conceptAuthority?.targetVertical || conceptAuthority?.audienceVertical || ledger?.targetVertical || '';
  const vhay = `${hay} ${vertical}`.toLowerCase();
  const demoIntent = ledger?.demoSurfaceIntent;

  const isAi = concept === 'ai' || concept === 'saas' || /\bai\b|artificial|chatbot|chat\s*bot|assistant|agentic|\bllm\b|asistan/.test(hay);
  const isCommerce = /ecommerce|e-?commerce|storefront|\bstore\b|\bshop\b|retail|catalog|mağaza|e-?ticaret/.test(vhay);
  const isMarketplace = concept === 'marketplace' || /marketplace|listings?|classifieds?|multi-?vendor|pazaryeri/.test(vhay);
  const isDev = /developer|\bdev\b|\bcode\b|\bcli\b|\bapi\b|sdk|terminal|deploy|programming|engineer|kod|yazılımcı/.test(hay);
  const isLocalOrEditorial = /restaurant|cafe|salon|clinic|dental|landscap|portfolio|photograph|studio|gallery|hotel|event|wedding|restoran|kuaför|klinik|portföy/.test(vhay)
    || ['landscaping', 'localservice', 'hospitality', 'portfolio', 'medical', 'legal', 'event', 'realestate'].includes(concept);
  // Phase 12F — chat-flow / conversation / shopper visuals require EXPLICIT chat evidence
  // (or the ledger's already-corrected chat-demo family), never bare "AI"/"assistant".
  const wantsChat = demoIntent === 'chat-demo' || hasExplicitChatIntent(hay);
  // A storefront-chat visual needs a genuine shopping-assistant chatbot: explicit chat AND commerce.
  const aiCommerce = wantsChat && isCommerce;

  // ── Hero visual signature — the single strongest identity choice. ──
  const heroVisualType: VisualSignatureHeroType = (() => {
    if (isLocalOrEditorial && !isAi) return 'editorial-collage';
    if (aiCommerce || (isAi && wantsChat)) return 'chat-flow';
    if (isDev) return 'code-rain';
    if (isMarketplace || (isCommerce && !isAi)) return 'editorial-collage';
    if (demoIntent === 'dashboard-demo') return 'dashboard-glass';
    if (isAi) return 'product-flow';
    if (pageArchitecture?.integrationsNeeded) return 'integration-orbit';
    return 'abstract-system';
  })();

  // ── Named signature + motif (concept-specific, honest). ──
  const { visualSignature, primaryMotif } = (() => {
    if (aiCommerce) return {
      visualSignature: L(lang, 'Storefront chat flow rail', 'Mağaza sohbet akış rayı'),
      primaryMotif: L(lang, 'shopper question → product recommendation → policy answer → human handoff',
        'alışverişçi sorusu → ürün önerisi → politika yanıtı → insana devir'),
    };
    if (isAi && wantsChat) return {
      visualSignature: L(lang, 'Conversation orbit', 'Sohbet yörüngesi'),
      primaryMotif: L(lang, 'question → assistant reasoning → grounded answer → next best action',
        'soru → asistan muhakemesi → temellendirilmiş yanıt → sonraki en iyi eylem'),
    };
    if (isDev) return {
      visualSignature: L(lang, 'Command & deploy rail', 'Komut ve dağıtım rayı'),
      primaryMotif: L(lang, 'write → run → build → deploy', 'yaz → çalıştır → derle → dağıt'),
    };
    if (isMarketplace || (isCommerce && !isAi)) return {
      visualSignature: L(lang, 'Product recommendation path', 'Ürün öneri yolu'),
      primaryMotif: L(lang, 'browse → filter → compare → checkout', 'gözat → filtrele → karşılaştır → öde'),
    };
    if (isLocalOrEditorial) return {
      visualSignature: L(lang, 'Editorial service journey', 'Editoryal hizmet yolculuğu'),
      primaryMotif: L(lang, 'discover → experience → book', 'keşfet → deneyimle → rezerve et'),
    };
    return {
      visualSignature: L(lang, 'Abstract system diagram', 'Soyut sistem diyagramı'),
      primaryMotif: L(lang, 'input → process → outcome', 'girdi → süreç → sonuç'),
    };
  })();

  // ── Per-section visuals matched to real sections by role. IDs are read-only. ──
  const sectionVisuals: VisualSignaturePlan['sectionVisuals'] = [];
  const seenRole = new Set<string>();
  const push = (s: { id: string; name: string }, visualType: string, purpose: string, motionHint?: string) => {
    if (seenRole.has(visualType)) return;
    seenRole.add(visualType);
    sectionVisuals.push({ sectionId: s.id, sectionName: s.name, visualType, purpose, motionHint });
  };
  for (const s of sectionItems || []) {
    const key = `${s.id} ${s.name}`;
    if (SECTION_ROLE_RE.hero.test(key)) {
      push(s, heroVisualType, L(lang, 'Primary hero signature visual', 'Ana hero imza görseli'),
        L(lang, 'slow glow + staged reveal', 'yavaş parıltı + aşamalı ortaya çıkış'));
    } else if (SECTION_ROLE_RE.demo.test(key)) {
      push(s, wantsChat ? 'chat-flow-rail' : 'product-card-rail',
        L(lang, 'Front-end-only demo of the concept from sample copy', 'Konseptin örnek metinden yalnızca ön-yüz demosu'),
        L(lang, 'floating chat bubbles + rail movement', 'yüzen sohbet balonları + ray hareketi'));
    } else if (SECTION_ROLE_RE.integrations.test(key)) {
      push(s, 'integration-orbit',
        L(lang, 'Abstract integration nodes (Store, Catalog, Helpdesk, Email) — no real logos', 'Soyut entegrasyon düğümleri (Mağaza, Katalog, Yardım, E-posta) — gerçek logo yok'),
        L(lang, 'orbit line drift + pulsing connection dots', 'yörünge çizgisi kayması + nabız atan bağlantı noktaları'));
    } else if (SECTION_ROLE_RE.security.test(key)) {
      push(s, 'trust-control-stack',
        L(lang, 'Honest trust controls (shield / key / checklist) — no fake SOC2/ISO', 'Dürüst güven kontrolleri (kalkan / anahtar / kontrol listesi) — sahte SOC2/ISO yok'),
        L(lang, 'staged check pulse', 'aşamalı onay nabzı'));
    } else if (SECTION_ROLE_RE.flow.test(key)) {
      push(s, 'timeline-rail',
        L(lang, 'The concept flow as a staged rail', 'Konsept akışı aşamalı bir ray olarak'),
        L(lang, 'staged rail highlight', 'aşamalı ray vurgusu'));
    } else if (SECTION_ROLE_RE.contact.test(key)) {
      push(s, 'handoff-form',
        L(lang, 'Simple contact/booking form + handoff chip', 'Basit iletişim/rezervasyon formu + devir çipi'),
        L(lang, 'handoff pulse', 'devir nabzı'));
    }
  }

  const backgroundMotif = aiCommerce || (isAi && wantsChat)
    ? L(lang, 'Subtle conversation path / orbit lines — not a generic dashboard grid.', 'İnce sohbet yolu / yörünge çizgileri — genel bir panel gridi değil.')
    : isDev ? L(lang, 'Faint code-rain / grid-terminal shimmer, low opacity.', 'Soluk kod-yağmuru / grid-terminal parıltısı, düşük opaklık.')
    : isLocalOrEditorial ? L(lang, 'Editorial contour / collage seams, warm and calm.', 'Editoryal kontur / kolaj dikişleri, sıcak ve sakin.')
    : L(lang, 'Restrained accent path lines on a tonal surface — no boxed cards.', 'Tonal bir yüzeyde ölçülü vurgu yol çizgileri — kutulanmış kart yok.');

  const motionHints = uniq([
    L(lang, 'floating cards drift (very subtle)', 'yüzen kartlar kayması (çok ince)'),
    L(lang, 'pulsing connection dot on active node', 'aktif düğümde nabız atan bağlantı noktası'),
    L(lang, 'slow glow trail on the primary path', 'birincil yolda yavaş parıltı izi'),
    ...(wantsChat ? [L(lang, 'staged handoff pulse between bubbles', 'balonlar arası aşamalı devir nabzı')] : []),
    ...(pageArchitecture?.integrationsNeeded ? [L(lang, 'orbit line rotation (reduced-motion safe)', 'yörünge çizgisi dönüşü (reduced-motion güvenli)')] : []),
    L(lang, 'hover lift on interactive cards', 'etkileşimli kartlarda hover yükselmesi'),
  ]);

  const svgAssetsRaw: VisualSignaturePlan['svgAssets'] = [
    { name: L(lang, 'Path rail', 'Yol rayı'), role: 'background', description: L(lang, 'A thin staged rail connecting the motif steps.', 'Motif adımlarını bağlayan ince aşamalı bir ray.') },
    ...(wantsChat ? [{ name: L(lang, 'Chat bubbles', 'Sohbet balonları'), role: 'hero/demo', description: L(lang, 'Shopper + assistant bubbles with a recommendation card.', 'Alışverişçi + asistan balonları ve bir öneri kartı.') }] : []),
    ...((pageArchitecture?.integrationsNeeded || isCommerce) ? [{ name: L(lang, 'Integration nodes', 'Entegrasyon düğümleri'), role: 'integrations', description: L(lang, 'Abstract labelled nodes on an orbit — generic labels, no brand logos.', 'Bir yörüngede soyut etiketli düğümler — genel etiketler, marka logosu yok.') }] : []),
    ...(pageArchitecture?.securityNeeded ? [{ name: L(lang, 'Trust glyphs', 'Güven glifleri'), role: 'security', description: L(lang, 'Shield / key / checklist glyphs — illustrative, not certifications.', 'Kalkan / anahtar / kontrol listesi glifleri — açıklayıcı, sertifika değil.') }] : []),
    ...(isDev ? [{ name: L(lang, 'Code rain', 'Kod yağmuru'), role: 'hero', description: L(lang, 'Faint falling monospace glyph columns.', 'Soluk düşen tek aralıklı glif sütunları.') }] : []),
  ];
  const svgSeen = new Set<string>();
  const svgAssets = svgAssetsRaw.filter((a) => (svgSeen.has(a.name) ? false : (svgSeen.add(a.name), true)));

  const avoidVisuals = uniq([
    L(lang, 'generic dark SaaS card grid as the only visual', 'tek görsel olarak genel koyu SaaS kart gridi'),
    L(lang, 'stock-photo-style hero or blank placeholder boxes', 'stok-fotoğraf tarzı hero veya boş yer tutucu kutular'),
    ...(!isLocalOrEditorial ? [] : [L(lang, 'forced dashboard/chat visuals on a service/portfolio concept', 'hizmet/portföy konseptinde zorlanmış panel/sohbet görselleri')]),
    ...((!(demoIntent === 'dashboard-demo')) ? [L(lang, 'a dashboard mockup when no dashboard was requested', 'panel istenmediğinde bir panel mockup\'ı')] : []),
    L(lang, 'real brand logos in the integration visual', 'entegrasyon görselinde gerçek marka logoları'),
  ]);

  const assetHonestyRules = uniq([
    L(lang, 'All visuals are illustrative, front-end-only, sample/static — concept explanation, not real data.', 'Tüm görseller açıklayıcı, yalnızca ön-yüz, örnek/statik — gerçek veri değil, konsept açıklaması.'),
    L(lang, 'No fake logos, customer names, testimonials, metrics or SOC2/ISO/certifications.', 'Sahte logo, müşteri adı, referans, metrik veya SOC2/ISO/sertifika yok.'),
    L(lang, 'No claim of real AI/backend/catalog/policy lookup — any demo is a local sample.', 'Gerçek AI/backend/katalog/politika sorgusu iddiası yok — her demo yerel bir örnektir.'),
    L(lang, 'Decorative SVG is aria-hidden; motion respects prefers-reduced-motion.', 'Dekoratif SVG aria-hidden\'dır; hareket prefers-reduced-motion\'a saygı gösterir.'),
    // Inherit the Phase-5 art-direction visual constraints so both plans agree.
    ...((artDirection?.visualAssetPlan?.constraints || []).slice(0, 2)),
  ]);

  const visualAssetWarnings: string[] = [];
  if (isLocalOrEditorial && (heroVisualType === 'chat-flow' || heroVisualType === 'dashboard-glass')) {
    visualAssetWarnings.push(L(lang, 'Service/portfolio concept should not use a dashboard/chat hero — using an editorial visual instead.', 'Hizmet/portföy konsepti panel/sohbet hero kullanmamalı — bunun yerine editoryal görsel kullanılıyor.'));
  }
  if (aiCommerce && !sectionVisuals.some((v) => v.visualType === 'trust-control-stack') && pageArchitecture?.securityNeeded) {
    visualAssetWarnings.push(L(lang, 'AI/ecommerce build has no trust-control visual — add an honest Security & Store Trust section to host it.', 'AI/e-ticaret yapısında güven-kontrol görseli yok — barındırmak için dürüst bir Güvenlik ve Mağaza Güveni bölümü ekleyin.'));
  }

  return {
    visualSignature,
    primaryMotif,
    heroVisualType,
    sectionVisuals,
    backgroundMotif,
    motionHints,
    svgAssets,
    avoidVisuals,
    assetHonestyRules,
    visualAssetWarnings,
  };
}

interface ResearchSignals {
  // business model
  booking: boolean; subscription: boolean; purchase: boolean; saas: boolean;
  application: boolean; leadgen: boolean; content: boolean;
  // audience / domain
  b2b: boolean; kids: boolean; luxury: boolean; technical: boolean;
  health: boolean; finance: boolean; creative: boolean; minimal: boolean;
  // device lean
  desktopFirst: boolean; mobileFirst: boolean;
  // ── precise concept category + category booleans (from detectConceptCategory) ──
  category: ConceptCategory;
  archive: boolean; hospitality: boolean; landscaping: boolean; localService: boolean;
  legal: boolean; medical: boolean; ai: boolean; marketplace: boolean;
  education: boolean; nonprofit: boolean; portfolio: boolean; industrial: boolean;
  event: boolean; realEstate: boolean;
}

const has = (text: string, ...words: string[]): boolean =>
  words.some((w) => text.includes(w));

/** Scan the combined idea/brief/inferred text (+ the raw prompt, the richest
 *  concept signal) for real model + audience signals and the concept category. */
function researchSignals(brief: WebBuildBrief, inferred: InferredBrief, prompt = ''): ResearchSignals {
  const t = [
    prompt,
    brief.type, brief.audience, brief.goal, brief.coreIdea, brief.visitorIntent,
    brief.conversionStrategy, brief.style, brief.visualMood,
    inferred.businessType, inferred.targetAudience, inferred.conversionGoal,
    inferred.tone, inferred.visualStyle, inferred.industry, inferred.layoutArchetype,
    (inferred.items || []).join(' '),
  ].filter(Boolean).join(' ').toLowerCase();

  // CONCEPT AUTHORITY (Phase 5): the primary concept is derived from the product
  // noun in the PROMPT, not the blended full text — so a "<product> for <vertical>"
  // prompt (e.g. "AI chatbot for ecommerce stores") never lets the target
  // vertical's commerce language over-weight and flip the concept to marketplace.
  const category = splitConceptAuthority(prompt, t).primary;

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

  // Category booleans — the concept category is exclusive (best single match),
  // so downstream derivations can branch on a specific, confident concept.
  const archive = category === 'archive';
  const hospitality = category === 'hospitality' || inferred.industry === 'restaurant';
  const landscaping = category === 'landscaping' || inferred.industry === 'landscaping';
  const legal = category === 'legal';
  const medical = category === 'medical';
  const ai = category === 'ai';
  const marketplace = category === 'marketplace' || inferred.industry === 'ecommerce';
  const education = category === 'education';
  const nonprofit = category === 'nonprofit';
  const portfolio = category === 'portfolio' || inferred.industry === 'portfolio' || inferred.industry === 'agency';
  const industrial = category === 'industrial';
  const event = category === 'event';
  const realEstate = category === 'real_estate';
  // Local service = an at-a-place trade booking concept (not a product/SaaS).
  const localService = inferred.industry === 'local_service' || landscaping
    || has(t, 'plumb', 'electric', 'cleaning', 'repair', 'barber', 'salon', 'kuaför', 'berber', 'tesisat', 'temizlik', 'tamir', 'nakliyat', 'locksmith', 'çilingir', 'boya');

  return {
    booking, subscription, purchase, saas, application, leadgen, content,
    b2b, kids, luxury, technical, health, finance, creative, minimal,
    desktopFirst, mobileFirst,
    category,
    archive, hospitality, landscaping, localService, legal, medical, ai,
    marketplace, education, nonprofit, portfolio, industrial, event, realEstate,
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

  // ── Concept-specific pages — the strongest lever against a generic build. ──
  if (sig.archive) {
    pages.push(P('Collection Index', L(lang, 'Browse the whole collection', 'Tüm koleksiyonu gez'), 'must-have', L(lang, 'The catalog IS the product', 'Katalog ürünün kendisi')));
    pages.push(P('Item Detail', L(lang, 'Show one item with full provenance', 'Bir öğeyi tam menşeiyle göster'), 'must-have', L(lang, 'Researchers need per-item depth', 'Araştırmacılar öğe başına derinlik ister')));
    pages.push(P('Search & Filters', L(lang, 'Find items by era/type/tag', 'Öğeleri dönem/tür/etikete göre bul'), 'must-have', L(lang, 'A collection is useless without retrieval', 'Erişim olmadan koleksiyon işe yaramaz')));
    pages.push(P('Provenance & Curation', L(lang, 'Prove authenticity and curation', 'Özgünlük ve küratörlüğü kanıtla'), 'should-have', L(lang, 'Trust is authenticity here', 'Burada güven, özgünlüktür')));
  }
  if (sig.hospitality) {
    pages.push(P('Menu', L(lang, 'Show the offering that sells', 'Satışı yapan teklifi göster'), 'must-have', L(lang, 'The menu is the decision', 'Menü kararın kendisi')));
    pages.push(P('Reservations', L(lang, 'Let guests book a table', 'Misafir masa ayırtsın'), 'must-have', L(lang, 'The conversion is a reservation', 'Dönüşüm bir rezervasyon')));
    pages.push(P('Gallery & Ambience', L(lang, 'Sell the atmosphere', 'Atmosferi sat'), 'should-have', L(lang, 'Hospitality sells on feel', 'Ağırlama his üzerinden satar')));
    pages.push(P('Location & Hours', L(lang, 'Make visiting effortless', 'Ziyareti kolaylaştır'), 'should-have', L(lang, 'Local intent needs the practicals', 'Yerel niyet pratikleri ister')));
  }
  if (sig.landscaping) {
    pages.push(P('Projects', L(lang, 'Prove quality with real outdoor work', 'Gerçek dış mekan işleriyle kaliteyi kanıtla'), 'must-have', L(lang, 'Outdoor work is proven visually', 'Dış mekan işi görselle kanıtlanır')));
    pages.push(P('Before & After', L(lang, 'Show the transformation', 'Dönüşümü göster'), 'should-have', L(lang, 'Outcome is comparable', 'Sonuç karşılaştırılabilir')));
    pages.push(P('Process', L(lang, 'Explain concept-to-planting', 'Konseptten uygulamaya anlat'), 'should-have', L(lang, 'A premium service reassures on process', 'Premium hizmet süreçle güven verir')));
  }
  if (sig.legal || sig.medical) {
    pages.push(P(sig.legal ? 'Practice Areas' : 'Treatments', L(lang, 'Lay out exactly what is offered', 'Sunulanı tam olarak düzenle'), 'must-have', L(lang, 'Visitors match need to service', 'Ziyaretçi ihtiyacı hizmetle eşler')));
    pages.push(P('Credentials', L(lang, 'Show licenses, team and experience', 'Lisans, ekip ve deneyimi göster'), 'must-have', L(lang, 'High-stakes trust needs proof', 'Yüksek riskli güven kanıt ister')));
    pages.push(P('Consultation', L(lang, 'Make the first step easy', 'İlk adımı kolaylaştır'), 'must-have', L(lang, 'The conversion is a consult', 'Dönüşüm bir danışma')));
  }
  if (sig.education) {
    pages.push(P('Curriculum', L(lang, 'Show what is taught', 'Neyin öğretildiğini göster'), 'must-have', L(lang, 'Learners judge the syllabus', 'Öğrenenler müfredatı değerlendirir')));
    pages.push(P('Outcomes', L(lang, 'Prove the result learners get', 'Öğrenenlerin elde ettiği sonucu kanıtla'), 'must-have', L(lang, 'Education is sold on outcomes', 'Eğitim kazanımla satılır')));
    pages.push(P('Instructors', L(lang, 'Prove who teaches', 'Kimin öğrettiğini kanıtla'), 'should-have', L(lang, 'Credibility is the teacher', 'İtibar öğretmendir')));
    pages.push(P('Enroll', L(lang, 'Convert to enrollment', 'Kayda dönüştür'), 'must-have', L(lang, 'The action is enrolling', 'Eylem kayıt olmak')));
  }
  if (sig.nonprofit) {
    pages.push(P('Our Cause', L(lang, 'Explain the mission clearly', 'Misyonu net anlat'), 'must-have', L(lang, 'People give to a clear cause', 'İnsanlar net bir davaya bağış yapar')));
    pages.push(P('Impact', L(lang, 'Show measurable impact', 'Ölçülebilir etkiyi göster'), 'must-have', L(lang, 'Proof of impact drives giving', 'Etki kanıtı bağışı yönlendirir')));
    pages.push(P('Ways to Give', L(lang, 'Make donating effortless', 'Bağışı kolaylaştır'), 'must-have', L(lang, 'The conversion is a donation', 'Dönüşüm bir bağış')));
  }
  if (sig.event) {
    pages.push(P('Speakers', L(lang, 'Sell the lineup', 'Kadroyu sat'), 'must-have', L(lang, 'Speakers justify the ticket', 'Konuşmacılar bileti haklı çıkarır')));
    pages.push(P('Agenda', L(lang, 'Show the schedule', 'Programı göster'), 'must-have', L(lang, 'Attendees plan around the agenda', 'Katılımcılar programa göre planlar')));
    pages.push(P('Venue', L(lang, 'Make attending practical', 'Katılımı pratik kıl'), 'should-have', L(lang, 'Location/logistics matter', 'Konum/lojistik önemli')));
    pages.push(P('Register', L(lang, 'Convert to a ticket', 'Bilete dönüştür'), 'must-have', L(lang, 'The action is registering', 'Eylem kayıt olmak')));
  }
  if (sig.industrial) {
    pages.push(P('Capabilities', L(lang, 'Lay out what you can build/supply', 'Ne üretip tedarik edebileceğini düzenle'), 'must-have', L(lang, 'Technical buyers scan capability', 'Teknik alıcılar yetkinliği tarar')));
    pages.push(P('Specifications', L(lang, 'Give precise specs', 'Kesin teknik özellikler ver'), 'should-have', L(lang, 'B2B decides on detail', 'B2B detayla karar verir')));
    pages.push(P('Certifications', L(lang, 'Show standards/compliance', 'Standart/uyum göster'), 'should-have', L(lang, 'Compliance is a gate', 'Uyum bir eşiktir')));
  }
  if (sig.realEstate) {
    pages.push(P('Listings', L(lang, 'Browse available properties', 'Mevcut gayrimenkulleri gez'), 'must-have', L(lang, 'The listing IS the product', 'İlan ürünün kendisi')));
    pages.push(P('Property Detail', L(lang, 'Show one property fully', 'Bir gayrimenkulü tam göster'), 'must-have', L(lang, 'Buyers decide per property', 'Alıcılar gayrimenkul başına karar verir')));
  }

  pages.push(P('About', L(lang, 'Build trust in who is behind it', 'Arkasındaki ekibe güven kur'),
    sig.finance || sig.health || sig.luxury || sig.legal || sig.medical || sig.nonprofit ? 'should-have' : 'optional',
    L(lang, 'Higher-trust concepts need a human story', 'Yüksek güven gerektiren konseptler insani hikâye ister')));
  pages.push(P('Contact', L(lang, 'Give a direct line for questions', 'Sorular için doğrudan hat ver'),
    sig.leadgen || sig.b2b || sig.industrial ? 'must-have' : 'should-have',
    L(lang, 'Reduces friction for undecided visitors', 'Kararsız ziyaretçiler için sürtünmeyi azaltır')));
  // Dedupe by page name (concept blocks can overlap with the general set); keep
  // the first (highest-intent) occurrence.
  const seen = new Set<string>();
  const out: RecommendedPage[] = [];
  for (const p of pages) if (!seen.has(p.name)) { seen.add(p.name); out.push(p); }
  return out;
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

  // ── Concept-specific components — concrete, downstream-buildable modules. ──
  if (sig.archive) {
    list.push(C('Searchable Archive Grid', L(lang, 'Browse the collection at scale', 'Koleksiyonu ölçekli gez'), 'must-have', 'Collection Index', L(lang, 'The catalog is the core surface', 'Katalog çekirdek yüzeydir')));
    list.push(C('Filter Sidebar', L(lang, 'Narrow by era/type/tag', 'Dönem/tür/etikete göre daralt'), 'must-have', 'Collection Index', L(lang, 'Retrieval makes an archive usable', 'Erişim arşivi kullanılır kılar')));
    list.push(C('Provenance Panel', L(lang, 'Show source/authenticity per item', 'Öğe başına kaynak/özgünlük göster'), 'should-have', 'Item Detail', L(lang, 'Authenticity is the trust here', 'Buradaki güven özgünlüktür')));
  }
  if (sig.hospitality) {
    list.push(C('Menu Board', L(lang, 'Present dishes appetizingly', 'Yemekleri iştah açıcı sun'), 'must-have', 'Menu', L(lang, 'The menu drives the visit', 'Menü ziyareti yönlendirir')));
    list.push(C('Reservation Module', L(lang, 'Capture the booking', 'Rezervasyonu al'), 'must-have', 'Reservations', L(lang, 'The conversion is a reservation', 'Dönüşüm bir rezervasyon')));
  }
  if (sig.landscaping || sig.localService || sig.creative) list.push(C('BeforeAfter', L(lang, 'Show transformation', 'Dönüşümü göster'), 'should-have', 'Gallery', L(lang, 'Outcome is visual and comparable', 'Sonuç görsel ve karşılaştırılabilir')));
  if (sig.landscaping || sig.localService || sig.legal || sig.medical || sig.industrial) list.push(C('Process Timeline', L(lang, 'Explain how it works step by step', 'Nasıl işlediğini adım adım anlat'), 'should-have', 'Process', L(lang, 'A service reassures on process', 'Hizmet süreçle güven verir')));
  if (sig.legal || sig.medical) list.push(C('Credential Cards', L(lang, 'Surface licenses/experience', 'Lisans/deneyimi öne çıkar'), 'must-have', 'Credentials', L(lang, 'High-stakes trust needs proof', 'Yüksek riskli güven kanıt ister')));
  if (sig.education) {
    list.push(C('Curriculum Outline', L(lang, 'Lay out the syllabus', 'Müfredatı düzenle'), 'must-have', 'Curriculum', L(lang, 'Learners judge the syllabus', 'Öğrenenler müfredatı değerlendirir')));
    list.push(C('Outcome Metrics', L(lang, 'Prove the result', 'Sonucu kanıtla'), 'should-have', 'Outcomes', L(lang, 'Outcomes drive enrollment', 'Kazanımlar kaydı yönlendirir')));
  }
  if (sig.nonprofit) {
    list.push(C('Impact Metrics', L(lang, 'Show measurable impact', 'Ölçülebilir etkiyi göster'), 'must-have', 'Impact', L(lang, 'Impact proof drives giving', 'Etki kanıtı bağışı yönlendirir')));
    list.push(C('Donation Module', L(lang, 'Make giving effortless', 'Bağışı kolaylaştır'), 'must-have', 'Ways to Give', L(lang, 'The conversion is a donation', 'Dönüşüm bir bağış')));
  }
  if (sig.event) {
    list.push(C('Speaker Cards', L(lang, 'Sell the lineup', 'Kadroyu sat'), 'must-have', 'Speakers', L(lang, 'Speakers justify the ticket', 'Konuşmacılar bileti haklı çıkarır')));
    list.push(C('Agenda Timeline', L(lang, 'Show the schedule', 'Programı göster'), 'must-have', 'Agenda', L(lang, 'Attendees plan around the agenda', 'Katılımcılar programa göre planlar')));
  }
  if (sig.industrial) list.push(C('Spec Table', L(lang, 'Give precise specifications', 'Kesin teknik özellikler ver'), 'should-have', 'Specifications', L(lang, 'B2B decides on detail', 'B2B detayla karar verir')));
  if (sig.marketplace || sig.realEstate) list.push(C('Catalog Cards', L(lang, 'Browse items/listings with proof', 'Öğeleri/ilanları kanıtla gez'), 'must-have', 'Listings', L(lang, 'Browsing is the core action', 'Gezinme çekirdek eylemdir')));

  list.push(C('FAQ', L(lang, 'Remove last-mile doubts', 'Son tereddütleri gider'), 'should-have', 'Home', L(lang, 'Answers objections before they bounce', 'İtirazları ayrılmadan önce yanıtlar')));
  list.push(C('CTA', L(lang, 'Repeat the single action', 'Tek eylemi tekrarla'), 'must-have', 'Home', L(lang, 'A closing push toward conversion', 'Dönüşüme kapanış itişi')));
  list.push(C('Footer', L(lang, 'Wayfinding + trust + contact', 'Yönlendirme + güven + iletişim'), 'must-have', 'All', L(lang, 'Baseline structure and credibility', 'Temel yapı ve itibar')));
  // Dedupe by component name (concept blocks can overlap with the general set).
  const seen = new Set<string>();
  const out: RecommendedComponent[] = [];
  for (const c of list) if (!seen.has(c.name)) { seen.add(c.name); out.push(c); }
  return out;
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

/** Compose the explicit hand-off for the UI / Art Director Agent. Consumes the
 *  concept category (via sig) + the derived trust barriers so the hand-off is
 *  specific: what to emphasize/avoid, the trust proof to foreground, the imagery
 *  direction, and a concrete anti-template warning for this exact concept. */
function deriveUiAgentInstructions(
  brief: WebBuildBrief, inferred: InferredBrief, sig: ResearchSignals,
  target: TargetUserAnalysis, pages: RecommendedPage[], comps: RecommendedComponent[],
  style: VisualStyleRecommendation, color: ColorPsychology, lang: Lang,
  trustBarriers: string[] = [],
): UiAgentInstructions {
  return {
    mustEmphasize: uniq([
      style.styleType,
      color.primaryMood,
      L(lang, `A single obvious path to ${brief.primaryCTA || inferred.primaryCTA}`,
        `${brief.primaryCTA || inferred.primaryCTA} için tek net yol`),
      trustBarriers[0] || (sig.finance || sig.health || sig.b2b ? L(lang, 'Credibility and proof early', 'İtibar ve kanıt erken') : ''),
    ]),
    mustAvoid: uniq([
      ...color.avoidColors,
      antiTemplateWarning(sig, lang),
      L(lang, 'Generic centered hero + three-card grid', 'Jenerik ortalı hero + üç kart grid'),
      L(lang, 'Stock imagery and blank placeholder boxes', 'Stok görsel ve boş yer tutucu kutular'),
    ]),
    recommendedVisualDirection: `${style.styleType} · ${style.imageryType} (${style.premiumLevel})`,
    recommendedTypography: sig.luxury || sig.creative || sig.archive
      ? L(lang, 'Editorial serif headlines + clean sans body', 'Editoryal serif başlıklar + temiz sans gövde')
      : L(lang, 'Modern geometric sans headlines + neutral sans body', 'Modern geometrik sans başlıklar + nötr sans gövde'),
    recommendedComponents: comps.filter((c) => c.priority === 'must-have').map((c) => c.name),
    recommendedPages: pages.filter((p) => p.priority !== 'optional').map((p) => p.name),
    recommendedPalette: color.recommendedPalette,
    targetUserSummary: [target.role, target.devicePreference, target.buyingMotivation].filter(Boolean).join(' · '),
    conversionFocus: brief.conversionStrategy
      || L(lang, `Drive to ${brief.primaryCTA || inferred.primaryCTA}`, `Şuna yönlendir: ${brief.primaryCTA || inferred.primaryCTA}`),
    // ── Stronger, category-aware hand-off fields. ──
    trustFocus: trustBarriers.slice(0, 2).join(' · ') || undefined,
    imageryDirection: L(lang,
      `${style.imageryType} — composed, concept-specific, never stock or blank boxes.`,
      `${style.imageryType} — kompoze, konsepte özgü, asla stok veya boş kutu değil.`),
    layoutWarning: antiTemplateWarning(sig, lang),
  };
}

/* ── Concept understanding + trust/conversion helpers (Research Phase 1) ────
 * Small, pure, deterministic mappings from the detected concept category to the
 * specific content model, decision, conversion and proof a real site in that
 * category needs. They power the ConceptProfile hand-off and the anti-generic
 * guard. None throw; every lookup falls back to a sensible default. */

/** Category → (content type, business model) descriptor pair (EN, TR). */
const CATEGORY_CONTENT: Partial<Record<ConceptCategory, { content: [string, string]; model: [string, string] }>> = {
  archive:       { content: ['catalog / editorial archive', 'katalog / editoryal arşiv'], model: ['a curated collection people browse and research', 'insanların gezip araştırdığı küratörlü bir koleksiyon'] },
  hospitality:   { content: ['menu + atmosphere', 'menü + atmosfer'], model: ['a place people reserve and visit', 'insanların rezerve edip ziyaret ettiği bir mekân'] },
  landscaping:   { content: ['project gallery + service', 'proje galerisi + hizmet'], model: ['a premium outdoor design service', 'premium bir dış mekan tasarım hizmeti'] },
  local_service: { content: ['service + local proof', 'hizmet + yerel kanıt'], model: ['a local service booked by appointment', 'randevu ile alınan yerel bir hizmet'] },
  legal:         { content: ['service + credentials', 'hizmet + referanslar'], model: ['a high-trust professional service', 'yüksek güven gerektiren profesyonel bir hizmet'] },
  medical:       { content: ['service + credentials', 'hizmet + referanslar'], model: ['a care service booked by appointment', 'randevu ile alınan bir bakım hizmeti'] },
  ai:            { content: ['product demo + capability', 'ürün demosu + yetenek'], model: ['an AI product with a demo/trial goal', 'demo/deneme hedefli bir AI ürünü'] },
  saas:          { content: ['product demo + capability', 'ürün demosu + yetenek'], model: ['a software product with a signup/demo goal', 'kayıt/demo hedefli bir yazılım ürünü'] },
  marketplace:   { content: ['product catalog', 'ürün kataloğu'], model: ['a store where people browse and buy', 'insanların gezip satın aldığı bir mağaza'] },
  education:     { content: ['curriculum + outcomes', 'müfredat + kazanımlar'], model: ['a learning program people enroll in', 'insanların kayıt olduğu bir öğrenme programı'] },
  nonprofit:     { content: ['story + impact', 'hikâye + etki'], model: ['a cause people support and donate to', 'insanların desteklediği ve bağış yaptığı bir dava'] },
  portfolio:     { content: ['selected work', 'seçili işler'], model: ['a body of work that earns an inquiry', 'bir iş talebi kazandıran işler bütünü'] },
  industrial:    { content: ['capabilities + specs', 'yetenekler + teknik özellikler'], model: ['a technical supplier evaluated on capability', 'yetkinlik üzerinden değerlendirilen teknik bir tedarikçi'] },
  event:         { content: ['schedule + speakers', 'program + konuşmacılar'], model: ['an event people register or buy tickets for', 'insanların kayıt olduğu ya da bilet aldığı bir etkinlik'] },
  real_estate:   { content: ['listings + detail', 'ilanlar + detay'], model: ['properties people browse and enquire about', 'insanların gezip bilgi aldığı gayrimenkuller'] },
  finance:       { content: ['proof + product', 'kanıt + ürün'], model: ['a financial product evaluated on trust', 'güven üzerinden değerlendirilen bir finansal ürün'] },
};

/** Category → the decision the visitor must make (EN, TR). */
const CATEGORY_DECISION: Partial<Record<ConceptCategory, [string, string]>> = {
  archive: ['Is this collection authentic, well-curated and worth exploring?', 'Bu koleksiyon özgün, iyi küratörlü ve keşfetmeye değer mi?'],
  hospitality: ['Is this the right place — and can I get a table?', 'Doğru mekân mı — ve masa bulabilir miyim?'],
  landscaping: ['Can they deliver this quality outdoors for me?', 'Bu kaliteyi benim dış mekanımda sağlayabilirler mi?'],
  local_service: ['Are they reliable, fairly priced and available?', 'Güvenilir, adil fiyatlı ve müsait mi?'],
  legal: ['Can I trust them with something high-stakes?', 'Yüksek riskli bir konuda onlara güvenebilir miyim?'],
  medical: ['Are they credible and will they care for me well?', 'Güvenilir mi ve bana iyi bakacaklar mı?'],
  ai: ['Does it actually work and is it worth trying?', 'Gerçekten işe yarıyor mu ve denemeye değer mi?'],
  saas: ['Does it solve my problem and is it worth a demo?', 'Sorunumu çözüyor mu ve demoyu hak ediyor mu?'],
  marketplace: ['Is this worth buying and safe to check out?', 'Satın almaya değer mi ve ödeme güvenli mi?'],
  education: ['Will this get me the outcome I want?', 'İstediğim sonuca ulaştıracak mı?'],
  nonprofit: ['Is this cause real and worth supporting?', 'Bu dava gerçek ve desteklemeye değer mi?'],
  portfolio: ['Is this the right talent for my project?', 'Projem için doğru yetenek bu mu?'],
  industrial: ['Can they meet my specs and scale?', 'Teknik gereksinimlerimi ve ölçeğimi karşılayabilir mi?'],
  event: ['Is this worth my time and my ticket?', 'Zamanıma ve biletime değer mi?'],
  real_estate: ['Is this the right property — and can I enquire?', 'Doğru gayrimenkul mü — ve bilgi alabilir miyim?'],
  finance: ['Can I trust them with my money?', 'Paramı onlara emanet edebilir miyim?'],
};

/** Category → what the visitor is trying to do (EN, TR). */
const CATEGORY_INTENT: Partial<Record<ConceptCategory, [string, string]>> = {
  archive: ['Research, browse and verify items in a collection', 'Bir koleksiyondaki öğeleri araştırmak, gezmek ve doğrulamak'],
  hospitality: ['Check the menu and atmosphere, then book a table', 'Menü ve atmosfere bakıp masa ayırtmak'],
  landscaping: ['See real projects, then request a design or quote', 'Gerçek projeleri görüp tasarım veya teklif istemek'],
  local_service: ['Confirm trust, then book the service', 'Güveni doğrulayıp hizmeti almak'],
  legal: ['Assess credibility, then request a consultation', 'İtibarı değerlendirip danışmanlık istemek'],
  medical: ['Assess credibility, then book an appointment', 'İtibarı değerlendirip randevu almak'],
  ai: ['Understand what it does, then try or watch a demo', 'Ne yaptığını anlayıp demo denemek ya da izlemek'],
  saas: ['Evaluate the product, then start or book a demo', 'Ürünü değerlendirip demo başlatmak ya da planlamak'],
  marketplace: ['Browse products, then buy with confidence', 'Ürünlere göz atıp güvenle satın almak'],
  education: ['Judge the outcome, then enroll', 'Kazanımı değerlendirip kayıt olmak'],
  nonprofit: ['Understand the impact, then give or act', 'Etkiyi anlayıp bağış yapmak ya da harekete geçmek'],
  portfolio: ['Judge the work, then start a project', 'İşleri değerlendirip projeye başlamak'],
  industrial: ['Evaluate capability, then request a quote', 'Yetkinliği değerlendirip teklif istemek'],
  event: ['Check speakers and agenda, then register', 'Konuşmacı ve programa bakıp kayıt olmak'],
  real_estate: ['Browse listings, then enquire', 'İlanlara göz atıp bilgi almak'],
  finance: ['Assess trust, then start or apply', 'Güveni değerlendirip başlamak ya da başvurmak'],
};

/** A concrete anti-template warning tied to the concept category — the strongest
 *  single line the Art Director can act on to avoid a generic build. */
function antiTemplateWarning(sig: ResearchSignals, lang: Lang): string {
  if (sig.archive) return L(lang, 'Not a SaaS dashboard — this is an editorial archive; lead with a catalog/collection index, filters and provenance, not a centered hero + card grid.', 'SaaS panel değil — bu bir editoryal arşiv; ortalı hero + kart grid değil, katalog/koleksiyon indeksi, filtreler ve menşe ile aç.');
  if (sig.hospitality) return L(lang, 'A restaurant sells atmosphere — lead with menu, ambiance imagery and a reservation CTA, not a SaaS hero.', 'Restoran atmosfer satar — SaaS hero değil, menü, ambiyans görselleri ve rezervasyon CTA ile aç.');
  if (sig.landscaping || sig.localService) return L(lang, 'A service is proven by real work — lead with a project gallery / before-after and a quote CTA, not a corporate SaaS template.', 'Hizmet gerçek işle kanıtlanır — kurumsal SaaS şablonu değil, proje galerisi / önce-sonra ve teklif CTA ile aç.');
  if (sig.legal || sig.medical) return L(lang, 'A high-trust service needs credentials and proof above the fold — calm, credible layout, not a flashy SaaS hero.', 'Yüksek güven gerektiren hizmet ilk ekranda referans ve kanıt ister — gösterişli SaaS hero değil, sakin, güvenilir düzen.');
  if (sig.marketplace) return L(lang, 'Commerce needs scannable product browsing — lead with a catalog and product cards, not a single centered hero.', 'Ticaret taranabilir ürün gezinme ister — tek ortalı hero değil, katalog ve ürün kartları ile aç.');
  if (sig.event) return L(lang, 'An event sells momentum — lead with date, speakers/agenda and a register CTA, not a generic product hero.', 'Etkinlik ivme satar — jenerik ürün hero değil, tarih, konuşmacı/program ve kayıt CTA ile aç.');
  if (sig.nonprofit) return L(lang, 'A cause needs a human story and impact — lead with real people and a give/act CTA, not a corporate SaaS look.', 'Bir dava insani hikâye ve etki ister — kurumsal SaaS görünüm değil, gerçek insanlar ve bağış/eylem CTA ile aç.');
  if (sig.education) return L(lang, 'Learning is sold on outcomes — lead with the result, curriculum and enroll CTA, not a vague SaaS hero.', 'Öğrenme kazanımla satılır — muğlak SaaS hero değil, sonuç, müfredat ve kayıt CTA ile aç.');
  if (sig.saas || sig.ai) return L(lang, 'Avoid a vague hero and a three-card grid repeated down the page — show the real product and vary section composition.', 'Muğlak hero ve sayfa boyunca tekrarlanan üç kart grid\'inden kaçın — gerçek ürünü göster ve bölüm kompozisyonunu çeşitlendir.');
  return L(lang, `Do not use a generic centered SaaS hero + three-card grid — it is wrong for a ${sig.category} concept.`, `Jenerik ortalı SaaS hero + üç kart grid kullanma — bu bir ${sig.category} konsepti için yanlış.`);
}

/** The single primary conversion the concept drives toward. */
function deriveConversionModel(sig: ResearchSignals, inferred: InferredBrief, lang: Lang): string {
  if (sig.hospitality || sig.landscaping || sig.localService || sig.medical || sig.booking) return L(lang, 'Booking / appointment request', 'Rezervasyon / randevu talebi');
  if (sig.education || sig.application) return L(lang, 'Application / enrollment', 'Başvuru / kayıt');
  if (sig.marketplace || sig.purchase) return L(lang, 'Purchase / add to cart', 'Satın alma / sepete ekleme');
  if (sig.saas || sig.ai || sig.subscription) return L(lang, 'Signup / demo / trial', 'Kayıt / demo / deneme');
  if (sig.nonprofit) return L(lang, 'Donate / get involved', 'Bağış / katılım');
  if (sig.event) return L(lang, 'Register / buy tickets', 'Kayıt / bilet alma');
  if (sig.legal || sig.industrial || sig.leadgen || sig.b2b) return L(lang, 'Consultation / quote request', 'Danışmanlık / teklif talebi');
  if (sig.archive || sig.portfolio || sig.realEstate) return L(lang, 'Explore / enquire', 'Keşfet / iletişime geç');
  return L(lang, `Reach: ${inferred.conversionGoal}`, `Hedef: ${inferred.conversionGoal}`);
}

/** The proof/trust barriers this specific concept must clear to convert. */
function deriveTrustBarriers(sig: ResearchSignals, brief: WebBuildBrief, inferred: InferredBrief, lang: Lang): string[] {
  const out: string[] = [];
  if (sig.archive) out.push(L(lang, 'Authenticity, provenance and curation credibility', 'Özgünlük, menşe ve küratörlük güvenilirliği'));
  if (sig.legal || sig.medical) out.push(L(lang, 'Real credentials, licenses and case/patient outcomes', 'Gerçek referanslar, lisanslar ve dava/hasta sonuçları'));
  if (sig.landscaping || sig.localService) out.push(L(lang, 'Real completed projects, materials and local reviews', 'Gerçek tamamlanmış projeler, malzemeler ve yerel yorumlar'));
  if (sig.hospitality) out.push(L(lang, 'Real photos, reviews, hours and location', 'Gerçek fotoğraflar, yorumlar, saatler ve konum'));
  if (sig.saas || sig.ai) out.push(L(lang, 'Product proof (demo/screens), metrics and security', 'Ürün kanıtı (demo/ekran), metrikler ve güvenlik'));
  if (sig.marketplace) out.push(L(lang, 'Reviews, returns, secure checkout and shipping clarity', 'Yorumlar, iade, güvenli ödeme ve kargo netliği'));
  if (sig.education) out.push(L(lang, 'Instructor proof, outcomes and student results', 'Eğitmen kanıtı, kazanımlar ve öğrenci sonuçları'));
  if (sig.nonprofit) out.push(L(lang, 'Transparent impact, financials and real stories', 'Şeffaf etki, mali durum ve gerçek hikâyeler'));
  if (sig.event) out.push(L(lang, 'Named speakers, agenda and past-edition proof', 'İsimli konuşmacılar, program ve geçmiş edisyon kanıtı'));
  if (sig.industrial || sig.b2b) out.push(L(lang, 'Certifications, specs and reference clients', 'Sertifikalar, teknik özellikler ve referans müşteriler'));
  if (sig.finance) out.push(L(lang, 'Regulatory trust, security and clear terms', 'Regülasyon güveni, güvenlik ve net koşullar'));
  if (sig.realEstate) out.push(L(lang, 'Real listings, accurate detail and agent credibility', 'Gerçek ilanlar, doğru detay ve danışman güvenilirliği'));
  const explicit = (brief.trustSignals || inferred.trustSignals || '').split(/[,·|]/).map((s) => s.trim()).filter(Boolean);
  if (!out.length) out.push(L(lang, 'Concrete proof the offer is real (reviews, results, credentials)', 'Teklifin gerçek olduğuna dair somut kanıt (yorumlar, sonuçlar, referanslar)'));
  return uniq([...out, ...explicit]).slice(0, 5);
}

/** Build the precise ConceptProfile from the prompt + brief + category signals. */
function deriveConceptProfile(
  prompt: string, brief: WebBuildBrief, inferred: InferredBrief, sig: ResearchSignals, lang: Lang,
): ConceptProfile {
  const cc = CATEGORY_CONTENT[sig.category];
  const whoFor = brief.audience || inferred.targetAudience;
  const model = cc ? L(lang, cc.model[0], cc.model[1]) : '';
  // Prefer the model's own core idea, then the user's own (concise) prompt words,
  // then a category-derived statement — so `whatItIs` is as specific as possible.
  const promptConcept = (prompt || '').trim().replace(/\s+/g, ' ');
  const whatItIs = brief.coreIdea
    || (promptConcept && promptConcept.length <= 120 ? promptConcept : '')
    || (model ? `${inferred.businessType} — ${model}` : `${inferred.businessType} ${L(lang, 'for', 'için')} ${whoFor}`);
  const intentPair = CATEGORY_INTENT[sig.category];
  const visitorIntent = brief.visitorIntent
    || (intentPair ? L(lang, intentPair[0], intentPair[1]) : L(lang, `Decide quickly whether this fits, then ${inferred.primaryCTA}.`, `Bunun uygun olup olmadığına hızla karar ver, sonra ${inferred.primaryCTA}.`));
  const decisionPair = CATEGORY_DECISION[sig.category];
  const keyDecision = decisionPair ? L(lang, decisionPair[0], decisionPair[1]) : L(lang, 'Is this credible and right for me?', 'Bu güvenilir ve bana uygun mu?');
  const contentType = cc ? L(lang, cc.content[0], cc.content[1]) : L(lang, 'service / offer', 'hizmet / teklif');
  return {
    category: sig.category,
    whatItIs,
    whoFor,
    visitorIntent,
    businessModel: model || L(lang, `${inferred.businessType} model`, `${inferred.businessType} modeli`),
    keyDecision,
    mainConversion: deriveConversionModel(sig, inferred, lang),
    proofNeeded: deriveTrustBarriers(sig, brief, inferred, lang),
    contentType,
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
  /** The raw user prompt — the richest concept signal. Optional & backward
   *  compatible: omitted callers still get the brief/inferred-driven analysis. */
  prompt = '',
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

  // Concept signals FIRST (the raw prompt is the richest signal) so every
  // dimension below — conversion, trust, risks, differentiation — is concept-
  // specific. Guarded: a malformed derivation falls back to safe defaults.
  const sig = researchSignals(brief, inferred, prompt);
  let conceptProfile: ConceptProfile | undefined;
  try { conceptProfile = deriveConceptProfile(prompt, brief, inferred, sig, lang); } catch { conceptProfile = undefined; }
  // Concept Authority — the primary-concept-vs-target-vertical separation the
  // downstream art director/reviewer read to prevent visual drift. Guarded.
  let conceptAuthority: ConceptAuthority | undefined;
  try { conceptAuthority = deriveConceptAuthority(prompt, brief, inferred, lang); } catch { conceptAuthority = undefined; }
  let trustBarriers: string[] = [];
  try { trustBarriers = deriveTrustBarriers(sig, brief, inferred, lang); } catch { trustBarriers = []; }

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
    // Lead with the concept's real conversion model, then the CTA specifics.
    L(lang, `Conversion model: ${deriveConversionModel(sig, inferred, lang)}.`, `Dönüşüm modeli: ${deriveConversionModel(sig, inferred, lang)}.`),
    L(lang, `Single primary action: ${inferred.primaryCTA}.`, `Tek ana eylem: ${inferred.primaryCTA}.`),
    L(lang, `Secondary path: ${inferred.secondaryCTA}.`, `İkincil yol: ${inferred.secondaryCTA}.`),
    inferred.conversionGoal,
  ]);
  const trustSignals = uniq([
    ...(mined?.trustSignals || []),
    // Concept-specific trust barriers lead, then any explicit brief trust signals.
    ...trustBarriers,
    ...(brief.trustSignals || inferred.trustSignals || '').split(/[,·|]/).map((s) => s.trim()),
  ]);
  const visualPatterns = uniq([...(mined?.visualPatterns || []), inferred.visualStyle, inferred.previewVisualIdea, inferred.recommendedMotion]);
  const competitorOrAdjacentPatterns = uniq([...(mined?.competitorOrAdjacentPatterns || []), inferred.strategyNote]);
  // Anti-generic guard — LEAD with the concept-specific anti-template warning so
  // the strongest risk is tied to what would make THIS category look generic.
  const risksToAvoid = uniq([
    antiTemplateWarning(sig, lang),
    L(lang, 'Generic centered hero + three-card grid (reads as a template).',
      'Jenerik ortalanmış hero + üç kart grid (şablon gibi görünür).'),
    !(sig.saas || sig.ai) ? L(lang, 'A SaaS-style dashboard/product hero for a non-SaaS concept.',
      'SaaS olmayan bir konsept için SaaS tarzı panel/ürün hero\'su.') : '',
    trustBarriers.length ? L(lang, `Missing the trust proof this category needs (${trustBarriers[0]}).`,
      `Bu kategorinin ihtiyaç duyduğu güven kanıtının eksikliği (${trustBarriers[0]}).`) : '',
    L(lang, 'Wrong palette/imagery for the category (default indigo, stock photos).',
      'Kategori için yanlış palet/görsel (varsayılan indigo, stok fotoğraf).'),
    L(lang, 'Vague hype copy with no concrete offer or outcome.',
      'Somut teklif/sonuç içermeyen muğlak abartılı metin.'),
    L(lang, 'No single obvious conversion; competing CTAs.',
      'Tek net dönüşüm yok; birbiriyle yarışan CTA\'lar.'),
    L(lang, 'Empty decorative panels / blank placeholder boxes.',
      'Boş dekoratif paneller / boş yer tutucu kutular.'),
  ]);
  const differentiationOpportunities = uniq([
    inferred.previewVisualIdea,
    conceptProfile ? L(lang, `Lead into "${conceptProfile.keyDecision}" faster than competitors do.`,
      `"${conceptProfile.keyDecision}" sorusuna rakiplerden daha hızlı gir.`) : '',
    L(lang, `Lead with the strongest proof this category needs (${trustBarriers[0] || inferred.trustSignals}).`,
      `Bu kategorinin ihtiyaç duyduğu en güçlü kanıtla aç (${trustBarriers[0] || inferred.trustSignals}).`),
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
  // (`sig`, `conceptProfile`, `trustBarriers` were computed above.)
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
        visualStyleRecommendation, colorPsychology, lang, trustBarriers,
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
  // Lead with the concept read (category + conversion) so the summary is specific
  // to THIS site, then the brief dimensions it produced.
  const conceptLead = conceptProfile && conceptProfile.category !== 'general'
    ? L(lang, `Read the concept as ${conceptProfile.category} (${conceptProfile.mainConversion}). `,
        `Konsept ${conceptProfile.category} olarak okundu (${conceptProfile.mainConversion}). `)
    : '';
  const briefSummary = briefBits.length
    ? L(lang, `${conceptLead}Identified ${briefBits.join(', ')}.`, `${conceptLead}${briefBits.join(', ')} belirlendi.`)
    : conceptLead.trim();
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
    conceptProfile,
    conceptAuthority,
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
 * The Research Agent's concept CATEGORY is the strongest STRUCTURED signal for the
 * design identity — a clearly-typed concept picks its archetype directly, before
 * any prose/keyword scan, and it protects against wrong overrides (archive + luxury
 * stays archive, legal/finance stay trust-first, marketplace stays catalog-first).
 * Plain string keys so `conceptProfile.category` (a string) indexes it safely.
 */
const CATEGORY_TO_ARCHETYPE: Record<string, string> = {
  archive: 'editorial-archive',
  hospitality: 'restaurant-hospitality',
  landscaping: 'landscaping-nature',
  local_service: 'local-service-premium',
  legal: 'legal-medical-trust',
  medical: 'legal-medical-trust',
  ai: 'ai-tool',
  saas: 'high-conversion-saas',
  marketplace: 'marketplace-catalog',
  education: 'education-platform',
  nonprofit: 'nonprofit-campaign',
  portfolio: 'portfolio-showcase',
  industrial: 'industrial-b2b',
  event: 'event-conference',
  real_estate: 'real-estate',
  finance: 'fintech-trust',
};

/* ── Concept design language (per category) ───────────────────────────────
 * The senior-art-director payload: for each concept category, the specific
 * section rhythm, card language, imagery and the generic pattern to AVOID. Keyed
 * by concept category (reusable, deterministic — never a per-prompt template).
 * English design descriptors, consistent with the archetype spec fields, since
 * these are internal direction hints interpolated into downstream instructions. */
interface ConceptArtLang { rhythm: string; cards: string; imagery: string; antiPattern: string }
const CONCEPT_ART_LANGUAGE: Record<string, ConceptArtLang> = {
  archive: {
    rhythm: 'collection index → item detail → provenance → filters/metadata; dense catalog surfaces, no marketing hero',
    cards: 'catalog plates with metadata captions (title, era, source) — not marketing cards',
    imagery: 'archival plates and catalog scans on paper surfaces, high-detail, never stock',
    antiPattern: 'a centered startup hero, glass feature grid or dashboard chrome',
  },
  hospitality: {
    rhythm: 'atmosphere hero → menu highlights → ambience gallery → location/hours → reservation',
    cards: 'warm, image-led menu/ambience cards with short appetizing descriptors',
    imagery: 'appetizing food and warm interior photography, editorial crops',
    antiPattern: 'a cold SaaS/product hero or a dashboard mockup',
  },
  landscaping: {
    rhythm: 'image-first project hero → before/after → process → materials → quote CTA',
    cards: 'image-first project cards — full-bleed photo, minimal caption, before/after',
    imagery: 'real outdoor project photography and before/after pairs',
    antiPattern: 'corporate SaaS glass cards or a generic product hero',
  },
  local_service: {
    rhythm: 'proof + contact hero → services → process → reviews → quote/booking CTA',
    cards: 'solid, tactile service cards with real proof and clear pricing',
    imagery: 'real team and finished-work photography, local proof',
    antiPattern: 'a corporate SaaS template or abstract stock imagery',
  },
  legal: {
    rhythm: 'credibility hero → practice areas → credentials/proof → process → FAQ → consult CTA',
    cards: 'calm credential/proof panels (name, credential, outcome) — low radius, no gloss',
    imagery: 'credentials, calm real photography and document/seal motifs',
    antiPattern: 'flashy gradients, hype copy or a product-dashboard hero',
  },
  medical: {
    rhythm: 'credibility hero → treatments → credentials → process → FAQ → appointment CTA',
    cards: 'calm care/credential panels — reassuring, low radius, no gloss',
    imagery: 'calm real care photography and credential cues',
    antiPattern: 'alarming color, hype copy or a flashy SaaS hero',
  },
  ai: {
    rhythm: 'interactive product hero → capability/flow → proof/metrics → integrations/security → try CTA',
    cards: 'product/use-case modules with a real UI or flow mockup — not generic feature icons',
    imagery: 'live UI, prompt/response and flow diagrams',
    antiPattern: 'vague AI hype and a repeated three-card feature grid',
  },
  saas: {
    rhythm: 'product hero → use cases → feature/proof modules → security → pricing → demo CTA',
    cards: 'use-case/product modules showing a real UI mockup, not generic feature cards',
    imagery: 'composed product/dashboard mockups and real screens',
    antiPattern: 'a vague hero and a repeated three-card feature grid',
  },
  marketplace: {
    rhythm: 'catalog hero → product grid → trust/shipping → reviews → checkout CTA',
    cards: 'dense product cards — image, price, rating, quick-add; scannable grid',
    imagery: 'product photography grids with price/proof clarity',
    antiPattern: 'a single centered hero that replaces product browsing',
  },
  education: {
    rhythm: 'outcome hero → curriculum → instructor proof → results → enroll CTA',
    cards: 'lesson/module cards — outcome, duration, progress',
    imagery: 'curriculum, progress and instructor visuals',
    antiPattern: 'a vague SaaS hero with no visible outcome or curriculum',
  },
  nonprofit: {
    rhythm: 'human story hero → impact stats → programs → donate/act CTA',
    cards: 'impact/story cards — real photo, stat, short story',
    imagery: 'authentic human and impact photography',
    antiPattern: 'a corporate SaaS look or abstract stock imagery',
  },
  portfolio: {
    rhythm: 'quiet intro → selected-work grid → case detail → contact CTA; minimal chrome',
    cards: 'quiet framed case cards — image-led, strong type, little chrome',
    imagery: 'case-study imagery and expressive type',
    antiPattern: 'busy chrome, gradients or a product-dashboard hero',
  },
  industrial: {
    rhythm: 'capability hero → specifications → certifications → reference clients → quote CTA',
    cards: 'precise hairline spec cards with real numbers',
    imagery: 'technical diagrams and real equipment photography',
    antiPattern: 'decorative gradients or a consumer-app hero',
  },
  event: {
    rhythm: 'date/lineup hero → speakers → agenda → venue → register CTA',
    cards: 'bold speaker/agenda cards — photo, name, session time',
    imagery: 'speaker and venue photography with strong date typography',
    antiPattern: 'a generic product hero with no date or lineup',
  },
  real_estate: {
    rhythm: 'property showcase hero → listings → property detail → enquire CTA',
    cards: 'refined listing cards — image, key specs, price, enquire',
    imagery: 'architectural and interior photography',
    antiPattern: 'a SaaS product hero or glass feature grid',
  },
  finance: {
    rhythm: 'data-confidence hero + live metric → proof band → security → product → start CTA',
    cards: 'sharp, low-radius data/proof cards with real numbers',
    imagery: 'charts, metrics and security cues',
    antiPattern: 'hype, neon or generic luxury styling',
  },
};

/** The concept design language for the profile's category, when known. */
function conceptArtLang(cpf: ConceptProfile | undefined): ConceptArtLang | undefined {
  return cpf?.category ? CONCEPT_ART_LANGUAGE[cpf.category] : undefined;
}

/* ── Identity builders — pure, deterministic composers that turn the chosen
 * archetype's specific fields + the concept language into opinionated, non-generic
 * direction. They never throw (plain string ops, safe fallbacks) and read only
 * present data, so a missing concept profile simply yields archetype-only output. */

/** A one-line visual signature / design thesis for the chosen identity. */
function buildVisualSignature(a: DesignArchetypeSpec, cpf: ConceptProfile | undefined, lang: Lang): string {
  const name = L(lang, a.name[0], a.name[1]);
  const base = `${name} — ${a.palette.name.toLowerCase()}, ${a.heroComposition}, ${a.cardStyle}, ${a.motionMood}`;
  return cpf?.contentType
    ? L(lang, `${base}, built around ${cpf.contentType}.`, `${base}, ${cpf.contentType} etrafında.`)
    : `${base}.`;
}

/** Section-rhythm / composition grammar rules (Layout Architect + layoutFeel). */
function buildCompositionRules(a: DesignArchetypeSpec, cal: ConceptArtLang | undefined, uia: UiAgentInstructions | undefined, lang: Lang): string[] {
  return uniq([
    cal ? L(lang, `Section rhythm: ${cal.rhythm}.`, `Bölüm ritmi: ${cal.rhythm}.`) : '',
    L(lang, `Vary composition (${a.layoutDensity}) — no repeated card grid down the page.`, `Kompozisyonu değiştir (${a.layoutDensity}) — sayfa boyunca tekrarlı kart gridi yok.`),
    uia?.layoutWarning ? L(lang, `Structure to avoid: ${uia.layoutWarning}`, `Kaçınılacak yapı: ${uia.layoutWarning}`) : '',
  ]);
}

/** Surface / material rules (Component Engineer + preview). */
function buildSurfaceRules(a: DesignArchetypeSpec, dsCardStyle: string, lang: Lang): string[] {
  return uniq([
    L(lang, `Surfaces: ${a.cardStyle} (${dsCardStyle}).`, `Yüzeyler: ${a.cardStyle} (${dsCardStyle}).`),
    L(lang, `Palette "${a.palette.name}" at ${a.layoutDensity} density; one accent for the focal action.`, `${a.layoutDensity} yoğunlukta "${a.palette.name}" paleti; odak eylemi için tek vurgu.`),
    L(lang, 'A single coherent surface + border language across every section.', 'Her bölümde tek tutarlı yüzey + kenarlık dili.'),
  ]);
}

/** How proof/trust must be presented for this concept. */
function buildProofRules(cpf: ConceptProfile | undefined, uia: UiAgentInstructions | undefined, lang: Lang): string[] {
  const needs = (cpf?.proofNeeded || []).slice(0, 3);
  return uniq([
    uia?.trustFocus ? L(lang, `Foreground: ${uia.trustFocus}.`, `Öne çıkar: ${uia.trustFocus}.`) : '',
    ...needs.map((p) => L(lang, `Show ${p} as a calm, real module near the primary CTA.`, `${p} kanıtını ana CTA yakınında sakin, gerçek bir modül olarak göster.`)),
    L(lang, 'Proof as real modules (logos/metrics/quotes), never loud badges.', 'Kanıt gerçek modüller olarak (logo/metrik/alıntı), asla gürültülü rozet değil.'),
  ]);
}

/** Why this direction is NOT a generic SaaS template. */
function buildAntiTemplateDiagnosis(a: DesignArchetypeSpec, cal: ConceptArtLang | undefined, cpf: ConceptProfile | undefined, uia: UiAgentInstructions | undefined, lang: Lang): string {
  const name = L(lang, a.name[0], a.name[1]);
  const cat = cpf?.category && cpf.category !== 'general' ? cpf.category : '';
  const avoid = uia?.layoutWarning || (cal
    ? L(lang, `avoid ${cal.antiPattern}`, `${cal.antiPattern} kullanma`)
    : L(lang, 'avoid a centered SaaS hero and a repeated three-card grid', 'ortalı SaaS hero ve tekrarlı üç kart gridinden kaçın'));
  const use = cal
    ? L(lang, `use a ${cal.rhythm.split('→')[0].trim()} opening and ${cal.cards}`, `${cal.rhythm.split('→')[0].trim()} açılışı ve ${cal.cards} kullan`)
    : L(lang, `commit to the ${name} identity`, `${name} kimliğine bağlı kal`);
  return L(lang,
    `${cat ? `${cat} concept — ` : ''}${name}: ${use}; ${avoid}.`,
    `${cat ? `${cat} konsepti — ` : ''}${name}: ${use}; ${avoid}.`);
}

/** Concrete, visible differentiators — palette, hero, imagery, card language. */
function buildVisualDifferentiators(a: DesignArchetypeSpec, cal: ConceptArtLang | undefined, cpf: ConceptProfile | undefined, lang: Lang): string[] {
  return uniq([
    L(lang, `Palette: ${a.palette.name}`, `Palet: ${a.palette.name}`),
    L(lang, `Hero: ${a.heroType} (${a.heroComposition})`, `Hero: ${a.heroType} (${a.heroComposition})`),
    L(lang, `Imagery: ${cal?.imagery || a.imageType}`, `Görsel: ${cal?.imagery || a.imageType}`),
    L(lang, `Cards: ${cal?.cards || a.cardStyle}`, `Kartlar: ${cal?.cards || a.cardStyle}`),
    cpf ? L(lang, `Answers "${cpf.keyDecision}" above the fold`, `"${cpf.keyDecision}" sorusunu ilk ekranda yanıtlar`) : '',
  ]);
}

/**
 * Pick the design archetype from the concept + Research Agent signals. Priority:
 *   0. the Research concept CATEGORY (strongest structured signal, protects overrides)
 *   1. an explicit luxury premium level (only when it does not contradict a category)
 *   2. a keyword match over the concept haystack (most specific)
 *   3. the inferred industry map
 *   4. a considered modern-brand default (still distinct, never generic indigo)
 */
function pickDesignArchetype(
  brief: WebBuildBrief, research: ResearchAgentArtifact | undefined, inferred: InferredBrief,
): DesignArchetypeSpec {
  // 0) Concept category — the strongest STRUCTURED signal. When present and mapped
  //    it wins outright, so a clearly-typed concept never gets a contradicting
  //    override (archive+luxury stays archive; legal/finance stay trust-first).
  const cat = research?.conceptProfile?.category;
  if (cat && CATEGORY_TO_ARCHETYPE[cat] && DESIGN_ARCHETYPES[CATEGORY_TO_ARCHETYPE[cat]]) {
    return DESIGN_ARCHETYPES[CATEGORY_TO_ARCHETYPE[cat]];
  }
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
 * Concept Authority guard (Phase 5). The PRIMARY concept controls the visual
 * archetype; a target vertical must NEVER flip the identity (an AI/SaaS product
 * "for ecommerce" must stay an AI/product-demo identity, not a marketplace/
 * catalog one). Re-asserts the primary-concept archetype ONLY when a commerce/
 * catalog drift is detected AND the primary concept is not itself commerce.
 * Returns the corrected spec, or undefined when no correction is warranted.
 */
function guardArchetypeAgainstDrift(
  current: DesignArchetypeSpec, authority: ConceptAuthority | undefined,
): DesignArchetypeSpec | undefined {
  if (!authority) return undefined;
  const primary = authority.primaryConcept;
  if (primary === 'marketplace') return undefined; // commerce IS the concept — no guard
  const target = CATEGORY_TO_ARCHETYPE[primary];
  if (!target || !DESIGN_ARCHETYPES[target] || target === current.key) return undefined;
  const drift = new Set([...(authority.mustNotDriftTo || []), 'marketplace-catalog']);
  if (drift.has(current.key)) return DESIGN_ARCHETYPES[target];
  return undefined;
}

/** Per-concept hero visual type for the (data-only) Visual Asset Plan. Phase 8A:
 *  AI/SaaS default to a PRODUCT mockup (chat/product surface), not a data
 *  dashboard — the dashboard visual is only used when the ledger's demo-surface
 *  intent is 'dashboard-demo' (an explicit dashboard request). */
const HERO_VISUAL_BY_CONCEPT: Record<string, HeroVisualType> = {
  ai: 'product-mockup',
  saas: 'product-mockup',
  marketplace: 'product-mockup',
  real_estate: 'photo-direction',
  archive: 'pattern-system',
  portfolio: 'svg-illustration',
  landscaping: 'photo-direction',
  hospitality: 'photo-direction',
  event: 'svg-illustration',
  industrial: 'svg-illustration',
  finance: 'dashboard-mockup',
};

/**
 * Derive a concept-specific Visual Asset & Motion Plan — DATA ONLY. Never calls
 * an image/video API: it produces CSS/SVG/motion direction plus prompt-ready
 * asset slots (css-svg-now vs external-*-later) for a future generation phase.
 */
function deriveVisualAssetPlan(
  archetype: DesignArchetypeSpec,
  authority: ConceptAuthority | undefined,
  cpf: ConceptProfile | undefined,
  colorSystem: ArtDirectionColorSystem,
  lang: Lang,
  demoIntent?: DemoSurfaceIntent,
): VisualAssetPlan {
  const concept = authority?.primaryConcept || cpf?.category || 'general';
  // Phase 8A: the Thinking Ledger's demo-surface intent wins for the hero visual —
  // a dashboard mockup ONLY when a dashboard was explicitly requested; a
  // chat/product surface for chat/product-flow demos.
  const heroVisualType: HeroVisualType =
    demoIntent === 'dashboard-demo' ? 'dashboard-mockup'
    : (demoIntent === 'chat-demo' || demoIntent === 'product-flow-demo') ? 'product-mockup'
    : (HERO_VISUAL_BY_CONCEPT[concept] || 'css-abstract');
  const accent = colorSystem.accent;
  const bg = colorSystem.background;
  const vertical = authority?.targetVertical || authority?.audienceVertical;

  // Concept-specific hero direction (kept as prompt-ready text, composed now with
  // CSS/SVG). The target vertical only colors the EXAMPLE, never the identity.
  const heroPrompt = (() => {
    switch (concept) {
      case 'ai':
      case 'saas':
        return L(lang,
          `Abstract neural/product-UI mockup: a glowing interface mesh + a chat/dashboard product panel over a ${bg} surface, ${accent} accent glow${vertical ? ` (sample content themed for ${vertical})` : ''}. No stock photos.`,
          `Soyut nöral/ürün-arayüz mockup: ${bg} yüzey üzerinde parlayan arayüz ağı + sohbet/panel ürün paneli, ${accent} vurgu parıltısı${vertical ? ` (örnek içerik ${vertical} temalı)` : ''}. Stok fotoğraf yok.`);
      case 'archive':
        return L(lang, 'Editorial manuscript texture: a document/plate grid with provenance map lines on a paper surface. No stock photos.',
          'Editoryal elyazma dokusu: kağıt yüzeyde köken harita çizgileriyle belge/levha gridi. Stok fotoğraf yok.');
      case 'landscaping':
        return L(lang, 'Organic contour lines and garden-plan texture with a before/after visual slot. Real project photography direction only.',
          'Organik kontur çizgileri ve bahçe-planı dokusu, önce/sonra görsel alanı. Yalnızca gerçek proje fotoğrafı yönü.');
      case 'marketplace':
        return L(lang, 'Premium product-card grid with showroom lighting and a listing/detail visual. Clear price/proof clarity.',
          'Showroom aydınlatmalı premium ürün-kart gridi ve liste/detay görseli. Net fiyat/kanıt.');
      default:
        return L(lang, `Composed CSS/SVG hero visual tied to the concept on a ${bg} surface with a single ${accent} focal accent. No stock photos, no blank boxes.`,
          `Konsepte bağlı, ${bg} yüzeyde tek ${accent} odak vurgulu, CSS/SVG ile kompoze hero görseli. Stok fotoğraf yok, boş kutu yok.`);
    }
  })();

  const isProductConcept = concept === 'ai' || concept === 'saas';
  const assetSlots: VisualAssetSlot[] = [
    {
      id: 'hero',
      purpose: L(lang, 'Primary hero visual', 'Ana hero görseli'),
      type: 'hero',
      generationMode: 'css-svg-now',
      prompt: heroPrompt,
    },
    {
      id: 'section-primary',
      purpose: isProductConcept
        ? L(lang, 'Product/flow demo mockup', 'Ürün/akış demo mockup')
        : L(lang, 'Concept proof visual', 'Konsept kanıt görseli'),
      type: 'mockup',
      generationMode: 'css-svg-now',
      prompt: isProductConcept
        ? L(lang, `A local, static product/flow mockup (chat or dashboard) using sample copy${vertical ? ` themed for ${vertical}` : ''} — no real AI/backend.`,
            `Örnek metinle yerel, statik ürün/akış mockup'ı (sohbet veya panel)${vertical ? `, ${vertical} temalı` : ''} — gerçek AI/backend yok.`)
        : L(lang, 'A composed CSS/SVG proof visual (metrics band, gallery plate or credential panel) fit to the concept.',
            'Konsepte uygun, CSS/SVG ile kompoze kanıt görseli (metrik bandı, galeri levhası veya kimlik paneli).'),
    },
    {
      id: 'background',
      purpose: L(lang, 'Section background system', 'Bölüm arka plan sistemi'),
      type: 'background',
      generationMode: 'css-svg-now',
      prompt: L(lang, `Tonal ${bg} surface shifts with hairline separators and a restrained ${accent} accent — no heavy boxes.`,
        `İnce ayırıcılar ve ölçülü ${accent} vurgu ile tonal ${bg} yüzey geçişleri — ağır kutu yok.`),
    },
  ];

  // A single richer hero visual is reserved for a LATER external image phase
  // (product concepts benefit most from a real generated mockup).
  const imageGenerationPrompt = isProductConcept
    ? L(lang, `[reserved for a later phase] Premium abstract AI product hero: glowing interface mesh + chat/dashboard mockup, ${accent} accent, dark ${bg} background, cinematic depth.`,
        `[sonraki aşamaya ayrılmış] Premium soyut AI ürün hero: parlayan arayüz ağı + sohbet/panel mockup, ${accent} vurgu, koyu ${bg} arka plan, sinematik derinlik.`)
    : undefined;

  const animatedBackground = L(lang,
    `${archetype.layoutDensity === 'immersive' ? 'Slow gradient/mesh drift' : 'Subtle hairline/tonal drift'} tied to the ${accent} accent; respects reduced-motion.`,
    `${accent} vurgusuna bağlı ${archetype.layoutDensity === 'immersive' ? 'yavaş gradyan/ağ kayması' : 'ince çizgi/tonal kayma'}; reduced-motion'a saygılı.`);
  const videoMotionPrompt = isProductConcept
    ? L(lang, '[reserved for a later phase] Looping product-UI motion: a chat/dashboard filling in with sample data, calm and premium.',
        '[sonraki aşamaya ayrılmış] Döngüsel ürün-arayüz hareketi: örnek verilerle dolan sohbet/panel, sakin ve premium.')
    : undefined;

  const constraints = uniq([
    L(lang, 'No image/video API is called in this phase — CSS/SVG/motion + prompt-ready slots only.',
      'Bu aşamada görsel/video API çağrılmaz — yalnızca CSS/SVG/hareket + hazır slotlar.'),
    L(lang, 'Compose visuals with CSS/SVG; never blank placeholder boxes or stock photos.',
      'Görselleri CSS/SVG ile oluştur; asla boş yer tutucu kutu veya stok fotoğraf.'),
    isProductConcept
      ? L(lang, 'Any product/chat demo is a LOCAL, static illustration from sample copy — no real AI/backend.',
          'Her ürün/sohbet demosu örnek metinden YEREL, statik bir illüstrasyondur — gerçek AI/backend yok.')
      : '',
    L(lang, 'Respect prefers-reduced-motion for all animated assets.',
      'Tüm animasyonlu varlıklar için prefers-reduced-motion\'a saygı göster.'),
  ]);

  return { heroVisualType, animatedBackground, imageGenerationPrompt, videoMotionPrompt, assetSlots, constraints };
}

/* ── Visual Exploration (Phase 7B) ──────────────────────────────────────────
 * Produce 3 candidate visual directions and choose one so the build stops
 * defaulting to the same dark/gold/dashboard look. Deterministic (resume-safe):
 * a small stable hash rotates among equally-appropriate palette families, but a
 * given idea is always stable. Fails open — the caller ignores it on error. */

/** The conventional "safe" family a concept would default to (the look we want
 *  to be able to move AWAY from unless it is clearly justified). */
function conventionalFamily(hay: string): PaletteFamily {
  if (/(archive|library|museum|collection|editorial|magazine|journal)/.test(hay)) return 'archive-sepia';
  if (/(landscap|garden|botanic|nature|forest|peyzaj|organic|plant)/.test(hay)) return 'botanical-sage';
  if (/(car|auto|automotive|vehicle|racing|dealership)/.test(hay)) return 'automotive-silver';
  if (/(restaurant|hotel|cafe|dining|hospitality|menu|reservation|resort)/.test(hay)) return 'hospitality-amber';
  if (/(marketplace|catalog|inventory|listings|storefront|shop|ecommerce)/.test(hay)) return 'porcelain-blue';
  // The AI/SaaS default look is dark cool — that is the sameness we break.
  return 'midnight-blue';
}

function candidateFromFamily(
  id: string, role: string, fam: PaletteFamily, isProductConcept: boolean, lang: Lang,
): VisualDirectionCandidate {
  const spec = PALETTE_FAMILIES[fam];
  const name = L(lang, role, role);
  const paletteIntent = L(lang, `${fam} — ${spec.mood}`, `${fam} — ${spec.mood}`);
  const backgroundStrategy = spec.light
    ? L(lang, 'Light background — airy, easy on the eyes', 'Açık zemin — ferah, göze rahat')
    : L(lang, 'Deep background with restrained contrast', 'Ölçülü kontrastlı koyu zemin');
  const accentStrategy = L(lang, `Single restrained accent (${spec.accent}); never high-saturation overuse`,
    `Tek ölçülü vurgu (${spec.accent}); asla yüksek doygunlukta aşırı kullanım`);
  const heroComposition = isProductConcept
    ? L(lang, 'A focused product/chat demo surface — not a metrics dashboard', 'Odaklı bir ürün/sohbet demo yüzeyi — metrik paneli değil')
    : L(lang, 'A composed editorial hero tied to the concept', 'Konsepte bağlı kompoze editoryal hero');
  const mockupStrategy = isProductConcept
    ? L(lang, 'Conversation / answer-routing preview from sample copy (no charts, no fake metrics)', 'Örnek metinden görüşme / yanıt-yönlendirme önizlemesi (grafik yok, uydurma metrik yok)')
    : L(lang, 'Concept-specific composed CSS/SVG visual (no stock, no blank boxes)', 'Konsepte özgü kompoze CSS/SVG görsel (stok yok, boş kutu yok)');
  const typographyMood = spec.headingSerif
    ? L(lang, 'Editorial serif headings', 'Editoryal serif başlıklar')
    : L(lang, 'Modern sans headings', 'Modern sans başlıklar');
  return {
    id,
    name,
    paletteIntent,
    accentStrategy,
    backgroundStrategy,
    heroComposition,
    mockupStrategy,
    motionMood: L(lang, 'Restrained, tasteful motion', 'Ölçülü, zevkli hareket'),
    typographyMood,
    whyItFits: L(lang, `Fits the concept via ${spec.mood}`, `Konsepte ${spec.mood} ile uyar`),
    risks: spec.light ? [] : [L(lang, 'Dark can feel same-y if accent is overused', 'Koyu, vurgu aşırı kullanılırsa tekdüze hissettirebilir')],
    paletteFamily: fam,
  };
}

function deriveVisualExploration(
  brief: WebBuildBrief,
  conceptAuthority: ConceptAuthority | undefined,
  inferred: InferredBrief,
  lang: Lang,
): VisualExplorationArtifact {
  const concept = (conceptAuthority?.primaryConcept || '').toLowerCase();
  const vertical = (conceptAuthority?.targetVertical || conceptAuthority?.audienceVertical || '').toLowerCase();
  const mood = [brief.visualMood, brief.style, brief.colorDirection].filter(Boolean).join(' ');
  const promptText = [brief.coreIdea, brief.type, brief.goal, inferred.businessType].filter(Boolean).join(' ');
  const hay = `${promptText} ${concept} ${vertical} ${mood}`.toLowerCase();
  const isProductConcept = concept === 'ai' || concept === 'saas'
    || /\bai\b|assistant|chatbot|\bsaas\b|dashboard|platform|automation/.test(hay);

  const safeFamily = conventionalFamily(hay);
  // The differentiated pick is the deterministic anti-template selection.
  let premiumFamily = selectPaletteFamily({
    explicit: brief.paletteFamily, prompt: promptText, concept, vertical, visualMood: mood,
  });
  // An unexpected-but-appropriate third direction, distinct from the other two.
  const boldPool: PaletteFamily[] = ['slate-violet', 'ink-lime', 'black-white-red', 'editorial-cream', 'porcelain-blue', 'graphite-cyan'];
  let unexpectedFamily = boldPool.find((f) => f !== safeFamily && f !== premiumFamily) || 'slate-violet';
  // If the rotation happened to land the differentiated pick ON the conventional
  // one, move it to the unexpected pick so "selected" is genuinely not the default.
  if (premiumFamily === safeFamily) {
    premiumFamily = unexpectedFamily;
    unexpectedFamily = boldPool.find((f) => f !== safeFamily && f !== premiumFamily) || 'graphite-cyan';
  }

  const safe = candidateFromFamily('safe', L(lang, 'Safe / conventional', 'Güvenli / geleneksel'), safeFamily, isProductConcept, lang);
  const premium = candidateFromFamily('premium', L(lang, 'Premium differentiated', 'Premium farklılaşmış'), premiumFamily, isProductConcept, lang);
  const unexpected = candidateFromFamily('unexpected', L(lang, 'Unexpected but appropriate', 'Beklenmedik ama uygun'), unexpectedFamily, isProductConcept, lang);
  const candidates = [safe, premium, unexpected];

  // Select the differentiated premium direction by default — that is the whole
  // point of exploration: not to fall back to the conventional look.
  const selectedCandidateId = 'premium';
  const selectionReason = L(lang,
    `Chose the differentiated "${premiumFamily}" direction over the conventional "${safeFamily}" default — restrained accent, ${PALETTE_FAMILIES[premiumFamily].light ? 'lighter, calmer background' : 'deep but non-generic background'}, concept-specific hero.`,
    `Geleneksel "${safeFamily}" varsayılanı yerine farklılaşmış "${premiumFamily}" yönü seçildi — ölçülü vurgu, ${PALETTE_FAMILIES[premiumFamily].light ? 'daha açık, sakin zemin' : 'derin ama jenerik olmayan zemin'}, konsepte özgü hero.`);
  const antiTemplateNotes = uniq([
    L(lang, 'Avoid the default dark + gold/indigo + chart-dashboard template', 'Varsayılan koyu + altın/indigo + grafik-panel şablonundan kaçın'),
    isProductConcept ? L(lang, 'AI/SaaS: demo the conversation/flow, not fabricated metrics or logos', 'AI/SaaS: uydurma metrik/logo değil, görüşme/akışı göster') : '',
    PALETTE_FAMILIES[premiumFamily].light ? L(lang, 'Light palette selected to relieve eye-strain', 'Göz yorgunluğunu azaltmak için açık palet seçildi') : '',
  ].filter(Boolean));

  return {
    candidates,
    selectedCandidateId,
    rejectedCandidateIds: candidates.filter((c) => c.id !== selectedCandidateId).map((c) => c.id),
    selectionReason,
    antiTemplateNotes,
  };
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
  ledger?: StrategicThinkingLedger,
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
  let archetype = pickDesignArchetype(brief, research, inferred);
  // CONCEPT AUTHORITY GUARD (Phase 5): the primary concept controls the archetype;
  // a target vertical (e.g. "for ecommerce") must never flip an AI/SaaS product to
  // a marketplace/catalog identity. Re-assert the primary-concept archetype on drift.
  const conceptAuthority = research?.conceptAuthority;
  const guarded = guardArchetypeAgainstDrift(archetype, conceptAuthority);
  const correctedConceptDrift = !!guarded;
  if (guarded) {
    // eslint-disable-next-line no-console
    console.warn(`[WebBuild] concept-authority guard: re-asserted "${guarded.key}" over drifted "${archetype.key}" (primary=${conceptAuthority?.primaryConcept}, vertical=${conceptAuthority?.targetVertical || '-'}).`);
    archetype = guarded;
  }

  // Color system follows the ORDER OF TRUTH: model color → research color
  // psychology → the archetype's distinct palette → tokens. So a fresh/fallback
  // build gets a coherent identity palette, never the generic default indigo.
  const cp = research?.colorPsychology;
  const modelChoseColor = !!(brief.colorDirection || brief.artAccent || brief.artBg);
  const colorSystemBase = resolveArtColorSystem(cp, tokens, modelChoseColor, archetype);

  // VISUAL EXPLORATION (Phase 7B) — explore 3 directions and choose one, so the
  // build stops defaulting to the same dark/gold/dashboard template. Guarded:
  // any failure falls open to the existing color system.
  let visualExploration: VisualExplorationArtifact | undefined;
  let paletteFamily: string | undefined;
  try {
    visualExploration = deriveVisualExploration(brief, conceptAuthority, inferred, lang);
    const selected = visualExploration.candidates.find((c) => c.id === visualExploration!.selectedCandidateId);
    paletteFamily = selected?.paletteFamily;
  } catch { visualExploration = undefined; }

  // Apply the selected candidate's palette family to the color system UNLESS the
  // model / research explicitly pinned a color (their choice always wins). This
  // is what makes AI/SaaS no longer always dark+gold and light options possible.
  // Phase 9A: the MODEL's Design Thinking Plan palette decision has the highest taste
  // authority — it overrides research/exploration (never an explicit pinned hex).
  // "avoid gold" (or a rejected dark-grid+gold look) forces a restrained cool family.
  const mpPlan = ledger?.modelDesignPlan;
  const explicitHex = !!(brief.artAccent || brief.artBg);
  const mpFamily: PaletteFamily | undefined = (!explicitHex && mpPlan?.paletteFamily && PALETTE_FAMILIES[mpPlan.paletteFamily as PaletteFamily])
    ? (mpPlan.paletteFamily as PaletteFamily) : undefined;
  const exploFamily: PaletteFamily | undefined = (paletteFamily && !modelChoseColor && !(cp?.recommendedPalette || []).length)
    ? (paletteFamily as PaletteFamily) : undefined;
  let famKey: PaletteFamily | undefined = mpFamily || exploFamily;
  if (!explicitHex && mpPlan?.avoidGold && (!famKey || isGoldish(PALETTE_FAMILIES[famKey]?.accent))) {
    famKey = 'graphite-cyan';
  }
  const famSpec = famKey ? PALETTE_FAMILIES[famKey] : undefined;
  if (famKey) paletteFamily = famKey; // reflect the final palette decision in diagnostics
  const colorSystemFromFamily: ArtDirectionColorSystem = famSpec
    ? { ...colorSystemBase, background: famSpec.bg, accent: famSpec.accent, accent2: famSpec.accent2, primary: famSpec.accent, secondary: famSpec.accent2, paletteName: famKey }
    : colorSystemBase;

  // Fold the researched color-psychology reasoning + colors-to-avoid onto the
  // structured colorSystem (honest: only when research provided them).
  const colorSystem: ArtDirectionColorSystem = {
    ...colorSystemFromFamily,
    colorPsychologyReasoning: cp
      ? uniq([cp.reasoning, cp.emotionalEffect, cp.trustEffect || '']).filter(Boolean).join(' · ') || undefined
      : undefined,
    avoidColors: (cp?.avoidColors || []).length ? cp!.avoidColors.slice(0, 4) : undefined,
  };

  // Read the Research brief signals so every direction is specific, not generic.
  const tu = research?.targetUser;
  const vsr = research?.visualStyleRecommendation;
  // Richer Research Agent hand-off (concept profile + UI instructions). All
  // optional — every use below falls back safely when they are absent.
  const cpf = research?.conceptProfile;
  const uia = research?.uiAgentInstructions;
  // Concept design language for the chosen category (rhythm/cards/imagery/anti-
  // pattern) — the payload that makes each identity visibly different downstream.
  const cal = conceptArtLang(cpf);
  const audience = brief.audience || inferred.targetAudience;
  const desktopLean = /desktop/i.test(tu?.devicePreference || '');
  const mobileLean = /mobile/i.test(tu?.devicePreference || '');
  const premiumLevel = vsr?.premiumLevel;

  // visualMood — a specific style statement (prefer the model's own Design Thinking
  // Plan direction, then the researched style type). Phase 9A.
  const visualMood = brief.visualMood || mpPlan?.selectedVisualDirection || mpPlan?.firstImpression || vsr?.styleType || brief.style || inferred.visualStyle;
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
    || mpPlan?.typographyDecision
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
  // imageryDirection — prefer the Research Agent's explicit imagery hand-off, then
  // the researched imagery type, then a composed-visuals default.
  const imageryDirection = uia?.imageryDirection
    || (vsr?.imageryType
      ? L(lang, `${vsr.imageryType} — composed, never stock or blank boxes.`,
          `${vsr.imageryType} — kompoze, asla stok veya boş kutu değil.`)
      : L(lang,
          `Composed CSS/SVG visuals (${inferred.previewVisualIdea}) — no stock photos, no blank boxes.`,
          `Kompoze CSS/SVG görseller (${inferred.previewVisualIdea}) — stok fotoğraf yok, boş kutu yok.`));
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
    // Lead with the Research Agent's concept-specific anti-template warning so the
    // strongest "don't make it generic" signal is first.
    uia?.layoutWarning || '',
    // Research color psychology + explicit UI-agent hand-off drive what to avoid.
    ...(research?.colorPsychology?.avoidColors || []).slice(0, 3),
    ...(uia?.mustAvoid || []).slice(0, 2),
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
  // trustNeed feeds the trust visual direction (→ componentStyleRules.trustBlocks
  // + downstreamInstructions). Lead with the Research Agent's explicit trustFocus,
  // then the concept's proof needs, then generic trust signals.
  const trustNeed = uia?.trustFocus || (cpf?.proofNeeded || [])[0]
    || (tu?.trustNeeds || [])[0] || (research?.trustSignals || [])[0];
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
    // Richer Research signals — recorded ONLY when actually consumed above.
    cpf ? 'conceptProfile' : '',
    conceptAuthority ? 'conceptAuthority' : '',
    uia?.trustFocus ? 'trustFocus' : '',
    uia?.imageryDirection ? 'imageryDirection' : '',
    uia?.layoutWarning ? 'layoutWarning' : '',
  ]);

  // Visual Asset & Motion Plan (Phase 5) — DATA ONLY (no image/video API call).
  // Phase 8A: the Thinking Ledger's demo-surface intent steers the hero visual so
  // an AI/chatbot product opens on a product/chat mockup, not a data dashboard.
  let visualAssetPlan: VisualAssetPlan | undefined;
  try { visualAssetPlan = deriveVisualAssetPlan(archetype, conceptAuthority, cpf, colorSystem, lang, ledger?.demoSurfaceIntent); }
  catch { visualAssetPlan = undefined; }

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
    conceptProfile: !!cpf,
    trustFocus: !!uia?.trustFocus,
    imageryDirection: !!uia?.imageryDirection,
    layoutWarning: !!uia?.layoutWarning,
  };
  const visualMoodProfile: VisualMoodProfile = {
    primaryMood: cp?.primaryMood || visualMood,
    secondaryMood: vsr?.styleType || archName,
    emotionalGoal: cp?.emotionalEffect || L(lang, `Make ${audience} feel this is made for them and trustworthy.`, `${audience} bunun kendisi için yapıldığını ve güvenilir olduğunu hissetsin.`),
    brandPersonality: uniq([inferred.tone, ...archetype.tags]).slice(0, 5),
    // Perception goal follows the concept's real visitor intent when known.
    userPerceptionGoal: tu?.buyingMotivation || cpf?.visitorIntent
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
    // Section rhythm follows the concept's composition grammar when known, so the
    // page ORDER (not just the look) is concept-specific.
    spacingRhythm: cal
      ? L(lang, `${cal.rhythm} — ${ds.sectionRhythm} spacing, no repeated card grid`, `${cal.rhythm} — ${ds.sectionRhythm} boşluk, tekrarlı kart gridi yok`)
      : L(lang, `${ds.sectionRhythm} rhythm — vary section shapes, no repeated card grid`, `${ds.sectionRhythm} ritim — bölüm şekillerini değiştir, tekrarlı kart gridi yok`),
    containerStyle: archetype.layoutDensity === 'immersive' || archetype.layoutDensity === 'editorial'
      ? L(lang, 'Wide, editorial containers with full-bleed moments', 'Geniş, editoryal konteynerler ve tam-taşma anları')
      : archetype.layoutDensity === 'dense'
        ? L(lang, 'Contained, information-dense columns', 'Kapsanmış, bilgi yoğun sütunlar')
        : L(lang, 'Balanced centered container with generous gutters', 'Dengeli ortalanmış konteyner, cömert boşluklar'),
    gridStyle: archetype.layoutDensity === 'dense'
      ? L(lang, 'Multi-column scannable grids', 'Çok sütunlu taranabilir gridler')
      : L(lang, 'Asymmetric, varied grids over uniform 3-cards', 'Tek tip 3 kart yerine asimetrik, çeşitli gridler'),
    sectionSeparators: L(lang, 'Tonal surface shifts and hairlines, not heavy boxes', 'Ağır kutular değil, tonal yüzey geçişleri ve ince çizgiler'),
    // Above-the-fold priority leads with a researched UX priority, then the
    // concept's key decision, then a safe default.
    aboveFoldPriority: (research?.uxPriorities || [])[0]?.priority
      || (cpf ? L(lang, `Answer "${cpf.keyDecision}" + one path to "${primaryCTAName}"`, `"${cpf.keyDecision}" + "${primaryCTAName}" için tek yol`) : '')
      || L(lang, `Promise + one path to "${primaryCTAName}"`, `Vaat + "${primaryCTAName}" için tek yol`),
  };
  const heroTreatment: HeroTreatment = {
    heroType: L(lang, archetype.heroType, archetype.heroType),
    composition: L(lang, archetype.heroComposition, archetype.heroComposition),
    visualAnchor: visualMetaphor || L(lang, archetype.imageType, archetype.imageType),
    headlineStyle: typographyProfile.headingStyle,
    ctaStyle: ctaStyleDirection,
    // Trust placement leads with the concept's proof focus (trustFocus / proofNeeded).
    trustPlacement: uia?.trustFocus || (cpf?.proofNeeded || [])[0]
      || (research?.trustSignals || [])[0] || (tu?.trustNeeds || [])[0]
      || L(lang, 'A quiet proof band directly under the hero CTA', 'Hero CTA\'nın hemen altında sessiz bir kanıt bandı'),
    backgroundTreatment: archetype.layoutDensity === 'immersive'
      ? L(lang, 'Full-bleed image/gradient with a legible overlay', 'Okunaklı kaplamalı tam-taşma görsel/gradyan')
      : L(lang, 'Refined gradient/surface tied to the palette', 'Palete bağlı rafine gradyan/yüzey'),
    // Reason names the concept decision the hero must resolve + the generic hero
    // to avoid for this concept (e.g. a product-dashboard hero for a non-SaaS site).
    reason: uniq([
      archReason,
      cpf ? L(lang, `Answer "${cpf.keyDecision}" above the fold.`, `"${cpf.keyDecision}" sorusunu ilk ekranda yanıtla.`) : '',
      cal ? L(lang, `Do not use ${cal.antiPattern}.`, `${cal.antiPattern} kullanma.`) : '',
    ]).join(' '),
  };
  const componentStyleRules: ComponentStyleRules = {
    // Cards follow the concept's card language (catalog plates, image-first project
    // cards, calm credential panels, dense product cards…) not a generic card.
    cards: cal
      ? L(lang, `${cal.cards} (${ds.cardStyle})`, `${cal.cards} (${ds.cardStyle})`)
      : L(lang, `${archetype.cardStyle} (${ds.cardStyle})`, `${archetype.cardStyle} (${ds.cardStyle})`),
    buttons: ctaStyleDirection,
    forms: L(lang, 'Calm, low-friction fields with clear labels and one primary action', 'Sakin, düşük sürtünmeli alanlar; net etiketler ve tek ana eylem'),
    navigation: archetype.layoutDensity === 'immersive'
      ? L(lang, 'Minimal transparent nav that solidifies on scroll', 'Kaydırınca katılaşan minimal şeffaf navigasyon')
      : L(lang, 'Clear, compact nav with a single highlighted CTA', 'Net, kompakt navigasyon; tek vurgulu CTA'),
    badges: L(lang, 'Quiet, tonal badges — never loud neon pills', 'Sessiz, tonal rozetler — asla gürültülü neon haplar'),
    gallery: L(lang, cal?.imagery || archetype.imageType, cal?.imagery || archetype.imageType),
    testimonials: L(lang, 'Real quotes on quiet surfaces with name/role, no stock faces', 'Sessiz yüzeylerde gerçek alıntılar; isim/rol, stok yüz yok'),
    pricingOrCatalog: (cpf?.category === 'marketplace' || cpf?.category === 'archive' || cpf?.category === 'real_estate')
      ? L(lang, 'Dense, scannable catalog/listing cards with price/spec clarity and one clear action', 'Yoğun, taranabilir katalog/ilan kartları; net fiyat/özellik ve tek net eylem')
      : L(lang, 'Legible, honest pricing/catalog cards with one clear default', 'Okunur, dürüst fiyat/katalog kartları; tek net varsayılan'),
    trustBlocks: trustVisualDirection,
  };
  const imagerySystem: ImagerySystem = {
    // imageType leads with the Research imagery hand-off / concept imagery language,
    // then the archetype's structural imagery + the concept content type.
    imageType: uia?.imageryDirection || cal?.imagery
      || (cpf?.contentType
        ? L(lang, `${archetype.imageType} · ${cpf.contentType}`, `${archetype.imageType} · ${cpf.contentType}`)
        : L(lang, archetype.imageType, archetype.imageType)),
    photographyStyle: /photograph|editorial|cinematic|image/.test(archetype.imageType)
      ? L(lang, 'Editorial, high-contrast, generous negative space', 'Editoryal, yüksek kontrast, cömert negatif alan')
      : L(lang, 'Only where it adds proof — otherwise composed visuals', 'Yalnızca kanıt kattığında — aksi halde kompoze görseller'),
    illustrationStyle: L(lang, 'Geometric SVG tied to the concept, never clip-art', 'Konsepte bağlı geometrik SVG; asla clip-art değil'),
    mockupStyle: vsr?.mockupType || (cal ? L(lang, cal.imagery, cal.imagery) : L(lang, 'Composed CSS/SVG product/module mockups', 'Kompoze CSS/SVG ürün/modül maketleri')),
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

  // ── Visual identity system + anti-template diagnosis (concept + archetype). ──
  const visualSignature = buildVisualSignature(archetype, cpf, lang);
  const compositionRules = buildCompositionRules(archetype, cal, uia, lang);
  const surfaceRules = buildSurfaceRules(archetype, ds.cardStyle, lang);
  const proofRules = buildProofRules(cpf, uia, lang);
  const visualDifferentiators = buildVisualDifferentiators(archetype, cal, cpf, lang);
  const antiTemplateDiagnosis = buildAntiTemplateDiagnosis(archetype, cal, cpf, uia, lang);

  const downstreamInstructions: DownstreamInstructions = {
    strategyAgent: uniq([
      L(lang, `Preserve the ${archName} identity and keep the conversion tone consistent with it`, `${archName} kimliğini koru ve dönüşüm tonunu bununla tutarlı tut`),
      L(lang, `CTA style: ${ctaStyleDirection}`, `CTA stili: ${ctaStyleDirection}`),
      L(lang, `Trust proof as: ${trustVisualDirection}`, `Güven kanıtı: ${trustVisualDirection}`),
      cpf ? L(lang, `Prove ${(cpf.proofNeeded || []).slice(0, 2).join(', ')} for a ${cpf.category} visitor deciding "${cpf.keyDecision}".`, `${cpf.category} ziyaretçisi "${cpf.keyDecision}" kararını verirken ${(cpf.proofNeeded || []).slice(0, 2).join(', ')} kanıtla.`) : '',
    ]),
    layoutArchitectAgent: uniq([
      L(lang, `Hero: ${heroTreatment.heroType} — ${heroTreatment.composition}`, `Hero: ${heroTreatment.heroType} — ${heroTreatment.composition}`),
      L(lang, `Density: ${layoutFeel.density}; ${layoutFeel.gridStyle}`, `Yoğunluk: ${layoutFeel.density}; ${layoutFeel.gridStyle}`),
      // Actionable: the concept's real section-rhythm grammar, not a generic line.
      ...compositionRules,
    ]),
    componentEngineerAgent: uniq([
      L(lang, `Cards: ${componentStyleRules.cards}`, `Kartlar: ${componentStyleRules.cards}`),
      L(lang, `Buttons: ${componentStyleRules.buttons}`, `Butonlar: ${componentStyleRules.buttons}`),
      L(lang, `Icons: ${iconographySystem.style}, ${iconographySystem.shapeLanguage}`, `İkonlar: ${iconographySystem.style}, ${iconographySystem.shapeLanguage}`),
      L(lang, `Imagery: ${imagerySystem.imageType}`, `Görsel: ${imagerySystem.imageType}`),
      ...proofRules.slice(0, 2),
    ]),
    previewRenderer: uniq([
      L(lang, `Palette "${paletteName}": bg ${colorSystem.background}, accent ${colorSystem.accent}`, `Palet "${paletteName}": arka ${colorSystem.background}, vurgu ${colorSystem.accent}`),
      L(lang, `Headings: ${headingSerif ? 'serif' : 'sans'}`, `Başlıklar: ${headingSerif ? 'serif' : 'sans'}`),
      ...surfaceRules.slice(0, 1),
    ]),
    fileSynthesis: uniq([
      L(lang, 'Emit design tokens from this palette + type; no generic default indigo', 'Bu palet + tipografiden tasarım token\'ları üret; jenerik varsayılan indigo yok'),
      L(lang, 'Compose visuals with CSS/SVG; never blank placeholder boxes', 'Görselleri CSS/SVG ile oluştur; asla boş yer tutucu kutular değil'),
      // The single strongest "don't generate a generic template" instruction.
      L(lang, `Do not generate: ${antiTemplateDiagnosis}`, `Şunu üretme: ${antiTemplateDiagnosis}`),
    ]),
  };
  const mustEmphasize = uniq([
    archName,
    ...(uia?.mustEmphasize || []).slice(0, 2),
    cpf ? L(lang, `Answer "${cpf.keyDecision}"`, `"${cpf.keyDecision}" sorusunu yanıtla`) : '',
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

  // Summary — the design thesis first (concept + archetype), then the palette/
  // type/density read, so it reads like a senior art director's one-liner.
  const summary = L(lang,
    `${visualSignature} For ${audience} — ${headingSerif ? 'editorial' : 'modern'} type, ${density} density, ${ds.motion} motion.`,
    `${visualSignature} ${audience} için — ${headingSerif ? 'editoryal' : 'modern'} tipografi, ${density} yoğunluk, ${ds.motion} hareket.`);
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
    // ── Visual identity system + anti-template diagnosis ──
    visualSignature,
    antiTemplateDiagnosis,
    visualDifferentiators,
    compositionRules,
    surfaceRules,
    proofRules,
    // ── Phase 5: Concept Authority + Visual Asset Plan ──
    conceptAuthority,
    correctedConceptDrift,
    visualAssetPlan,
    // ── Phase 7B: Visual Exploration + anti-template ──
    visualExploration,
    paletteFamily,
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
  ledger?: StrategicThinkingLedger,
): StrategyAgentArtifact {
  const audience = brief.audience || inferred.targetAudience;
  const primary = brief.primaryCTA || inferred.primaryCTA;
  const secondary = brief.secondaryCTA || inferred.secondaryCTA;
  // Richer Research hand-off (concept profile + UI instructions). Optional; every
  // use fills a gap only and never overrides an explicit brief value.
  const cpf = research?.conceptProfile;
  const uia = research?.uiAgentInstructions;
  const positioning = brief.coreIdea || cpf?.whatItIs || `${inferred.businessType} ${L(lang, 'for', 'için')} ${audience}`;
  const mainPromise = brief.strategyInsight || inferred.heroHeadline;
  const conversionStrategy = brief.conversionStrategy
    || uniq([cpf?.mainConversion || '', ...(research?.conversionPatterns || [])]).join(' · ')
    // Phase 8A: gap-fill from the Thinking Ledger's committed conversion path.
    || ledger?.primaryConversionPath
    || L(lang, `Lead the visitor to one action: ${primary}.`, `Ziyaretçiyi tek eyleme yönlendir: ${primary}.`);
  // Trust strategy consumes the concept's proof needs + the UI Agent's trust focus
  // AND the Research trust needs + the Art Direction's trust visual direction, so
  // every agent agrees on how proof is presented.
  const trustStrategy = brief.trustSignals
    || uniq([
        uia?.trustFocus || '',
        ...(cpf?.proofNeeded || []),
        ...(research?.targetUser?.trustNeeds || []),
        ...(research?.trustSignals || []),
        art?.trustVisualDirection || '',
      ]).join(' · ')
    || inferred.trustSignals;
  const differentiation = (research?.differentiationOpportunities || [])[0]
    || inferred.previewVisualIdea;

  const contentHierarchy = uniq([
    L(lang, `Promise: ${mainPromise}`, `Vaat: ${mainPromise}`),
    // The concept's key decision is what the page must resolve for the visitor.
    cpf ? L(lang, `Resolve the decision: ${cpf.keyDecision}`, `Kararı çöz: ${cpf.keyDecision}`) : '',
    // Phase 8A: surface the ledger's front-end-only demo surface in the hierarchy.
    (ledger && ledger.demoSurfaceIntent !== 'none')
      ? L(lang, `Demo surface: ${ledger.demoSurfaceIntent} (front-end only)`, `Demo yüzeyi: ${ledger.demoSurfaceIntent} (yalnızca ön-yüz)`) : '',
    L(lang, 'Proof it is real (trust signals)', 'Gerçek olduğunun kanıtı (güven sinyalleri)'),
    L(lang, 'How it works / what you get', 'Nasıl çalışır / ne elde edersin'),
    L(lang, `The offer and single action: ${primary}`, `Teklif ve tek eylem: ${primary}`),
  ]);
  const aboveTheFoldMustProve = uniq([
    mainPromise,
    (cpf?.proofNeeded || [])[0] || (research?.trustSignals || [])[0] || inferred.trustSignals,
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
    // Richer signals — recorded ONLY when actually consumed above.
    cpf ? 'conceptProfile' : '',
    uia?.trustFocus ? 'trustFocus' : '',
    uia?.layoutWarning ? 'layoutWarning' : '',
  ]);
  const usedArtDirectionInputs = uniq([
    art?.visualMood ? 'visualMood' : '',
    art?.brandPersonality ? 'brandPersonality' : '',
    art?.ctaStyleDirection ? 'ctaStyleDirection' : '',
    art?.trustVisualDirection ? 'trustVisualDirection' : '',
  ]);

  // Phase 3 — the model's AI-native Website Experience Plan, carried from the parsed
  // brief. Present only when the model actually returned a field (else undefined so
  // old builds stay clean). Website + front-end demo decisions only — never a real
  // product/backend. The Interaction Contract PREFERS this over keyword fallbacks.
  const cl = (s?: string) => (s || '').trim();
  const splitList = (s?: string): string[] =>
    (s || '').split(/[,;、·|]/).map((x) => x.trim()).filter((x) => x && !/^none$/i.test(x));
  let websiteExperiencePlan: WebsiteExperiencePlan | undefined;
  {
    const wem = cl(brief.websiteExperienceModel);
    const psm = cl(brief.pageScreenModel);
    const pwe = cl(brief.primaryWebsiteExperience);
    const nav = cl(brief.navigationModel);
    const mmp = cl(brief.mediaMotionPlan);
    const surfaces = splitList(brief.demoSurfaces);
    const comps = splitList(brief.statefulDemoComponents);
    // Entry Flow (Phase 6B) — the model's decision about landing → experience.
    const efm = cl(brief.entryFlowModel);
    const lreq = cl(brief.landingRequired);
    const escr = cl(brief.entryScreen);
    const pescr = cl(brief.postEntryScreen);
    const pcta = cl(brief.primaryEntryCTA);
    const scta = cl(brief.secondaryEntryCTA);
    const navb = cl(brief.navigationBehavior);
    // Conversion Journey (Phase 6F) — the model's primary conversion path.
    const cjm = cl(brief.conversionJourneyModel);
    const pci = cl(brief.primaryConversionIntent);
    const lcr = cl(brief.leadCaptureRequired);
    const lcf = cl(brief.leadCaptureFields);
    const alcs = cl(brief.afterLeadCaptureScreen);
    const ccr = cl(brief.ctaConsistencyRule);
    if (wem || psm || pwe || nav || mmp || surfaces.length || comps.length || efm || escr || pescr || navb || cjm || pci || lcr) {
      websiteExperiencePlan = {
        websiteExperienceModel: wem || undefined,
        pageScreenModel: psm || undefined,
        primaryWebsiteExperience: pwe || undefined,
        demoSurfaces: surfaces.length ? surfaces : undefined,
        statefulDemoComponents: comps.length ? comps : undefined,
        navigationModel: nav || undefined,
        mediaMotionPlan: mmp || undefined,
        entryFlowModel: efm || undefined,
        landingRequired: lreq || undefined,
        entryScreen: escr || undefined,
        postEntryScreen: pescr || undefined,
        primaryEntryCTA: pcta || undefined,
        secondaryEntryCTA: scta || undefined,
        navigationBehavior: navb || undefined,
        conversionJourneyModel: cjm || undefined,
        primaryConversionIntent: pci || undefined,
        leadCaptureRequired: lcr || undefined,
        leadCaptureFields: lcf || undefined,
        afterLeadCaptureScreen: alcs || undefined,
        ctaConsistencyRule: ccr || undefined,
        summary: L(lang,
          `Website experience: ${wem || 'focused site'}${nav ? ` · nav: ${nav}` : ''}${pwe ? ` · primary: ${pwe}` : ''} (front-end demo only).`,
          `Web sitesi deneyimi: ${wem || 'odaklı site'}${nav ? ` · gezinme: ${nav}` : ''}${pwe ? ` · birincil: ${pwe}` : ''} (yalnızca ön yüz demosu).`),
      };
    }
  }

  // Phase 1 Interaction Contract — a structured, concept-specific declaration of
  // the richer actions each section should support (chat demo, filter, detail
  // modal, quote/access forms …). Derived from the SAME signals the strategy just
  // reasoned over (concept category, CTA hierarchy, final sections) and now PREFERS
  // the model's Website Experience Plan. Fully guarded; Preview/Files consume it.
  let interactionContract: InteractionContract | undefined;
  try {
    interactionContract = deriveInteractionContract({
      brief,
      conceptCategory: cpf?.category,
      recommendedComponents: (research?.recommendedComponents || []).map((c) => c.name),
      recommendedPages: (research?.recommendedPages || []).map((p) => p.name),
      ctaHierarchy: { primary, secondary },
      sections,
      artMode: art?.designArchetype?.key,
      experiencePlan: websiteExperiencePlan,
      lang,
    });
  } catch {
    interactionContract = undefined;
  }

  return {
    positioning,
    mainPromise,
    // Fold the researched target-user profile (motivation + pain points) AND the UI
    // Agent's brand personality into the audience psychology so strategy speaks to
    // the real visitor and stays aligned with the art direction's tone.
    audiencePsychology: uniq([
      audience,
      cpf?.whoFor || '',
      research?.targetUser?.buyingMotivation || '',
      ...(research?.targetUser?.mainPainPoints || []).slice(0, 2),
      art?.brandPersonality || '',
      ...(research?.audienceExpectations || []),
    ]).join(' · '),
    visitorIntent: brief.visitorIntent || cpf?.visitorIntent || research?.targetUser?.buyingMotivation
      || (research?.audienceExpectations || [])[0]
      || L(lang, `Decide quickly whether this fits, then ${primary}.`, `Bunun uygun olup olmadığına hızlıca karar ver, sonra ${primary}.`),
    conversionStrategy,
    trustStrategy,
    ctaHierarchy: { primary, secondary },
    contentHierarchy,
    aboveTheFoldMustProve,
    sectionIntent,
    // Lead the risks with the concept anti-template warning when present.
    risksToAvoid: uniq([uia?.layoutWarning || '', ...(research?.risksToAvoid || [])]),
    differentiation,
    usedResearchInputs: usedResearchInputs.length ? usedResearchInputs : undefined,
    usedArtDirectionInputs: usedArtDirectionInputs.length ? usedArtDirectionInputs : undefined,
    interactionContract,
    websiteExperiencePlan,
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
  'filter-search': 'filter_search',
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

  // Hero proof placement is shaped by the Strategy Agent's above-the-fold proof,
  // the concept's proof needs, and the Research target-user trust needs — the plan
  // already positions it, this records WHY.
  const heroProof = (strategy?.aboveTheFoldMustProve || [])[0]
    || (research?.conceptProfile?.proofNeeded || [])[0]
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

  // conceptProfile is recorded ONLY when its proof need actually shaped the hero
  // proof placement above — an honest, verifiable consumption claim.
  const usedConceptProof = !!(research?.conceptProfile?.proofNeeded || []).length
    && !(strategy?.aboveTheFoldMustProve || []).length
    && heroProof === (research?.conceptProfile?.proofNeeded || [])[0];
  const usedResearchInputs = uniq([
    (research?.recommendedPages || []).length ? 'recommendedPages' : '',
    (research?.recommendedComponents || []).length ? 'recommendedComponents' : '',
    research?.targetUser ? 'targetUser' : '',
    (research?.trustSignals || []).length ? 'trustSignals' : '',
    usedConceptProof ? 'conceptProfile' : '',
  ]);
  // designArchetype is recorded ONLY when the resolved plan actually followed the
  // art archetype's mapped structure — an honest, verifiable handoff claim rather
  // than "art existed".
  const artArch = art?.designArchetype?.key ? ART_ARCHETYPE_TO_LAYOUT[art.designArchetype.key] : undefined;
  const planFollowedArt = !!artArch && artArch.archetype === plan.archetype;
  const usedArtDirectionInputs = uniq([
    planFollowedArt ? 'designArchetype' : '',
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
 * Deterministic map from the UI / Art Director's chosen DESIGN ARCHETYPE to the
 * layout plan's structural vocabulary (archetype + optional hero composition +
 * primary visual module). This is the connection that makes the Layout Architect
 * actually OBEY the Art Director's anti-sameness decision: each of the ~20
 * concept-specific art identities resolves to a genuinely different page STRUCTURE
 * (hero + visual system + section rhythm), not just a different palette. Without
 * this, the strong archetype the Art Director picks only tints the colors while
 * the plan re-detects a coarse archetype from prose and often collapses to the
 * generic default — the exact "same SaaS template every time" failure.
 *
 * Every value is a real member of the plan vocabulary (LayoutArchetype /
 * HeroComposition / VisualModule) and is re-validated against the plan whitelists
 * downstream, so an unknown or stale key is ignored safely. `modern-brand` is
 * intentionally omitted: it is the neutral fallback identity, so it is left to the
 * layout diversity guard, which derives a distinct structure from a hash of the
 * idea instead of pinning the generic default look.
 */
interface ArtLayoutSteer { archetype: string; hero?: string; module?: string }
const ART_ARCHETYPE_TO_LAYOUT: Record<string, ArtLayoutSteer> = {
  'editorial-archive':      { archetype: 'archive',        hero: 'catalog-collection',     module: 'catalog-archive' },
  'luxury-boutique':        { archetype: 'luxury-service',  hero: 'luxury-service',         module: 'editorial-story' },
  'high-conversion-saas':   { archetype: 'dashboard',       hero: 'dashboard-product',      module: 'data-dashboard' },
  'ai-tool':                { archetype: 'technical',       hero: 'split-editorial',        module: 'product-showcase' },
  'fintech-trust':          { archetype: 'data-platform',   hero: 'data-map',               module: 'data-dashboard' },
  'wellness-retreat':       { archetype: 'hospitality',     hero: 'luxury-service',         module: 'reservation-form' },
  'restaurant-hospitality': { archetype: 'hospitality',     hero: 'luxury-service',         module: 'reservation-form' },
  'landscaping-nature':     { archetype: 'portfolio',       hero: 'asymmetric-visual',      module: 'catalog-archive' },
  'cinematic-studio':       { archetype: 'event',           hero: 'immersive-full-bleed',   module: 'editorial-story' },
  'creative-agency':        { archetype: 'portfolio',       hero: 'asymmetric-visual',      module: 'editorial-story' },
  'portfolio-showcase':     { archetype: 'portfolio',       hero: 'asymmetric-visual',      module: 'editorial-story' },
  'marketplace-catalog':    { archetype: 'marketplace',     hero: 'catalog-collection',     module: 'catalog-archive' },
  'education-platform':     { archetype: 'membership',      hero: 'membership-application', module: 'membership-pass' },
  'community-membership':   { archetype: 'community',       hero: 'split-editorial',        module: 'membership-pass' },
  'legal-medical-trust':    { archetype: 'luxury-service',  hero: 'luxury-service',         module: 'editorial-story' },
  'local-service-premium':  { archetype: 'hospitality',     hero: 'luxury-service',         module: 'reservation-form' },
  'industrial-b2b':         { archetype: 'technical',       hero: 'dashboard-product',      module: 'data-dashboard' },
  'event-conference':       { archetype: 'event',           hero: 'event-experience',       module: 'timeline-process' },
  'real-estate':            { archetype: 'archive',         hero: 'catalog-collection',     module: 'catalog-archive' },
  'nonprofit-campaign':     { archetype: 'community',       hero: 'split-editorial',        module: 'membership-pass' },
  'founder-startup':        { archetype: 'dashboard',       hero: 'split-editorial',        module: 'product-showcase' },
};

/**
 * Fallback map from the Research Agent's concept CATEGORY to the layout vocabulary.
 * Used only to GAP-FILL layout steering when the Art Direction did not pin a
 * structure and the recommended-pages/components heuristic came up empty — so a
 * clearly-typed concept (archive, hospitality, legal…) still avoids the generic
 * 'standard' fallback. Every value is a real member of the plan vocabulary
 * (validated by the plan whitelists downstream). `general` is intentionally absent.
 */
const CONCEPT_TO_LAYOUT: Record<string, ArtLayoutSteer> = {
  archive:       { archetype: 'archive',        hero: 'catalog-collection',     module: 'catalog-archive' },
  hospitality:   { archetype: 'hospitality',     hero: 'luxury-service',         module: 'reservation-form' },
  landscaping:   { archetype: 'portfolio',       hero: 'asymmetric-visual',      module: 'catalog-archive' },
  local_service: { archetype: 'hospitality',     hero: 'luxury-service',         module: 'reservation-form' },
  legal:         { archetype: 'luxury-service',  hero: 'luxury-service',         module: 'editorial-story' },
  medical:       { archetype: 'luxury-service',  hero: 'luxury-service',         module: 'editorial-story' },
  // Phase 8A: AI/SaaS default to a focused product/chat surface, NOT a dashboard.
  // The ledger re-promotes a dashboard surface only on an explicit dashboard request.
  ai:            { archetype: 'technical',       hero: 'split-editorial',        module: 'product-showcase' },
  saas:          { archetype: 'technical',       hero: 'split-editorial',        module: 'product-showcase' },
  marketplace:   { archetype: 'marketplace',     hero: 'catalog-collection',     module: 'catalog-archive' },
  education:     { archetype: 'membership',      hero: 'membership-application', module: 'membership-pass' },
  nonprofit:     { archetype: 'community',       hero: 'split-editorial',        module: 'membership-pass' },
  portfolio:     { archetype: 'portfolio',       hero: 'asymmetric-visual',      module: 'editorial-story' },
  industrial:    { archetype: 'technical',       hero: 'dashboard-product',      module: 'data-dashboard' },
  event:         { archetype: 'event',           hero: 'event-experience',       module: 'timeline-process' },
  real_estate:   { archetype: 'archive',         hero: 'catalog-collection',     module: 'catalog-archive' },
  finance:       { archetype: 'data-platform',   hero: 'data-map',               module: 'data-dashboard' },
};

/**
 * Decide the STRUCTURE the layout plan should use, FROM the agent artifacts — so
 * the plan (and therefore both the preview and the generated files) obeys the
 * agents instead of re-detecting an archetype from prose. The PRIMARY signal is
 * the Art Director's design archetype (mapped above): it is chosen from the
 * concept + the FULL Research brief (visual style, recommended components/pages,
 * target user, category language), so it is strictly more informed than re-reading
 * a few research fields here. The Research-signal derivation is kept as the
 * FALLBACK — it fills any field the art archetype did not pin, and drives the
 * whole result when there is no art archetype (e.g. the neutral modern-brand
 * identity). Returns {} when every signal is too weak, so the existing detection +
 * diversity guard still applies (never forced to 'standard').
 */
/** The dashboard-demo structure an AI/SaaS product must not DEFAULT into. */
const DASHBOARD_HERO = 'dashboard-product';
const DASHBOARD_MODULE = 'data-dashboard';

/**
 * Ledger-driven dashboard guard (Phase 8A). The Thinking Ledger decides whether
 * this concept's demo surface is a dashboard or a focused product/chat flow. When
 * the intent is chat/product-flow, any dashboard hero/module the art archetype
 * pinned is DEMOTED to a product surface; when a dashboard was explicitly
 * requested, the product default is PROMOTED back to the dashboard surface. Pure.
 */
function guardLayoutAgainstDashboard(
  steer: { agentArchetype?: string; agentHero?: string; agentModule?: string },
  ledger: StrategicThinkingLedger | undefined,
): { agentArchetype?: string; agentHero?: string; agentModule?: string } {
  if (!ledger) return steer;
  const out = { ...steer };
  if (ledger.demoSurfaceIntent === 'dashboard-demo') {
    // Dashboard explicitly requested → allow the dashboard surface back.
    if (!out.agentHero || out.agentHero === 'split-editorial') out.agentHero = DASHBOARD_HERO;
    if (!out.agentModule || out.agentModule === 'product-showcase') out.agentModule = DASHBOARD_MODULE;
    return out;
  }
  const avoidsDashboard = ledger.demoSurfaceIntent === 'chat-demo' || ledger.demoSurfaceIntent === 'product-flow-demo';
  if (!avoidsDashboard) return out;
  if (out.agentHero === DASHBOARD_HERO) out.agentHero = 'split-editorial';
  if (out.agentModule === DASHBOARD_MODULE) out.agentModule = 'product-showcase';
  if (out.agentArchetype === 'dashboard') out.agentArchetype = 'technical';
  return out;
}

export function deriveLayoutSteering(
  research: ResearchAgentArtifact | undefined,
  art: ArtDirectionArtifact | undefined,
  strategy: StrategyAgentArtifact | undefined,
  ledger?: StrategicThinkingLedger,
): { agentArchetype?: string; agentHero?: string; agentModule?: string } {
  const artKey = art?.designArchetype?.key;
  const artSteer = artKey ? ART_ARCHETYPE_TO_LAYOUT[artKey] : undefined;
  // Fallback (previously the whole of this function) — never regresses when the
  // art archetype is absent or does not pin a hero/module.
  const res = deriveLayoutSteeringFromResearch(research, art, strategy);
  const agentArchetype = artSteer?.archetype || res.agentArchetype;
  const agentHero = artSteer?.hero || res.agentHero;
  const agentModule = artSteer?.module || res.agentModule;
  const out: { agentArchetype?: string; agentHero?: string; agentModule?: string } = {};
  if (agentArchetype) out.agentArchetype = agentArchetype;
  if (agentHero) out.agentHero = agentHero;
  if (agentModule) out.agentModule = agentModule;
  // Phase 8A: the ledger has final say over the dashboard-vs-product demo surface.
  const guarded = guardLayoutAgainstDashboard(out, ledger);
  // Phase 9A: the MODEL's own hero/demo decision (from the Design Thinking Plan) has
  // the HIGHEST authority — applied AFTER the dashboard guard so an explicit model
  // choice is never demoted. Values are validated against the plan whitelist later.
  const mp = ledger?.modelDesignPlan;
  if (mp?.heroComposition) guarded.agentHero = mp.heroComposition;
  if (mp?.demoModule) guarded.agentModule = mp.demoModule;
  return guarded;
}

/**
 * Research-signal fallback for layout steering. Signal-driven from the Research
 * brief's recommended pages/components + visual style + target user — never a
 * fixed per-example template. Returns {} when signals are too weak, so the
 * existing detection + diversity guard still applies.
 */
function deriveLayoutSteeringFromResearch(
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

  // GAP-FILL from the concept category — a clearly-typed concept steers the plan
  // away from the generic 'standard' fallback when the heuristic above was silent.
  // Only fills; never overrides a value the pages/components heuristic already set.
  const conceptSteer = research.conceptProfile?.category
    ? CONCEPT_TO_LAYOUT[research.conceptProfile.category]
    : undefined;
  if (conceptSteer) {
    archetype = archetype || conceptSteer.archetype;
    module = module || conceptSteer.module;
    hero = hero || conceptSteer.hero;
  }

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
  ledger?: StrategicThinkingLedger,
): WebBuildBrief {
  let b: WebBuildBrief = { ...brief };
  // Structure steering — the plan (preview + files) obeys the agents. Model's own
  // explicit values (if ever present on the brief) still win via `||`. Phase 8A:
  // the Thinking Ledger gets final say over the dashboard-vs-product demo surface.
  const steer = deriveLayoutSteering(research, art, strategy, ledger);
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
    // RENDERABLE identity — gap-fill so the preview + files render the same
    // concept-specific surface/proof/hero language. Arrays copied defensively;
    // component style summarized into one concise string. Missing art fields are
    // simply skipped (never crash).
    const csr = art.componentStyleRules;
    const componentStyleSummary = csr
      ? [csr.cards, csr.gallery, csr.trustBlocks].filter(Boolean).join(' · ') || undefined
      : undefined;
    b = {
      ...b,
      artDesignArchetype: b.artDesignArchetype || art.designArchetype?.key,
      artVisualSignature: b.artVisualSignature || art.visualSignature,
      artAntiTemplateDiagnosis: b.artAntiTemplateDiagnosis || art.antiTemplateDiagnosis,
      artCompositionRules: b.artCompositionRules || (art.compositionRules ? [...art.compositionRules] : undefined),
      artSurfaceRules: b.artSurfaceRules || (art.surfaceRules ? [...art.surfaceRules] : undefined),
      artProofRules: b.artProofRules || (art.proofRules ? [...art.proofRules] : undefined),
      artImageryDirection: b.artImageryDirection || art.imagerySystem?.imageType || art.imageryDirection,
      artHeroTreatment: b.artHeroTreatment || art.heroTreatment?.composition || art.heroDirection,
      artComponentStyle: b.artComponentStyle || componentStyleSummary,
    };
    // Visual Exploration decision (Phase 7B) — persist the chosen palette family +
    // selected visual candidate so the design system (preview + files) and owner
    // diagnostics read the same anti-template decision.
    const selCand = art.visualExploration?.candidates.find((c) => c.id === art.visualExploration?.selectedCandidateId);
    b = {
      ...b,
      paletteFamily: b.paletteFamily || art.paletteFamily || selCand?.paletteFamily,
      selectedVisualCandidate: b.selectedVisualCandidate || art.visualExploration?.selectedCandidateId,
      accentStrategy: b.accentStrategy || selCand?.accentStrategy,
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
  vertical_intelligence: ['Vertical Intelligence', 'Sektör Zekâsı'],
  layout_architect: ['Layout Architect Agent', 'Yerleşim Mimarı Ajanı'],
  component_engineer: ['Component Engineer Agent', 'Bileşen Mühendisi Ajanı'],
  reviewer: ['Reviewer Agent', 'Gözden Geçirme Ajanı'],
  quality_director: ['Quality Director', 'Kalite Direktörü'],
  asset_director: ['Asset Director', 'Varlık Direktörü'],
  motion_composer: ['Motion Composer', 'Hareket Tasarımcısı'],
  image_pipeline: ['Image Pipeline', 'Görsel Pipeline'],
  fixer: ['Fixer Agent', 'Düzeltici Ajan'],
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
  try { researchArtifact = deriveResearchAgent(brief, research, inferred, lang, prompt); }
  catch { researchArtifact = fallbackResearchArtifact(lang); fallbacks.push('research'); }
  artifacts.research = researchArtifact;

  // 1.5) STRATEGIC THINKING LEDGER (Phase 8A) — the deterministic strategic
  //      decision the rest of the pipeline OBEYS. Derived from Research (Concept
  //      Authority) + brief + prompt; guarded, non-blocking.
  let thinkingLedger: StrategicThinkingLedger | undefined;
  try { thinkingLedger = deriveThinkingLedger(prompt, brief, researchArtifact, inferred, lang); }
  catch { thinkingLedger = undefined; }
  artifacts.thinkingLedger = thinkingLedger;

  // 2) UI / Art Director — consumes the Research artifact + the Thinking Ledger
  //    (demo-surface intent steers the concept-specific hero visual).
  let art: ArtDirectionArtifact | undefined;
  try { art = deriveArtDirection(brief, researchArtifact, inferred, lang, thinkingLedger); }
  catch { art = undefined; fallbacks.push('ui_art_director'); }
  artifacts.artDirection = art;

  // 3) Strategy Agent — consumes Research + Art Direction + the Thinking Ledger
  //    (conversion path + demo-surface intent).
  let strategy: StrategyAgentArtifact | undefined;
  try { strategy = deriveStrategyAgent(brief, researchArtifact, inferred, sections, art, lang, thinkingLedger); }
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
    thinkingLedger: thinkingLedger || null,
  };

  const agents: WebBuildAgent[] = [
    agentRow('research', lang, researchArtifact),
    agentRow('ui_art_director', lang, art),
    agentRow('strategy', lang, strategy),
  ];

  return { agents, artifacts, enrichedBrief: enrichBriefWithAgents(brief, researchArtifact, art, strategy, thinkingLedger) };
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

  const cpf = research?.conceptProfile;
  const contentModel: Record<string, unknown> = {
    source: 'src/data/siteContent.ts',
    sections: plan.sections.length,
    // Name the concept read so the content model is honestly traceable to it.
    concept: cpf ? `${cpf.category} · ${cpf.contentType}` : undefined,
    drivenBy: uniq([
      research ? 'Research categoryLanguage + audienceExpectations' : '',
      cpf ? 'Research conceptProfile (content type + proof)' : '',
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
    // Recorded ONLY because the content model above reads the concept profile.
    cpf ? 'conceptProfile' : '',
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

/* ── Reviewer Agent (Phase 5) — advisory quality gate ─────────────────────
 * Inspects the REAL upstream artifacts + the final section list / layout plan /
 * generated files and records honest findings + fix instructions for a future
 * Fixer Agent. Pure, deterministic, never fabricates, never rewrites the site,
 * never blocks Preview/All Files. */
export interface ReviewerInput {
  prompt: string;
  brief: WebBuildBrief;
  research?: ResearchAgentArtifact;
  artDirection?: ArtDirectionArtifact;
  strategy?: StrategyAgentArtifact;
  blueprint?: PageBlueprint;
  componentEngineer?: ComponentEngineerArtifact;
  /** Final section list actually rendered/generated (id + name). */
  sectionItems?: Array<{ id: string; name: string }>;
  layoutPlan?: WebBuildLayoutPlan;
  /** Final generated files (path + content) — enables the fake-data + parity checks. */
  files?: Array<{ path: string; content?: string }>;
  lang?: Lang;
}

/** Unambiguous fabricated-fact fingerprints (the exact tokens the fake-data guard
 *  removes). Matched against generated FILE CONTENT + component summaries + section
 *  names only — never the reviewer's own source — so no self-flagging. */
const REVIEW_HARD_FAKE: Array<[string, RegExp]> = [
  ['a "₺199" price', /₺\s?199/], ['a "₺120" price', /₺\s?120/],
  ['a "4.9★" rating', /4\.9\s*★/], ['a "12k+" count', /12\s?k\s?\+/i],
  ['a "2.4k" metric', /\b2\.4k\b/i], ['a "+37%" delta', /\+\s?37\s?%/],
  ['a "SOC2" compliance claim', /\bsoc\s?2\b/i],
];
/** Ambiguous proof-like tokens — flagged as a warning to VERIFY, not asserted. */
const REVIEW_SOFT_FAKE: Array<[string, RegExp]> = [
  ['a "98%" stat', /\b98\s?%/], ['a "24/7" claim', /\b24\s?\/\s?7\b/],
  ['an "uptime" claim', /\buptime\b/i], ['a "Müşteri" testimonial label', /\bmüşteri\b/i],
];

function failedOpenReviewer(lang: Lang): ReviewerAgentArtifact {
  const checklist: ReviewerChecklist = {
    conceptFit: false, antiTemplate: false, visualIdentity: false, sectionArchitecture: false,
    contentHonesty: false, fakeDataGuard: false, interactionReadiness: false, motionFit: false,
    accessibilityBasics: false, responsiveBasics: false, previewFilesParity: false,
  };
  return {
    status: 'failed-open', checklist, findings: [], passed: [], risks: [],
    fixInstructions: [], futureFixerScope: [],
    summary: L(lang, 'Reviewer failed open; build continued without blocking Preview or All Files.',
      'Gözden geçirme başarısız oldu; yapı Önizleme veya Tüm Dosyaları engellemeden devam etti.'),
  };
}

/**
 * Derive the advisory Reviewer artifact from the real, available data only. If a
 * signal is not inspectable at this phase it is recorded as such (never a fake pass).
 */
export function deriveReviewerAgent(input: ReviewerInput): ReviewerAgentArtifact {
  const lang = input.lang || 'en';
  const findings: ReviewerFinding[] = [];
  const passed: string[] = [];
  let fid = 0;
  const add = (severity: ReviewSeverity, category: string, title: string, evidence: string, recommendation: string, target?: string) => {
    findings.push({ id: `rv-${fid += 1}`, severity, category, title, evidence, recommendation, target });
  };

  const category = (input.research?.conceptProfile?.category || input.brief.type || '').toLowerCase();
  const hay = `${category} ${input.prompt || ''}`.toLowerCase();
  const isStrongConcept = /archive|museum|catalog|collection|landscap|legal|law|attorney|medical|clinic|health|dental|finance|bank|insurance|restaurant|hospitality|cafe|hotel|gallery|portfolio|industrial|event|education|academy|marketplace|nonprofit|real.?estate|heritage/.test(hay);
  const isRestrained = /archive|museum|legal|law|attorney|medical|clinic|health|dental|finance|bank|insurance|hospitality|restaurant|cafe|hotel|landscap|heritage|trust/.test(hay);

  const sections = input.sectionItems || [];
  const contentSections = sections.filter((s) => !/hero|footer/i.test(s.id));
  const GENERIC = /^(features?|services?|about|benefits?|overview|content|section|home|final|testimonials?)$/;
  const firstTok = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')[0] || '';
  const isGenericSection = (s: { id: string; name: string }) => {
    const id = s.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return GENERIC.test(id) || GENERIC.test(firstTok(s.id)) || GENERIC.test(firstTok(s.name));
  };
  const genericCount = contentSections.filter(isGenericSection).length;
  const nonGenericCount = contentSections.length - genericCount;
  const hasConversion = contentSections.some((s) => /cta|quote|contact|reserv|ticket|pricing|enroll|donation|volunteer|request|start-project|researcher-access|checkout|cart/i.test(`${s.id} ${s.name}`));
  const hasProof = contentSections.some((s) => /proof|provenance|credential|trust|review|testimonial|curation|certif|security-proof/i.test(`${s.id} ${s.name}`));

  /* 1 — Concept fit */
  const conceptMismatch = isStrongConcept && (nonGenericCount < 2 || genericCount >= Math.max(1, nonGenericCount));
  const conceptFit = !!category && !conceptMismatch;
  if (conceptMismatch) {
    add('critical', 'concept-fit', 'Concept/section mismatch',
      `Concept "${category || 'unknown'}" reads as a strong concept but ${genericCount}/${contentSections.length} content sections are generic (About/Services/Features).`,
      'Replace generic Services/About/Features sections with concept-specific sections for this category (e.g. archive → collection-index/document-types/provenance).',
      'sectionItems');
  } else if (conceptFit) passed.push(L(lang, 'Concept fit', 'Konsept uyumu'));

  /* 2 — Anti-template */
  const hasAntiTemplate = !!input.artDirection?.antiTemplateDiagnosis && !!input.artDirection?.designArchetype;
  const genericArchetype = input.layoutPlan?.archetype === 'standard';
  const templateRisk = isStrongConcept && (!hasAntiTemplate || genericArchetype);
  const antiTemplate = !templateRisk;
  if (templateRisk) {
    add('warning', 'anti-template', 'Template-sameness risk',
      genericArchetype ? `Layout archetype resolved to generic "standard" for a strong concept.` : 'Art Direction has no anti-template diagnosis / design archetype for a strong concept.',
      'Ensure the Art Director sets a concept-specific designArchetype + antiTemplateDiagnosis and the Layout Architect avoids the generic SaaS archetype.',
      'artDirection.antiTemplateDiagnosis');
  } else if (isStrongConcept) passed.push(L(lang, 'Anti-template', 'Şablon karşıtı'));

  /* 2.5 — Concept drift (Phase 5): the target vertical must NOT override the
   *        primary concept's visual archetype/layout (e.g. an "AI chatbot for
   *        ecommerce" rendered as a marketplace/catalog instead of an AI product). */
  const authority = input.research?.conceptAuthority;
  const primaryConcept = authority?.primaryConcept;
  const artKey = input.artDirection?.designArchetype?.key;
  const driftGuardApplied = !!input.artDirection?.correctedConceptDrift;
  const driftKeys = new Set([...(authority?.mustNotDriftTo || []), 'marketplace-catalog']);
  const expectedArch = primaryConcept ? CATEGORY_TO_ARCHETYPE[primaryConcept] : undefined;
  const artDrift = !!authority && primaryConcept !== 'marketplace' && !!artKey
    && driftKeys.has(artKey) && !!expectedArch && expectedArch !== artKey;
  const layoutCommerceDrift = (primaryConcept === 'ai' || primaryConcept === 'saas')
    && input.layoutPlan?.archetype === 'marketplace';
  const conceptDrift = !driftGuardApplied && (artDrift || layoutCommerceDrift);
  if (conceptDrift) {
    add('critical', 'concept-drift', 'Target vertical overrode the primary concept',
      `Primary concept "${primaryConcept}" must control the visual identity, but the ${artDrift ? `art archetype resolved to "${artKey}"` : 'layout archetype resolved to "marketplace"'} — a ${authority?.targetVertical || 'target-vertical'} (catalog/commerce) identity.`,
      `Re-assert the primary-concept archetype (${expectedArch || 'ai-tool / high-conversion-saas'}); the target vertical may only inform copy/proof/examples, never the visual archetype/layout/hero.`,
      'artDirection.designArchetype');
  } else if (authority && primaryConcept && primaryConcept !== 'general') {
    passed.push(L(lang, 'Concept authority respected', 'Konsept otoritesi korundu'));
  }

  /* 2.6 — Visual drift: a generic SaaS/modern look for a distinctive concept. */
  const genericSaasArt = artKey === 'high-conversion-saas' || artKey === 'modern-brand';
  const distinctiveConcept = !!primaryConcept && !['saas', 'ai', 'general'].includes(primaryConcept);
  if (!conceptDrift && genericSaasArt && distinctiveConcept) {
    add('warning', 'visual-drift', 'Generic SaaS visual direction for a distinctive concept',
      `Concept "${primaryConcept}" resolved to a generic "${artKey}" art archetype.`,
      'Give the concept its own archetype + visual signature instead of the default SaaS/modern-brand look.',
      'artDirection.designArchetype');
  }

  /* 2.7 — Missing visual asset plan (Phase 5, data-only). */
  const hasAssetPlan = !!input.artDirection?.visualAssetPlan?.assetSlots?.length;
  if (input.artDirection && !hasAssetPlan) {
    add('warning', 'missing-asset-plan', 'No visual asset/motion plan',
      'Art Direction produced no visualAssetPlan (hero visual type + asset slots + constraints).',
      'Produce a concept-specific Visual Asset Plan (CSS/SVG now, external image/video later) so preview/files have concrete visual direction.',
      'artDirection.visualAssetPlan');
  } else if (hasAssetPlan) passed.push(L(lang, 'Visual asset plan', 'Görsel varlık planı'));

  /* 2.8 — Weak premium UI signals. */
  const weakPremium = !!input.artDirection
    && !(input.artDirection.premiumDetails || []).length
    && !(input.artDirection.visualDifferentiators || []).length
    && !(input.artDirection.surfaceRules || []).length;
  if (weakPremium) {
    add('warning', 'weak-premium-ui', 'Weak premium UI signals',
      'Art Direction has no premiumDetails / visualDifferentiators / surfaceRules to carry a premium finish into components.',
      'Add premium detail rules (surface language, focal accent, differentiators) so the build reads as a real premium product.',
      'artDirection');
  }

  /* 2.9 — Weak demo/page architecture (Phase 6A): an AI/SaaS concept with no
   *        chat/product-demo surface reads as a shallow single page in Preview. */
  const ic = input.strategy?.interactionContract;
  const isAiSaas = primaryConcept === 'ai' || primaryConcept === 'saas'
    || /\bai\b|assistant|chatbot|\bsaas\b/.test(hay);
  if (isAiSaas) {
    const statefulHay = (ic?.requiredStatefulComponents || []).join(' ').toLowerCase();
    const screenHay = (ic?.suggestedScreens || []).map((s) => s?.name || '').join(' ').toLowerCase();
    const hasDemoSurface = /chat|assistant|product-?demo|\bdemo\b|playground/.test(`${statefulHay} ${screenHay}`);
    if (!hasDemoSurface) {
      add('warning', 'weak-demo-architecture', 'Weak demo/page architecture for an AI/SaaS product',
        'No chat / product-demo stateful component or demo screen is declared for an AI/SaaS concept.',
        'Declare a chat/product-demo surface (requiredStatefulComponents or a suggestedScreen) so the Preview builds a real Product Demo / Chat Experience screen.',
        'strategy.interactionContract');
    } else passed.push(L(lang, 'Demo/page architecture', 'Demo/sayfa mimarisi'));
  }

  /* 2.10 — Nav discipline + entry-flow visibility (Phase 6C, ADVISORY only —
   *         severity 'info', never blocks the build). */
  const ic6c = input.strategy?.interactionContract;
  if (ic6c) {
    const screenCount = (ic6c.suggestedScreens || []).length;
    if (screenCount > 6) {
      add('info', 'nav-overexposure', 'Many suggested screens may over-expose the nav',
        `The plan suggests ${screenCount} screens; the Preview caps the top nav at ~6 and moves the rest to an overflow group.`,
        'Prefer one clear experience screen + a few marketing screens so the top nav stays ≤6.',
        'strategy.interactionContract.suggestedScreens');
    }
    const aiSaas6c = /^(ai|saas)$/.test((ic6c.conceptCategory || '').toLowerCase())
      || (ic6c.requiredStatefulComponents || []).some((c) => /chat|product-?demo|assistant/i.test(c))
      || isAiSaas;
    if (aiSaas6c && !(ic6c.requiredStatefulComponents || []).some((c) => /chat|product-?demo/i.test(c))) {
      add('info', 'missing-landing-demo-teaser', 'No chat/product-demo surface for the landing teaser',
        'No chat/product-demo stateful component is declared, so the landing demo teaser + Product Demo screen may not render for this AI/SaaS build.',
        'Declare a chat/product-demo surface so the landing shows a compact demo teaser and the entry CTA opens the full demo.',
        'strategy.interactionContract.requiredStatefulComponents');
    }
    if (!ic6c.entryFlowModel && !ic6c.postEntryScreenId) {
      add('info', 'entry-flow-not-visible', 'Entry flow is not surfaced on the contract',
        'The contract has no entryFlowModel / postEntryScreenId, so the Preview cannot transition the hero CTA into an internal experience.',
        'Ensure the strategy derives an entry flow (landing → demo/catalog/collection/quote) so the primary CTA has a destination.',
        'strategy.interactionContract');
    }
  }

  /* 2.11 — Conversion journey advisories (Phase 6F, ADVISORY only — 'info'). */
  const cj = input.strategy?.interactionContract;
  if (cj) {
    const cjAiSaas = /^(ai|saas)$/.test((cj.conceptCategory || '').toLowerCase())
      || (cj.requiredStatefulComponents || []).some((c) => /chat|product-?demo|assistant/i.test(c));
    if (cjAiSaas && cj.leadCaptureRequired !== true && cj.conversionJourneyModel !== 'direct-cta' && cj.conversionJourneyModel !== 'book-demo') {
      add('info', 'missing-lead-gate', 'AI/SaaS product without a lead-capture gate',
        `Conversion journey is "${cj.conversionJourneyModel || 'unset'}" with no lead capture, so the primary CTA drops the visitor straight into the demo.`,
        'For a "try/free/get started" product, prefer lead-capture-gated-demo (Landing → Lead Capture → Demo) unless the idea asks for a direct demo.',
        'strategy.interactionContract.conversionJourneyModel');
    }
    if (!cj.primaryConversionIntent && !cj.conversionJourneyModel) {
      add('info', 'confusing-primary-conversion', 'No single primary conversion declared',
        'The contract has no conversion journey model or primary conversion intent, so the site may show competing CTAs.',
        'Declare one primary conversion intent (free trial / book demo / request quote / browse catalog …) and keep other CTAs secondary.',
        'strategy.interactionContract.primaryConversionIntent');
    }
    if (!cj.ctaConsistencyRule) {
      add('info', 'cta-inconsistency', 'No CTA consistency rule',
        'No CTA consistency rule is set, so primary vs secondary CTA labels may drift (e.g. "Book demo" + "Try it free" + a metrics/security label competing).',
        'Set one primary CTA label and keep secondary CTAs supporting (See how it works / See pricing / View security).',
        'strategy.interactionContract.ctaConsistencyRule');
    }
    if (cjAiSaas && cj.leadCaptureRequired === true && !cj.afterLeadCaptureScreenId && !cj.postEntryScreenId) {
      add('info', 'demo-before-context', 'Lead gate has no destination experience',
        'A lead-capture gate is required but no post-lead demo/experience screen is resolvable, so the gate would lead nowhere.',
        'Ensure a Product Demo / Chat Experience screen exists for the gate to open after lead capture.',
        'strategy.interactionContract.afterLeadCaptureScreenId');
    }
  }

  /* 3 — Visual identity */
  const visualIdentity = !!input.artDirection?.designArchetype
    && !!(input.artDirection?.visualSignature || input.artDirection?.visualDifferentiators?.length || input.artDirection?.surfaceRules?.length);
  if (!visualIdentity) {
    add('warning', 'visual-identity', 'Weak visual identity signals',
      'Art Direction is missing a designArchetype and/or visualSignature/visualDifferentiators/surfaceRules.',
      'Populate designArchetype, visualSignature and at least one of visualDifferentiators/surfaceRules so the identity survives into components.',
      'artDirection');
  } else passed.push(L(lang, 'Visual identity', 'Görsel kimlik'));

  /* 4 — Section architecture */
  const sectionArchitecture = contentSections.length >= 4 && hasConversion;
  if (!sectionArchitecture) {
    add('warning', 'section-architecture', 'Thin or conversion-less architecture',
      `${contentSections.length} content section(s); conversion section ${hasConversion ? 'present' : 'MISSING'}, proof section ${hasProof ? 'present' : 'missing'}.`,
      'Ensure at least ~4 concept sections plus a conversion (CTA/quote/contact/reservation) section and a proof/credibility section.',
      'sectionItems');
  } else passed.push(L(lang, 'Section architecture', 'Bölüm mimarisi'));

  /* 5 — Content honesty / fake-data guard */
  const filesArr = input.files || [];
  const filesProvided = filesArr.length > 0;
  const haystack = `${filesArr.map((f) => f.content || '').join('\n')}\n${input.componentEngineer?.summary || ''}\n${sections.map((s) => s.name).join('\n')}`;
  const hardHits = REVIEW_HARD_FAKE.filter(([, re]) => re.test(haystack)).map(([label]) => label);
  const softHits = REVIEW_SOFT_FAKE.filter(([, re]) => re.test(haystack)).map(([label]) => label);
  const fakeDataGuard = filesProvided ? hardHits.length === 0 && softHits.length === 0 : true;
  const contentHonesty = fakeDataGuard;
  if (hardHits.length) {
    add('critical', 'fake-data', 'Fabricated proof/metric tokens present',
      `Generated output contains ${uniq(hardHits).join(', ')}.`,
      'Remove unsupported ratings/prices/compliance claims; use honest structural labels or real user-provided values only.',
      'files');
  }
  if (softHits.length) {
    add('warning', 'fake-data', 'Possible unsupported proof tokens (verify)',
      `Generated output contains ${uniq(softHits).join(', ')} — verify these are honest, user-provided values, not fabricated proof.`,
      'Confirm these tokens are real user/backend content; otherwise remove or replace with structural labels.',
      'files');
  }
  if (filesProvided && !hardHits.length && !softHits.length) passed.push(L(lang, 'Fake-data guard', 'Sahte veri koruması'));

  /* 6 — Interaction readiness */
  const interactionReadiness = hasConversion && contentSections.length >= 3;
  if (!interactionReadiness) {
    add('warning', 'interaction', 'Weak interaction/CTA readiness',
      hasConversion ? 'Too few content sections to carry a nav + conversion path.' : 'No conversion/CTA section detected for nav + CTA routing.',
      'Add a clear conversion section and route the primary CTA to it (e.g. quote-cta / reservation / pricing) instead of a generic contact.',
      'sectionItems');
  } else passed.push(L(lang, 'Interaction readiness', 'Etkileşim hazırlığı'));

  /* 7 — Motion fit */
  const motionMood = `${input.artDirection?.motionSystem?.animationMood || ''} ${input.artDirection?.motionDirection || ''}`.toLowerCase();
  const noisyMotion = input.layoutPlan?.motionPattern === 'kinetic' || /expressive|energetic|kinetic|bold|pulse|vibrant|lively/.test(motionMood);
  const motionRisk = isRestrained && noisyMotion;
  const motionFit = !motionRisk;
  if (motionRisk) {
    add('warning', 'motion-fit', 'Motion too expressive for a trust/restrained concept',
      `Concept is restraint-first but motion reads as "${input.layoutPlan?.motionPattern || motionMood.trim() || 'expressive'}".`,
      'Keep archive/legal/medical/finance/hospitality motion subtle (calm reveal / slow rule-scan); avoid dashboard/data-pulse motifs.',
      'artDirection.motionSystem');
  } else passed.push(L(lang, 'Motion fit', 'Hareket uyumu'));

  /* 8 — Accessibility basics */
  const accessibilityBasics = !!(input.artDirection?.accessibilityDirection?.contrastRule || input.artDirection?.accessibilityDirection?.readabilityRule);
  if (!accessibilityBasics) {
    add('warning', 'accessibility', 'No accessibility direction',
      'Art Direction has no accessibilityDirection (contrast/readability/motion-safety).',
      'Add accessibilityDirection with contrast, readability and motion-safety rules.',
      'artDirection.accessibilityDirection');
  } else passed.push(L(lang, 'Accessibility basics', 'Erişilebilirlik temelleri'));

  /* 9 — Responsive basics */
  const responsiveBasics = !!(input.artDirection?.responsiveDirection || input.artDirection?.responsiveDesignDirection || input.blueprint?.responsiveBehavior);
  if (!responsiveBasics) {
    add('warning', 'responsive', 'No responsive direction',
      'No responsiveDirection / responsiveBehavior recorded by Art Direction or the blueprint.',
      'Add responsive direction (mobile/desktop priority, nav + hero mobile behavior, stacking rules).',
      'artDirection.responsiveDirection');
  } else passed.push(L(lang, 'Responsive basics', 'Duyarlı tasarım temelleri'));

  /* 10 — Preview / All Files parity (only claimed when actually inspectable) */
  const parityInspectable = filesProvided && sections.length > 0;
  const previewFilesParity = parityInspectable;
  if (!parityInspectable) {
    add('info', 'parity', 'Preview/All Files parity not inspectable at this phase',
      'The reviewer did not receive both the final section list and the generated files, so parity was not verified.',
      'Run the reviewer where both the resolved sections and generated files are available to verify parity.',
      'files');
  } else {
    passed.push(L(lang, 'Preview/All Files parity (by construction)', 'Önizleme/Tüm Dosyalar uyumu'));
  }

  const checklist: ReviewerChecklist = {
    conceptFit, antiTemplate, visualIdentity, sectionArchitecture, contentHonesty, fakeDataGuard,
    interactionReadiness, motionFit, accessibilityBasics, responsiveBasics, previewFilesParity,
  };

  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const status: ReviewStatus = criticalCount > 0 ? 'needs-fixes' : 'passed';
  const risks = findings.filter((f) => f.severity !== 'info').map((f) => f.title);
  const fixInstructions = uniq(findings.map((f) => f.recommendation));
  const futureFixerScope = uniq(findings.map((f) => f.category));
  const parityNote = parityInspectable
    ? L(lang, 'preview/files parity aligned by construction', 'önizleme/dosya uyumu yapısal olarak sağlandı')
    : L(lang, 'preview/files parity was not inspectable at this phase', 'önizleme/dosya uyumu bu aşamada denetlenemedi');
  const topTitles = findings.filter((f) => f.severity !== 'info').slice(0, 3).map((f) => f.title).join('; ');

  let summary: string;
  if (criticalCount > 0) {
    summary = L(lang,
      `Reviewer found ${findings.length} issue(s) (${criticalCount} critical): ${topTitles}. ${parityNote}. See fixInstructions for the Fixer.`,
      `Gözden geçirme ${findings.length} sorun buldu (${criticalCount} kritik): ${topTitles}. ${parityNote}.`);
  } else if (warningCount > 0) {
    summary = L(lang,
      `Reviewer passed with ${warningCount} warning(s): ${topTitles}; ${parityNote}.`,
      `Gözden geçirme ${warningCount} uyarı ile geçti: ${topTitles}; ${parityNote}.`);
  } else {
    summary = L(lang,
      `Reviewer passed: concept fit, visual identity and CTA path are coherent; ${parityNote}.`,
      `Gözden geçirme geçti: konsept uyumu, görsel kimlik ve CTA yolu tutarlı; ${parityNote}.`);
  }

  const present = (v: unknown): boolean => Array.isArray(v) ? v.length > 0 : !!v;
  const usedResearchInputs = [
    input.research?.conceptProfile?.category ? 'conceptProfile.category' : '',
    present(input.research?.conceptProfile?.proofNeeded) ? 'conceptProfile.proofNeeded' : '',
    input.research?.conceptAuthority ? 'conceptAuthority' : '',
  ].filter(Boolean);
  const usedArtDirectionInputs = [
    input.artDirection?.designArchetype ? 'designArchetype' : '',
    input.artDirection?.antiTemplateDiagnosis ? 'antiTemplateDiagnosis' : '',
    input.artDirection?.motionSystem ? 'motionSystem' : '',
    input.artDirection?.accessibilityDirection ? 'accessibilityDirection' : '',
    input.artDirection?.responsiveDirection ? 'responsiveDirection' : '',
  ].filter(Boolean);
  const usedStrategyInputs = [
    input.strategy?.ctaHierarchy ? 'ctaHierarchy' : '',
    present(input.strategy?.contentHierarchy) ? 'contentHierarchy' : '',
  ].filter(Boolean);
  const usedBlueprintInputs = [
    present(input.blueprint?.sections) ? 'sections' : '',
    input.blueprint?.architecture ? 'architecture' : '',
  ].filter(Boolean);
  const usedComponentInputs = [
    present(input.componentEngineer?.componentPlan) ? 'componentPlan' : '',
    present(input.componentEngineer?.fileManifest) ? 'fileManifest' : '',
  ].filter(Boolean);

  return {
    status, checklist, findings, passed, risks, fixInstructions, futureFixerScope,
    usedResearchInputs, usedArtDirectionInputs, usedStrategyInputs, usedBlueprintInputs, usedComponentInputs,
    summary,
  };
}

/**
 * Run the Reviewer Agent. Fully guarded: on any error it fails OPEN — a reviewer
 * row with status 'failed' + a safe 'failed-open' artifact — and the build
 * continues. Never required for Preview / All Files.
 */
export function runReviewer(input: ReviewerInput): { agent: WebBuildAgent; artifact: ReviewerAgentArtifact } {
  const lang = input.lang || 'en';
  const name = L(lang, 'Reviewer Agent', 'Gözden Geçirme Ajanı');
  const activity = L(lang, 'Reviewing concept fit, fake-data risk, CTA readiness', 'Konsept uyumu, sahte veri riski ve CTA hazırlığı inceleniyor');
  try {
    const artifact = deriveReviewerAgent(input);
    return { agent: { id: 'reviewer', name, status: 'done', summary: artifact.summary, currentActivity: activity, artifact }, artifact };
  } catch {
    const artifact = failedOpenReviewer(lang);
    return { agent: { id: 'reviewer', name, status: 'failed', summary: artifact.summary, currentActivity: activity, artifact }, artifact };
  }
}

/* ── Public-label hygiene (Phase 7A) — shared by the Quality Director (detect)
 *  and the Fixer (repair). SAFE, display-only transforms: strip parentheticals,
 *  drop an unsupported "metrics" claim, collapse "demo/screens", shorten an
 *  over-long nav/pill label to its first clause. Never invents content. */
const AWKWARD_LABEL_RE = /\([^)]*\)|demo\s*\/\s*screens?|metrics?\s+and\s+security|screens?\s*\/\s*demo/i;
const MAX_LABEL_LEN = 28;

/* ── Palette/anti-template helpers (Phase 7B) — shared by the Quality Director
 *  (detect) and the Fixer (repair). Pure, no side effects. */
/** Rough relative luminance of a #rrggbb color (0 dark … 1 light). */
function hexLuma(hex?: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
/** True when the background reads as a light surface (relieves eye-strain). */
function isLightBg(hex?: string): boolean { return hexLuma(hex) >= 0.6; }
/** True when an accent reads as gold/amber/warm-yellow (the AI-sameness accent). */
function isGoldish(hex?: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return /gold|amber|yellow/i.test(hex || '');
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return r > 170 && g > 120 && b < 120 && r >= g;
}

/** True when a public label reads raw / model-internal / too long. */
function isAwkwardLabel(s?: string, maxLen = MAX_LABEL_LEN): boolean {
  const t = (s || '').trim();
  if (!t) return false;
  return AWKWARD_LABEL_RE.test(t) || t.length > maxLen || /\bproduct\s*proof\b/i.test(t);
}

/** Clean a public-facing label/CTA to a short, human form. Display-only. */
function cleanPublicLabel(raw?: string, maxLen = MAX_LABEL_LEN): string {
  let s = (raw || '').trim();
  if (!s) return s;
  s = s.replace(/\s*\([^)]*\)/g, ' ');                     // drop parentheticals
  s = s.replace(/\bdemo\s*\/\s*screens?\b/gi, 'demo').replace(/\bscreens?\s*\/\s*demo\b/gi, 'demo');
  s = s.replace(/\bmetrics?\s+and\s+security\b/gi, 'Security'); // drop unsupported "metrics"
  s = s.replace(/\s{2,}/g, ' ').replace(/\s*[,;:–—-]\s*$/, '').trim();
  // A list-y or over-long label collapses to its first clause (nav/pill hygiene).
  if (s.length > maxLen || /,/.test(s)) {
    const head = s.split(/\s*[,–—]\s*|\s\/\s/)[0].trim();
    if (head && head.length >= 3) s = head;
  }
  if (s.length > maxLen) s = s.slice(0, maxLen).replace(/\s*[,;:–—-]$/, '').trim();
  return s || (raw || '').trim();
}

/* ── Quality Director (Phase 7A) — premium-quality judge ────────────────────
 * Scores the finished build across premium dimensions from REAL artifacts only
 * and records honest issues + safe rewrite guidance. Advisory: never blocks the
 * build, always fails OPEN. */
export interface QualityDirectorInput {
  prompt: string;
  brief: WebBuildBrief;
  sectionItems: Array<{ id: string; name: string; headline?: string; cta?: string; sub?: string; bullets?: string[] }>;
  strategy?: StrategyAgentArtifact;
  artDirection?: ArtDirectionArtifact;
  reviewer?: ReviewerAgentArtifact;
  research?: ResearchAgentArtifact;
  layoutPlan?: WebBuildLayoutPlan;
  /** The strategic decision to judge against (Phase 8A). */
  ledger?: StrategicThinkingLedger;
  lang?: Lang;
}

function failedOpenQualityDirector(lang: Lang): QualityDirectorArtifact {
  return {
    status: 'failed-open',
    score: 0,
    dimensions: { copyClarity: 0, ctaConsistency: 0, flowCoherence: 0, visualPremiumFit: 0, conceptSpecificity: 0, demoUsefulness: 0, honesty: 0 },
    issues: [],
    approvedPrinciples: [],
    rewriteInstructions: [],
    summary: L(lang, 'Quality Director failed open; build continued without blocking Preview or All Files.',
      'Kalite Direktörü güvenli şekilde durdu; yapı Önizleme veya Tüm Dosyaları engellemeden devam etti.'),
  };
}

/* ── Public-copy quality guard (Phase 9C-1) — shared by the Quality Director
 *  (detect) and the Fixer (repair). Deterministic, cheap, honest. Internal
 *  planning/category language and generic SaaS filler must never surface as
 *  visible website copy; unsupported proof language is flagged, never invented. */

/** Internal category / planning language that must NEVER appear as public copy. */
const INTERNAL_COPY_RE = /\bai\s*product\s*\/\s*saas\b|\bai\s*tool\s*\/\s*productivity\b|\bproduct\s*proof\b|\bdemo\s*\/\s*screens?\b|\bmetrics?\s+and\s+security\b|\bconcept\s*authority\b|\bvisual\s*direction\b|\bplanning\s*contract\b|\bwebsite\s*experience\s*model\b|\bdesign\s*thinking\s*plan\b/i;
/** Generic SaaS hero formulas. */
const HERO_FORMULA_RE = /\btransform\s+your\b.*\bwith\b.*\bai\b|\brevolutioni[sz]e\s+your\b|\bunlock\s+the\s+power\s+of\b|\ball[-\s]?in[-\s]?one\s+solution\b|\bnext[-\s]?generation\s+platform\b/i;
/** Unsupported / fake proof language (never invented; flagged only). */
const FAKE_PROOF_RE = /\btrusted\s+by\s+(thousands|millions|\d)|\bsoc\s?2\b|\biso\s?\d{3,}\b|\b\d[\d.,]*\+?\s*(customers|clients|users|companies|stores|brands)\b|\b\d+\s?%\s*(uptime|satisfaction)\b|\baward[-\s]?winning\b|\bindustry[-\s]?leading\b/i;
/** Generic public labels used as a WHOLE section name / CTA (lowercased). */
const GENERIC_PUBLIC_LABELS = new Set(['discovery', 'plan', 'delivery', 'support', 'how it works', 'features', 'benefits', 'overview', 'product demo', 'get started', 'learn more', 'explore features', 'experience the chatbot']);

export type PublicCopySmellKind = 'internal-category' | 'generic-label' | 'hero-formula' | 'fake-proof';
export interface PublicCopySmell { sectionId?: string; field: string; text: string; kind: PublicCopySmellKind }

/** Normalize a display string for whole-label matching. */
const normLabel = (s?: string): string => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Detect public-facing copy smells across section DISPLAY fields (name / headline /
 * sub / cta / bullets). Pure + cheap; used by the Quality Director to flag and by
 * the Fixer to know what to repair. Never mutates, never fabricates.
 */
export function detectPublicCopySmells(
  items: Array<{ id?: string; name?: string; headline?: string; sub?: string; cta?: string; bullets?: string[] }>,
): PublicCopySmell[] {
  const out: PublicCopySmell[] = [];
  const push = (sectionId: string | undefined, field: string, text: string, kind: PublicCopySmellKind) => {
    const t = (text || '').trim();
    if (t) out.push({ sectionId, field, text: t, kind });
  };
  for (const s of items || []) {
    const fields: Array<[string, string | undefined]> = [['name', s.name], ['headline', s.headline], ['sub', s.sub], ['cta', s.cta]];
    for (const [field, val] of fields) {
      const v = (val || '').trim();
      if (!v) continue;
      if (INTERNAL_COPY_RE.test(v)) push(s.id, field, v, 'internal-category');
      else if ((field === 'name' || field === 'cta') && GENERIC_PUBLIC_LABELS.has(normLabel(v))) push(s.id, field, v, 'generic-label');
      if ((field === 'name' || field === 'headline' || field === 'sub') && HERO_FORMULA_RE.test(v)) push(s.id, field, v, 'hero-formula');
      if (FAKE_PROOF_RE.test(v)) push(s.id, field, v, 'fake-proof');
    }
    for (const b of s.bullets || []) {
      const v = (b || '').trim();
      if (!v) continue;
      if (INTERNAL_COPY_RE.test(v)) push(s.id, 'bullet', v, 'internal-category');
      else if (GENERIC_PUBLIC_LABELS.has(normLabel(v))) push(s.id, 'bullet', v, 'generic-label');
      if (FAKE_PROOF_RE.test(v)) push(s.id, 'bullet', v, 'fake-proof');
    }
  }
  return out;
}

/* ── Generic content-depth guard (Phase 9C-2) — deeper than 9C-1: catches generic
 *  business-template FILLER, generic demo copy, and unsupported proof/credibility
 *  placeholders that still read like any-SaaS boilerplate even after the obvious
 *  internal labels are cleaned. Shared by the Quality Director (detect) and the
 *  Fixer (repair). Deterministic, cheap, honest — never invents proof. */

/** Generic filler used as a WHOLE section name / CTA / bullet (normalized). Phase
 *  9C-2 — uniquely named to avoid colliding with the Phase 8A GENERIC_FILLER_LABELS
 *  array (a different concept). */
const GENERIC_CONTENT_DEPTH_FILLER = new Set([
  'fast & reliable', 'fast and reliable', 'made for your goals', 'simple to start',
  'premium quality', 'built for everyone', 'everything you need', 'all-in-one', 'all in one',
  'seamless experience', 'powerful features', 'process', 'case studies', 'testimonials',
  'certifications', 'reference clients', 'certifications, specs and reference clients',
]);
/** Generic filler phrases that appear WITHIN a longer headline / sub / bullet. */
const GENERIC_FILLER_CONTAINED_RE = /\b(streamline your workflow|scale with confidence|unlock the power(?:\s+of)?|everything you need|seamless experience|all[-\s]?in[-\s]?one|powerful features|premium quality|cutting[-\s]?edge|state[-\s]?of[-\s]?the[-\s]?art|best[-\s]?in[-\s]?class|world[-\s]?class)\b/i;
/** Deep generic hero formulas 9C-1's HERO_FORMULA_RE does not catch. */
const DEEP_HERO_RE = /\bexperience the future\b|\bthe future of\b|\breimagine\b|\bempower(?:ing)?\s+your\b|\bsupercharge\b|\btake\s+your\b.*\bto the next level\b/i;
/** Generic demo copy (says "interactive demo" instead of what the demo does). */
const GENERIC_DEMO_RE = /\binteractive demos?\b|\breal[-\s]?world applications?\b|\bsee it in action\b|\blive demo\b|\bproduct in action\b/i;
/** Unsupported proof / credibility placeholders (never invented). */
const UNSUPPORTED_PROOF_RE = /\bcertifications?\b|\breference clients?\b|\btrusted by\b|\bcase stud(?:y|ies)\b|\btestimonials?\b|\bsoc\s?2\b|\biso\s?\d{3,}\b|\b99\.9\s?%|\b\d+\s?%\s*(?:uptime|satisfaction)\b/i;

export type GenericContentSmellKind = 'generic-filler' | 'generic-demo' | 'hero-formula' | 'unsupported-proof';
export interface GenericContentSmell { sectionId?: string; field: string; text: string; kind: GenericContentSmellKind }

/**
 * Detect generic business-template content-depth smells across section DISPLAY
 * fields (name / headline / sub / cta / bullets). Pure + cheap; the Quality
 * Director flags, the Fixer repairs. Never mutates, never fabricates proof.
 */
export function detectGenericContentDepthSmells(
  items: Array<{ id?: string; name?: string; headline?: string; sub?: string; cta?: string; bullets?: string[] }>,
): GenericContentSmell[] {
  const out: GenericContentSmell[] = [];
  const push = (sectionId: string | undefined, field: string, text: string, kind: GenericContentSmellKind) => {
    const t = (text || '').trim();
    if (t) out.push({ sectionId, field, text: t, kind });
  };
  const scan = (sectionId: string | undefined, field: string, v0?: string) => {
    const v = (v0 || '').trim();
    if (!v) return;
    if (GENERIC_CONTENT_DEPTH_FILLER.has(normLabel(v)) || GENERIC_FILLER_CONTAINED_RE.test(v)) push(sectionId, field, v, 'generic-filler');
    if (DEEP_HERO_RE.test(v)) push(sectionId, field, v, 'hero-formula');
    if (GENERIC_DEMO_RE.test(v)) push(sectionId, field, v, 'generic-demo');
    if (UNSUPPORTED_PROOF_RE.test(v)) push(sectionId, field, v, 'unsupported-proof');
  };
  for (const s of items || []) {
    scan(s.id, 'name', s.name);
    scan(s.id, 'headline', s.headline);
    scan(s.id, 'sub', s.sub);
    scan(s.id, 'cta', s.cta);
    for (const b of s.bullets || []) scan(s.id, 'bullet', b);
  }
  return out;
}

/**
 * Final DISPLAY-ONLY demo-surface copy guard (Phase 9C-3). Deterministic + honest:
 * rewrites the generic demo/marketing phrases that still leak into rendered demo
 * surfaces (hero/demo headline, sub, CTA, highlight bullets, nav/process labels)
 * into concept-specific copy for AI-chatbot/ecommerce, and neutralizes unsupported
 * proof. Never fabricates metrics/logos/testimonials. Returns the input UNCHANGED
 * for non-AI-commerce concepts or when nothing matches. Used by the Fixer on the
 * section items every demo surface consumes (teaser, demo screen, hero, nav).
 */
export function sanitizeDemoSurfaceCopy(text: string | undefined, opts: { aiCommerce: boolean; lang?: Lang }): string {
  const v = text || '';
  const t = v.trim();
  if (!t || !opts.aiCommerce) return v;
  const lang = opts.lang || 'en';
  const key = t.toLowerCase().replace(/\s+/g, ' ');
  // Whole-label rewrites (name / cta / bullet).
  const WHOLE: Record<string, string> = {
    'process': L(lang, 'Shopper Flow', 'Alışverişçi Akışı'),
    'discovery': L(lang, 'Understands the Question', 'Soruyu Anlar'),
    'plan': L(lang, 'Finds the Right Product', 'Doğru Ürünü Bulur'),
    'delivery': L(lang, 'Guides the Next Step', 'Sonraki Adıma Yönlendirir'),
    'support': L(lang, 'Hands Off to Your Team', 'Ekibinize Devreder'),
    'case studies': L(lang, 'Use Cases', 'Kullanım Senaryoları'),
    'testimonials': L(lang, 'Customer Questions', 'Müşteri Soruları'),
    'certifications': L(lang, 'Security & Store Trust', 'Güvenlik ve Mağaza Güveni'),
    'reference clients': L(lang, 'Security & Store Trust', 'Güvenlik ve Mağaza Güveni'),
    'certifications, specs and reference clients': L(lang, 'Security & Store Trust', 'Güvenlik ve Mağaza Güveni'),
    'product demo': L(lang, 'Sample Chat Flow', 'Örnek Sohbet Akışı'),
    'interactive demo': L(lang, 'Sample Chat Flow', 'Örnek Sohbet Akışı'),
    'experience the demo': L(lang, 'Try the Demo', 'Demoyu Dene'),
    'experience the chatbot': L(lang, 'Try the Demo', 'Demoyu Dene'),
    'get started': L(lang, 'Try the Demo', 'Demoyu Dene'),
    'learn more': L(lang, 'See Chat Flow', 'Sohbet Akışını Gör'),
    'explore features': L(lang, 'See Chat Flow', 'Sohbet Akışını Gör'),
    'fast & reliable': L(lang, 'Answers common product and policy questions with sample storefront knowledge', 'Yaygın ürün ve politika sorularını örnek mağaza bilgisiyle yanıtlar'),
    'fast and reliable': L(lang, 'Answers common product and policy questions with sample storefront knowledge', 'Yaygın ürün ve politika sorularını örnek mağaza bilgisiyle yanıtlar'),
    'made for your goals': L(lang, 'Guides shoppers from question to recommendation without leaving the page', 'Alışverişçileri sayfadan ayrılmadan sorudan öneriye yönlendirir'),
    'simple to start': L(lang, 'Shows catalog, policy and support flows as a front-end demo', 'Katalog, politika ve destek akışlarını ön-yüz demosu olarak gösterir'),
    'premium quality': L(lang, 'Keeps the experience calm, branded and conversion-focused', 'Deneyimi sakin, markalı ve dönüşüm odaklı tutar'),
    'responsive support': L(lang, 'Hands complex requests to your support team', 'Karmaşık talepleri destek ekibinize devreder'),
    'clear pricing': L(lang, 'Shows plans and what each includes', 'Planları ve her birinin içeriğini gösterir'),
  };
  if (WHOLE[key]) return WHOLE[key];
  // Generic demo HEADLINE ("Experience Seamless Integration with Our Interactive Demo").
  if (/experience\s+seamless\s+integration|our\s+interactive\s+demo|seamless\s+integration\b.*\bdemo\b|experience\s+seamless\b/i.test(t))
    return L(lang, 'Preview a storefront chat flow from question to handoff', 'Sorudan devire bir mağaza sohbet akışını önizleyin');
  // Generic demo SUB ("Explore features and integrations in real-time…").
  if (/explore\s+features.*(real[-\s]?time|integrations)|features\s+and\s+integrations\s+in\s+real[-\s]?time|interactive demos?\s+that\s+showcase|explore\b.*\bin\s+real[-\s]?time/i.test(t))
    return L(lang, 'See a sample shopper ask about a product, get a recommendation, check policy details and escalate to a human.', 'Örnek bir alışverişçinin ürün sorduğu, öneri aldığı, politika detaylarını kontrol ettiği ve bir insana yönlendirildiği akışı görün.');
  return v;
}

/* ── Non-SaaS proof / local-business copy leaks (Phase 9D-2B) ─────────────────
 * SaaS/product-proof language ("Product proof (demo/screens), metrics and
 * security", "Certifications, specs and reference clients", SOC2/ISO, "trusted by
 * thousands", dashboard preview, SaaS pricing/integrations/product-demo) that
 * leaks into a NON-SaaS site type (landscaping/restaurant/portfolio/agency/…).
 * Pure regexes over the DISPLAY copy — no fabrication, no side effects. */
export const NON_SAAS_LEAK_RE: Array<{ re: RegExp; kind: string }> = [
  { re: /product\s*proof\s*\(\s*demo\s*\/\s*screens?\s*\)\s*,?\s*metrics?\s+and\s+security/i, kind: 'product-proof' },
  { re: /\bproduct\s*proof\b/i, kind: 'product-proof' },
  { re: /certifications?\s*,?\s*specs?\s+and\s+reference\s+clients?/i, kind: 'certifications' },
  { re: /\breference\s+clients?\b/i, kind: 'reference-clients' },
  { re: /\bsoc\s?-?\s?2\b|\biso\s?\d{3,}\b|\bcompliance\b|\bcertified\b|\baccreditat/i, kind: 'compliance' },
  { re: /\btrusted\s+by\s+(thousands|millions|\d)/i, kind: 'fake-metrics' },
  { re: /\bmetrics?\s+and\s+security\b/i, kind: 'metrics-security' },
  { re: /\bdashboard\s+preview\b/i, kind: 'dashboard-preview' },
  { re: /\bproduct\s+demo\b|demo\s*\/\s*screens?/i, kind: 'product-demo' },
  { re: /\bcase\s*stud(y|ies)\b/i, kind: 'case-studies' },
  { re: /\btestimonials?\b/i, kind: 'testimonials' },
];

export interface NonSaaSLeak { sectionId: string; field: 'name' | 'headline' | 'sub' | 'cta' | 'bullet'; text: string; kind: string }

/**
 * Detect SaaS/product-proof copy that leaked into a non-SaaS site. Scans the
 * DISPLAY fields only. `providedProof` (user/source actually supplied testimonials
 * or case studies) suppresses the proof flags so real proof is never stripped.
 */
export function detectNonSaaSProofLeaks(
  sectionItems: Array<{ id: string; name?: string; headline?: string; sub?: string; cta?: string; bullets?: string[] }>,
  opts: { providedProof?: boolean } = {},
): NonSaaSLeak[] {
  const leaks: NonSaaSLeak[] = [];
  const softProof = new Set(['testimonials', 'case-studies', 'reference-clients']);
  const scan = (id: string, field: NonSaaSLeak['field'], text?: string) => {
    const v = (text || '').trim();
    if (!v) return;
    for (const { re, kind } of NON_SAAS_LEAK_RE) {
      if (opts.providedProof && softProof.has(kind)) continue; // real proof — keep
      if (re.test(v)) { leaks.push({ sectionId: id, field, text: v, kind }); break; }
    }
  };
  for (const s of sectionItems || []) {
    scan(s.id, 'name', s.name);
    scan(s.id, 'headline', s.headline);
    scan(s.id, 'sub', s.sub);
    scan(s.id, 'cta', s.cta);
    (s.bullets || []).forEach((b) => scan(s.id, 'bullet', b));
  }
  return leaks;
}

/** Strip wrapping quotation marks from a hero-style title (Phase 9D-2B). Only when
 *  the WHOLE value is quoted; never touches quotes inside a sentence. Returns the
 *  input unchanged when it isn't fully wrapped. */
export function stripWrappingQuotes(text: string | undefined): string {
  const v = (text || '');
  const t = v.trim();
  // Matches "...", “...”, '...', «...», „...“ wrapping the entire string with no
  // interior closing quote of the same kind.
  const m = t.match(/^(["'“”«»„])([\s\S]+)(["'“”«»„])$/);
  if (!m) return v;
  const inner = m[2].trim();
  // Guard: don't unwrap if the inner text itself contains a matching quote pair
  // (that would be a real interior quotation, not a wrapper).
  if (/["“”«»„]/.test(inner)) return v;
  return inner || v;
}

/**
 * Derive the Quality Director artifact from the real, available artifacts only.
 * Pure and deterministic; never fabricates facts, never blocks the build.
 */
export function deriveQualityDirector(input: QualityDirectorInput): QualityDirectorArtifact {
  const lang = input.lang || 'en';
  const issues: QualityIssue[] = [];
  let iid = 0;
  const add = (severity: ReviewSeverity, category: QualityIssueCategory, evidence: string, recommendation: string, target?: string) => {
    issues.push({ id: `qd-${iid += 1}`, severity, category, target, evidence, recommendation });
  };

  const ic = input.strategy?.interactionContract;
  const authority = input.research?.conceptAuthority;
  const primaryConcept = (authority?.primaryConcept || '').toLowerCase();
  const isAiSaas = primaryConcept === 'ai' || primaryConcept === 'saas'
    || /\bai\b|assistant|chatbot|\bsaas\b/.test(`${(ic?.conceptCategory || '')} ${input.prompt}`.toLowerCase())
    || (ic?.requiredStatefulComponents || []).some((c) => /chat|product-?demo|assistant/i.test(c));
  const sections = (input.sectionItems || []).filter((s) => !/hero|footer/i.test(s.id));

  /* 1 — Copy/label clarity: raw / model-internal / over-long public labels. */
  const rawLabels: string[] = [];
  for (const s of sections) {
    if (isAwkwardLabel(s.name)) { rawLabels.push(s.name); add('warning', 'raw-label', `Section label reads raw/model-internal: "${s.name}".`, `Rewrite as a short, human label (e.g. "${cleanPublicLabel(s.name)}").`, s.id); }
    if (s.cta && isAwkwardLabel(s.cta)) add('info', 'raw-label', `CTA label is awkward/long: "${s.cta}".`, `Shorten to a clean action (e.g. "${cleanPublicLabel(s.cta)}").`, s.id);
  }
  // Repeated "Product demo" style labels across sections read as scaffolding.
  const demoNamed = sections.filter((s) => /^product\s*demo$/i.test((s.name || '').trim()));
  if (demoNamed.length > 1) add('warning', 'generic-copy', `"${demoNamed.length}× "Product demo" section labels — repetitive/generic.`, 'Differentiate repeated demo labels (Chat experience / How it works / Use cases / Integrations / Security / Pricing).', 'sectionItems');

  /* 2 — CTA consistency: one clear primary, matching the conversion intent. */
  const intent = (ic?.primaryConversionIntent || '').toLowerCase();
  const hasConsistencyRule = !!ic?.ctaConsistencyRule;
  if (ic && !hasConsistencyRule) add('info', 'cta-inconsistency', 'No CTA consistency rule on the contract — primary vs secondary CTA labels may drift.', 'Set one primary CTA and keep secondary CTAs supporting (See how it works / See pricing / View security).', 'strategy.interactionContract');
  // Conflicting "book demo" + "free trial" signals unless one is clearly secondary.
  const ctaHay = `${intent} ${ic?.primaryEntryCTA || ''} ${sections.map((s) => s.cta || '').join(' ')}`.toLowerCase();
  if (/book\s*(a\s*)?demo/.test(ctaHay) && /free\s*trial|get\s*started\s*free|try\s*it\s*free/.test(ctaHay)) {
    add('warning', 'cta-inconsistency', 'Both "book a demo" and "free trial" CTAs present — competing primary conversions.', 'Pick ONE primary conversion (book demo OR free trial) and demote the other to a secondary CTA.', 'strategy.interactionContract');
  }

  /* 3 — Flow coherence (AI/SaaS): landing → (lead gate) → demo/chat. */
  const leadRequired = ic?.leadCaptureRequired === true;
  const hasDemoScreenToken = /chat|product-demo/.test(`${ic?.postEntryScreenId || ''} ${ic?.afterLeadCaptureScreenId || ''}`);
  if (isAiSaas) {
    if (leadRequired && !ic?.afterLeadCaptureScreenId && !ic?.postEntryScreenId) {
      add('warning', 'flow-confusion', 'Lead capture is required but no post-lead demo/experience is resolvable — the gate leads nowhere.', 'Ensure a Product Demo / Chat Experience screen exists for the lead gate to open into.', 'strategy.interactionContract.afterLeadCaptureScreenId');
    }
    if (!hasDemoScreenToken && !(ic?.requiredStatefulComponents || []).some((c) => /chat|product-?demo/i.test(c))) {
      add('warning', 'demo-unclear', 'AI/SaaS product with no clear chat/product-demo entry.', 'Declare a chat/product-demo surface so the primary CTA opens a clear demo experience.', 'strategy.interactionContract');
    }
  }
  // Too many top-level suggested screens read as an admin panel (nav discipline).
  if ((ic?.suggestedScreens?.length || 0) > 6) add('info', 'flow-confusion', `${ic!.suggestedScreens!.length} suggested screens — nav may feel like an admin panel.`, 'Keep one clear experience + a few marketing screens; overflow the rest.', 'strategy.interactionContract.suggestedScreens');

  /* 4 — Concept specificity: hero + copy reflect the actual concept/vertical. */
  const heroSec = (input.sectionItems || []).find((s) => /hero/i.test(s.id));
  const heroText = `${heroSec?.name || ''} ${heroSec?.sub || ''} ${input.brief.coreIdea || ''}`.toLowerCase();
  const conceptWords = `${primaryConcept} ${(input.brief.type || '')} ${(authority?.targetVertical || '')}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  const heroMentionsConcept = conceptWords.some((w) => heroText.includes(w));
  if (authority && !heroMentionsConcept && heroText.trim().length > 0) {
    add('warning', 'weak-hero', 'Hero copy does not clearly name the product concept or target vertical.', 'Reference the actual concept/vertical in the hero so the copy is not generic-SaaS.', heroSec?.id || 'hero');
  }
  if (input.reviewer?.findings?.some((f) => f.category === 'concept-drift')) {
    add('warning', 'concept-drift', 'Reviewer flagged concept drift (visual/archetype ≠ primary concept).', 'Re-assert the primary-concept archetype; the target vertical only informs copy/proof.', 'artDirection.designArchetype');
  }

  /* 4b — Generic service-agency filler (Phase 8A). The Thinking Ledger names the
   *      labels that read as template scaffolding for THIS concept; flag any
   *      section using one so the Fixer repairs it to a concept-specific label. */
  const ledger = input.ledger;
  if (ledger && ledger.forbiddenGenericLabels.length) {
    const forbidden = new Set(ledger.forbiddenGenericLabels.map((x) => x.toLowerCase()));
    const suggest = ledger.preferredSectionLabels.slice(0, 3).join(' / ')
      || 'Chat experience / Integrations / Security';
    for (const s of sections) {
      const nm = (s.name || '').trim().toLowerCase();
      if (nm && forbidden.has(nm)) {
        add('warning', 'generic-copy', `Section label "${s.name}" is generic service-agency filler for a "${ledger.primaryConcept}" product.`, `Rename to a concept-specific label (e.g. ${suggest}).`, s.id);
      }
    }
    // The site must not become an identity the ledger forbade (e.g. a dashboard
    // when the product is an AI chatbot). Inline check over the real labels.
    const labelHay = sections.map((s) => (s.name || '').toLowerCase()).join(' ');
    if (isAiSaas && ledger.mustNotBecome.some((m) => /dashboard/i.test(m)) && /\bdashboard\b|analytics\s*panel|\bkpi\b/.test(labelHay)) {
      add('warning', 'dashboard-overuse', 'Build leans on a dashboard identity the strategic ledger explicitly forbade for this AI product.', 'Return to a focused product/chat demo surface, not an analytics dashboard.', 'artDirection.heroTreatment');
    }
  }

  /* 4c — Public-copy smells (Phase 9C-1): internal category/planning language and
   *      generic SaaS filler must NOT surface as visible website copy. Advisory —
   *      the Fixer applies the safe display-only repairs. */
  const copySmells = detectPublicCopySmells(input.sectionItems || []);
  if (copySmells.length) {
    // Phase 12F — suggest the ledger's CONCEPT-NATIVE labels (product-intent-resolved),
    // never a hardcoded chat/store label set for every AI/SaaS product.
    const conceptSuggest = (ledger?.preferredSectionLabels || []).slice(0, 6).join(' / ') || 'concept-specific public labels';
    const byKind = (k: PublicCopySmellKind) => copySmells.filter((c) => c.kind === k);
    const internal = byKind('internal-category');
    const generic = byKind('generic-label');
    const formula = byKind('hero-formula');
    const fake = byKind('fake-proof');
    if (internal.length) add('warning', 'public-copy-smell', `Internal/planning language shown as public copy: ${uniq(internal.map((c) => `"${c.text}"`)).slice(0, 3).join(', ')}.`, `Replace with concept-specific public labels (${conceptSuggest}).`, internal[0].sectionId || 'sectionItems');
    if (generic.length) add('warning', 'public-copy-smell', `Generic SaaS labels used as public copy: ${uniq(generic.map((c) => c.text)).slice(0, 4).join(', ')}.`, `Rename to concept-specific labels (${conceptSuggest}).`, generic[0].sectionId || 'sectionItems');
    if (formula.length) add('warning', 'public-copy-smell', `Hero reads as a generic SaaS formula: "${formula[0].text}".`, 'Rewrite the hero as specific, natural copy about what the product does for the visitor (no "transform/revolutionize/unlock the power of").', formula[0].sectionId || 'hero');
    if (fake.length) add('warning', 'honesty-risk', `Unsupported proof language in public copy: "${fake[0].text}".`, 'Remove fabricated metrics/logos/testimonials/compliance; keep honest structural proof only.', fake[0].sectionId || 'sectionItems');
  }

  /* 4d — Generic content-depth smells (Phase 9C-2): copy that reads like any-SaaS
   *      boilerplate — generic benefits/CTAs, generic demo copy, "future/AI" hero
   *      formulas, and unsupported proof placeholders. Advisory; the Fixer repairs. */
  const depthSmells = detectGenericContentDepthSmells(input.sectionItems || []);
  if (depthSmells.length) {
    const jobs = isAiSaas
      ? 'concrete jobs-to-be-done: shopper asks a product question → assistant understands intent → suggests a relevant product → answers shipping/returns/policy from sample knowledge → routes hard cases to human support (store integrations are front-end-only; trust stays honest, no fabricated proof)'
      : 'concrete, concept-specific jobs-to-be-done (what the visitor actually does), not generic benefits';
    const dKind = (k: GenericContentSmellKind) => depthSmells.filter((d) => d.kind === k);
    const filler = dKind('generic-filler');
    const hero = dKind('hero-formula');
    const demo = dKind('generic-demo');
    const proof = dKind('unsupported-proof');
    if (filler.length) add('warning', 'generic-content-depth', `Generic business-template filler in public copy: ${uniq(filler.map((d) => `"${d.text}"`)).slice(0, 3).join(', ')}.`, `Rewrite as ${jobs}.`, filler[0].sectionId || 'sectionItems');
    if (hero.length) add('warning', 'generic-content-depth', `Hero uses a generic "future/AI" formula: "${hero[0].text}".`, 'Say what the product does for the visitor in one concrete sentence, not "experience the future".', hero[0].sectionId || 'hero');
    if (demo.length) add('warning', 'generic-content-depth', `Demo copy is generic ("interactive demo / real-world applications"): "${demo[0].text}".`, 'Describe the ACTUAL sample flow the demo shows (e.g. product question → recommendation → policy answer → human handoff).', demo[0].sectionId || 'sectionItems');
    if (proof.length) add('warning', 'honesty-risk', `Unsupported proof/credibility copy: ${uniq(proof.map((d) => `"${d.text}"`)).slice(0, 3).join(', ')}.`, 'Neutralize to honest structural trust (e.g. "Security & Store Trust") unless the user/source actually provided real certifications/clients/metrics.', proof[0].sectionId || 'sectionItems');
  }

  /* 5 — Honesty: no fabricated proof/metrics. */
  const fakeFinding = input.reviewer?.findings?.find((f) => f.category === 'fake-data');
  if (fakeFinding) add(fakeFinding.severity, 'honesty-risk', `Reviewer flagged possible fabricated proof: ${fakeFinding.evidence}`, 'Remove unsupported ratings/prices/compliance/metrics; keep honest structural labels only.', 'files');

  /* 6 — Visual density (Phase 6E is applied, but flag if art direction is thin). */
  const weakVisual = !!input.artDirection && !(input.artDirection.premiumDetails || []).length
    && !(input.artDirection.visualDifferentiators || []).length;
  if (weakVisual) add('info', 'visual-density', 'Art direction has no premium detail / differentiator signals.', 'Add premium surface/accent/differentiator rules so the build reads premium, not a UI kit.', 'artDirection');

  /* 7 — Anti-template visual checks (Phase 7B). Penalize the default dark/gold/
   *     dashboard sameness, accent overuse, palette-vs-vertical mismatch and weak
   *     visual exploration. Reads REAL art-direction artifacts only. */
  const ad = input.artDirection;
  const explo = ad?.visualExploration;
  const selCand = explo?.candidates.find((c) => c.id === explo.selectedCandidateId);
  const safeCand = explo?.candidates.find((c) => c.id === 'safe');
  const fam = (ad?.paletteFamily || selCand?.paletteFamily || '').toLowerCase();
  const bg = ad?.colorSystem?.background || '';
  const accent = ad?.colorSystem?.accent || '';
  const bgLight = isLightBg(bg);
  const goldAccent = isGoldish(accent);
  const promptLc = (input.prompt || '').toLowerCase();
  const forbidsFakeProof = /no\s+(fake\s+)?(metric|logo|testimonial|social\s*proof)|without\s+(metric|logo|testimonial)|don'?t\s+(add|invent|use|include)\s+(metric|logo|testimonial|fake)|sahte\s+(metrik|logo|referans|veri)|metrik\s+yok|logo\s+yok|uydurma\s+(metrik|logo|referans)/.test(promptLc);
  const dashHay = `${selCand?.mockupStrategy || ''} ${selCand?.heroComposition || ''} ${ad?.imageryDirection || ''} ${ad?.heroDirection || ''}`.toLowerCase();
  const sectionNames = (input.sectionItems || []).map((s) => (s.name || '').toLowerCase()).join(' ');
  const hasDashboardLang = /dashboard|chart|graph|analytics|\bkpi\b|by the numbers/.test(`${dashHay} ${sectionNames} ${promptLc}`);

  if (!explo || (explo.candidates || []).length < 3) {
    add('warning', 'weak-visual-exploration', 'Visual exploration produced fewer than 3 candidates (or none).', 'Explore 3 directions (safe / premium / unexpected) and select one with a reason.', 'artDirection.visualExploration');
  }
  if (explo && selCand?.paletteFamily && safeCand?.paletteFamily && selCand.paletteFamily === safeCand.paletteFamily) {
    add('warning', 'same-template-risk', 'Selected visual direction is effectively the conventional/safe default.', 'Move to a differentiated candidate unless the conventional look is clearly justified.', 'artDirection.visualExploration');
  }
  if (isAiSaas && !bgLight && goldAccent && hasDashboardLang) {
    const justified = !!(explo?.selectionReason && /light|differentiat|not the conventional|non-generic|restrained/i.test(explo.selectionReason));
    add(justified ? 'info' : 'warning', 'same-template-risk', 'AI/SaaS build uses the default dark + gold + dashboard look.', 'Vary the palette (cooler/lighter), demote gold, and make the hero concept-specific — or justify the default.', 'artDirection.colorSystem');
  }
  if (isAiSaas && goldAccent) {
    add('info', 'accent-overuse', 'Gold/amber accent on an AI/SaaS build reads as the same template and can strain the eyes.', 'Prefer a restrained cool accent; reserve warm gold for hospitality/heritage concepts.', 'artDirection.colorSystem.accent');
  }
  // Phase 9A: the model's OWN Design Thinking Plan is authoritative — flag when the
  // rendered result still matches a direction the model explicitly REJECTED, and
  // surface a weak/generic plan so the plan itself can be strengthened next time.
  const mdp = ledger?.modelDesignPlan;
  if (mdp) {
    if (mdp.avoidGold && goldAccent) {
      add('warning', 'same-template-risk', 'The model design plan rejected gold/amber, but the rendered accent is still gold.', 'Apply the model\'s palette decision (a restrained cool family); do not fall back to the gold default.', 'artDirection.colorSystem.accent');
    }
    if (mdp.rejectedLooks.some((r) => /dark\s*grid|gold|dashboard|generic|template/i.test(r)) && isAiSaas && !bgLight && (goldAccent || hasDashboardLang)) {
      add('warning', 'same-template-risk', 'The rendered look still matches a direction the model design plan explicitly rejected.', 'Honor the model\'s Selected/Rejected directions: change the palette/hero away from the rejected template.', 'artDirection');
    }
    if (mdp.planSpecificityScore < 45) {
      add('info', 'weak-design-plan', `Design Thinking Plan is thin (specificity ${mdp.planSpecificityScore}/100): ${mdp.weakDesignPlanWarnings.slice(0, 3).join('; ') || 'not concrete enough'}.`, 'Ask the model for a more specific plan: name the visual direction, reject 2+ concrete directions, and pick a hero/palette/differentiation move.', 'designThinkingPlan');
    }
  }
  if (isAiSaas && hasDashboardLang && !/conversation|answer[-\s]?routing|\bflow\b|hand[-\s]?off|no charts|not a metrics dashboard/i.test(dashHay)) {
    add('warning', 'dashboard-overuse', 'Hero/mockup leans on a generic dashboard/chart with no concept-specific twist.', 'Demo the actual concept (conversation / workflow), not a chart dashboard.', 'artDirection.heroTreatment');
  }
  const vtext = `${authority?.targetVertical || ''} ${authority?.audienceVertical || ''} ${promptLc}`.toLowerCase();
  const wantsEditorial = /archive|library|museum|collection|editorial|magazine|journal/.test(vtext);
  const wantsBotanical = /landscap|garden|botanic|nature|forest|peyzaj|organic|plant/.test(vtext);
  const coolAiFam = /midnight-blue|graphite-cyan|slate-violet/.test(fam);
  if ((wantsEditorial || wantsBotanical) && (coolAiFam || (isAiSaas && !fam))) {
    add('warning', 'palette-mismatch', `Palette reads like an AI dashboard, not the ${wantsEditorial ? 'editorial/archive' : 'botanical/organic'} concept.`, 'Select a family that matches the concept (archive-sepia/editorial-cream or botanical-sage/warm-neutral-green).', 'artDirection.paletteFamily');
  }
  if (isAiSaas && !bgLight && !explo && !(ad?.visualDifferentiators || []).length) {
    add('info', 'visual-monotony', 'Dark background with no visual exploration or differentiators — risks visual monotony.', 'Introduce a lighter option or a distinct accent + concept-specific composition.', 'artDirection');
  }
  if (forbidsFakeProof && /metrics|testimonial|logos?|logo wall|social proof|by the numbers|rated|reviews|müşteri metrik|referans/.test(`${sectionNames} ${dashHay}`)) {
    add('warning', 'honesty-risk', 'User forbade fake metrics/logos/testimonials, but copy/visuals still imply metrics/logos/social proof.', 'Remove implied metrics/logos/testimonials; keep honest structural sections only.', 'files');
  }

  // ── Dimension scores (0–100) from the issues + real signals. Deterministic. ──
  const critical = issues.filter((i) => i.severity === 'critical').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;
  const catCount = (c: QualityIssueCategory) => issues.filter((i) => i.category === c).length;
  const dim = (base: number, penaltyEach: number, ...cats: QualityIssueCategory[]) =>
    Math.max(0, Math.min(100, base - penaltyEach * cats.reduce((n, c) => n + catCount(c), 0)));
  const dimensions: QualityDimensions = {
    copyClarity: dim(100, 14, 'raw-label', 'generic-copy', 'public-copy-smell'),
    ctaConsistency: dim(100, 18, 'cta-inconsistency'),
    flowCoherence: dim(100, 16, 'flow-confusion', 'demo-unclear'),
    visualPremiumFit: dim(95, 12, 'visual-density', 'same-template-risk', 'accent-overuse', 'dashboard-overuse', 'palette-mismatch', 'visual-monotony', 'weak-visual-exploration'),
    conceptSpecificity: dim(100, 16, 'weak-hero', 'concept-drift', 'generic-content-depth'),
    demoUsefulness: isAiSaas ? dim(100, 20, 'demo-unclear') : 90,
    honesty: critical ? 40 : (catCount('honesty-risk') ? 70 : 100),
  };
  const score = Math.round(
    (dimensions.copyClarity + dimensions.ctaConsistency + dimensions.flowCoherence
      + dimensions.visualPremiumFit + dimensions.conceptSpecificity + dimensions.demoUsefulness + dimensions.honesty) / 7,
  );
  const status: QualityDirectorArtifact['status'] = (score >= 80 && critical === 0) ? 'passed' : 'needs-fixes';

  const antiTemplateClean = !catCount('same-template-risk') && !catCount('accent-overuse') && !catCount('dashboard-overuse') && !catCount('palette-mismatch');
  const approvedPrinciples = uniq([
    hasConsistencyRule ? L(lang, 'One clear primary conversion', 'Tek net birincil dönüşüm') : '',
    !rawLabels.length ? L(lang, 'Clean public labels', 'Temiz herkese açık etiketler') : '',
    (authority && heroMentionsConcept) ? L(lang, 'Concept-specific hero', 'Konsepte özgü hero') : '',
    !fakeFinding ? L(lang, 'Honest proof (no fabricated metrics)', 'Dürüst kanıt (uydurma metrik yok)') : '',
    (explo && antiTemplateClean) ? L(lang, `Distinct visual direction (${fam || 'explored'}), not the default template`, `Belirgin görsel yön (${fam || 'keşfedildi'}), varsayılan şablon değil`) : '',
  ].filter(Boolean));
  const rewriteInstructions = uniq([
    rawLabels.length ? L(lang, 'Rewrite raw/model-internal section labels into short human labels (strip parentheticals, drop unsupported "metrics").',
      'Ham/model-içi bölüm etiketlerini kısa, insan-okur etiketlere çevir (parantezleri sil, desteklenmeyen "metrik" ifadesini kaldır).') : '',
    (catCount('cta-inconsistency')) ? L(lang, 'Normalize CTAs to one clear primary + supporting secondary.', 'CTA\'ları tek net birincil + destekleyici ikincil olacak şekilde normalize et.') : '',
    (catCount('flow-confusion') || catCount('demo-unclear')) ? L(lang, 'Clarify the landing → (lead gate) → demo flow labels.', 'İniş → (kayıt) → demo akış etiketlerini netleştir.') : '',
    (catCount('public-copy-smell')) ? L(lang, 'Replace internal/planning language and generic SaaS labels with concept-specific public copy (section names, hero headline, CTAs) — keep it honest (no fabricated metrics/logos/testimonials/compliance).',
      'İç/planlama dilini ve genel SaaS etiketlerini konsepte özgü herkese açık metinle değiştir (bölüm adları, hero başlığı, CTA\'lar) — dürüst tut (uydurma metrik/logo/referans/uyumluluk yok).') : '',
    (catCount('generic-content-depth')) ? L(lang, 'Rewrite generic template filler, "future/AI" hero formulas and "interactive demo" copy into concrete, concept-specific jobs-to-be-done; neutralize unsupported proof (certifications/clients/metrics) to honest structural trust.',
      'Genel şablon dolgusunu, "geleceği deneyimle/AI" hero kalıplarını ve "interaktif demo" metnini somut, konsepte özgü işlere dönüştür; desteklenmeyen kanıtı (sertifika/müşteri/metrik) dürüst yapısal güvene indir.') : '',
    (catCount('same-template-risk') || catCount('accent-overuse') || catCount('dashboard-overuse') || catCount('palette-mismatch')) ? L(lang,
      'Switch to a more differentiated visual direction: vary the palette family, demote gold/loud accent, prefer a lighter or concept-fitting background, and make the hero/mockup concept-specific (not a chart dashboard).',
      'Daha farklılaşmış bir görsel yöne geç: palet ailesini değiştir, altın/gürültülü vurguyu geri çek, daha açık veya konsepte uygun bir zemin tercih et ve hero/mockup\'ı konsepte özgü yap (grafik paneli değil).') : '',
  ].filter(Boolean));

  const topCats = uniq(issues.filter((i) => i.severity !== 'info').map((i) => i.category)).slice(0, 3).join(', ');
  const summary = status === 'passed'
    ? L(lang, `Quality score ${score}/100 — passed. Clean labels, consistent CTA, coherent flow.`,
        `Kalite skoru ${score}/100 — geçti. Temiz etiketler, tutarlı CTA, tutarlı akış.`)
    : L(lang, `Quality score ${score}/100 — needs fixes (${critical} critical, ${warnings} warning): ${topCats || 'copy/label polish'}.`,
        `Kalite skoru ${score}/100 — düzeltme gerek (${critical} kritik, ${warnings} uyarı): ${topCats || 'metin/etiket cilası'}.`);

  return { status, score, dimensions, issues, approvedPrinciples, rewriteInstructions, summary };
}

/**
 * Run the Quality Director. Fully guarded: on any error it fails OPEN — a row with
 * status 'failed' + a safe 'failed-open' artifact — and the build continues. Never
 * required for Preview / All Files.
 */
export function runQualityDirector(input: QualityDirectorInput): { agent: WebBuildAgent; artifact: QualityDirectorArtifact } {
  const lang = input.lang || 'en';
  const name = L(lang, 'Quality Director', 'Kalite Direktörü');
  const activity = L(lang, 'Judging copy clarity, CTA consistency and flow', 'Metin netliği, CTA tutarlılığı ve akış değerlendiriliyor');
  try {
    const artifact = deriveQualityDirector(input);
    return { agent: { id: 'quality_director', name, status: 'done', summary: artifact.summary, currentActivity: activity, artifact }, artifact };
  } catch {
    const artifact = failedOpenQualityDirector(lang);
    return { agent: { id: 'quality_director', name, status: 'failed', summary: artifact.summary, currentActivity: activity, artifact }, artifact };
  }
}

/* ── Asset Director Agent (Phase 10A) — plans visual assets ─────────────────
 * Runs AFTER the Quality Director and BEFORE the Fixer. Pure + deterministic +
 * fails open. Decides which visual assets the site needs and HOW each should be
 * produced (composed CSS/SVG now, subtle CSS motion now, or a prompt-ready image
 * slot reserved for a LATER provider phase / manual upload). It NEVER generates an
 * image, calls an image/video API, adds video, or touches the backend. Honest by
 * construction: it forbids fabricated proof and marks any asset that would need
 * real material as manual-upload-later (or image-prompt-later, illustrative-only). */
export interface AssetDirectorInput {
  prompt: string;
  brief: WebBuildBrief;
  sectionItems: Array<{ id: string; name: string }>;
  conceptAuthority?: ConceptAuthority;
  artDirection?: ArtDirectionArtifact;
  strategy?: StrategyAgentArtifact;
  experienceBlueprint?: ExperienceBlueprint;
  visualSignaturePlan?: VisualSignaturePlan;
  ledger?: StrategicThinkingLedger;
  lang?: Lang;
}

/** Universal honesty/safety constraints — every Asset Director plan carries these. */
function assetHonestyConstraints(lang: Lang): { forbidden: string[]; honesty: string[] } {
  return {
    forbidden: [
      L(lang, 'No fake company/customer logos or logo strips.', 'Sahte şirket/müşteri logoları veya logo şeritleri yok.'),
      L(lang, 'No fake testimonials, customer names or quotes.', 'Sahte referans, müşteri adı veya alıntı yok.'),
      L(lang, 'No fabricated metrics, stats or "trusted by N" claims.', 'Uydurma metrik, istatistik veya "N kişi güveniyor" iddiası yok.'),
      L(lang, 'No fake certifications, compliance badges (SOC2/ISO) or awards.', 'Sahte sertifika, uyumluluk rozeti (SOC2/ISO) veya ödül yok.'),
      L(lang, 'No fake product screenshots presented as real UI.', 'Gerçek arayüz gibi sunulan sahte ürün ekran görüntüsü yok.'),
      L(lang, 'No copyrighted/real brand imagery or real institutions.', 'Telifli/gerçek marka görseli veya gerçek kurum yok.'),
      L(lang, 'No before/after claims unless the user provides real material.', 'Kullanıcı gerçek materyal sağlamadıkça önce/sonra iddiası yok.'),
      L(lang, 'No fabricated medical/legal/financial proof.', 'Uydurma tıbbi/hukuki/finansal kanıt yok.'),
    ],
    honesty: [
      L(lang, 'All CSS/SVG visuals are illustrative, front-end-only samples.', 'Tüm CSS/SVG görselleri açıklayıcı, yalnızca ön-yüz örnekleridir.'),
      L(lang, 'Image-later prompts describe illustrative scenes only — never real people, brands or places.', 'Görsel-sonrası istemleri yalnızca açıklayıcı sahneleri tanımlar — gerçek kişi, marka veya yer asla.'),
      L(lang, 'Assets needing real proof/photos are marked manual-upload-later (the user provides them).', 'Gerçek kanıt/fotoğraf gerektiren varlıklar manuel-yükleme-sonrası işaretlenir (kullanıcı sağlar).'),
      L(lang, 'Motion is subtle CSS only and respects prefers-reduced-motion — no video, no autoplay media.', 'Hareket yalnızca ince CSS\'tir ve prefers-reduced-motion\'a saygı gösterir — video yok, otomatik oynatma yok.'),
    ],
  };
}

/**
 * Derive the Asset Director artifact. Pure + deterministic. Chooses a per-site-type
 * set of 3–8 asset slots and a shared style system, categorizes each as composed
 * now (CSS/SVG or CSS motion) vs reserved for a later image provider / manual
 * upload, and records honest safety constraints + provider readiness. Never renders
 * or generates anything.
 */
export function deriveAssetDirector(input: AssetDirectorInput): AssetDirectorArtifact {
  const lang = input.lang || 'en';
  const brief = input.brief || {};
  const hay = [input.prompt, brief.coreIdea, brief.type, brief.goal, brief.audience, brief.style]
    .filter(Boolean).join(' ').toLowerCase();
  const siteType = input.experienceBlueprint?.siteExperienceType || 'unknown';
  const vsp = input.visualSignaturePlan;
  const askedBeforeAfter = /before\s*[\/&-]?\s*after|önce\s*[\/&-]?\s*sonra|transformation|dönüşüm/.test(hay);

  // ── Shared style system (real art-direction data when present, else defaults). ──
  const paletteFamily = input.artDirection?.paletteFamily || input.artDirection?.colorSystem?.paletteName;
  const isLocalLike = siteType === 'restaurant' || siteType === 'local-business';
  const isEditorial = siteType === 'portfolio' || siteType === 'content-publication' || siteType === 'agency-service' || siteType === 'event-landing';
  const styleSystem: AssetStyleSystem = {
    visualLanguage: vsp?.visualSignature
      || (isLocalLike ? L(lang, 'Warm editorial imagery + calm CSS/SVG accents', 'Sıcak editoryal görseller + sakin CSS/SVG vurguları')
        : isEditorial ? L(lang, 'Editorial, image-led with restrained type', 'Editoryal, görsel öncelikli, ölçülü tipografi')
          : L(lang, 'Composed CSS/SVG product visuals, no stock photos', 'CSS/SVG ile kompoze ürün görselleri, stok fotoğraf yok')),
    paletteFamily,
    materialStyle: isLocalLike ? L(lang, 'Natural, tactile, photographic', 'Doğal, dokunsal, fotoğrafik')
      : L(lang, 'Flat + soft-glass, hairline strokes', 'Düz + yumuşak-cam, ince çizgiler'),
    cameraOrComposition: isLocalLike ? L(lang, 'Real on-site photography direction (user-provided)', 'Gerçek sahada fotoğraf yönü (kullanıcı sağlar)') : undefined,
    lighting: isLocalLike ? L(lang, 'Golden-hour / natural daylight', 'Altın saat / doğal gün ışığı') : undefined,
    texture: isLocalLike ? L(lang, 'Organic (foliage, stone, wood)', 'Organik (yaprak, taş, ahşap)') : L(lang, 'Subtle grain / mesh', 'İnce gren / ağ'),
    shapeLanguage: vsp?.primaryMotif || L(lang, 'Calm geometric with one accent path', 'Sakin geometrik, tek vurgu yolu'),
    iconStyle: L(lang, 'Line icons, consistent stroke weight', 'Çizgi ikonlar, tutarlı çizgi kalınlığı'),
    motionMood: (vsp?.motionHints && vsp.motionHints[0]) || L(lang, 'Very subtle, staged, reduced-motion safe', 'Çok ince, aşamalı, reduced-motion güvenli'),
    consistencyRules: uniq([
      L(lang, 'One shared palette + accent across all assets.', 'Tüm varlıklarda tek ortak palet + vurgu.'),
      L(lang, 'Same corner radius, stroke weight and spacing rhythm.', 'Aynı köşe yarıçapı, çizgi kalınlığı ve boşluk ritmi.'),
      L(lang, 'Decorative SVG is aria-hidden; motion is reduced-motion safe.', 'Dekoratif SVG aria-hidden\'dır; hareket reduced-motion güvenlidir.'),
    ]),
  };

  // ── Slot builder. ──
  const slots: AssetSlot[] = [];
  let sid = 0;
  const illustrativeOnly = L(lang, 'Illustrative only — not a real person/brand/place.', 'Yalnızca açıklayıcı — gerçek kişi/marka/yer değil.');
  const add = (
    type: AssetSlotType, target: string, purpose: string, mode: AssetGenerationMode,
    prompt: string, styleNotes: string,
    opts: { motionNotes?: string; negativePrompt?: string; required?: boolean; priority?: AssetSlot['priority']; safetyNotes?: string[] } = {},
  ) => {
    slots.push({
      id: `asset-${sid += 1}`, type, target, purpose, generationMode: mode, prompt,
      negativePrompt: opts.negativePrompt || L(lang, 'no logos, no real brands, no fabricated metrics, no stock-photo watermark', 'logo yok, gerçek marka yok, uydurma metrik yok, stok-fotoğraf filigranı yok'),
      styleNotes, motionNotes: opts.motionNotes,
      safetyNotes: opts.safetyNotes || [illustrativeOnly],
      required: opts.required ?? true,
      priority: opts.priority || 'medium',
    });
  };

  switch (siteType) {
    case 'b2b-product-landing':
    case 'consumer-product-landing':
    case 'dashboard-preview':
      add('product-mockup', 'hero', L(lang, 'Hero product/chat mockup', 'Hero ürün/sohbet mockup\'ı'), 'css-svg-now',
        L(lang, 'A composed chat/product-flow surface built from sample copy (question → recommendation → answer → handoff).', 'Örnek metinden kompoze sohbet/ürün-akış yüzeyi (soru → öneri → yanıt → devir).'),
        styleSystem.materialStyle, { priority: 'high', safetyNotes: [L(lang, 'Front-end demo only — no real AI/backend.', 'Yalnızca ön-yüz demo — gerçek AI/backend yok.')] });
      add('motion-background', 'hero', L(lang, 'Product demo motion surface', 'Ürün demo hareket yüzeyi'), 'motion-css-now',
        L(lang, 'Subtle staged motion: floating cards, pulsing connection dot, slow glow.', 'İnce aşamalı hareket: yüzen kartlar, nabız atan bağlantı noktası, yavaş parıltı.'),
        styleSystem.materialStyle, { motionNotes: styleSystem.motionMood, priority: 'medium' });
      add('integration-map', 'section:integrations', L(lang, 'Integration orbit / nodes', 'Entegrasyon yörüngesi / düğümleri'), 'css-svg-now',
        L(lang, 'Abstract labelled nodes (Store, Catalog, Helpdesk, Email) on an orbit — generic labels, no brand logos.', 'Bir yörüngede soyut etiketli düğümler (Mağaza, Katalog, Yardım, E-posta) — genel etiket, marka logosu yok.'),
        styleSystem.materialStyle, { priority: 'medium', required: false });
      add('trust-visual', 'section:security', L(lang, 'Trust control stack', 'Güven kontrol yığını'), 'css-svg-now',
        L(lang, 'Shield / key / checklist controls — illustrative, no SOC2/ISO or fabricated compliance.', 'Kalkan / anahtar / kontrol listesi — açıklayıcı, SOC2/ISO veya uydurma uyumluluk yok.'),
        styleSystem.materialStyle, { priority: 'medium', required: false });
      add('hero-visual', 'hero', L(lang, 'Future premium hero image (reserved)', 'Gelecek premium hero görseli (ayrılmış)'), 'image-prompt-later',
        L(lang, 'Abstract premium product ambience — glowing interface mesh, depth, brand accent. No real UI, no people.', 'Soyut premium ürün atmosferi — parlayan arayüz ağı, derinlik, marka vurgusu. Gerçek arayüz yok, insan yok.'),
        styleSystem.visualLanguage, { priority: 'low', required: false, safetyNotes: [illustrativeOnly, L(lang, 'Reserved for a later image phase — not generated now.', 'Sonraki bir görsel aşaması için ayrıldı — şimdi üretilmiyor.')] });
      break;
    case 'local-business':
      add('local-project-photo', 'hero', L(lang, 'Hero local-project photography', 'Hero yerel-proje fotoğrafçılığı'), 'manual-upload-later',
        L(lang, 'A real completed project (garden/outdoor space) — the user uploads their own photo.', 'Tamamlanmış gerçek bir proje (bahçe/dış mekan) — kullanıcı kendi fotoğrafını yükler.'),
        styleSystem.materialStyle, { priority: 'high', safetyNotes: [L(lang, 'Real project photo is the user\'s to provide — never fabricated.', 'Gerçek proje fotoğrafını kullanıcı sağlar — asla uydurulmaz.')] });
      add('before-after', 'section:projects', L(lang, 'Before / After structure', 'Önce / Sonra yapısı'), askedBeforeAfter ? 'manual-upload-later' : 'css-svg-now',
        L(lang, 'A before/after comparison frame; real photos are user-provided, otherwise show an illustrative split.', 'Önce/sonra karşılaştırma çerçevesi; gerçek fotoğraflar kullanıcı sağlar, aksi halde açıklayıcı bölünme gösterilir.'),
        styleSystem.materialStyle, { priority: 'medium', safetyNotes: [L(lang, 'No fabricated before/after — needs real user material.', 'Uydurma önce/sonra yok — gerçek kullanıcı materyali gerekir.')] });
      add('section-illustration', 'section:materials', L(lang, 'Materials & process illustration', 'Malzeme ve süreç illüstrasyonu'), 'css-svg-now',
        L(lang, 'A staged materials/process rail (survey → plan → build → care) in composed CSS/SVG.', 'Kompoze CSS/SVG ile aşamalı malzeme/süreç rayı (keşif → plan → yapım → bakım).'),
        styleSystem.materialStyle, { priority: 'medium' });
      add('gallery-image', 'section:gallery', L(lang, 'Project gallery images', 'Proje galerisi görselleri'), 'manual-upload-later',
        L(lang, 'A grid of the user\'s real project photos (uploaded); illustrative placeholders until then.', 'Kullanıcının gerçek proje fotoğraflarından (yüklenen) bir grid; o zamana dek açıklayıcı yer tutucular.'),
        styleSystem.materialStyle, { priority: 'medium', required: false });
      add('motion-background', 'global', L(lang, 'Subtle organic motion', 'İnce organik hareket'), 'motion-css-now',
        L(lang, 'Very subtle organic drift (contour lines / leaf sway), reduced-motion safe.', 'Çok ince organik kayma (kontur çizgileri / yaprak salınımı), reduced-motion güvenli.'),
        styleSystem.materialStyle, { motionNotes: styleSystem.motionMood, priority: 'low', required: false });
      break;
    case 'restaurant':
      add('hero-visual', 'hero', L(lang, 'Hero food / space photography', 'Hero yemek / mekan fotoğrafçılığı'), 'manual-upload-later',
        L(lang, 'Real dish/interior photography — the restaurant provides their own images.', 'Gerçek yemek/iç mekan fotoğrafçılığı — restoran kendi görsellerini sağlar.'),
        styleSystem.materialStyle, { priority: 'high', safetyNotes: [L(lang, 'Real food/space photos are the owner\'s to provide.', 'Gerçek yemek/mekan fotoğraflarını işletme sağlar.')] });
      add('section-illustration', 'section:menu', L(lang, 'Menu visual', 'Menü görseli'), 'css-svg-now',
        L(lang, 'A clean menu layout with category rails — composed CSS/SVG, no fabricated prices.', 'Kategori raylarıyla temiz menü düzeni — kompoze CSS/SVG, uydurma fiyat yok.'),
        styleSystem.materialStyle, { priority: 'medium' });
      add('section-illustration', 'section:reservation', L(lang, 'Reservation flow', 'Rezervasyon akışı'), 'css-svg-now',
        L(lang, 'A simple reservation form shell (date/party/contact) — front-end only, no real booking.', 'Basit rezervasyon formu kabuğu (tarih/kişi/iletişim) — yalnızca ön-yüz, gerçek rezervasyon yok.'),
        styleSystem.materialStyle, { priority: 'medium' });
      add('motion-background', 'global', L(lang, 'Ambient motion', 'Atmosfer hareketi'), 'motion-css-now',
        L(lang, 'Warm ambient drift / steam-like glow, very subtle and reduced-motion safe.', 'Sıcak atmosfer kayması / buhar benzeri parıltı, çok ince ve reduced-motion güvenli.'),
        styleSystem.materialStyle, { motionNotes: styleSystem.motionMood, priority: 'low', required: false });
      break;
    case 'content-publication':
      add('archive-document', 'hero', L(lang, 'Editorial masthead visual', 'Editoryal başlık görseli'), 'css-svg-now',
        L(lang, 'An editorial masthead / featured-article composition in composed CSS/SVG.', 'Kompoze CSS/SVG ile editoryal başlık / öne çıkan makale kompozisyonu.'),
        styleSystem.materialStyle, { priority: 'high' });
      add('archive-document', 'section:archive', L(lang, 'Article/cover image slots', 'Makale/kapak görseli alanları'), 'image-prompt-later',
        L(lang, 'Illustrative article cover imagery — abstract scenes only, no real photos of real events/people.', 'Açıklayıcı makale kapak görselleri — yalnızca soyut sahneler, gerçek olay/kişi fotoğrafı yok.'),
        styleSystem.materialStyle, { priority: 'medium', required: false, safetyNotes: [illustrativeOnly] });
      add('section-illustration', 'section:categories', L(lang, 'Category browsing map', 'Kategori gezinme haritası'), 'css-svg-now',
        L(lang, 'A category index / browsing map — composed CSS/SVG.', 'Kategori dizini / gezinme haritası — kompoze CSS/SVG.'),
        styleSystem.materialStyle, { priority: 'medium' });
      break;
    case 'marketplace':
    case 'ecommerce-store':
      add('catalog-preview', 'hero', L(lang, 'Catalog / product-grid preview', 'Katalog / ürün-grid önizlemesi'), 'css-svg-now',
        L(lang, 'A product grid with filter rail — abstract product cards (media block + title/price bars), no fabricated prices/logos.', 'Filtre raylı ürün gridi — soyut ürün kartları (medya bloğu + başlık/fiyat çubukları), uydurma fiyat/logo yok.'),
        styleSystem.materialStyle, { priority: 'high' });
      add('gallery-image', 'section:listings', L(lang, 'Listing card image slots', 'İlan kartı görsel alanları'), 'image-prompt-later',
        L(lang, 'Illustrative product/listing imagery — generic objects, no real brands or copyrighted products.', 'Açıklayıcı ürün/ilan görselleri — genel nesneler, gerçek marka veya telifli ürün yok.'),
        styleSystem.materialStyle, { priority: 'medium', required: false, safetyNotes: [illustrativeOnly] });
      add('motion-background', 'section:filters', L(lang, 'Filter motion', 'Filtre hareketi'), 'motion-css-now',
        L(lang, 'Subtle filter/sort transition motion, reduced-motion safe.', 'İnce filtre/sıralama geçiş hareketi, reduced-motion güvenli.'),
        styleSystem.materialStyle, { motionNotes: styleSystem.motionMood, priority: 'low', required: false });
      break;
    case 'portfolio':
    case 'agency-service':
      add('abstract-brand-shape', 'hero', L(lang, 'Hero brand shape', 'Hero marka şekli'), 'css-svg-now',
        L(lang, 'An editorial abstract brand shape / type-led hero — composed CSS/SVG, no stock photos.', 'Editoryal soyut marka şekli / tipografi öncelikli hero — kompoze CSS/SVG, stok fotoğraf yok.'),
        styleSystem.visualLanguage, { priority: 'high' });
      add('gallery-image', 'section:work', L(lang, 'Work / project images', 'Çalışma / proje görselleri'), 'manual-upload-later',
        L(lang, 'The creator\'s real work images (uploaded); illustrative placeholders until then. No fake client logos.', 'Yaratıcının gerçek çalışma görselleri (yüklenen); o zamana dek açıklayıcı yer tutucular. Sahte müşteri logosu yok.'),
        styleSystem.materialStyle, { priority: 'high', safetyNotes: [L(lang, 'Real work images are the creator\'s to provide.', 'Gerçek çalışma görsellerini yaratıcı sağlar.')] });
      add('section-illustration', 'section:process', L(lang, 'Process / skills illustration', 'Süreç / yetenek illüstrasyonu'), 'css-svg-now',
        L(lang, 'A staged process rail — composed CSS/SVG.', 'Aşamalı süreç rayı — kompoze CSS/SVG.'),
        styleSystem.materialStyle, { priority: 'medium', required: false });
      break;
    default:
      add('hero-visual', 'hero', L(lang, 'Hero signature visual', 'Hero imza görseli'), 'css-svg-now',
        L(lang, 'A concept-specific composed CSS/SVG hero visual, no stock photos or blank boxes.', 'Konsepte özgü, kompoze CSS/SVG hero görseli, stok fotoğraf veya boş kutu yok.'),
        styleSystem.visualLanguage, { priority: 'high' });
      add('hero-background', 'hero', L(lang, 'Ambient hero background', 'Atmosferik hero arka planı'), 'css-svg-now',
        L(lang, 'A restrained tonal background with a single accent path.', 'Tek vurgu yollu ölçülü tonal arka plan.'),
        styleSystem.materialStyle, { priority: 'medium', required: false });
      add('abstract-brand-shape', 'global', L(lang, 'Abstract brand shape', 'Soyut marka şekli'), 'css-svg-now',
        L(lang, 'A reusable abstract brand shape / motif for section accents.', 'Bölüm vurguları için yeniden kullanılabilir soyut marka şekli / motif.'),
        styleSystem.shapeLanguage || styleSystem.materialStyle, { priority: 'low', required: false });
      break;
  }

  const cssSvgNowSlots = slots.filter((s) => s.generationMode === 'css-svg-now').map((s) => s.id);
  const motionNowSlots = slots.filter((s) => s.generationMode === 'motion-css-now').map((s) => s.id);
  const imageLaterSlots = slots.filter((s) => s.generationMode === 'image-prompt-later' || s.generationMode === 'image-provider-later').map((s) => s.id);
  const manualUploadSlots = slots.filter((s) => s.generationMode === 'manual-upload-later').map((s) => s.id);

  const { forbidden, honesty } = assetHonestyConstraints(lang);
  const imageProviderNeeded = imageLaterSlots.length > 0;
  const manualUploadUseful = manualUploadSlots.length > 0;

  const assetStrategy = isLocalLike
    ? L(lang, 'Real photography (user-provided / image-later) for proof surfaces, composed CSS/SVG for structure + subtle organic motion.', 'Kanıt yüzeyleri için gerçek fotoğraf (kullanıcı/görsel-sonrası), yapı için kompoze CSS/SVG + ince organik hareket.')
    : (siteType === 'marketplace' || siteType === 'ecommerce-store')
      ? L(lang, 'Composed catalog/product CSS/SVG now; illustrative listing image slots reserved for a later provider.', 'Şimdi kompoze katalog/ürün CSS/SVG; açıklayıcı ilan görsel alanları sonraki bir sağlayıcıya ayrıldı.')
      : L(lang, 'Composed CSS/SVG product visuals + subtle CSS motion now; one premium hero image reserved for later.', 'Şimdi kompoze CSS/SVG ürün görselleri + ince CSS hareketi; bir premium hero görseli sonraya ayrıldı.');

  return {
    status: slots.length ? 'planned' : 'partial',
    assetStrategy,
    styleSystem,
    slots,
    cssSvgNowSlots,
    motionNowSlots,
    imageLaterSlots,
    forbiddenAssets: forbidden,
    honestyConstraints: honesty,
    providerReadiness: {
      imageProviderNeeded,
      // Phase 10A: motion is composed CSS only — NO video/motion provider is needed
      // now (video generation is explicitly out of scope until a later phase).
      motionProviderNeeded: false,
      manualUploadUseful,
      reason: L(lang,
        `${imageProviderNeeded ? `${imageLaterSlots.length} image slot(s) reserved for a later provider phase (10C). ` : ''}${manualUploadUseful ? `${manualUploadSlots.length} slot(s) prefer user-uploaded real material. ` : ''}Motion is CSS-only now; video generation is out of scope.`,
        `${imageProviderNeeded ? `${imageLaterSlots.length} görsel alanı sonraki sağlayıcı aşamasına (10C) ayrıldı. ` : ''}${manualUploadUseful ? `${manualUploadSlots.length} alan kullanıcı yüklemeli gerçek materyali tercih ediyor. ` : ''}Hareket şimdilik yalnızca CSS; video üretimi kapsam dışı.`),
    },
    summary: L(lang,
      `Planned ${slots.length} asset slot(s) for a ${siteType} site (${cssSvgNowSlots.length} CSS/SVG now · ${motionNowSlots.length} motion · ${imageLaterSlots.length} image-later · ${manualUploadSlots.length} upload). Honest: no fabricated proof; no images generated in this phase.`,
      `${siteType} sitesi için ${slots.length} varlık alanı planlandı (${cssSvgNowSlots.length} CSS/SVG · ${motionNowSlots.length} hareket · ${imageLaterSlots.length} görsel-sonrası · ${manualUploadSlots.length} yükleme). Dürüst: uydurma kanıt yok; bu aşamada görsel üretilmedi.`),
  };
}

/** Fail-open Asset Director artifact — a valid, empty-but-honest plan. */
function failedOpenAssetDirector(lang: Lang): AssetDirectorArtifact {
  const { forbidden, honesty } = assetHonestyConstraints(lang);
  return {
    status: 'failed-open',
    assetStrategy: L(lang, 'Asset planning failed open — the build continues with the existing CSS/SVG signature visuals.', 'Varlık planlaması açık başarısız oldu — yapı mevcut CSS/SVG imza görselleriyle devam ediyor.'),
    styleSystem: { visualLanguage: L(lang, 'Composed CSS/SVG', 'Kompoze CSS/SVG'), materialStyle: L(lang, 'Flat + hairline', 'Düz + ince çizgi'), consistencyRules: [] },
    slots: [],
    cssSvgNowSlots: [], motionNowSlots: [], imageLaterSlots: [],
    forbiddenAssets: forbidden, honestyConstraints: honesty,
    providerReadiness: { imageProviderNeeded: false, motionProviderNeeded: false, manualUploadUseful: false, reason: L(lang, 'No asset plan produced (failed open).', 'Varlık planı üretilmedi (açık başarısız).') },
    summary: L(lang, 'Asset Director failed open; no assets generated; Preview/All Files unaffected.', 'Varlık Direktörü açık başarısız oldu; varlık üretilmedi; Önizleme/Tüm Dosyalar etkilenmedi.'),
  };
}

/**
 * Run the Asset Director. Fully guarded: on any error it fails OPEN — a valid,
 * honest, empty plan — so it can never block Preview / All Files.
 */
export function runAssetDirector(input: AssetDirectorInput): { agent: WebBuildAgent; artifact: AssetDirectorArtifact } {
  const lang = input.lang || 'en';
  const name = L(lang, 'Asset Director', 'Varlık Direktörü');
  const activity = L(lang, 'Planning hero/section visual assets (CSS/SVG now, image later)', 'Hero/bölüm görsel varlıkları planlanıyor (CSS/SVG şimdi, görsel sonra)');
  try {
    const artifact = deriveAssetDirector(input);
    return { agent: { id: 'asset_director', name, status: 'done', summary: artifact.summary, currentActivity: activity, artifact }, artifact };
  } catch {
    const artifact = failedOpenAssetDirector(lang);
    return { agent: { id: 'asset_director', name, status: 'failed', summary: artifact.summary, currentActivity: activity, artifact }, artifact };
  }
}

/* ── Motion Composer Agent (Phase 10B) — composes subtle CSS/SVG motion ─────────
 * Runs AFTER the Asset Director and BEFORE the Fixer. Pure + deterministic + fails
 * open. Consumes the Asset Director's `motion-css-now` slots and decides concept-
 * specific motion LAYERS the Preview renders with framer-motion / CSS only. NEVER
 * video, image generation, a provider, or a backend. Subtle by default, reduced-
 * motion respected, no fake loading/progress/inventory. */
export interface MotionComposerInput {
  brief: WebBuildBrief;
  sectionItems: Array<{ id: string; name: string }>;
  artDirection?: ArtDirectionArtifact;
  blueprint?: PageBlueprint;
  experienceBlueprint?: ExperienceBlueprint;
  visualSignaturePlan?: VisualSignaturePlan;
  assetDirector?: AssetDirectorArtifact;
  lang?: Lang;
}

/** Section-role regexes reused to target motion at the right sections. */
const MOTION_ROLE_RE = {
  demo: /demo|chat|assistant|playground|product-?demo|conversation|sohbet/i,
  integrations: /integration|connect|shopify|\bapi\b|plugin|webhook|catalog|store\s*integrat|entegrasyon/i,
  security: /security|trust|privacy|compliance|safety|güven|gizlilik/i,
  flow: /how[-\s]?it[-\s]?works|process|workflow|steps?|journey|shopper\s*flow|materials?|malzeme|süreç|nasıl/i,
  beforeAfter: /before\s*[\/&-]?\s*after|önce\s*[\/&-]?\s*sonra|transformation|projects?|gallery|work|dönüşüm|proje|galeri/i,
  menu: /\bmenu\b|dishes?|cuisine|menü|yemek/i,
  reservation: /reservation|reserve|booking|contact|rezervasyon|randevu|iletişim/i,
  catalog: /catalog|filter|listings?|product\s*grid|shop|browse|katalog|filtre|ürün/i,
  archive: /archive|document|collection|provenance|record|arşiv|belge|koleksiyon/i,
} as const;

/**
 * Derive the Motion Composer artifact. Pure + deterministic. Reads the Asset
 * Director's motion-css-now slots + the experience type + real sections, and
 * composes concept-specific SUBTLE motion layers (hero / global / per-section).
 * Always reduced-motion safe; never fakes backend work. Renders nothing itself.
 */
export function deriveMotionComposer(input: MotionComposerInput): MotionComposerArtifact {
  const lang = input.lang || 'en';
  const siteType = input.experienceBlueprint?.siteExperienceType || 'unknown';
  const sections = input.sectionItems || [];
  const motionSlots = (input.assetDirector?.slots || []).filter((s) => s.generationMode === 'motion-css-now');
  const consumedAssetSlots = motionSlots.map((s) => s.id);

  const isSaaS = siteType === 'b2b-product-landing' || siteType === 'consumer-product-landing' || siteType === 'dashboard-preview';
  const isLocal = siteType === 'restaurant' || siteType === 'local-business';
  const isCommerce = siteType === 'marketplace' || siteType === 'ecommerce-store';
  const isArchive = siteType === 'content-publication';
  const isPortfolioAgency = siteType === 'portfolio' || siteType === 'agency-service';

  const layers: MotionLayer[] = [];
  let mid = 0;
  const reducedFallback = L(lang, 'Static layer — loops stop, no transform movement.', 'Statik katman — döngüler durur, dönüşüm hareketi yok.');
  const noFakeWork = L(lang, 'Illustrative only — never implies real backend work, loading or live data.', 'Yalnızca açıklayıcı — gerçek backend işi, yükleme veya canlı veri ima etmez.');
  const add = (target: string, pattern: MotionPattern, intensity: MotionLayer['intensity'], purpose: string, duration: number, safety: string[] = [noFakeWork], delay?: number) => {
    layers.push({ id: `motion-${mid += 1}`, target, pattern, intensity, purpose, duration, delay, reducedMotionFallback: reducedFallback, safetyNotes: safety });
  };
  // Match a section by role → 'section:<id>' target (first match wins).
  const sectionFor = (re: RegExp): string | undefined => {
    const s = sections.find((x) => re.test(`${x.id} ${x.name}`) && !/hero|footer/i.test(`${x.id} ${x.name}`));
    return s ? `section:${s.id}` : undefined;
  };

  // ── Hero + global ambient (concept-specific, minimal/subtle only). ──
  if (isLocal) {
    add('hero', 'organic-drift', 'subtle', L(lang, 'Calm organic hero atmosphere', 'Sakin organik hero atmosferi'), 14);
    add('global', 'organic-drift', 'minimal', L(lang, 'Very subtle organic background drift', 'Çok ince organik arka plan kayması'), 18);
  } else if (isArchive) {
    add('hero', 'ambient-gradient', 'minimal', L(lang, 'Restrained editorial hero ambience', 'Ölçülü editoryal hero atmosferi'), 16);
  } else if (isCommerce) {
    add('hero', 'ambient-gradient', 'subtle', L(lang, 'Product ambience behind the catalog hero', 'Katalog hero arkasında ürün atmosferi'), 14);
  } else if (isPortfolioAgency) {
    add('hero', 'floating-cards', 'subtle', L(lang, 'Editorial floating brand shapes', 'Editoryal yüzen marka şekilleri'), 12);
  } else if (isSaaS) {
    add('hero', 'floating-cards', 'subtle', L(lang, 'Gently floating hero/product cards', 'Nazikçe yüzen hero/ürün kartları'), 12);
    add('global', 'ambient-gradient', 'minimal', L(lang, 'Minimal ambient product glow', 'Minimal atmosferik ürün parıltısı'), 18);
  } else {
    add('hero', 'ambient-gradient', 'minimal', L(lang, 'Minimal ambient hero glow', 'Minimal atmosferik hero parıltısı'), 16);
  }

  // ── Section-role motion (concept-specific). No dashboard/chart motion for local. ──
  if (isSaaS) {
    const demo = sectionFor(MOTION_ROLE_RE.demo); if (demo) add(demo, 'chat-typing', 'subtle', L(lang, 'Sample chat typing on the product demo', 'Ürün demosunda örnek sohbet yazımı'), 1.6, [noFakeWork, L(lang, 'Front-end sample — no real AI/backend.', 'Ön-yüz örneği — gerçek AI/backend yok.')]);
    const integ = sectionFor(MOTION_ROLE_RE.integrations); if (integ) add(integ, 'integration-orbit', 'subtle', L(lang, 'Slow integration orbit (generic nodes, no logos)', 'Yavaş entegrasyon yörüngesi (genel düğümler, logo yok)'), 60, [noFakeWork, L(lang, 'No real brand logos.', 'Gerçek marka logosu yok.')]);
    const sec = sectionFor(MOTION_ROLE_RE.security); if (sec) add(sec, 'trust-pulse', 'subtle', L(lang, 'Staged trust-control pulse', 'Aşamalı güven-kontrol nabzı'), 1.8, [noFakeWork, L(lang, 'No fake compliance/certification.', 'Sahte uyumluluk/sertifika yok.')]);
    const flow = sectionFor(MOTION_ROLE_RE.flow); if (flow) add(flow, 'timeline-progress', 'subtle', L(lang, 'Staged flow/timeline progress', 'Aşamalı akış/zaman çizelgesi ilerlemesi'), 1.1);
  } else if (isLocal) {
    const ba = sectionFor(MOTION_ROLE_RE.beforeAfter); if (ba) add(ba, 'before-after-reveal', 'subtle', L(lang, 'Illustrative before/after reveal', 'Açıklayıcı önce/sonra ortaya çıkışı'), 1.4, [noFakeWork, L(lang, 'Illustrative only — real before/after needs user-provided material.', 'Yalnızca açıklayıcı — gerçek önce/sonra kullanıcı materyali gerektirir.')]);
    const proc = sectionFor(MOTION_ROLE_RE.flow); if (proc) add(proc, 'timeline-progress', 'subtle', L(lang, 'Materials/process staged progress', 'Malzeme/süreç aşamalı ilerlemesi'), 1.1);
    if (siteType === 'restaurant') {
      const menu = sectionFor(MOTION_ROLE_RE.menu); if (menu) add(menu, 'menu-reveal', 'subtle', L(lang, 'Soft menu reveal', 'Yumuşak menü ortaya çıkışı'), 0.9);
      const resv = sectionFor(MOTION_ROLE_RE.reservation); if (resv) add(resv, 'menu-reveal', 'minimal', L(lang, 'Gentle reservation card reveal', 'Nazik rezervasyon kartı ortaya çıkışı'), 0.9, [noFakeWork, L(lang, 'No fake live booking/order backend.', 'Sahte canlı rezervasyon/sipariş backend\'i yok.')]);
    }
  } else if (isArchive) {
    const arch = sectionFor(MOTION_ROLE_RE.archive); if (arch) add(arch, 'document-scan', 'subtle', L(lang, 'Slow document scan line', 'Yavaş belge tarama çizgisi'), 11, [noFakeWork, L(lang, 'No fake institution/source claim.', 'Sahte kurum/kaynak iddiası yok.')]);
    const prov = sectionFor(MOTION_ROLE_RE.flow); if (prov) add(prov, 'timeline-progress', 'minimal', L(lang, 'Provenance/process progress', 'Köken/süreç ilerlemesi'), 1.2);
  } else if (isCommerce) {
    const cat = sectionFor(MOTION_ROLE_RE.catalog); if (cat) add(cat, 'catalog-filter-shift', 'subtle', L(lang, 'Subtle filter/list transition', 'İnce filtre/liste geçişi'), 0.8, [noFakeWork, L(lang, 'No fake live inventory/counter.', 'Sahte canlı envanter/sayaç yok.')]);
    add('hero', 'floating-cards', 'subtle', L(lang, 'Gently floating product cards', 'Nazikçe yüzen ürün kartları'), 12);
  } else if (isPortfolioAgency) {
    const proc = sectionFor(MOTION_ROLE_RE.flow); if (proc) add(proc, 'timeline-progress', 'subtle', L(lang, 'Process staged progress', 'Süreç aşamalı ilerlemesi'), 1.1);
  }

  const globalMotion = layers.filter((l) => l.target === 'global');
  const heroMotion = layers.filter((l) => l.target === 'hero');
  const sectionMotion = layers.filter((l) => l.target.startsWith('section:'));

  const motionStrategy = isLocal
    ? L(lang, 'Calm organic ambient + illustrative reveals; no dashboard/chart motion.', 'Sakin organik atmosfer + açıklayıcı ortaya çıkışlar; panel/grafik hareketi yok.')
    : isSaaS
      ? L(lang, 'Subtle product motion: floating cards, sample chat typing, integration orbit, trust pulse.', 'İnce ürün hareketi: yüzen kartlar, örnek sohbet yazımı, entegrasyon yörüngesi, güven nabzı.')
      : isArchive
        ? L(lang, 'Very restrained editorial motion: document scan + provenance progress.', 'Çok ölçülü editoryal hareket: belge tarama + köken ilerlemesi.')
        : isCommerce
          ? L(lang, 'Subtle catalog/filter transitions + floating product cards; no live counters.', 'İnce katalog/filtre geçişleri + yüzen ürün kartları; canlı sayaç yok.')
          : L(lang, 'Minimal ambient motion, subtle by default.', 'Minimal atmosferik hareket, varsayılan olarak ince.');

  const forbiddenMotion = uniq([
    L(lang, 'No video, autoplay media or heavy canvas/WebGL.', 'Video, otomatik oynatma medya veya ağır canvas/WebGL yok.'),
    L(lang, 'No fake loading/progress bars implying real backend work.', 'Gerçek backend işi ima eden sahte yükleme/ilerleme çubuğu yok.'),
    L(lang, 'No fake live counters, inventory, prices or metrics.', 'Sahte canlı sayaç, envanter, fiyat veya metrik yok.'),
    L(lang, 'No loud/flashy motion; nothing seizure-inducing (no rapid flashing).', 'Gürültülü/gösterişli hareket yok; nöbet tetikleyici hiçbir şey yok (hızlı yanıp sönme yok).'),
    ...(isLocal ? [L(lang, 'No dashboard/chart/data motion on a local/service site.', 'Yerel/hizmet sitesinde panel/grafik/veri hareketi yok.')] : []),
  ]);

  const reducedMotionPolicy = L(lang,
    'All motion is gated on prefers-reduced-motion: loops stop, infinite animations disable, only a static layer remains — no large transforms.',
    'Tüm hareket prefers-reduced-motion ile kapılanır: döngüler durur, sonsuz animasyonlar devre dışı kalır, yalnızca statik bir katman kalır — büyük dönüşüm yok.');

  return {
    status: layers.length ? 'composed' : 'partial',
    motionStrategy,
    layers,
    globalMotion,
    heroMotion,
    sectionMotion,
    consumedAssetSlots,
    reducedMotionPolicy,
    forbiddenMotion,
    summary: L(lang,
      `Composed ${layers.length} subtle motion layer(s) for a ${siteType} site (${heroMotion.length} hero · ${globalMotion.length} global · ${sectionMotion.length} section), consuming ${consumedAssetSlots.length} motion asset slot(s). Reduced-motion safe; no video, no image/provider, no fake backend.`,
      `${siteType} sitesi için ${layers.length} ince hareket katmanı oluşturuldu (${heroMotion.length} hero · ${globalMotion.length} global · ${sectionMotion.length} bölüm), ${consumedAssetSlots.length} hareket varlık alanı kullanıldı. Reduced-motion güvenli; video yok, görsel/sağlayıcı yok, sahte backend yok.`),
  };
}

/** Fail-open Motion Composer artifact — a valid, empty-but-safe plan. */
function failedOpenMotionComposer(lang: Lang): MotionComposerArtifact {
  return {
    status: 'failed-open',
    motionStrategy: L(lang, 'Motion planning failed open — the Preview keeps its existing subtle motion.', 'Hareket planlaması açık başarısız oldu — Önizleme mevcut ince hareketini korur.'),
    layers: [], globalMotion: [], heroMotion: [], sectionMotion: [], consumedAssetSlots: [],
    reducedMotionPolicy: L(lang, 'prefers-reduced-motion respected (static fallback).', 'prefers-reduced-motion\'a saygı gösterilir (statik yedek).'),
    forbiddenMotion: [L(lang, 'No video, no fake backend work.', 'Video yok, sahte backend işi yok.')],
    summary: L(lang, 'Motion Composer failed open; no motion layers composed; Preview unaffected.', 'Hareket Tasarımcısı açık başarısız oldu; hareket katmanı oluşturulmadı; Önizleme etkilenmedi.'),
  };
}

/**
 * Run the Motion Composer. Fully guarded: on any error it fails OPEN — a valid,
 * safe, empty plan — so it can never block Preview / All Files.
 */
export function runMotionComposer(input: MotionComposerInput): { agent: WebBuildAgent; artifact: MotionComposerArtifact } {
  const lang = input.lang || 'en';
  const name = L(lang, 'Motion Composer', 'Hareket Tasarımcısı');
  const activity = L(lang, 'Composing subtle CSS motion (reduced-motion safe; no video)', 'İnce CSS hareketi oluşturuluyor (reduced-motion güvenli; video yok)');
  try {
    const artifact = deriveMotionComposer(input);
    return { agent: { id: 'motion_composer', name, status: 'done', summary: artifact.summary, currentActivity: activity, artifact }, artifact };
  } catch {
    const artifact = failedOpenMotionComposer(lang);
    return { agent: { id: 'motion_composer', name, status: 'failed', summary: artifact.summary, currentActivity: activity, artifact }, artifact };
  }
}

/* ── Image Pipeline Agent (Phase 10C) — provider-ready image plan ────────────────
 * Runs AFTER the Motion Composer and BEFORE the Fixer. Pure + deterministic + fails
 * open. Consumes the Asset Director's image-prompt-later / image-provider-later /
 * manual-upload-later slots and produces a structured, provider-READY plan the
 * Preview renders as HONEST placeholders. It NEVER calls an image API, generates a
 * real image, uploads to a backend, or adds video. Proof-heavy visuals are marked
 * manual-upload-recommended; generated imagery is always illustrative-only. */
export interface ImagePipelineInput {
  brief: WebBuildBrief;
  sectionItems: Array<{ id: string; name: string }>;
  artDirection?: ArtDirectionArtifact;
  experienceBlueprint?: ExperienceBlueprint;
  assetDirector?: AssetDirectorArtifact;
  motionComposer?: MotionComposerArtifact;
  lang?: Lang;
}

/** The negative-prompt safety line every image prompt carries (Phase 10C). */
function imageNegativePrompt(lang: Lang): string {
  return L(lang,
    'no logos, no brand names, no real company marks, no fake testimonials, no fake metrics/stats, no fake certificates/compliance badges, no real identifiable people, no copyrighted characters/styles, no UI screenshots implying real production data, no medical/legal/financial proof imagery',
    'logo yok, marka adı yok, gerçek şirket işareti yok, sahte referans yok, sahte metrik/istatistik yok, sahte sertifika/uyumluluk rozeti yok, gerçek tanınabilir kişi yok, telifli karakter/stil yok, gerçek üretim verisi ima eden arayüz ekran görüntüsü yok, tıbbi/hukuki/finansal kanıt görseli yok');
}

/**
 * Derive the Image Pipeline artifact. Pure + deterministic. Maps the Asset
 * Director's image-*-later / manual-upload-later slots to structured image slots
 * (manual-upload / provider-ready / prompt-ready / css-placeholder), each with an
 * honest label + a safe prompt (illustrative-only). Never generates or uploads.
 */
export function deriveImagePipeline(input: ImagePipelineInput): ImagePipelineArtifact {
  const lang = input.lang || 'en';
  const siteType = input.experienceBlueprint?.siteExperienceType || 'unknown';
  const paletteFamily = input.artDirection?.paletteFamily || input.artDirection?.colorSystem?.paletteName;
  const negative = imageNegativePrompt(lang);
  const isLocal = siteType === 'restaurant' || siteType === 'local-business';
  const isSaaS = siteType === 'b2b-product-landing' || siteType === 'consumer-product-landing' || siteType === 'dashboard-preview';
  const isCommerce = siteType === 'marketplace' || siteType === 'ecommerce-store';
  const isArchive = siteType === 'content-publication';
  const isPortfolioAgency = siteType === 'portfolio' || siteType === 'agency-service';

  const illustrative = L(lang, 'Illustrative image slot — not a real photo.', 'Açıklayıcı görsel alanı — gerçek fotoğraf değil.');
  const manualLabel = L(lang, 'Manual upload recommended — provide your own real photo.', 'Manuel yükleme önerilir — kendi gerçek fotoğrafınızı sağlayın.');
  const providerLabel = L(lang, 'Provider-ready (illustrative) — a later phase can generate/search it.', 'Sağlayıcıya hazır (açıklayıcı) — sonraki bir aşama üretebilir/arayabilir.');

  const styleBase = L(lang, `Premium, calm, editorial; consistent with the site palette${paletteFamily ? ` (${paletteFamily})` : ''}; no text overlays.`, `Premium, sakin, editoryal; site paletiyle tutarlı${paletteFamily ? ` (${paletteFamily})` : ''}; metin bindirmesi yok.`);

  const slots: ImageAssetSlot[] = [];
  let iid = 0;
  const add = (
    kind: ImageAssetKind, target: string, source: ImageAssetSource, title: string, purpose: string,
    positive: string, treatment: ImageAssetSlot['previewTreatment'], aspect: ImageAssetPrompt['aspectRatio'],
    opts: { placeholderLabel?: string; honestyLabel?: string; required?: boolean; priority?: ImageAssetSlot['priority']; manualUpload?: boolean; providerReady?: boolean; sourceSlotId?: string; extraSafety?: string[] } = {},
  ) => {
    const manualUpload = opts.manualUpload ?? (source === 'manual-upload');
    const providerReady = opts.providerReady ?? (source === 'provider-ready');
    slots.push({
      id: `img-${iid += 1}`, sourceAssetSlotId: opts.sourceSlotId, kind, target, source, title, purpose,
      prompt: { positive, negative, style: styleBase, aspectRatio: aspect, consistencySeedHint: paletteFamily || undefined, safetyNotes: [illustrative, ...(opts.extraSafety || [])] },
      placeholderLabel: opts.placeholderLabel || (manualUpload ? manualLabel : source === 'css-placeholder' ? illustrative : providerLabel),
      previewTreatment: treatment,
      required: opts.required ?? false,
      priority: opts.priority || 'medium',
      manualUploadRecommended: manualUpload,
      providerReady,
      honestyLabel: opts.honestyLabel || (manualUpload ? manualLabel : source === 'css-placeholder' ? illustrative : providerLabel),
    });
  };
  // Match a section by keyword → 'section:<id>' (skips hero/footer).
  const sectionFor = (re: RegExp): string | undefined => {
    const s = (input.sectionItems || []).find((x) => re.test(`${x.id} ${x.name}`) && !/hero|footer/i.test(`${x.id} ${x.name}`));
    return s ? `section:${s.id}` : undefined;
  };

  // Map the Asset Director's image-worthy slots (provenance) so slots trace back.
  const adImageSlots = (input.assetDirector?.slots || []).filter((s) =>
    s.generationMode === 'image-prompt-later' || s.generationMode === 'image-provider-later' || s.generationMode === 'manual-upload-later');
  const firstAdSlotFor = (kinds: string[]): string | undefined =>
    adImageSlots.find((s) => kinds.some((k) => s.type.includes(k) || s.target.includes(k)))?.id;

  // ── Per-site-type image slots (honest source per the concept). ──
  if (isLocal && siteType === 'local-business') {
    add('project-photo', 'hero', 'manual-upload', L(lang, 'Hero project photo', 'Hero proje fotoğrafı'), L(lang, 'A completed real project (garden/outdoor space).', 'Tamamlanmış gerçek bir proje (bahçe/dış mekan).'),
      L(lang, 'A finished landscaping/outdoor project, natural daylight, wide establishing shot.', 'Tamamlanmış peyzaj/dış mekan projesi, doğal gün ışığı, geniş açı.'), 'large-hero-frame', '16:9',
      { required: true, priority: 'high', sourceSlotId: firstAdSlotFor(['local-project-photo', 'hero']) });
    const ba = sectionFor(/before\s*[\/&-]?\s*after|önce|sonra|project|proje|gallery|galeri|work/i);
    if (ba) add('before-after-pair', ba, 'manual-upload', L(lang, 'Before / after pair', 'Önce / sonra çifti'), L(lang, 'A real before & after of one project.', 'Bir projenin gerçek önce & sonrası.'),
      L(lang, 'Two matched frames of the same space before and after (user-provided).', 'Aynı mekanın önce ve sonrası eşleşen iki kare (kullanıcı sağlar).'), 'before-after-frame', '4:3',
      { priority: 'high', extraSafety: [L(lang, 'No fabricated before/after — needs real user material.', 'Uydurma önce/sonra yok — gerçek kullanıcı materyali gerekir.')] });
    const gal = sectionFor(/gallery|galeri|projects?|work/i);
    if (gal) add('gallery-photo', gal, 'manual-upload', L(lang, 'Project gallery', 'Proje galerisi'), L(lang, 'The studio\'s real project photos.', 'Stüdyonun gerçek proje fotoğrafları.'),
      L(lang, 'A grid of finished outdoor projects (user-provided).', 'Tamamlanmış dış mekan projelerinden bir grid (kullanıcı sağlar).'), 'gallery-grid', '1:1', { priority: 'medium' });
    add('hero-background', 'global', 'provider-ready', L(lang, 'Outdoor mood background', 'Dış mekan atmosfer arka planı'), L(lang, 'An illustrative outdoor-design mood image.', 'Açıklayıcı bir dış mekan tasarım atmosfer görseli.'),
      L(lang, 'Soft illustrative outdoor greenery/texture, abstract, no identifiable place.', 'Yumuşak açıklayıcı dış mekan yeşilliği/dokusu, soyut, tanınabilir yer yok.'), 'ambient-background', '21:9', { priority: 'low', providerReady: true });
  } else if (siteType === 'restaurant') {
    add('food-photo', 'hero', 'manual-upload', L(lang, 'Hero food photo', 'Hero yemek fotoğrafı'), L(lang, 'A signature dish (real).', 'Bir imza yemek (gerçek).'),
      L(lang, 'A plated signature dish, natural light, shallow depth of field.', 'Tabakta imza yemek, doğal ışık, sığ alan derinliği.'), 'large-hero-frame', '3:2', { required: true, priority: 'high', sourceSlotId: firstAdSlotFor(['hero-visual', 'hero']) });
    const space = sectionFor(/space|interior|about|gallery|dining|mekan|iç|hakkında|galeri/i);
    add('restaurant-space', space || 'section:about', 'manual-upload', L(lang, 'Restaurant space', 'Restoran mekanı'), L(lang, 'The real interior/atmosphere.', 'Gerçek iç mekan/atmosfer.'),
      L(lang, 'The restaurant interior/ambience (user-provided).', 'Restoranın iç mekanı/atmosferi (kullanıcı sağlar).'), 'gallery-grid', '4:3', { priority: 'medium', extraSafety: [L(lang, 'No fake awards/reviews/real-location claims.', 'Sahte ödül/yorum/gerçek-konum iddiası yok.')] });
    const menu = sectionFor(/\bmenu\b|dishes?|menü|yemek/i);
    if (menu) add('food-photo', menu, 'provider-ready', L(lang, 'Menu dish images', 'Menü yemek görselleri'), L(lang, 'Illustrative dish imagery.', 'Açıklayıcı yemek görselleri.'),
      L(lang, 'Illustrative plated dishes, generic cuisine, no brand.', 'Açıklayıcı tabaklanmış yemekler, genel mutfak, marka yok.'), 'catalog-card', '1:1', { priority: 'low', providerReady: true });
  } else if (isArchive) {
    const arch = sectionFor(/archive|document|collection|provenance|record|arşiv|belge|koleksiyon/i);
    add('archive-scan', arch || 'hero', 'manual-upload', L(lang, 'Archive document scan', 'Arşiv belge taraması'), L(lang, 'A real scanned document/plate (user/source provided).', 'Gerçek taranmış belge/levha (kullanıcı/kaynak sağlar).'),
      L(lang, 'An illustrative document/manuscript texture — never implies real provenance.', 'Açıklayıcı belge/elyazması dokusu — gerçek köken asla ima etmez.'), 'archive-document-frame', '3:2',
      { required: true, priority: 'high', extraSafety: [L(lang, 'No fake provenance/institution/source claim.', 'Sahte köken/kurum/kaynak iddiası yok.')] });
    add('hero-background', 'global', 'css-placeholder', L(lang, 'Paper texture background', 'Kağıt doku arka planı'), L(lang, 'A composed CSS/SVG paper texture.', 'Kompoze CSS/SVG kağıt dokusu.'),
      L(lang, 'A subtle paper/plate texture composed in CSS/SVG.', 'CSS/SVG ile oluşturulmuş ince kağıt/levha dokusu.'), 'ambient-background', '21:9', { priority: 'low' });
  } else if (isCommerce) {
    const cat = sectionFor(/catalog|listings?|product\s*grid|shop|browse|katalog|ürün/i);
    add('product-listing-image', cat || 'hero', 'manual-upload', L(lang, 'Product listing images', 'Ürün ilan görselleri'), L(lang, 'Real product photos (seller-provided).', 'Gerçek ürün fotoğrafları (satıcı sağlar).'),
      L(lang, 'Clean product-on-neutral photography — generic objects, no brand.', 'Nötr zeminde temiz ürün fotoğrafı — genel nesneler, marka yok.'), 'catalog-card', '1:1', { required: true, priority: 'high', extraSafety: [L(lang, 'No fake exact specs/prices/brand imagery.', 'Sahte kesin özellik/fiyat/marka görseli yok.')], sourceSlotId: firstAdSlotFor(['gallery-image', 'catalog']) });
    add('catalog-cover', 'hero', 'provider-ready', L(lang, 'Catalog cover image', 'Katalog kapak görseli'), L(lang, 'An illustrative catalog hero.', 'Açıklayıcı bir katalog hero.'),
      L(lang, 'An illustrative editorial product-collection scene, abstract, no brand.', 'Açıklayıcı editoryal ürün-koleksiyon sahnesi, soyut, marka yok.'), 'large-hero-frame', '16:9', { priority: 'medium', providerReady: true });
  } else if (isPortfolioAgency) {
    const work = sectionFor(/work|projects?|portfolio|case|çalışma|proje|portföy/i);
    add('portfolio-work-image', work || 'hero', 'manual-upload', L(lang, 'Work / project images', 'Çalışma / proje görselleri'), L(lang, 'The creator\'s real work (user-provided).', 'Yaratıcının gerçek çalışması (kullanıcı sağlar).'),
      L(lang, 'The creator\'s real project imagery (user-provided). No fake client work.', 'Yaratıcının gerçek proje görselleri (kullanıcı sağlar). Sahte müşteri işi yok.'), 'gallery-grid', '4:3', { required: true, priority: 'high', sourceSlotId: firstAdSlotFor(['gallery-image', 'work']) });
    add('abstract-brand-image', 'hero', 'provider-ready', L(lang, 'Abstract brand image', 'Soyut marka görseli'), L(lang, 'An illustrative abstract brand visual.', 'Açıklayıcı soyut marka görseli.'),
      L(lang, 'An abstract editorial brand shape/gradient scene, no text, no logo.', 'Soyut editoryal marka şekli/gradyan sahnesi, metin yok, logo yok.'), 'large-hero-frame', '3:2', { priority: 'medium', providerReady: true });
  } else if (isSaaS) {
    // AI/SaaS: never fake screenshots — prefer abstract/ambient/product-scene only.
    add('abstract-brand-image', 'hero', 'provider-ready', L(lang, 'Abstract brand hero image', 'Soyut marka hero görseli'), L(lang, 'An illustrative abstract product ambience (not a real UI).', 'Açıklayıcı soyut ürün atmosferi (gerçek arayüz değil).'),
      L(lang, 'Abstract premium product ambience — glowing mesh/depth, brand accent, NO real UI, no people.', 'Soyut premium ürün atmosferi — parlayan ağ/derinlik, marka vurgusu, gerçek arayüz YOK, insan yok.'), 'large-hero-frame', '16:9',
      { priority: 'medium', providerReady: true, extraSafety: [L(lang, 'No fake product screenshot/dashboard/metrics — the real UI stays a CSS/SVG mockup.', 'Sahte ürün ekran görüntüsü/panel/metrik yok — gerçek arayüz CSS/SVG mockup olarak kalır.')], sourceSlotId: firstAdSlotFor(['hero-visual']) });
    add('illustrative-product-scene', 'global', 'css-placeholder', L(lang, 'Ambient product background', 'Atmosferik ürün arka planı'), L(lang, 'A composed CSS/SVG ambient background.', 'Kompoze CSS/SVG atmosferik arka plan.'),
      L(lang, 'A restrained ambient gradient/mesh background composed in CSS/SVG.', 'CSS/SVG ile oluşturulmuş ölçülü atmosferik gradyan/ağ arka planı.'), 'ambient-background', '21:9', { priority: 'low' });
  } else {
    add('abstract-brand-image', 'hero', 'css-placeholder', L(lang, 'Hero brand image', 'Hero marka görseli'), L(lang, 'A composed CSS/SVG hero visual.', 'Kompoze CSS/SVG hero görseli.'),
      L(lang, 'A concept-specific abstract brand image composed in CSS/SVG, no stock photos.', 'CSS/SVG ile oluşturulmuş konsepte özgü soyut marka görseli, stok fotoğraf yok.'), 'large-hero-frame', '16:9', { priority: 'medium' });
  }

  const manualUploadSlots = slots.filter((s) => s.source === 'manual-upload').map((s) => s.id);
  const providerReadySlots = slots.filter((s) => s.source === 'provider-ready').map((s) => s.id);
  const promptReadySlots = slots.filter((s) => s.source === 'prompt-ready').map((s) => s.id);
  const cssPlaceholderSlots = slots.filter((s) => s.source === 'css-placeholder').map((s) => s.id);

  const readyForProvider = providerReadySlots.length > 0 || promptReadySlots.length > 0;
  const recommendedProviderType: ImagePipelineArtifact['providerReadiness']['recommendedProviderType'] =
    manualUploadSlots.length && manualUploadSlots.length >= providerReadySlots.length ? 'manual-upload'
      : readyForProvider ? (isLocal || isCommerce ? 'stock-search' : 'image-generation')
        : manualUploadSlots.length ? 'manual-upload' : 'none';

  const imageStrategy = isLocal || isPortfolioAgency
    ? L(lang, 'Real photos are the user\'s to provide (manual-upload); illustrative provider images only for mood/background.', 'Gerçek fotoğrafları kullanıcı sağlar (manuel-yükleme); açıklayıcı sağlayıcı görselleri yalnızca atmosfer/arka plan için.')
    : isSaaS
      ? L(lang, 'No fake screenshots: real UI stays a CSS/SVG mockup; only abstract/ambient illustrative image slots.', 'Sahte ekran görüntüsü yok: gerçek arayüz CSS/SVG mockup kalır; yalnızca soyut/atmosferik açıklayıcı görsel alanları.')
      : isArchive
        ? L(lang, 'Documents are manual-upload or CSS placeholder — never implied real provenance.', 'Belgeler manuel-yükleme veya CSS yer tutucu — gerçek köken asla ima edilmez.')
        : L(lang, 'Real proof photos manual-upload; illustrative provider images clearly labelled.', 'Gerçek kanıt fotoğrafları manuel-yükleme; açıklayıcı sağlayıcı görselleri net etiketli.');

  const forbiddenImageContent = uniq([
    L(lang, 'Logos, brand names, real company marks.', 'Logolar, marka adları, gerçek şirket işaretleri.'),
    L(lang, 'Fake testimonials, metrics, certificates or compliance badges.', 'Sahte referans, metrik, sertifika veya uyumluluk rozeti.'),
    L(lang, 'Real identifiable people or copyrighted characters/styles.', 'Gerçek tanınabilir kişiler veya telifli karakter/stil.'),
    L(lang, 'UI screenshots implying real production data.', 'Gerçek üretim verisi ima eden arayüz ekran görüntüleri.'),
    L(lang, 'Medical/legal/financial proof imagery unless user-provided.', 'Kullanıcı sağlamadıkça tıbbi/hukuki/finansal kanıt görseli.'),
    ...(isLocal ? [L(lang, 'Fabricated before/after or fake awards/reviews.', 'Uydurma önce/sonra veya sahte ödül/yorum.')] : []),
  ]);

  return {
    status: slots.length ? 'planned' : 'partial',
    imageStrategy,
    styleConsistencyRules: uniq([
      styleBase,
      L(lang, 'One palette + light direction across all images.', 'Tüm görsellerde tek palet + ışık yönü.'),
      L(lang, 'Consistent aspect ratios per role; no text baked into images.', 'Rol başına tutarlı en-boy oranı; görsele gömülü metin yok.'),
      L(lang, 'Generated imagery is illustrative-only unless the user supplies real assets.', 'Kullanıcı gerçek varlık sağlamadıkça üretilen görsel yalnızca açıklayıcıdır.'),
    ]),
    slots,
    manualUploadSlots,
    providerReadySlots,
    promptReadySlots,
    cssPlaceholderSlots,
    forbiddenImageContent,
    generatedImagePolicy: L(lang,
      'No image is generated or uploaded in this phase. Slots are provider-ready plans + honest placeholders; any future generated image is illustrative-only; real proof photos are manual-upload.',
      'Bu aşamada görsel üretilmez veya yüklenmez. Alanlar sağlayıcıya hazır planlar + dürüst yer tutuculardır; gelecekte üretilen görsel yalnızca açıklayıcıdır; gerçek kanıt fotoğrafları manuel-yüklemedir.'),
    providerReadiness: {
      readyForProvider,
      recommendedProviderType,
      reason: L(lang,
        `${manualUploadSlots.length} manual-upload · ${providerReadySlots.length} provider-ready · ${cssPlaceholderSlots.length} CSS placeholder. No provider is called in this phase; video is out of scope.`,
        `${manualUploadSlots.length} manuel-yükleme · ${providerReadySlots.length} sağlayıcıya-hazır · ${cssPlaceholderSlots.length} CSS yer tutucu. Bu aşamada sağlayıcı çağrılmaz; video kapsam dışı.`),
    },
    summary: L(lang,
      `Planned ${slots.length} image slot(s) for a ${siteType} site (${manualUploadSlots.length} upload · ${providerReadySlots.length} provider · ${cssPlaceholderSlots.length} CSS). No images generated/uploaded; honest, illustrative-only.`,
      `${siteType} sitesi için ${slots.length} görsel alanı planlandı (${manualUploadSlots.length} yükleme · ${providerReadySlots.length} sağlayıcı · ${cssPlaceholderSlots.length} CSS). Görsel üretilmedi/yüklenmedi; dürüst, yalnızca açıklayıcı.`),
  };
}

/** Fail-open Image Pipeline artifact — a valid, empty-but-honest plan. */
function failedOpenImagePipeline(lang: Lang): ImagePipelineArtifact {
  return {
    status: 'failed-open',
    imageStrategy: L(lang, 'Image planning failed open — the Preview keeps its existing CSS/SVG visuals.', 'Görsel planlaması açık başarısız oldu — Önizleme mevcut CSS/SVG görsellerini korur.'),
    styleConsistencyRules: [], slots: [], manualUploadSlots: [], providerReadySlots: [], promptReadySlots: [], cssPlaceholderSlots: [],
    forbiddenImageContent: [L(lang, 'No fake logos/metrics/testimonials/proof.', 'Sahte logo/metrik/referans/kanıt yok.')],
    generatedImagePolicy: L(lang, 'No image generated or uploaded (failed open).', 'Görsel üretilmedi veya yüklenmedi (açık başarısız).'),
    providerReadiness: { readyForProvider: false, recommendedProviderType: 'none', reason: L(lang, 'No image plan produced (failed open).', 'Görsel planı üretilmedi (açık başarısız).') },
    summary: L(lang, 'Image Pipeline failed open; no image slots; Preview unaffected.', 'Görsel Pipeline açık başarısız oldu; görsel alanı yok; Önizleme etkilenmedi.'),
  };
}

/**
 * Run the Image Pipeline. Fully guarded: on any error it fails OPEN — a valid,
 * honest, empty plan — so it can never block Preview / All Files.
 */
export function runImagePipeline(input: ImagePipelineInput): { agent: WebBuildAgent; artifact: ImagePipelineArtifact } {
  const lang = input.lang || 'en';
  const name = L(lang, 'Image Pipeline', 'Görsel Pipeline');
  const activity = L(lang, 'Planning image slots (manual-upload / provider-ready; no images generated)', 'Görsel alanları planlanıyor (manuel-yükleme / sağlayıcıya-hazır; görsel üretilmedi)');
  try {
    const artifact = deriveImagePipeline(input);
    return { agent: { id: 'image_pipeline', name, status: 'done', summary: artifact.summary, currentActivity: activity, artifact }, artifact };
  } catch {
    const artifact = failedOpenImagePipeline(lang);
    return { agent: { id: 'image_pipeline', name, status: 'failed', summary: artifact.summary, currentActivity: activity, artifact }, artifact };
  }
}

/* ── Fixer Agent (Phase 6) — safe reviewer-driven repairs ───────────────────
 * The first Fixer runs AFTER the Reviewer. It consumes the Reviewer artifact and
 * applies a NARROW set of SAFE, deterministic repairs to the FINAL build data
 * (generated files + section items). It NEVER redesigns, NEVER invents
 * content/metrics/proof/sources, records every applied AND refused change, and
 * fails OPEN — so Preview / All Files always render (unchanged when it can't
 * safely help). It is intentionally conservative "v1": only the three safe
 * repair categories below; everything broader is recorded as refused. */

/** The section/file shape the Fixer reads and returns (structurally compatible
 *  with the payload's WebBuildSectionItem — avoids importing the payload module). */
export interface FixerSectionItem {
  id: string;
  name: string;
  headline?: string;
  sub?: string;
  cta?: string;
  bullets?: string[];
}

export interface FixerInput {
  prompt: string;
  brief: WebBuildBrief;
  reviewer: ReviewerAgentArtifact | undefined;
  /** Final section list actually rendered/generated. */
  sectionItems: FixerSectionItem[];
  /** Final generated files (path + content) the Fixer may sanitize. */
  files: Array<{ path: string; content: string }>;
  /** Art direction the Fixer may safely re-assert on concept drift (Phase 5). */
  artDirection?: ArtDirectionArtifact;
  /** Concept Authority used to pick the correct archetype / asset plan on drift. */
  conceptAuthority?: ConceptAuthority;
  /** Quality Director issues + rewrite guidance the Fixer consumes (Phase 7A). */
  qualityDirector?: QualityDirectorArtifact;
  /** The primary conversion intent (for normalizing awkward CTA labels). */
  primaryConversionIntent?: string;
  /** The strategic decision (Phase 8A) — names forbidden generic labels + the
   *  concept-specific labels the Fixer may safely swap them for. */
  ledger?: StrategicThinkingLedger;
  /** Experience Blueprint (Phase 9D-2) — its site type drives the non-SaaS proof/
   *  local-business copy guard (Phase 9D-2B). Optional → old builds behave as before. */
  experienceBlueprint?: ExperienceBlueprint;
  lang?: Lang;
}

export interface FixerResult {
  agent: WebBuildAgent;
  artifact: FixerAgentArtifact;
  /** Possibly-updated section list (usually unchanged in v1). */
  sectionItems: FixerSectionItem[];
  /** Possibly-sanitized files (same shape in → out). */
  files: Array<{ path: string; content: string }>;
  /** Concept-drift-corrected art direction (undefined when unchanged). */
  artDirection?: ArtDirectionArtifact;
}

/** The safe repair categories this v1 Fixer is allowed to perform. */
const FIXER_SAFE_SCOPE = ['fake-data', 'placeholder-cleanup', 'cta-anchor', 'concept-drift', 'visual-asset-plan', 'copy-label', 'cta-consistency', 'flow-label', 'concept-label', 'public-copy', 'content-depth', 'demo-copy', 'non-saas-copy', 'hero-quote', 'visual-direction', 'palette-family', 'accent-strategy', 'anti-template-copy'];

/** Intent → clean CTA label (Phase 7A) — mirrors the Preview's normalizeCtaLabel. */
function ctaFromIntent(intent: string | undefined, lang: Lang): string | undefined {
  const s = (intent || '').toLowerCase();
  if (/free\s*trial|try|get\s*started|start\s*free|\bfree\b/.test(s)) return L(lang, 'Get started free', 'Ücretsiz başla');
  if (/book\s*demo|schedule/.test(s)) return L(lang, 'Book a demo', 'Demo ayarla');
  if (/contact\s*sales|talk|contact/.test(s)) return L(lang, 'Contact sales', 'Satışla iletişime geç');
  if (/quote/.test(s)) return L(lang, 'Request a quote', 'Teklif iste');
  if (/browse|catalog|inventory/.test(s)) return L(lang, 'Browse catalog', 'Kataloğa göz at');
  if (/access|research/.test(s)) return L(lang, 'Request access', 'Erişim iste');
  if (/learn\s*more|how\s*it\s*works/.test(s)) return L(lang, 'See how it works', 'Nasıl çalıştığını gör');
  return undefined;
}

/** Broad changes the Fixer explicitly REFUSES (reserved for later phases). */
function fixerRefusedScope(lang: Lang): string[] {
  return [
    L(lang, 'section-architecture rewrite', 'bölüm mimarisi yeniden yazımı'),
    L(lang, 'full redesign / new visual system', 'tam yeniden tasarım / yeni görsel sistem'),
    L(lang, 'new pages or routing illusion', 'yeni sayfalar veya yönlendirme yanılsaması'),
    L(lang, 'new motion system', 'yeni hareket sistemi'),
    L(lang, 'fabricated testimonials / prices / ratings / logos / sources', 'uydurma referanslar / fiyatlar / puanlar / logolar / kaynaklar'),
    L(lang, 'preview renderer / All Files architecture changes', 'önizleme oluşturucu / Tüm Dosyalar mimarisi değişiklikleri'),
  ];
}

interface FixerToken { id: string; re: RegExp; label: [string, string] }

/** Unsupported proof/metric fingerprints → neutral STRUCTURAL labels (never
 *  another fake metric). Mirrors the Reviewer's fake-data guard so a re-review
 *  would pass. Applied to generated FILE CONTENT only. */
const FIXER_FAKE_TOKENS: FixerToken[] = [
  { id: '₺199 price', re: /₺\s?199/g, label: ['Clear comparison', 'Net karşılaştırma'] },
  { id: '₺120 price', re: /₺\s?120/g, label: ['Clear comparison', 'Net karşılaştırma'] },
  { id: '4.9★ rating', re: /4\.9\s*★/g, label: ['Verified proof', 'Doğrulanmış kanıt'] },
  { id: '12k+ count', re: /12\s?k\s?\+/gi, label: ['Verified proof', 'Doğrulanmış kanıt'] },
  { id: '2.4k metric', re: /\b2\.4k\b/gi, label: ['Verified proof', 'Doğrulanmış kanıt'] },
  { id: '+37% delta', re: /\+\s?37\s?%/g, label: ['Verified proof', 'Doğrulanmış kanıt'] },
  { id: 'SOC2 claim', re: /\bsoc\s?2\b/gi, label: ['Security review', 'Güvenlik incelemesi'] },
  { id: '98% stat', re: /\b98\s?%/g, label: ['Verified proof', 'Doğrulanmış kanıt'] },
  { id: '24/7 claim', re: /\b24\s?\/\s?7\b/g, label: ['Documented process', 'Belgelenmiş süreç'] },
  { id: 'uptime claim', re: /\buptime\b/gi, label: ['Security review', 'Güvenlik incelemesi'] },
];

/** Entity-count fabrications — ONLY when a fabricated count precedes the entity
 *  word, so honest copy that merely mentions "customers/clients" is never
 *  garbled (never remove clearly user-provided content). */
const FIXER_ENTITY_COUNT: FixerToken[] = [
  { id: 'customer count', re: /\b\d[\d.,]*\s?k?\+?\s+customers\b/gi, label: ['Project evidence', 'Proje kanıtı'] },
  { id: 'client count', re: /\b\d[\d.,]*\s?k?\+?\s+clients\b/gi, label: ['Project evidence', 'Proje kanıtı'] },
  { id: 'müşteri count', re: /\b\d[\d.,]*\s?k?\+?\s+müşteri\b/gi, label: ['Project evidence', 'Proje kanıtı'] },
];

/** Empty/placeholder visual-module fingerprints → concept-neutral labels. */
const FIXER_PLACEHOLDER_STR: FixerToken[] = [
  { id: 'lorem ipsum', re: /lorem ipsum[^<>"'\n]*/gi, label: ['Concept detail', 'Konsept ayrıntısı'] },
  { id: 'placeholder testimonial', re: /\b(?:Customer|Müşteri)\s*(?:Name|Ad[ıi]|#?\s?\d+)\b/gi, label: ['Project reference', 'Proje referansı'] },
];

/** Apply one deterministic repair; capture the first before/after sample. The
 *  replacement may be a string or a function (regex must be global). */
function applyRepair(
  content: string,
  re: RegExp,
  rep: string | ((m: string, ...g: string[]) => string),
): { content: string; hit: boolean; before?: string; after?: string } {
  let before: string | undefined;
  let after: string | undefined;
  const next = content.replace(re, (m: string, ...g: string[]) => {
    const out = typeof rep === 'function' ? rep(m, ...g) : rep;
    if (before === undefined) { before = m; after = out; }
    return out;
  });
  return { content: next, hit: next !== content, before, after };
}

/** HONEST failed-open Fixer artifact — nothing changed, build continues. */
function failedOpenFixer(lang: Lang): FixerAgentArtifact {
  return {
    status: 'failed-open', appliedChanges: [], skippedChanges: [],
    consumedReviewerFindings: [], consumedFixInstructions: [],
    safeRepairScope: FIXER_SAFE_SCOPE, refusedScope: fixerRefusedScope(lang),
    summary: L(lang,
      'Fixer failed open; build continued unchanged (Preview and All Files intact).',
      'Düzeltici güvenli şekilde durdu; yapı değişmeden devam etti (Önizleme ve Tüm Dosyalar korundu).'),
  };
}

/**
 * Derive the Fixer artifact + possibly-sanitized files/sections from the real
 * reviewer findings and generated data only. Pure and deterministic. Applies
 * ONLY the three safe repair categories; records everything broader as refused.
 */
export function deriveFixer(input: FixerInput): { artifact: FixerAgentArtifact; sectionItems: FixerSectionItem[]; files: Array<{ path: string; content: string }>; artDirection?: ArtDirectionArtifact } {
  const lang = input.lang || 'en';
  const applied: FixerAppliedChange[] = [];
  const skipped: FixerSkippedChange[] = [];
  let aid = 0;
  let skid = 0;
  const addApplied = (category: string, target: string, before: string | undefined, after: string | undefined, reason: string) => {
    applied.push({ id: `fx-${aid += 1}`, category, target, before, after, reason });
  };
  const addSkipped = (category: string, reason: string, target?: string) => {
    skipped.push({ id: `fs-${skid += 1}`, category, target, reason });
  };

  const reviewer = input.reviewer;
  const findings = Array.isArray(reviewer?.findings) ? reviewer!.findings : [];
  const criticalFakeData = findings.some((f) => f.severity === 'critical' && f.category === 'fake-data');
  const flaggedArchitecture = findings.some((f) => f.category === 'concept-fit' || f.category === 'section-architecture');
  const consumedReviewerFindings = uniq(findings.map((f) => f.title)).slice(0, 12);
  const consumedFixInstructions = Array.isArray(reviewer?.fixInstructions) ? reviewer!.fixInstructions.slice(0, 6) : [];

  // Guard: a token the user literally wrote is user-provided → never touch it.
  const promptLc = (input.prompt || '').toLowerCase();
  const userProvided = (re: RegExp): boolean => new RegExp(re.source, re.flags.replace('g', '')).test(promptLc);

  // Operate on copies so the caller's arrays are never mutated in place.
  const files = input.files.map((f) => ({ path: f.path, content: f.content || '' }));
  const sectionItems = input.sectionItems.map((s) => ({ ...s }));

  const runTokenPass = (tokens: FixerToken[], category: string, reason: string) => {
    for (const tok of tokens) {
      if (userProvided(tok.re)) {
        addSkipped(category, L(lang,
          `"${tok.id}" appears in the user prompt — treated as user-provided and left untouched.`,
          `"${tok.id}" kullanıcı isteminde geçiyor — kullanıcı içeriği kabul edilip değiştirilmedi.`), tok.id);
        continue;
      }
      const label = L(lang, tok.label[0], tok.label[1]);
      for (const f of files) {
        const res = applyRepair(f.content, tok.re, label);
        if (res.hit) { addApplied(category, f.path, res.before, res.after, reason); f.content = res.content; }
      }
    }
  };

  // 1 — Fake metric/proof token cleanup (always in scope). Prioritized when the
  //     Reviewer raised a CRITICAL fake-data finding.
  runTokenPass(FIXER_FAKE_TOKENS, 'fake-data',
    L(lang, 'Replaced an unsupported proof/metric token with a neutral structural label.',
      'Desteklenmeyen kanıt/metrik ifadesini nötr yapısal bir etiketle değiştirdi.'));
  runTokenPass(FIXER_ENTITY_COUNT, 'fake-data',
    L(lang, 'Replaced a fabricated entity-count claim with a neutral structural label.',
      'Uydurma müşteri/istemci sayısı ifadesini nötr yapısal bir etiketle değiştirdi.'));

  if (criticalFakeData) {
    // A critical fake-data finding → limit THIS pass to fake-data only (no broad
    // redesign or other repairs mixed in). Record the deferrals honestly.
    addSkipped('placeholder-cleanup', L(lang,
      'Reviewer raised a critical fake-data issue; limited this pass to fake-data cleanup only.',
      'Reviewer kritik bir sahte veri sorunu bildirdi; bu geçiş yalnızca sahte veri temizliği ile sınırlandı.'));
    addSkipped('cta-anchor', L(lang,
      'Deferred CTA-anchor repair while prioritizing the critical fake-data cleanup.',
      'Kritik sahte veri temizliğine öncelik verilirken CTA bağlantı düzeltmesi ertelendi.'));
  } else {
    // 2 — Empty/placeholder visual-module cleanup.
    const placeholderReason = L(lang,
      'Replaced a placeholder/filler label with a concept-neutral label (no invented entities).',
      'Yer tutucu/dolgu etiketini konsept-nötr bir etiketle değiştirdi (uydurma varlık yok).');
    runTokenPass(FIXER_PLACEHOLDER_STR, 'placeholder-cleanup', placeholderReason);
    // Repeated "Item/Feature/Card/Metric N" → keep the index, drop the generic
    // noun so cards stop reading as scaffolding (function replacer keeps N).
    const highlight = L(lang, 'Highlight', 'Öne çıkan');
    for (const f of files) {
      const res = applyRepair(f.content, /\b(?:Item|Feature|Card|Metric)\s+(\d+)\b/g, (_m: string, n: string) => `${highlight} ${n}`);
      if (res.hit) { addApplied('placeholder-cleanup', f.path, res.before, res.after, placeholderReason); f.content = res.content; }
    }

    // 3 — CTA anchor sanity. Dead host-like paths → in-page hash anchors, ONLY
    //     when a matching section id exists. External URLs are never touched; no
    //     window.location / router is introduced.
    const sectionIds = sectionItems.map((s) => s.id).filter(Boolean);
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const matchSection = (seg: string): string | undefined => {
      const t = norm(seg);
      if (!t) return undefined;
      return sectionIds.find((id) => { const nid = norm(id); return nid === t || nid.includes(t) || t.includes(nid); });
    };
    const DEAD_SEG = /^(pricing|price|contact|how-it-works|about|features|services)$/i;
    const anchorReason = L(lang,
      'Rewrote a dead host-like link to an in-page section anchor (matching section id found).',
      'Ölü/ana-uygulama benzeri bağlantıyı eşleşen bölüm kimliğine sahip sayfa içi çapaya dönüştürdü.');
    for (const f of files) {
      const res = applyRepair(f.content, /href=(["'])([^"']*)\1/gi, (m: string, q: string, val: string) => {
        if (/^(https?:|mailto:|tel:|#|\/\/)/i.test(val) || val.includes('://')) return m;
        const seg = val.replace(/^\/+/, '').split(/[/?#]/).filter(Boolean).pop() || '';
        if (!DEAD_SEG.test(seg)) return m;
        const sec = matchSection(seg);
        if (!sec) return m;
        return `href=${q}#${sec}${q}`;
      });
      if (res.hit) { addApplied('cta-anchor', f.path, res.before, res.after, anchorReason); f.content = res.content; }
    }
  }

  // 4 — Concept-drift + visual-asset-plan repair (Phase 5). SAFE, artifact-level:
  //     re-assert the primary-concept archetype when the target vertical overrode
  //     it, and add a missing Visual Asset Plan. Never invents copy/metrics/assets,
  //     never rewrites the site — it only corrects design DATA in the artifacts.
  let artDirection: ArtDirectionArtifact | undefined;
  const authority = input.conceptAuthority || input.artDirection?.conceptAuthority;
  const driftFinding = findings.find((f) => f.category === 'concept-drift');
  const assetMissing = findings.some((f) => f.category === 'missing-asset-plan');
  if (input.artDirection && (driftFinding || assetMissing)) {
    let art = input.artDirection;
    let artChanged = false;

    // 4a — Re-assert the primary-concept archetype on a flagged concept drift.
    if (driftFinding && authority && authority.primaryConcept !== 'marketplace') {
      const expected = CATEGORY_TO_ARCHETYPE[authority.primaryConcept];
      const spec = expected ? DESIGN_ARCHETYPES[expected] : undefined;
      const currentKey = art.designArchetype?.key;
      if (spec && currentKey && currentKey !== spec.key) {
        const corrected: DesignArchetype = {
          name: L(lang, spec.name[0], spec.name[1]),
          key: spec.key,
          reason: L(lang, spec.reason[0], spec.reason[1]),
          avoidGenericSaas: spec.avoidGenericSaas,
          archetypeTags: spec.tags,
        };
        art = { ...art, designArchetype: corrected, correctedConceptDrift: true, conceptAuthority: authority };
        artChanged = true;
        addApplied('concept-drift', 'artDirection.designArchetype', currentKey, spec.key,
          L(lang, `Re-asserted the "${authority.primaryConcept}" primary-concept archetype after a target-vertical drift (no redesign, no invented content).`,
            `Hedef-dikey kaymasından sonra "${authority.primaryConcept}" birincil-konsept arketipi yeniden uygulandı (yeniden tasarım yok, uydurma içerik yok).`));
      }
    }

    // 4b — Add a missing Visual Asset Plan (DATA ONLY; no image/video API call).
    if (!art.visualAssetPlan?.assetSlots?.length) {
      try {
        const specKey = (authority && CATEGORY_TO_ARCHETYPE[authority.primaryConcept]) || art.designArchetype?.key || 'modern-brand';
        const spec = DESIGN_ARCHETYPES[specKey] || DESIGN_ARCHETYPES['modern-brand'];
        const plan = deriveVisualAssetPlan(spec, authority, undefined, art.colorSystem, lang);
        art = { ...art, visualAssetPlan: plan };
        artChanged = true;
        addApplied('visual-asset-plan', 'artDirection.visualAssetPlan', undefined, plan.heroVisualType,
          L(lang, 'Added a concept-specific Visual Asset Plan (CSS/SVG now, external image/video reserved for a later phase).',
            'Konsepte özgü bir Görsel Varlık Planı eklendi (şimdi CSS/SVG, harici görsel/video sonraki aşamaya ayrıldı).'));
      } catch { /* non-blocking */ }
    }

    if (artChanged) artDirection = art;
  }

  // 4c — Anti-template visual repair (Phase 7B). SAFE, ARTIFACT-LEVEL ONLY: when
  //      the Quality Director flags same-template / accent-overuse / dashboard /
  //      palette-mismatch, switch the SELECTED visual direction + palette family +
  //      accent to a more differentiated one. Never touches component architecture,
  //      never fabricates data/logos/metrics, never invents images.
  const qdIssues = input.qualityDirector?.issues || [];
  const antiFlags = qdIssues.filter((i) => ['same-template-risk', 'accent-overuse', 'dashboard-overuse', 'palette-mismatch', 'visual-monotony'].includes(i.category));
  const forbidsFakeProof = /no\s+(fake\s+)?(metric|logo|testimonial|social\s*proof)|without\s+(metric|logo|testimonial)|don'?t\s+(add|invent|use|include)\s+(metric|logo|testimonial|fake)|sahte\s+(metrik|logo|referans|veri)|metrik\s+yok|logo\s+yok|uydurma\s+(metrik|logo|referans)/.test(promptLc);
  const honestyImplied = qdIssues.some((i) => i.category === 'honesty-risk');
  if (input.artDirection && (antiFlags.length || (forbidsFakeProof && honestyImplied))) {
    let art = artDirection || input.artDirection;
    let artChanged = false;
    const explo = art.visualExploration;
    const currentFam = (art.paletteFamily || art.colorSystem?.paletteName || '').toLowerCase();

    if (antiFlags.length) {
      // Prefer a candidate that is genuinely different — a LIGHT one first (breaks
      // the always-dark complaint), then the "unexpected" direction, then any
      // other candidate; finally a deterministic differentiated family.
      const better = explo?.candidates.find((c) => c.paletteFamily && PALETTE_FAMILIES[c.paletteFamily as PaletteFamily]?.light && c.paletteFamily.toLowerCase() !== currentFam)
        || explo?.candidates.find((c) => c.id === 'unexpected' && (c.paletteFamily || '').toLowerCase() !== currentFam)
        || explo?.candidates.find((c) => c.paletteFamily && c.paletteFamily.toLowerCase() !== currentFam);
      let newFam = better?.paletteFamily as PaletteFamily | undefined;
      if (!newFam) {
        newFam = selectPaletteFamily({ prompt: input.prompt, concept: authority?.primaryConcept, vertical: authority?.targetVertical, visualMood: 'restrained differentiated calmer' });
        if (newFam.toLowerCase() === currentFam) newFam = 'porcelain-blue';
      }
      if (newFam && newFam.toLowerCase() !== currentFam) {
        const spec = PALETTE_FAMILIES[newFam];
        const beforeFam = art.paletteFamily || art.colorSystem?.paletteName || 'default';
        const beforeAccent = art.colorSystem?.accent || '';
        const newColor = { ...art.colorSystem, background: spec.bg, accent: spec.accent, accent2: spec.accent2, primary: spec.accent, secondary: spec.accent2, paletteName: newFam };
        const newExplo = (explo && better)
          ? { ...explo, selectedCandidateId: better.id, rejectedCandidateIds: explo.candidates.filter((c) => c.id !== better.id).map((c) => c.id), selectionReason: L(lang, `Fixer switched to the more differentiated "${newFam}" direction after an anti-template flag.`, `Düzeltici, anti-şablon işaretinden sonra daha farklılaşmış "${newFam}" yönüne geçti.`) }
          : explo;
        art = { ...art, colorSystem: newColor, paletteFamily: newFam, visualExploration: newExplo, correctedAntiTemplateDrift: true };
        artChanged = true;
        addApplied('palette-family', 'artDirection.paletteFamily', String(beforeFam), newFam,
          L(lang, `Switched to a more differentiated palette family "${newFam}" (${spec.light ? 'lighter, calmer' : 'distinct'}, restrained accent) to break the default dark/gold/dashboard look.`,
            `Varsayılan koyu/altın/panel görünümünü kırmak için daha farklılaşmış "${newFam}" palet ailesine geçildi (${spec.light ? 'daha açık, sakin' : 'belirgin'}, ölçülü vurgu).`));
        if (better) addApplied('visual-direction', 'artDirection.visualExploration.selectedCandidateId', explo?.selectedCandidateId || '', better.id,
          L(lang, 'Selected a more differentiated explored visual direction.', 'Daha farklılaşmış, keşfedilmiş bir görsel yön seçildi.'));
        if (beforeAccent && beforeAccent.toLowerCase() !== spec.accent.toLowerCase()) addApplied('accent-strategy', 'artDirection.colorSystem.accent', beforeAccent, spec.accent,
          L(lang, 'Demoted a loud/gold accent to a restrained one.', 'Gürültülü/altın vurgu, ölçülü bir vurguya çekildi.'));
      }
    }

    // Strip metrics/logos/SOC2 visual+copy bias from the artifacts when the user
    // forbids fake proof (artifact strings only — never rewrites the whole site).
    if (forbidsFakeProof) {
      const safeTrust = L(lang, 'Security posture, integration clarity and workflow transparency — no fabricated metrics, logos or testimonials.',
        'Güvenlik duruşu, entegrasyon netliği ve iş akışı şeffaflığı — uydurma metrik, logo veya referans yok.');
      const biasRe = /logos?|soc\s*2|soc2|uptime|customer metrics|müşteri metrik|testimonial|referans/i;
      if (art.trustVisualDirection && biasRe.test(art.trustVisualDirection)) {
        const before = art.trustVisualDirection;
        art = { ...art, trustVisualDirection: safeTrust, correctedAntiTemplateDrift: true };
        artChanged = true;
        addApplied('anti-template-copy', 'artDirection.trustVisualDirection', before, safeTrust,
          L(lang, 'Removed fabricated logos/SOC2/metrics trust bias because the user forbade fake proof.',
            'Kullanıcı sahte kanıtı yasakladığı için uydurma logo/SOC2/metrik güven yanlılığı kaldırıldı.'));
      }
      if ((art.proofRules || []).some((r) => biasRe.test(r))) {
        const cleaned = (art.proofRules || []).map((r) => biasRe.test(r) ? safeTrust : r);
        art = { ...art, proofRules: uniq(cleaned), correctedAntiTemplateDrift: true };
        artChanged = true;
        addApplied('anti-template-copy', 'artDirection.proofRules', 'metrics/logos/SOC2', 'security/integration/workflow',
          L(lang, 'Replaced fabricated proof rules (logos/SOC2/metrics) with honest, structural proof language.',
            'Uydurma kanıt kuralları (logo/SOC2/metrik) dürüst, yapısal kanıt diliyle değiştirildi.'));
      }
    }

    if (artChanged) artDirection = art;
  }

  // 5 — Quality Director copy/label/CTA repairs (Phase 7A). SAFE, DISPLAY-ONLY:
  //     clean raw/model-internal section labels + awkward CTAs, and differentiate
  //     repeated "Product demo" labels. Never invents content, never touches
  //     factual claims, generated React architecture, or network behaviour.
  const qd = input.qualityDirector;
  const qualityApplied: FixerAppliedChange[] = [];
  const qualitySkipped: FixerSkippedChange[] = [];
  let qaid = 0;
  const addQuality = (category: string, target: string, before: string, after: string, reason: string) => {
    qualityApplied.push({ id: `qx-${qaid += 1}`, category, target, before, after, reason });
  };
  const intentCta = ctaFromIntent(input.primaryConversionIntent, lang);
  for (const s of sectionItems) {
    if (isAwkwardLabel(s.name)) {
      const cleaned = cleanPublicLabel(s.name);
      if (cleaned && cleaned !== s.name) {
        addQuality('copy-label', s.id, s.name, cleaned,
          L(lang, 'Rewrote a raw/model-internal section label into a short human label (display only).',
            'Ham/model-içi bölüm etiketini kısa insan-okur etikete çevirdi (yalnızca görünüm).'));
        s.name = cleaned;
      }
    }
    if (s.cta && isAwkwardLabel(s.cta)) {
      const cleanedCta = (intentCta && intentCta.length <= MAX_LABEL_LEN) ? intentCta : cleanPublicLabel(s.cta);
      if (cleanedCta && cleanedCta !== s.cta) {
        addQuality('cta-consistency', s.id, s.cta, cleanedCta,
          L(lang, 'Normalized an awkward CTA label to a clean, consistent action (display only).',
            'Beceriksiz bir CTA etiketini temiz, tutarlı bir eyleme normalize etti (yalnızca görünüm).'));
        s.cta = cleanedCta;
      }
    }
  }
  // Differentiate repeated "Product demo" labels (2nd+ → neutral flow labels that
  // don't fabricate a specific content type).
  const FLOW_RENAMES = [L(lang, 'How it works', 'Nasıl çalışır'), L(lang, 'Use cases', 'Kullanım senaryoları'), L(lang, 'Product tour', 'Ürün turu')];
  let demoSeen = 0; let flowIdx = 0;
  for (const s of sectionItems) {
    if (/^product\s*demo$/i.test((s.name || '').trim())) {
      demoSeen += 1;
      if (demoSeen > 1 && flowIdx < FLOW_RENAMES.length) {
        const before = s.name;
        const label = FLOW_RENAMES[flowIdx];
        flowIdx += 1;
        addQuality('flow-label', s.id, before, label,
          L(lang, 'Renamed a repeated "Product demo" label to a clearer flow label.',
            'Tekrar eden "Product demo" etiketini daha net bir akış etiketine dönüştürdü.'));
        s.name = label;
      }
    }
  }
  // 5b — Concept-specific label repair (Phase 8A). Replace generic service-agency
  //      filler section labels the Thinking Ledger forbids with the ledger's
  //      honest, concept-specific labels. SAFE + DISPLAY-ONLY: never invents
  //      metrics/logos/claims, never touches user-written labels, never changes ids.
  const ledger = input.ledger;
  if (ledger && ledger.forbiddenGenericLabels.length && ledger.preferredSectionLabels.length) {
    const forbidden = new Set(ledger.forbiddenGenericLabels.map((x) => x.toLowerCase()));
    const used = new Set(sectionItems.map((s) => (s.name || '').trim().toLowerCase()));
    let pick = 0;
    const nextLabel = (): string | undefined => {
      while (pick < ledger.preferredSectionLabels.length) {
        const cand = ledger.preferredSectionLabels[pick]; pick += 1;
        if (cand && !used.has(cand.toLowerCase())) { used.add(cand.toLowerCase()); return cand; }
      }
      return undefined;
    };
    for (const s of sectionItems) {
      const nm = (s.name || '').trim().toLowerCase();
      if (!nm || !forbidden.has(nm)) continue;
      if (promptLc.includes(nm)) {
        qualitySkipped.push({ id: `qs-cl-${s.id}`, category: 'concept-label', target: s.id, reason: L(lang,
          `"${s.name}" appears in the user prompt — treated as user-provided and left untouched.`,
          `"${s.name}" kullanıcı isteminde geçiyor — kullanıcı içeriği kabul edilip değiştirilmedi.`) });
        continue;
      }
      const label = nextLabel();
      if (!label) break;
      addQuality('concept-label', s.id, s.name, label,
        L(lang, 'Replaced a generic service-agency filler label with a concept-specific label (display only; no invented content).',
          'Genel ajans-hizmet dolgu etiketini konsepte özgü bir etiketle değiştirdi (yalnızca görünüm; uydurma içerik yok).'));
      s.name = label;
    }
  }

  // 5c — Public-copy quality repair (Phase 9C-1). Internal category/planning
  //      language and generic SaaS filler must NEVER surface as visible copy.
  //      Repairs DISPLAY fields only (name/headline/sub/cta/bullets), honestly (no
  //      invented metrics/logos/claims). Concept-specific maps apply for AI-chatbot
  //      /ecommerce; a universal internal-category cleanup applies to any concept.
  const pcVertical = `${ledger?.targetVertical || authority?.targetVertical || authority?.audienceVertical || ''} ${promptLc}`.toLowerCase();
  const pcIsCommerce = /ecommerce|e-?commerce|commerce|storefront|\bstore\b|\bshop\b|retail|marketplace|mağaza|e-?ticaret/.test(pcVertical);
  // Phase 12F — the shopping-assistant / storefront-chat copy repairs apply ONLY to a
  // genuine explicit chat product for commerce, never to any AI/SaaS with a store vertical.
  const aiCommerce = hasExplicitChatIntent(promptLc) && pcIsCommerce;
  const nameMap: Record<string, string> = aiCommerce ? {
    'ai product / saas': L(lang, 'AI Shopping Assistant', 'AI Alışveriş Asistanı'),
    'ai tool / productivity': L(lang, 'Storefront Chat Automation', 'Mağaza Sohbet Otomasyonu'),
    'product proof (demo/screens), metrics and security': L(lang, 'Demo, Integrations & Trust', 'Demo, Entegrasyon ve Güven'),
    'product demo': L(lang, 'Chat Experience', 'Sohbet Deneyimi'),
    'how it works': L(lang, 'How the Assistant Handles a Shopper', 'Asistan Bir Müşteriyi Nasıl Karşılar'),
    'discovery': L(lang, 'Understands the Question', 'Soruyu Anlar'),
    'plan': L(lang, 'Finds the Right Product', 'Doğru Ürünü Bulur'),
    'delivery': L(lang, 'Guides the Next Step', 'Sonraki Adıma Yönlendirir'),
    'support': L(lang, 'Hands Off to Your Team', 'Ekibinize Devreder'),
    'features': L(lang, 'What the Assistant Can Do', 'Asistan Neler Yapabilir'),
    'integrations': L(lang, 'Store Integrations', 'Mağaza Entegrasyonları'),
    'security': L(lang, 'Security Controls', 'Güvenlik Kontrolleri'),
    'contact': L(lang, 'Contact Sales', 'Satışla İletişim'),
  } : {};
  const ctaMap: Record<string, string> = aiCommerce ? {
    'experience the chatbot': L(lang, 'Try the Demo', 'Demoyu Dene'),
    'get started': L(lang, 'Try the Demo', 'Demoyu Dene'),
    'learn more': L(lang, 'See How It Works', 'Nasıl Çalıştığını Gör'),
    'explore features': L(lang, 'See Chat Flow', 'Sohbet Akışını Gör'),
  } : {};
  // Universal internal-category → neutral (ANY concept) so planning language never
  // leaks even when the concept isn't AI-commerce.
  const internalNeutral: Array<[RegExp, string]> = [
    [/product\s*proof\s*\(demo\/screens?\)\s*,?\s*metrics?\s+and\s+security/i, L(lang, 'Demo & Trust', 'Demo ve Güven')],
    [/\bai\s*product\s*\/\s*saas\b/i, L(lang, 'Product overview', 'Ürüne genel bakış')],
    [/\bai\s*tool\s*\/\s*productivity\b/i, L(lang, 'Product overview', 'Ürüne genel bakış')],
    [/\bproduct\s*proof\b/i, L(lang, 'Proof', 'Kanıt')],
    [/\bmetrics?\s+and\s+security\b/i, L(lang, 'Security', 'Güvenlik')],
  ];
  const heroRepair = (v: string): string | undefined => {
    if (!aiCommerce || !HERO_FORMULA_RE.test(v)) return undefined;
    if (/transform\s+your\b.*\bwith\b.*\b(ai\s*chatbot|chatbot|assistant|ai)\b/i.test(v))
      return L(lang, 'Help shoppers choose faster with an AI storefront assistant', 'Alışverişçilerin daha hızlı seçim yapmasına AI mağaza asistanıyla yardım edin');
    if (/revolutioni[sz]e\b.*(support|customer)/i.test(v))
      return L(lang, 'Answer product questions before shoppers leave', 'Alışverişçiler ayrılmadan önce ürün sorularını yanıtlayın');
    return L(lang, 'Answer product questions and guide shoppers in chat', 'Ürün sorularını yanıtlayın ve alışverişçileri sohbette yönlendirin');
  };
  const pcReason = L(lang, 'Replaced internal/generic public copy with concept-specific, honest copy (display only).',
    'İç/genel herkese açık metni konsepte özgü, dürüst metinle değiştirdi (yalnızca görünüm).');
  const repairPublicLabel = (val: string): string | undefined => {
    const key = normLabel(val);
    if (nameMap[key]) return nameMap[key];
    for (const [re, rep] of internalNeutral) if (re.test(val)) return rep;
    return undefined;
  };
  for (const s of sectionItems) {
    if (s.name && !promptLc.includes(normLabel(s.name))) {
      const r = repairPublicLabel(s.name);
      if (r && r !== s.name) { addQuality('public-copy', s.id, s.name, r, pcReason); s.name = r; }
    }
    if (s.headline) {
      const hr = heroRepair(s.headline) || repairPublicLabel(s.headline);
      if (hr && hr !== s.headline) { addQuality('public-copy', s.id, s.headline, hr, pcReason); s.headline = hr; }
    }
    if (s.sub) {
      const sr = heroRepair(s.sub);
      if (sr && sr !== s.sub) { addQuality('public-copy', s.id, s.sub, sr, pcReason); s.sub = sr; }
    }
    if (s.cta && !promptLc.includes(normLabel(s.cta))) {
      const cr = ctaMap[normLabel(s.cta)];
      if (cr && cr !== s.cta) { addQuality('public-copy', s.id, s.cta, cr, pcReason); s.cta = cr; }
    }
    if (aiCommerce && s.bullets?.length) {
      const nb = s.bullets.map((b) => nameMap[normLabel(b)] || b);
      if (nb.some((b, i) => b !== s.bullets![i])) {
        addQuality('public-copy', s.id, s.bullets.join(' · ').slice(0, 48), nb.join(' · ').slice(0, 48), pcReason);
        s.bullets = nb;
      }
    }
  }

  // 5c-2 — NON-SAAS PROOF & LOCAL-BUSINESS COPY GUARD (Phase 9D-2B). For a NON-SaaS
  //        site type (landscaping/local-business, restaurant, portfolio, agency,
  //        event, publication, store/marketplace) SaaS/product-proof language must
  //        not leak into public copy. DISPLAY-ONLY (name/headline/sub/cta/bullets);
  //        ids/routes/files untouched. Honest: unsupported proof is neutralized to
  //        project/process/service copy, never fabricated. Only replaces a field
  //        that IS (nearly) the leak — never rewrites a legitimate sentence.
  const bpType = input.experienceBlueprint?.siteExperienceType;
  const NON_SAAS_TYPES = new Set(['local-business', 'restaurant', 'portfolio', 'agency-service', 'event-landing', 'content-publication', 'ecommerce-store', 'marketplace']);
  if (bpType && NON_SAAS_TYPES.has(bpType)) {
    const isRestaurant = bpType === 'restaurant';
    const isPortfolio = bpType === 'portfolio';
    const isAgency = bpType === 'agency-service';
    const providedProof = /testimonial|case\s*stud|customer\s*review|reference\s*(client|customer)|client\s*logo/.test(promptLc);
    const asksIntegrations = /integration|\bapi\b|connect|webhook|zapier|entegrasyon/.test(promptLc);
    const nsReason = L(lang, 'Neutralized SaaS/product-proof language for a non-SaaS site — honest project/service copy (display only, no fabricated proof).',
      'SaaS/ürün-kanıt dilini SaaS olmayan bir site için nötrleştirdi — dürüst proje/hizmet metni (yalnızca görünüm, uydurma kanıt yok).');

    // Local/service CTAs — blueprint CTAs win; else per-type defaults.
    const primaryLocalCta = input.experienceBlueprint?.primaryCTA
      || (isRestaurant ? L(lang, 'Reserve a Table', 'Masa Ayırt') : isPortfolio ? L(lang, 'View Work', 'Çalışmaları Gör') : isAgency ? L(lang, 'Start a Project', 'Projeye Başla') : L(lang, 'Get a Quote', 'Teklif Al'));
    const secondaryLocalCta = input.experienceBlueprint?.secondaryCTA
      || (isRestaurant ? L(lang, 'View Menu', 'Menüyü Gör') : isPortfolio ? L(lang, 'Contact', 'İletişim') : isAgency ? L(lang, 'See Work', 'Çalışmaları Gör') : L(lang, 'View Projects', 'Projeleri Gör'));

    // Whole-value PROOF-leak phrase → honest replacement (most-specific first).
    const leakRepairs: Array<[RegExp, string]> = [
      [/product\s*proof\s*\(\s*demo\s*\/\s*screens?\s*\)\s*,?\s*metrics?\s+and\s+security/i, L(lang, 'Project gallery, materials and service details', 'Proje galerisi, malzemeler ve hizmet detayları')],
      [/certifications?\s*,?\s*specs?\s+and\s+reference\s+clients?/i, providedProof ? L(lang, 'Credentials, process and project details', 'Belgeler, süreç ve proje detayları') : L(lang, 'Credentials, process and local project details', 'Belgeler, süreç ve yerel proje detayları')],
      [/\bproduct\s*proof\b/i, L(lang, 'Our work', 'Çalışmalarımız')],
      [/\bmetrics?\s+and\s+security\b/i, L(lang, 'Materials and service details', 'Malzemeler ve hizmet detayları')],
      [/\bdashboard\s+preview\b/i, L(lang, 'Project preview', 'Proje önizlemesi')],
      [/\btrusted\s+by\s+(thousands|millions|\d[\d,.]*)\+?/i, L(lang, 'Local projects and referrals', 'Yerel projeler ve tavsiyeler')],
    ];
    // Whole-label proof map (case studies / testimonials / reference clients /
    // product demo) — matched on the normalized value.
    const proofLabelMap: Record<string, string> = {
      'case studies': L(lang, 'Projects', 'Projeler'),
      'case study': L(lang, 'Projects', 'Projeler'),
      'testimonials': providedProof ? L(lang, 'Client Notes', 'Müşteri Notları') : L(lang, 'Project Notes', 'Proje Notları'),
      'reference clients': L(lang, 'Recent Projects', 'Son Projeler'),
      'product demo': isPortfolio ? L(lang, 'Project Preview', 'Proje Önizlemesi') : L(lang, 'Before / After', 'Önce / Sonra'),
      'dashboard preview': L(lang, 'Project preview', 'Proje önizlemesi'),
    };
    // Replace ONLY when the field IS (nearly) the whole leak, so legitimate
    // sentences are never rewritten. Whole-label map first, then whole-value regex.
    const repairWholeLeak = (v: string): string | undefined => {
      const key = normLabel(v);
      if (proofLabelMap[key]) return proofLabelMap[key];
      for (const [re, rep] of leakRepairs) {
        const m = v.match(re);
        if (m && m[0].trim().length >= v.trim().length - 3) return rep;
      }
      return undefined;
    };
    // Non-proof SaaS labels → local/service labels (name / bullet only).
    const serviceLabelMap: Record<string, string> = {
      'features': isRestaurant ? L(lang, 'Menu', 'Menü') : L(lang, 'Services', 'Hizmetler'),
      'how it works': isRestaurant || isPortfolio || isAgency ? L(lang, 'How it works', 'Nasıl çalışır') : L(lang, 'How the project works', 'Proje nasıl ilerler'),
      'integrations': asksIntegrations ? '' : L(lang, 'Materials & Planning', 'Malzemeler ve Planlama'),
      'security': L(lang, 'What to Expect', 'Neler Beklemeli'),
      'security & trust': L(lang, 'What to Expect', 'Neler Beklemeli'),
    };
    const ctaMapNS: Record<string, string> = {
      'continue': primaryLocalCta,
      'get started': primaryLocalCta,
      'start free trial': primaryLocalCta,
      'sign up': primaryLocalCta,
      'try it free': primaryLocalCta,
      'book a demo': primaryLocalCta,
      'learn more': secondaryLocalCta,
      'read more': secondaryLocalCta,
    };
    const byId = new Map(sectionItems.map((s) => [s.id, s] as const));

    // (a) Repair DETECTED proof leaks in their own field (detector is the source of
    //     truth for what counts as leaked proof; only whole-value leaks are repaired).
    for (const leak of detectNonSaaSProofLeaks(sectionItems, { providedProof })) {
      const s = byId.get(leak.sectionId);
      if (!s) continue;
      const rep = repairWholeLeak(leak.text);
      if (!rep) continue;
      if (leak.field === 'name' && s.name === leak.text && !promptLc.includes(normLabel(s.name))) { addQuality('non-saas-copy', s.id, s.name, rep, nsReason); s.name = rep; }
      else if (leak.field === 'headline' && s.headline === leak.text) { addQuality('non-saas-copy', s.id, s.headline, rep, nsReason); s.headline = rep; }
      else if (leak.field === 'sub' && s.sub === leak.text) { addQuality('non-saas-copy', s.id, s.sub, rep, nsReason); s.sub = rep; }
      else if (leak.field === 'cta' && s.cta === leak.text) { addQuality('non-saas-copy', s.id, s.cta, rep, nsReason); s.cta = rep; }
      else if (leak.field === 'bullet' && s.bullets) {
        const i = s.bullets.indexOf(leak.text);
        if (i >= 0) { const before = s.bullets.join(' · ').slice(0, 48); s.bullets[i] = rep; addQuality('non-saas-copy', s.id, before, s.bullets.join(' · ').slice(0, 48), nsReason); }
      }
    }

    // (b) Strip hero quotes (Task 3) + normalize SaaS labels/CTAs to local/service.
    for (const s of sectionItems) {
      if (s.headline) {
        const unq = stripWrappingQuotes(s.headline);
        if (unq !== s.headline) { addQuality('hero-quote', s.id, s.headline, unq, L(lang, 'Stripped wrapping quotation marks from the hero headline (display only).', 'Hero başlığından saran tırnak işaretlerini kaldırdı (yalnızca görünüm).')); s.headline = unq; }
      }
      if (s.name && !promptLc.includes(normLabel(s.name))) {
        const r = serviceLabelMap[normLabel(s.name)];
        if (r && r !== s.name) { addQuality('non-saas-copy', s.id, s.name, r, nsReason); s.name = r; }
      }
      if (s.cta && !promptLc.includes(normLabel(s.cta))) {
        const cr = ctaMapNS[normLabel(s.cta)];
        if (cr && cr !== s.cta) { addQuality('non-saas-copy', s.id, s.cta, cr, nsReason); s.cta = cr; }
      }
      if (s.bullets?.length) {
        const nb = s.bullets.map((b) => (promptLc.includes(normLabel(b)) ? b : (serviceLabelMap[normLabel(b)] || b)));
        if (nb.some((b, i) => b !== s.bullets![i])) {
          addQuality('non-saas-copy', s.id, s.bullets.join(' · ').slice(0, 48), nb.join(' · ').slice(0, 48), nsReason);
          s.bullets = nb;
        }
      }
    }
  }

  // 5d — Content-depth repair (Phase 9C-2). Generic business-template FILLER,
  //      "future/AI" hero formulas, generic demo copy and unsupported proof must
  //      not survive as final copy. DISPLAY-ONLY (name/headline/sub/cta/bullets);
  //      concept-specific for AI-commerce. Honest: never invents metrics/logos/
  //      testimonials/certifications; preserves user-provided brand/product wording.
  // Distinctive user terms (brand/product/domain words the user actually wrote) are
  // preserved: a field carrying one is never wholesale-replaced.
  const CD_STOP = new Set(['with', 'your', 'the', 'and', 'for', 'from', 'that', 'this', 'into', 'using', 'built', 'make', 'made', 'more', 'get', 'all', 'you', 'our', 'are', 'ai', 'chatbot', 'chat', 'bot', 'assistant', 'agent', 'ecommerce', 'commerce', 'store', 'stores', 'shop', 'shops', 'shopping', 'shopper', 'shoppers', 'product', 'products', 'saas', 'platform', 'tool', 'tools', 'website', 'site', 'app', 'apps', 'integration', 'integrations', 'customer', 'customers', 'support', 'demo', 'demos', 'online', 'premium', 'modern', 'clean', 'simple', 'fast', 'reliable', 'quality', 'experience', 'solution', 'solutions', 'service', 'services', 'business', 'team', 'teams', 'sales', 'pricing', 'contact', 'security', 'trust', 'feature', 'features', 'learn', 'start', 'create', 'build', 'company', 'brand', 'answer', 'answers', 'question', 'questions', 'için', 'mağaza', 'ürün', 'müşteri', 'sohbet', 'asistan']);
  const cdUserTerms = uniq(promptLc.split(/[^a-zA-Z0-9ğüşöçıİ]+/).map((w) => w.toLowerCase()).filter((w) => w.length >= 4 && !CD_STOP.has(w)));
  const cdHasUserTerm = (v: string): boolean => { const lv = v.toLowerCase(); return cdUserTerms.some((t) => lv.includes(t)); };
  const cdReason = L(lang, 'Replaced generic template copy with concept-specific, honest copy (display only; no invented proof).',
    'Genel şablon metnini konsepte özgü, dürüst metinle değiştirdi (yalnızca görünüm; uydurma kanıt yok).');
  const nameDepthMap: Record<string, string> = aiCommerce ? {
    'process': L(lang, 'Shopper Flow', 'Alışverişçi Akışı'),
    'discovery': L(lang, 'Understands the Question', 'Soruyu Anlar'),
    'plan': L(lang, 'Finds the Right Product', 'Doğru Ürünü Bulur'),
    'delivery': L(lang, 'Guides the Next Step', 'Sonraki Adıma Yönlendirir'),
    'support': L(lang, 'Hands Off to Your Team', 'Ekibinize Devreder'),
    'case studies': L(lang, 'Use Cases', 'Kullanım Senaryoları'),
    'testimonials': L(lang, 'Customer Questions', 'Müşteri Soruları'),
    'certifications': L(lang, 'Security & Store Trust', 'Güvenlik ve Mağaza Güveni'),
    'reference clients': L(lang, 'Security & Store Trust', 'Güvenlik ve Mağaza Güveni'),
    'certifications, specs and reference clients': L(lang, 'Security & Store Trust', 'Güvenlik ve Mağaza Güveni'),
    'interactive demo': L(lang, 'Sample Chat Flow', 'Örnek Sohbet Akışı'),
  } : {};
  const ctaDepthMap: Record<string, string> = aiCommerce ? {
    'learn more': L(lang, 'See Chat Flow', 'Sohbet Akışını Gör'),
    'get started': L(lang, 'Try the Demo', 'Demoyu Dene'),
    'experience the chatbot': L(lang, 'Try the Demo', 'Demoyu Dene'),
  } : {};
  const bulletDepthMap: Record<string, string> = aiCommerce ? {
    'fast & reliable': L(lang, 'Answers common product and policy questions instantly with sample storefront knowledge', 'Yaygın ürün ve politika sorularını örnek mağaza bilgisiyle anında yanıtlar'),
    'fast and reliable': L(lang, 'Answers common product and policy questions instantly with sample storefront knowledge', 'Yaygın ürün ve politika sorularını örnek mağaza bilgisiyle anında yanıtlar'),
    'made for your goals': L(lang, 'Guides shoppers from question to product recommendation without leaving the page', 'Alışverişçileri sayfadan ayrılmadan sorudan ürün önerisine yönlendirir'),
    'simple to start': L(lang, 'Connects to the idea of store catalog, policy and support flows as a front-end demo', 'Mağaza kataloğu, politika ve destek akışlarına ön-yüz demosu olarak bağlanır'),
    'premium quality': L(lang, 'Keeps the experience calm, branded and conversion-focused', 'Deneyimi sakin, markalı ve dönüşüm odaklı tutar'),
    'built for everyone': L(lang, 'Works across product, shipping, returns and support questions', 'Ürün, kargo, iade ve destek sorularında çalışır'),
    'everything you need': L(lang, 'Covers product discovery, policy answers and human handoff', 'Ürün keşfi, politika yanıtları ve insana devri kapsar'),
    'powerful features': L(lang, 'Understands intent, recommends products and hands off to your team', 'Niyeti anlar, ürün önerir ve ekibinize devreder'),
    'all-in-one': L(lang, 'Product questions, recommendations and support handoff in one chat', 'Tek sohbette ürün soruları, öneriler ve destek devri'),
  } : {};
  const cdHeroRepair = (v: string): string | undefined => {
    if (!aiCommerce || cdHasUserTerm(v)) return undefined;
    if (!DEEP_HERO_RE.test(v) && !HERO_FORMULA_RE.test(v)) return undefined;
    if (/future of ai|future of\b.*integration|experience the future/i.test(v))
      return L(lang, 'Help shoppers choose faster with an AI storefront assistant', 'Alışverişçilerin daha hızlı seçim yapmasına AI mağaza asistanıyla yardım edin');
    return L(lang, 'Answer product questions and guide shoppers in chat', 'Ürün sorularını yanıtlayın ve alışverişçileri sohbette yönlendirin');
  };
  const cdSubRepair = (v: string): string | undefined => {
    if (!aiCommerce || cdHasUserTerm(v) || !GENERIC_DEMO_RE.test(v)) return undefined;
    return L(lang, 'Preview a sample storefront chat flow: product questions, recommendations, policy answers and human handoff.',
      'Örnek bir mağaza sohbet akışını önizleyin: ürün soruları, öneriler, politika yanıtları ve insana devir.');
  };
  const cdProofNeutral = L(lang, 'Security controls and honest store trust — no fabricated metrics or logos', 'Güvenlik kontrolleri ve dürüst mağaza güveni — uydurma metrik veya logo yok');
  for (const s of sectionItems) {
    if (s.name && !promptLc.includes(normLabel(s.name))) {
      const r = nameDepthMap[normLabel(s.name)];
      if (r && r !== s.name) { addQuality('content-depth', s.id, s.name, r, cdReason); s.name = r; }
    }
    if (s.headline) {
      const hr = cdHeroRepair(s.headline);
      if (hr && hr !== s.headline) { addQuality('content-depth', s.id, s.headline, hr, cdReason); s.headline = hr; }
    }
    if (s.sub) {
      const sr = cdHeroRepair(s.sub) || cdSubRepair(s.sub);
      if (sr && sr !== s.sub) { addQuality('content-depth', s.id, s.sub, sr, cdReason); s.sub = sr; }
    }
    if (s.cta && !promptLc.includes(normLabel(s.cta))) {
      const cr = ctaDepthMap[normLabel(s.cta)];
      if (cr && cr !== s.cta) { addQuality('content-depth', s.id, s.cta, cr, cdReason); s.cta = cr; }
    }
    if (aiCommerce && s.bullets?.length) {
      const nb = s.bullets.map((b) => {
        const mapped = bulletDepthMap[normLabel(b)];
        if (mapped) return mapped;
        if (UNSUPPORTED_PROOF_RE.test(b) && !cdHasUserTerm(b)) return cdProofNeutral;
        return b;
      });
      if (nb.some((b, i) => b !== s.bullets![i])) {
        addQuality('content-depth', s.id, s.bullets.join(' · ').slice(0, 48), nb.join(' · ').slice(0, 48), cdReason);
        s.bullets = nb;
      }
    }
  }

  // 5e — Demo-surface copy consumption guard (Phase 9C-3). The preview demo teaser,
  //      Product Demo screen, hero and nav all CONSUME the section items — so a final
  //      display-only sanitize here fixes every surface at once. Catches the generic
  //      demo phrases 5d missed ("Experience Seamless Integration with Our Interactive
  //      Demo", "Explore features…in real-time", "Experience the Demo", plus residual
  //      generic bullets). DISPLAY-ONLY; honest; preserves user-verbatim labels.
  const dsReason = L(lang, 'Sanitized generic demo-surface copy into concept-specific, honest copy (display only; no invented proof).',
    'Genel demo yüzeyi metnini konsepte özgü, dürüst metinle temizledi (yalnızca görünüm; uydurma kanıt yok).');
  for (const s of sectionItems) {
    if (s.name && !promptLc.includes(normLabel(s.name))) {
      const r = sanitizeDemoSurfaceCopy(s.name, { aiCommerce, lang });
      if (r && r !== s.name) { addQuality('demo-copy', s.id, s.name, r, dsReason); s.name = r; }
    }
    if (s.headline) {
      const r = sanitizeDemoSurfaceCopy(s.headline, { aiCommerce, lang });
      if (r && r !== s.headline) { addQuality('demo-copy', s.id, s.headline, r, dsReason); s.headline = r; }
    }
    if (s.sub) {
      const r = sanitizeDemoSurfaceCopy(s.sub, { aiCommerce, lang });
      if (r && r !== s.sub) { addQuality('demo-copy', s.id, s.sub, r, dsReason); s.sub = r; }
    }
    if (s.cta && !promptLc.includes(normLabel(s.cta))) {
      const r = sanitizeDemoSurfaceCopy(s.cta, { aiCommerce, lang });
      if (r && r !== s.cta) { addQuality('demo-copy', s.id, s.cta, r, dsReason); s.cta = r; }
    }
    if (aiCommerce && s.bullets?.length) {
      const nb = s.bullets.map((b) => sanitizeDemoSurfaceCopy(b, { aiCommerce, lang }) || b);
      if (nb.some((b, i) => b !== s.bullets![i])) {
        addQuality('demo-copy', s.id, s.bullets.join(' · ').slice(0, 48), nb.join(' · ').slice(0, 48), dsReason);
        s.bullets = nb;
      }
    }
  }

  const consumedQualityIssues = uniq((qd?.issues || [])
    .filter((i) => ['raw-label', 'cta-inconsistency', 'generic-copy', 'flow-confusion', 'demo-unclear'].includes(i.category))
    .map((i) => `${i.id}:${i.category}`)).slice(0, 16);
  if (qd && !qualityApplied.length && (qd.issues || []).some((i) => i.category === 'raw-label' || i.category === 'cta-inconsistency')) {
    qualitySkipped.push({ id: 'qs-1', category: 'copy-label', reason: L(lang,
      'Quality Director flagged label/CTA issues, but no awkward public label/CTA was safely repairable on the section items.',
      'Kalite Direktörü etiket/CTA sorunları bildirdi, ancak bölüm öğelerinde güvenle düzeltilebilir beceriksiz etiket/CTA bulunamadı.') });
  }

  // REFUSALS — always record the broad scope the Fixer will not touch, plus a
  // concrete refusal when the Reviewer flagged a structural/concept issue.
  if (flaggedArchitecture) {
    addSkipped('section-architecture', L(lang,
      'Skipped broad architecture rewrite; reserved for a future architecture-fixer phase.',
      'Geniş mimari yeniden yazımı atlandı; gelecekteki bir mimari düzeltme aşamasına bırakıldı.'), 'sectionItems');
  }

  const totalApplied = applied.length + qualityApplied.length;
  const status: FixerStatus = totalApplied > 0 ? 'applied' : 'no-op';
  let summary: string;
  if (totalApplied > 0) {
    const cats = uniq([...applied, ...qualityApplied].map((c) => c.category)).join(', ');
    summary = L(lang,
      `Fixer applied ${totalApplied} safe repair${totalApplied === 1 ? '' : 's'} (${cats}); no redesign or invented content.`,
      `Düzeltici ${totalApplied} güvenli düzeltme uyguladı (${cats}); yeniden tasarım veya uydurma içerik yok.`);
  } else {
    summary = L(lang,
      'Fixer no-op: reviewer/quality director found no safe v1 repair scope in this build.',
      'Düzeltici işlem yapmadı: reviewer/kalite direktörü bu yapıda güvenli v1 düzeltme kapsamı bulmadı.');
  }

  const artifact: FixerAgentArtifact = {
    status, appliedChanges: applied, skippedChanges: skipped,
    consumedReviewerFindings, consumedFixInstructions,
    safeRepairScope: FIXER_SAFE_SCOPE, refusedScope: fixerRefusedScope(lang),
    consumedQualityIssues,
    qualityAppliedChanges: qualityApplied,
    qualitySkippedChanges: qualitySkipped,
    summary,
  };
  return { artifact, sectionItems, files, artDirection };
}

/**
 * Run the Fixer Agent. Fully guarded: on any error it fails OPEN — a fixer row
 * with status 'failed' + a safe 'failed-open' artifact, and the ORIGINAL
 * sections/files are returned unchanged. Never required for Preview / All Files.
 */
export function runFixer(input: FixerInput): FixerResult {
  const lang = input.lang || 'en';
  const name = L(lang, 'Fixer Agent', 'Düzeltici Ajan');
  const activity = L(lang, 'Applying safe reviewer-driven repairs', 'Reviewer kaynaklı güvenli düzeltmeler uygulanıyor');
  try {
    const { artifact, sectionItems, files, artDirection } = deriveFixer(input);
    // 'applied' and 'no-op' both ran cleanly → 'done'; only fail-open is 'failed'.
    return { agent: { id: 'fixer', name, status: 'done', summary: artifact.summary, currentActivity: activity, artifact }, artifact, sectionItems, files, artDirection };
  } catch {
    const artifact = failedOpenFixer(lang);
    return { agent: { id: 'fixer', name, status: 'failed', summary: artifact.summary, currentActivity: activity, artifact }, artifact, sectionItems: input.sectionItems, files: input.files };
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
const WORKLOG_ORDER: AgentId[] = ['research', 'ui_art_director', 'strategy', 'layout_architect', 'component_engineer', 'reviewer', 'fixer'];
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
  designArchetype: ['design archetype', 'tasarım arketipi'],
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
          // The design archetype is the anti-sameness decision the Layout
          // Architect consumes — surface it first as the headline handoff field.
          a.designArchetype?.key ? L(lang, 'design archetype', 'tasarım arketipi') : '',
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
          s.websiteExperiencePlan ? L(lang, 'website experience plan', 'web deneyim planı') : '',
          s.interactionContract ? L(lang, 'interaction contract', 'etkileşim sözleşmesi') : '',
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
      case 'reviewer': {
        const rv = agent.artifact as ReviewerAgentArtifact;
        const n = Array.isArray(rv.findings) ? rv.findings.length : 0;
        return {
          message: rv.status === 'needs-fixes'
            ? L(lang, `flagged ${n} quality issue${n === 1 ? '' : 's'} for the Fixer`, `Düzeltici için ${n} kalite sorunu işaretledi`)
            : L(lang, 'reviewed quality — no blocking issues', 'kaliteyi inceledi — engelleyici sorun yok'),
          type: 'completed',
        };
      }
      case 'asset_director': {
        const a = agent.artifact as AssetDirectorArtifact;
        const n = Array.isArray(a.slots) ? a.slots.length : 0;
        if (a.status === 'failed-open') {
          return { message: L(lang, 'failed open — no assets planned', 'güvenli şekilde durdu — varlık planlanmadı'), type: 'fallback' };
        }
        return {
          message: n > 0
            ? L(lang, `planned ${n} visual asset slot${n === 1 ? '' : 's'} (no images generated)`, `${n} görsel varlık alanı planladı (görsel üretilmedi)`)
            : L(lang, 'planned visual assets', 'görsel varlıkları planladı'),
          type: 'completed',
        };
      }
      case 'motion_composer': {
        const m = agent.artifact as MotionComposerArtifact;
        const n = Array.isArray(m.layers) ? m.layers.length : 0;
        if (m.status === 'failed-open') {
          return { message: L(lang, 'failed open — no motion composed', 'güvenli şekilde durdu — hareket oluşturulmadı'), type: 'fallback' };
        }
        return {
          message: n > 0
            ? L(lang, `composed ${n} subtle motion layer${n === 1 ? '' : 's'} (reduced-motion safe, no video)`, `${n} ince hareket katmanı oluşturdu (reduced-motion güvenli, video yok)`)
            : L(lang, 'composed subtle motion', 'ince hareket oluşturdu'),
          type: 'completed',
        };
      }
      case 'image_pipeline': {
        const ip = agent.artifact as ImagePipelineArtifact;
        const n = Array.isArray(ip.slots) ? ip.slots.length : 0;
        if (ip.status === 'failed-open') {
          return { message: L(lang, 'failed open — no image slots planned', 'güvenli şekilde durdu — görsel alanı planlanmadı'), type: 'fallback' };
        }
        return {
          message: n > 0
            ? L(lang, `planned ${n} image slot${n === 1 ? '' : 's'} (no images generated/uploaded)`, `${n} görsel alanı planladı (görsel üretilmedi/yüklenmedi)`)
            : L(lang, 'planned image slots', 'görsel alanları planladı'),
          type: 'completed',
        };
      }
      case 'fixer': {
        const fx = agent.artifact as FixerAgentArtifact;
        const n = Array.isArray(fx.appliedChanges) ? fx.appliedChanges.length : 0;
        if (fx.status === 'failed-open') {
          return { message: L(lang, 'failed open — build kept unchanged', 'güvenli şekilde durdu — yapı değişmeden korundu'), type: 'fallback' };
        }
        return {
          message: n > 0
            ? L(lang, `applied ${n} safe repair${n === 1 ? '' : 's'}`, `${n} güvenli düzeltme uyguladı`)
            : L(lang, 'no-op — no safe repair in scope', 'işlem yok — kapsamda güvenli düzeltme yok'),
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
