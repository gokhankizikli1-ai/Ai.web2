import { MessageSquare, Search, Blocks, Plug, ArrowDown } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { Reveal, SectionHeading } from '@/components/marketing/primitives';

/**
 * "One project, shared context" — why Korvix is more than a folder of separate
 * AI tools.
 *
 * The composition is deliberately NOT a card grid: three inputs feed one
 * project, and the project keeps a short, bounded set of things. Those things
 * are the real contents of a Korvix project (chats, generated products, a
 * working summary, current goals, and recent connector signals — see the
 * project brain snapshot the app reads at /v2/projects/{id}/brain), not an
 * architecture diagram and not invented "memory" claims.
 */

const INPUTS = [
  { icon: MessageSquare, titleKey: 'ctxInput1Title', bodyKey: 'ctxInput1Body' },
  { icon: Search, titleKey: 'ctxInput2Title', bodyKey: 'ctxInput2Body' },
  { icon: Blocks, titleKey: 'ctxInput3Title', bodyKey: 'ctxInput3Body' },
  { icon: Plug, titleKey: 'ctxInput4Title', bodyKey: 'ctxInput4Body' },
];

const KEEPS = ['ctxKeep1', 'ctxKeep2', 'ctxKeep3', 'ctxKeep4', 'ctxKeep5'];

export default function ContextSection() {
  const { t } = useLanguageStore();

  return (
    <section id="context" className="mkt-section" aria-labelledby="context-title">
      <div className="mkt-wrap">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-end lg:gap-16">
          <Reveal>
            <SectionHeading
              eyebrow={t('ctxEyebrow')}
              title={t('ctxTitle')}
              lead={t('ctxLead')}
            />
          </Reveal>
          <Reveal delay={80}>
            <p className="mkt-sub lg:pb-1">{t('ctxLeadSecondary')}</p>
          </Reveal>
        </div>

        {/* Inputs → project → what it keeps */}
        <div className="mt-14 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {INPUTS.map((item, i) => (
            <Reveal key={item.titleKey} delay={i * 70}>
              <div className="mkt-card mkt-card-lift h-full p-5">
                <span
                  className="grid h-9 w-9 place-items-center rounded-[10px]"
                  style={{ background: 'var(--mkt-brand-wash)', color: 'var(--mkt-brand)' }}
                  aria-hidden="true"
                >
                  <item.icon className="h-[18px] w-[18px]" />
                </span>
                <h3 className="mkt-h3 mt-4 text-[16.5px]">{t(item.titleKey)}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-[color:var(--mkt-muted)]">
                  {t(item.bodyKey)}
                </p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={120}>
          <div className="mt-8 flex justify-center" aria-hidden="true">
            <ArrowDown className="h-5 w-5 text-[color:var(--mkt-faint)]" />
          </div>
        </Reveal>

        <Reveal delay={140}>
          <div
            className="mkt-card mt-8 overflow-hidden p-0"
            style={{ borderColor: 'rgba(79,70,229,0.28)' }}
          >
            <div className="grid gap-0 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
              <div className="border-b border-[color:var(--mkt-border)] p-6 md:border-b-0 md:border-r">
                <h3 id="context-title" className="mkt-h3">{t('ctxProjectTitle')}</h3>
                <p className="mt-2.5 text-[14px] leading-relaxed text-[color:var(--mkt-muted)]">
                  {t('ctxProjectBody')}
                </p>
              </div>
              <div className="bg-[color:var(--mkt-section)] p-6">
                <p className="mkt-mono mb-3 uppercase tracking-[0.09em] text-[color:var(--mkt-faint)]">
                  {t('ctxKeepsLabel')}
                </p>
                <ul className="m-0 grid list-none gap-2.5 p-0 sm:grid-cols-2">
                  {KEEPS.map((k) => (
                    <li key={k} className="flex items-start gap-2.5 text-[13.5px] text-[color:var(--mkt-body)]">
                      <span
                        className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: 'var(--mkt-brand)' }}
                        aria-hidden="true"
                      />
                      {t(k)}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
