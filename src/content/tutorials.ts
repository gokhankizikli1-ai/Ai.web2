/**
 * Tutorial content for `/tutorials` and `/tutorials/:slug`.
 *
 * ENGLISH-ONLY (same rationale as `src/content/docs.ts`): the page chrome is
 * localized, the long-form steps are not, and the page says so.
 *
 * ACCURACY: the connector tutorials describe the flow the app actually
 * implements — OAuth in the provider's own consent screen, a server-held
 * credential, an explicit resource choice where the provider has more than one,
 * an explicit Sync, and a local disconnect. Nothing here exposes a secret, an
 * internal endpoint, or an implementation detail a user cannot see.
 */

export interface TutorialStep {
  title: string;
  body: string;
}

export interface Tutorial {
  slug: string;
  title: string;
  summary: string;
  /** Grouping shown on the hub. */
  group: 'start' | 'build' | 'connect';
  /** Honest expectation setting — what you need before you begin. */
  before: string[];
  steps: TutorialStep[];
  /** Short truths worth knowing after the steps (limits, boundaries). */
  after?: string[];
}

export const TUTORIALS: Tutorial[] = [
  {
    slug: 'create-first-project',
    title: 'Create your first Korvix project',
    summary: 'Give a piece of work a home so its chats, products and context stay together.',
    group: 'start',
    before: ['A Korvix account.'],
    steps: [
      {
        title: 'Open Projects',
        body: 'From the workspace, go to Projects. This is the list of every project on your account.',
      },
      {
        title: 'Create a project',
        body: 'Name it after the thing you are working on — a product, a client, a launch — rather than after a task. A project is meant to outlive any single conversation.',
      },
      {
        title: 'Attach the work',
        body: 'Open the project and add chats to it. An existing conversation can be moved in from the chat menu, and new chats you start inside the project belong to it automatically.',
      },
      {
        title: 'Check the project page',
        body: 'The project page shows its chats, the products generated for it, and the project context Korvix keeps — a short summary, current goals, and recent signals from connected tools.',
      },
    ],
    after: [
      'Projects are private to your account; there are no shared team workspaces yet.',
      'Connectors attach to a project, so create the project before connecting GitHub, Slack, Vercel, Gmail or Google Calendar.',
    ],
  },
  {
    slug: 'build-first-website',
    title: 'Build your first website',
    summary: 'From a description to a responsive first version you can refine.',
    group: 'build',
    before: ['A Korvix account.', 'A rough idea of the site — what it is for and who it is for.'],
    steps: [
      {
        title: 'Describe the site',
        body: 'In Chat, pick the Website mode (or just describe a site) and say what you want. Concrete beats clever: "a booking site for a two-chair barber shop, warm and simple, with prices and opening hours" gives Korvix far more to work with than "a nice website".',
      },
      {
        title: 'Answer the short design questions',
        body: 'If your description is thin, Korvix asks a few quick questions about audience, tone and content before it starts. Answering them costs seconds and changes the result substantially.',
      },
      {
        title: 'Let it build',
        body: 'Korvix plans the sections and the visual direction, then generates the site. Progress is shown while it works.',
      },
      {
        title: 'Review the preview',
        body: 'Browse the generated site in the preview and read the files it produced. Check it at a narrow width too — the layouts are meant to be responsive.',
      },
      {
        title: 'Refine in conversation',
        body: 'Describe what should change: "make the hero calmer and move pricing above the gallery". Korvix updates the build rather than regenerating from scratch.',
      },
      {
        title: 'Save it to a project',
        body: 'Save the result into a project so the site, the conversation that produced it, and the rest of that work stay together.',
      },
    ],
    after: [
      'Images are sourced for the first version; replace any of them with your own upload.',
      'Publishing from Korvix and pushing a build to a GitHub repository are not available yet.',
    ],
  },
  {
    slug: 'start-app-build',
    title: 'Start an App Build',
    summary: 'Generate a multi-screen React application that runs in the browser.',
    group: 'build',
    before: ['A Korvix account.', 'A clear idea of what the app is for and who uses it.'],
    steps: [
      {
        title: 'Choose App',
        body: 'Pick the App mode in the composer, or describe an application ("a CRM for a small sales team with contacts, deals and a pipeline view").',
      },
      {
        title: 'Describe the jobs, not the screens',
        body: 'Say what people need to do in the app. Korvix derives the screens, routes and navigation shell from those jobs — a booking tool and an analytics dashboard should not get the same structure, and they do not.',
      },
      {
        title: 'Review the generated app',
        body: 'Open the preview and move between screens. The generated project is a client-routed React/Vite application with real navigation and stateful flows.',
      },
      {
        title: 'Refine and save',
        body: 'Ask for changes in the conversation, then save the app into a project.',
      },
    ],
    after: [
      'App Build produces a web application. It is not a native iOS/Android build and does not produce an app-store package.',
    ],
  },
  {
    slug: 'connect-github',
    title: 'Connect GitHub to a project',
    summary: 'Bring repository activity into a project. Read-only.',
    group: 'connect',
    before: ['A project in Korvix.', 'Permission to install a GitHub App on the account or organization that owns the repository.'],
    steps: [
      {
        title: 'Open Connectors and pick the project',
        body: 'Connections are per project. Choose the project this repository belongs to.',
      },
      {
        title: 'Authorize and install',
        body: 'Start the GitHub connection. You authorize Korvix in GitHub\'s own screens and install the Korvix GitHub App on the account or organization that owns the repository. Korvix never sees your GitHub password.',
      },
      {
        title: 'Choose the repository',
        body: 'After the installation, pick the single repository this project should read. Only repositories the installation can actually see are offered.',
      },
      {
        title: 'Sync',
        body: 'Run a sync to backfill recent activity. From then on, repository events can also arrive on their own, so GitHub activity does not always need a manual sync.',
      },
    ],
    after: [
      'Read-only: Korvix cannot push, merge, comment, close, re-run a workflow, or deploy.',
      'Disconnecting removes the connection stored by Korvix. Removing the GitHub App itself is done in GitHub settings.',
    ],
  },
  {
    slug: 'connect-slack',
    title: 'Connect Slack to a project',
    summary: 'Bring decisions and blockers from selected channels into a project. Read-only.',
    group: 'connect',
    before: ['A project in Korvix.', 'Permission to install an app in your Slack workspace.'],
    steps: [
      {
        title: 'Open Connectors and pick the project',
        body: 'Choose the project the workspace conversation relates to.',
      },
      {
        title: 'Install in Slack',
        body: 'Start the Slack connection and approve the install in Slack. The workspace identity comes from Slack itself, not from anything the browser passes back.',
      },
      {
        title: 'Choose channels',
        body: 'Select the channels this project should read. Only channels the app can actually read are offered — a channel it cannot see is refused rather than silently connected.',
      },
      {
        title: 'Sync',
        body: 'Run a sync to read recent conversation in those channels and turn it into project signals.',
      },
    ],
    after: [
      'Read-only: Korvix cannot send, edit or delete a message, add a reaction, or join a channel by itself.',
      'Slack installs an app once per workspace, so disconnecting one project does not break another project connected to the same workspace.',
    ],
  },
  {
    slug: 'connect-vercel',
    title: 'Connect Vercel to a project',
    summary: 'See deployment status for the product you are building. Read-only.',
    group: 'connect',
    before: ['A project in Korvix.', 'Access to the Vercel project you want to read.'],
    steps: [
      {
        title: 'Open Connectors and pick the project',
        body: 'Choose the Korvix project that matches the deployed product.',
      },
      {
        title: 'Authorize Vercel',
        body: 'Start the connection and approve it in Vercel. The scope comes from the authorization itself.',
      },
      {
        title: 'Choose the Vercel project',
        body: 'Pick one Vercel project. Only projects the authorization can actually see are offered, and the choice is re-verified before it is stored.',
      },
      {
        title: 'Sync',
        body: 'Run a sync to read recent deployments — production and preview, successes and failures.',
      },
    ],
    after: [
      'Read-only: Korvix cannot deploy, redeploy, promote, roll back, cancel a build, or change environment variables or domains.',
    ],
  },
  {
    slug: 'connect-gmail',
    title: 'Connect Gmail to a project',
    summary: 'Bring relevant mail context into a project. Read-only.',
    group: 'connect',
    before: ['A project in Korvix.', 'The Google account whose mail relates to this project.'],
    steps: [
      {
        title: 'Open Connectors and pick the project',
        body: 'Choose the project the mail belongs to.',
      },
      {
        title: 'Authorize with Google',
        body: 'Start the connection and complete Google\'s consent screen. Korvix requests read-only Gmail access and nothing else.',
      },
      {
        title: 'Sync',
        body: 'Run a sync. Korvix performs a bounded read and turns what it finds into project signals.',
      },
    ],
    after: [
      'Read-only: Korvix cannot send, reply, draft, delete, archive or re-label mail.',
      'Disconnecting revokes the stored credential and removes the connection.',
    ],
  },
  {
    slug: 'connect-google-calendar',
    title: 'Connect Google Calendar to a project',
    summary: 'Bring upcoming events and changes into a project. Read-only.',
    group: 'connect',
    before: ['A project in Korvix.', 'The Google account with the calendar you want to read.'],
    steps: [
      {
        title: 'Open Connectors and pick the project',
        body: 'Choose the project the schedule relates to.',
      },
      {
        title: 'Authorize with Google',
        body: 'Complete Google\'s consent screen. The only scope requested is read-only access to calendar events.',
      },
      {
        title: 'Sync',
        body: 'Run a sync to read upcoming events, recent changes and cancellations.',
      },
    ],
    after: [
      'Read-only: Korvix cannot create, edit, move or delete an event.',
      'Calendar and Gmail are separate connections even when they use the same Google account — disconnecting one leaves the other intact.',
    ],
  },
  {
    slug: 'use-project-context',
    title: 'Use project context effectively',
    summary: 'Get answers that already know what you are working on.',
    group: 'start',
    before: ['A project with at least one chat attached.'],
    steps: [
      {
        title: 'Work inside the project',
        body: 'Start conversations from the project rather than from a blank chat. The project context travels with the request, so you do not have to re-explain the product every time.',
      },
      {
        title: 'Keep goals current',
        body: 'The project keeps a short summary and current goals. When the direction changes, say so in the project — stale goals produce confidently stale answers.',
      },
      {
        title: 'Connect the tools that carry real signal',
        body: 'A repository, a deployment target and one or two Slack channels are usually enough. Connecting everything produces noise, not insight.',
      },
      {
        title: 'Sync before a planning conversation',
        body: 'For the connectors that read on demand, a sync before an important conversation means the project signals reflect this week rather than last month.',
      },
      {
        title: 'Move useful chats in',
        body: 'If a valuable conversation happened outside the project, move it in from the chat menu so it counts as project context.',
      },
    ],
    after: [
      'Project context is bounded and readable — you can see the summary, goals and signals on the project page.',
      'It stays inside your account. It is not shared with other users and is not used to train models.',
    ],
  },
];

export const TUTORIAL_GROUPS: { id: Tutorial['group']; title: string }[] = [
  { id: 'start', title: 'Start here' },
  { id: 'build', title: 'Build' },
  { id: 'connect', title: 'Connect your tools' },
];

export function tutorialBySlug(slug: string | undefined): Tutorial | undefined {
  if (!slug) return undefined;
  return TUTORIALS.find((tt) => tt.slug === slug);
}
