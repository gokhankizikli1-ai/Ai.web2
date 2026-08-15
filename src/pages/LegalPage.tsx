import { Link } from 'react-router';
import MarketingPage from '@/components/marketing/MarketingPage';
import { ResourceBody, ResourceHeader } from '@/components/marketing/ResourceLayout';
import { useLanguageStore } from '@/stores/languageStore';
import { LEGAL_DOCS, type LegalDocId } from './legalContent';

/**
 * Shared public legal / policy page.
 *
 * The document DATA and every string are unchanged — this page still renders
 * `legalContent.ts` through the centralized `t()` system in en / tr / de, so no
 * legal meaning was rewritten for aesthetics. What changed is the presentation:
 * these pages now sit on the light marketing shell with a readable prose
 * measure and a consistent cross-document navigation rail, instead of a dark
 * surface with low-contrast body text.
 */

/** Sibling policy documents, so a reader can move between them. */
const LEGAL_NAV: { id: LegalDocId; to: string; labelKey: string }[] = [
  { id: 'privacy', to: '/privacy', labelKey: 'legalNavPrivacy' },
  { id: 'terms', to: '/terms', labelKey: 'legalNavTerms' },
  { id: 'cookies', to: '/cookies', labelKey: 'legalNavCookies' },
  { id: 'acceptableUse', to: '/acceptable-use', labelKey: 'legalNavAup' },
];

export default function LegalPage({ doc: docId }: { doc: LegalDocId }) {
  const { t } = useLanguageStore();
  const doc = LEGAL_DOCS[docId];

  return (
    <MarketingPage title={t(doc.titleKey)}>
      <ResourceHeader
        eyebrow={t('footerLegal')}
        title={t(doc.titleKey)}
        lead={t(doc.introKey)}
        breadcrumb={[{ label: t('navHome'), to: '/' }, { label: t(doc.titleKey) }]}
      >
        <p className="mt-5 text-[12.5px] text-[color:var(--mkt-faint)]">{t('legalUpdated')}</p>
      </ResourceHeader>

      <ResourceBody
        nav={
          <nav aria-label={t('footerLegal')} className="lg:sticky lg:top-28">
            <p className="mkt-mono mb-3 uppercase tracking-[0.09em] text-[color:var(--mkt-faint)]">
              {t('footerLegal')}
            </p>
            <ul className="m-0 list-none space-y-1 p-0">
              {LEGAL_NAV.map((item) => {
                const active = item.id === docId;
                return (
                  <li key={item.id}>
                    <Link
                      to={item.to}
                      aria-current={active ? 'page' : undefined}
                      className={`block rounded-lg px-2.5 py-1.5 text-[13.5px] transition-colors ${
                        active
                          ? 'bg-[color:var(--mkt-section)] font-semibold text-[color:var(--mkt-ink)]'
                          : 'text-[color:var(--mkt-muted)] hover:bg-[color:var(--mkt-section)] hover:text-[color:var(--mkt-ink)]'
                      }`}
                    >
                      {t(item.labelKey)}
                    </Link>
                  </li>
                );
              })}
              <li>
                <Link
                  to="/privacy/regional"
                  className="block rounded-lg px-2.5 py-1.5 text-[13.5px] text-[color:var(--mkt-muted)] transition-colors hover:bg-[color:var(--mkt-section)] hover:text-[color:var(--mkt-ink)]"
                >
                  {t('navRegionalPrivacy')}
                </Link>
              </li>
              <li>
                <Link
                  to="/security"
                  className="block rounded-lg px-2.5 py-1.5 text-[13.5px] text-[color:var(--mkt-muted)] transition-colors hover:bg-[color:var(--mkt-section)] hover:text-[color:var(--mkt-ink)]"
                >
                  {t('navSecurity')}
                </Link>
              </li>
            </ul>
          </nav>
        }
      >
        <div className="mkt-prose">
          {doc.sections.map((section) => (
            <section key={section.heading} aria-labelledby={section.heading}>
              <h2 id={section.heading}>{t(section.heading)}</h2>
              {section.body?.map((key) => <p key={key}>{t(key)}</p>)}
              {section.list && (
                <ul>
                  {section.list.map((key) => <li key={key}>{t(key)}</li>)}
                </ul>
              )}
            </section>
          ))}
        </div>
      </ResourceBody>
    </MarketingPage>
  );
}
