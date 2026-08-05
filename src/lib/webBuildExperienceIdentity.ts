/* ────────────────────────────────────────────────────────────────────────────
 * webBuildExperienceIdentity.ts — EXPERIENCE IDENTITY & PRODUCT STORYTELLING
 *
 * Korvix already decides how a site LOOKS (visualConcept), how sections are laid
 * out (composition), what the tokens are (visualSystem), what each section SAYS
 * (contentNarrative), what must FUNCTION (bindingRequirements) and whether the
 * built markup passes cross-system experience checks (experienceQuality). What no
 * authority owned is the layer that makes a site feel like it could only belong to
 * THIS product: a single product-specific EXPERIENCE IDENTITY plus a deliberate
 * PRODUCT STORY — narrative architecture, product demonstration intent, a
 * category-true trust model, a recognizable signature behavior, and the emotional +
 * functional progression that ties them together.
 *
 * This module COMPOSES the already-derived contracts (no new model/network call)
 * into ONE bounded, deterministic ExperienceIdentityContract, renders a hard-bounded
 * builder block, and accepts only evidence-backed, non-duplicative defects (reusing
 * experienceQuality's ONE JSX scanner). Additive & optional everywhere; fails open.
 *
 * OWNERSHIP BOUNDARY (compose, never duplicate):
 *   • per-section message role / CTA role / proof mode  → contentNarrative
 *   • section family / order / rhythm / hero layout      → composition
 *   • colour/type/contrast/anti-slop tokens              → visualSystem
 *   • visual thesis / signature visual / image roles / motion technique → visualConcept
 *   • functional interaction requirements                → bindingRequirements
 *   • interaction/responsive/a11y/perf acceptance        → experienceQuality
 *   • required photo count                               → imageCoverage
 *   • fabricated-claim policy                            → research (we only add a
 *                                                          category disclaimer floor)
 * We add: experience thesis, product essence, audience transformation, experience
 * personality, brand-interaction principle, signature behavior, emotional + functional
 * progression, narrative architecture + story sequence, product-demonstration intent,
 * trust architecture (incl. a high-stakes disclaimer floor), microinteraction motifs,
 * distinctiveness, and story-level generic exclusions.
 *
 * Pure: no Date/Math.random/network/import(); JSON-safe; hard-bounded throughout.
 * ──────────────────────────────────────────────────────────────────────────── */
import type {
  FrontendSpecIdentity,
  FrontendGeneratedFile,
  FrontendBindingRequirements,
  FrontendBuilderReviewSeverity,
  FrontendBuilderReviewIssue,
  FrontendBuilderReviewCategory,
} from '@/lib/webBuildAgents';
import type { CompositionContract } from '@/lib/webBuildComposition';
import type { ContentNarrativeContract } from '@/lib/webBuildContentNarrative';
import type { ResearchDirectionContract } from '@/lib/webBuildResearchDirection';
import type { ImageCoverageRequirement } from '@/lib/webBuildImageCoverage';
import { classifyVisualCategory, type VisualCategory, type VisualConceptContract } from '@/lib/webBuildVisualConcept';
import { factsFor, type SectionFacts } from '@/lib/webBuildExperienceQuality';

/* ── Bounds ───────────────────────────────────────────────────────────────── */
const MAX_TEXT = 150;
const MAX_LIST = 8;
const MAX_ISSUES = 16;
const MAX_ISSUE_FILES = 4;
const MAX_EVIDENCE = 180;
const MAX_SCAN = 24_000;
const RENDER_CHAR_CEILING = 2600;   // documented hard ceiling for the rendered builder block

/* ── Public vocabulary ────────────────────────────────────────────────────── */
export type ExperiencePersonality =
  | 'calm-guided' | 'precise-technical' | 'expressive-cultural' | 'editorial-refined'
  | 'energetic-participatory' | 'trustworthy-clinical' | 'warm-human'
  | 'exclusive-cinematic' | 'pragmatic-operational' | 'experimental-intelligent';

export type TrustStakes = 'low' | 'moderate' | 'high' | 'regulated';

export type BusinessModelClass =
  | 'self-serve' | 'sales-led' | 'local-service' | 'transactional' | 'subscription'
  | 'luxury' | 'professional' | 'technical' | 'marketplace' | 'lead-gen' | 'general';

export type NarrativeArchitecture =
  | 'problem-transformation-proof-action' | 'product-first-demonstration' | 'editorial-discovery'
  | 'trust-first-explanation' | 'guided-decision-journey' | 'technical-evidence-journey'
  | 'before-after-transformation' | 'outcome-led' | 'community-identity' | 'lifestyle-aspiration'
  | 'process-transparency' | 'interactive-qualification' | 'comparison-led-education'
  | 'portfolio-craft' | 'service-reassurance';

export type DemonstrationPattern =
  | 'input-to-output-transformation' | 'scenario-calculator' | 'guided-intake' | 'threat-flow-visualization'
  | 'product-detail-reveal' | 'project-reveal' | 'spatial-atmosphere' | 'code-to-result-flow'
  | 'quote-flow' | 'guided-learning-path' | 'impact-forecast' | 'in-app-flow' | 'workflow-graph'
  | 'menu-exploration' | 'work-showcase' | 'guided-overview' | 'none';

export interface AudienceState { before: string; after: string; }

export interface ProductDemonstration {
  required: boolean;
  pattern: DemonstrationPattern;
  goal: string;
  userInput: string;
  visibleResponse: string;
  productState: string;
  feedback: string;
  successOutcome: string;
  fallback: string;
  mobile: string;
  accessibility: string;
  backendRequired: boolean;
  frontendSimOk: boolean;
  labelFictionalData: boolean;
  bindingRequirementId?: string;
}

export interface TrustArchitecture {
  stakes: TrustStakes;
  sources: string[];
  placement: string;
  disclaimersRequired: string[];
  forbiddenClaims: string[];
  testimonialsAppropriate: boolean;
  metricsAppropriate: boolean;
  labelFictionalExamples: boolean;
  copyTone: string;
}

export interface StorySequence {
  firstAfterHero: string;
  demonstrationStage: string;
  trustStage: string;
  climaxStage: string;
  pricingTiming: 'early' | 'late' | 'contextual' | 'none';
  testimonialsAppropriate: boolean;
  metricsAppropriate: boolean;
  strongestCtaStage: string;
  finalCtaTone: 'emotional' | 'functional' | 'low-risk';
}

export interface ExperienceIdentityContract {
  version: 'experience-identity-v1';
  status: 'derived' | 'legacy';
  category: VisualCategory;
  businessModelClass: BusinessModelClass;
  experienceThesis: string;
  productEssence: string;
  audienceState: AudienceState;
  personality: ExperiencePersonality;
  interactionPrinciple: string;
  signatureBehavior: string;
  emotionalProgression: string[];
  functionalProgression: string[];
  narrativeArchitecture: NarrativeArchitecture;
  storySequence: StorySequence;
  demonstration: ProductDemonstration;
  trust: TrustArchitecture;
  sectionBehaviors: string[];
  microMotifs: string[];
  differentiation: string;
  exclusions: string[];
  reasons: string[];
  /* ── Truthful consumption trace (mirrors peer contracts). ── */
  upstreamEvidenceUsedToDeriveContract: string[];
  contractPersistedInSpecification: boolean;
  contractRenderedToFrontendBuilder: boolean;
  contractUsedByAcceptance: boolean;
  agentsActuallyConsumingContract: string[];
}

export interface ExperienceIdentityInput {
  identity?: Partial<FrontendSpecIdentity> & { category?: string; name?: string };
  sections?: Array<{ id?: string; name?: string; purpose?: string; interactionHints?: string[] }>;
  demoSurfaces?: string[];
  statefulDemoComponents?: string[];
  composition?: CompositionContract;
  contentNarrative?: ContentNarrativeContract;
  research?: ResearchDirectionContract;
  binding?: FrontendBindingRequirements;
  imageCoverage?: ImageCoverageRequirement;
  visualConcept?: VisualConceptContract;
  prompt?: string;
}

/* ── Pure helpers ─────────────────────────────────────────────────────────── */
function clip(s: unknown, n = MAX_TEXT): string { return (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim().slice(0, n); }
function uniq<T>(a: T[]): T[] { return [...new Set(a)]; }
function capList<T>(a: T[] | undefined, n = MAX_LIST): T[] { return Array.isArray(a) ? a.slice(0, n) : []; }
function hashString(s: string): number { let h = 0x811c9dc5; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0); }
function pick<T>(cands: T[], seed: number, window = 3): T | undefined { const l = cands.filter((x) => x != null); if (!l.length) return undefined; return l[seed % Math.min(window, l.length)]; }

/* ── Business-model classification ────────────────────────────────────────── */
function businessModelClass(bm: string | undefined, cat: VisualCategory): BusinessModelClass {
  switch (bm) {
    case 'subscription-product': return 'subscription';
    case 'contact-sales-product': return 'sales-led';
    case 'quote-led-service': case 'service-booking': case 'appointment-led': case 'reservation-led': return 'local-service';
    case 'inventory-led-sales': case 'catalog-showroom': return 'transactional';
    case 'project-inquiry': case 'catalog-consultation': return 'professional';
    case 'two-sided-marketplace': return 'marketplace';
    case 'listing-lead-generation': return 'lead-gen';
    default: break;
  }
  // Fall back to the category when the business model is unknown.
  if (cat === 'software-saas' || cat === 'mobile-app') return 'self-serve';
  if (cat === 'developer-tool' || cat === 'security') return 'technical';
  if (cat === 'hospitality-luxury') return 'luxury';
  if (cat === 'ecommerce-fashion' || cat === 'food-restaurant') return 'transactional';
  if (cat === 'local-service') return 'local-service';
  if (cat === 'architecture' || cat === 'portfolio-creative') return 'professional';
  if (cat === 'b2b-enterprise' || cat === 'finance' || cat === 'healthcare') return 'sales-led';
  return 'general';
}

const REGULATED: Set<VisualCategory> = new Set(['finance', 'healthcare', 'security']);
const REGULATED_KEYWORDS = /\b(legal|law firm|attorney|lawyer|insurance|medical|clinical|diagnos|prescription|hipaa|gdpr|compliance|regulat|invest|securities|loan|mortgage|tax\b|fiduciary)/i;

function trustStakesFor(cat: VisualCategory, input: ExperienceIdentityInput): TrustStakes {
  const text = `${input.identity?.primaryConcept || ''} ${input.identity?.subsector || ''} ${input.prompt || ''}`;
  if (REGULATED.has(cat) || REGULATED_KEYWORDS.test(text)) return 'regulated';
  if (cat === 'b2b-enterprise' || cat === 'education' || cat === 'local-service') return 'high';
  if (cat === 'ecommerce-fashion' || cat === 'hospitality-luxury' || cat === 'developer-tool'
    || cat === 'mobile-app' || cat === 'climate-energy' || cat === 'architecture' || cat === 'food-restaurant') return 'moderate';
  return 'low';
}

/* ── Category experience DNA (the heart of category differentiation) ───────── */
interface ExperienceDNA {
  personality: ExperiencePersonality;
  before: string;
  after: string;
  interactionPrinciple: string;
  signatureBehavior: string;
  emotional: string[];
  essenceMotif: string;
  differentiation: string;
  demonstration: DemonstrationPattern;
  demonstrationHigh: boolean;             // does this category benefit from a real demonstration?
  trustSources: string[];
  microMotifs: string[];
  sectionBehaviors: string[];
  exclusions: string[];
  narrativeCandidates: NarrativeArchitecture[];
  pricingTiming: StorySequence['pricingTiming'];
  finalCtaTone: StorySequence['finalCtaTone'];
  photographyLed: boolean;
}

const DNA: Record<VisualCategory, ExperienceDNA> = {
  'software-saas': {
    personality: 'experimental-intelligent', before: 'overwhelmed by a manual, scattered workflow', after: 'in control of an automated, intelligent system',
    interactionPrinciple: 'show cause and effect immediately — inputs visibly change outputs', signatureBehavior: 'raw input transforms into a structured, useful result in front of the visitor',
    emotional: ['intrigue', 'understanding', 'proof', 'confidence', 'action'], essenceMotif: 'intelligence that does the work, visibly',
    differentiation: 'the product itself demonstrates the outcome instead of a static dashboard screenshot on a gradient',
    demonstration: 'input-to-output-transformation', demonstrationHigh: true,
    trustSources: ['real-product-demonstration', 'customer-stories', 'security-explanation', 'methodology'],
    microMotifs: ['inputs immediately change outputs', 'related nodes converge into one answer', 'results construct as they enter view'],
    sectionBehaviors: ['product stage', 'interactive workspace', 'technical explainer', 'conversion checkpoint'],
    exclusions: ['features explained only as identical icon cards', '“revolutionize your workflow” filler copy', 'a floating dashboard as the only proof'],
    narrativeCandidates: ['product-first-demonstration', 'problem-transformation-proof-action', 'interactive-qualification', 'comparison-led-education'],
    pricingTiming: 'contextual', finalCtaTone: 'low-risk', photographyLed: false,
  },
  finance: {
    personality: 'calm-guided', before: 'uncertain and anxious about money decisions', after: 'calm and in control of a clear plan',
    interactionPrinciple: 'reveal complexity progressively and let the visitor test their own scenario', signatureBehavior: 'financial uncertainty resolves into a clear, controllable plan',
    emotional: ['reassurance', 'clarity', 'proof', 'confidence', 'commitment'], essenceMotif: 'complex money made clear and controllable',
    differentiation: 'a calm decision environment, not a hype-driven fintech gradient with fake tickers',
    demonstration: 'scenario-calculator', demonstrationHigh: true,
    trustSources: ['security-explanation', 'methodology', 'pricing-transparency', 'clear-limitations', 'privacy-explanation'],
    microMotifs: ['controls update the forecast in real time', 'uncertainty resolves into a plan', 'figures count up to their final value'],
    sectionBehaviors: ['interactive workspace', 'data story', 'guided path', 'conversion checkpoint'],
    exclusions: ['fake ticker numbers as decoration', 'invented performance metrics', 'urgency/manipulation patterns'],
    narrativeCandidates: ['guided-decision-journey', 'trust-first-explanation', 'outcome-led', 'problem-transformation-proof-action'],
    pricingTiming: 'late', finalCtaTone: 'low-risk', photographyLed: false,
  },
  'ecommerce-fashion': {
    personality: 'editorial-refined', before: 'browsing casually, unsure this brand is for them', after: 'identifying with the brand and confident to buy',
    interactionPrinciple: 'invite exploration and reward attention to material and detail', signatureBehavior: 'product material and detail reveal themselves as the visitor explores',
    emotional: ['attraction', 'desire', 'identification', 'confidence', 'purchase'], essenceMotif: 'a product styled like an editorial cover',
    differentiation: 'editorial photography and identity, never a SaaS dashboard or utility cards',
    demonstration: 'product-detail-reveal', demonstrationHigh: false,
    trustSources: ['materials-and-detail', 'customer-stories', 'guarantees-if-provided', 'pricing-transparency'],
    microMotifs: ['material detail sharpens on focus', 'the gallery emphasizes craft', 'selection updates the styled look'],
    sectionBehaviors: ['editorial spread', 'material showcase', 'spatial gallery', 'conversion checkpoint'],
    exclusions: ['a product dashboard mockup', 'utility glass cards', 'developer-style tech gradients'],
    narrativeCandidates: ['lifestyle-aspiration', 'editorial-discovery', 'product-first-demonstration', 'community-identity'],
    pricingTiming: 'contextual', finalCtaTone: 'emotional', photographyLed: true,
  },
  architecture: {
    personality: 'editorial-refined', before: 'evaluating whether this studio understands their vision', after: 'convinced by the craft and spatial sensibility',
    interactionPrinciple: 'let space and material breathe; reveal projects like an unfolding portfolio', signatureBehavior: 'each project reveals its space and material as the visitor moves through it',
    emotional: ['curiosity', 'admiration', 'trust', 'aspiration', 'enquiry'], essenceMotif: 'spatial calm carried by light and material',
    differentiation: 'full-bleed architectural photography and restraint, not a product UI',
    demonstration: 'project-reveal', demonstrationHigh: false,
    trustSources: ['project-portfolio', 'materials-and-process', 'real-locations', 'methodology'],
    microMotifs: ['image masks reveal each space', 'scroll advances the project story', 'material detail surfaces on focus'],
    sectionBehaviors: ['immersive image break', 'spatial gallery', 'editorial spread', 'minimal breathing section'],
    exclusions: ['a product dashboard', 'glass utility cards', 'a generic SaaS gradient'],
    narrativeCandidates: ['portfolio-craft', 'editorial-discovery', 'before-after-transformation', 'process-transparency'],
    pricingTiming: 'none', finalCtaTone: 'emotional', photographyLed: true,
  },
  'hospitality-luxury': {
    personality: 'exclusive-cinematic', before: 'dreaming of an escape but not yet committed', after: 'emotionally sold on the place and ready to book',
    interactionPrinciple: 'create controlled, cinematic suspense; let atmosphere lead', signatureBehavior: 'the destination’s atmosphere unfolds cinematically as the visitor descends the page',
    emotional: ['allure', 'immersion', 'desire', 'trust', 'reservation'], essenceMotif: 'an immersive escape into place and atmosphere',
    differentiation: 'cinematic environmental photography with slow motion, never interface chrome',
    demonstration: 'spatial-atmosphere', demonstrationHigh: false,
    trustSources: ['real-locations', 'atmosphere-evidence', 'guest-stories', 'service-detail'],
    microMotifs: ['the scene moves slowly and ambiently', 'image masks reveal the place', 'availability responds to the visitor’s dates'],
    sectionBehaviors: ['immersive image break', 'visual narrative', 'spatial gallery', 'conversion checkpoint'],
    exclusions: ['a dashboard or data UI', 'glass cards', 'busy interface chrome'],
    narrativeCandidates: ['lifestyle-aspiration', 'editorial-discovery', 'outcome-led', 'community-identity'],
    pricingTiming: 'contextual', finalCtaTone: 'emotional', photographyLed: true,
  },
  healthcare: {
    personality: 'trustworthy-clinical', before: 'worried and looking for competent, safe care', after: 'reassured, informed and ready to take the next step',
    interactionPrinciple: 'minimize cognitive load; guide gently and set clear safety boundaries', signatureBehavior: 'a worried visitor is guided calmly through a clear, safe care journey',
    emotional: ['concern', 'reassurance', 'understanding', 'trust', 'action'], essenceMotif: 'competent care that is clear and safe',
    differentiation: 'warm, authentic human care plus explicit safety boundaries, never hype or fake metrics',
    demonstration: 'guided-intake', demonstrationHigh: false,
    trustSources: ['practitioner-credibility', 'process-reassurance', 'safety-boundaries', 'clear-limitations', 'privacy-explanation'],
    microMotifs: ['guided steps advance clearly', 'a reassuring progressive reveal', 'focus exposes plain, honest detail'],
    sectionBehaviors: ['guided path', 'testimonial portrait story', 'layered process', 'minimal breathing section'],
    exclusions: ['neon or aggressive motion', 'invented outcome statistics', 'cold, generic stock'],
    narrativeCandidates: ['trust-first-explanation', 'guided-decision-journey', 'process-transparency', 'service-reassurance'],
    pricingTiming: 'contextual', finalCtaTone: 'low-risk', photographyLed: true,
  },
  education: {
    personality: 'warm-human', before: 'motivated but unsure this path will work for them', after: 'inspired and confident to start learning',
    interactionPrinciple: 'show a clear, encouraging path and let the visitor picture their progress', signatureBehavior: 'the learning journey advances visibly along an encouraging path',
    emotional: ['curiosity', 'motivation', 'belief', 'confidence', 'enrolment'], essenceMotif: 'momentum toward a real learning outcome',
    differentiation: 'a friendly, human path to mastery, not an enterprise console',
    demonstration: 'guided-learning-path', demonstrationHigh: true,
    trustSources: ['methodology', 'outcomes-evidence', 'instructor-credibility', 'community-proof'],
    microMotifs: ['progress advances along a path', 'cards reveal how topics relate', 'selection previews the outcome'],
    sectionBehaviors: ['guided path', 'timeline', 'testimonial portrait story', 'conversion checkpoint'],
    exclusions: ['an enterprise dashboard', 'sterile corporate stock', 'invented graduation/success numbers'],
    narrativeCandidates: ['outcome-led', 'guided-decision-journey', 'comparison-led-education', 'community-identity'],
    pricingTiming: 'late', finalCtaTone: 'low-risk', photographyLed: false,
  },
  security: {
    personality: 'precise-technical', before: 'anxious about invisible, complex threats', after: 'confident the system is understood and controlled',
    interactionPrinciple: 'demonstrate the defense; expose technical depth on focus without theatrics', signatureBehavior: 'an abstract threat becomes a clearly guarded, legible system',
    emotional: ['concern', 'comprehension', 'proof', 'trust', 'action'], essenceMotif: 'controlled protection made legible',
    differentiation: 'an intelligible security topology, never hacker-in-a-hoodie clichés or fake live data',
    demonstration: 'threat-flow-visualization', demonstrationHigh: true,
    trustSources: ['technical-architecture', 'methodology', 'before-after-evidence', 'clear-limitations', 'published-research'],
    microMotifs: ['nodes expose detail on focus', 'the threat flow animates on scroll', 'a before/after defense toggle'],
    sectionBehaviors: ['technical explainer', 'comparison field', 'data story', 'conversion checkpoint'],
    exclusions: ['a hacker-in-a-hoodie photo', 'green matrix code rain', 'fabricated live threat numbers'],
    narrativeCandidates: ['technical-evidence-journey', 'trust-first-explanation', 'before-after-transformation', 'product-first-demonstration'],
    pricingTiming: 'contextual', finalCtaTone: 'functional', photographyLed: false,
  },
  'food-restaurant': {
    personality: 'warm-human', before: 'hungry and deciding where to go', after: 'craving this place and ready to book or order',
    interactionPrinciple: 'invite the senses; let food and room feel warm and real', signatureBehavior: 'the food and the room warm up and draw the visitor in as they scroll',
    emotional: ['appetite', 'warmth', 'desire', 'trust', 'reservation'], essenceMotif: 'appetite and place, warm and real',
    differentiation: 'rich food and venue photography with editorial warmth, no UI chrome',
    demonstration: 'menu-exploration', demonstrationHigh: false,
    trustSources: ['real-locations', 'materials-and-process', 'guest-stories', 'atmosphere-evidence'],
    microMotifs: ['menu detail sharpens on focus', 'dishes reveal through a soft mask', 'a warm progression as you scroll'],
    sectionBehaviors: ['immersive image break', 'material showcase', 'spatial gallery', 'conversion checkpoint'],
    exclusions: ['a dashboard or charts', 'glass cards', 'cold tech gradients'],
    narrativeCandidates: ['lifestyle-aspiration', 'editorial-discovery', 'community-identity', 'service-reassurance'],
    pricingTiming: 'contextual', finalCtaTone: 'emotional', photographyLed: true,
  },
  'portfolio-creative': {
    personality: 'expressive-cultural', before: 'scanning for a distinctive point of view', after: 'convinced by a confident, authored voice',
    interactionPrinciple: 'invite exploration; let the work speak loudest', signatureBehavior: 'the work reveals itself with an authored, editorial rhythm',
    emotional: ['curiosity', 'intrigue', 'admiration', 'trust', 'contact'], essenceMotif: 'a confident authored point of view',
    differentiation: 'expressive editorial layout and large work imagery, deliberately not a corporate template',
    demonstration: 'work-showcase', demonstrationHigh: false,
    trustSources: ['work-portfolio', 'craft-and-process', 'editorial-authority', 'client-stories'],
    microMotifs: ['cursor proximity responds subtly', 'work reveals through a mask', 'an editorial scroll rhythm'],
    sectionBehaviors: ['editorial spread', 'spatial gallery', 'visual narrative', 'minimal breathing section'],
    exclusions: ['a corporate dashboard', 'a generic SaaS gradient with glass cards'],
    narrativeCandidates: ['portfolio-craft', 'editorial-discovery', 'outcome-led', 'community-identity'],
    pricingTiming: 'none', finalCtaTone: 'emotional', photographyLed: true,
  },
  'developer-tool': {
    personality: 'precise-technical', before: 'skeptical, wanting to see it actually work', after: 'convinced by real code, speed and precision',
    interactionPrinciple: 'emphasize speed and precision; show code-to-result honestly', signatureBehavior: 'real code runs to a real result in front of the developer',
    emotional: ['skepticism', 'interest', 'proof', 'trust', 'adoption'], essenceMotif: 'precise craft shown by real code and architecture',
    differentiation: 'real terminal/editor/diagram surfaces with precise micro-interactions, no lifestyle stock',
    demonstration: 'code-to-result-flow', demonstrationHigh: true,
    trustSources: ['technical-architecture', 'real-product-demonstration', 'published-docs', 'performance-evidence'],
    microMotifs: ['code runs to a result', 'a diagram animates on focus', 'a comparison responds to selection'],
    sectionBehaviors: ['product stage', 'technical explainer', 'comparison field', 'conversion checkpoint'],
    exclusions: ['lifestyle stock or a smiling office team', 'neon blobs', 'a decorative fake dashboard'],
    narrativeCandidates: ['technical-evidence-journey', 'product-first-demonstration', 'comparison-led-education', 'process-transparency'],
    pricingTiming: 'contextual', finalCtaTone: 'functional', photographyLed: false,
  },
  'climate-energy': {
    personality: 'pragmatic-operational', before: 'hopeful but wary of greenwashing', after: 'convinced by measurable, honest impact',
    interactionPrinciple: 'demonstrate transformation with honest data the visitor can probe', signatureBehavior: 'a real-world scene resolves into honest, measurable impact',
    emotional: ['concern', 'hope', 'proof', 'trust', 'commitment'], essenceMotif: 'measurable impact grounded in the real world',
    differentiation: 'environmental scenes grounded by legible impact data, not greenwashed decoration',
    demonstration: 'impact-forecast', demonstrationHigh: true,
    trustSources: ['methodology', 'published-research', 'before-after-evidence', 'process-transparency'],
    microMotifs: ['data interpolates to its impact figure', 'a timeline progresses on scroll', 'a scenario updates the outcome'],
    sectionBehaviors: ['data story', 'visual narrative', 'technical explainer', 'conversion checkpoint'],
    exclusions: ['invented impact numbers', 'neon', 'generic globe clichés'],
    narrativeCandidates: ['outcome-led', 'process-transparency', 'technical-evidence-journey', 'problem-transformation-proof-action'],
    pricingTiming: 'contextual', finalCtaTone: 'functional', photographyLed: false,
  },
  'mobile-app': {
    personality: 'energetic-participatory', before: 'curious whether the app fits their daily life', after: 'excited to install and use it now',
    interactionPrinciple: 'use tactile product feedback; make the app feel alive in-hand', signatureBehavior: 'the app comes alive in-hand, tapping through a real flow',
    emotional: ['curiosity', 'delight', 'belief', 'confidence', 'install'], essenceMotif: 'a delightful app-in-hand experience',
    differentiation: 'device-framed app screens with depth and in-context life, not a desktop dashboard',
    demonstration: 'in-app-flow', demonstrationHigh: true,
    trustSources: ['real-product-demonstration', 'user-stories', 'privacy-explanation', 'guarantees-if-provided'],
    microMotifs: ['screens float with depth', 'a tap advances the flow', 'cards cluster then expand'],
    sectionBehaviors: ['product stage', 'visual narrative', 'interactive workspace', 'conversion checkpoint'],
    exclusions: ['a desktop dashboard or dense tables', 'utility glass cards', 'neon'],
    narrativeCandidates: ['product-first-demonstration', 'lifestyle-aspiration', 'outcome-led', 'community-identity'],
    pricingTiming: 'contextual', finalCtaTone: 'emotional', photographyLed: false,
  },
  'b2b-enterprise': {
    personality: 'pragmatic-operational', before: 'evaluating whether this can handle real operational complexity', after: 'confident it orchestrates their workflow reliably',
    interactionPrinciple: 'make complex workflow calm and legible; reveal the system step by step', signatureBehavior: 'a complex operation is made calm and legible as one connected workflow',
    emotional: ['scrutiny', 'comprehension', 'proof', 'trust', 'decision'], essenceMotif: 'orchestrated complexity made calm',
    differentiation: 'a clear workflow/architecture visual and real proof, not three glass cards on a gradient',
    demonstration: 'workflow-graph', demonstrationHigh: true,
    trustSources: ['technical-architecture', 'process-transparency', 'customer-stories', 'security-explanation'],
    microMotifs: ['the workflow advances step by step', 'nodes reveal their relationships', 'a metric constructs on scroll'],
    sectionBehaviors: ['technical explainer', 'data story', 'comparison field', 'conversion checkpoint'],
    exclusions: ['neon', 'three glass cards over a gradient', 'a generic purple SaaS gradient'],
    narrativeCandidates: ['guided-decision-journey', 'technical-evidence-journey', 'outcome-led', 'comparison-led-education'],
    pricingTiming: 'late', finalCtaTone: 'functional', photographyLed: false,
  },
  'local-service': {
    personality: 'warm-human', before: 'stressed by a problem and unsure who to trust', after: 'reassured by proven local work and ready to enquire',
    interactionPrinciple: 'demonstrate transformation and reassure with real, local proof', signatureBehavior: 'a real problem is shown transformed by proven, local work',
    emotional: ['stress', 'reassurance', 'proof', 'trust', 'enquiry'], essenceMotif: 'proven local craft you can trust',
    differentiation: 'authentic on-the-job and results photography, not abstract tech visuals',
    demonstration: 'quote-flow', demonstrationHigh: true,
    trustSources: ['before-after-evidence', 'service-coverage', 'response-time', 'real-locations', 'customer-stories'],
    microMotifs: ['a before/after drag reveal', 'a coverage map responds', 'the process advances step by step'],
    sectionBehaviors: ['visual narrative', 'layered process', 'testimonial portrait story', 'conversion checkpoint'],
    exclusions: ['a dashboard or charts', 'glass cards', 'abstract SaaS gradients'],
    narrativeCandidates: ['service-reassurance', 'before-after-transformation', 'process-transparency', 'trust-first-explanation'],
    pricingTiming: 'contextual', finalCtaTone: 'low-risk', photographyLed: true,
  },
  generic: {
    personality: 'editorial-refined', before: 'unsure what this product is and why it matters', after: 'clear on the value and ready to act',
    interactionPrinciple: 'carry one clear idea; reveal it with intent, not decoration', signatureBehavior: 'one clear product idea is revealed and reinforced through the page',
    emotional: ['curiosity', 'understanding', 'proof', 'confidence', 'action'], essenceMotif: 'one clear, product-true idea',
    differentiation: 'one dominant, product-true idea rather than a generic assembled template',
    demonstration: 'guided-overview', demonstrationHigh: false,
    trustSources: ['real-product-demonstration', 'process-transparency', 'customer-stories', 'clear-limitations'],
    microMotifs: ['content reveals through a mask', 'selection updates the content', 'progress advances on scroll'],
    sectionBehaviors: ['visual narrative', 'guided path', 'conversion checkpoint', 'minimal breathing section'],
    exclusions: ['a generic floating dashboard in every hero', 'three glass cards over a gradient', '“future of X” filler headlines'],
    narrativeCandidates: ['problem-transformation-proof-action', 'editorial-discovery', 'outcome-led', 'product-first-demonstration'],
    pricingTiming: 'contextual', finalCtaTone: 'functional', photographyLed: false,
  },
};

const UNIVERSAL_STORY_EXCLUSIONS = [
  'trust shown only as invented metrics or fake partner logos',
  'every section using the same icon-feature-card block',
  'testimonials presented as real when they are illustrative and unlabeled',
  'a manipulative or false-urgency conversion pattern',
];

const PERSONALITY_PHRASE: Record<ExperiencePersonality, string> = {
  'calm-guided': 'calm, guided', 'precise-technical': 'precise, technical', 'expressive-cultural': 'expressive, cultural',
  'editorial-refined': 'editorial, refined', 'energetic-participatory': 'energetic, participatory', 'trustworthy-clinical': 'trustworthy, clinical',
  'warm-human': 'warm, human', 'exclusive-cinematic': 'exclusive, cinematic', 'pragmatic-operational': 'pragmatic, operational',
  'experimental-intelligent': 'intelligent, exploratory',
};
const ROLE_FUNCTION: Record<string, string> = {
  orient: 'get oriented', 'establish-value': 'grasp the core value', demonstrate: 'see the product work',
  'explain-process': 'understand how it works', 'reduce-risk': 'have concerns addressed', 'provide-proof': 'see credible proof',
  compare: 'compare the options', 'enable-decision': 'make a confident decision', convert: 'take the primary action',
  reassure: 'feel reassured', inform: 'learn the key details',
};
const DISCLAIMER_BY_CATEGORY: Partial<Record<VisualCategory, string[]>> = {
  finance: ['this is not financial or investment advice', 'past performance does not guarantee future results', 'figures shown are illustrative examples'],
  healthcare: ['this is not a substitute for professional medical advice', 'consult a qualified practitioner', 'individual results vary'],
  security: ['no security control is absolute', 'described protections have limitations', 'any example data shown is illustrative'],
};
const REGULATED_DISCLAIMER_DEFAULT = ['this is general information, not professional advice', 'consult a qualified professional', 'example figures are illustrative'];

/* ── Derivation entry point ──────────────────────────────────────────────── */
export function deriveExperienceIdentityContract(input: ExperienceIdentityInput): ExperienceIdentityContract | undefined {
  try {
    if (!input || typeof input !== 'object') return undefined;
    const cat = classifyVisualCategory({ identity: input.identity, prompt: input.prompt });
    const dna = DNA[cat] || DNA.generic;
    const bmc = businessModelClass(input.identity?.businessModel, cat);
    const stakes = trustStakesFor(cat, input);
    const seed = hashString(`${cat}|${bmc}|${input.identity?.primaryConcept || ''}|${clip(input.prompt, 120)}`);

    const evidence: string[] = [];
    if (input.composition) evidence.push('composition.sections/hero');
    if (input.contentNarrative) evidence.push('contentNarrative.positioning/narrativeProgression/proofPolicy');
    if (input.research) evidence.push('research.audience/conversionModel/forbiddenClaims/artDirection');
    if (input.binding) evidence.push('bindingRequirements.requirements');
    if (input.visualConcept) evidence.push('visualConcept.signature/category');
    if (input.imageCoverage) evidence.push('imageCoverage.mode');

    // ── Product demonstration (compose bindingRequirements + architecture demo surfaces). ──
    const reqs = Array.isArray(input.binding?.requirements) ? input.binding!.requirements : [];
    const bindReq = reqs.find((r) => (r.kind === 'interactive-experience' || r.kind === 'control' || r.kind === 'dynamic-outcome') && r.required);
    const hasDemoSurface = (input.demoSurfaces?.length || 0) > 0 || (input.statefulDemoComponents?.length || 0) > 0;
    const demonstrationRequired = dna.demonstrationHigh && (!!bindReq || hasDemoSurface || bmc === 'self-serve' || bmc === 'technical' || bmc === 'subscription');
    const labelFictional = stakes === 'regulated' || cat === 'climate-energy' || cat === 'b2b-enterprise';
    const demonstration: ProductDemonstration = {
      required: demonstrationRequired,
      pattern: demonstrationRequired ? dna.demonstration : 'none',
      goal: clip(`let the visitor experience "${dna.essenceMotif}" first-hand via ${dna.demonstration.replace(/-/g, ' ')}`, MAX_TEXT),
      userInput: clip(bindReq?.controls?.[0]?.label || 'a simple, low-friction input the visitor controls', 90),
      visibleResponse: clip(bindReq?.dynamicOutcome || 'a clear, immediate on-screen change that reflects the input', 100),
      productState: 'the product visibly moves through states (idle → working → result) without fabricated backend success',
      feedback: 'immediate, perceivable feedback at the control (value, selection, or status)',
      successOutcome: clip(`the visitor sees "${dna.after}" demonstrated, not just described`, 110),
      fallback: 'if computation/data is unavailable, show a clearly-labeled illustrative example — never fabricate live results',
      mobile: 'fully operable on mobile with larger touch targets and a stacked layout',
      accessibility: 'keyboard-operable with visible focus and an aria-live result; respects prefers-reduced-motion',
      backendRequired: false,
      frontendSimOk: true,
      labelFictionalData: labelFictional,
      bindingRequirementId: bindReq?.id,
    };

    // ── Narrative architecture (semantic-primary, stakes/demo-refined, hash-tiebroken). ──
    let cands = dna.narrativeCandidates.slice();
    if (stakes === 'regulated' && !cands.slice(0, 2).includes('trust-first-explanation') && !cands.slice(0, 2).includes('guided-decision-journey')) {
      cands = uniq(['guided-decision-journey', 'trust-first-explanation', ...cands]);
    } else if (demonstrationRequired) {
      const demoFam = cands.find((c) => c === 'product-first-demonstration' || c === 'technical-evidence-journey');
      if (demoFam) cands = uniq([demoFam, ...cands]);
    }
    const narrativeArchitecture = (pick(cands, seed, 3) || dna.narrativeCandidates[0]) as NarrativeArchitecture;

    // ── Trust architecture. ──
    const disclaimersRequired = stakes === 'regulated' ? (DISCLAIMER_BY_CATEGORY[cat] || REGULATED_DISCLAIMER_DEFAULT) : [];
    const metricsAppropriate = (cat === 'software-saas' || cat === 'b2b-enterprise' || cat === 'climate-energy' || cat === 'developer-tool' || cat === 'mobile-app') && stakes !== 'regulated';
    const testimonialsAppropriate = cat !== 'architecture' && cat !== 'portfolio-creative' && cat !== 'developer-tool';
    const trust: TrustArchitecture = {
      stakes,
      sources: uniq([...dna.trustSources]).slice(0, MAX_LIST),
      placement: stakes === 'regulated' || stakes === 'high'
        ? 'establish credibility and safety early and reinforce it before every ask'
        : 'reinforce trust mid-page and again just before the final CTA',
      disclaimersRequired,
      forbiddenClaims: uniq([
        ...capList(input.research?.forbiddenClaims, 4),
        ...capList(input.contentNarrative?.prohibitedClaimClasses, 4),
        'invented metrics, certifications, partnerships or customer counts',
      ]).slice(0, MAX_LIST),
      testimonialsAppropriate,
      metricsAppropriate,
      labelFictionalExamples: labelFictional || (demonstrationRequired && stakes !== 'low'),
      copyTone: stakes === 'regulated' ? 'conservative and precise, with visible limitations'
        : stakes === 'high' ? 'credible and specific, never hyped'
        : 'confident and concrete, never exaggerated',
    };

    // ── Story sequence. ──
    const firstAfterHero = narrativeArchitecture === 'trust-first-explanation' ? 'a plain-language explanation of how it works and why it is safe'
      : narrativeArchitecture === 'product-first-demonstration' || narrativeArchitecture === 'technical-evidence-journey' ? 'a real product demonstration'
      : narrativeArchitecture === 'lifestyle-aspiration' || narrativeArchitecture === 'editorial-discovery' ? 'an immersive visual narrative of the experience'
      : narrativeArchitecture === 'guided-decision-journey' || narrativeArchitecture === 'interactive-qualification' ? 'a guided first step that qualifies the visitor'
      : narrativeArchitecture === 'portfolio-craft' ? 'the strongest work, shown large'
      : narrativeArchitecture === 'service-reassurance' || narrativeArchitecture === 'before-after-transformation' ? 'the real problem and its proven result'
      : 'the core value shown concretely, not just claimed';
    const storySequence: StorySequence = {
      firstAfterHero: clip(firstAfterHero, MAX_TEXT),
      demonstrationStage: demonstration.required ? 'early–mid: right after value is established, before the proof section' : 'not applicable — this experience leads with visuals/editorial, not interaction',
      trustStage: stakes === 'regulated' || stakes === 'high' ? 'early and recurring, before every ask' : 'mid-to-late, reinforced before the final CTA',
      climaxStage: clip(`the signature moment — ${dna.signatureBehavior} — is the visual and narrative peak`, MAX_TEXT),
      pricingTiming: bmc === 'sales-led' || bmc === 'professional' ? 'late' : dna.pricingTiming,
      testimonialsAppropriate,
      metricsAppropriate,
      strongestCtaStage: 'after the demonstration and proof, at the conversion checkpoint',
      finalCtaTone: dna.finalCtaTone,
    };

    // ── Functional progression (compose contentNarrative's journey; fall back to category default). ──
    const roles = Array.isArray(input.contentNarrative?.narrativeProgression) ? input.contentNarrative!.narrativeProgression : [];
    const functionalProgression = roles.length
      ? uniq(roles.map((r) => ROLE_FUNCTION[r as string] || String(r)).filter(Boolean)).slice(0, MAX_LIST)
      : ['get oriented', 'grasp the core value', demonstration.required ? 'see the product work' : 'explore the experience', 'see credible proof', 'take the primary action'];

    const essence = clip(
      input.contentNarrative?.positioningThesis || input.contentNarrative?.valueProposition || `${dna.essenceMotif} for ${clip(input.research?.audience || input.contentNarrative?.audience || 'the intended audience', 40)}`,
      MAX_TEXT,
    );
    const audienceState: AudienceState = { before: clip(dna.before, 120), after: clip(dna.after, 120) };
    const experienceThesis = clip(
      `A ${PERSONALITY_PHRASE[dna.personality]} experience where ${dna.essenceMotif}, moving the visitor from ${audienceState.before} to ${audienceState.after}.`,
      MAX_TEXT,
    );

    return {
      version: 'experience-identity-v1',
      status: 'derived',
      category: cat,
      businessModelClass: bmc,
      experienceThesis,
      productEssence: essence,
      audienceState,
      personality: dna.personality,
      interactionPrinciple: clip(dna.interactionPrinciple, MAX_TEXT),
      signatureBehavior: clip(dna.signatureBehavior, MAX_TEXT),
      emotionalProgression: dna.emotional.slice(0, 6),
      functionalProgression,
      narrativeArchitecture,
      storySequence,
      demonstration,
      trust,
      sectionBehaviors: uniq(dna.sectionBehaviors).slice(0, MAX_LIST),
      microMotifs: uniq(dna.microMotifs).slice(0, 4),
      differentiation: clip(dna.differentiation, MAX_TEXT),
      exclusions: uniq([...dna.exclusions, ...UNIVERSAL_STORY_EXCLUSIONS]).slice(0, MAX_LIST + 2),
      reasons: [
        clip(`category "${cat}" · business model "${bmc}" · trust stakes "${stakes}"`, MAX_TEXT),
        clip(`narrative architecture "${narrativeArchitecture}"${demonstration.required ? ` with a required ${demonstration.pattern} demonstration` : ' (visual/editorial-led, no forced interaction)'}`, MAX_TEXT),
        clip(`personality "${dna.personality}"; signature behavior wired to the product story`, MAX_TEXT),
      ],
      upstreamEvidenceUsedToDeriveContract: uniq(evidence).slice(0, MAX_LIST),
      contractPersistedInSpecification: true,
      contractRenderedToFrontendBuilder: false,
      contractUsedByAcceptance: false,
      agentsActuallyConsumingContract: [],
    };
  } catch {
    return undefined;   // never block the build on experience-identity derivation
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * RENDER — one hard-bounded builder block (≤ RENDER_CHAR_CEILING). Product/experience
 * direction leads; visual/composition/token specifics are REFERENCED, not repeated.
 * ──────────────────────────────────────────────────────────────────────────── */
export function renderExperienceIdentityBlock(contract: ExperienceIdentityContract | undefined): string[] {
  if (!contract || contract.status !== 'derived') return [];
  const d = contract.demonstration; const t = contract.trust; const q = contract.storySequence;
  const out: string[] = [];
  out.push(`BINDING EXPERIENCE IDENTITY & PRODUCT STORY (this site could only belong to THIS product — design one coherent experience, not assembled sections; category: ${contract.category}, ${contract.businessModelClass}):`);
  out.push(`- Experience thesis: ${clip(contract.experienceThesis, MAX_TEXT)}`);
  out.push(`- Product essence: ${clip(contract.productEssence, MAX_TEXT)}`);
  out.push(`- Audience shift: from "${clip(contract.audienceState.before, 70)}" to "${clip(contract.audienceState.after, 70)}"`);
  out.push(`- Personality: ${contract.personality}; interaction principle: ${clip(contract.interactionPrinciple, 110)}`);
  out.push(`- Signature experience behavior (recurring, lightweight): ${clip(contract.signatureBehavior, MAX_TEXT)}`);
  out.push(`- Emotional progression: ${contract.emotionalProgression.join(' → ')}`);
  out.push(`- Functional progression: ${contract.functionalProgression.join(' → ')}`);
  out.push(`- Narrative architecture: ${contract.narrativeArchitecture}. After the hero, lead with ${clip(q.firstAfterHero, 90)}.`);
  out.push(`  · demonstration stage: ${clip(q.demonstrationStage, 90)}; trust stage: ${clip(q.trustStage, 80)}`);
  out.push(`  · climax: ${clip(q.climaxStage, 90)}; strongest CTA: ${clip(q.strongestCtaStage, 60)} (${q.finalCtaTone}); pricing: ${q.pricingTiming}`);
  out.push(`  · testimonials ${q.testimonialsAppropriate ? 'appropriate' : 'not appropriate'}; metrics ${q.metricsAppropriate ? 'appropriate (only if real)' : 'not appropriate'}`);
  if (d.required) {
    out.push(`- Product demonstration (${d.pattern}) — REQUIRED, frontend-only simulation is fine, never fabricate backend/live data:`);
    out.push(`  · goal: ${clip(d.goal, 110)}; input: ${clip(d.userInput, 60)} → response: ${clip(d.visibleResponse, 70)}`);
    out.push(`  · feedback: ${clip(d.feedback, 70)}; success: ${clip(d.successOutcome, 80)}; fallback: ${clip(d.fallback, 90)}`);
    out.push(`  · mobile: ${clip(d.mobile, 60)}; a11y: ${clip(d.accessibility, 70)}${d.labelFictionalData ? '; label any example data as illustrative' : ''}`);
  } else {
    out.push('- Product demonstration: not forced — this experience leads with visuals/editorial; do not bolt on a synthetic widget.');
  }
  out.push(`- Trust architecture (${t.stakes}): sources ${capList(t.sources, 5).join(', ')}; ${clip(t.placement, 80)}; tone ${clip(t.copyTone, 50)}`);
  if (t.disclaimersRequired.length) out.push(`  · REQUIRED limitations/disclaimers (render visibly): ${t.disclaimersRequired.map((x) => clip(x, 50)).join('; ')}`);
  out.push(`  · forbidden: ${capList(t.forbiddenClaims, 4).map((x) => clip(x, 44)).join('; ')}${t.labelFictionalExamples ? '; label illustrative examples' : ''}`);
  out.push(`- Section rhythm (distinct jobs, not repeated cards): ${capList(contract.sectionBehaviors, 5).join(' · ')}`);
  out.push(`- Signature micro-interactions (2–4, purposeful, reduced-motion-safe; see visual-concept motion for technique): ${capList(contract.microMotifs, 4).join('; ')}`);
  out.push(`- Differentiation: ${clip(contract.differentiation, MAX_TEXT)}`);
  out.push(`- Story-level exclusions: ${capList(contract.exclusions, 6).map((x) => clip(x, 52)).join('; ')}`);
  out.push('- Creative freedom: choose the exact realization freely inside these boundaries; do not repeat the visual-system tokens, composition families, content copy or accessibility/performance rules — those authorities own them.');
  let total = 0; const bounded: string[] = [];
  for (const line of out) { total += line.length + 1; if (total > RENDER_CHAR_CEILING) break; bounded.push(line); }
  return bounded;
}

/* ────────────────────────────────────────────────────────────────────────────
 * ACCEPTANCE — conservative, evidence-backed, non-duplicative, fail-open. Reuses
 * experienceQuality's ONE JSX scanner. Blocks only the high-stakes disclaimer floor
 * (owned by nobody else); everything else warns.
 * ──────────────────────────────────────────────────────────────────────────── */
export type ExperienceIdentityIssueCode =
  | 'experience-disclaimer-missing' | 'experience-demonstration-absent'
  | 'experience-fake-proof' | 'experience-generic-concentration' | 'experience-identity-warn';

export interface ExperienceIdentityIssue {
  code: ExperienceIdentityIssueCode;
  severity: FrontendBuilderReviewSeverity;
  subPolicy: 'trust' | 'demonstration' | 'anti-generic';
  label: string;
  files: string[];
  evidence: string;
  repairInstruction: string;
}
export interface ExperienceIdentityAcceptanceResult {
  status: 'pass' | 'warning' | 'fail';
  legacy: boolean;
  analyzedFileCount: number;
  disclaimerFound: boolean;
  demonstrationEvidence: boolean;
  issues: ExperienceIdentityIssue[];
}
const LEGACY_RESULT: ExperienceIdentityAcceptanceResult = {
  status: 'pass', legacy: true, analyzedFileCount: 0, disclaimerFound: false, demonstrationEvidence: false, issues: [],
};
function capEv(s: string): string { const x = (s || '').replace(/\s+/g, ' ').trim(); return x.length > MAX_EVIDENCE ? x.slice(0, MAX_EVIDENCE) : x; }

const DISCLAIMER_RE = /\b(not\s+(?:financial|investment|legal|medical|tax|professional)\s+advice|for\s+informational\s+purposes|informational\s+purposes\s+only|educational\s+purposes|consult\s+(?:a|an|your|with|qualified|the)|results?\s+(?:may|can|are\s+not|will)\s+var|past\s+performance|no\s+guarantee|not\s+a\s+substitute|individual\s+results|terms(?:\s+and\s+conditions)?\s+apply|subject\s+to\s+(?:change|terms|eligibility|approval)|eligibility|disclaimer|limitations?\b|seek\s+professional|your\s+(?:doctor|physician|advisor|attorney|accountant)|illustrative|for\s+general\s+information)\b/i;
const DEMO_EVIDENCE_RE = /<input\b|<textarea\b|<select\b|type=["']range["']|<canvas\b|<form\b|role=["'](?:slider|tab|tablist)["']|useState\s*[<(]|onChange=|onClick=/i;

export function analyzeExperienceIdentity(
  files: FrontendGeneratedFile[] | undefined,
  contract: ExperienceIdentityContract | undefined,
): ExperienceIdentityAcceptanceResult {
  try {
    if (!contract || contract.status !== 'derived') return LEGACY_RESULT;
    const list = Array.isArray(files) ? files : [];
    if (!list.length) return { ...LEGACY_RESULT, legacy: false };
    const issues: ExperienceIdentityIssue[] = [];
    const push = (x: ExperienceIdentityIssue) => { if (issues.length < MAX_ISSUES) issues.push(x); };

    let visibleText = ''; let demoEvidence = false; let anyChildComponent = false;
    let trustedByFake = false;
    for (const file of list) {
      const content = (file.content || '').slice(0, MAX_SCAN);
      if (!demoEvidence && DEMO_EVIDENCE_RE.test(content)) demoEvidence = true;
      if (!trustedByFake && /trusted\s+by\s+[\d,]{2,}\+?\s*(?:customers|users|clients|companies|businesses|teams|brands)/i.test(content)) trustedByFake = true;
      let f: SectionFacts | null = null;
      try { f = factsFor('scan', file.path || '', file.content || ''); } catch { f = null; }
      if (f) { visibleText += ' ' + f.text; if (f.hasChildComponent) anyChildComponent = true; }
    }
    const disclaimerFound = DISCLAIMER_RE.test(visibleText);

    // (1) HIGH-STAKES DISCLAIMER FLOOR (block) — a regulated build with a required disclaimer and NO
    //     limitation/disclaimer language anywhere in the rendered copy. Owned by nobody else. Fail OPEN when
    //     there is too little rendered copy to judge (a shell whose text lives in child components not in
    //     the analyzed file set) — we only block when substantial copy exists and none of it disclaims.
    const enoughCopyToJudge = visibleText.trim().length >= 40;
    if (contract.trust.stakes === 'regulated' && contract.trust.disclaimersRequired.length && !disclaimerFound && enoughCopyToJudge) {
      push({
        code: 'experience-disclaimer-missing', severity: 'major', subPolicy: 'trust', label: 'required disclaimer absent',
        files: list.slice(0, MAX_ISSUE_FILES).map((f) => f.path || ''),
        evidence: capEv(`this is a regulated ${contract.category} experience but no limitation/disclaimer language appears anywhere in the rendered copy — required for a high-stakes category (e.g. "${clip(contract.trust.disclaimersRequired[0], 60)}")`),
        repairInstruction: capEv(`Render a visible, honest limitation/disclaimer (e.g. ${contract.trust.disclaimersRequired.slice(0, 2).join('; ')}) near the relevant claim or in the footer; do not overstate or fabricate.`),
      });
    }

    // (2) REQUIRED DEMONSTRATION ABSENT (warn) — the story requires a product demonstration but the markup
    //     shows no interactive/demo evidence. Warning only (bindingRequirements/experienceQuality own the
    //     hard interaction gates); fail open when a child component may host it.
    if (contract.demonstration.required && !demoEvidence && !anyChildComponent) {
      push({
        code: 'experience-demonstration-absent', severity: 'minor', subPolicy: 'demonstration', label: 'product demonstration not evidenced',
        files: [],
        evidence: capEv(`the experience calls for a ${contract.demonstration.pattern} demonstration but no interactive/demo markup (input/canvas/form/stateful control) was found — verify the product is shown working, not only described`),
        repairInstruction: capEv('Add the intended frontend-only demonstration with a visible result and a labeled illustrative fallback; never fabricate live/backend data.'),
      });
    }

    // (3) FAKE-PROOF PATTERN (warn) — a high-stakes build renders a "trusted by N customers" number with no
    //     approved claims. research/contentNarrative own the claim policy, so this stays a warning.
    if ((contract.trust.stakes === 'regulated' || contract.trust.stakes === 'high') && trustedByFake) {
      push({
        code: 'experience-fake-proof', severity: 'minor', subPolicy: 'trust', label: 'unverifiable trust metric',
        files: [],
        evidence: capEv(`a "trusted by N…" style metric appears in a ${contract.trust.stakes}-stakes ${contract.category} build — verify it is an approved, real claim, not fabricated proof`),
        repairInstruction: capEv('Replace unverifiable metrics with real, source-appropriate proof (methodology, process transparency, or approved claims); do not invent customer counts.'),
      });
    }

    const majors = issues.filter((i) => i.severity !== 'minor').length;
    const status: ExperienceIdentityAcceptanceResult['status'] = majors > 0 ? 'fail' : (issues.length ? 'warning' : 'pass');
    return { status, legacy: false, analyzedFileCount: list.length, disclaimerFound, demonstrationEvidence: demoEvidence, issues };
  } catch {
    return LEGACY_RESULT;   // fail open — experience-identity acceptance never hard-errors the build
  }
}

export function hasBlockingExperienceIdentityFindings(result: ExperienceIdentityAcceptanceResult | undefined): boolean {
  return !!result && result.status === 'fail';
}

const EI_CATEGORY: Record<ExperienceIdentityIssueCode, FrontendBuilderReviewCategory> = {
  'experience-disclaimer-missing': 'concept-fidelity',
  'experience-demonstration-absent': 'component-composition',
  'experience-fake-proof': 'concept-drift',
  'experience-generic-concentration': 'generic-template',
  'experience-identity-warn': 'concept-fidelity',
};

export function experienceIdentityToReviewIssues(result: ExperienceIdentityAcceptanceResult | undefined): FrontendBuilderReviewIssue[] {
  if (!result || !result.issues.length) return [];
  const out: FrontendBuilderReviewIssue[] = [];
  let i = 0;
  for (const issue of result.issues) {
    if (issue.severity === 'minor') continue;    // advisory — never a repair blocker
    out.push({
      id: `experience-identity-${issue.code}-${i += 1}`,
      severity: issue.severity,
      category: EI_CATEGORY[issue.code],
      files: (issue.files || []).slice(0, MAX_ISSUE_FILES),
      evidence: capEv(issue.evidence),
      repairInstruction: capEv(issue.repairInstruction),
    });
    if (out.length >= MAX_ISSUES) break;
  }
  return out;
}

export function experienceIdentityIssueCodes(result: ExperienceIdentityAcceptanceResult | undefined): string[] {
  return result && result.issues.length ? uniq(result.issues.map((i) => i.code)) : [];
}

/* ── Owner diagnostics (bounded, secret-free) ─────────────────────────────── */
export interface ExperienceIdentityDiagnostics {
  version: 'experience-identity-v1';
  category: VisualCategory;
  businessModelClass: BusinessModelClass;
  personality: ExperiencePersonality;
  narrativeArchitecture: NarrativeArchitecture;
  trustStakes: TrustStakes;
  demonstrationPattern: DemonstrationPattern;
  demonstrationRequired: boolean;
  disclaimersRequiredCount: number;
  microMotifCount: number;
  promptCharCount: number;
  acceptanceStatus: 'pass' | 'warning' | 'fail' | 'legacy';
  disclaimerFound: boolean;
  demonstrationEvidence: boolean;
  issueCodes: string[];
  contractRenderedToFrontendBuilder: boolean;
  contractUsedByAcceptance: boolean;
  agentsActuallyConsumingContract: string[];
  upstreamEvidenceUsedToDeriveContract: string[];
}

export function buildExperienceIdentityDiagnostics(
  contract: ExperienceIdentityContract | undefined,
  acceptance: ExperienceIdentityAcceptanceResult | undefined,
  promptCharCount: number,
): ExperienceIdentityDiagnostics | undefined {
  if (!contract || contract.status !== 'derived') return undefined;
  const rendered = promptCharCount > 0;
  const analyzed = !!acceptance && !acceptance.legacy;
  return {
    version: 'experience-identity-v1',
    category: contract.category,
    businessModelClass: contract.businessModelClass,
    personality: contract.personality,
    narrativeArchitecture: contract.narrativeArchitecture,
    trustStakes: contract.trust.stakes,
    demonstrationPattern: contract.demonstration.pattern,
    demonstrationRequired: contract.demonstration.required,
    disclaimersRequiredCount: contract.trust.disclaimersRequired.length,
    microMotifCount: contract.microMotifs.length,
    promptCharCount: Math.max(0, Math.round(promptCharCount)),
    acceptanceStatus: acceptance ? (acceptance.legacy ? 'legacy' : acceptance.status) : 'legacy',
    disclaimerFound: acceptance?.disclaimerFound ?? false,
    demonstrationEvidence: acceptance?.demonstrationEvidence ?? false,
    issueCodes: experienceIdentityIssueCodes(acceptance),
    contractRenderedToFrontendBuilder: rendered,
    contractUsedByAcceptance: analyzed,
    agentsActuallyConsumingContract: uniq([...(rendered ? ['frontend-builder-prompt'] : []), ...(analyzed ? ['frontend-acceptance'] : [])]),
    upstreamEvidenceUsedToDeriveContract: contract.upstreamEvidenceUsedToDeriveContract,
  };
}
