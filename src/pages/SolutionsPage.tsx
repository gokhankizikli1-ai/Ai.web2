import { Link } from 'react-router';
import { ArrowRight, Check } from 'lucide-react';
import MarketingPage from '@/components/marketing/MarketingPage';
import { useLanguageStore } from '@/stores/languageStore';
import { useAuthStore } from '@/stores/authStore';
import { Reveal } from '@/components/marketing/primitives';

/**
 * Solutions — the four audiences the Solutions menu points at, each with the
 * work they would actually do in Korvix.
 *
 * Written against real capability: no audience is offered team seats, SSO,
 * an admin console, an SLA or a bespoke enterprise deployment, because none of
 * those exist. `/use-cases` redirects here.
 */

const AUDIENCES = [
  {
    id: 'founders',
    titleKey: 'solFoundersTitle',
    leadKey: 'solFoundersLead',
    doKeys: ['solFoundersDo1', 'solFoundersDo2', 'solFoundersDo3'],
    flowKey: 'solFoundersFlow',
  },
  {
    id: 'developers',
    titleKey: 'solDevelopersTitle',
    leadKey: 'solDevelopersLead',
    doKeys: ['solDevelopersDo1', 'solDevelopersDo2', 'solDevelopersDo3'],
    flowKey: 'solDevelopersFlow',
  },
  {
    id: 'product-teams',
    titleKey: 'solTeamsTitle',
    leadKey: 'solTeamsLead',
    doKeys: ['solTeamsDo1', 'solTeamsDo2', 'solTeamsDo3'],
    flowKey: 'solTeamsFlow',
  },
  {
    id: 'agencies',
    titleKey: 'solAgenciesTitle',
    leadKey: 'solAgenciesLead',
    doKeys: ['solAgenciesDo1', 'solAgenciesDo2', 'solAgenciesDo3'],
    flowKey: 'solAgenciesFlow',
  },
];

export default function SolutionsPage() {
  const { t } = useLanguageStore();
  const { isAuthenticated } = useAuthStore();

  return (
    <MarketingPage title={t('solPageTitle')} description={t('solMeta')}>
      <section className="mkt-section-tight pt-16" aria-labelledby="solutions-title">
        <div className="mkt-wrap">
          <span className="mkt-eyebrow">{t('navSolutions')}</span>
          <h1 id="solutions-title" className="mkt-h1 mt-4 max-w-[17ch]">{t('solPageTitle')}</h1>
          <p className="mkt-lead">{t('solPageLead')}</p>

          <nav aria-label={t('mktOnThisPage')} className="mt-8">
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {AUDIENCES.map((a) => (
                <li key={a.id}>
                  <Link
                    to={`/solutions#${a.id}`}
                    className="mkt-chip transition-colors hover:border-[color:var(--mkt-border-strong)] hover:text-[color:var(--mkt-ink)]"
                  >
                    {t(a.titleKey)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </section>

      {AUDIENCES.map((a, i) => (
        <section
          key={a.id}
          id={a.id}
          className={`mkt-section ${i % 2 === 1 ? 'mkt-band' : ''}`}
          aria-labelledby={`${a.id}-h`}
        >
          <div className="mkt-wrap">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
              <Reveal>
                <span className="mkt-mono text-[12px] font-semibold text-[color:var(--mkt-faint)]">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h2 id={`${a.id}-h`} className="mkt-h2 mt-2 text-[clamp(24px,2.6vw,32px)]">
                  {t(a.titleKey)}
                </h2>
                <p className="mkt-sub">{t(a.leadKey)}</p>
              </Reveal>

              <Reveal delay={70}>
                <ul className="m-0 list-none space-y-3.5 p-0">
                  {a.doKeys.map((k) => (
                    <li key={k} className="flex items-start gap-3">
                      <Check aria-hidden="true" className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[color:var(--mkt-brand)]" />
                      <span className="text-[14.5px] leading-relaxed text-[color:var(--mkt-body)]">
                        {t(k)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-6 max-w-[60ch] rounded-[12px] border border-[color:var(--mkt-border)] bg-[color:var(--mkt-surface)] px-4 py-3 text-[13.5px] leading-relaxed text-[color:var(--mkt-muted)]">
                  {t(a.flowKey)}
                </p>
              </Reveal>
            </div>
          </div>
        </section>
      ))}

      <section className="mkt-section-tight" aria-labelledby="solutions-cta">
        <div className="mkt-wrap">
          <div className="mkt-card flex flex-wrap items-center justify-between gap-6 p-7">
            <div>
              <h2 id="solutions-cta" className="mkt-h3 text-[20px]">{t('solCtaTitle')}</h2>
              <p className="mt-2 max-w-[54ch] text-[14px] leading-relaxed text-[color:var(--mkt-muted)]">
                {t('solCtaLead')}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                to={isAuthenticated ? '/chat' : '/signup'}
                className="mkt-btn mkt-btn-primary"
              >
                {isAuthenticated ? t('navOpenWorkspace') : t('ctaGetStarted')}
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
              <Link to="/tutorials" className="mkt-btn mkt-btn-outline">
                {t('navTutorials')}
              </Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingPage>
  );
}
