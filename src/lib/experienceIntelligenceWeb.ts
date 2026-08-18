/* ────────────────────────────────────────────────────────────────────────────
 * experienceIntelligenceWeb.ts — the WEB adapter of Experience Intelligence.
 *
 * Translates the SHARED experience/media/content verdict into the vocabulary a
 * scrolling website is actually built in. It is deliberately NARROW, because the
 * web pipeline already owns most page-level decisions:
 *
 *   already owned — NOT restated here
 *     • per-section composition families + adjacency rhythm → composition
 *     • page composition strategy, brand character, responsive intent,
 *       anti-repetition budget, content architecture → designIntelligence
 *     • the signature hero VISUAL and per-image art direction → visualConcept
 *     • per-section message jobs + CTA hierarchy → contentNarrative
 *     • how complete the site must be for its type → siteDepth
 *
 *   owned HERE (nothing else states these)
 *     • the bridge from the media verdict to what the FIRST viewport is carried by
 *     • the page-level ARGUMENT ARC — the order in which the page makes its case
 *     • what leads / supports / stays subordinate in the marketing hierarchy
 *     • when the page has finished making its argument
 *     • the one rhythm obligation expressed in page terms (change of instrument)
 *
 * WEB ONLY. This module is never imported for an app build's direction — an app
 * contract carries `app` instead, and never carries a hero/marketing decision.
 *
 * Pure, deterministic, network-free, bounded, JSON-safe, fail-open.
 * ──────────────────────────────────────────────────────────────────────────── */
import type {
  ExperienceSignatureDirection, MediaDirection, ContentDirection,
  ExperienceIntelligenceInput, MediaKind,
} from '@/lib/experienceIntelligenceCore';
import { boundedList, clipText, boundBlock } from '@/lib/experienceIntelligenceCore';

const WEB_CHAR_CEILING = 1200;

/** What carries the first viewport. Derived FROM the media verdict, so the page can
 *  never be handed a photographic hero the media verdict called unnecessary. */
export type HeroMediaTreatment = 'photographic' | 'interface' | 'typographic' | 'illustrative' | 'catalogue' | 'none';

export interface WebExperienceDirection {
  heroMedia: HeroMediaTreatment;
  heroObligation: string;
  /** The ordered beats the page must make its case in. Beats, never section names. */
  argumentArc: string[];
  /** What leads, what supports, what stays subordinate. */
  marketingHierarchy: string[];
  /** One rhythm rule in page terms; section FAMILIES stay owned by composition. */
  rhythmObligation: string;
  /** When the page is finished — the antidote to padding a page to a standard length. */
  pageEndsWhen: string;
  /** Where the desktop and phone experiences must genuinely differ in MEDIA terms. */
  mediaResponsiveNote: string;
}

const HERO_BY_MEDIUM: Partial<Record<MediaKind, HeroMediaTreatment>> = {
  'hero-photography': 'photographic',
  'place-photography': 'photographic',
  'people-photography': 'photographic',
  'editorial-photography': 'photographic',
  'product-photography': 'catalogue',
  'content-thumbnail': 'catalogue',
  'interface-preview': 'interface',
  illustration: 'illustrative',
  diagram: 'interface',
  iconography: 'typographic',
  'background-media': 'photographic',
  none: 'none',
};

function heroTreatmentFor(media: MediaDirection, experience: ExperienceSignatureDirection): HeroMediaTreatment {
  if (media.leadVisual === 'forbidden') return 'typographic';
  if (experience.lead === 'typography-led') return 'typographic';
  // A publication's masthead is set in type; its photography belongs with the pieces, not as a
  // full-bleed banner over the front page. Only a REQUIRED image (a photo-essay-led request)
  // overrides that.
  if (experience.lead === 'editorial-led' && media.necessity !== 'required') return 'typographic';
  const mapped = HERO_BY_MEDIUM[media.primaryKind];
  if (!mapped) return 'typographic';
  if (mapped === 'photographic' && media.necessity === 'optional') return 'typographic';
  return mapped;
}

const HERO_OBLIGATION: Record<HeroMediaTreatment, string> = {
  photographic: 'The first viewport is carried by ONE real photograph that shows the actual subject. The headline sits with it, not on a coloured band above it. No gradient wash standing in for the photo.',
  interface: 'The first viewport is carried by real product evidence — an actual interface, output, table or result built in the page, not a picture of one and not a fabricated screenshot.',
  typographic: 'The first viewport is carried by TYPE: one confident statement, real scale contrast and deliberate spacing. No decorative image, no gradient panel, no glow behind the headline.',
  illustrative: 'The first viewport is carried by the illustration the request asked for, drawn as real CSS/SVG artwork — never a generic 3D blob or a stock vector.',
  catalogue: 'The first viewport shows the actual items — real product/content cards with their own imagery — rather than a marketing banner about them.',
  none: 'The first viewport carries the offer in words and structure alone; do not add media to fill it.',
};

/** The page-level argument arc. Derived from what the visitor came to do, so two
 *  unrelated products never receive the same sequence. */
function argumentArcFor(experience: ExperienceSignatureDirection, content: ContentDirection): string[] {
  switch (experience.primaryInteraction) {
    case 'read':
      return [
        'lead with the actual writing — a real piece, not a promise of writing',
        'then the breadth: what else is here and how it is organised',
        'then the point of view: who publishes this and why it is worth returning to',
        'then a single quiet way to keep reading (archive, subscribe, follow)',
      ];
    case 'purchase':
      return [
        'lead with the actual goods — what they are, what they look like, what they cost when the request supplied prices',
        'then the decision material: materials, sizes, variants, delivery and returns as structure',
        'then the reason to trust this seller, using only what the request supplied',
        'then the purchase path, with nothing between the visitor and it',
      ];
    case 'browse':
      return [
        'lead with the collection itself, not a statement about the collection',
        'then the ways in: categories, filters or a real index that changes what is shown',
        'then depth on one representative item so the visitor can judge quality',
        'then the way to continue (see everything / get in touch)',
      ];
    case 'explore':
      return [
        'lead with the strongest single piece of work',
        'then range: enough further work to prove it was not a one-off',
        'then the approach — how this work gets made',
        'then a direct, low-friction way to start a conversation',
      ];
    case 'operate':
      return [
        'lead with the working thing itself, operable in the page',
        'then what it does that is hard to do otherwise',
        'then the constraints an honest user needs to know',
        'then the way to start using it',
      ];
    case 'create':
      return [
        'lead with the thing the visitor will make',
        'then the shortest path from nothing to that result',
        'then what happens once they have made it',
        'then the way in',
      ];
    case 'converse':
      return [
        'lead with a real, working exchange rather than a description of one',
        'then what makes the exchange useful here',
        'then the boundaries of what it can do',
        'then the way to begin',
      ];
    case 'evaluate-and-contact':
    default:
      return [
        `lead with a concrete statement of what this is and who it is for — ${content.narrativeMode} register, no slogan`,
        'then the substance: what is actually delivered, specifically enough to be checked',
        'then the credibility material the request genuinely supplied — never invented proof',
        'then one honest next step with everything needed to take it',
      ];
  }
}

function marketingHierarchyFor(experience: ExperienceSignatureDirection, media: MediaDirection): string[] {
  const leadItem = media.leadVisual === 'required'
    ? 'LEADS: the required image and the single claim beside it'
    : experience.lead === 'interface-led'
      ? 'LEADS: the working product evidence'
      : experience.lead === 'catalogue-led'
        ? 'LEADS: the items themselves'
        : 'LEADS: one statement, set at real scale';
  return boundedList([
    leadItem,
    experience.hierarchy === 'flat-scan'
      ? 'SUPPORTS: the scan aids — filters, categories, ordering — kept visually quiet'
      : 'SUPPORTS: the two or three pieces of evidence that make the lead believable',
    'SUBORDINATE: navigation, legal, secondary links and any social proof the request did not supply — quiet, small, never competing with the lead',
    experience.chartsJustified ? '' : 'NOT PRESENT: metric bands, logo walls and dashboards this product has no evidence for',
  ], 4, 200);
}

export function deriveWebExperienceDirection(ctx: {
  experience: ExperienceSignatureDirection;
  media: MediaDirection;
  content: ContentDirection;
  input: ExperienceIntelligenceInput;
}): WebExperienceDirection | undefined {
  try {
    const { experience, media, content } = ctx;
    if (ctx.input.buildType !== 'web') return undefined;
    const heroMedia = heroTreatmentFor(media, experience);
    const sectionCount = (ctx.input.sections || []).length;
    return {
      heroMedia,
      heroObligation: HERO_OBLIGATION[heroMedia],
      argumentArc: argumentArcFor(experience, content),
      marketingHierarchy: marketingHierarchyFor(experience, media),
      rhythmObligation: clipText(
        sectionCount >= 4
          ? `Across these ${sectionCount} sections the page must change INSTRUMENT at least three times (type-led, media-led, list/table-led, working-surface-led). Two adjacent sections may never share the same shape. The composition block owns which family each section takes — this rule is about the page never settling into one repeated beat.`
          : 'Each section must take a visibly different shape from the one before it; the composition block owns which family each takes.',
        400,
      ),
      pageEndsWhen: clipText(
        `The page ends when the ${experience.primaryInteraction.replace(/-/g, ' ')} argument is complete. Do not extend it with a newsletter band, a stats strip or a second CTA section simply because a page "usually" has one.`,
        280,
      ),
      mediaResponsiveNote: media.necessity === 'unnecessary'
        ? 'There is no media to adapt; on a phone the type scale and spacing carry the hierarchy instead of shrinking a desktop layout.'
        : 'On a phone the lead image re-crops to keep its subject (it does not letterbox), and decorative images are dropped before any content or control is.',
    };
  } catch {
    return undefined;
  }
}

/** P2 — the web translation of the shared verdict. Empty for any non-web contract. */
export function renderWebExperienceBlock(web: WebExperienceDirection | undefined): string[] {
  if (!web) return [];
  const lines = [
    `PAGE DIRECTION — first viewport treatment: ${web.heroMedia}.`,
    web.heroObligation,
    'The page makes its case in this order (these are ARGUMENT BEATS, not section names — the',
    'section architecture above is authoritative for what the sections are called):',
    ...web.argumentArc.map((b, i) => `  ${i + 1}. ${b}`),
    'Attention hierarchy on the page:',
    ...web.marketingHierarchy.map((h) => `  - ${h}`),
    `Rhythm: ${web.rhythmObligation}`,
    `Ending: ${web.pageEndsWhen}`,
    `Phone: ${web.mediaResponsiveNote}`,
    '',
  ];
  return boundBlock(lines, WEB_CHAR_CEILING).concat('');
}
