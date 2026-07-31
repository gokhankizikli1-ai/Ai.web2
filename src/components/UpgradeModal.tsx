import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, Crown, Building2, Check, ArrowRight, Star, Shield } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useCheckout } from '@/hooks/useCheckout';
import { isPurchasablePlan } from '@/lib/billingApi';
import { useBillingPlan } from '@/hooks/useBillingPlan';
import { PRICING_PLANS, PLANNED_CAPABILITIES, ctaFor, type PricingPlan } from '@/lib/pricingPlans';

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Upgrade modal — same rules and single source of truth as the pricing page
 * (src/lib/pricingPlans.ts + useBillingPlan). Starter / Pro / Max / Enterprise;
 * NO invented prices (final prices/credits not locked); cards list only the
 * verified capability (unimplemented ones live in "Coming to paid plans"); no
 * yearly selector (no yearly variants); no money-back text. Current plan shows
 * "Current plan" (disabled, not re-purchasable); higher tiers "Upgrade"; lower
 * tiers "Included"; Enterprise "Contact Sales". Loading never claims a paid plan.
 */
export default function UpgradeModal({ open, onClose }: UpgradeModalProps) {
  const navigate = useNavigate();
  const checkout = useCheckout();
  const { planKey, loading: planLoading } = useBillingPlan();

  const purchaseDisabled = checkout.enabled && (checkout.pendingSelector !== null || planLoading);

  const onCta = (card: PricingPlan, cta: ReturnType<typeof ctaFor>) => {
    if (cta === 'current' || cta === 'included') return;
    if (cta === 'contact') { onClose(); navigate('/pricing'); return; }
    if (checkout.enabled && isPurchasablePlan(card.key)) {
      void checkout.start(card.key, 'monthly', { returnPath: '/pricing' });
    } else {
      onClose();
      navigate('/pricing');
    }
  };

  const ctaLabel = (card: PricingPlan, cta: ReturnType<typeof ctaFor>) => {
    if (checkout.enabled && cta === 'upgrade' && checkout.pendingSelector?.startsWith(card.key)) return 'Redirecting…';
    switch (cta) {
      case 'current': return 'Current plan';
      case 'included': return 'Included';
      case 'contact': return 'Contact Sales';
      default: return 'Upgrade';
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] flex items-start justify-center pt-[5vh] bg-[#0a0f1a]/80 backdrop-blur-md"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-5xl mx-4 max-h-[90vh] overflow-y-auto scrollbar-thin rounded-2xl border border-white/[0.08] bg-[#171C24] shadow-2xl shadow-[#0a0f1a]/50"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="relative px-8 pt-8 pb-6 border-b border-white/[0.04]">
              <button
                onClick={onClose}
                className="absolute top-4 right-4 h-8 w-8 flex items-center justify-center rounded-lg text-[#94A3B8] hover:text-white hover:bg-white/[0.04] transition-all"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="flex items-center gap-2 mb-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#3B82F6]/10 border border-[#3B82F6]/15">
                  <Sparkles className="h-4 w-4 text-[#3B82F6]" />
                </div>
                <span className="text-[11px] font-semibold text-[#3B82F6]/70 uppercase tracking-wider">Upgrade</span>
              </div>
              <h2 className="text-2xl font-semibold text-white mb-1 tracking-tight">Unlock the full power of KorvixAI</h2>
              <p className="text-[13px] text-[#94A3B8]">Choose the plan that fits your ambition. Upgrade anytime.</p>

              {!planLoading && planKey && (
                <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-1.5">
                  <Check className="h-3.5 w-3.5 text-[#6F8F7A]" />
                  <span className="text-[12px] text-[#CBD5E1]">
                    Your current plan: <span className="font-medium text-white">{planLabelFor(planKey)}</span>
                  </span>
                </div>
              )}
            </div>

            {/* Plans — Starter / Pro / Max / Enterprise */}
            <div className="p-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {PRICING_PLANS.map((card, i) => {
                const cta = ctaFor(planKey, card);
                const isCurrent = cta === 'current';
                const Icon = card.key === 'enterprise' ? Building2 : Crown;
                return (
                  <motion.div
                    key={card.key}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.07, duration: 0.35 }}
                    className={`relative rounded-xl border ${
                      card.popular ? 'border-[#3B82F6]/20' : 'border-white/[0.06]'
                    } bg-gradient-to-b from-[#3B82F6]/10 to-[#60A5FA]/5 p-5 flex flex-col ${
                      isCurrent ? 'ring-1 ring-[#6F8F7A]/25' : card.popular ? 'ring-1 ring-[#3B82F6]/10' : ''
                    }`}
                  >
                    {card.popular && !isCurrent && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <div className="flex items-center gap-1 rounded-full bg-[#3B82F6]/15 border border-[#3B82F6]/20 px-2.5 py-0.5 text-[10px] font-semibold text-[#3B82F6]">
                          <Star className="h-2.5 w-2.5" /> Most Popular
                        </div>
                      </div>
                    )}
                    {isCurrent && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <div className="flex items-center gap-1 rounded-full bg-[#6F8F7A]/15 border border-[#6F8F7A]/25 px-2.5 py-0.5 text-[10px] font-semibold text-[#8FB39C]">
                          <Check className="h-2.5 w-2.5" /> Current plan
                        </div>
                      </div>
                    )}

                    <div className="mb-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#3B82F6]/10 border border-[#3B82F6]/15">
                          <Icon className="h-3.5 w-3.5 text-[#3B82F6]" />
                        </div>
                        <h3 className="text-[15px] font-semibold text-white">{card.label}</h3>
                      </div>
                      {/* Final prices not locked — never show an invented price. */}
                      {card.key === 'enterprise' ? (
                        <span className="text-2xl font-bold text-white">Custom</span>
                      ) : (
                        <span className="text-[13px] font-medium text-[#CBD5E1]">Pricing at launch</span>
                      )}
                      <p className="text-[11px] text-[#94A3B8] mt-1.5">{card.description}</p>
                    </div>

                    <ul className="space-y-2 mb-5 flex-1">
                      {card.features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-[11px] text-[#CBD5E1]">
                          <Check className="h-3 w-3 shrink-0 mt-0.5 text-[#3B82F6]/60" />
                          {f}
                        </li>
                      ))}
                    </ul>

                    <motion.button
                      whileHover={{ scale: isCurrent || cta === 'included' ? 1 : 1.02 }}
                      whileTap={{ scale: isCurrent || cta === 'included' ? 1 : 0.98 }}
                      disabled={isCurrent || cta === 'included' || (cta === 'upgrade' && purchaseDisabled)}
                      onClick={() => onCta(card, cta)}
                      className={`w-full h-9 rounded-lg text-[12px] font-medium transition-all flex items-center justify-center gap-1.5 ${
                        isCurrent
                          ? 'bg-[#6F8F7A]/[0.08] text-[#8FB39C] border border-[#6F8F7A]/20 cursor-default'
                          : card.popular
                            ? 'bg-white/[0.08] text-white hover:bg-white/[0.12] border border-white/[0.08]'
                            : 'bg-white/[0.02] text-slate-300 hover:bg-white/[0.04] border border-white/[0.05] hover:border-white/[0.08]'
                      }`}
                    >
                      {ctaLabel(card, cta)}
                      {cta === 'upgrade' && !checkout.pendingSelector?.startsWith(card.key) && <ArrowRight className="h-3 w-3" />}
                      {cta === 'contact' && <Shield className="h-3 w-3" />}
                    </motion.button>
                  </motion.div>
                );
              })}
            </div>

            {/* Checkout error — bounded, provider-neutral. */}
            {checkout.enabled && checkout.error && (
              <div className="px-8 pb-2">
                <p className="text-[11px] text-[#C98A8A]">{checkout.error}</p>
              </div>
            )}

            {/* Coming later — planned capabilities kept OUTSIDE the purchasable cards. */}
            <div className="px-8 pb-6">
              <p className="text-[11px] text-[#94A3B8] mb-2">Coming to paid plans (not included yet):</p>
              <div className="flex flex-wrap gap-1.5">
                {PLANNED_CAPABILITIES.slice(0, 8).map((c) => (
                  <span key={c} className="text-[10px] text-[#94A3B8] rounded-full border border-white/[0.06] bg-white/[0.02] px-2 py-0.5">
                    {c}
                  </span>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="px-8 py-4 border-t border-white/[0.03] flex items-center gap-1.5 text-[11px] text-[#94A3B8]">
              <Shield className="h-3 w-3" />
              Secure payment. Cancel anytime.
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Local label helper so the modal shows the same labels as the badges/cards. */
function planLabelFor(key: string): string {
  const found = PRICING_PLANS.find((p) => p.key === key);
  if (found) return found.label;
  return key === 'free' ? 'Free' : key.charAt(0).toUpperCase() + key.slice(1);
}
