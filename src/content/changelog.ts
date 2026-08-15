/**
 * Changelog entries for `/changelog`.
 *
 * HONESTY: these entries are derived from the repository's own merged history —
 * real dates, real capability changes — and nothing else. No release was
 * invented, no version number was made up (the product does not publish
 * versions), and no entry was back-dated to make the timeline look longer.
 *
 * The available history in this checkout begins on 2026-08-09, so the page says
 * plainly that it covers notable recent releases rather than pretending to be a
 * complete product history. Entries are user-facing: internal refactors,
 * test-only changes and cost/latency work are summarized or omitted rather than
 * dumped as commit titles.
 *
 * ENGLISH-ONLY long-form (page chrome is localized — see `src/content/docs.ts`).
 */

export interface ChangelogEntry {
  /** ISO date of the merge that shipped it. */
  date: string;
  title: string;
  body: string;
  /** Short area tag shown next to the entry. */
  tag: 'Connectors' | 'Projects' | 'App Build' | 'Web Build' | 'Security';
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-08-16',
    tag: 'Connectors',
    title: 'Slack connector',
    body: 'Connect a Slack workspace to a project and choose the channels it should read. Recent conversation in those channels becomes project signals. Read-only: Korvix cannot send, edit or delete a message, and never joins a channel by itself. A channel the app cannot actually read is refused rather than connected.',
  },
  {
    date: '2026-08-15',
    tag: 'Connectors',
    title: 'Google Calendar connector',
    body: 'Upcoming events, changes and cancellations for a project, using a read-only calendar scope. Calendar and Gmail stay separate connections even when they share a Google account, so disconnecting one leaves the other intact.',
  },
  {
    date: '2026-08-15',
    tag: 'Connectors',
    title: 'Vercel connector',
    body: 'Read deployment status — production and preview, successes and failures — for one Vercel project you select. Read-only: no deploys, promotions, rollbacks or environment changes.',
  },
  {
    date: '2026-08-15',
    tag: 'Projects',
    title: 'Project context reaches your conversations',
    body: 'The active project is now carried into live requests, so a conversation started inside a project begins with that project\'s context instead of an empty slate.',
  },
  {
    date: '2026-08-15',
    tag: 'Projects',
    title: 'Project Overview became the project home',
    body: 'Opening a project now lands on the durable workspace — its chats, the products generated for it, and the project context — instead of a build tool. You can also add an existing chat to a project, or remove one.',
  },
  {
    date: '2026-08-14',
    tag: 'Connectors',
    title: 'Gmail connector and the Connectors surface',
    body: 'A per-project Connectors screen with real backend wiring, plus a read-only Gmail connection. Every connector is scoped to a single project and enforces project ownership on the server.',
  },
  {
    date: '2026-08-13',
    tag: 'Connectors',
    title: 'GitHub connector',
    body: 'Connect one repository per project to bring repository activity, pull requests and checks into project context. Read-only: no pushes, merges, comments or deploys. Repository events are signature-verified before they are read.',
  },
  {
    date: '2026-08-12',
    tag: 'App Build',
    title: 'App Build: multi-screen applications',
    body: 'App Build moved onto the production build spine and now generates client-routed React applications with real screens, routes and navigation derived from what the app is for. It produces a web application that runs in the browser.',
  },
  {
    date: '2026-08-11',
    tag: 'Web Build',
    title: 'Web Build quality pass',
    body: 'Improvements to generated sites: better image selection and art direction, deeper page structure, more considered interaction detail, and a preview that reflects what was actually produced.',
  },
];

/** The oldest date this changelog can speak to, from the available history. */
export const CHANGELOG_HISTORY_START = '2026-08-09';
