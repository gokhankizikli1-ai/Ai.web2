import { Globe, CornerDownRight } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { Reveal, IllustrativeTag, ArrowLink } from '@/components/marketing/primitives';

/**
 * Research + project reasoning.
 *
 * What is true today: research happens inside normal chat — when a question
 * calls for it, Korvix searches the web and answers with the sources it used
 * (see backend/services/research and the message source list in the app). When
 * that chat belongs to a project, the project keeps the thread, so a later
 * conversation or build starts from what was already established.
 *
 * What this section deliberately does NOT claim: that Korvix "knows
 * everything", remembers across accounts, or continuously monitors anything.
 * The panel is an illustrative composition — the source rows are unlabelled on
 * purpose, because inventing plausible-looking domains would be a fabricated
 * citation.
 */
export default function ResearchSection() {
  const { t } = useLanguageStore();

  return (
    <section id="research" className="mkt-band mkt-section" aria-labelledby="research-title">
      <div className="mkt-wrap">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16">
          <Reveal>
            <span className="mkt-eyebrow">{t('resEyebrow')}</span>
            <h2 id="research-title" className="mkt-h2">{t('resTitle')}</h2>
            <p className="mkt-sub">{t('resLead')}</p>

            <ul className="m-0 mt-7 list-none space-y-4 p-0">
              {['resPoint1', 'resPoint2', 'resPoint3'].map((k, i) => (
                <li key={k} className="flex gap-3.5">
                  <span
                    className="mkt-mono grid h-6 w-6 shrink-0 place-items-center rounded-md text-[11px] font-semibold"
                    style={{ background: 'var(--mkt-brand-wash)', color: 'var(--mkt-brand)' }}
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <p className="m-0 max-w-[52ch] text-[14px] leading-relaxed text-[color:var(--mkt-body)]">
                    {t(k)}
                  </p>
                </li>
              ))}
            </ul>

            <div className="mt-7">
              <ArrowLink to="/product#research">{t('resCta')}</ArrowLink>
            </div>
          </Reveal>

          <Reveal delay={90}>
            <div className="mkt-panel">
              <div className="mkt-pchrome">
                <i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" />
                <span className="title">{t('resPanelTitle')}</span>
                <span className="ml-auto"><IllustrativeTag /></span>
              </div>

              <div className="space-y-3.5 p-4">
                <p
                  className="m-0 ml-auto max-w-[88%] rounded-xl rounded-br-sm px-3 py-2.5 text-[12.5px] leading-relaxed text-white"
                  style={{ background: 'linear-gradient(180deg,#4f46e5,#4338ca)' }}
                >
                  {t('resPanelQuestion')}
                </p>

                <div className="rounded-xl border border-[color:var(--mkt-deep-border)] bg-[color:var(--mkt-deep-2)] p-3">
                  <p className="m-0 text-[12.5px] leading-relaxed text-[color:var(--mkt-deep-body)]">
                    {t('resPanelAnswer')}
                  </p>
                  <div className="mt-3 border-t border-[color:var(--mkt-deep-line)] pt-2.5">
                    <p className="mkt-mono m-0 mb-2 uppercase tracking-[0.08em] text-[color:var(--mkt-deep-muted)]">
                      {t('resPanelSources')}
                    </p>
                    <ul className="m-0 list-none space-y-1.5 p-0" aria-hidden="true">
                      {[74, 58, 66].map((w, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <Globe className="h-3 w-3 shrink-0 text-[color:var(--mkt-deep-muted)]" />
                          <span className="mkt-pline" style={{ width: `${w}%` }} />
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="flex items-start gap-2.5 rounded-xl border border-[rgba(34,211,238,0.28)] bg-[rgba(34,211,238,0.06)] p-3">
                  <CornerDownRight
                    aria-hidden="true"
                    className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--mkt-accent)]"
                  />
                  <p className="m-0 text-[12px] leading-relaxed text-[color:var(--mkt-deep-body)]">
                    {t('resPanelCarry')}
                  </p>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
