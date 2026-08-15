/**
 * Documentation content for the public `/docs` hub.
 *
 * LANGUAGE: this long-form content is ENGLISH-ONLY by design. The marketing
 * chrome (navigation, footer, page furniture, notices) is fully localized
 * through the existing `t()` system in en / tr / de; translating and then
 * maintaining several thousand words of product documentation in three
 * languages is a separate content project, and silently mixing half-translated
 * documentation would be worse than a clearly-labelled English page. The page
 * shows a localized "available in English" notice for that reason.
 *
 * ACCURACY: every statement here was written from the repository — the chat
 * surface, the project surfaces (`src/pages/ProjectOverview.tsx`), the build
 * spine (`src/lib/buildType.ts`, `webBuild*`), the research service
 * (`backend/services/research`), and the five connector routes
 * (`backend/routes/v2_{github,gmail,vercel,calendar,slack}.py`). It documents
 * what the product does today; anything not shipped is either omitted or marked
 * as not available yet. There is no API reference here, because there is no
 * publicly supported API.
 */

export interface DocBlock {
  /** Paragraphs. */
  body?: string[];
  /** Bulleted points. */
  list?: string[];
  /** Ordered steps. */
  steps?: string[];
  /** A short, quiet callout (limits, boundaries, "not yet" facts). */
  note?: string;
}

export interface DocTopic {
  /** Anchor id — also the `/docs#id` destination. */
  id: string;
  title: string;
  summary: string;
  blocks: DocBlock[];
  /** Related tutorial slugs (rendered as links to /tutorials/:slug). */
  tutorials?: string[];
}

export const DOC_TOPICS: DocTopic[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    summary: 'Create an account, open the workspace, and understand what Korvix does with your first message.',
    blocks: [
      {
        steps: [
          'Create an account with email or continue with Google.',
          'You land in Chat — the workspace home. Type what you want to do in plain language.',
          'Korvix answers in the conversation. When your message describes something to build, it routes the request to Web Build or App Build instead of just replying.',
          'Create a project when the work is more than one question, so chats, generated products and connected tools stay together.',
        ],
      },
      {
        body: [
          'Korvix is one workspace with several surfaces rather than a collection of separate tools: conversation, research, building, projects and connected tools all point at the same project context.',
        ],
        note: 'Free during early access. Final prices and credit allocations are not locked yet — see Pricing.',
      },
    ],
    tutorials: ['create-first-project', 'build-first-website'],
  },
  {
    id: 'chat',
    title: 'Chat',
    summary: 'The workspace home: conversation, web research with sources, and the entry point to building.',
    blocks: [
      {
        body: [
          'Chat is where most work starts. Conversations are saved to your account, can be renamed, exported and deleted, and can be attached to a project at any time.',
        ],
        list: [
          'Ask questions and iterate in a normal conversation.',
          'When a question needs current information, Korvix can search the web and answers with the sources it used.',
          'Pick a mode — Chat, Website, App — or just describe what you want; Korvix routes clear build requests to the right builder.',
          'Move a chat into a project from the chat menu, so the project keeps it.',
        ],
      },
      {
        note: 'Web research depends on a configured search provider for the deployment you are using. If it is unavailable, Korvix answers from the conversation instead of inventing sources.',
      },
    ],
    tutorials: ['use-project-context'],
  },
  {
    id: 'projects',
    title: 'Projects',
    summary: 'A durable workspace for one piece of work: its chats, the products it produced, and the context around it.',
    blocks: [
      {
        body: [
          'A project is the unit Korvix reasons about. Open a project and you see the work attached to it rather than a global pile of conversations.',
        ],
        list: [
          'Chats — conversations attached to this project. Add an existing chat or start a new one.',
          'Products — websites and apps generated for this project.',
          'Project context — a bounded summary Korvix keeps: a short project summary, current goals, and recent signals from connected tools.',
        ],
      },
      {
        body: [
          'Projects are private to your account. Connectors are attached per project, so connecting a repository to one project never exposes it to another.',
        ],
        note: 'There are no shared team workspaces or seats yet — a project belongs to the account that created it.',
      },
    ],
    tutorials: ['create-first-project', 'use-project-context'],
  },
  {
    id: 'web-build',
    title: 'Web Build',
    summary: 'Describe a site; Korvix generates a responsive multi-section website you can refine through chat.',
    blocks: [
      {
        steps: [
          'Describe the site you want. If the description is thin, Korvix asks a few short design questions before it starts.',
          'Korvix plans the site — sections, content direction, visual system — then generates the files.',
          'The generated site opens in a preview you can browse, alongside the files it produced.',
          'Refine by describing changes in the conversation. Korvix updates the build rather than starting over.',
          'Save the result to a project so it stays with the rest of that work.',
        ],
      },
      {
        list: [
          'Responsive layouts intended to hold up from phone to desktop.',
          'A real component/file structure you can read, not a single opaque blob.',
          'Images sourced for the build, which you can replace with your own upload.',
        ],
        note: 'Publishing/hosting from Korvix and pushing a build into a GitHub repository are not available yet. The GitHub connector is read-only and does not receive builds.',
      },
    ],
    tutorials: ['build-first-website'],
  },
  {
    id: 'app-build',
    title: 'App Build',
    summary: 'Describe an app; Korvix generates a multi-screen React application that runs in the browser.',
    blocks: [
      {
        body: [
          'App Build targets applications rather than scrolling pages: it plans screens, routes and navigation, then generates a client-routed React/Vite application with stateful flows.',
        ],
        list: [
          'Screens are chosen from what you asked for — a CRM, a booking tool and a small utility do not get the same screen set.',
          'The app gets a navigation shell appropriate to its type (sidebar, tab bar, top navigation, or none).',
          'You refine it conversationally, the same way as a website build.',
        ],
        note: 'App Build produces a web application that runs in a browser. It is not a native iOS/Android build and does not produce an app-store package.',
      },
    ],
    tutorials: ['start-app-build'],
  },
  {
    id: 'research',
    title: 'Research',
    summary: 'Web research inside the conversation, answered with the sources it used.',
    blocks: [
      {
        body: [
          'Research is not a separate destination. When a question needs current information, Korvix searches the web, reads what it finds, and answers with a list of sources you can open.',
          'When that conversation belongs to a project, the findings stay with the project — so a later conversation or build starts from what was already established instead of from zero.',
        ],
        note: 'Sources are shown so you can verify them. AI output can still be wrong or out of date; check anything important before you rely on it.',
      },
    ],
    tutorials: ['use-project-context'],
  },
  {
    id: 'connectors',
    title: 'Connectors',
    summary: 'Read-only, per-project connections to GitHub, Slack, Vercel, Gmail and Google Calendar.',
    blocks: [
      {
        body: [
          'Connectors bring the activity around a project into the project itself. Each connection is scoped to one project and is read-only toward the provider.',
        ],
        steps: [
          'Open Connectors from the workspace and pick the project you want to connect.',
          'Start the connection for a provider. You authorize it in the provider\'s own consent screen.',
          'Where a provider exposes more than one resource, choose which one this project should read: a repository (GitHub), a project (Vercel), or channels (Slack).',
          'Run a sync. Korvix performs a bounded read and turns what it finds into project signals.',
          'Disconnect at any time from the same screen.',
        ],
      },
      {
        list: [
          'GitHub — repository activity, pull requests and checks. It also receives repository events, so activity can arrive without a manual sync.',
          'Slack — recent conversation in the channels you select. Korvix never joins a channel by itself.',
          'Vercel — deployment status for the Vercel project you select, including failures.',
          'Gmail — recent mail context for the project.',
          'Google Calendar — upcoming events, changes and cancellations.',
        ],
        note: 'None of these can write: Korvix cannot push, merge, comment, deploy, roll back, send mail, post a Slack message, or create a calendar event. See Security for how the credentials are handled.',
      },
    ],
    tutorials: ['connect-github', 'connect-slack', 'connect-vercel', 'connect-gmail', 'connect-google-calendar'],
  },
  {
    id: 'project-intelligence',
    title: 'Project intelligence',
    summary: 'The bounded context Korvix keeps for a project, and how it is used.',
    blocks: [
      {
        body: [
          'Project intelligence is a small, readable summary of a project — not a hidden model of you. You can see it on the project page.',
        ],
        list: [
          'A short project summary derived from the work attached to the project.',
          'Current goals for the project.',
          'Recent signals from the tools connected to that project.',
        ],
        note: 'It is assembled from your own project data. It is not shared between accounts, and it is not used to train models.',
      },
      {
        body: [
          'When you work inside a project, this context travels with the request, which is why a new conversation in a project does not start empty.',
        ],
      },
    ],
    tutorials: ['use-project-context'],
  },
  {
    id: 'account',
    title: 'Account and workspace basics',
    summary: 'Sign-in, language, plan, and the controls you have over your data.',
    blocks: [
      {
        list: [
          'Sign in with email or Google. Some deployments ask you to verify your email address.',
          'The interface language follows your device by default and can be set explicitly to English, Türkçe or Deutsch.',
          'Your plan and credits are shown in the workspace; the free tier is available during early access.',
          'Settings includes controls to export your data and to delete your account.',
        ],
        note: 'Signing out clears the session stored in your browser. See the Privacy Policy and Cookie Policy for what is stored and why.',
      },
    ],
  },
];

/** Ids of the doc topics, in order — used by the hub navigation. */
export const DOC_TOPIC_IDS = DOC_TOPICS.map((d) => d.id);
