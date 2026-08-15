import { Link } from 'react-router';
import { ShieldCheck, XCircle, FileCode2 } from 'lucide-react';
import MarketingPage from '@/components/marketing/MarketingPage';
import {
  EnglishOnlyNotice, OnThisPage, ResourceBody, ResourceHeader,
} from '@/components/marketing/ResourceLayout';
import { useLanguageStore } from '@/stores/languageStore';
import {
  SECURITY_GROUPS, SECURITY_NON_CLAIMS, SECURITY_REPORTING,
} from '@/content/security';

/**
 * Security page.
 *
 * Two rules shaped this page:
 *   1. Every claim names the code that backs it, so a reader (or an auditor,
 *      or a future maintainer) can check it instead of trusting a badge.
 *   2. Everything we do NOT have is stated explicitly — no SOC 2, no ISO 27001,
 *      no HIPAA, no published penetration test, no 24/7 team, no SLA — because
 *      a trust page that only lists strengths is not a trust page.
 *
 * Content lives in `@/content/security`.
 */
export default function SecurityPage() {
  const { t } = useLanguageStore();

  return (
    <MarketingPage title={t('secTitle')} description={t('secMeta')}>
      <ResourceHeader
        eyebrow={t('secEyebrow')}
        title={t('secTitle')}
        lead={t('secLead')}
        breadcrumb={[{ label: t('navHome'), to: '/' }, { label: t('navSecurity') }]}
      >
        <EnglishOnlyNotice />
      </ResourceHeader>

      <ResourceBody
        nav={
          <OnThisPage
            label={t('mktOnThisPage')}
            basePath="/security"
            items={[
              ...SECURITY_GROUPS.map((g) => ({ id: g.id, title: g.title })),
              { id: 'not-claimed', title: t('secNonClaimsNav') },
              { id: 'reporting', title: SECURITY_REPORTING.title },
            ]}
          />
        }
      >
        <div className="space-y-14">
          {SECURITY_GROUPS.map((group) => (
            <section key={group.id} id={group.id} aria-labelledby={`${group.id}-h`}>
              <h2 id={`${group.id}-h`} className="mkt-h3 flex items-center gap-2.5 text-[21px]">
                <ShieldCheck aria-hidden="true" className="h-5 w-5 text-[color:var(--mkt-brand)]" />
                {group.title}
              </h2>
              <p className="mt-2 max-w-[72ch] text-[14.5px] leading-relaxed text-[color:var(--mkt-muted)]">
                {group.intro}
              </p>

              <ul className="m-0 mt-6 list-none space-y-4 p-0">
                {group.claims.map((claim) => (
                  <li key={claim.title} className="mkt-card p-5">
                    <h3 className="m-0 text-[15px] font-semibold text-[color:var(--mkt-ink)]">
                      {claim.title}
                    </h3>
                    <p className="m-0 mt-2 max-w-[74ch] text-[14px] leading-relaxed text-[color:var(--mkt-body)]">
                      {claim.body}
                    </p>
                    <p className="m-0 mt-3 flex items-start gap-2 border-t border-[color:var(--mkt-border)] pt-3 text-[12px] leading-relaxed text-[color:var(--mkt-faint)]">
                      <FileCode2 aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        <span className="font-semibold">{t('secEvidence')}</span>{' '}
                        <span className="mkt-mono break-words">{claim.evidence}</span>
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {/* What we do not claim */}
          <section id="not-claimed" aria-labelledby="not-claimed-h">
            <h2 id="not-claimed-h" className="mkt-h3 flex items-center gap-2.5 text-[21px]">
              <XCircle aria-hidden="true" className="h-5 w-5 text-[color:var(--mkt-muted)]" />
              {t('secNonClaimsTitle')}
            </h2>
            <p className="mt-2 max-w-[72ch] text-[14.5px] leading-relaxed text-[color:var(--mkt-muted)]">
              {t('secNonClaimsLead')}
            </p>
            <ul className="m-0 mt-5 list-none space-y-2.5 p-0">
              {SECURITY_NON_CLAIMS.map((claim) => (
                <li
                  key={claim}
                  className="flex items-start gap-2.5 text-[14px] leading-relaxed text-[color:var(--mkt-body)]"
                >
                  <span
                    className="mt-[9px] h-1 w-3 shrink-0 rounded-full"
                    style={{ background: 'var(--mkt-border-strong)' }}
                    aria-hidden="true"
                  />
                  {claim}
                </li>
              ))}
            </ul>
          </section>

          {/* Reporting */}
          <section id="reporting" aria-labelledby="reporting-h">
            <h2 id="reporting-h" className="mkt-h3 text-[21px]">{SECURITY_REPORTING.title}</h2>
            <p className="mt-2 max-w-[74ch] text-[14.5px] leading-relaxed text-[color:var(--mkt-body)]">
              {SECURITY_REPORTING.body}
            </p>
          </section>

          <div className="border-t border-[color:var(--mkt-border)] pt-8">
            <p className="m-0 text-[14px] text-[color:var(--mkt-muted)]">
              {t('secRelated')}{' '}
              <Link to="/privacy" className="text-[color:var(--mkt-brand)] underline underline-offset-2">{t('legalNavPrivacy')}</Link>{' · '}
              <Link to="/privacy/regional" className="text-[color:var(--mkt-brand)] underline underline-offset-2">{t('navRegionalPrivacy')}</Link>{' · '}
              <Link to="/docs#connectors" className="text-[color:var(--mkt-brand)] underline underline-offset-2">{t('navConnectorsItem')}</Link>
            </p>
          </div>
        </div>
      </ResourceBody>
    </MarketingPage>
  );
}
