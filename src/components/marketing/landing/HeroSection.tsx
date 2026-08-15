import { Link } from 'react-router';
import { ArrowRight, MessageSquare, FolderKanban, Blocks, Search } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { useAuthStore } from '@/stores/authStore';
import { useReveal } from '@/components/marketing/useReveal';
import { ConnectorMark, IllustrativeTag } from '@/components/marketing/primitives';

/**
 * Landing hero — the page's first job is answering "what is this?".
 *
 * Left column: the proposition, in concrete language, with one primary action
 * and one low-commitment action. Right column: the first of the page's three
 * motion moments — a composed Korvix product panel where a project's context
 * comes together (a project, a conversation, a build, and signals from the
 * tools connected to it), rather than a floating fake dashboard.
 *
 * Everything the panel shows maps to a capability that exists: projects hold
 * chats and generated products, chat answers with cited research, Web/App Build
 * produce a real first version, and read-only connectors turn provider activity
 * into project signals. It is explicitly labelled illustrative, and it invents
 * no metric, no customer, and no integration.
 */
export default function HeroSection() {
  const { t } = useLanguageStore();
  const { isAuthenticated } = useAuthStore();
  const stageRef = useReveal<HTMLDivElement>({ threshold: 0.15 });

  return (
    <section className="relative overflow-hidden pb-4 pt-14 sm:pt-20" aria-labelledby="hero-title">
      {/* One restrained brand wash — not a neon blob; it only lifts the top of
          the porcelain surface so the dark product panel has something to sit on. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[560px]"
        style={{
          background:
            'radial-gradient(900px 420px at 18% -10%, rgba(79,70,229,0.10), transparent 62%), radial-gradient(700px 380px at 88% 4%, rgba(34,211,238,0.07), transparent 60%)',
        }}
      />

      <div className="mkt-wrap relative">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.06fr)] lg:gap-16">
          {/* ── Proposition ── */}
          <div>
            <span className="mkt-eyebrow">{t('heroEyebrow')}</span>
            <h1 id="hero-title" className="mkt-h1 mt-4 max-w-[15ch]">
              {t('heroTitle')}
            </h1>
            <p className="mkt-lead">{t('heroLead')}</p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to={isAuthenticated ? '/chat' : '/signup'}
                className="mkt-btn mkt-btn-primary mkt-btn-lg"
              >
                {isAuthenticated ? t('navOpenWorkspace') : t('ctaGetStarted')}
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
              <Link to="/#how-it-works" className="mkt-btn mkt-btn-outline mkt-btn-lg">
                {t('ctaSeeHow')}
              </Link>
            </div>

            <p className="mt-5 text-[12.5px] text-[color:var(--mkt-faint)]">{t('heroMicro')}</p>

            {/* Four capability words — the shape of the product in one line. */}
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-3 p-0 text-[13px] font-medium text-[color:var(--mkt-muted)]">
              {[
                { icon: MessageSquare, key: 'navChatItem' },
                { icon: Search, key: 'navResearchItem' },
                { icon: Blocks, key: 'heroPillBuild' },
                { icon: FolderKanban, key: 'navProjectsItem' },
              ].map(({ icon: Icon, key }) => (
                <li key={key} className="flex items-center gap-2">
                  <Icon aria-hidden="true" className="h-4 w-4 text-[color:var(--mkt-brand)]" />
                  {t(key)}
                </li>
              ))}
            </ul>
          </div>

          {/* ── Composed product panel (motion moment 1) ── */}
          <div ref={stageRef} className="mkt-hero-stage">
            <div className="mkt-panel hv-el" data-d="1">
              <div className="mkt-pchrome">
                <i aria-hidden="true" /><i aria-hidden="true" /><i aria-hidden="true" />
                <span className="title">{t('heroPanelProject')}</span>
                <span className="ml-auto"><IllustrativeTag /></span>
              </div>

              <div className="grid gap-0 sm:grid-cols-[150px_minmax(0,1fr)]">
                {/* Project rail */}
                <div className="hidden border-r border-[color:var(--mkt-deep-line)] p-3.5 sm:block">
                  <p className="mkt-mono mb-2.5 uppercase tracking-[0.08em] text-[color:var(--mkt-deep-muted)]">
                    {t('heroPanelRail')}
                  </p>
                  <ul className="m-0 list-none space-y-1.5 p-0 text-[12px] text-[color:var(--mkt-deep-body)]">
                    {['heroRailChats', 'heroRailBuilds', 'heroRailResearch', 'heroRailContext'].map(
                      (k, i) => (
                        <li
                          key={k}
                          className="hv-el flex items-center gap-2 rounded-md px-1.5 py-1.5"
                          data-d={String(i + 2)}
                          style={i === 3 ? { background: 'rgba(79,70,229,0.16)' } : undefined}
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full"
                            style={{ background: i === 3 ? 'var(--mkt-accent)' : '#3d4a68' }}
                            aria-hidden="true"
                          />
                          {t(k)}
                        </li>
                      ),
                    )}
                  </ul>
                </div>

                {/* Conversation + build */}
                <div className="space-y-3 p-3.5">
                  <div
                    className="hv-el ml-auto max-w-[86%] rounded-xl rounded-br-sm px-3 py-2.5 text-[12.5px] leading-relaxed text-white"
                    data-d="3"
                    style={{ background: 'linear-gradient(180deg,#4f46e5,#4338ca)' }}
                  >
                    {t('heroPanelAsk')}
                  </div>

                  <div className="hv-el space-y-2 rounded-xl border border-[color:var(--mkt-deep-border)] bg-[color:var(--mkt-deep-2)] p-3" data-d="4">
                    <p className="m-0 text-[12.5px] leading-relaxed text-[color:var(--mkt-deep-body)]">
                      {t('heroPanelReply')}
                    </p>
                    <div className="flex gap-1.5" aria-hidden="true">
                      <span className="mkt-pline" style={{ width: '62%' }} />
                    </div>
                  </div>

                  <div className="hv-el mkt-ptile flex items-center gap-3" data-d="5">
                    <span
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg"
                      style={{ background: 'rgba(79,70,229,0.18)' }}
                      aria-hidden="true"
                    >
                      <Blocks className="h-4 w-4 text-[#a5b4fc]" />
                    </span>
                    <div className="min-w-0">
                      <p className="m-0 truncate text-[12.5px] font-semibold text-[color:var(--mkt-deep-ink)]">
                        {t('heroPanelBuild')}
                      </p>
                      <p className="m-0 mt-0.5 text-[11.5px] text-[color:var(--mkt-deep-muted)]">
                        {t('heroPanelBuildSub')}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Context strip — connected signals arriving into the project */}
              <div className="border-t border-[color:var(--mkt-deep-line)] bg-[rgba(255,255,255,0.02)] px-3.5 py-3">
                <p className="mkt-mono mb-2 uppercase tracking-[0.08em] text-[color:var(--mkt-deep-muted)]">
                  {t('heroPanelSignals')}
                </p>
                <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                  {(
                    [
                      { id: 'github', key: 'heroSignalGithub', d: 6 },
                      { id: 'vercel', key: 'heroSignalVercel', d: 7 },
                      { id: 'slack', key: 'heroSignalSlack', d: 8 },
                    ] as const
                  ).map((s) => (
                    <li
                      key={s.id}
                      className="hv-el hv-signal flex items-center gap-2 rounded-lg border border-[color:var(--mkt-deep-border)] bg-[color:var(--mkt-deep-2)] px-2.5 py-1.5 text-[11.5px] text-[color:var(--mkt-deep-body)]"
                      data-d={String(s.d)}
                    >
                      <span className="text-white/80"><ConnectorMark id={s.id} size={13} /></span>
                      {t(s.key)}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
