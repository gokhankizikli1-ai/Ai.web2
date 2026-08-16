import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { PRICING_PLANS } from '@/lib/pricingPlans';
import { Reveal } from '@/components/marketing/primitives';

/**
 * Pricing teaser — a SUMMARY, never a second pricing authority.
 *
 * Plan names and descriptions come from the one display catalog
 * (`@/lib/pricingPlans`), which is also what /pricing renders. No price is
 * shown here for the same reason it isn't shown there: final prices and credit
 * allocations are not locked, and inventing one would be a fabricated claim.
 * Everything actionable links to the real pricing surface.
 */
export default function PricingTeaserSection() {
  const { t } = useLanguageStore();

  return (
    <section id="pricing" className="mkt-band mkt-section-tight" aria-labelledby="pricing-title">
      <div className="mkt-wrap">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:items-center lg:gap-16">
          <Reveal>
            <span className="mkt-eyebrow">{t('priceEyebrow')}</span>
            <h2 id="pricing-title" className="mkt-h2">{t('priceTitle')}</h2>
            <p className="mkt-sub">{t('priceLead')}</p>
            <div className="mt-6">
              <Link to="/pricing" className="mkt-btn mkt-btn-outline">
                {t('priceCta')}
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
          </Reveal>

          <Reveal delay={80}>
            <div className="mkt-card divide-y divide-[color:var(--mkt-border)] overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="m-0 text-[14px] font-semibold text-[color:var(--mkt-ink)]">
                    {t('priceFreeTitle')}
                  </p>
                  <p className="m-0 mt-0.5 text-[12.5px] text-[color:var(--mkt-muted)]">
                    {t('priceFreeBody')}
                  </p>
                </div>
                <span className="mkt-chip">{t('priceFreeTag')}</span>
              </div>

              {PRICING_PLANS.map((plan) => (
                /* Only the plan NAME is mirrored here — the per-plan feature
                   copy lives on /pricing (one authority), and repeating its
                   English description would mix languages on a localized page. */
                <div key={plan.key} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <p className="m-0 text-[14px] font-semibold text-[color:var(--mkt-ink)]">
                    {plan.label}
                  </p>
                  <span className="text-[12.5px] text-[color:var(--mkt-faint)]">
                    {plan.key === 'enterprise' ? t('priceCustom') : t('priceAtLaunch')}
                  </span>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
