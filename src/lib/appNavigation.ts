/**
 * Navigation Contract (Phase 2) — the app-specific routing authority, fed by the
 * AppArchitectureContract. It owns the concrete ROUTES, the default route, the
 * navigation model (tabs / sidebar / stack drill-down / modal destinations), back
 * behavior and deep-link-compatible route identities. Every visible navigation
 * control it declares targets a REAL screen — there are no dead routes.
 *
 * For this first App Build tier it standardizes on the routing dependency the repo
 * already ships (react-router v7) rather than adding anything new; the contract is
 * router-agnostic data, so a future adapter can consume it unchanged.
 *
 * Pure, deterministic, network-free, bounded, JSON-serializable, fail-open.
 */
import type { AppArchitectureContract, AppShellType, ScreenRole } from '@/lib/appArchitecture';

export type NavPlacement =
  | 'sidebar'      // persistent left rail (functional/desktop apps)
  | 'tab-bar'      // bottom tab bar (consumer apps)
  | 'top-nav'      // top navigation bar (browse-led apps)
  | 'stack'        // drill-in only, back-driven (utilities / detail chains)
  | 'modal';       // presented over the current screen (create/edit sheets)

export interface AppRoute {
  /** Router path, e.g. '/' or '/contacts' or '/contacts/:id'. */
  path: string;
  /** The screen id this route renders. */
  screenId: string;
  /** Display label for a nav control (present only for navigable routes). */
  label?: string;
  /** Where this route surfaces in the chrome. */
  placement: NavPlacement;
  /** True ⇒ appears in the primary nav (top-level). */
  primary: boolean;
  /** Parent route path for a nested/drill-in route (back target). */
  parentPath?: string;
  /** Whether the route takes a dynamic param (deep-linkable record). */
  dynamic: boolean;
}

export interface NavigationContract {
  version: 'app-navigation-v1';
  /** react-router-compatible; kept explicit so a native adapter can branch. */
  router: 'react-router';
  /** The route the app opens on. */
  defaultRoute: string;
  /** Where the PRIMARY navigation lives (mirrors the architecture shell). */
  primaryNav: NavPlacement;
  /** All routes (primary + drill-in + modal), deduped, each targeting a real screen. */
  routes: AppRoute[];
  /** Back behavior summary (how drill-in screens return). */
  backBehavior: string;
  notes: string[];
}

/* ── Helpers ─────────────────────────────────────────────────────────────────── */

const NOTE_CAP = 5;
/** Roles that are naturally presented as a modal/sheet over the current screen
 *  rather than a full routed destination — kept honest (trigger → open → close). */
const MODAL_ROLES: ReadonlySet<ScreenRole> = new Set<ScreenRole>(['create', 'edit']);

function shellToPlacement(shell: AppShellType): NavPlacement {
  switch (shell) {
    case 'sidebar': return 'sidebar';
    case 'tab-bar': return 'tab-bar';
    case 'top-nav': return 'top-nav';
    case 'stacked': return 'stack';
    case 'none': return 'stack';
    default: return 'top-nav';
  }
}

/* ── Derivation ──────────────────────────────────────────────────────────────── */

export function deriveNavigationContract(arch: AppArchitectureContract | undefined): NavigationContract | undefined {
  if (!arch || !Array.isArray(arch.screens) || arch.screens.length === 0) return undefined;
  try {
    const primaryNav = shellToPlacement(arch.shell);
    const byId = new Map(arch.screens.map((s) => [s.id, s]));
    const routes: AppRoute[] = [];
    const seenPaths = new Set<string>();

    const pushRoute = (r: AppRoute): void => {
      if (seenPaths.has(r.path)) return;
      seenPaths.add(r.path);
      routes.push(r);
    };

    // Primary (top-level) routes — the entry screen gets '/'.
    const entryId = arch.primaryEntryScreenId;
    for (const s of arch.screens) {
      if (!s.global) continue;
      const isEntry = s.id === entryId;
      pushRoute({
        path: isEntry ? '/' : `/${s.id}`,
        screenId: s.id,
        label: s.name,
        placement: primaryNav,
        primary: true,
        dynamic: false,
      });
    }

    // Drill-in / local routes — nested under their parent (deep-linkable when a
    // record). create/edit become modal destinations over their parent, never a
    // dead top-level tab.
    for (const s of arch.screens) {
      if (s.global) continue;
      const parent = s.parentId ? byId.get(s.parentId) : undefined;
      const parentPath = parent ? (parent.id === entryId ? '/' : `/${parent.id}`) : undefined;
      const isModal = MODAL_ROLES.has(s.role);
      const isRecord = s.role === 'detail' || s.role === 'messaging';
      const path = parentPath && parentPath !== '/'
        ? `${parentPath}/${isRecord ? ':id' : s.id}`
        : `/${s.id}${isRecord ? '/:id' : ''}`;
      pushRoute({
        path,
        screenId: s.id,
        placement: isModal ? 'modal' : 'stack',
        primary: false,
        parentPath: parentPath || undefined,
        dynamic: isRecord,
      });
    }

    // Guarantee every route targets a real screen (defensive; no dead targets).
    const cleaned = routes.filter((r) => byId.has(r.screenId));
    const defaultRoute = cleaned.find((r) => r.path === '/')?.path || cleaned[0]?.path || '/';

    const hasDrill = cleaned.some((r) => !r.primary && r.placement === 'stack');
    const hasModal = cleaned.some((r) => r.placement === 'modal');
    const backBehavior = hasDrill || hasModal
      ? 'Drill-in screens push onto a stack and return to their parent via a back control; modal create/edit dismiss back to the underlying screen.'
      : 'Top-level screens switch in place; there is no drill-in stack.';

    const notes: string[] = [
      `primaryNav=${primaryNav}; ${cleaned.filter((r) => r.primary).length} primary, ${cleaned.filter((r) => !r.primary).length} drill-in/modal routes.`,
      hasModal ? 'create/edit are modal/sheet destinations (honest open/close), not tabs.' : '',
      'Every nav control targets a declared screen — no dead routes.',
    ].filter(Boolean).slice(0, NOTE_CAP);

    return {
      version: 'app-navigation-v1',
      router: 'react-router',
      defaultRoute,
      primaryNav,
      routes: cleaned,
      backBehavior,
      notes,
    };
  } catch {
    return undefined;
  }
}

/* ── Generation block ────────────────────────────────────────────────────────── */

export function renderNavigationBlock(nav: NavigationContract | undefined): string[] {
  if (!nav) return [];
  const out: string[] = [];
  out.push('[APP NAVIGATION]');
  out.push(`Router: react-router (already a dependency). Default route: ${nav.defaultRoute}. Primary navigation: ${nav.primaryNav}.`);
  out.push('Wire these EXACT routes (each renders the named screen). Every navigation control must target a real route below — no dead links, no placeholder navigation:');
  for (const r of nav.routes) {
    const kind = r.primary ? 'primary' : r.placement;
    out.push(`- ${r.path} → ${r.screenId}${r.label ? ` ("${r.label}")` : ''} [${kind}${r.dynamic ? ', dynamic :id' : ''}]`);
  }
  out.push(`Back behavior: ${nav.backBehavior}`);
  return out;
}
