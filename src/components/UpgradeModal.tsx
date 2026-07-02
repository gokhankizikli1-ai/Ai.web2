import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Sparkles, Zap, Crown, Building2, Check,
  ArrowRight, Star, Shield,
} from 'lucide-react';
import { useState } from 'react';

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
}

const PLANS = [
  {
    id: 'pro',
    name: 'Pro',
    price: { monthly: 20, yearly: 16 },
    description: 'For professionals who need more power',
    icon: Zap,
    color: 'cyan',
    gradient: 'from-[#7EA6BF]/10 to-[#9CBBD1]/5',
    border: 'border-[#7EA6BF]/20',
    features: [
      'Unlimited messages',
      '2x faster responses',
      'Deep Research access',
      'Advanced Trading signals',
      'File uploads & analysis',
      'Custom instructions',
      'Priority support',
    ],
    popular: true,
  },
  {
    id: 'ultra',
    name: 'Ultra',
    price: { monthly: 49, yearly: 39 },
    description: 'For power users and teams',
    icon: Crown,
    color: 'amber',
    gradient: 'from-[#7EA6BF]/10 to-[#9CBBD1]/5',
    border: 'border-[#7EA6BF]/20',
    features: [
      'Everything in Pro',
      'All AI agents unlocked',
      'Real-time trading data',
      'Startup Scanner Pro',
      'Team collaboration',
      'Advanced analytics',
      'Dedicated support',
    ],
    popular: false,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: { monthly: 0, yearly: 0 },
    description: 'For organizations at scale',
    icon: Building2,
    color: 'violet',
    gradient: 'from-[#7EA6BF]/10 to-[#9CBBD1]/5',
    border: 'border-[#7EA6BF]/20',
    features: [
      'Everything in Ultra',
      'SSO & SAML',
      'Audit logs & compliance',
      'Custom AI training',
      'API access',
      'Dedicated infrastructure',
      'SLA guarantee',
    ],
    popular: false,
  },
];

export default function UpgradeModal({ open, onClose }: UpgradeModalProps) {
  const [yearly, setYearly] = useState(false);

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
            className="w-full max-w-4xl mx-4 max-h-[90vh] overflow-y-auto scrollbar-thin rounded-2xl border border-white/[0.08] bg-[#171C24] shadow-2xl shadow-[#0a0f1a]/50"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="relative px-8 pt-8 pb-6 border-b border-white/[0.04]">
              <button
                onClick={onClose}
                className="absolute top-4 right-4 h-8 w-8 flex items-center justify-center rounded-lg text-[#7F8FA3] hover:text-white hover:bg-white/[0.04] transition-all"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="flex items-center gap-2 mb-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#7EA6BF]/10 border border-[#7EA6BF]/15">
                  <Sparkles className="h-4 w-4 text-[#7EA6BF]" />
                </div>
                <span className="text-[11px] font-semibold text-[#7EA6BF]/70 uppercase tracking-wider">Upgrade</span>
              </div>
              <h2 className="text-2xl font-semibold text-white mb-1 tracking-tight">Unlock the full power of KorvixAI</h2>
              <p className="text-[13px] text-[#7F8FA3]">Choose the plan that fits your ambition. Upgrade anytime.</p>

              {/* Monthly / Yearly toggle */}
              <div className="flex items-center gap-3 mt-5">
                <div className="flex items-center rounded-lg bg-white/[0.03] border border-white/[0.05] p-0.5">
                  <button
                    onClick={() => setYearly(false)}
                    className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${!yearly ? 'bg-white/[0.06] text-white' : 'text-[#7F8FA3] hover:text-[#A9B7C6]'}`}
                  >
                    Monthly
                  </button>
                  <button
                    onClick={() => setYearly(true)}
                    className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${yearly ? 'bg-white/[0.06] text-white' : 'text-[#7F8FA3] hover:text-[#A9B7C6]'}`}
                  >
                    Yearly
                  </button>
                </div>
                {yearly && (
                  <motion.span
                    initial={{ opacity: 0, x: -5 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="text-[11px] text-[#86A88B]/70 font-medium flex items-center gap-1"
                  >
                    <Star className="h-3 w-3" />
                    Save 20%
                  </motion.span>
                )}
              </div>
            </div>

            {/* Plans */}
            <div className="p-8 grid md:grid-cols-3 gap-4">
              {PLANS.map((plan, i) => (
                <motion.div
                  key={plan.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08, duration: 0.35 }}
                  className={`relative rounded-xl border ${plan.border} bg-gradient-to-b ${plan.gradient} p-5 flex flex-col ${
                    plan.popular ? 'ring-1 ring-[#7EA6BF]/10' : ''
                  }`}
                >
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <div className="flex items-center gap-1 rounded-full bg-[#7EA6BF]/15 border border-[#7EA6BF]/20 px-2.5 py-0.5 text-[10px] font-semibold text-[#7EA6BF]">
                        <Star className="h-2.5 w-2.5" />
                        Most Popular
                      </div>
                    </div>
                  )}

                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#7EA6BF]/10 border border-[#7EA6BF]/15">
                        <plan.icon className="h-3.5 w-3.5 text-[#7EA6BF]" />
                      </div>
                      <h3 className="text-[15px] font-semibold text-white">{plan.name}</h3>
                    </div>
                    <div className="flex items-baseline gap-1">
                      {plan.price.monthly > 0 ? (
                        <>
                          <span className="text-2xl font-bold text-white">${yearly ? plan.price.yearly : plan.price.monthly}</span>
                          <span className="text-[11px] text-[#7F8FA3]">/month</span>
                        </>
                      ) : (
                        <span className="text-2xl font-bold text-white">Custom</span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#7F8FA3] mt-1.5">{plan.description}</p>
                  </div>

                  <ul className="space-y-2 mb-5 flex-1">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-[11px] text-[#A9B7C6]">
                        <Check className="h-3 w-3 shrink-0 mt-0.5 text-[#7EA6BF]/60" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className={`w-full h-9 rounded-lg text-[12px] font-medium transition-all flex items-center justify-center gap-1.5 ${
                      plan.popular
                        ? 'bg-white/[0.08] text-white hover:bg-white/[0.12] border border-white/[0.08]'
                        : 'bg-white/[0.02] text-slate-300 hover:bg-white/[0.04] border border-white/[0.05] hover:border-white/[0.08]'
                    }`}
                  >
                    {plan.price.monthly === 0 ? (
                      <>Contact Sales <Shield className="h-3 w-3" /></>
                    ) : (
                      <>Upgrade <ArrowRight className="h-3 w-3" /></>
                    )}
                  </motion.button>
                </motion.div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-8 py-4 border-t border-white/[0.03] flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[11px] text-[#7F8FA3]">
                <Shield className="h-3 w-3" />
                Secure payment. Cancel anytime.
              </div>
              <span className="text-[10px] text-[#A9B7C6]">30-day money-back guarantee</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
