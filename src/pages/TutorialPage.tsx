import { Link, useParams } from 'react-router';
import { ArrowLeft, Check, Info } from 'lucide-react';
import MarketingPage from '@/components/marketing/MarketingPage';
import { EnglishOnlyNotice, ResourceBody, ResourceHeader } from '@/components/marketing/ResourceLayout';
import { useLanguageStore } from '@/stores/languageStore';
import { TUTORIALS, tutorialBySlug } from '@/content/tutorials';

/**
 * A single tutorial. An unknown slug renders a real "not found" state with a
 * way back into the hub — never a blank page and never a redirect that hides
 * the broken link.
 */
export default function TutorialPage() {
  const { slug } = useParams();
  const { t } = useLanguageStore();
  const tut = tutorialBySlug(slug);

  if (!tut) {
    return (
      <MarketingPage title={t('tutNotFoundTitle')}>
        <ResourceHeader
          title={t('tutNotFoundTitle')}
          lead={t('tutNotFoundLead')}
          breadcrumb={[{ label: t('navHome'), to: '/' }, { label: t('navTutorials'), to: '/tutorials' }]}
        />
        <ResourceBody>
          <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
            {TUTORIALS.map((x) => (
              <li key={x.slug}>
                <Link to={`/tutorials/${x.slug}`} className="mkt-card mkt-card-lift block p-4">
                  <span className="text-[14px] font-semibold text-[color:var(--mkt-ink)]">{x.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </ResourceBody>
      </MarketingPage>
    );
  }

  return (
    <MarketingPage title={tut.title} description={tut.summary}>
      <ResourceHeader
        eyebrow={t('navTutorials')}
        title={tut.title}
        lead={tut.summary}
        breadcrumb={[
          { label: t('navHome'), to: '/' },
          { label: t('navTutorials'), to: '/tutorials' },
          { label: tut.title },
        ]}
      >
        <EnglishOnlyNotice />
      </ResourceHeader>

      <ResourceBody>
        <div className="max-w-[74ch]">
          <section aria-labelledby="tut-before">
            <h2 id="tut-before" className="mkt-h3 text-[17px]">{t('tutBefore')}</h2>
            <ul className="m-0 mt-3 list-none space-y-2 p-0">
              {tut.before.map((b) => (
                <li key={b} className="flex items-start gap-2.5 text-[14px] text-[color:var(--mkt-body)]">
                  <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--mkt-brand)]" />
                  {b}
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-10" aria-labelledby="tut-steps">
            <h2 id="tut-steps" className="mkt-h3 text-[17px]">{t('tutSteps')}</h2>
            <ol className="m-0 mt-5 list-none space-y-7 p-0">
              {tut.steps.map((s, i) => (
                <li key={s.title} className="flex gap-4">
                  <span
                    className="mkt-mono grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[12px] font-semibold"
                    style={{ background: 'var(--mkt-brand-wash)', color: 'var(--mkt-brand)' }}
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="m-0 text-[15.5px] font-semibold text-[color:var(--mkt-ink)]">
                      {s.title}
                    </h3>
                    <p className="m-0 mt-1.5 text-[14.5px] leading-relaxed text-[color:var(--mkt-body)]">
                      {s.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {tut.after && tut.after.length > 0 && (
            <section className="mt-10 rounded-[14px] border border-[color:var(--mkt-border)] bg-[color:var(--mkt-section)] p-5" aria-labelledby="tut-after">
              <h2 id="tut-after" className="m-0 flex items-center gap-2 text-[14px] font-semibold text-[color:var(--mkt-ink)]">
                <Info aria-hidden="true" className="h-4 w-4 text-[color:var(--mkt-brand)]" />
                {t('tutGoodToKnow')}
              </h2>
              <ul className="m-0 mt-3 list-none space-y-2 p-0">
                {tut.after.map((a) => (
                  <li key={a} className="text-[13.5px] leading-relaxed text-[color:var(--mkt-muted)]">
                    {a}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="mt-12 flex flex-wrap items-center gap-4 border-t border-[color:var(--mkt-border)] pt-6">
            <Link to="/tutorials" className="mkt-textlink">
              <ArrowLeft aria-hidden="true" />
              {t('tutBackToAll')}
            </Link>
            <Link to="/docs" className="mkt-textlink">
              {t('navDocs')}
            </Link>
          </div>
        </div>
      </ResourceBody>
    </MarketingPage>
  );
}
