/**
 * sidebarNav — the chat sidebar's TOP-LEVEL navigation model.
 *
 * WHY A PURE MODULE
 * -----------------
 * The sidebar's information hierarchy is a product decision, not a styling
 * detail: workspace-level destinations (Projects, Connectors) must sit ABOVE the
 * chat history, never below it, or they become invisible the moment a user has
 * more than a screenful of chats. Encoding that order here — instead of as the
 * incidental order of JSX in `components/Sidebar.tsx` — means the hierarchy can
 * be asserted in a test and cannot silently regress when the component is
 * reshuffled.
 *
 * Every destination is an EXISTING route. This module invents no navigation:
 *   • `/projects`             — the Projects overview (ProjectsDashboard)
 *   • `/settings/integrations`— the Connectors page (ConnectorsPage)
 *   • `/projects?new=1`       — the Projects overview with its OWN create-project
 *                               modal already open. `?new=1` is a pre-existing
 *                               entry point (the workspace's "Project not found"
 *                               recovery screen links here), so the sidebar's
 *                               "New project" action reuses the authoritative
 *                               creation flow rather than adding a second modal,
 *                               store or API.
 */

export type SidebarNavKey = 'projects' | 'connectors';

export interface SidebarNavItem {
  key: SidebarNavKey;
  /** i18n key resolved through the language store (never a literal label). */
  labelKey: string;
  /** Existing router path this row navigates to. */
  to: string;
  /** Path prefix that marks this row as the current page. */
  match: string;
}

/**
 * Workspace destinations, in render order, pinned directly under "New chat".
 *
 * Projects comes first (it is the primary organising concept) and Connectors
 * sits immediately next to it. Neither may be placed after the chat lists.
 */
export const SIDEBAR_TOP_NAV: readonly SidebarNavItem[] = [
  { key: 'projects', labelKey: 'projects', to: '/projects', match: '/projects' },
  { key: 'connectors', labelKey: 'connectors', to: '/settings/integrations', match: '/settings/integrations' },
] as const;

/**
 * Opens the EXISTING create-project modal on the Projects overview.
 * See the module docstring: `?new=1` is the pre-existing deep link.
 */
export const NEW_PROJECT_ROUTE = '/projects?new=1';

/** The project overview route for a project id (the real, existing route). */
export function projectRoute(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

/**
 * Is this nav row the current page?
 *
 * Exact match, or a child path (`/projects/p1` still highlights Projects). A
 * path that merely shares a text prefix (`/projects-archive`) does NOT match.
 */
export function isTopNavActive(item: SidebarNavItem, pathname: string): boolean {
  if (!pathname) return false;
  if (pathname === item.match) return true;
  return pathname.startsWith(`${item.match}/`);
}

/**
 * Sidebar shell classes — extracted so the responsive contract is testable.
 *
 * TWO modes, unchanged from before this refactor:
 *   • sub-lg (phones / iPad portrait): `fixed` overlay that slides in and out
 *     over the content, capped at 85vw so it can never exceed the viewport;
 *   • lg+ (desktop): a `relative` flex SIBLING whose width is hard-locked, and
 *     which collapses to zero width when closed so main content expands.
 *
 * Width lives entirely in utility classes (never an inline `style.width`), or
 * the `lg:` overrides lose to inline specificity and the sidebar stays stuck at
 * the mobile width on iPad landscape.
 */
export function sidebarShellClasses(isOpen: boolean): string {
  return [
    'z-50 flex flex-col overflow-hidden min-w-0 transition-all duration-300 ease-out',
    'fixed inset-y-0 left-0 w-[min(260px,85vw)] max-w-[85vw]',
    isOpen ? 'translate-x-0' : '-translate-x-full',
    'lg:relative lg:inset-y-auto lg:left-auto lg:translate-x-0 lg:flex-none',
    isOpen
      ? 'lg:w-[288px] lg:min-w-[288px] lg:max-w-[288px]'
      : 'lg:w-0 lg:min-w-0 lg:max-w-0',
  ].join(' ');
}

/**
 * Should a project group render expanded?
 *
 * An explicit user toggle always wins. With no toggle recorded, the group that
 * owns the ACTIVE chat defaults to open, so opening a project chat from any
 * surface (sidebar, Project Overview deep link, reload) reveals it. This is a
 * DERIVED default rather than stored state — nothing writes to state during
 * render or in an effect.
 */
export function isProjectGroupExpanded(
  projectId: string,
  toggles: Record<string, boolean>,
  activeProjectGroup: string | null,
): boolean {
  const explicit = toggles[projectId];
  if (typeof explicit === 'boolean') return explicit;
  return projectId === activeProjectGroup;
}
