import { Link } from 'react-router';
import {
  MessageSquare, FolderKanban, Search, Globe2, Smartphone, Plug, Brain, Check, ArrowRight,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import MarketingPage from '@/components/marketing/MarketingPage';
import { useLanguageStore } from '@/stores/languageStore';
import { useAuthStore } from '@/stores/authStore';
import { Reveal, ConnectorMark } from '@/components/marketing/primitives';
import { CONNECTORS } from '@/lib/marketingNav';

/**
 * Product overview — the destination behind every Product mega-menu entry.
 *
 * One page, seven anchored capability sections (`/product#chat`,
 * `/product#web-build`, …). Sections alternate side so the page reads as an
 * editorial sequence rather than a stack of identical blocks, and each one
 * states its real boundary alongside what it does. `/features` redirects here,
 * so older links keep working.
 */

interface Capability {
  id: string;
  icon: LucideIcon;
  titleKey: string;
  leadKey: string;
  pointKeys: string[];
  noteKey?: string;
  /** Only the connectors section renders the provider list. */
  showConnectors?: boolean;
}

const CAPABILITIES: Capability[] = [
  {
    id: 'chat',
    icon: MessageSquare,
    titleKey: 'navChatItem',
    leadKey: 'prodChatLead',
    pointKeys: ['prodChatP1', 'prodChatP2', 'prodChatP3'],
  },
  {
    id: 'projects',
    icon: FolderKanban,
    titleKey: 'navProjectsItem',
    leadKey: 'prodProjectsLead',
    pointKeys: ['prodProjectsP1', 'prodProjectsP2', 'prodProjectsP3'],
    noteKey: 'prodProjectsNote',
  },
  {
    id: 'web-build',
    icon: Globe2,
    titleKey: 'navWebBuildItem',
    leadKey: 'prodWebLead',
    pointKeys: ['prodWebP1', 'prodWebP2', 'prodWebP3'],
    noteKey: 'prodWebNote',
  },
  {
    id: 'app-build',
    icon: Smartphone,
    titleKey: 'navAppBuildItem',
    leadKey: 'prodAppLead',
    pointKeys: ['prodAppP1', 'prodAppP2', 'prodAppP3'],
    noteKey: 'prodAppNote',
  },
  {
    id: 'research',
    icon: Search,
    titleKey: 'navResearchItem',
    leadKey: 'prodResearchLead',
    pointKeys: ['prodResearchP1', 'prodResearchP2', 'prodResearchP3'],
    noteKey: 'prodResearchNote',
  },
  {
    id: 'connectors',
    icon: Plug,
    titleKey: 'navConnectorsItem',
    leadKey: 'prodConnLead',
    pointKeys: ['prodConnP1', 'prodConnP2', 'prodConnP3'],
    noteKey: 'prodConnNote',
    showConnectors: true,
  },
  {
    id: 'project-intelligence',
    icon: Brain,
    titleKey: 'navIntelligenceItem',
    leadKey: 'prodIntelLead',
    pointKeys: ['prodIntelP1', 'prodIntelP2', 'prodIntelP3'],
    noteKey: 'prodIntelNote',
  },
];

function CapabilitySection({ cap, index }: { cap: Capability; index: number }) {
  const { t } = useLanguageStore();
  const flip = index % 2 === 1;

  return (
    <section
      id={cap.id}
      className={`mkt-section ${index % 2 === 1 ? 'mkt-band' : ''}`}
      aria-labelledby={`${cap.id}-h`}
    >
      <div className="mkt-wrap">
        <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-16">
          <Reveal className={flip ? 'lg:order-2' : ''}>
            <span
              className="grid h-11 w-11 place-items-center rounded-[13px]"
              style={{ background: 'var(--mkt-brand-wash)', color: 'var(--mkt-brand)' }}
              aria-hidden="true"
            >
              <cap.icon className="h-5 w-5" />
            </span>
            <h2 id={`${cap.id}-h`} className="mkt-h2 mt-5 text-[clamp(24px,2.6vw,32px)]">
              {t(cap.titleKey)}
            </h2>
            <p className="mkt-sub">{t(cap.leadKey)}</p>
          </Reveal>

          <Reveal delay={70} className={flip ? 'lg:order-1' : ''}>
            <ul className="m-0 list-none space-y-3.5 p-0">
              {cap.pointKeys.map((k) => (
                <li key={k} className="flex items-start gap-3">
                  <Check aria-hidden="true" className="mt-0.5 h-[18px] w-[18px] shrink-0 text-[color:var(--mkt-brand)]" />
                  <span className="text-[14.5px] leading-relaxed text-[color:var(--mkt-body)]">{t(k)}</span>
                </li>
              ))}
            </ul>

            {cap.showConnectors && (
              <ul className="m-0 mt-6 grid list-none gap-2 p-0 sm:grid-cols-2">
                {CONNECTORS.map((c) => (
                  <li
                    key={c.id}
                    className="mkt-card flex items-center gap-2.5 px-3 py-2.5 text-[13px] text-[color:var(--mkt-body)]"
                  >
                    <ConnectorMark id={c.id} size={16} />
                    <span className="font-medium">{c.name}</span>
                    <span className="ml-auto text-[11px] text-[color:var(--mkt-faint)]">
                      {t(c.refresh === 'events' ? 'connRefreshEvents' : 'connRefreshSync')}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {cap.noteKey && (
              <p className="mt-5 max-w-[60ch] rounded-[12px] border border-[color:var(--mkt-border)] bg-[color:var(--mkt-surface)] px-4 py-3 text-[13px] leading-relaxed text-[color:var(--mkt-muted)]">
                {t(cap.noteKey)}
              </p>
            )}
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export default function ProductPage() {
  const { t } = useLanguageStore();
  const { isAuthenticated } = useAuthStore();

  return (
    <MarketingPage title={t('prodTitle')} description={t('prodMeta')}>
      <section className="mkt-section-tight pt-16" aria-labelledby="product-title">
        <div className="mkt-wrap">
          <span className="mkt-eyebrow">{t('navProduct')}</span>
          <h1 id="product-title" className="mkt-h1 mt-4 max-w-[18ch]">{t('prodTitle')}</h1>
          <p className="mkt-lead">{t('prodLead')}</p>

          <nav aria-label={t('mktOnThisPage')} className="mt-8">
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {CAPABILITIES.map((cap) => (
                <li key={cap.id}>
                  <Link
                    to={`/product#${cap.id}`}
                    className="mkt-chip transition-colors hover:border-[color:var(--mkt-border-strong)] hover:text-[color:var(--mkt-ink)]"
                  >
                    {t(cap.titleKey)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </section>

      {CAPABILITIES.map((cap, i) => (
        <CapabilitySection key={cap.id} cap={cap} index={i} />
      ))}

      <section className="mkt-deep-band py-16" aria-labelledby="product-cta">
        <div className="mkt-wrap">
          <h2 id="product-cta" className="mkt-h2 mt-0 max-w-[24ch]">{t('prodCtaTitle')}</h2>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              to={isAuthenticated ? '/chat' : '/signup'}
              className="mkt-btn mkt-btn-light mkt-btn-lg"
            >
              {isAuthenticated ? t('navOpenWorkspace') : t('ctaGetStarted')}
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
            <Link to="/docs" className="mkt-btn mkt-btn-deep-outline mkt-btn-lg">
              {t('navDocs')}
            </Link>
          </div>
        </div>
      </section>
    </MarketingPage>
  );
}
