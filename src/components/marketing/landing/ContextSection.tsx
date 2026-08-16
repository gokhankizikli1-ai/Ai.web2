import {
  MessageSquare, Search, Blocks, Plug, ArrowDown, Plus, Sparkles, Target,
} from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import {
  ConnectorMark, IllustrativeTag, Reveal, SectionHeading,
} from '@/components/marketing/primitives';

/**
 * "One project, shared context" — why Korvix is more than a folder of separate
 * AI tools.
 *
 * The composition is deliberately NOT a card grid: four inputs feed one
 * project, and the project keeps a short, bounded set of things.
 *
 * What it keeps is not described in a bullet list — it is SHOWN as the project
 * page shows it (src/pages/ProjectOverview.tsx): the Chats card with its "New
 * chat" action, the Products & Builds card with its Web/App tag, and the
 * Project intelligence card with its summary, Goals and Recent connector
 * activity. Same example project as the hero, so the page tells one continuous
 * story, and no "memory" claim is made that the product does not support.
 */

const INPUTS = [
  { icon: MessageSquare, titleKey: 'ctxInput1Title', bodyKey: 'ctxInput1Body' },
  { icon: Search, titleKey: 'ctxInput2Title', bodyKey: 'ctxInput2Body' },
  { icon: Blocks, titleKey: 'ctxInput3Title', bodyKey: 'ctxInput3Body' },
  { icon: Plug, titleKey: 'ctxInput4Title', bodyKey: 'ctxInput4Body' },
];

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
              {/* What a project keeps, shown as the project page itself shows
                  it: the Chats, Products & Builds and Project intelligence
                  cards of src/pages/ProjectOverview.tsx — same example project
                  as the hero, so the site tells one continuous story. */}
              <div className="bg-[color:var(--mkt-section)] p-6">
                <div className="flex items-center justify-between gap-3">
                  <p className="mkt-mono m-0 uppercase tracking-[0.09em] text-[color:var(--mkt-faint)]">
                    {t('ctxKeepsLabel')}
                  </p>
                </div>

                <div className="mkt-panel mt-3.5 space-y-2.5 p-3">
                  <div className="mkt-pcard">
                    <div className="mkt-pcard-h">
                      <MessageSquare aria-hidden="true" className="h-3.5 w-3.5 text-[#7dd3fc]" />
                      {t('heroWinChats')}
                      <span className="mkt-pcard-act ml-auto">
                        <Plus aria-hidden="true" className="h-3 w-3" />
                        {t('newChat')}
                      </span>
                    </div>
                    <div className="mkt-prow mt-1.5">
                      <MessageSquare aria-hidden="true" className="h-3.5 w-3.5 shrink-0 opacity-45" />
                      <span className="min-w-0 flex-1 truncate">{t('heroWinThread')}</span>
                    </div>
                    <div className="mkt-prow">
                      <MessageSquare aria-hidden="true" className="h-3.5 w-3.5 shrink-0 opacity-30" />
                      <span className="mkt-pline" style={{ width: '54%' }} aria-hidden="true" />
                    </div>
                  </div>

                  <div className="mkt-pcard">
                    <div className="mkt-pcard-h">
                      <Blocks aria-hidden="true" className="h-3.5 w-3.5 text-[#7dd3fc]" />
                      {t('heroWinProducts')}
                    </div>
                    <div className="mkt-prow mt-1.5">
                      <span className="mkt-ptag">{t('heroWinProductTag')}</span>
                      <span className="min-w-0 flex-1 truncate">{t('heroPanelBuild')}</span>
                    </div>
                  </div>

                  <div className="mkt-pcard">
                    <div className="mkt-pcard-h">
                      <Sparkles aria-hidden="true" className="h-3.5 w-3.5 text-[#a5b4fc]" />
                      {t('heroWinIntel')}
                    </div>
                    <p className="m-0 mt-2 text-[11.5px] leading-relaxed text-[color:var(--mkt-deep-muted)]">
                      {t('heroCtxSummaryLine')}
                    </p>
                    <p className="mkt-mono mb-1.5 mt-3 flex items-center gap-1.5 text-[9.5px] uppercase tracking-[0.09em] text-[color:var(--mkt-deep-muted)]">
                      <Target aria-hidden="true" className="h-3 w-3" />
                      {t('heroWinGoals')}
                    </p>
                    <p className="m-0 text-[11.5px] leading-snug text-[color:var(--mkt-deep-body)]">
                      • {t('heroGoal1')}
                    </p>
                    <p className="mkt-mono mb-1.5 mt-3 text-[9.5px] uppercase tracking-[0.09em] text-[color:var(--mkt-deep-muted)]">
                      {t('heroWinActivity')}
                    </p>
                    <p className="m-0 flex items-center gap-2 text-[11.5px] text-[color:var(--mkt-deep-body)]">
                      <span className="shrink-0 text-white/70">
                        <ConnectorMark id="vercel" size={12} />
                      </span>
                      {t('heroSignalVercel')}
                    </p>
                  </div>
                </div>

                <p className="m-0 mt-3">
                  <IllustrativeTag tone="light" />
                </p>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
