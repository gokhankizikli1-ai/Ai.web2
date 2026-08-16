import { ArrowRight, ArrowDown } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { useReveal } from '@/components/marketing/useReveal';
import { CONNECTORS } from '@/lib/marketingNav';
import {
  ArrowLink, ConnectorMark, IllustrativeTag, Reveal,
} from '@/components/marketing/primitives';

/**
 * Connected intelligence — the section that explains why Korvix knows anything
 * about the work happening around a project.
 *
 * Motion moment 2: each connector emits ONE signal that travels into the
 * project's signal list, then the list settles. It plays once on scroll-in and
 * then rests — no looping conveyor belt.
 *
 * Accuracy rules applied here (verified against backend/routes/v2_*.py):
 *   • every connector is READ-ONLY toward the provider, and each row says what
 *     it can never do;
 *   • connectors are connected PER PROJECT, not globally;
 *   • Gmail / Calendar / Vercel / Slack update on an explicit Sync — the copy
 *     never says "always monitoring". GitHub additionally receives repository
 *     events through its webhook, which is stated as such.
 */
export default function ConnectedSection() {
  const { t } = useLanguageStore();
  const flowRef = useReveal<HTMLDivElement>({ threshold: 0.2 });

  return (
    <section id="connected" className="mkt-deep-band mkt-section" aria-labelledby="connected-title">
      <div className="mkt-wrap">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] lg:items-end lg:gap-16">
          <Reveal>
            <span className="mkt-eyebrow">{t('connEyebrow')}</span>
            <h2 id="connected-title" className="mkt-h2">{t('connTitle')}</h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="mkt-sub">{t('connLead')}</p>
            <div className="mt-5">
              <ArrowLink to="/product#connectors">{t('connCta')}</ArrowLink>
            </div>
          </Reveal>
        </div>

        {/* ── Flow: connectors → project signals ── */}
        <div
          ref={flowRef}
          className="mkt-flow mt-12 grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_44px_minmax(0,0.95fr)] lg:gap-4"
        >
          {/* Connector rows */}
          <ul className="m-0 list-none space-y-2.5 p-0">
            {CONNECTORS.map((c) => (
              <li
                key={c.id}
                className="fl-row relative flex items-start gap-3 rounded-[14px] border border-[color:var(--mkt-deep-border)] bg-[color:var(--mkt-deep-2)] p-3.5"
              >
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border border-white/10 bg-white/[0.05] text-white"
                  aria-hidden="true"
                >
                  <ConnectorMark id={c.id} size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 flex flex-wrap items-center gap-2 text-[13.5px] font-semibold text-[color:var(--mkt-deep-ink)]">
                    {c.name}
                    <span className="mkt-mono rounded border border-white/10 px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.07em] text-[color:var(--mkt-deep-muted)]">
                      {t(c.refresh === 'events' ? 'connRefreshEvents' : 'connRefreshSync')}
                    </span>
                  </p>
                  <p className="m-0 mt-1 text-[12.5px] leading-relaxed text-[color:var(--mkt-deep-body)]">
                    {t(c.bringsKey)}
                  </p>
                  <p className="m-0 mt-1 text-[11.5px] leading-relaxed text-[color:var(--mkt-deep-muted)]">
                    {t(c.boundaryKey)}
                  </p>
                </div>
                <span className="fl-dot hidden lg:block" style={{ left: 'auto', right: '10px' }} aria-hidden="true" />
              </li>
            ))}
          </ul>

          {/* Direction marker */}
          <div className="flex justify-center" aria-hidden="true">
            <ArrowRight className="hidden h-5 w-5 text-[color:var(--mkt-accent)] lg:block" />
            <ArrowDown className="h-5 w-5 text-[color:var(--mkt-accent)] lg:hidden" />
          </div>

          {/* Receiving panel */}
          <div className="mkt-panel">
            <div className="mkt-pchrome">
              <i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" />
              <span className="title">{t('connPanelTitle')}</span>
              <span className="ml-auto"><IllustrativeTag /></span>
            </div>
            <ul className="m-0 list-none space-y-2.5 p-4">
              {(
                [
                  { id: 'github', key: 'connSignal1', d: 1 },
                  { id: 'vercel', key: 'connSignal2', d: 2 },
                  { id: 'slack', key: 'connSignal3', d: 3 },
                  { id: 'calendar', key: 'connSignal4', d: 4 },
                ] as const
              ).map((s) => (
                <li
                  key={s.id}
                  className="fl-in flex items-start gap-2.5 border-b border-[color:var(--mkt-deep-line)] pb-2.5 text-[12.5px] text-[color:var(--mkt-deep-body)] last:border-0 last:pb-0"
                  data-d={String(s.d)}
                >
                  <span className="mt-0.5 shrink-0 text-white/70" aria-hidden="true">
                    <ConnectorMark id={s.id} size={13} />
                  </span>
                  {t(s.key)}
                </li>
              ))}
            </ul>
            <div className="border-t border-[color:var(--mkt-deep-line)] px-4 py-3">
              <p className="m-0 text-[11.5px] leading-relaxed text-[color:var(--mkt-deep-muted)]">
                {t('connPanelFoot')}
              </p>
            </div>
          </div>
        </div>

        <Reveal delay={100}>
          <p className="mt-8 max-w-[78ch] text-[12.5px] leading-relaxed text-[color:var(--mkt-deep-muted)]">
            {t('connHonestyNote')}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
