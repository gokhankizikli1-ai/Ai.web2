import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { useAuthStore } from '@/stores/authStore';
import { Reveal } from '@/components/marketing/primitives';

/**
 * The end-to-end story, in five plain steps: start a project, research the
 * idea, build a surface, connect the tools around it, and keep working with
 * that context in place.
 *
 * Written for a non-technical visitor — no internal vocabulary, no pipeline
 * names — and every step maps to something a real account can do today.
 */

const STEPS = [
  { titleKey: 'flowStep1Title', bodyKey: 'flowStep1Body' },
  { titleKey: 'flowStep2Title', bodyKey: 'flowStep2Body' },
  { titleKey: 'flowStep3Title', bodyKey: 'flowStep3Body' },
  { titleKey: 'flowStep4Title', bodyKey: 'flowStep4Body' },
  { titleKey: 'flowStep5Title', bodyKey: 'flowStep5Body' },
];

export default function WorkflowSection() {
  const { t } = useLanguageStore();
  const { isAuthenticated } = useAuthStore();

  return (
    <section id="workflow" className="mkt-deep-band mkt-section" aria-labelledby="workflow-title">
      <div className="mkt-wrap">
        <Reveal>
          <div className="max-w-[58ch]">
            <span className="mkt-eyebrow">{t('flowEyebrow')}</span>
            <h2 id="workflow-title" className="mkt-h2">{t('flowTitle')}</h2>
            <p className="mkt-sub">{t('flowLead')}</p>
          </div>
        </Reveal>

        <ol className="relative m-0 mt-12 grid list-none gap-5 p-0 md:grid-cols-2 xl:grid-cols-5 xl:gap-4">
          {/* The rail behind the steps — one hairline, desktop only. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-0 right-0 top-[26px] hidden h-px xl:block"
            style={{
              background:
                'linear-gradient(90deg, transparent, rgba(34,211,238,0.35) 12%, rgba(79,70,229,0.35) 88%, transparent)',
            }}
          />
          {STEPS.map((s, i) => (
            <li key={s.titleKey} className="relative">
              <Reveal delay={i * 70}>
                <span
                  className="mkt-mono relative grid h-[52px] w-[52px] place-items-center rounded-[15px] border text-[13px] font-semibold"
                  style={{
                    background: 'var(--mkt-deep-2)',
                    borderColor: 'var(--mkt-deep-border)',
                    color: 'var(--mkt-accent)',
                  }}
                  aria-hidden="true"
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="mkt-h3 mt-4 text-[16.5px] text-[color:var(--mkt-deep-ink)]">
                  {t(s.titleKey)}
                </h3>
                <p className="mt-2 max-w-[34ch] text-[13.5px] leading-relaxed text-[color:var(--mkt-deep-muted)]">
                  {t(s.bodyKey)}
                </p>
              </Reveal>
            </li>
          ))}
        </ol>

        <Reveal delay={120}>
          <div className="mt-12 flex flex-wrap items-center gap-4">
            <Link
              to={isAuthenticated ? '/chat' : '/signup'}
              className="mkt-btn mkt-btn-primary"
            >
              {isAuthenticated ? t('navOpenWorkspace') : t('ctaGetStarted')}
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Link>
            <Link to="/tutorials" className="mkt-btn mkt-btn-deep-outline">
              {t('flowTutorialsCta')}
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
