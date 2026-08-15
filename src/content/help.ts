/**
 * Help Center content for `/help`.
 *
 * There is no staffed support desk and no published support address, and this
 * page does not pretend otherwise: it is genuine SELF-SERVICE help, written
 * from the product's real behaviour and its real error states (see
 * `src/pages/ConnectorsPage.tsx` and the connector routes), with pointers into
 * the documentation, the tutorials and the security page.
 *
 * ENGLISH-ONLY long-form (page chrome is localized — see `src/content/docs.ts`).
 */

export interface HelpItem {
  q: string;
  a: string[];
}

export interface HelpCategory {
  id: string;
  title: string;
  intro: string;
  items: HelpItem[];
}

export const HELP_CATEGORIES: HelpCategory[] = [
  {
    id: 'account',
    title: 'Account and sign-in',
    intro: 'Getting in, staying in, and the settings that affect everything else.',
    items: [
      {
        q: 'How do I sign in?',
        a: ['Use email and password, or continue with Google. Both create the same kind of account.'],
      },
      {
        q: 'I was asked to verify my email address',
        a: [
          'Some deployments require email verification before certain features are available. Open the link in the verification email; it confirms the address with the server rather than in your browser, so it works even if you open it in a different browser.',
          'If the link has expired, request a new one from the banner in the product.',
        ],
      },
      {
        q: 'I was signed out unexpectedly',
        a: [
          'Sign-in state lives in your browser. Clearing site data, using a private window, or an expired session will sign you out.',
          'Signing back in restores your chats and projects — they live on your account, not in the browser.',
        ],
      },
      {
        q: 'How do I change the interface language?',
        a: ['The language follows your device by default. Use the language control in the header or in Settings to pin English, Türkçe or Deutsch.'],
      },
      {
        q: 'How do I export or delete my data?',
        a: ['Settings contains controls to export your data and to delete your account. Deleting the account removes the data associated with it.'],
      },
    ],
  },
  {
    id: 'projects',
    title: 'Projects and chats',
    intro: 'Keeping work together so it does not start from zero each time.',
    items: [
      {
        q: 'What is the difference between a chat and a project?',
        a: [
          'A chat is one conversation. A project is the durable home for a piece of work: its chats, the products generated for it, and the context Korvix keeps about it.',
          'Use a project whenever the work will last longer than one conversation.',
        ],
      },
      {
        q: 'How do I move an existing chat into a project?',
        a: ['Open the chat menu and use "Add / Move to project". You can also add existing chats from the project page.'],
      },
      {
        q: 'Why does a new chat inside a project already know things?',
        a: [
          'When you work inside a project, its context — a short summary, current goals and recent connector signals — travels with the request.',
          'You can see exactly what that context contains on the project page.',
        ],
      },
      {
        q: 'Can someone else on my team open my project?',
        a: ['Not yet. Projects belong to the account that created them; there are no shared team workspaces or seats today.'],
      },
    ],
  },
  {
    id: 'builds',
    title: 'Building',
    intro: 'Web Build and App Build: what to expect, and what to do when a result disappoints.',
    items: [
      {
        q: 'The generated result is not what I wanted',
        a: [
          'Describe the change in the conversation rather than starting a new build — Korvix refines the existing result, which keeps everything you already liked.',
          'Thin prompts produce generic output. Say who it is for, what it must do, and the tone you want; if the description is thin, Korvix asks a few short design questions first, and answering them changes the result substantially.',
        ],
      },
      {
        q: 'Can I publish or deploy from Korvix?',
        a: [
          'Not yet. Publishing from Korvix and pushing a build into a GitHub repository are not available.',
          'The Vercel and GitHub connectors are read-only: they report what is happening in those tools, they do not send builds to them.',
        ],
      },
      {
        q: 'Does App Build produce a mobile app?',
        a: ['App Build produces a multi-screen React application that runs in a browser. It is not a native iOS/Android build and does not produce an app-store package.'],
      },
      {
        q: 'Can I replace the images in a generated site?',
        a: ['Yes — images chosen for the first version can be replaced, including with an image you upload.'],
      },
    ],
  },
  {
    id: 'connectors',
    title: 'Connectors and sync',
    intro: 'Connecting tools, and the states you may run into.',
    items: [
      {
        q: 'I do not see any connectors',
        a: [
          'Connectors attach to a project, so the Connectors screen asks you to pick one first. If you have no projects yet, create one and come back.',
          'A connector can also be switched off for the deployment you are using; in that case its actions report that it is unavailable rather than failing silently.',
        ],
      },
      {
        q: 'GitHub says it still needs an installation',
        a: [
          'GitHub requires the Korvix GitHub App to be installed on the account or organization that owns the repository, in addition to authorizing your user.',
          'Finish the installation in GitHub, then return and pick a repository. Only repositories the installation can actually see are offered.',
        ],
      },
      {
        q: 'A Slack channel is missing from the list',
        a: [
          'Only channels the Slack app can actually read appear. Korvix never joins a channel on its own, so add the app to the channel in Slack and refresh the list.',
          'A channel that cannot be read is refused rather than connected, so you never end up with a connection that silently returns nothing.',
        ],
      },
      {
        q: 'I connected a tool but I see no signals',
        a: [
          'Run a sync. Gmail, Google Calendar, Vercel and Slack read on demand — they are not continuously monitoring your account.',
          'GitHub can also receive repository events, so its activity may appear without a manual sync.',
          'Syncs are deliberately bounded, so a very old item may fall outside the window that was read.',
        ],
      },
      {
        q: 'What happens when I disconnect?',
        a: [
          'The connection and the credentials Korvix holds for that project are removed.',
          'Slack and Vercel installations can be shared by several projects, so disconnecting one project does not tear down an installation another project relies on. Removing an installed app itself is done in that provider\'s settings.',
        ],
      },
      {
        q: 'Can Korvix change anything in my connected tools?',
        a: ['No. Every connector is read-only: no pushes or merges, no deploys or rollbacks, no sent or deleted mail, no Slack messages, no calendar changes. See the Security page for the evidence behind that.'],
      },
    ],
  },
  {
    id: 'trust',
    title: 'Privacy, security and billing',
    intro: 'Where to find the authoritative answers.',
    items: [
      {
        q: 'How are my connected accounts protected?',
        a: ['Credentials never reach the browser, long-lived secrets are encrypted at rest, and connection flows are bound to your account and project. The Security page lists each claim with the code that backs it.'],
      },
      {
        q: 'What does Korvix do with my prompts?',
        a: ['They are used to operate the service and are sent to third-party AI model providers to generate a response. The Privacy Policy describes this, including the choices you have.'],
      },
      {
        q: 'What do I get for free?',
        a: ['A free tier is available during early access, and no card is required for it. Final prices and credit allocations are not locked yet — the Pricing page shows the current state rather than a placeholder number.'],
      },
      {
        q: 'How do I make a privacy request from my region?',
        a: ['Start with the export and deletion controls in Settings, which are available everywhere. The Regional Privacy Rights pages describe the rights categories that commonly apply in your region.'],
      },
    ],
  },
];
