import { useState } from 'react';
import { motion } from 'framer-motion';
import Navbar from '@/sections/Navbar';
import Footer from '@/sections/Footer';
import { Button } from '@/components/ui/button';
import {
  Zap, Crown, Building2, Check, Star, Shield,
  Lock, Sparkles, X,
} from 'lucide-react';
import { useNavigate } from 'react-router';

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: { monthly: 0, yearly: 0 },
    description: 'Get started with KorvixAI',
    icon: Zap,
    color: 'slate',
    features: [
      '50 messages/month',
      'Fast AI mode',
      'Basic chat history',
      'Community support',
    ],
    unavailable: [
      'Deep Research',
      'Trading Signals',
      'AI Agents',
      'File Uploads',
      'Custom Instructions',
    ],
    cta: 'Get Started Free',
    popular: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: { monthly: 20, yearly: 16 },
    description: 'For professionals who need more',
    icon: Crown,
    color: 'cyan',
    features: [
      'Unlimited messages',
      '2x faster responses',
      'Deep Research access',
      'Advanced Trading signals',
      'File uploads & analysis',
      'Custom instructions',
      'Priority support',
    ],
    unavailable: [],
    cta: 'Upgrade to Pro',
    popular: true,
  },
  {
    id: 'ultra',
    name: 'Ultra',
    price: { monthly: 49, yearly: 39 },
    description: 'For power users and teams',
    icon: Star,
    color: 'amber',
    features: [
      'Everything in Pro',
      'All AI agents unlocked',
      'Real-time trading data',
      'Startup Scanner Pro',
      'Team collaboration',
      'Advanced analytics',
      'Dedicated support',
    ],
    unavailable: [],
    cta: 'Upgrade to Ultra',
    popular: false,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: { monthly: 0, yearly: 0 },
    description: 'For organizations at scale',
    icon: Building2,
    color: 'violet',
    features: [
      'Everything in Ultra',
      'SSO & SAML',
      'Audit logs & compliance',
      'Custom AI training',
      'API access',
      'Dedicated infrastructure',
      'SLA guarantee',
    ],
    unavailable: [],
    cta: 'Contact Sales',
    popular: false,
  },
];

const FEATURES_COMPARE = [
  { name: 'Messages per month',     free: '50',         pro: 'Unlimited', ultra: 'Unlimited',  enterprise: 'Unlimited' },
  { name: 'AI Models',               free: 'Fast only', pro: 'All modes', ultra: 'All modes',  enterprise: 'All + Custom' },
  { name: 'Deep Research',           free: false,       pro: true,        ultra: true,         enterprise: true },
  { name: 'Trading Signals',         free: 'Basic',     pro: 'Advanced',  ultra: 'Real-time',  enterprise: 'Real-time' },
  { name: 'AI Agents',               free: false,       pro: '3 agents',  ultra: 'All 8',      enterprise: 'Unlimited' },
  { name: 'File Uploads',            free: false,       pro: '50 MB',     ultra: '500 MB',     enterprise: 'Unlimited' },
  { name: 'Custom Instructions',     free: false,       pro: true,        ultra: true,         enterprise: true },
  { name: 'Team Members',            free: '1',         pro: '1',         ultra: '5',          enterprise: 'Unlimited' },
  { name: 'API Access',              free: false,       pro: false,       ultra: false,        enterprise: true },
  { name: 'Support',                 free: 'Community', pro: 'Priority',  ultra: 'Dedicated',  enterprise: 'SLA' },
];

export default function PricingPage() {
  const navigate = useNavigate();
  const [yearly, setYearly] = useState(false);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <Navbar />

      <div className="pt-28 pb-20 px-4 max-w-6xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-14"
        >
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10 border border-cyan-500/15">
              <Crown className="h-4 w-4 text-cyan-400" />
            </div>
            <span className="text-[11px] font-semibold text-cyan-400/70 uppercase tracking-wider">Pricing</span>
          </div>
          <h1 className="text-4xl font-semibold mb-3 tracking-tight">Choose your plan</h1>
          <p className="text-[14px] text-slate-500 max-w-md mx-auto mb-6">
            Start free, upgrade when you need more power. No credit card required.
          </p>
          <div className="flex items-center justify-center gap-3">
            <div className="flex items-center rounded-lg bg-white/[0.02] border border-white/[0.04] p-0.5">
              <button onClick={() => setYearly(false)}
                className={`px-4 py-2 rounded-md text-[13px] font-medium transition-all ${!yearly ? 'bg-white/[0.06] text-white' : 'text-slate-600 hover:text-slate-400'}`}
              >Monthly</button>
              <button onClick={() => setYearly(true)}
                className={`px-4 py-2 rounded-md text-[13px] font-medium transition-all ${yearly ? 'bg-white/[0.06] text-white' : 'text-slate-600 hover:text-slate-400'}`}
              >Yearly</button>
            </div>
            {yearly && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-[13px] text-emerald-400/70 font-medium">
                Save 20%
              </motion.span>
            )}
          </div>
        </motion.div>

        {/* Plans Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
          {PLANS.map((plan, i) => (
            <motion.div
              key={plan.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1, duration: 0.4 }}
              className={`relative rounded-2xl border ${plan.popular ? 'border-cyan-500/15 bg-cyan-500/[0.02]' : 'border-white/[0.04] bg-white/[0.005]'} p-6 flex flex-col hover:border-white/[0.06] transition-all`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <div className="flex items-center gap-1 rounded-full bg-cyan-500/15 border border-cyan-500/20 px-3 py-0.5 text-[10px] font-semibold text-cyan-400">
                    <Star className="h-2.5 w-2.5" /> Most Popular
                  </div>
                </div>
              )}

              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <plan.icon className={`h-5 w-5 ${plan.id === 'free' ? 'text-slate-600' : 'text-cyan-400/70'}`} />
                  <h3 className="text-[18px] font-semibold">{plan.name}</h3>
                </div>
                <div className="flex items-baseline gap-1 mb-1">
                  {plan.price.monthly === 0 ? (
                    <span className="text-3xl font-bold">Free</span>
                  ) : (
                    <>
                      <span className="text-3xl font-bold">${yearly ? plan.price.yearly : plan.price.monthly}</span>
                      <span className="text-[13px] text-slate-600">/mo</span>
                    </>
                  )}
                </div>
                <p className="text-[12px] text-slate-600">{plan.description}</p>
              </div>

              <ul className="space-y-2.5 mb-6 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[12px] text-slate-400">
                    <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400/60 mt-0.5" />
                    {f}
                  </li>
                ))}
                {plan.unavailable.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-[12px] text-slate-700">
                    <X className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              <Button
                variant={plan.popular ? 'default' : 'outline'}
                className={`w-full h-10 text-[13px] font-medium rounded-xl ${
                  plan.popular
                    ? 'bg-white/[0.08] hover:bg-white/[0.12] text-white border border-white/[0.08]'
                    : 'border-white/[0.06] text-slate-400 hover:text-white hover:bg-white/[0.03]'
                }`}
                onClick={() => { if (plan.id === 'free') navigate('/chat'); }}
              >
                {plan.cta}
              </Button>
            </motion.div>
          ))}
        </div>

        {/* Feature Comparison */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="rounded-2xl border border-white/[0.04] bg-white/[0.005] overflow-hidden"
        >
          <div className="px-6 py-4 border-b border-white/[0.03]">
            <h2 className="text-[18px] font-semibold">Feature Comparison</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-white/[0.03]">
                  <th className="text-left px-6 py-3 text-slate-500 font-medium">Feature</th>
                  {PLANS.map((p) => (
                    <th key={p.id} className="text-center px-4 py-3 font-medium text-slate-400">{p.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FEATURES_COMPARE.map((row) => (
                  <tr key={row.name} className="border-b border-white/[0.02] hover:bg-white/[0.01] transition-colors">
                    <td className="px-6 py-3 text-slate-400">{row.name}</td>
                    <td className="text-center px-4 py-3 text-slate-600">{typeof row.free === 'boolean' ? (row.free ? <Check className="h-3.5 w-3.5 text-emerald-400/60 mx-auto" /> : <X className="h-3.5 w-3.5 text-slate-800 mx-auto" />) : row.free}</td>
                    <td className="text-center px-4 py-3 text-slate-400">{typeof row.pro === 'boolean' ? (row.pro ? <Check className="h-3.5 w-3.5 text-emerald-400/60 mx-auto" /> : <X className="h-3.5 w-3.5 text-slate-800 mx-auto" />) : row.pro}</td>
                    <td className="text-center px-4 py-3 text-slate-400">{typeof row.ultra === 'boolean' ? (row.ultra ? <Check className="h-3.5 w-3.5 text-emerald-400/60 mx-auto" /> : <X className="h-3.5 w-3.5 text-slate-800 mx-auto" />) : row.ultra}</td>
                    <td className="text-center px-4 py-3 text-slate-400">{typeof row.enterprise === 'boolean' ? (row.enterprise ? <Check className="h-3.5 w-3.5 text-emerald-400/60 mx-auto" /> : <X className="h-3.5 w-3.5 text-slate-800 mx-auto" />) : row.enterprise}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>

        {/* Trust */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-[11px] text-slate-700">
          <span className="flex items-center gap-1.5"><Shield className="h-3.5 w-3.5" /> 30-day money-back</span>
          <span className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> Cancel anytime</span>
          <span className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> No credit card required for free</span>
        </div>
      </div>

      <Footer />
    </div>
  );
}
