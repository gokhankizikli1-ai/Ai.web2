import { Link } from 'react-router';
import { ArrowRight, Globe } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { useAuthStore } from '@/stores/authStore';
import { useReveal } from '@/components/marketing/useReveal';
import { ConnectorMark } from '@/components/marketing/primitives';

/**
 * Landing hero.
 *
 * Composition (deliberately NOT "headline left / floating card right"):
 *
 *   TYPE ZONE   an oversized headline on an 8/3 asymmetric grid, with a quiet
 *               contents index hanging in the right margin. No eyebrow pill, no
 *               icon row, no background glow, no glass. The single piece of
 *               brand colour is a marker underline beneath the phrase the whole
 *               page argues against.
 *   WORKBENCH   a light shelf band holding three dark fragments on a staggered
 *               baseline, running off the right edge of the page (the section
 *               clips them). Each fragment is a window onto ONE real Korvix
 *               surface rather than a composite dashboard.
 *
 * The three fragments and what they are derived from:
 *   1. Chat with cited sources — the chat surface + `MessageSources`.
 *   2. Project context — the bounded project snapshot the app reads from
 *      /v2/projects/{id}/brain and renders on the project page: a summary,
 *      current goals, and recent connector signals.
 *   3. Web Build preview — the generated-site preview frame.
 *
 * They tell one continuous story about one project (a launch blocked by a
 * failed deployment), which is why the reply, the goals, the signal and the
 * preview all refer to the same work. Everything is an illustrative example —
 * labelled as such under the scene — and nothing invents a metric, a user
 * count, an activity feed or a capability the product does not have.
 *
 * Motion: fragments rise once, then one connector signal travels the short wire
 * into project context. It plays a single time on scroll-in and then rests;
 * under `prefers-reduced-motion` the scene renders in its final state and the
 * travelling dot is removed.
 */

/** Split a headline around the phrase that carries the marker underline. */
function MarkedTitle({ title, accent }: { title: string; accent: string }) {
  const at = accent ? title.indexOf(accent) : -1;
  if (at < 0) return <>{title}</>;
  return (
    <>
      {title.slice(0, at)}
      <span className="mkt-hero-mark">{accent}</span>
      {title.slice(at + accent.length)}
    </>
  );
}

/** Skeleton line used inside the preview fragment. */
function Bar({ w, h = 7 }: { w: string; h?: number }) {
  return <span className="mkt-pline" style={{ width: w, height: h }} />;
}

export default function HeroSection() {
  const { t } = useLanguageStore();
  const { isAuthenticated } = useAuthStore();
  const sceneRef = useReveal<HTMLDivElement>({ threshold: 0.12 });

  const INDEX = [
    { key: 'navChatItem', to: '/product#chat' },
    { key: 'navResearchItem', to: '/product#research' },
    { key: 'heroPillBuild', to: '/product#web-build' },
    { key: 'navProjectsItem', to: '/product#projects' },
  ];

  return (
    <section className="mkt-hero" aria-labelledby="hero-title">
      {/* ── Type zone ── */}
      <div className="mkt-hero-type">
        <div className="mkt-wrap">
          <div className="mkt-hero-grid">
            <div>
              <p className="mkt-hero-kicker">{t('heroEyebrow')}</p>

              <h1 id="hero-title" className="mkt-hero-title">
                <MarkedTitle title={t('heroTitle')} accent={t('heroTitleAccent')} />
              </h1>

              <p className="mkt-hero-standfirst">{t('heroLead')}</p>

              <div className="mkt-hero-actions">
                <Link
                  to={isAuthenticated ? '/chat' : '/signup'}
                  className="mkt-btn mkt-btn-ink mkt-btn-lg"
                >
                  {isAuthenticated ? t('navOpenWorkspace') : t('ctaGetStarted')}
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
                <Link to="/#how-it-works" className="mkt-textlink">
                  {t('ctaSeeHow')}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </div>

              <p className="mkt-hero-note">{t('heroMicro')}</p>
            </div>

            {/* Margin index — an editorial contents list, not a feature row. */}
            <div>
              <span className="mkt-hero-indexlabel">{t('heroIndexLabel')}</span>
              <ul className="mkt-hero-index">
                {INDEX.map((item, i) => (
                  <li key={item.key}>
                    <span className="n" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                    <Link
                      to={item.to}
                      className="text-[color:var(--mkt-body)] no-underline transition-colors hover:text-[color:var(--mkt-ink)]"
                    >
                      {t(item.key)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* ── Workbench shelf ── */}
      <div className="mkt-hero-shelf">
        <div className="mkt-wrap">
          <div ref={sceneRef} className="mkt-hero-scene">
            {/* 1 — Chat, answered with its sources */}
            <div className="mkt-hero-frag hs-el" data-d="1">
              <div className="mkt-hero-fraghead">{t('heroSceneChat')}</div>
              <div className="mkt-hero-fragbody space-y-2.5">
                <p
                  className="m-0 ml-auto max-w-[92%] rounded-[11px] rounded-br-[4px] border-l-2 px-3 py-2 text-[12.5px] leading-relaxed text-[color:var(--mkt-deep-ink)]"
                  style={{ background: 'var(--mkt-deep-3)', borderColor: 'var(--mkt-brand-soft)' }}
                >
                  {t('heroPanelAsk')}
                </p>
                <p className="m-0 max-w-[96%] text-[12.5px] leading-relaxed text-[color:var(--mkt-deep-body)]">
                  {t('heroPanelReply')}
                </p>
                <div className="border-t border-[color:var(--mkt-deep-line)] pt-2.5">
                  <p className="mkt-mono m-0 mb-2 uppercase tracking-[0.07em] text-[color:var(--mkt-deep-muted)]">
                    {t('resPanelSources')}
                  </p>
                  <ul className="m-0 list-none space-y-1.5 p-0" aria-hidden="true">
                    {[78, 62].map((w) => (
                      <li key={w} className="flex items-center gap-2">
                        <Globe className="h-3 w-3 shrink-0 text-[color:var(--mkt-deep-muted)]" />
                        <Bar w={`${w}%`} h={6} />
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* 2 — What the project keeps */}
            <div className="mkt-hero-frag hs-el" data-d="2" data-offset="1">
              <div className="mkt-hero-fraghead">{t('heroPanelProject')}</div>
              <div className="mkt-hero-fragbody">
                <p className="mkt-mono m-0 uppercase tracking-[0.07em] text-[color:var(--mkt-deep-muted)]">
                  {t('heroCtxSummary')}
                </p>
                <p className="m-0 mt-1.5 text-[12.5px] leading-relaxed text-[color:var(--mkt-deep-body)]">
                  {t('heroCtxSummaryLine')}
                </p>

                <p className="mkt-mono m-0 mt-4 uppercase tracking-[0.07em] text-[color:var(--mkt-deep-muted)]">
                  {t('heroCtxGoals')}
                </p>
                <ul className="m-0 mt-1.5 list-none space-y-1.5 p-0">
                  {['heroGoal1', 'heroGoal2'].map((k) => (
                    <li
                      key={k}
                      className="flex items-start gap-2 text-[12.5px] text-[color:var(--mkt-deep-body)]"
                    >
                      <span
                        className="mt-[7px] h-1 w-1 shrink-0 rounded-full"
                        style={{ background: 'var(--mkt-brand-soft)' }}
                        aria-hidden="true"
                      />
                      {t(k)}
                    </li>
                  ))}
                </ul>

                <p className="mkt-mono m-0 mt-4 uppercase tracking-[0.07em] text-[color:var(--mkt-deep-muted)]">
                  {t('heroPanelSignals')}
                </p>
                {/* The wire the travelling signal arrives on. */}
                <div className="mkt-hero-wire mt-2.5" aria-hidden="true">
                  <i />
                </div>
                <ul className="m-0 mt-2.5 list-none space-y-2 p-0">
                  {(
                    [
                      { id: 'vercel', key: 'heroSignalVercel', d: '5' },
                      { id: 'github', key: 'heroSignalGithub', d: '6' },
                    ] as const
                  ).map((s) => (
                    <li
                      key={s.id}
                      className="hs-el flex items-center gap-2.5 text-[12px] text-[color:var(--mkt-deep-body)]"
                      data-d={s.d}
                    >
                      <span className="shrink-0 text-white/75">
                        <ConnectorMark id={s.id} size={13} />
                      </span>
                      {t(s.key)}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* 3 — The generated preview the conversation is about */}
            <div className="mkt-hero-frag hs-el" data-d="3" data-offset="2">
              <div className="mkt-hero-fraghead">{t('buildWebFrameUrl')}</div>
              <div className="mkt-hero-fragbody" aria-hidden="true">
                <div className="rounded-[10px] bg-[color:var(--mkt-deep-2)] p-3.5">
                  <Bar w="52%" h={10} />
                  <div className="mt-2 space-y-1.5">
                    <Bar w="80%" />
                    <Bar w="64%" />
                  </div>
                  <span
                    className="mt-3 inline-block h-5 w-20 rounded-md"
                    style={{ background: 'var(--mkt-brand-deep)' }}
                  />
                </div>
                <div className="mt-2.5 grid grid-cols-3 gap-2">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="rounded-[10px] border border-[color:var(--mkt-deep-border)] bg-[color:var(--mkt-deep-2)] p-2.5"
                    >
                      <span className="mb-2 block h-5 w-5 rounded-md bg-white/[0.07]" />
                      <Bar w="84%" h={6} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t border-[color:var(--mkt-deep-line)] px-3.5 py-2.5">
                <p className="m-0 text-[12px] font-semibold text-[color:var(--mkt-deep-ink)]">
                  {t('heroPanelBuild')}
                </p>
                <p className="m-0 mt-0.5 text-[11.5px] text-[color:var(--mkt-deep-muted)]">
                  {t('heroPanelBuildSub')}
                </p>
              </div>
            </div>
          </div>

          <p className="mkt-hero-scenenote">{t('heroSceneNote')}</p>
        </div>
      </div>
    </section>
  );
}
