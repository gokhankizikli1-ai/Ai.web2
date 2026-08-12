/**
 * Screen Depth & App Completeness Contract (Phase 3) — the app analogue of the web
 * siteDepth contract. It generalizes the useful "is this a COMPLETE, usable surface
 * of its type" principle into APP screen completeness, and it carries the app
 * state/interaction lifecycle obligations (control → handler → state → visible
 * consequence) per screen. It is the SINGLE app depth authority — it does not add a
 * second generic interaction analyzer; it composes the already-derived app
 * architecture (screen roles) into per-screen obligations.
 *
 * A screen is complete when it has enough useful UI + state for its ROLE (a
 * dashboard is a summary surface + real metrics + controls + downstream nav, not a
 * big heading and three cards). Lifecycle states are attached ONLY where the role
 * semantically requires them — not every screen gets every state. Honesty is
 * explicit: no faked payments/emails/account-creation/remote-saves; frontend
 * simulations are labelled.
 *
 * Pure, deterministic, network-free, bounded, JSON-serializable, fail-open.
 */
import type { AppArchitectureContract, AppScreenIdentity, ScreenRole, AppType } from '@/lib/appArchitecture';

export type LifecycleState =
  | 'idle' | 'loading' | 'empty' | 'populated' | 'error' | 'success'
  | 'selected' | 'disabled' | 'saving';

export interface AppInteractionObligation {
  id: string;
  /** The control the user operates. */
  control: string;
  /** What wires the control up (the handler). */
  handler: string;
  /** The state that changes. */
  state: string;
  /** The visible consequence the user sees. */
  visibleConsequence: string;
}

export interface ScreenCompleteness {
  screenId: string;
  role: ScreenRole;
  /** Minimum useful UI this screen must contain for its role (no filler). */
  requiredElements: string[];
  /** The wired interactions this screen must implement (never dead controls). */
  interactions: AppInteractionObligation[];
  /** Lifecycle states this screen must handle — role-derived, not universal. */
  lifecycleStates: LifecycleState[];
}

export interface ScreenDepthContract {
  version: 'app-screen-depth-v1';
  appType: AppType;
  screens: ScreenCompleteness[];
  /** App-wide obligations (navigation reachability, no dead controls, honesty). */
  globalObligations: string[];
  notes: string[];
}

/* ── Helpers ─────────────────────────────────────────────────────────────────── */

const ID_RE = /[^a-z0-9]+/g;
const mkId = (screenId: string, control: string): string =>
  `${screenId}-${control.toLowerCase().replace(ID_RE, '-')}`.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

const interaction = (
  screenId: string, control: string, handler: string, state: string, visibleConsequence: string,
): AppInteractionObligation => ({ id: mkId(screenId, control), control, handler, state, visibleConsequence });

/* ── Per-role completeness playbooks ─────────────────────────────────────────── */

/** Required elements + interactions + lifecycle per screen role. Derived from the
 *  screen's role and whether it is a top-level or drill-in screen. */
function completenessForRole(s: AppScreenIdentity): Omit<ScreenCompleteness, 'screenId' | 'role'> {
  const id = s.id;
  switch (s.role) {
    case 'dashboard':
    case 'analytics':
      return {
        requiredElements: [
          'A summary/overview surface (not just a large heading)',
          'At least 3 real metric or content tiles with meaningful values',
          'At least one control that changes the view (period / segment / filter)',
          'A path into a downstream screen (drill-in or navigation)',
        ],
        interactions: [
          interaction(id, 'period/segment control', 'onChange updates the active range/segment', 'selected range/segment state', 'the tiles and charts re-render for the new selection'),
        ],
        lifecycleStates: ['loading', 'populated', 'empty'],
      };
    case 'list':
      return {
        requiredElements: [
          'Multiple useful list items (never a single placeholder row)',
          'Search, filter or sort where the role justifies it',
          'Each row navigates or expands to its detail',
          'A clear empty state',
        ],
        interactions: [
          interaction(id, 'search/filter input', 'onChange sets the query/filter', 'query/filter state + derived visible list', 'the visible rows change to match'),
          interaction(id, 'row click', 'onClick navigates to the detail route', 'selected item / route', 'the detail screen opens for that item'),
        ],
        lifecycleStates: ['loading', 'empty', 'populated', 'selected'],
      };
    case 'detail':
      return {
        requiredElements: [
          'Substantive detail content for the item (more than a title)',
          'A primary action plus relevant secondary actions',
          'Related or contextual information',
          'A back path to where the user came from',
        ],
        interactions: [
          interaction(id, 'primary action', 'onClick performs the action locally', 'item / action state', 'a visible local consequence (status change, toast, updated field)'),
        ],
        lifecycleStates: ['loading', 'populated', 'error'],
      };
    case 'create':
    case 'edit':
      return {
        requiredElements: [
          'Meaningful fields for the entity (not a single input)',
          'Inline validation / feedback on the fields',
          'A submit action with a visible local success or error result',
        ],
        interactions: [
          interaction(id, 'field inputs', 'onChange updates form state', 'form field + validation state', 'invalid fields show inline feedback'),
          interaction(id, 'submit', 'onSubmit validates then applies locally', 'saving → success/error state', 'a visible saving indicator then a local success or error message'),
        ],
        lifecycleStates: ['idle', 'saving', 'success', 'error', 'disabled'],
      };
    case 'settings':
      return {
        requiredElements: [
          'Grouped settings (sections, not a flat list)',
          'Real local toggles / selects / inputs that hold state',
          'A clear saved/applied state',
        ],
        interactions: [
          interaction(id, 'toggle/select', 'onChange updates the setting', 'setting value state', 'the control reflects the new value immediately'),
        ],
        lifecycleStates: ['idle', 'saving', 'success'],
      };
    case 'search':
      return {
        requiredElements: ['A query input', 'A results area', 'A distinct empty-results state'],
        interactions: [
          interaction(id, 'query input', 'onChange runs the local search', 'query + results state', 'results update live; empty query and no-results are distinct'),
        ],
        lifecycleStates: ['idle', 'loading', 'empty', 'populated'],
      };
    case 'calendar':
    case 'booking':
      return {
        requiredElements: ['A calendar or agenda surface', 'Real event/slot items', 'A way to open/create in a slot', 'An empty-day state'],
        interactions: [
          interaction(id, 'slot/date select', 'onClick selects the slot/date', 'selected slot state', 'the selected slot is highlighted and its detail/create opens'),
        ],
        lifecycleStates: ['loading', 'empty', 'populated', 'selected'],
      };
    case 'messaging':
      return {
        requiredElements: ['A message thread', 'A composer', 'A send action'],
        interactions: [
          interaction(id, 'composer + send', 'onSubmit appends the message locally', 'messages + composer state', 'the new message appears in the thread and the composer clears'),
        ],
        lifecycleStates: ['empty', 'populated', 'saving'],
      };
    case 'cart':
    case 'checkout':
      return {
        requiredElements: ['Line items with quantities', 'A running total', 'A primary continue/checkout action (local only)'],
        interactions: [
          interaction(id, 'quantity control', 'onChange updates the quantity', 'cart line + total state', 'the line total and cart total update'),
        ],
        lifecycleStates: ['empty', 'populated', 'disabled'],
      };
    case 'home':
    case 'content':
      return {
        requiredElements: ['A primary content surface for the app', 'Entry actions into the main flows', 'A sensible empty/first-run state'],
        interactions: [
          interaction(id, 'primary entry action', 'onClick navigates into the main flow', 'route/selection state', 'the target screen opens'),
        ],
        lifecycleStates: ['loading', 'populated', 'empty'],
      };
    case 'tool':
      return {
        requiredElements: ['The primary input controls', 'A live, correct result', 'A reset/clear control'],
        interactions: [
          interaction(id, 'tool inputs', 'onChange recomputes the result', 'input + derived result state', 'the result updates live as inputs change'),
        ],
        lifecycleStates: ['idle', 'populated'],
      };
    case 'profile':
      return {
        requiredElements: ['Profile information', 'Editable preferences', 'A clear saved state'],
        interactions: [
          interaction(id, 'preference control', 'onChange updates the preference', 'preference state', 'the control reflects the change immediately'),
        ],
        lifecycleStates: ['idle', 'populated', 'saving'],
      };
    default:
      return {
        requiredElements: ['Useful content for the screen role', 'At least one wired interaction', 'A sensible empty/loading state where data is shown'],
        interactions: [
          interaction(id, 'primary control', 'onClick/onChange updates state', 'screen state', 'a visible consequence'),
        ],
        lifecycleStates: ['populated'],
      };
  }
}

/* ── Derivation ──────────────────────────────────────────────────────────────── */

export function deriveScreenDepthContract(arch: AppArchitectureContract | undefined): ScreenDepthContract | undefined {
  if (!arch || !Array.isArray(arch.screens) || arch.screens.length === 0) return undefined;
  try {
    const screens: ScreenCompleteness[] = arch.screens.map((s) => {
      const c = completenessForRole(s);
      return { screenId: s.id, role: s.role, ...c };
    });
    const globalObligations = [
      'Every navigation control targets a real screen/route — no dead links or placeholder navigation.',
      'No dead controls: every visible interactive control has a handler, updates state, and produces a visible consequence.',
      'No faked backend success: never simulate real payments, emails, account creation or remote saves as if they succeeded. Local-only/sample behavior must be labelled and behave honestly.',
      'Loading / empty / error states appear only where a screen actually renders data — do not manufacture states a screen does not need.',
    ];
    const notes = [
      `${screens.length} screens; lifecycle states derived per role (not universal).`,
      `${screens.reduce((n, s) => n + s.interactions.length, 0)} wired interaction obligations.`,
    ];
    return { version: 'app-screen-depth-v1', appType: arch.appType, screens, globalObligations, notes };
  } catch {
    return undefined;
  }
}

/* ── Dead-control detection (used by app structural validation in Phase 5) ────── */

export interface DeadControlFinding {
  screenId: string;
  control: string;
  reason: string;
}

/**
 * Detect likely DEAD controls in a screen's generated source: interactive elements
 * (button / [role=button] / input / select / toggle) that carry no React event
 * handler (onClick/onChange/onSubmit/onInput). Deterministic, source-text-only,
 * conservative (only flags elements with zero handler attributes). Used by app
 * structural validation to make "dead controls are detectable" real.
 */
export function findDeadControls(screenId: string, source: string): DeadControlFinding[] {
  const out: DeadControlFinding[] = [];
  if (typeof source !== 'string' || !source) return out;
  // Match opening tags for interactive elements.
  const tagRe = /<(button|input|select|textarea)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  let scanned = 0;
  while ((m = tagRe.exec(source)) && scanned < 200) {
    scanned += 1;
    const tag = m[1].toLowerCase();
    const attrs = m[2] || '';
    // A submit input inside a form is wired by the form's onSubmit — allow it.
    const isSubmit = /type\s*=\s*["']submit["']/i.test(attrs);
    const hasHandler = /\bon(Click|Change|Submit|Input|KeyDown|KeyUp|Toggle|Select)\s*=/.test(attrs);
    const isDisabledDecoration = /\bdisabled\b/.test(attrs);
    if (!hasHandler && !isSubmit && !isDisabledDecoration) {
      out.push({ screenId, control: tag, reason: `<${tag}> has no event handler (onClick/onChange/onSubmit)` });
    }
  }
  return out;
}

/* ── Generation block ────────────────────────────────────────────────────────── */

export function renderScreenDepthBlock(contract: ScreenDepthContract | undefined): string[] {
  if (!contract) return [];
  const out: string[] = [];
  out.push('[APP SCREEN DEPTH & STATE LIFECYCLE]');
  out.push('Each screen must be COMPLETE for its role (enough useful UI + real state), never a heading with three empty cards. For every interactive control: wire a handler, update state, and show a visible consequence — no dead controls.');
  for (const s of contract.screens) {
    out.push(`Screen ${s.screenId} [${s.role}]:`);
    for (const r of s.requiredElements) out.push(`  • ${r}`);
    for (const it of s.interactions) out.push(`  ↳ ${it.control} → ${it.handler} → ${it.state} → ${it.visibleConsequence}`);
    if (s.lifecycleStates.length) out.push(`  states: ${s.lifecycleStates.join(', ')}`);
  }
  out.push('Global obligations:');
  for (const g of contract.globalObligations) out.push(`  • ${g}`);
  return out;
}
