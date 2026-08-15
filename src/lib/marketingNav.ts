/**
 * Public information architecture — the single source of truth for the
 * marketing header, the mega menus, and the mega footer.
 *
 * Rules encoded here (verified by `marketingNav.test.ts`):
 *   1. Every destination resolves to a REGISTERED PUBLIC route
 *      (see `src/lib/publicRoutes.ts`). No `href="#"`, no dead links, no
 *      authenticated-only surface advertised as a public page.
 *   2. Labels/descriptions are TRANSLATION KEYS resolved through the existing
 *      `t()` system (en / tr / de) — never hardcoded English in the chrome.
 *   3. In-page destinations use the `path#anchor` form. The app runs on
 *      HashRouter, and react-router's `parsePath` splits `/product#chat` into
 *      pathname `/product` + hash `#chat`, so these are real router links; the
 *      shared marketing shell scrolls to the anchor on navigation and on a cold
 *      direct load.
 *
 * The header renders `PRIMARY_NAV`; the footer renders `FOOTER_COLUMNS`.
 */

/** A leaf destination inside a menu or footer column. */
export interface NavLeaf {
  /** Translation key for the visible label. */
  labelKey: string;
  /** Optional translation key for the one-line description (mega menus). */
  descKey?: string;
  /** Router destination — `path` or `path#anchor`. */
  to: string;
}

/** A titled group of leaves inside a mega menu. */
export interface NavGroup {
  titleKey: string;
  items: NavLeaf[];
}

/** A top-level header entry: either a direct link or a menu. */
export type NavEntry =
  | { kind: 'link'; id: string; labelKey: string; to: string }
  | {
      kind: 'menu';
      id: string;
      labelKey: string;
      groups: NavGroup[];
      /** Optional single featured panel (used by Product only — kept restrained). */
      featured?: { titleKey: string; bodyKey: string; to: string; ctaKey: string };
      /** Panel width hint so a 1-column menu doesn't render as wide as Product. */
      size: 'wide' | 'compact';
    };

/* ── Connector catalog ──────────────────────────────────────────────────────
   The five connectors that actually exist in the product today
   (src/pages/ConnectorsPage.tsx + backend/routes/v2_{github,gmail,vercel,
   calendar,slack}.py). Every one is READ-ONLY toward the provider, project
   scoped, and refreshed by an explicit Sync — GitHub additionally receives
   repository events through its webhook. Nothing here is aspirational. */
export type ConnectorId = 'github' | 'gmail' | 'vercel' | 'calendar' | 'slack';

export interface ConnectorInfo {
  id: ConnectorId;
  /** Provider name — a proper noun, deliberately not translated. */
  name: string;
  /** Translation key: what this connector brings into the project. */
  bringsKey: string;
  /** Translation key: the read-only boundary, stated plainly. */
  boundaryKey: string;
  /** How fresh data arrives. `events` = GitHub's webhook, plus manual sync. */
  refresh: 'sync' | 'events';
}

export const CONNECTORS: ConnectorInfo[] = [
  {
    id: 'github',
    name: 'GitHub',
    bringsKey: 'connGithubBrings',
    boundaryKey: 'connGithubBoundary',
    refresh: 'events',
  },
  {
    id: 'slack',
    name: 'Slack',
    bringsKey: 'connSlackBrings',
    boundaryKey: 'connSlackBoundary',
    refresh: 'sync',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    bringsKey: 'connVercelBrings',
    boundaryKey: 'connVercelBoundary',
    refresh: 'sync',
  },
  {
    id: 'gmail',
    name: 'Gmail',
    bringsKey: 'connGmailBrings',
    boundaryKey: 'connGmailBoundary',
    refresh: 'sync',
  },
  {
    id: 'calendar',
    name: 'Google Calendar',
    bringsKey: 'connCalendarBrings',
    boundaryKey: 'connCalendarBoundary',
    refresh: 'sync',
  },
];

/* ── Header ─────────────────────────────────────────────────────────────── */

export const PRIMARY_NAV: NavEntry[] = [
  {
    kind: 'menu',
    id: 'product',
    labelKey: 'navProduct',
    size: 'wide',
    groups: [
      {
        titleKey: 'navGroupBuild',
        items: [
          { labelKey: 'navWebBuildItem', descKey: 'navWebBuildDesc', to: '/product#web-build' },
          { labelKey: 'navAppBuildItem', descKey: 'navAppBuildDesc', to: '/product#app-build' },
        ],
      },
      {
        titleKey: 'navGroupWorkspace',
        items: [
          { labelKey: 'navChatItem', descKey: 'navChatDesc', to: '/product#chat' },
          { labelKey: 'navProjectsItem', descKey: 'navProjectsDesc', to: '/product#projects' },
          { labelKey: 'navResearchItem', descKey: 'navResearchDesc', to: '/product#research' },
        ],
      },
      {
        titleKey: 'navGroupIntelligence',
        items: [
          { labelKey: 'navConnectorsItem', descKey: 'navConnectorsDesc', to: '/product#connectors' },
          {
            labelKey: 'navIntelligenceItem',
            descKey: 'navIntelligenceDesc',
            to: '/product#project-intelligence',
          },
        ],
      },
    ],
    featured: {
      titleKey: 'navFeaturedTitle',
      bodyKey: 'navFeaturedBody',
      to: '/product#connectors',
      ctaKey: 'navFeaturedCta',
    },
  },
  {
    kind: 'menu',
    id: 'solutions',
    labelKey: 'navSolutions',
    size: 'compact',
    groups: [
      {
        titleKey: 'navGroupWhoFor',
        items: [
          { labelKey: 'solFoundersTitle', descKey: 'solFoundersNav', to: '/solutions#founders' },
          { labelKey: 'solDevelopersTitle', descKey: 'solDevelopersNav', to: '/solutions#developers' },
          { labelKey: 'solTeamsTitle', descKey: 'solTeamsNav', to: '/solutions#product-teams' },
          { labelKey: 'solAgenciesTitle', descKey: 'solAgenciesNav', to: '/solutions#agencies' },
        ],
      },
    ],
  },
  {
    kind: 'menu',
    id: 'resources',
    labelKey: 'navResources',
    size: 'wide',
    groups: [
      {
        titleKey: 'navGroupLearn',
        items: [
          { labelKey: 'navDocs', descKey: 'navDocsDesc', to: '/docs' },
          { labelKey: 'navTutorials', descKey: 'navTutorialsDesc', to: '/tutorials' },
          { labelKey: 'navHelp', descKey: 'navHelpDesc', to: '/help' },
        ],
      },
      {
        titleKey: 'navGroupTrust',
        items: [
          { labelKey: 'navChangelog', descKey: 'navChangelogDesc', to: '/changelog' },
          { labelKey: 'navSecurity', descKey: 'navSecurityDesc', to: '/security' },
          { labelKey: 'navRegionalPrivacy', descKey: 'navRegionalPrivacyDesc', to: '/privacy/regional' },
        ],
      },
    ],
  },
  { kind: 'link', id: 'company', labelKey: 'navCompany', to: '/about' },
  { kind: 'link', id: 'pricing', labelKey: 'navPricing', to: '/pricing' },
];

/* ── Footer ─────────────────────────────────────────────────────────────── */

export interface FooterColumn {
  titleKey: string;
  items: NavLeaf[];
}

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    titleKey: 'footerProduct',
    items: [
      { labelKey: 'navChatItem', to: '/product#chat' },
      { labelKey: 'navProjectsItem', to: '/product#projects' },
      { labelKey: 'navWebBuildItem', to: '/product#web-build' },
      { labelKey: 'navAppBuildItem', to: '/product#app-build' },
      { labelKey: 'navResearchItem', to: '/product#research' },
      { labelKey: 'navConnectorsItem', to: '/product#connectors' },
      { labelKey: 'navPricing', to: '/pricing' },
    ],
  },
  {
    titleKey: 'footerResources',
    items: [
      { labelKey: 'navDocs', to: '/docs' },
      { labelKey: 'navTutorials', to: '/tutorials' },
      { labelKey: 'navChangelog', to: '/changelog' },
      { labelKey: 'navHelp', to: '/help' },
      { labelKey: 'navSecurity', to: '/security' },
    ],
  },
  {
    titleKey: 'footerCompany',
    items: [
      { labelKey: 'footerAbout', to: '/about' },
      { labelKey: 'navSolutions', to: '/solutions' },
    ],
  },
  {
    titleKey: 'footerLegal',
    items: [
      { labelKey: 'legalNavPrivacy', to: '/privacy' },
      { labelKey: 'navRegionalPrivacy', to: '/privacy/regional' },
      { labelKey: 'legalNavTerms', to: '/terms' },
      { labelKey: 'legalNavCookies', to: '/cookies' },
      { labelKey: 'legalNavAup', to: '/acceptable-use' },
    ],
  },
];

/** Every destination advertised in the header or the footer, flattened. */
export function allNavDestinations(): string[] {
  const out: string[] = [];
  for (const entry of PRIMARY_NAV) {
    if (entry.kind === 'link') out.push(entry.to);
    else {
      for (const g of entry.groups) for (const i of g.items) out.push(i.to);
      if (entry.featured) out.push(entry.featured.to);
    }
  }
  for (const col of FOOTER_COLUMNS) for (const i of col.items) out.push(i.to);
  return out;
}

/** Every translation key referenced by the header or the footer, flattened. */
export function allNavLabelKeys(): string[] {
  const out: string[] = [];
  for (const entry of PRIMARY_NAV) {
    out.push(entry.labelKey);
    if (entry.kind === 'menu') {
      for (const g of entry.groups) {
        out.push(g.titleKey);
        for (const i of g.items) {
          out.push(i.labelKey);
          if (i.descKey) out.push(i.descKey);
        }
      }
      if (entry.featured) {
        out.push(entry.featured.titleKey, entry.featured.bodyKey, entry.featured.ctaKey);
      }
    }
  }
  for (const col of FOOTER_COLUMNS) {
    out.push(col.titleKey);
    for (const i of col.items) out.push(i.labelKey);
  }
  for (const c of CONNECTORS) out.push(c.bringsKey, c.boundaryKey);
  return out;
}
