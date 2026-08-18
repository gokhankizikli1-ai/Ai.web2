/* ────────────────────────────────────────────────────────────────────────────
 * experienceIntelligenceApp.ts — the APP adapter of Experience Intelligence.
 *
 * Translates the SHARED experience/media/content verdict into the vocabulary a
 * client-routed, multi-screen application is actually built in.
 *
 *   already owned — NOT restated here
 *     • the screen inventory, roles, flows and the per-archetype product direction
 *       → appArchitecture (rendered as [APP ARCHITECTURE])
 *     • routes, default route, nav placement, back behaviour → appNavigation
 *     • per-screen required elements + state lifecycle → appScreenDepth
 *     • shell/app-bar/density/touch targets/component quality → appVisualAdapter
 *
 *   owned HERE (nothing else states these for an app)
 *     • the ENTRY SURFACE obligation — what the first screen must do, stated so it
 *       can never be read as "put a hero here"
 *     • the CHROME BUDGET — how much navigation furniture the content justifies,
 *       derived from the REQUEST rather than from the archetype table
 *     • the DIRECTION DELTAS — where this specific request overrides the archetype
 *       baseline, which is what stops the per-type direction being a template
 *     • control density + workflow density
 *     • the product-defining interaction, named from the request's own evidence
 *
 * APP ONLY. It never emits hero, page, section, scroll or marketing vocabulary, and
 * a web contract never carries it.
 *
 * Pure, deterministic, network-free, bounded, JSON-safe, fail-open.
 * ──────────────────────────────────────────────────────────────────────────── */
import type {
  ExperienceSignatureDirection, MediaDirection, ContentDirection, ExperienceIntelligenceInput,
} from '@/lib/experienceIntelligenceCore';
import { boundedList, clipText, boundBlock } from '@/lib/experienceIntelligenceCore';

const APP_CHAR_CEILING = 1200;

export type ChromeBudget = 'none' | 'minimal' | 'standard' | 'full';

export interface AppExperienceDirection {
  /** What the first screen must accomplish. Never a marketing opening. */
  entrySurfaceObligation: string;
  chromeBudget: ChromeBudget;
  chromeNote: string;
  /** The one interaction the product lives or dies by, named from request evidence. */
  definingInteraction: string;
  /** How much information one screen carries, and how it is grouped. */
  informationArchitecture: string[];
  controlDensity: string;
  workflowDensity: string;
  /** Where THIS request overrides the archetype baseline — the anti-template proof. */
  directionDeltas: string[];
  /** How the surface must genuinely change at a narrow width. */
  narrowWidthObligation: string;
  /** Whether any screen may carry media at all, in app terms. */
  mediaNote: string;
}

function chromeBudgetFor(input: ExperienceIntelligenceInput, experience: ExperienceSignatureDirection): ChromeBudget {
  const screens = (input.appArchitecture?.screens || []).length;
  // Prefer the ROUTING authority's primary destinations when it has resolved them (it is the
  // module that decides which screens actually surface in the chrome); fall back to the
  // architecture's global screen list when no navigation contract was derived.
  const primaryRoutes = (input.navigation?.routes || []).filter((r) => r && r.primary).length;
  const globals = primaryRoutes || (input.appArchitecture?.globalScreenIds || []).length;
  if (experience.lead === 'utility-led' || screens <= 2) return 'none';
  if (globals <= 2 || experience.density === 'sparse') return 'minimal';
  if (experience.density === 'dense' && globals >= 5) return 'full';
  return 'standard';
}

const CHROME_NOTE: Record<ChromeBudget, string> = {
  none: 'This product does not justify persistent navigation furniture. One working surface; anything secondary sits behind a single control. Do not add a sidebar, a top bar and a tab bar to a product with one job.',
  minimal: 'Keep the chrome to what the destinations require — a compact bar or rail, nothing more. Chrome must never occupy more of the first screen than the content it serves.',
  standard: 'The shell carries the real destinations and nothing else. Every visible navigation control targets a screen that exists; no placeholder entries, no decorative destinations in the nav.',
  full: 'This product genuinely needs a full shell (persistent navigation plus contextual chrome), but content must still dominate: the shell is quiet, the working surface is loud.',
};

/** Name the defining interaction from the request's own binding evidence first, and
 *  fall back to the architecture's primary flow — never to a generic phrase. */
function definingInteractionFor(input: ExperienceIntelligenceInput, experience: ExperienceSignatureDirection): string {
  const binding = (input.binding?.requirements || [])
    .find((r) => r && r.required && r.kind === 'interactive-experience');
  if (binding?.label) {
    return clipText(
      `"${binding.label}"${binding.dynamicOutcome ? ` — operating it must change ${binding.dynamicOutcome}` : ''}. It is the reason this app exists: it works on the first screen the user reaches, with local state and a visible consequence.`,
      280,
    );
  }
  const flow = (input.appArchitecture?.primaryFlows || [])[0];
  if (flow?.name && Array.isArray(flow.steps) && flow.steps.length) {
    return clipText(`"${flow.name}" (${flow.steps.join(' → ')}) must work end to end with real local state and a visible consequence at every step.`, 280);
  }
  const entry = input.appArchitecture?.screens?.find((s) => s.id === input.appArchitecture?.primaryEntryScreenId);
  if (entry?.primaryAction) {
    return clipText(`"${entry.primaryAction}" on ${entry.name} must work end to end with real local state and a visible consequence.`, 280);
  }
  return clipText(`The user's core act is to ${experience.primaryInteraction.replace(/-/g, ' ')} — that path must work end to end with real local state, not a static mock.`, 280);
}

function informationArchitectureFor(experience: ExperienceSignatureDirection, content: ContentDirection): string[] {
  const grouping = experience.hierarchy === 'multi-region'
    ? 'Group by the decision the user is making, not by data type: the fields needed for one decision sit together even when they come from different models.'
    : experience.hierarchy === 'flat-scan'
      ? 'One scannable set of peers, with the attributes a user compares on visible in the row itself — do not hide the deciding attribute behind a click.'
      : 'One dominant region per screen carries the reason the screen exists; everything else is explicitly subordinate to it.';
  return boundedList([
    grouping,
    content.informationDensity === 'high'
      ? 'Dense is fine, cluttered is not: use alignment, weight and rules to separate regions instead of wrapping each one in its own bordered card.'
      : 'Give each region enough space to be read at a glance; do not compress it to fit more regions on screen.',
    'Every collection surface needs its empty, loading and error states to say something specific about THIS product, not "No data".',
  ], 3, 240);
}

export function deriveAppExperienceDirection(ctx: {
  experience: ExperienceSignatureDirection;
  media: MediaDirection;
  content: ContentDirection;
  input: ExperienceIntelligenceInput;
}): AppExperienceDirection | undefined {
  try {
    const { experience, media, content, input } = ctx;
    if (input.buildType !== 'app') return undefined;
    const chromeBudget = chromeBudgetFor(input, experience);
    const entry = input.appArchitecture?.screens?.find((s) => s.id === input.appArchitecture?.primaryEntryScreenId);

    /* Direction DELTAS — where this request's own evidence moves the archetype
     * baseline. An empty list is honest: it means the baseline already fits. */
    const baseline = input.appArchitecture?.direction;
    const deltas = boundedList([
      experience.density === 'sparse' && /dense|information-dense/i.test(baseline?.informationDensity || '')
        ? 'The request asked for something simple: reduce the information density below this app type’s usual level — fewer regions per screen, not smaller ones.'
        : '',
      experience.density === 'dense' && /minimal|low/i.test(baseline?.informationDensity || '')
        ? 'The request asked for something comprehensive: carry more real information per screen than this app type usually would, using structure rather than more cards.'
        : '',
      !experience.chartsJustified
        ? 'This request contains no measurement intent: do NOT open with metric tiles or add a chart anywhere. The archetype baseline is not a licence to build a dashboard.'
        : '',
      chromeBudget === 'none' || chromeBudget === 'minimal'
        ? `Chrome budget for this request is ${chromeBudget}: less navigation furniture than this app type usually carries.`
        : '',
      media.leadVisual === 'forbidden'
        ? 'No lead image on the entry screen: this product’s first surface is operational, and imagery here would displace the work.'
        : '',
      !experience.cardsAppropriate
        ? 'A repeated card grid is not the right instrument for this product — compose with lists, tables, grouped rows or one working panel instead.'
        : '',
    ], 5, 240);

    return {
      entrySurfaceObligation: clipText(
        entry
          ? `The app opens on ${entry.name}. That screen must be immediately USEFUL: it shows ${entry.primaryInformation || 'the product’s real primary information'} and its primary action (${entry.primaryAction || 'the core action'}) is reachable without scrolling. It is an operational surface, not an introduction to the app.`
          : 'The entry screen must be immediately useful — real content and the primary action visible without scrolling. It is an operational surface, not an introduction to the app.',
        360,
      ),
      chromeBudget,
      chromeNote: CHROME_NOTE[chromeBudget],
      definingInteraction: definingInteractionFor(input, experience),
      informationArchitecture: informationArchitectureFor(experience, content),
      controlDensity: clipText(
        experience.density === 'dense'
          ? 'Controls are compact and consistently sized, grouped by the action they belong to. One dominant primary action per screen; everything else is secondary or ghost.'
          : experience.density === 'sparse'
            ? 'Few controls, generously spaced, each one obviously interactive. One primary action per screen and no competing emphasis.'
            : 'Controls are comfortably sized and consistent; exactly one action per screen carries primary emphasis.',
        280,
      ),
      workflowDensity: clipText(
        experience.primaryInteraction === 'operate' || experience.primaryInteraction === 'create'
          ? 'A multi-step task stays on one surface where it can: use inline editing, a side panel or a sheet before you send the user to another screen. Every step shows what changed.'
          : 'Keep the path short: the user should reach the thing they came for in one or two moves, and always know how to get back.',
        280,
      ),
      directionDeltas: deltas,
      narrowWidthObligation: clipText(
        'At 390px the layout genuinely re-composes: multi-region surfaces become one prioritised column, the shell adapts to a drawer or bottom tabs, and the primary action stays reachable. Nothing clips, nothing overflows horizontally, and no region is simply squeezed.',
        320,
      ),
      mediaNote: media.necessity === 'unnecessary' || media.primaryKind === 'none'
        ? 'This app needs no photography. Use iconography, type and real data structure; do not add decorative imagery or placeholder image frames.'
        : `Imagery here is ${media.necessity} and content-serving only (${media.primaryKind.replace(/-/g, ' ')}) — attached to real items, never a decorative banner.`,
    };
  } catch {
    return undefined;
  }
}

/** P2 — the app translation of the shared verdict. Empty for any non-app contract. */
export function renderAppExperienceBlock(app: AppExperienceDirection | undefined): string[] {
  if (!app) return [];
  const lines = [
    'APP EXPERIENCE DIRECTION (this refines the app architecture above — it never replaces it):',
    `- Entry surface: ${app.entrySurfaceObligation}`,
    `- Chrome budget (${app.chromeBudget}): ${app.chromeNote}`,
    `- The interaction this product lives or dies by: ${app.definingInteraction}`,
    ...app.informationArchitecture.map((i) => `- Information architecture: ${i}`),
    `- Control density: ${app.controlDensity}`,
    `- Workflow: ${app.workflowDensity}`,
    `- Narrow width: ${app.narrowWidthObligation}`,
    `- Imagery: ${app.mediaNote}`,
    ...(app.directionDeltas.length
      ? ['THIS REQUEST OVERRIDES THE APP-TYPE BASELINE — these take precedence over the archetype direction above:',
        ...app.directionDeltas.map((d) => `  • ${d}`)]
      : []),
    '',
  ];
  return boundBlock(lines, APP_CHAR_CEILING).concat('');
}
