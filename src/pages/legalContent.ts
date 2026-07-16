/**
 * Public legal / policy page definitions (Phase 14I.2).
 *
 * Each entry is a data-driven document rendered by the single shared
 * `LegalPage` component. The strings below are TRANSLATION KEYS only — the
 * actual copy lives in the centralized locale authority (`src/i18n/locales/*`)
 * and is resolved through the `t()` system, so every page renders in en / tr /
 * de with no inline locale ternaries and no hardcoded English.
 *
 * These pages are fully PUBLIC (no auth). Their routes are registered in
 * `src/App.tsx` and added to that file's `PUBLIC_ROUTE_PREFIXES` so the
 * authenticated app chrome (BottomNav, owner toast) never renders on them.
 *
 * Content honesty rule: keys reference only claims the repository can support
 * (email/OAuth sign-in, browser storage for session + preferences, third-party
 * AI providers, in-product export/delete controls, no third-party ad/analytics
 * cookies, no real billing yet). No invented company entity, address,
 * registration/tax number, certification, retention period, or contact channel.
 */

/** One section of a legal document: a heading plus body paragraphs and/or a
 *  bulleted list. Every value is a translation key resolved via `t()`. */
export type LegalSection = {
  heading: string;
  body?: string[];
  list?: string[];
};

/** A complete public legal/policy document. */
export type LegalDoc = {
  /** Public route slug (path is `/${slug}` — see App.tsx). */
  slug: string;
  /** Translation key for the page <h1>. */
  titleKey: string;
  /** Translation key for the lead paragraph under the title. */
  introKey: string;
  sections: LegalSection[];
};

/** Document id → definition. The `LegalPage` component selects by id. */
export type LegalDocId = 'privacy' | 'terms' | 'cookies' | 'kvkk' | 'acceptableUse';

export const LEGAL_DOCS: Record<LegalDocId, LegalDoc> = {
  privacy: {
    slug: 'privacy',
    titleKey: 'legalPrivacyTitle',
    introKey: 'legalPrivacyIntro',
    sections: [
      { heading: 'legalPrivacyInfoHead', body: ['legalPrivacyInfoBody'] },
      { heading: 'legalPrivacyUseHead', body: ['legalPrivacyUseBody'] },
      { heading: 'legalPrivacyAiHead', body: ['legalPrivacyAiBody'] },
      { heading: 'legalPrivacyStorageHead', body: ['legalPrivacyStorageBody'] },
      { heading: 'legalPrivacyRightsHead', body: ['legalPrivacyRightsBody'] },
      { heading: 'legalPrivacyContactHead', body: ['legalPrivacyContactBody'] },
    ],
  },
  terms: {
    slug: 'terms',
    titleKey: 'legalTermsTitle',
    introKey: 'legalTermsIntro',
    sections: [
      { heading: 'legalTermsAcceptHead', body: ['legalTermsAcceptBody'] },
      { heading: 'legalTermsServiceHead', body: ['legalTermsServiceBody'] },
      { heading: 'legalTermsAccountHead', body: ['legalTermsAccountBody'] },
      { heading: 'legalTermsUseHead', body: ['legalTermsUseBody'] },
      { heading: 'legalTermsOutputHead', body: ['legalTermsOutputBody'] },
      { heading: 'legalTermsIpHead', body: ['legalTermsIpBody'] },
      { heading: 'legalTermsAvailHead', body: ['legalTermsAvailBody'] },
      { heading: 'legalTermsChangesHead', body: ['legalTermsChangesBody'] },
    ],
  },
  cookies: {
    slug: 'cookies',
    titleKey: 'legalCookieTitle',
    introKey: 'legalCookieIntro',
    sections: [
      { heading: 'legalCookieWhatHead', body: ['legalCookieWhatBody'] },
      { heading: 'legalCookieEssentialHead', body: ['legalCookieEssentialBody'] },
      { heading: 'legalCookiePrefHead', body: ['legalCookiePrefBody'] },
      { heading: 'legalCookieNoTrackHead', body: ['legalCookieNoTrackBody'] },
      { heading: 'legalCookieManageHead', body: ['legalCookieManageBody'] },
    ],
  },
  kvkk: {
    slug: 'kvkk',
    titleKey: 'legalKvkkTitle',
    introKey: 'legalKvkkIntro',
    sections: [
      { heading: 'legalKvkkScopeHead', body: ['legalKvkkScopeBody'] },
      { heading: 'legalKvkkDataHead', body: ['legalKvkkDataBody'] },
      { heading: 'legalKvkkPurposeHead', body: ['legalKvkkPurposeBody'] },
      { heading: 'legalKvkkBasisHead', body: ['legalKvkkBasisBody'] },
      { heading: 'legalKvkkRightsHead', body: ['legalKvkkRightsBody'] },
      { heading: 'legalKvkkContactHead', body: ['legalKvkkContactBody'] },
    ],
  },
  acceptableUse: {
    slug: 'acceptable-use',
    titleKey: 'legalAupTitle',
    introKey: 'legalAupIntro',
    sections: [
      { heading: 'legalAupOverviewHead', body: ['legalAupOverviewBody'] },
      {
        heading: 'legalAupProhibitedHead',
        body: ['legalAupProhibitedBody'],
        list: [
          'legalAupItemIllegal',
          'legalAupItemFraud',
          'legalAupItemMalware',
          'legalAupItemAccess',
          'legalAupItemPrivacy',
          'legalAupItemAutomation',
          'legalAupItemSafeguards',
        ],
      },
      { heading: 'legalAupConsequencesHead', body: ['legalAupConsequencesBody'] },
    ],
  },
};
