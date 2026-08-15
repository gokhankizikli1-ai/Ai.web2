/**
 * Security page content.
 *
 * ENGLISH-ONLY long-form (chrome is localized — see `src/content/docs.ts`).
 *
 * EVERY claim below is backed by code in this repository, and the `evidence`
 * field names the file that backs it so the page can be re-verified rather than
 * trusted. Claims that would require an audit, a certification, a staffed team,
 * or a contractual guarantee are deliberately ABSENT: there is no SOC 2, no ISO
 * 27001, no HIPAA, no penetration-test report, no 24/7 security team and no SLA,
 * and the page says so explicitly instead of staying quiet about it.
 */

export interface SecurityClaim {
  title: string;
  body: string;
  /** Repository evidence for this claim (shown on the page). */
  evidence: string;
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
        title: 'Ownership is enforced on every project-scoped route',
        body: 'Each connector route resolves the project and compares its owner to the authenticated caller before doing anything. A project you do not own responds as if it does not exist, so the API cannot be used to discover other people\'s projects.',
        evidence: 'backend/routes/v2_github.py, v2_gmail.py, v2_vercel.py, v2_calendar.py, v2_slack.py — `_require_owned_project`',
      },
      {
        title: 'Identity comes from a verified token, never from the request body',
        body: 'Who you are is established from a cryptographically verified session token with the signing algorithm pinned, not from an identifier a client can put in a payload. A forged or expired token degrades to a guest/anonymous caller instead of falling through to a claimed user id.',
        evidence: 'SECURITY.md §1; backend/core/deps.py — `resolve_uid_and_source`; backend/services/auth/tokens.py',
      },
      {
        title: 'Connections are per project, not per account',
        body: 'Connecting a repository, a Vercel project, a mailbox, a calendar or a set of Slack channels binds it to one Korvix project. Another project — even one of yours — does not inherit that connection.',
        evidence: 'backend/services/{github,gmail,vercel,calendar,slack}/store.py — project-scoped connection tables',
      },
    ],
  },
  {
    id: 'connectors',
    title: 'Connectors are read-only',
    intro: 'Korvix connects to the tools around your project so it can understand them. It is not built to act on your behalf inside those tools.',
    claims: [
      {
        title: 'No write path exists toward a provider',
        body: 'Across GitHub, Slack, Vercel, Gmail and Google Calendar, the provider clients are read-only. Korvix cannot push, merge, comment, close or re-run on GitHub; cannot send, edit, delete or react in Slack; cannot deploy, promote, roll back or change environment variables on Vercel; cannot send, reply, draft, delete or re-label mail; and cannot create, edit, move or delete a calendar event.',
        evidence: 'backend/routes/v2_github.py, v2_slack.py, v2_vercel.py, v2_gmail.py, v2_calendar.py — route contracts and GET-only clients',
      },
      {
        title: 'Least-privilege scopes',
        body: 'The Google connectors request read-only scopes only — `gmail.readonly` for mail and `calendar.events.readonly` for calendar — rather than broad account access.',
        evidence: 'backend/services/gmail/*, backend/services/calendar/* — OAuth scope configuration',
      },
      {
        title: 'Reads are bounded',
        body: 'A sync is not an unbounded crawl. Slack, for example, reads only the channels you selected, under a hard ceiling on messages for the whole sync, with per-channel page caps and limits on how many threads are expanded.',
        evidence: 'backend/services/slack/sync.py — documented volume, page and thread bounds',
      },
      {
        title: 'You choose the resource, and the choice is verified',
        body: 'Where a provider exposes several resources, the one you pick is validated against the set the server itself discovered and re-verified live against the provider before it is stored. A Slack channel the app cannot actually read is refused rather than bound as if it were readable.',
        evidence: 'backend/routes/v2_slack.py, v2_vercel.py, v2_github.py — pending-set validation and live re-verification',
      },
    ],
  },
  {
    id: 'credentials',
    title: 'Connected credentials stay on the server',
    intro: 'Nothing about a connected account is handed to the browser, and long-lived secrets are not stored in the clear.',
    claims: [
      {
        title: 'No API returns a token',
        body: 'Client secrets, refresh tokens and bot tokens never leave the backend. Connection status carries safe metadata only — enough to show you what is connected, and nothing that could be replayed.',
        evidence: 'backend/routes/v2_gmail.py, v2_vercel.py, v2_slack.py, v2_calendar.py — documented security invariants',
      },
      {
        title: 'Encrypted at rest, with no plaintext fallback',
        body: 'Where a long-lived credential must be stored, it is encrypted before it touches the database using an authenticated cipher with rotatable keys. If encryption is unavailable or misconfigured the operation fails closed — it never falls back to writing a secret in the clear.',
        evidence: 'backend/services/gmail/crypto.py (Fernet/MultiFernet, fail-closed, `f1:` envelope) and the connector stores that use it',
      },
      {
        title: 'GitHub stores no long-lived token at all',
        body: 'The GitHub connector mints short-lived installation tokens when it needs them instead of persisting a durable credential.',
        evidence: 'backend/services/github/app_api.py, backend/services/gmail/crypto.py (documented contrast)',
      },
    ],
  },
  {
    id: 'oauth',
    title: 'Connection flows are hardened',
    intro: 'The moment a connection is created is the moment worth attacking, so the flow does not trust anything the browser hands back.',
    claims: [
      {
        title: 'One-time, expiring, ownership-bound state',
        body: 'Starting a connection mints a state token bound to the (user, project) pair with a short lifetime. The callback trusts only what was stored with that state — never a query parameter — and a second use of the same state is rejected. A callback therefore cannot attach a provider account to somebody else\'s project, and a replayed callback does nothing.',
        evidence: 'backend/services/slack/setup_state.py (one-time, TTL-bound, owner+project-bound) and the equivalent modules for the other connectors',
      },
      {
        title: 'Provider identity comes from the token exchange',
        body: 'The workspace or team a connection belongs to is read from the provider\'s own token-exchange response, not from an attacker-controllable query parameter on the redirect.',
        evidence: 'backend/routes/v2_slack.py, v2_vercel.py — documented invariant',
      },
      {
        title: 'No open redirect',
        body: 'Callbacks redirect only to a fixed, server-configured frontend address. A redirect target supplied in the request is ignored.',
        evidence: 'backend/routes/v2_gmail.py, v2_calendar.py, v2_vercel.py, v2_slack.py — fixed frontend base',
      },
      {
        title: 'Webhook deliveries are signature-checked',
        body: 'Repository events are verified with a constant-time signature comparison before they are read, and oversized payloads are rejected rather than parsed.',
        evidence: 'backend/services/github/webhook.py — `verify_signature` using `hmac.compare_digest`; backend/routes/v2_github.py — 401/413 contract',
      },
    ],
  },
  {
    id: 'disconnect',
    title: 'Disconnecting means something',
    intro: 'Removing a connection is explicit about what it does and does not touch at the provider.',
    claims: [
      {
        title: 'Local disconnect where an install is shared',
        body: 'Slack and Vercel installations are shared across whoever uses them, so disconnecting removes the connection and credentials Korvix holds for that project rather than tearing down an installation another project may depend on. The response says which it did.',
        evidence: 'backend/routes/v2_slack.py, v2_vercel.py — documented disconnect semantics',
      },
      {
        title: 'Revocation where it is safe',
        body: 'The Gmail connector revokes the stored credential on disconnect. The Calendar connector deletes only its own row and gates any remote revoke behind a safety check, so disconnecting a calendar can never destroy a live Gmail grant that shares the same Google account.',
        evidence: 'backend/routes/v2_gmail.py, v2_calendar.py — `google_grant.remote_revoke_is_safe`',
      },
    ],
  },
  {
    id: 'product',
    title: 'Account and product data',
    intro: 'What the product stores about you, and the controls you have.',
    claims: [
      {
        title: 'You can export and delete',
        body: 'Settings includes controls to export your data and to delete your account, which removes the associated data.',
        evidence: 'src/pages/SettingsPage.tsx, backend/routes/profile.py',
      },
      {
        title: 'AI processing happens at third-party model providers',
        body: 'Generating a response means sending your prompt and the relevant content to a third-party AI model provider, which processes it under its own terms. This is described in the Privacy Policy rather than hidden.',
        evidence: 'src/pages/legalContent.ts — Privacy Policy, "AI processing"',
      },
      {
        title: 'Project context is not shared between accounts',
        body: 'The project summary, goals and connector signals Korvix keeps are assembled from your own project data and stay inside your account.',
        evidence: 'backend/routes/v2_brain.py, src/pages/ProjectOverview.tsx',
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
  body: 'If you believe you have found a security issue, please stop testing at the point of discovery and avoid accessing data that is not yours. This repository does not publish a dedicated security contact address, and we will not invent one here: the honest answer today is that there is no staffed disclosure channel. If you have an account, the fastest signal we receive is a description sent through the product, and a published contact route will be added to this page when one exists.',
};
