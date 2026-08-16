/**
 * Regional privacy rights content for `/privacy/regional` and
 * `/privacy/regional/:region`.
 *
 * WHAT THIS IS: a regional NAVIGATION layer over the one Privacy Policy. It
 * describes, at a high level, the kinds of rights people commonly have in each
 * region and how to exercise the equivalents inside Korvix today.
 *
 * WHAT THIS DELIBERATELY IS NOT: a set of jurisdiction-specific compliance
 * promises. The repository contains no verified company entity, registered
 * address, DPO, EU/UK representative, regulator registration, subprocessor list
 * or international-transfer mechanism — so none of those are stated here.
 * Every region page carries the same explicit "pending legal review" block
 * listing exactly which company-specific facts are missing, instead of
 * inventing them.
 *
 * Türkiye reuses the EXISTING KVKK information notice already shipped in the
 * localized legal content (`src/pages/legalContent.ts` → `kvkk`), so no legal
 * text was deleted or rewritten by this redesign; `/kvkk` redirects here.
 *
 * ENGLISH-ONLY long-form apart from the Türkiye notice, which keeps its
 * existing en/tr/de translations.
 */

export interface Region {
  /** URL slug: /privacy/regional/:slug */
  slug: string;
  /** Region name in English. */
  name: string;
  /** One-line description used on the hub. */
  blurb: string;
  /** The law(s) most people in this region will be thinking of. Descriptive. */
  framework: string;
  /** High-level rights categories commonly available. Not a guarantee. */
  rights: string[];
  /** Extra notes specific to the region, if any. */
  notes?: string[];
  /** When set, the page also renders the existing localized legal document. */
  embeddedLegalDoc?: 'kvkk';
}

export const REGIONS: Region[] = [
  {
    slug: 'eea',
    name: 'European Economic Area (EU/EEA)',
    blurb: 'Including Germany, Spain, France, Italy and every other EU/EEA country.',
    framework: 'The EU General Data Protection Regulation (GDPR) applies across the EU and the wider EEA. Germany, Spain and other member states apply the same regulation, with national rules on top — which is why they are handled here rather than as separate policies.',
    rights: [
      'Access — ask whether your personal data is processed and get a copy of it.',
      'Rectification — have inaccurate or incomplete data corrected.',
      'Erasure — ask for your data to be deleted in the circumstances the law provides.',
      'Restriction — ask for processing to be limited while an issue is resolved.',
      'Portability — receive data you provided in a portable form.',
      'Objection — object to certain processing, including on grounds relating to your situation.',
      'Withdraw consent — where processing relies on consent, withdraw it at any time.',
      'Complain to a supervisory authority in your country.',
    ],
  },
  {
    slug: 'uk',
    name: 'United Kingdom',
    blurb: 'UK GDPR and the Data Protection Act.',
    framework: 'The UK applies the UK GDPR together with the Data Protection Act 2018. The rights categories closely mirror the EU regime.',
    rights: [
      'Access to your personal data and information about how it is processed.',
      'Rectification of inaccurate data.',
      'Erasure in the circumstances the law provides.',
      'Restriction of processing.',
      'Portability of data you provided.',
      'Objection to certain processing.',
      'Complain to the UK supervisory authority.',
    ],
  },
  {
    slug: 'united-states',
    name: 'United States',
    blurb: 'State privacy laws, including California.',
    framework: 'The United States has no single federal privacy law for this kind of product. Several states — California, Colorado, Connecticut, Virginia and others — provide consumer privacy rights, and what applies depends on where you live.',
    rights: [
      'Know what categories of personal information are collected and why.',
      'Access a copy of the personal information held about you.',
      'Delete personal information, subject to the exceptions the law allows.',
      'Correct inaccurate personal information.',
      'Opt out of the sale or sharing of personal information for cross-context behavioural advertising.',
      'Not be discriminated against for exercising these rights.',
    ],
    notes: [
      'KorvixAI does not sell your personal information, and does not embed third-party advertising or cross-site tracking networks for advertising purposes (see the Cookie Policy).',
    ],
  },
  {
    slug: 'turkiye',
    name: 'Türkiye',
    blurb: 'KVKK (Law No. 6698) information notice.',
    framework: 'Türkiye applies the Personal Data Protection Law (KVKK, Law No. 6698). The existing KVKK information notice is reproduced in full below, in your selected language.',
    rights: [
      'Learn whether your personal data is processed.',
      'Request information about the processing.',
      'Request correction of inaccurate data.',
      'Request deletion of your data.',
    ],
    embeddedLegalDoc: 'kvkk',
  },
  {
    slug: 'japan',
    name: 'Japan',
    blurb: 'Act on the Protection of Personal Information (APPI).',
    framework: 'Japan applies the Act on the Protection of Personal Information (APPI), which provides individuals with rights over personal information held about them.',
    rights: [
      'Request disclosure of the personal information held about you.',
      'Request correction, addition or deletion of that information.',
      'Request that use or provision of the information be stopped in the circumstances the law provides.',
    ],
  },
  {
    slug: 'south-korea',
    name: 'South Korea',
    blurb: 'Personal Information Protection Act (PIPA).',
    framework: 'South Korea applies the Personal Information Protection Act (PIPA), one of the more detailed regimes in the region.',
    rights: [
      'Access the personal information held about you.',
      'Request correction or deletion.',
      'Request suspension of processing.',
      'Withdraw consent where processing relies on it.',
    ],
  },
  {
    slug: 'china',
    name: 'China',
    blurb: 'Personal Information Protection Law (PIPL).',
    framework: 'Mainland China applies the Personal Information Protection Law (PIPL), which includes specific rules on cross-border transfers of personal information.',
    rights: [
      'Know how your personal information is handled and access a copy.',
      'Correct or supplement inaccurate information.',
      'Delete personal information in the circumstances the law provides.',
      'Withdraw consent where processing relies on it.',
    ],
    notes: [
      'KorvixAI is operated as a global product and is not offered as a China-localized service. Cross-border transfer arrangements for this product have not been published and are part of the pending legal review below.',
    ],
  },
  {
    slug: 'russia',
    name: 'Russia',
    blurb: 'Federal Law No. 152-FZ on Personal Data.',
    framework: 'Russia applies Federal Law No. 152-FZ on Personal Data, which includes data-localization requirements for certain processing.',
    rights: [
      'Obtain information about the processing of your personal data.',
      'Request correction of inaccurate data.',
      'Request blocking or deletion in the circumstances the law provides.',
    ],
    notes: [
      'KorvixAI is operated as a global product. Any localization arrangements for this product have not been published and are part of the pending legal review below.',
    ],
  },
  {
    slug: 'other',
    name: 'Other regions',
    blurb: 'Anywhere not listed above.',
    framework: 'Many countries provide comparable data-protection rights under their own laws. Wherever you are, the product controls described below are available to you, and the Privacy Policy applies globally.',
    rights: [
      'Access the account information you provided.',
      'Correct your account details.',
      'Export your data.',
      'Delete your account and the data associated with it.',
    ],
  },
];

/**
 * How to exercise the practical equivalents inside the product today. Same for
 * every region because the product controls are the same everywhere — and
 * because promising a region-specific process we do not operate would be a
 * fabricated commitment.
 */
export const REGION_PRODUCT_CONTROLS: string[] = [
  'Review and update your account details in Settings.',
  'Export your data using the export control in Settings.',
  'Delete your account, which removes the associated data, from Settings.',
  'Disconnect any connected tool from the Connectors screen; the connection and the credentials Korvix holds for it are removed.',
  'Clear the session and preference data stored in your browser at any time through your browser settings (see the Cookie Policy).',
];

/**
 * Company-specific facts that CANNOT be completed truthfully from the
 * repository. Listed openly on every region page and flagged for legal review
 * rather than filled in with plausible-sounding text.
 */
export const REGION_PENDING_LEGAL_REVIEW: string[] = [
  'The legal entity that acts as controller of your personal data, and its registered address.',
  'A representative in the EU/EEA or the UK, and a Data Protection Officer, where one is required.',
  'The competent supervisory authority for complaints, and any regulator registration.',
  'The mechanism relied on for international transfers of personal data, and the list of subprocessors.',
  'Retention periods for each category of data.',
  'A dedicated privacy contact address for rights requests that cannot be completed with the in-product controls.',
];
