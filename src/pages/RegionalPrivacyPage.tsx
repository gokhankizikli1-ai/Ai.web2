import { Link, useParams } from 'react-router';
import { ArrowRight, AlertTriangle } from 'lucide-react';
import MarketingPage from '@/components/marketing/MarketingPage';
import { EnglishOnlyNotice, ResourceBody, ResourceHeader } from '@/components/marketing/ResourceLayout';
import { useLanguageStore } from '@/stores/languageStore';
import {
  REGIONS, REGION_PENDING_LEGAL_REVIEW, REGION_PRODUCT_CONTROLS, type Region,
} from '@/content/regions';
import { LEGAL_DOCS } from '@/pages/legalContent';

/**
 * Regional privacy rights.
 *
 * `/privacy/regional` is a hub with a clean region picker; each region has its
 * own page at `/privacy/regional/:slug`. The Privacy Policy remains the single
 * global policy — this layer explains, at a high level, the rights categories
 * that commonly apply in a region and how to use the equivalent controls in the
 * product today.
 *
 * Honesty constraints (see `@/content/regions`):
 *   • no invented company entity, address, DPO, representative, regulator
 *     registration, subprocessor list or transfer mechanism — every one of
 *     those is listed openly as pending legal review instead;
 *   • Germany and Spain live under the EU/EEA page rather than pretending each
 *     country needs an unrelated global policy;
 *   • Türkiye reproduces the EXISTING localized KVKK information notice, so no
 *     shipped legal text was deleted or rewritten; `/kvkk` redirects here.
 */

function RegionHub() {
  const { t } = useLanguageStore();
  return (
    <MarketingPage title={t('regTitle')} description={t('regMeta')}>
      <ResourceHeader
        eyebrow={t('regEyebrow')}
        title={t('regTitle')}
        lead={t('regLead')}
        breadcrumb={[
          { label: t('navHome'), to: '/' },
          { label: t('legalNavPrivacy'), to: '/privacy' },
          { label: t('navRegionalPrivacy') },
        ]}
      >
        <EnglishOnlyNotice />
      </ResourceHeader>

      <ResourceBody>
        <p className="max-w-[74ch] text-[14.5px] leading-relaxed text-[color:var(--mkt-muted)]">
          {t('regHubIntro')}
        </p>

        <ul className="m-0 mt-8 grid list-none gap-3 p-0 md:grid-cols-2">
          {REGIONS.map((region) => (
            <li key={region.slug}>
              <Link
                to={`/privacy/regional/${region.slug}`}
                className="mkt-card mkt-card-lift flex h-full flex-col p-5"
              >
                <span className="text-[15px] font-semibold text-[color:var(--mkt-ink)]">
                  {region.name}
                </span>
                <span className="mt-1.5 block flex-1 text-[13.5px] leading-relaxed text-[color:var(--mkt-muted)]">
                  {region.blurb}
                </span>
                <span className="mkt-textlink mt-4 text-[13px]">
                  {t('regOpen')}
                  <ArrowRight aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="mt-10 border-t border-[color:var(--mkt-border)] pt-8">
          <p className="m-0 max-w-[74ch] text-[14px] leading-relaxed text-[color:var(--mkt-muted)]">
            {t('regGlobalNote')}{' '}
            <Link to="/privacy" className="text-[color:var(--mkt-brand)] underline underline-offset-2">
              {t('legalNavPrivacy')}
            </Link>
            .
          </p>
        </div>
      </ResourceBody>
    </MarketingPage>
  );
}

/** The shipped KVKK notice, rendered from the existing localized legal keys. */
function EmbeddedKvkk() {
  const { t } = useLanguageStore();
  const doc = LEGAL_DOCS.kvkk;
  return (
    <section className="mt-12 border-t border-[color:var(--mkt-border)] pt-10" aria-labelledby="kvkk-h">
      <h2 id="kvkk-h" className="mkt-h3 text-[21px]">{t(doc.titleKey)}</h2>
      <div className="mkt-prose mt-4">
        <p>{t(doc.introKey)}</p>
        {doc.sections.map((section) => (
          <div key={section.heading}>
            <h3>{t(section.heading)}</h3>
            {section.body?.map((k) => <p key={k}>{t(k)}</p>)}
            {section.list && (
              <ul>{section.list.map((k) => <li key={k}>{t(k)}</li>)}</ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function RegionDetail({ region }: { region: Region }) {
  const { t } = useLanguageStore();

  return (
    <MarketingPage title={`${region.name} — ${t('regTitle')}`} description={region.blurb}>
      <ResourceHeader
        eyebrow={t('navRegionalPrivacy')}
        title={region.name}
        lead={region.framework}
        breadcrumb={[
          { label: t('navHome'), to: '/' },
          { label: t('legalNavPrivacy'), to: '/privacy' },
          { label: t('navRegionalPrivacy'), to: '/privacy/regional' },
          { label: region.name },
        ]}
      >
        <EnglishOnlyNotice />
      </ResourceHeader>

      <ResourceBody
        nav={
          <nav aria-label={t('regSwitch')} className="lg:sticky lg:top-28">
            <p className="mkt-mono mb-3 uppercase tracking-[0.09em] text-[color:var(--mkt-faint)]">
              {t('regSwitch')}
            </p>
            <ul className="m-0 list-none space-y-1 p-0">
              {REGIONS.map((r) => {
                const active = r.slug === region.slug;
                return (
                  <li key={r.slug}>
                    <Link
                      to={`/privacy/regional/${r.slug}`}
                      aria-current={active ? 'page' : undefined}
                      className={`block rounded-lg px-2.5 py-1.5 text-[13.5px] transition-colors ${
                        active
                          ? 'bg-[color:var(--mkt-section)] font-semibold text-[color:var(--mkt-ink)]'
                          : 'text-[color:var(--mkt-muted)] hover:bg-[color:var(--mkt-section)] hover:text-[color:var(--mkt-ink)]'
                      }`}
                    >
                      {r.name}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        }
      >
        <div className="max-w-[76ch]">
          <section aria-labelledby="rights-h">
            <h2 id="rights-h" className="mkt-h3 text-[21px]">{t('regRightsTitle')}</h2>
            <p className="mt-2 text-[14.5px] leading-relaxed text-[color:var(--mkt-muted)]">
              {t('regRightsLead')}
            </p>
            <ul className="m-0 mt-4 list-none space-y-2.5 p-0">
              {region.rights.map((r) => (
                <li key={r} className="flex items-start gap-2.5 text-[14.5px] leading-relaxed text-[color:var(--mkt-body)]">
                  <span
                    className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: 'var(--mkt-brand)' }}
                    aria-hidden="true"
                  />
                  {r}
                </li>
              ))}
            </ul>
          </section>

          {region.notes && region.notes.length > 0 && (
            <section className="mt-10" aria-labelledby="notes-h">
              <h2 id="notes-h" className="mkt-h3 text-[17px]">{t('regNotesTitle')}</h2>
              <ul className="m-0 mt-3 list-none space-y-2 p-0">
                {region.notes.map((n) => (
                  <li key={n} className="text-[14px] leading-relaxed text-[color:var(--mkt-muted)]">{n}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-10" aria-labelledby="controls-h">
            <h2 id="controls-h" className="mkt-h3 text-[21px]">{t('regControlsTitle')}</h2>
            <p className="mt-2 text-[14.5px] leading-relaxed text-[color:var(--mkt-muted)]">
              {t('regControlsLead')}
            </p>
            <ul className="m-0 mt-4 list-none space-y-2.5 p-0">
              {REGION_PRODUCT_CONTROLS.map((c) => (
                <li key={c} className="flex items-start gap-2.5 text-[14.5px] leading-relaxed text-[color:var(--mkt-body)]">
                  <span
                    className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: 'var(--mkt-accent)' }}
                    aria-hidden="true"
                  />
                  {c}
                </li>
              ))}
            </ul>
          </section>

          {region.embeddedLegalDoc === 'kvkk' && <EmbeddedKvkk />}

          <section
            className="mt-12 rounded-[14px] border border-[color:var(--mkt-border)] bg-[color:var(--mkt-section)] p-5"
            aria-labelledby="pending-h"
          >
            <h2 id="pending-h" className="m-0 flex items-center gap-2 text-[15px] font-semibold text-[color:var(--mkt-ink)]">
              <AlertTriangle aria-hidden="true" className="h-4 w-4 text-[color:var(--mkt-brand)]" />
              {t('regPendingTitle')}
            </h2>
            <p className="m-0 mt-2 text-[13.5px] leading-relaxed text-[color:var(--mkt-muted)]">
              {t('regPendingLead')}
            </p>
            <ul className="m-0 mt-3 list-disc space-y-1.5 pl-5 text-[13.5px] leading-relaxed text-[color:var(--mkt-muted)]">
              {REGION_PENDING_LEGAL_REVIEW.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>

          <p className="mt-8 text-[13px] leading-relaxed text-[color:var(--mkt-faint)]">
            {t('regDisclaimer')}
          </p>
        </div>
      </ResourceBody>
    </MarketingPage>
  );
}

export default function RegionalPrivacyPage() {
  const { region: slug } = useParams();
  if (!slug) return <RegionHub />;
  const region = REGIONS.find((r) => r.slug === slug);
  // An unknown region slug shows the hub rather than a dead end.
  if (!region) return <RegionHub />;
  return <RegionDetail region={region} />;
}
