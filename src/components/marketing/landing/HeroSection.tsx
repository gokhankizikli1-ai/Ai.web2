import { Link } from 'react-router';
import {
  ArrowRight, ArrowUp, Plus, FolderKanban, MessageSquare, Globe, Smartphone,
  Sparkles, Target, Blocks, ChevronDown, Globe as GlobeIcon,
} from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { useAuthStore } from '@/stores/authStore';
import { useReveal } from '@/components/marketing/useReveal';
import { ConnectorMark } from '@/components/marketing/primitives';

/**
 * Landing hero — one product scene.
 *
 * A short type block introduces ONE large Korvix workspace window, and that
 * window is the hero's primary object. It is a faithful rebuild of the real app
 * shell rather than a marketing composition:
 *
 *   • left rail      — New Chat, Projects, the chat list (src/components/Sidebar.tsx)
 *   • conversation   — a question, an answer carrying the app's own collapsed
 *                      "Show sources · N" control (src/components/MessageSources.tsx),
 *                      an inline build result with its real actions (Open
 *                      preview / Save to Project), and the composer with the
 *                      Chat / Website / App picker — including the
 *                      "Recommended" badge Website carries in the product
 *                      (src/components/KorvixModeChips.tsx)
 *   • right pane     — the project surface in its real order: Products &
 *                      Builds, then Project intelligence (summary, Goals,
 *                      Recent connector activity) — src/pages/ProjectOverview.tsx
 *
 * Everything shown maps to something the product does. The content is an
 * example project — stated in one quiet line under the window — and no metric,
 * user count, activity total or capability is invented.
 *
 * Motion: the window settles once, then the newest connector signal lands. That
 * is the whole budget. Under `prefers-reduced-motion` the window renders in its
 * final state with the signal already present.
 */

/** Skeleton line — used only inside the generated-preview thumbnail. */
function Bar({ w, h = 5 }: { w: string; h?: number }) {
  return <span className="mkt-pline block" style={{ width: w, height: h }} />;
}

export default function HeroSection() {
  const { t } = useLanguageStore();
  const { isAuthenticated } = useAuthStore();
  const winRef = useReveal<HTMLDivElement>({ threshold: 0.08 });

  return (
    <section className="mkt-hero" aria-labelledby="hero-title">
      <div className="mkt-wrap">
        {/* ── Type block ── */}
        <div className="mkt-hero-copy">
          <p className="mkt-hero-kicker">{t('heroEyebrow')}</p>
          <h1 id="hero-title" className="mkt-hero-title">{t('heroTitle')}</h1>
          <p className="mkt-hero-standfirst">{t('heroLead')}</p>

          <div className="mkt-hero-actions">
            <Link
              to={isAuthenticated ? '/chat' : '/signup'}
              className="mkt-btn mkt-btn-ink mkt-btn-lg"
            >
              {isAuthenticated ? t('navOpenWorkspace') : t('ctaGetStarted')}
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
            <Link to="/product" className="mkt-btn mkt-btn-outline mkt-btn-lg">
              {t('ctaSeeProduct')}
            </Link>
          </div>

          <p className="mkt-hero-note">{t('heroMicro')}</p>
        </div>

        {/* ── The workspace ── */}
        <div ref={winRef} className="mkt-hero-win">
          <div className="mkt-hw-bar">
            <span className="flex items-center gap-1.5" aria-hidden="true">
              <span
                className="grid h-5 w-5 place-items-center rounded-md text-[10px] font-bold text-white"
                style={{ background: 'var(--mkt-ink)' }}
              >
                K
              </span>
            </span>
            <span className="mkt-hw-crumb">
              <b>{t('heroPanelProject')}</b> · {t('heroWinThread')}
            </span>
            <span className="mkt-hw-avatar" aria-hidden="true">TA</span>
          </div>

          <div className="mkt-hw-body">
            {/* Rail */}
            <div className="mkt-hw-rail">
              <div className="mkt-hw-new">
                <Plus aria-hidden="true" className="h-3.5 w-3.5" /> {t('newChat')}
              </div>

              <p className="mkt-hw-sect">{t('navProjectsItem')}</p>
              <div className="mkt-hw-item" data-active="true">
                <FolderKanban aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t('heroPanelProject')}</span>
              </div>
              <div className="mkt-hw-item">
                <FolderKanban aria-hidden="true" className="h-3.5 w-3.5 shrink-0 opacity-50" />
                <Bar w="62%" h={6} />
              </div>

              <p className="mkt-hw-sect">{t('heroWinChats')}</p>
              <div className="mkt-hw-item">
                <MessageSquare aria-hidden="true" className="h-3.5 w-3.5 shrink-0 opacity-70" />
                <span className="truncate">{t('heroWinThread')}</span>
              </div>
              {['74%', '58%'].map((w) => (
                <div className="mkt-hw-item" key={w}>
                  <MessageSquare aria-hidden="true" className="h-3.5 w-3.5 shrink-0 opacity-40" />
                  <Bar w={w} h={6} />
                </div>
              ))}
            </div>

            {/* Conversation */}
            <div className="mkt-hw-thread">
              <p className="mkt-hw-msg-user">{t('heroPanelAsk')}</p>

              <div className="mkt-hw-msg-ai">
                <p className="m-0">{t('heroPanelReply')}</p>
                {/* Sources exactly as the app attaches them: a collapsed
                    "Show sources · N" control, expanded here so the behaviour
                    is visible. Rows stay unlabelled — a plausible-looking
                    domain would be a fabricated citation. */}
                <div className="mkt-hw-sources" aria-hidden="true">
                  <span className="mkt-src-btn">
                    <GlobeIcon className="h-3 w-3" />
                    {t('sourceShowSources')} · 2
                    <ChevronDown className="h-3 w-3 rotate-180" />
                  </span>
                  <div className="mkt-src-list max-w-[320px]">
                    {['76%', '54%'].map((w) => (
                      <span key={w} className="mkt-src-row">
                        <span className="mkt-src-fav">
                          <GlobeIcon className="h-2.5 w-2.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <Bar w={w} h={6} />
                          <span className="mt-1 block"><Bar w="38%" h={4} /></span>
                        </span>
                        <span className="mkt-src-used">{t('sourceUsed')}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Inline build result — how a build appears in the thread */}
              <div className="mkt-hw-build">
                <div className="mkt-hw-thumb" aria-hidden="true">
                  <Bar w="58%" h={7} />
                  <div className="mt-1.5 space-y-1">
                    <Bar w="88%" h={4} />
                    <Bar w="70%" h={4} />
                  </div>
                  <span
                    className="mt-2 inline-block h-3 w-12 rounded"
                    style={{ background: 'var(--mkt-brand-deep)' }}
                  />
                  <div className="mt-2 grid grid-cols-3 gap-1">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="block h-5 rounded bg-white/[0.06]" />
                    ))}
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="m-0 truncate text-[12.5px] font-semibold text-[color:var(--mkt-deep-ink)]">
                    {t('heroPanelBuild')}
                  </p>
                  <p className="m-0 mt-0.5 text-[11.5px] text-[color:var(--mkt-deep-muted)]">
                    {t('heroPanelBuildSub')}
                  </p>
                  {/* The two actions a finished build actually offers in chat. */}
                  <span className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="mkt-mono inline-flex items-center gap-1.5 rounded-md border border-[color:var(--mkt-deep-border)] bg-white/[0.04] px-2 py-1 text-[10px] text-[color:var(--mkt-deep-ink)]">
                      {t('heroWinOpenPreview')}
                      <ArrowRight aria-hidden="true" className="h-3 w-3" />
                    </span>
                    <span className="mkt-mono inline-flex items-center gap-1.5 rounded-md border border-[color:var(--mkt-deep-border)] px-2 py-1 text-[10px] text-[color:var(--mkt-deep-muted)]">
                      <FolderKanban aria-hidden="true" className="h-3 w-3" />
                      {t('wbSaveToProject')}
                    </span>
                  </span>
                </div>
              </div>

              {/* The conversation continues with that context already in hand —
                  which is the whole point of the headline. */}
              <p className="mkt-hw-msg-user">{t('heroWinAsk2')}</p>
              <p className="mkt-hw-msg-ai m-0">{t('heroWinReply2')}</p>

              {/* Composer */}
              <div className="mkt-hw-composer" aria-hidden="true">
                <p className="m-0 text-[12px] text-[color:var(--mkt-deep-muted)]">
                  {t('heroWinComposer')}
                </p>
                {/* The real composer picker: Chat is the neutral default and
                    Website carries the product's own "Recommended" badge. */}
                <div className="mt-2.5 flex items-center gap-1.5">
                  <span className="mkt-mode" data-active="true">
                    <MessageSquare className="h-3 w-3" /> {t('heroWinModeChat')}
                  </span>
                  <span className="mkt-mode">
                    <Globe className="h-3 w-3" /> {t('heroWinModeWebsite')}
                    <span className="rec">{t('homeRecommended')}</span>
                  </span>
                  <span className="mkt-mode">
                    <Smartphone className="h-3 w-3" /> {t('heroWinModeApp')}
                  </span>
                  <span className="mkt-hw-send">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </span>
                </div>
              </div>
            </div>

            {/* The project surface, in the order the project page shows it:
                Products & Builds, then Project intelligence (summary, goals,
                recent connector activity). */}
            <div className="mkt-hw-intel">
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

              <div className="mkt-pcard mt-3">
                <h3 className="mkt-pcard-h">
                  <Sparkles aria-hidden="true" className="h-3.5 w-3.5 text-[#a5b4fc]" />
                  {t('heroWinIntel')}
                </h3>
                <p>{t('heroCtxSummaryLine')}</p>

                <p className="mkt-mono mb-1.5 mt-3.5 flex items-center gap-1.5 text-[9.5px] uppercase tracking-[0.09em] text-[color:var(--mkt-deep-muted)]">
                  <Target aria-hidden="true" className="h-3 w-3" />
                  {t('heroWinGoals')}
                </p>
                <ul className="m-0 list-none space-y-1.5 p-0">
                  {['heroGoal1', 'heroGoal2'].map((k) => (
                    <li key={k} className="text-[11.5px] leading-snug text-[color:var(--mkt-deep-body)]">
                      • {t(k)}
                    </li>
                  ))}
                </ul>

                <p className="mkt-mono mb-2 mt-3.5 text-[9.5px] uppercase tracking-[0.09em] text-[color:var(--mkt-deep-muted)]">
                  {t('heroWinActivity')}
                </p>
                <ul className="m-0 list-none space-y-2 p-0">
                  <li className="mkt-hw-sig" data-new="true">
                    <span className="mt-0.5 shrink-0 text-white/75">
                      <ConnectorMark id="vercel" size={12} />
                    </span>
                    <span className="min-w-0 flex-1">{t('heroSignalVercel')}</span>
                    <span className="mkt-hw-newdot mt-1.5 shrink-0" aria-hidden="true" />
                  </li>
                  <li className="mkt-hw-sig">
                    <span className="mt-0.5 shrink-0 text-white/75">
                      <ConnectorMark id="github" size={12} />
                    </span>
                    <span className="min-w-0 flex-1">{t('heroSignalGithub')}</span>
                  </li>
                  <li className="mkt-hw-sig">
                    <span className="mt-0.5 shrink-0 text-white/75">
                      <ConnectorMark id="slack" size={12} />
                    </span>
                    <span className="min-w-0 flex-1">{t('heroSignalSlack')}</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <p className="mkt-hero-wincap">{t('heroWinNote')}</p>
      </div>
    </section>
  );
}
