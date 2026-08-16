import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import MarketingPage from '@/components/marketing/MarketingPage';
import { EnglishOnlyNotice, ResourceBody, ResourceHeader } from '@/components/marketing/ResourceLayout';
import { useLanguageStore } from '@/stores/languageStore';
import { TUTORIALS, TUTORIAL_GROUPS } from '@/content/tutorials';

/**
 * Tutorials hub — every entry is a real walkthrough with real steps (see
 * `@/content/tutorials`), grouped by what the reader is trying to do.
 */
export default function TutorialsPage() {
  const { t } = useLanguageStore();

  return (
    <MarketingPage title={t('tutTitle')} description={t('tutMeta')}>
      <ResourceHeader
        eyebrow={t('navResources')}
        title={t('tutTitle')}
        lead={t('tutLead')}
        breadcrumb={[{ label: t('navHome'), to: '/' }, { label: t('navTutorials') }]}
      >
        <EnglishOnlyNotice />
      </ResourceHeader>

      <ResourceBody>
        <div className="space-y-12">
          {TUTORIAL_GROUPS.map((group) => {
            const items = TUTORIALS.filter((x) => x.group === group.id);
            if (items.length === 0) return null;
            return (
              <section key={group.id} aria-labelledby={`tut-${group.id}`}>
                <h2 id={`tut-${group.id}`} className="mkt-h3 text-[20px]">{group.title}</h2>
                <ul className="m-0 mt-5 grid list-none gap-3 p-0 md:grid-cols-2">
                  {items.map((tut) => (
                    <li key={tut.slug}>
                      <Link
                        to={`/tutorials/${tut.slug}`}
                        className="mkt-card mkt-card-lift flex h-full flex-col p-5"
                      >
                        <span className="text-[15px] font-semibold text-[color:var(--mkt-ink)]">
                          {tut.title}
                        </span>
                        <span className="mt-2 block flex-1 text-[13.5px] leading-relaxed text-[color:var(--mkt-muted)]">
                          {tut.summary}
                        </span>
                        <span className="mkt-textlink mt-4 text-[13px]">
                          {t('tutOpen')}
                          <ArrowRight aria-hidden="true" />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </ResourceBody>
    </MarketingPage>
  );
}
