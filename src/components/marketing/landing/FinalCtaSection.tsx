import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { useAuthStore } from '@/stores/authStore';
import { Reveal } from '@/components/marketing/primitives';

/**
 * Closing CTA. Deliberately quiet: a deep band, a hairline grid, one primary
 * action and one secondary. No giant gradient blob, no repeated hero, no
 * invented urgency.
 */
export default function FinalCtaSection() {
  const { t } = useLanguageStore();
  const { isAuthenticated } = useAuthStore();

  return (
    <section className="mkt-deep-band relative overflow-hidden py-20" aria-labelledby="final-title">
      {/* A single hairline grid — depth without decoration noise. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(70% 70% at 50% 40%, #000 30%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(70% 70% at 50% 40%, #000 30%, transparent 100%)',
        }}
      />
      <div className="mkt-wrap relative">
        <Reveal>
          <div className="max-w-[52ch]">
            <h2 id="final-title" className="mkt-h2 mt-0">{t('finalTitle')}</h2>
            <p className="mkt-sub">{t('finalLead')}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to={isAuthenticated ? '/chat' : '/signup'}
                className="mkt-btn mkt-btn-light mkt-btn-lg"
              >
                {isAuthenticated ? t('navOpenWorkspace') : t('ctaGetStarted')}
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
              <Link to="/docs" className="mkt-btn mkt-btn-deep-outline mkt-btn-lg">
                {t('finalDocsCta')}
              </Link>
            </div>
            <p className="mt-5 text-[12.5px] text-[color:var(--mkt-deep-muted)]">{t('heroMicro')}</p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
