import { Check, Star, Lock, Sparkles, Building2, Crown } from 'lucide-react';
import { useNavigate } from 'react-router';
import MarketingPage from '@/components/marketing/MarketingPage';
import { useCheckout } from '@/hooks/useCheckout';
import { isPurchasablePlan } from '@/lib/billingApi';
import { useBillingPlan } from '@/hooks/useBillingPlan';
import { useLanguageStore } from '@/stores/languageStore';
import {
  PRICING_PLANS, PLANNED_CAPABILITIES, ctaFor, YEARLY_VARIANTS_AVAILABLE, type PricingPlan,
} from '@/lib/pricingPlans';
import { planLabel } from '@/lib/plan';
import { Reveal } from '@/components/marketing/primitives';

/**
 * Pricing page — final plan structure: Starter / Pro / Max / Enterprise (Free is
 * the default account tier, shown as a banner). All display data comes from the
 * single pricing catalog (src/lib/pricingPlans.ts) and the current plan from the
 * authoritative backend snapshot (useBillingPlan → /v2/billing/me), so the cards
 * and the account badges can never disagree. The current plan is never
 * re-purchasable; only higher tiers say "Upgrade".
 *
 * This PR changed PRESENTATION ONLY: the page now renders inside the shared
 * marketing shell (light surface, shared tokens, the rebuilt header/footer)
 * instead of a one-off near-black page. Plan data, checkout behaviour, the
 * current-plan logic, the planned-capabilities list and every honesty
 * constraint ("Pricing at launch", nothing invented) are untouched.
 */
export default function PricingPage() {
  const navigate = useNavigate();
  const checkout = useCheckout();
  const { t } = useLanguageStore();
  // Authoritative current plan (Free while loading is treated as neutral: no card
  // is marked "current", so a paid user is never offered a duplicate checkout —
  // and purchase buttons are disabled until the plan is known).
  const { planKey, loading: planLoading } = useBillingPlan();

  const purchaseDisabled = checkout.enabled && (checkout.pendingSelector !== null || planLoading);

  const onCta = (card: PricingPlan, cta: ReturnType<typeof ctaFor>) => {
    if (cta === 'current' || cta === 'included') return;      // not actionable
    if (cta === 'contact') { navigate('/chat'); return; }     // Enterprise → sales
    // 'upgrade'
    if (checkout.enabled && isPurchasablePlan(card.key)) {
      void checkout.start(card.key, 'monthly', { returnPath: '/pricing' });
    } else {
      navigate('/chat');                                      // flag off → prior behavior
    }
  };

  const ctaLabel = (card: PricingPlan, cta: ReturnType<typeof ctaFor>): string => {
    if (checkout.enabled && cta === 'upgrade' && checkout.pendingSelector?.startsWith(card.key)) {
      return 'Redirecting…';
    }
    switch (cta) {
      case 'current': return 'Current plan';
      case 'included': return 'Included';
      case 'contact': return 'Contact Sales';
      default: return `Upgrade to ${card.label}`;
    }
  };

  const onFree = !planLoading && (planKey === 'free' || planKey === null);

  return (
    <MarketingPage title={t('priceTitle')} description={t('priceMeta')}>
      <section className="mkt-section-tight pt-16" aria-labelledby="pricing-title">
        <div className="mkt-wrap">
          <div className="max-w-[52ch]">
            <span className="mkt-eyebrow">{t('navPricing')}</span>
            <h1 id="pricing-title" className="mkt-h1 mt-4 text-[clamp(30px,4vw,46px)]">
              {t('pricePageTitle')}
            </h1>
            <p className="mkt-lead">{t('pricePageLead')}</p>
          </div>

          {/* Current-plan indicator (authoritative). Never claims a paid plan while
              loading — only shows once the backend snapshot resolves. */}
          {!planLoading && planKey && (
            <div className="mkt-chip mt-6">
              <Check aria-hidden="true" className="h-3.5 w-3.5 text-[color:var(--mkt-brand)]" />
              <span>
                Your current plan:{' '}
                <span className="font-semibold text-[color:var(--mkt-ink)]">{planLabel(planKey)}</span>
              </span>
            </div>
          )}

          {/* Yearly selector is hidden until purchasable yearly variants exist. */}
          {YEARLY_VARIANTS_AVAILABLE && <div className="mt-6" aria-hidden="true" />}

          {onFree && (
            <p className="mt-4 text-[13px] text-[color:var(--mkt-muted)]">
              You’re on the <span className="font-medium text-[color:var(--mkt-ink)]">Free</span> plan —
              upgrade any time below.
            </p>
          )}
        </div>
      </section>

      <section className="mkt-section-tight pt-0" aria-label={t('pricePlansLabel')}>
        <div className="mkt-wrap">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {PRICING_PLANS.map((card, i) => {
              const cta = ctaFor(planKey, card);
              const isCurrent = cta === 'current';
              const Icon = card.key === 'enterprise' ? Building2 : Crown;
              return (
                <Reveal key={card.key} delay={i * 60}>
                  <div
                    className={`mkt-card relative flex h-full flex-col p-6 ${
                      card.popular ? 'border-[color:var(--mkt-brand)]' : ''
                    }`}
                    style={card.popular ? { boxShadow: 'var(--mkt-sh-md)' } : undefined}
                  >
                    {card.popular && !isCurrent && (
                      <span
                        className="absolute -top-3 left-6 rounded-full px-2.5 py-1 text-[10.5px] font-semibold text-white"
                        style={{ background: 'var(--mkt-brand)' }}
                      >
                        <Star aria-hidden="true" className="mr-1 inline h-2.5 w-2.5" />
                        Most popular
                      </span>
                    )}
                    {isCurrent && (
                      <span className="absolute -top-3 left-6 rounded-full border border-[color:var(--mkt-border)] bg-[color:var(--mkt-surface)] px-2.5 py-1 text-[10.5px] font-semibold text-[color:var(--mkt-ink)]">
                        <Check aria-hidden="true" className="mr-1 inline h-2.5 w-2.5" />
                        Current plan
                      </span>
                    )}

                    <div className="mb-4">
                      <div className="mb-2 flex items-center gap-2">
                        <Icon aria-hidden="true" className="h-4.5 w-4.5 text-[color:var(--mkt-brand)]" />
                        <h2 className="m-0 text-[17px] font-semibold text-[color:var(--mkt-ink)]">
                          {card.label}
                        </h2>
                      </div>
                      {/* Final prices/credits are not locked yet — never show an
                          invented price. Enterprise is Custom; the rest are TBD. */}
                      <p className="m-0 text-[15px] font-medium text-[color:var(--mkt-body)]">
                        {card.key === 'enterprise' ? t('priceCustom') : t('priceAtLaunch')}
                      </p>
                      <p className="m-0 mt-1.5 text-[12.5px] text-[color:var(--mkt-muted)]">
                        {card.description}
                      </p>
                    </div>

                    <ul className="m-0 mb-6 flex-1 list-none space-y-2.5 p-0">
                      {card.features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-[13px] text-[color:var(--mkt-body)]">
                          <Check aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[color:var(--mkt-brand)]" />
                          {f}
                        </li>
                      ))}
                    </ul>

                    {/* Plain marketing buttons: the shared UI Button's `outline`
                        variant is the app's dark-surface glass style, which read
                        at 2.1:1 on this light page. Behaviour (disabled states,
                        handler) is identical. */}
                    <button
                      type="button"
                      disabled={isCurrent || cta === 'included' || (cta === 'upgrade' && purchaseDisabled)}
                      className={`mkt-btn w-full ${card.popular ? 'mkt-btn-primary' : 'mkt-btn-outline'} disabled:cursor-default disabled:opacity-60`}
                      onClick={() => onCta(card, cta)}
                    >
                      {ctaLabel(card, cta)}
                    </button>
                  </div>
                </Reveal>
              );
            })}
          </div>

          {/* Checkout error — bounded, provider-neutral; never grants access. */}
          {checkout.enabled && checkout.error && (
            <div className="mx-auto mt-8 max-w-md rounded-xl border border-[#d9b3b3] bg-[#fdf5f5] p-3 text-center">
              <p className="m-0 text-[12.5px] text-[#8a4a4a]">{checkout.error}</p>
            </div>
          )}
        </div>
      </section>

      {/* Coming later — capabilities that are planned but NOT yet implemented +
          backend-enforced. Kept OUTSIDE the purchasable cards so no plan claims
          a feature it doesn't grant. */}
      <section className="mkt-band mkt-section-tight" aria-labelledby="planned-title">
        <div className="mkt-wrap">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-14">
            <div>
              <h2 id="planned-title" className="mkt-h3 flex items-center gap-2 text-[19px]">
                <Sparkles aria-hidden="true" className="h-4 w-4 text-[color:var(--mkt-brand)]" />
                Coming to paid plans
              </h2>
              <p className="mt-2 max-w-[46ch] text-[13.5px] leading-relaxed text-[color:var(--mkt-muted)]">
                These capabilities are on the way. They aren’t part of any plan’s included features
                yet — we’ll announce which tier each lands in when pricing is finalized.
              </p>
            </div>
            <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
              {PLANNED_CAPABILITIES.map((c) => (
                <li key={c} className="flex items-start gap-2 text-[13px] text-[color:var(--mkt-body)]">
                  <span
                    className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: 'var(--mkt-border-strong)' }}
                    aria-hidden="true"
                  />
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="mkt-section-tight" aria-label={t('priceNotesLabel')}>
        <div className="mkt-wrap">
          <p className="m-0 max-w-[70ch] text-[13px] leading-relaxed text-[color:var(--mkt-muted)]">
            Free tier is available during early access. Final prices and credit allocations aren’t
            locked yet — they’ll be confirmed before general availability.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-6 text-[12px] text-[color:var(--mkt-faint)]">
            <span className="flex items-center gap-1.5">
              <Lock aria-hidden="true" className="h-3.5 w-3.5" /> Cancel anytime
            </span>
            <span className="flex items-center gap-1.5">
              <Sparkles aria-hidden="true" className="h-3.5 w-3.5" /> No credit card required for free
            </span>
          </div>
        </div>
      </section>
    </MarketingPage>
  );
}
