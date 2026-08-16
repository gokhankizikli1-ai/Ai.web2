import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import MarketingPage from '@/components/marketing/MarketingPage';
import { ResourceBody, ResourceHeader } from '@/components/marketing/ResourceLayout';
import { useLanguageStore } from '@/stores/languageStore';
import { Reveal } from '@/components/marketing/primitives';

/**
 * About.
 *
 * The previous version of this page claimed KorvixAI was "founded in 2025",
 * "serves thousands of users across development, design, content creation and
 * data analysis" and was "a fully remote team distributed across North America
 * and Europe" — none of which is supported by anything in this repository. All
 * of it is removed rather than restated more carefully.
 *
 * What remains is what can be said truthfully: what the product is, what it is
 * built around, and how it is being developed. There is no invented team size,
 * no customer count, no funding story, and no contact address.
 */

const PRINCIPLE_KEYS = [
  ['aboutP1Title', 'aboutP1Body'],
  ['aboutP2Title', 'aboutP2Body'],
  ['aboutP3Title', 'aboutP3Body'],
  ['aboutP4Title', 'aboutP4Body'],
];

export default function AboutPage() {
  const { t } = useLanguageStore();

  return (
    <MarketingPage title={t('aboutTitle')} description={t('aboutMeta')}>
      <ResourceHeader
        eyebrow={t('navCompany')}
        title={t('aboutTitle')}
        lead={t('aboutLead')}
        breadcrumb={[{ label: t('navHome'), to: '/' }, { label: t('footerAbout') }]}
      />

      <ResourceBody>
        <div className="mkt-prose max-w-[70ch]">
          <p>{t('aboutBody1')}</p>
          <p>{t('aboutBody2')}</p>
          <p>{t('aboutBody3')}</p>
        </div>

        <section className="mt-14" aria-labelledby="about-principles">
          <h2 id="about-principles" className="mkt-h3 text-[21px]">{t('aboutPrinciplesTitle')}</h2>
          <ul className="m-0 mt-6 grid list-none gap-4 p-0 sm:grid-cols-2">
            {PRINCIPLE_KEYS.map(([titleKey, bodyKey], i) => (
              <li key={titleKey}>
                <Reveal delay={i * 60}>
                  <div className="mkt-card h-full p-5">
                    <h3 className="m-0 text-[15px] font-semibold text-[color:var(--mkt-ink)]">
                      {t(titleKey)}
                    </h3>
                    <p className="m-0 mt-2 text-[13.5px] leading-relaxed text-[color:var(--mkt-muted)]">
                      {t(bodyKey)}
                    </p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-14 border-t border-[color:var(--mkt-border)] pt-8" aria-labelledby="about-contact">
          <h2 id="about-contact" className="mkt-h3 text-[17px]">{t('aboutContactTitle')}</h2>
          <p className="mt-2 max-w-[70ch] text-[14.5px] leading-relaxed text-[color:var(--mkt-muted)]">
            {t('aboutContactBody')}
          </p>
          <div className="mt-5 flex flex-wrap gap-4">
            <Link to="/help" className="mkt-textlink">
              {t('navHelp')}
              <ArrowRight aria-hidden="true" />
            </Link>
            <Link to="/security" className="mkt-textlink">
              {t('navSecurity')}
              <ArrowRight aria-hidden="true" />
            </Link>
            <Link to="/changelog" className="mkt-textlink">
              {t('navChangelog')}
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </section>
      </ResourceBody>
    </MarketingPage>
  );
}
