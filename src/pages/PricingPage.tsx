import { motion } from 'framer-motion';
import Navbar from '@/sections/Navbar';
import Footer from '@/sections/Footer';
import { Button } from '@/components/ui/button';
import { Crown, Check, Star, Lock, Sparkles, Building2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useCheckout } from '@/hooks/useCheckout';
import { isPurchasablePlan } from '@/lib/billingApi';
import { useBillingPlan } from '@/hooks/useBillingPlan';
import { PRICING_PLANS, ctaFor, YEARLY_VARIANTS_AVAILABLE, type PricingPlan } from '@/lib/pricingPlans';
import { planLabel } from '@/lib/plan';

/**
 * Pricing page — final plan structure: Starter / Pro / Max / Enterprise (Free is
 * the default account tier, shown as a banner). All display data comes from the
 * single pricing catalog (src/lib/pricingPlans.ts) and the current plan from the
 * authoritative backend snapshot (useBillingPlan → /v2/billing/me), so the cards
 * and the account badges can never disagree. The current plan is never
 * re-purchasable; only higher tiers say "Upgrade".
 */
export default function PricingPage() {
  const navigate = useNavigate();
  const checkout = useCheckout();
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
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <Navbar />

      <div className="pt-28 pb-20 px-4 max-w-6xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-10"
        >
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#52677A]/10 border border-[#52677A]/15">
              <Crown className="h-4 w-4 text-[#7890A3]" />
            </div>
            <span className="text-[11px] font-semibold text-[#7890A3]/70 uppercase tracking-wider">Pricing</span>
          </div>
          <h1 className="text-4xl font-semibold mb-3 tracking-tight">Choose your plan</h1>
          <p className="text-[14px] text-slate-500 max-w-md mx-auto">
            Start free, upgrade when you need more power. No credit card required.
          </p>

          {/* Current-plan indicator (authoritative). Never claims a paid plan while
              loading — only shows once the backend snapshot resolves. */}
          {!planLoading && planKey && (
            <div className="mt-5 inline-flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5">
              <Check className="h-3.5 w-3.5 text-[#6F8F7A]" />
              <span className="text-[12px] text-slate-300">
                Your current plan: <span className="font-medium text-white">{planLabel(planKey)}</span>
              </span>
            </div>
          )}

          {/* Yearly selector is hidden until purchasable yearly variants exist. */}
          {YEARLY_VARIANTS_AVAILABLE && (
            <div className="mt-6 flex items-center justify-center gap-3" aria-hidden="true" />
          )}
        </motion.div>

        {onFree && (
          <p className="text-center text-[12px] text-slate-600 mb-6">
            You’re on the <span className="text-slate-400 font-medium">Free</span> plan — upgrade any time below.
          </p>
        )}

        {/* Plans Grid — Starter / Pro / Max / Enterprise */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
          {PRICING_PLANS.map((card, i) => {
            const cta = ctaFor(planKey, card);
            const isCurrent = cta === 'current';
            const Icon = card.key === 'enterprise' ? Building2 : Crown;
            return (
              <motion.div
                key={card.key}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08, duration: 0.4 }}
                className={`relative rounded-2xl border ${
                  card.popular ? 'border-[#52677A]/15 bg-[#52677A]/[0.02]' : 'border-white/[0.04] bg-white/[0.005]'
                } ${isCurrent ? 'ring-1 ring-[#6F8F7A]/20' : ''} p-6 flex flex-col hover:border-white/[0.06] transition-all`}
              >
                {card.popular && !isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <div className="flex items-center gap-1 rounded-full bg-[#52677A]/15 border border-[#52677A]/20 px-3 py-0.5 text-[10px] font-semibold text-[#7890A3]">
                      <Star className="h-2.5 w-2.5" /> Most Popular
                    </div>
                  </div>
                )}
                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <div className="flex items-center gap-1 rounded-full bg-[#6F8F7A]/15 border border-[#6F8F7A]/25 px-3 py-0.5 text-[10px] font-semibold text-[#8FB39C]">
                      <Check className="h-2.5 w-2.5" /> Current plan
                    </div>
                  </div>
                )}

                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Icon className="h-5 w-5 text-[#7890A3]/70" />
                    <h3 className="text-[18px] font-semibold">{card.label}</h3>
                  </div>
                  <div className="flex items-baseline gap-1 mb-1">
                    {card.priceMonthly === null ? (
                      <span className="text-3xl font-bold">Custom</span>
                    ) : (
                      <>
                        <span className="text-3xl font-bold">${card.priceMonthly}</span>
                        <span className="text-[13px] text-slate-600">/mo</span>
                      </>
                    )}
                  </div>
                  <p className="text-[12px] text-slate-600">{card.description}</p>
                </div>

                <ul className="space-y-2.5 mb-6 flex-1">
                  {card.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[12px] text-slate-400">
                      <Check className="h-3.5 w-3.5 shrink-0 text-[#6F8F7A]/60 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>

                <Button
                  variant={card.popular ? 'default' : 'outline'}
                  disabled={isCurrent || cta === 'included' || (cta === 'upgrade' && purchaseDisabled)}
                  className={`w-full h-10 text-[13px] font-medium rounded-xl ${
                    isCurrent
                      ? 'bg-[#6F8F7A]/[0.08] text-[#8FB39C] border border-[#6F8F7A]/20 cursor-default'
                      : card.popular
                        ? 'bg-white/[0.08] hover:bg-white/[0.12] text-white border border-white/[0.08]'
                        : 'border-white/[0.06] text-slate-400 hover:text-white hover:bg-white/[0.03]'
                  }`}
                  onClick={() => onCta(card, cta)}
                >
                  {ctaLabel(card, cta)}
                </Button>
              </motion.div>
            );
          })}
        </div>

        {/* Checkout error — bounded, provider-neutral; never grants access. */}
        {checkout.enabled && checkout.error && (
          <div className="mb-8 -mt-8 mx-auto max-w-md p-3 rounded-xl border border-[#B45B5B]/20 bg-[#B45B5B]/[0.04] text-center">
            <p className="text-[12px] text-[#C98A8A]">{checkout.error}</p>
          </div>
        )}

        {/* Payments note */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mt-2 p-4 rounded-xl border border-[#A68A5B]/10 bg-[#A68A5B]/[0.02] text-center"
        >
          <p className="text-[12px] text-slate-500">
            Free tier is available during early access. Prices shown are indicative and may change before general availability.
          </p>
        </motion.div>

        {/* Trust */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-[11px] text-[#64748B]">
          <span className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> Cancel anytime</span>
          <span className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> No credit card required for free</span>
        </div>
      </div>

      <Footer />
    </div>
  );
}
