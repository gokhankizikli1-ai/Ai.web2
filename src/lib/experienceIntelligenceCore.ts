/* ────────────────────────────────────────────────────────────────────────────
 * experienceIntelligenceCore.ts — the LEAF of Experience Intelligence.
 *
 * The shared vocabulary, the direction interfaces and the bounded helpers, in a
 * module that imports nothing from its own family. It exists purely so the core
 * derivation (`experienceIntelligence.ts`) can import the web and app adapters at
 * runtime while those adapters import the shared types and helpers — with NO
 * circular import between them.
 *
 * Nothing here derives, renders, or performs IO. `experienceIntelligence.ts`
 * re-exports every symbol below, so consumers only ever import from there.
 * ──────────────────────────────────────────────────────────────────────────── */
import type {
  FrontendSpecIdentity, FrontendSpecSection, FrontendSpecImageSlot, FrontendBindingRequirements,
} from '@/lib/webBuildAgents';
import type { BuildType } from '@/lib/buildType';
import type { DesignIntelligenceContract } from '@/lib/webBuildDesignIntelligence';
import type { ImageCoverageRequirement } from '@/lib/webBuildImageCoverage';
import type { AppArchitectureContract } from '@/lib/appArchitecture';
import type { AppVisualContract } from '@/lib/appVisualAdapter';
import type { NavigationContract } from '@/lib/appNavigation';
// Type-only (erased at build time), so the contract can name its two adapters without
// creating any runtime edge back to them. The runtime graph stays: adapters → this leaf.
import type { WebExperienceDirection } from '@/lib/experienceIntelligenceWeb';
import type { AppExperienceDirection } from '@/lib/experienceIntelligenceApp';

/* ── Bounds ──────────────────────────────────────────────────────────────────── */
export const MAX_TEXT = 160;
export const MAX_LIST = 8;
export const MAX_SURFACES = 12;
export const MAX_EVIDENCE = 6;

/* ────────────────────────────────────────────────────────────────────────────
 * PUBLIC VOCABULARY — deliberately SHARED between web and app.
 * ──────────────────────────────────────────────────────────────────────────── */

/** What actually carries the experience. The single most consequential decision. */
export type ExperienceLead =
  | 'typography-led'
  | 'image-led'
  | 'interface-led'
  | 'editorial-led'
  | 'catalogue-led'
  | 'data-led'
  | 'narrative-led'
  | 'utility-led';

export type ExperienceDensity = 'sparse' | 'measured' | 'dense';

/** How attention is distributed on a surface (a page section set, or a screen). */
export type ExperienceHierarchy =
  | 'single-focus'         // one dominant thing; everything else is subordinate
  | 'primary-with-support' // one lead region plus deliberately quieter support
  | 'multi-region'         // several genuinely co-equal regions (a real workspace)
  | 'flat-scan';           // a scannable set of peers (a catalogue, an index)

/** What the visitor/user primarily DOES. Shared across both build types. */
export type PrimaryInteraction =
  | 'read' | 'browse' | 'evaluate-and-contact' | 'purchase'
  | 'operate' | 'create' | 'converse' | 'explore';

/** How the surfaces are put together. A strategy, never a template. */
export type CompositionStrategy =
  | 'anchored'          // a strong opening anchor, then supporting material
  | 'sequential'        // a designed sequence where order carries the meaning
  | 'grid-systematic'   // a systematic grid of comparable items
  | 'split-asymmetric'  // deliberate asymmetry; no mirrored 50/50 repetition
  | 'panelled'          // co-equal panels of one working surface
  | 'single-surface';   // one surface; navigation and chrome kept to a minimum

/** Whether the design needs a strong visual anchor at all. */
export type VisualAnchorNeed = 'required' | 'beneficial' | 'unnecessary';

/** How much the experience depends on visual media of its chosen primary kind. */
export type MediaNecessity = 'required' | 'beneficial' | 'optional' | 'unnecessary';

/** Concrete media vocabulary. `interface-preview` covers product/UI evidence. */
export type MediaKind =
  | 'hero-photography'
  | 'product-photography'
  | 'editorial-photography'
  | 'people-photography'
  | 'place-photography'
  | 'content-thumbnail'
  | 'illustration'
  | 'interface-preview'
  | 'diagram'
  | 'iconography'
  | 'background-media'
  | 'none';

/** Media policy for ONE surface (a web section or an app screen). */
export type SurfaceMediaPolicy = 'required' | 'beneficial' | 'optional' | 'none';

export type NarrativeMode =
  | 'informational' | 'persuasive' | 'editorial'
  | 'instructional' | 'transactional' | 'operational';

export type InformationDensity = 'low' | 'medium' | 'high';

export type MotionLevel = 'none' | 'minimal' | 'restrained' | 'expressive';

export type ShadowDepth = 'flat' | 'subtle' | 'layered';

/* ────────────────────────────────────────────────────────────────────────────
 * CONTRACT
 * ──────────────────────────────────────────────────────────────────────────── */

/** The shared experience signature — the decisions that mean the same thing for a
 *  website and for an application. */
export interface ExperienceSignatureDirection {
  lead: ExperienceLead;
  /** Short human phrase for the intended character. Never printed on the product. */
  visualCharacter: string;
  density: ExperienceDensity;
  hierarchy: ExperienceHierarchy;
  primaryInteraction: PrimaryInteraction;
  composition: CompositionStrategy;
  visualAnchor: VisualAnchorNeed;
  /** Whether a repeated card/tile treatment is the right instrument here at all. */
  cardsAppropriate: boolean;
  /** Whether charts / dashboards are justified by the product (never as filler). */
  chartsJustified: boolean;
  /** The classification this build inherited, and WHO owns it (never re-decided here). */
  archetypeRef: { value: string; owner: 'designIntelligence' | 'appArchitecture' | 'identity' | 'adaptive' };
  /** Why this signature — bounded, evidence-based, debuggable. */
  rationale: string;
  evidence: string[];
}

export interface MediaSurfacePolicy {
  id: string;
  policy: SurfaceMediaPolicy;
  kind: MediaKind;
}

/** The media verdict. This is the canonical answer to "does this need images at all?". */
export interface MediaDirection {
  necessity: MediaNecessity;
  /** The FIRST/entry visual. Neutral name on purpose: web reads it as the hero, an app
   *  reads it as the entry screen's lead visual. Never the word "hero" in app output. */
  leadVisual: 'required' | 'optional' | 'forbidden';
  primaryKind: MediaKind;
  supportingKinds: MediaKind[];
  forbiddenKinds: MediaKind[];
  imageryPriority: 'lead' | 'support' | 'incidental' | 'none';
  surfaces: MediaSurfacePolicy[];
  /** Where typography / layout / real interface is a STRONGER answer than an image. */
  strongerWithoutMedia: string[];
  rationale: string;
  evidence: string[];
  /** Owners this verdict defers to for the hard floor + per-image art direction. */
  deferralNote: string;
  /**
   * True when another authority already states the imagery VOCABULARY for this build (subject
   * guidance, crop roles, forbidden treatments) — today that is Design Intelligence's image-intent
   * tier on a web build. The verdict, the lead-visual decision and the per-surface policy are
   * always ours; when this is true the rendered block omits the media-kind lists and defers to that
   * owner instead, so the request carries ONE imagery vocabulary rather than two overlapping ones.
   */
  vocabularyOwnedElsewhere: boolean;
}

export interface ContentDirection {
  narrativeMode: NarrativeMode;
  informationDensity: InformationDensity;
  /** STRUCTURAL content roles the product needs. Never an instruction to invent facts. */
  requiredContentRoles: string[];
  optionalContentRoles: string[];
  /** Content shapes that would be filler for THIS product. */
  avoidPatterns: string[];
  /** Named fact slots the structures above have. Labelled, never invented. */
  factualSlots: string[];
  factualPolicy: string;
  /** Claims that may never be invented BEYOND the specification's shared honesty rules. */
  additionalNeverFabricate: string[];
  /** True when the roles were sourced from an existing owner (so we do not restate them). */
  rolesOwnedElsewhere: boolean;
}

export interface AboveFoldBudget {
  maxMediaAssets: number;
  maxAnimatedLayers: number;
  note: string;
}

export interface MotionBudget {
  level: MotionLevel;
  maxSimultaneousAnimations: number;
  note: string;
}

export interface VisualComplexityBudget {
  maxBlurLayers: number;
  shadowDepth: ShadowDepth;
  note: string;
}

/**
 * The optimization STRATEGY — decided with the experience, not bolted on after it.
 *
 * `priorityOrder` is binding and is the reason this is safe: an optimization that
 * damages a higher-order goal is rejected rather than applied. `protectedElements`
 * and `protectedFiles` are the concrete data the deterministic optimization pass and
 * the repair-authority digest use to enforce that.
 */
export interface OptimizationDirection {
  imageStrategy: string;
  responsiveMedia: string;
  lazyLoading: 'below-fold' | 'all-non-lead' | 'not-applicable';
  aboveFold: AboveFoldBudget;
  motion: MotionBudget;
  visualComplexity: VisualComplexityBudget;
  mobileSimplification: string[];
  dependencyPolicy: string;
  domPolicy: string;
  /** Binding order. Index 0 wins every conflict. */
  priorityOrder: string[];
  /** Concrete things an optimization may NEVER remove or weaken. */
  protectedElements: string[];
  /** Component files an optimization may never propose deleting (planned surfaces). */
  protectedFiles: string[];
  /** Media slot ids that must survive every optimization. */
  protectedMediaSlotIds: string[];
}

export interface ExperienceIntelligenceContract {
  version: 'experience-intelligence-v1';
  buildType: BuildType;
  experience: ExperienceSignatureDirection;
  media: MediaDirection;
  content: ContentDirection;
  optimization: OptimizationDirection;
  /** WEB builds only. Undefined for every app build (enforced + regression-tested). */
  web?: WebExperienceDirection;
  /** APP builds only. Undefined for every web build (enforced + regression-tested). */
  app?: AppExperienceDirection;
  /** Generic AI-design signatures this build must not reproduce (evidence-scoped). */
  avoidSignatures: string[];
}

export interface ExperienceIntelligenceInput {
  prompt: string;
  /**
   * The build language. Recorded for diagnostics; it deliberately does NOT select which lexicon
   * runs. Both the English and Turkish lexicons are matched against every request, because the
   * declared language is inferred and a request routinely mixes languages ("bir SaaS landing page
   * yap"). Selecting by declared language would silently blind the evidence channel whenever that
   * inference is wrong — matching both costs a few regex tests and never can.
   */
  language?: string;
  buildType: BuildType;
  identity?: FrontendSpecIdentity;
  /** Free brief text (core idea / audience / style) — an additional prompt-channel signal. */
  briefText?: string;
  binding?: FrontendBindingRequirements;
  primaryCTA?: string;

  /* ── WEB evidence (ignored for an app build) ── */
  sections?: FrontendSpecSection[];
  designIntelligence?: DesignIntelligenceContract;
  imageCoverage?: ImageCoverageRequirement;
  imageSlots?: FrontendSpecImageSlot[];
  /** The page-composition contract. Read ONLY for its per-section `mediaRole` — the authority
   *  that already decided which sections carry media. Consumed, never re-derived. */
  composition?: import('@/lib/webBuildComposition').CompositionContract;
  /** Planned section component files — protected from "delete the dead file" advice. */
  requiredComponentFiles?: string[];

  /* ── APP evidence (ignored for a web build) ── */
  appArchitecture?: AppArchitectureContract;
  appVisual?: AppVisualContract;
  navigation?: NavigationContract;
}

/* ────────────────────────────────────────────────────────────────────────────
 * HELPERS (pure, bounded)
 * ──────────────────────────────────────────────────────────────────────────── */
export const clipText = (s: unknown, n = MAX_TEXT): string => {
  const t = (typeof s === 'string' ? s : '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export const boundedList = (xs: ReadonlyArray<string | undefined | null>, n = MAX_LIST, itemMax = MAX_TEXT): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const t = clipText(x, itemMax);
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= n) break;
  }
  return out;
};

/** Bound a rendered block to its documented ceiling without cutting mid-line. */
export function boundBlock(lines: string[], ceiling: number): string[] {
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
