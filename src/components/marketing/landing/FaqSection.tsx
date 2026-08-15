import { Link } from 'react-router';
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from '@/components/ui/accordion';
import { useLanguageStore } from '@/stores/languageStore';
import { Reveal } from '@/components/marketing/primitives';

/**
 * FAQ — the questions a first-time visitor actually asks, answered from what
 * the product does today.
 *
 * Every answer is checkable against the repository: the connector routes are
 * read-only and project-scoped, credentials never leave the backend, a project
 * holds chats/products/goals/signals, Web Build produces a responsive site and
 * App Build a multi-screen React/Vite app that runs in the browser. No
 * guarantees, no certifications, no uptime numbers.
 */

const FAQ_KEYS = [
  ['faqQ1', 'faqA1'],
  ['faqQ2', 'faqA2'],
  ['faqQ3', 'faqA3'],
  ['faqQ4', 'faqA4'],
  ['faqQ5', 'faqA5'],
  ['faqQ6', 'faqA6'],
  ['faqQ7', 'faqA7'],
  ['faqQ8', 'faqA8'],
];

export default function FaqSection() {
  const { t } = useLanguageStore();

  return (
    <section id="faq" className="mkt-section" aria-labelledby="faq-title">
      <div className="mkt-wrap">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.62fr)_minmax(0,1.38fr)] lg:gap-16">
          <Reveal>
            <div className="lg:sticky lg:top-28">
              <span className="mkt-eyebrow">{t('faqEyebrow')}</span>
              <h2 id="faq-title" className="mkt-h2">{t('faqTitle')}</h2>
              <p className="mkt-sub">
                {t('faqLead')}{' '}
                <Link to="/help" className="text-[color:var(--mkt-brand)] underline underline-offset-2">
                  {t('faqHelpLink')}
                </Link>
              </p>
            </div>
          </Reveal>

          <Reveal delay={70}>
            <Accordion type="single" collapsible className="w-full">
              {FAQ_KEYS.map(([q, a], i) => (
                <AccordionItem
                  key={q}
                  value={`faq-${i}`}
                  className="border-b border-[color:var(--mkt-border)]"
                >
                  <AccordionTrigger className="py-5 text-left text-[15.5px] font-semibold text-[color:var(--mkt-ink)] hover:no-underline">
                    {t(q)}
                  </AccordionTrigger>
                  <AccordionContent className="pb-5 pr-6">
                    <p className="m-0 max-w-[72ch] text-[14px] leading-relaxed text-[color:var(--mkt-muted)]">
                      {t(a)}
                    </p>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
