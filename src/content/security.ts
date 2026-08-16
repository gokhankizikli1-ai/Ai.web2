/**
 * Security page content.
 *
 * ENGLISH-ONLY long-form (chrome is localized — see `src/content/docs.ts`).
 *
 * PRESENTATION RULE (this is a public trust page, not an internal audit
 * report): every claim below is written in user-facing language. Source paths,
 * module names, function names, internal document sections and other
 * implementation detail belong in the repository and in internal review, NOT on
 * the marketing surface — publishing them tells an attacker where to look and
 * tells a reader nothing they can act on.
 *
 * HONESTY RULE (unchanged): a claim only appears here if the product actually
 * behaves that way today. Anything that would require an audit, a
 * certification, a staffed team or a contractual guarantee is deliberately
 * ABSENT — there is no SOC 2, no ISO 27001, no HIPAA, no penetration-test
 * report, no 24/7 security team and no SLA — and the page says so explicitly in
 * `SECURITY_NON_CLAIMS` instead of staying quiet about it. Do not soften a
 * claim into a vague marketing promise, and do not add one that cannot be
 * demonstrated in the product.
 */

export interface SecurityClaim {
  title: string;
  body: string;
}

export interface SecurityGroup {
  id: string;
  title: string;
  intro: string;
  claims: SecurityClaim[];
}

export const SECURITY_GROUPS: SecurityGroup[] = [
  {
    id: 'isolation',
    title: 'Your projects are yours',
    intro: 'Project data is scoped to the account that owns it, and that check happens on the server for every project-scoped request.',
    claims: [
      {
        title: 'Access is scoped to the authenticated project owner',
        body: 'Every request that touches a project checks, on the server, that the project belongs to the account making it. A project you do not own responds as if it does not exist, so the API cannot be used to discover other people\'s projects.',
      },
      {
        title: 'Identity comes from a verified session, never from the request',
        body: 'Who you are is established from a cryptographically verified session token, not from an identifier a client can put in a payload. A forged or expired session is treated as a guest — it never falls through to the account it claims to be.',
      },
      {
        title: 'Connections belong to one project, not to your whole account',
        body: 'Connecting a repository, a deployment project, a mailbox, a calendar or a set of Slack channels binds it to a single Korvix project. Another project — even one of yours — does not inherit that connection.',
      },
    ],
  },
  {
    id: 'connectors',
    title: 'Connectors are read-only',
    intro: 'Korvix connects to the tools around your project so it can understand them. It is not built to act on your behalf inside those tools.',
    claims: [
      {
        title: 'Read-only connectors cannot write to connected services',
        body: 'Across GitHub, Slack, Vercel, Gmail and Google Calendar there is no path from Korvix back into the provider. Korvix cannot push, merge, comment, close or re-run on GitHub; cannot send, edit, delete or react in Slack; cannot deploy, promote, roll back or change environment variables on Vercel; cannot send, reply, draft, delete or re-label mail; and cannot create, edit, move or delete a calendar event.',
      },
      {
        title: 'Least-privilege access',
        body: 'Where a provider lets an application ask for less, Korvix asks for less. The Google connectors request read-only access to mail and calendar rather than broad account access.',
      },
      {
        title: 'Connector reads are bounded and project-scoped',
        body: 'A sync is not an unbounded crawl of your account. Korvix reads the specific resources you selected for that project, up to fixed limits on how much a single sync will pull in.',
      },
      {
        title: 'You choose what is connected, and the choice is verified',
        body: 'Where a provider exposes several resources, the one you pick is checked against what the server itself discovered and confirmed live with the provider before it is stored. A channel or project Korvix cannot actually read is refused rather than saved as if it were readable.',
      },
    ],
  },
  {
    id: 'credentials',
    title: 'Connected credentials stay on the server',
    intro: 'Nothing about a connected account is handed to the browser, and long-lived secrets are not stored in the clear.',
    claims: [
      {
        title: 'OAuth credentials and provider tokens stay server-side',
        body: 'Access tokens, refresh tokens and application secrets never leave the backend and are never returned by an API. Connection status carries safe information only — enough to show you what is connected, and nothing that could be replayed against the provider.',
      },
      {
        title: 'Connector credentials are encrypted at rest',
        body: 'Where a long-lived credential has to be stored, it is encrypted before it reaches the database, using keys that can be rotated. If encryption is unavailable or misconfigured the operation fails instead of falling back to storing a secret in readable form.',
      },
      {
        title: 'The GitHub connection stores no long-lived token at all',
        body: 'The GitHub connector requests a short-lived token at the moment it needs one, so there is no durable GitHub credential sitting in storage to lose.',
      },
    ],
  },
  {
    id: 'oauth',
    title: 'Connection flows are hardened',
    intro: 'The moment a connection is created is the moment worth attacking, so the flow does not trust anything the browser hands back.',
    claims: [
      {
        title: 'Connection links are one-time, expiring and bound to you',
        body: 'Starting a connection creates a single-use token tied to your account and that one project, with a short lifetime. Completing the connection trusts only what was stored when it started, so a connection cannot be attached to somebody else\'s project, and a reused link does nothing.',
      },
      {
        title: 'The connected account is confirmed with the provider',
        body: 'Which workspace, team or account a connection belongs to is taken from the provider\'s own response during the exchange — not from anything a browser can put in a link.',
      },
      {
        title: 'Connection flows return only to Korvix',
        body: 'Finishing a connection always returns you to a fixed Korvix address configured on the server. A destination supplied in the request is ignored, so the flow cannot be redirected somewhere else.',
      },
      {
        title: 'Incoming repository events are verified before they are read',
        body: 'Repository events sent to Korvix are checked against their signature before anything in them is parsed, and oversized deliveries are rejected outright.',
      },
    ],
  },
  {
    id: 'disconnect',
    title: 'Disconnecting means something',
    intro: 'Removing a connection is explicit about what it does and does not touch at the provider.',
    claims: [
      {
        title: 'Disconnecting removes what Korvix holds for that project',
        body: 'Slack and Vercel installations can be shared by more than one project, so disconnecting removes the connection and the credentials Korvix holds for the project you are in, rather than tearing down an installation another project still depends on. The result tells you which happened.',
      },
      {
        title: 'Access is revoked where revoking is safe',
        body: 'Disconnecting Gmail revokes the credential Korvix was given. Disconnecting Google Calendar removes the calendar connection and only revokes remotely when doing so cannot break a Gmail connection that shares the same Google account.',
      },
    ],
  },
  {
    id: 'product',
    title: 'Account and product data',
    intro: 'What the product stores about you, and the controls you have.',
    claims: [
      {
        title: 'You can export your data and delete your account',
        body: 'Both controls are in Settings. Deleting your account removes the data associated with it.',
      },
      {
        title: 'AI processing happens at third-party model providers',
        body: 'Generating a response means sending your prompt and the relevant content to a third-party AI model provider, which processes it under its own terms. This is described in the Privacy Policy rather than hidden.',
      },
      {
        title: 'Project context is not shared between accounts',
        body: 'The summary, goals and connector signals Korvix keeps for a project are assembled from your own project data and stay inside your account.',
      },
    ],
  },
];

/**
 * Explicit non-claims. Being specific about what we do NOT have is part of
 * being honest about what we do.
 */
export const SECURITY_NON_CLAIMS: string[] = [
  'Korvix does not hold SOC 2, ISO 27001, HIPAA or any other compliance certification, and does not claim one.',
  'No third-party penetration test or security audit has been published for this product.',
  'There is no 24/7 security operations team and no contractual uptime or support SLA.',
  'Korvix is an early-stage product under active development. Features, and the security posture around them, continue to change.',
];

/** How to report something — honest about what exists today. */
export const SECURITY_REPORTING = {
  title: 'Reporting a security problem',
  body: 'If you believe you have found a security issue, please stop testing at the point of discovery and avoid accessing data that is not yours. Korvix does not publish a dedicated security contact address today, and we will not invent one here: there is currently no staffed disclosure channel. If you have an account, the fastest signal we receive is a description sent through the product, and a published contact route will be added to this page once one exists.',
};
