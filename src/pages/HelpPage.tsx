import { Link } from 'react-router';
import MarketingPage from '@/components/marketing/MarketingPage';
import {
  EnglishOnlyNotice, OnThisPage, ResourceBody, ResourceHeader,
} from '@/components/marketing/ResourceLayout';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import { useLanguageStore } from '@/stores/languageStore';
import { HELP_CATEGORIES } from '@/content/help';

/**
 * Help Center — genuine self-service, and honest about what it is.
 *
 * There is no staffed support desk and no published support address in this
 * repository, so this page does NOT invent one (no support@ address, no ticket
 * form, no "we usually reply within X hours"). It says plainly that help here is
 * self-service and points to the documentation, tutorials and security pages.
 */
export default function HelpPage() {
  const { t } = useLanguageStore();

  return (
    <MarketingPage title={t('helpTitle')} description={t('helpMeta')}>
      <ResourceHeader
        eyebrow={t('navResources')}
        title={t('helpTitle')}
        lead={t('helpLead')}
        breadcrumb={[{ label: t('navHome'), to: '/' }, { label: t('navHelp') }]}
      >
        <EnglishOnlyNotice />
      </ResourceHeader>

      <ResourceBody
        nav={
          <OnThisPage
            label={t('mktOnThisPage')}
            basePath="/help"
            items={HELP_CATEGORIES.map((c) => ({ id: c.id, title: c.title }))}
          />
        }
      >
        {/* The honest support statement — stated up front, not buried. */}
        <div className="mkt-card mb-12 p-5">
          <h2 className="m-0 text-[15px] font-semibold text-[color:var(--mkt-ink)]">
            {t('helpNoDeskTitle')}
          </h2>
          <p className="m-0 mt-2 max-w-[70ch] text-[14px] leading-relaxed text-[color:var(--mkt-muted)]">
            {t('helpNoDeskBody')}
          </p>
        </div>

        <div className="space-y-14">
          {HELP_CATEGORIES.map((cat) => (
            <section key={cat.id} id={cat.id} aria-labelledby={`${cat.id}-h`}>
              <h2 id={`${cat.id}-h`} className="mkt-h3 text-[21px]">{cat.title}</h2>
              <p className="mt-2 max-w-[70ch] text-[14.5px] leading-relaxed text-[color:var(--mkt-muted)]">
                {cat.intro}
              </p>

              <Accordion type="single" collapsible className="mt-5 w-full">
                {cat.items.map((item, i) => (
                  <AccordionItem
                    key={item.q}
                    value={`${cat.id}-${i}`}
                    className="border-b border-[color:var(--mkt-border)]"
                  >
                    <AccordionTrigger className="py-4 text-left text-[14.5px] font-semibold text-[color:var(--mkt-ink)] hover:no-underline">
                      {item.q}
                    </AccordionTrigger>
                    <AccordionContent className="pb-4 pr-6">
                      {item.a.map((p, pi) => (
                        <p
                          key={pi}
                          className="m-0 mb-2 max-w-[72ch] text-[14px] leading-relaxed text-[color:var(--mkt-muted)] last:mb-0"
                        >
                          {p}
                        </p>
                      ))}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>
          ))}
        </div>

        <div className="mt-14 border-t border-[color:var(--mkt-border)] pt-8">
          <p className="m-0 text-[14px] text-[color:var(--mkt-muted)]">
            {t('helpMoreLinks')}{' '}
            <Link to="/docs" className="text-[color:var(--mkt-brand)] underline underline-offset-2">{t('navDocs')}</Link>{' · '}
            <Link to="/tutorials" className="text-[color:var(--mkt-brand)] underline underline-offset-2">{t('navTutorials')}</Link>{' · '}
            <Link to="/security" className="text-[color:var(--mkt-brand)] underline underline-offset-2">{t('navSecurity')}</Link>{' · '}
            <Link to="/privacy" className="text-[color:var(--mkt-brand)] underline underline-offset-2">{t('legalNavPrivacy')}</Link>
          </p>
        </div>
      </ResourceBody>
    </MarketingPage>
  );
}
