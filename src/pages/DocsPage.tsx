import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import MarketingPage from '@/components/marketing/MarketingPage';
import {
  EnglishOnlyNotice, OnThisPage, ResourceBody, ResourceHeader,
} from '@/components/marketing/ResourceLayout';
import { useLanguageStore } from '@/stores/languageStore';
import { DOC_TOPICS } from '@/content/docs';
import { tutorialBySlug } from '@/content/tutorials';

/**
 * Documentation hub — one organized page covering the real Korvix concepts,
 * with an anchor per topic so `/docs#connectors` is a stable, linkable
 * destination.
 *
 * It documents behaviour, not architecture: there is no API reference here
 * because there is no publicly supported API, and nothing describes an internal
 * pipeline the reader cannot see. Content lives in `@/content/docs`.
 */
export default function DocsPage() {
  const { t } = useLanguageStore();

  return (
    <MarketingPage title={t('docsTitle')} description={t('docsMeta')}>
      <ResourceHeader
        eyebrow={t('navResources')}
        title={t('docsTitle')}
        lead={t('docsLead')}
        breadcrumb={[{ label: t('navHome'), to: '/' }, { label: t('navDocs') }]}
      >
        <EnglishOnlyNotice />
      </ResourceHeader>

      <ResourceBody
        nav={
          <OnThisPage
            label={t('mktOnThisPage')}
            basePath="/docs"
            items={DOC_TOPICS.map((d) => ({ id: d.id, title: d.title }))}
          />
        }
      >
        {/* Topic cards for scanning — same destinations as the sticky nav. */}
        <ul className="m-0 mb-14 grid list-none gap-3 p-0 sm:grid-cols-2">
          {DOC_TOPICS.map((topic) => (
            <li key={topic.id}>
              <Link to={`/docs#${topic.id}`} className="mkt-card mkt-card-lift block h-full p-4">
                <span className="text-[14px] font-semibold text-[color:var(--mkt-ink)]">
                  {topic.title}
                </span>
                <span className="mt-1.5 block text-[13px] leading-relaxed text-[color:var(--mkt-muted)]">
                  {topic.summary}
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="space-y-16">
          {DOC_TOPICS.map((topic) => (
            <section key={topic.id} id={topic.id} aria-labelledby={`${topic.id}-h`}>
              <h2 id={`${topic.id}-h`} className="mkt-h3 text-[24px]">{topic.title}</h2>
              <p className="mt-2 max-w-[70ch] text-[15px] leading-relaxed text-[color:var(--mkt-muted)]">
                {topic.summary}
              </p>

              <div className="mkt-prose mt-6">
                {topic.blocks.map((block, bi) => (
                  <div key={bi}>
                    {block.body?.map((p, i) => <p key={i}>{p}</p>)}

                    {block.steps && (
                      <ol className="m-0 mb-4 list-none space-y-3 p-0">
                        {block.steps.map((s, i) => (
                          <li key={i} className="flex gap-3">
                            <span
                              className="mkt-mono mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md text-[11px] font-semibold"
                              style={{ background: 'var(--mkt-brand-wash)', color: 'var(--mkt-brand)' }}
                              aria-hidden="true"
                            >
                              {i + 1}
                            </span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ol>
                    )}

                    {block.list && (
                      <ul>
                        {block.list.map((l, i) => <li key={i}>{l}</li>)}
                      </ul>
                    )}

                    {block.note && (
                      <p className="rounded-[12px] border border-[color:var(--mkt-border)] bg-[color:var(--mkt-section)] px-4 py-3 text-[13.5px] leading-relaxed text-[color:var(--mkt-muted)]">
                        {block.note}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {topic.tutorials && topic.tutorials.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-2">
                  {topic.tutorials.map((slug) => {
                    const tut = tutorialBySlug(slug);
                    if (!tut) return null;
                    return (
                      <Link
                        key={slug}
                        to={`/tutorials/${slug}`}
                        className="mkt-chip transition-colors hover:border-[color:var(--mkt-border-strong)] hover:text-[color:var(--mkt-ink)]"
                      >
                        {tut.title}
                        <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </div>

        <div className="mt-16 border-t border-[color:var(--mkt-border)] pt-8">
          <p className="m-0 text-[14px] text-[color:var(--mkt-muted)]">
            {t('docsFooterHelp')}{' '}
            <Link to="/help" className="text-[color:var(--mkt-brand)] underline underline-offset-2">
              {t('navHelp')}
            </Link>{' '}·{' '}
            <Link to="/tutorials" className="text-[color:var(--mkt-brand)] underline underline-offset-2">
              {t('navTutorials')}
            </Link>{' '}·{' '}
            <Link to="/security" className="text-[color:var(--mkt-brand)] underline underline-offset-2">
              {t('navSecurity')}
            </Link>
          </p>
        </div>
      </ResourceBody>
    </MarketingPage>
  );
}
