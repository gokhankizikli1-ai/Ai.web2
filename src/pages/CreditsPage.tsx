import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Sparkles, Zap, Crown, Check,
  Coins, CreditCard, AlertCircle, BarChart3,
  TrendingUp, Brain, Globe, Bot, FileText,
  Package, ArrowUpRight, Shield, Clock,
  Users, Server, Code, Layers,
  Plus, Minus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import Navigation from '@/components/Navigation';
import PremiumSlider from '@/components/PremiumSlider';

/* ═══════════════════════════════════════════
   CREDIT COSTS — realistic AI usage economy
   Normal chat = 0 credits (always free)
   ═══════════════════════════════════════════ */

const CREDIT_COSTS = [
  { name: 'Casual Chat', cost: 0, desc: 'Normal conversation', icon: Sparkles, color: 'text-[#6F8F7A]' },
  { name: 'Fast Response', cost: 0, desc: 'Quick AI reply', icon: Zap, color: 'text-[#6F8F7A]' },
  { name: 'Deep Think', cost: '1-2', desc: 'Simple reasoning', icon: Brain, color: 'text-[#9CBBD1]' },
  { name: 'Deep Think Pro', cost: '3-5', desc: 'Complex multi-step', icon: Brain, color: 'text-[#9CBBD1]' },
  { name: 'Web Research', cost: '5-20', desc: 'Live data search', icon: Globe, color: 'text-[#9CBBD1]' },
  { name: 'File Analysis', cost: '3-15', desc: 'PDF, CSV, docs', icon: FileText, color: 'text-[#9CBBD1]' },
  { name: 'Trading Intel', cost: '2-10', desc: 'Market signals', icon: TrendingUp, color: 'text-[#A68A5B]' },
  { name: 'AI Agents', cost: '5-50', desc: 'Custom workflows', icon: Bot, color: 'text-[#9CBBD1]' },
  { name: 'Premium Reasoning', cost: 'Variable', desc: 'Long context tasks', icon: Shield, color: 'text-[#9CBBD1]' },
];

/* ═══════════════════════════════════════════
   PLANS — with monthly/yearly pricing
   Yearly = 20% off (× 12 × 0.8)
   ═══════════════════════════════════════════ */

interface PlanData {
  id: string;
  name: string;
  priceMonthly: number;
  priceYearly: number;
  credits: number;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  features: string[];
  limits: string[];
  popular?: boolean;
  cta: string;
  current?: boolean;
  enterprise?: boolean;
}

const PLANS: PlanData[] = [
  {
    id: 'free',
    name: 'Free',
    priceMonthly: 0,
    priceYearly: 0,
    credits: 0,
    description: 'Casual chat, always free',
    icon: Sparkles,
    accent: 'slate',
    features: [
      'Unlimited casual chat',
      'Fast responses (0 credits)',
      '3 basic AI modes',
      '1 workspace',
      '7-day chat history',
    ],
    limits: ['No Deep Think', 'No Web Research', 'No AI Agents', 'No File Analysis', 'No Trading Intel'],
    cta: 'Start Free',
  },
  {
    id: 'basic',
    name: 'Basic',
    priceMonthly: 9,
    priceYearly: 86, // 9 * 12 * 0.8 = 86.4
    credits: 100,
    description: '100 credits / month',
    icon: Zap,
    accent: 'cyan',
    features: [
      'Everything in Free',
      '100 credits monthly',
      'Deep Think enabled',
      'Web Research (5-20cr)',
      'File Analysis (3-15cr)',
      'All 6 AI modes',
      'All 9 workspaces',
    ],
    limits: ['No AI Agents', 'No Trading Intel'],
    cta: 'Upgrade to Basic',
  },
  {
    id: 'pro',
    name: 'Pro',
    priceMonthly: 19,
    priceYearly: 182, // 19 * 12 * 0.8 = 182.4
    credits: 300,
    description: '300 credits / month',
    icon: Crown,
    accent: 'amber',
    popular: true,
    features: [
      'Everything in Basic',
      '300 credits monthly',
      'AI Agents (5-50cr)',
      'Trading Intel (2-10cr)',
      'Premium models access',
      'Long context reasoning',
      'Priority support',
      'Export & share',
    ],
    limits: [],
    cta: 'Upgrade to Pro',
    current: true,
  },
  {
    id: 'ultra',
    name: 'Ultra',
    priceMonthly: 49,
    priceYearly: 470, // 49 * 12 * 0.8 = 470.4
    credits: 1000,
    description: '1000 credits / month',
    icon: Shield,
    accent: 'purple',
    features: [
      'Everything in Pro',
      '1000 credits monthly',
      '50% credit rollover',
      'Highest rate limits',
      'Custom AI agents',
      'Team sharing (up to 3)',
      'API access',
      'Dedicated support',
    ],
    limits: [],
    cta: 'Upgrade to Ultra',
  },
];

/* ═══════════════════════════════════════════
   CREDIT PACKS — premium AI compute pricing
   Formula: price = credits x $0.10
   ═══════════════════════════════════════════ */

const CREDIT_RATE = 0.10;

const QUICK_PACKS = [
  { credits: 10, color: 'text-slate-300', glow: 'hover:shadow-[0_0_20px_rgba(255,255,255,0.03)]' },
  { credits: 20, color: 'text-[#6F8F7A]', glow: 'hover:shadow-[0_0_20px_rgba(156, 187, 209,0.06)]' },
  { credits: 50, color: 'text-[#9CBBD1]', glow: 'hover:shadow-[0_0_20px_rgba(156, 187, 209,0.06)]' },
  { credits: 100, color: 'text-[#9CBBD1]', glow: 'hover:shadow-[0_0_20px_rgba(156, 187, 209,0.06)]' },
  { credits: 500, color: 'text-[#9CBBD1]', glow: 'hover:shadow-[0_0_20px_rgba(156, 187, 209,0.06)]' },
  { credits: 1000, color: 'text-[#A68A5B]', glow: 'hover:shadow-[0_0_24px_rgba(166,138,91,0.08)]' },
  { credits: 2000, color: 'text-[#9CBBD1]', glow: 'hover:shadow-[0_0_28px_rgba(156, 187, 209,0.10)]' },
];

function formatPrice(cents: number): string {
  return (cents * CREDIT_RATE).toFixed(cents < 100 ? 2 : 0);
}

/* ═══════════════════════════════════════════
   USAGE ANALYTICS (demo data)
   ═══════════════════════════════════════════ */

const USAGE_DATA = [
  { day: 'Mon', casual: 45, advanced: 12 },
  { day: 'Tue', casual: 62, advanced: 8 },
  { day: 'Wed', casual: 38, advanced: 25 },
  { day: 'Thu', casual: 55, advanced: 18 },
  { day: 'Fri', casual: 72, advanced: 35 },
  { day: 'Sat', casual: 30, advanced: 42 },
  { day: 'Sun', casual: 28, advanced: 20 },
];

/* ═══════════════════════════════════════════
   CUSTOM PLAN BUILDER — feature catalog
   ═══════════════════════════════════════════ */

interface BuilderFeature {
  id: string;
  name: string;
  description: string;
  price: number;
  icon: React.ComponentType<{ className?: string }>;
  category: string;
}

const BUILDER_FEATURES: BuilderFeature[] = [
  { id: 'chat', name: 'Casual Chat', description: 'Unlimited', price: 0, icon: Sparkles, category: 'Core' },
  { id: 'fast', name: 'Fast Responses', description: 'Real-time', price: 0, icon: Zap, category: 'Core' },
  { id: 'deep-think', name: 'Deep Think', description: 'Multi-step reasoning', price: 8, icon: Brain, category: 'AI' },
  { id: 'research', name: 'Research', description: 'Web research & analysis', price: 10, icon: Globe, category: 'AI' },
  { id: 'trading', name: 'Trading Intelligence', description: 'Market signals & analysis', price: 12, icon: TrendingUp, category: 'AI' },
  { id: 'file-analysis', name: 'File Analysis', description: 'PDF, CSV, DOC processing', price: 8, icon: FileText, category: 'AI' },
  { id: 'memory', name: 'Memory', description: 'Persistent context', price: 0, icon: Layers, category: 'Core' },
  { id: 'agents', name: 'AI Agents', description: 'Custom workflows', price: 15, icon: Bot, category: 'Advanced' },
  { id: 'all-agents', name: 'All Agents Suite', description: 'Full agent marketplace', price: 25, icon: Bot, category: 'Advanced' },
  { id: 'api', name: 'API Access', description: 'Programmatic access', price: 20, icon: Code, category: 'Advanced' },
  { id: 'team', name: 'Team Workspace', description: 'Collaborative workspace', price: 0, icon: Users, category: 'Team' },
  { id: 'support', name: 'Dedicated Support', description: 'Priority response', price: 0, icon: Shield, category: 'Team' },
  { id: 'private', name: 'Private Deployment', description: 'Isolated infrastructure', price: 0, icon: Server, category: 'Team' },
];

/* ═══════════════════════════════════════════
   Animation helper
   ═══════════════════════════════════════════ */

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
});

/* ═══════════════════════════════════════════
   PlanCard sub-component
   ═══════════════════════════════════════════ */

function PlanCard({
  plan,
  isYearly,
}: {
  plan: PlanData;
  isYearly: boolean;
}) {
  const displayPrice = isYearly ? plan.priceYearly : plan.priceMonthly;
  const period = isYearly ? '/yr' : plan.priceMonthly === 0 ? ' forever' : '/mo';
  const yearlySavings = plan.priceMonthly * 12 - plan.priceYearly;

  return (
    <motion.div
      whileHover={{ y: -2 }}
      className={`relative p-5 rounded-2xl border ${
        plan.current
          ? 'border-[#A68A5B]/15 bg-[#A68A5B]/[0.02]'
          : plan.enterprise
            ? 'border-[#7EA6BF]/10 bg-[#7EA6BF]/[0.02]'
            : 'border-white/[0.03] bg-white/[0.01]'
      } hover:border-white/[0.08] transition-all flex flex-col`}
    >
      {plan.popular && (
        <div className="absolute -top-px left-1/2 -translate-x-1/2">
          <span className="text-[9px] font-semibold px-3 py-0.5 rounded-b-lg bg-[#A68A5B]/[0.1] border border-[#A68A5B]/15 border-t-0 text-[#A68A5B] uppercase tracking-wider">
            Most Popular
          </span>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded-lg bg-white/[0.03]">
          <plan.icon className="w-4 h-4 text-[#A9B7C6]" />
        </div>
        <span className="text-[13px] font-medium text-white">{plan.name}</span>
      </div>

      <div className="mb-1">
        {plan.enterprise ? (
          <span className="text-2xl font-bold text-white">Custom</span>
        ) : (
          <>
            <span className="text-2xl font-bold text-white">
              ${displayPrice}
            </span>
            <span className="text-[11px] text-[#7F8FA3]">{period}</span>
          </>
        )}
      </div>

      {isYearly && yearlySavings > 0 && !plan.enterprise && (
        <p className="text-[10px] text-[#6F8F7A]/60 mb-2">Save ${yearlySavings}/year</p>
      )}

      {plan.credits > 0 && (
        <p className="text-[11px] text-[#7F8FA3] mb-3">{plan.credits.toLocaleString()} credits / mo</p>
      )}
      {plan.credits === 0 && !plan.enterprise && (
        <p className="text-[11px] text-[#7F8FA3] mb-3">No credits needed</p>
      )}
      {plan.enterprise && (
        <p className="text-[11px] text-[#7F8FA3] mb-3">Custom pricing for teams</p>
      )}

      <ul className="space-y-1.5 mb-4 flex-1">
        {plan.features.map((f) => (
          <li key={f} className="flex items-start gap-1.5 text-[11px] text-[#A9B7C6]">
            <Check className="w-3 h-3 text-[#6F8F7A]/50 shrink-0 mt-0.5" />
            {f}
          </li>
        ))}
        {plan.limits.map((l) => (
          <li key={l} className="flex items-start gap-1.5 text-[11px] text-[#7F8FA3]">
            <span className="w-3 h-3 rounded-full border border-slate-800 shrink-0 mt-0.5" />
            {l}
          </li>
        ))}
      </ul>

      <Button
        className={`w-full h-8 rounded-xl text-[11px] font-medium transition-all ${
          plan.current
            ? 'bg-white/[0.06] text-white border border-white/[0.08] cursor-default'
            : plan.enterprise
              ? 'bg-[#7EA6BF]/[0.08] text-[#9CBBD1] border border-[#7EA6BF]/15 hover:bg-[#7EA6BF]/[0.12]'
              : plan.popular
                ? 'bg-[#A68A5B]/[0.08] text-[#A68A5B] border border-[#A68A5B]/15 hover:bg-[#A68A5B]/[0.12]'
                : 'bg-white/[0.03] text-[#A9B7C6] border border-white/[0.04] hover:bg-white/[0.05]'
        }`}
        disabled={plan.current}
      >
        {plan.current ? 'Current Plan' : plan.cta}
      </Button>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════
   Custom Plan Builder sub-component
   ═══════════════════════════════════════════ */

function CustomPlanBuilder({ isYearly }: { isYearly: boolean }) {
  const [selectedFeatures, setSelectedFeatures] = useState<Set<string>>(new Set(['chat', 'fast', 'memory', 'team']));
  const [monthlyCredits, setMonthlyCredits] = useState(500);
  const [teamSeats, setTeamSeats] = useState(5);

  const toggleFeature = (id: string) => {
    setSelectedFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        // Don't uncheck core features
        if (!['chat', 'fast', 'memory'].includes(id)) next.delete(id);
      } else {
        next.add(id);
        // Auto-include dependencies
        if (id === 'all-agents') next.add('agents');
      }
      return next;
    });
  };

  const basePrice = 9;
  const featuresPrice = BUILDER_FEATURES
    .filter((f) => selectedFeatures.has(f.id) && f.price > 0)
    .reduce((sum, f) => sum + f.price, 0);
  const seatsPrice = selectedFeatures.has('team') ? teamSeats * 5 : 0;
  const creditsPrice = monthlyCredits > 0 ? Math.round(monthlyCredits * CREDIT_RATE) : 0;

  const monthlyTotal = basePrice + featuresPrice + seatsPrice + creditsPrice;
  const yearlyTotal = Math.round(monthlyTotal * 12 * 0.8);

  const grouped = BUILDER_FEATURES.reduce<Record<string, BuilderFeature[]>>((acc, f) => {
    if (!acc[f.category]) acc[f.category] = [];
    acc[f.category].push(f);
    return acc;
  }, {});

  const categoryIcons: Record<string, React.ComponentType<{ className?: string }>> = {
    Core: Zap,
    AI: Brain,
    Advanced: Shield,
    Team: Users,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-2">
        <div>
          <h3 className="text-[13px] font-medium text-white flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#9CBBD1]" /> Build Your Custom Plan
          </h3>
          <p className="text-[11px] text-[#7F8FA3] mt-0.5">Select features, credits, and team size. Live price estimate.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Feature Selector */}
        <div className="lg:col-span-2 space-y-4">
          {Object.entries(grouped).map(([category, features]) => {
            const CatIcon = categoryIcons[category] || Layers;
            return (
              <div key={category} className="p-4 rounded-2xl border border-white/[0.03] bg-white/[0.01]">
                <h4 className="text-[11px] font-medium text-[#A9B7C6] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <CatIcon className="w-3 h-3" /> {category}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {features.map((feature) => {
                    const isSelected = selectedFeatures.has(feature.id);
                    const isCore = ['chat', 'fast', 'memory'].includes(feature.id);
                    return (
                      <button
                        key={feature.id}
                        onClick={() => toggleFeature(feature.id)}
                        className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                          isSelected
                            ? 'border-white/[0.08] bg-white/[0.03]'
                            : 'border-white/[0.02] bg-transparent hover:border-white/[0.04]'
                        } ${isCore ? 'opacity-80' : ''}`}
                      >
                        <div className={`p-1.5 rounded-lg ${isSelected ? 'bg-white/[0.04]' : 'bg-white/[0.02]'}`}>
                          <feature.icon className={`w-3.5 h-3.5 ${isSelected ? 'text-slate-300' : 'text-[#7F8FA3]'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-[11px] ${isSelected ? 'text-white' : 'text-[#7F8FA3]'}`}>{feature.name}</p>
                          <p className="text-[10px] text-[#7F8FA3]">{feature.description}</p>
                        </div>
                        <div className="text-right shrink-0">
                          {feature.price > 0 ? (
                            <span className={`text-[11px] font-medium ${isSelected ? 'text-[#9CBBD1]' : 'text-[#7F8FA3]'}`}>+${feature.price}/mo</span>
                          ) : (
                            <span className="text-[10px] text-[#6F8F7A]/50">Included</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Monthly Credits Slider */}
          <div className="p-4 rounded-2xl border border-white/[0.03] bg-white/[0.01]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] text-[#A9B7C6]">Monthly Credits</span>
              <span className="text-[13px] font-mono font-medium text-[#9CBBD1]">{monthlyCredits.toLocaleString()}</span>
            </div>
            <PremiumSlider value={monthlyCredits} min={100} max={5000} step={100} onChange={setMonthlyCredits} showValue={false} />
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-[#7F8FA3]">100</span>
              <span className="text-[10px] text-[#7F8FA3]">5,000</span>
            </div>
          </div>

          {/* Team Seats */}
          {selectedFeatures.has('team') && (
            <div className="p-4 rounded-2xl border border-white/[0.03] bg-white/[0.01]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-[#A9B7C6]">Team Seats</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setTeamSeats(Math.max(1, teamSeats - 1))} className="h-6 w-6 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-[#A9B7C6] hover:text-white transition-colors">
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="text-[12px] font-mono font-medium text-white w-8 text-center">{teamSeats}</span>
                  <button onClick={() => setTeamSeats(Math.min(100, teamSeats + 1))} className="h-6 w-6 rounded-lg bg-white/[0.04] border border-white/[0.06] flex items-center justify-center text-[#A9B7C6] hover:text-white transition-colors">
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-[#7F8FA3]">${5}/seat/month</p>
            </div>
          )}
        </div>

        {/* Price Summary Sticky */}
        <div className="lg:col-span-1">
          <div className="lg:sticky lg:top-4 p-5 rounded-2xl border border-[#7EA6BF]/10 bg-[#7EA6BF]/[0.02]">
            <h4 className="text-[12px] font-medium text-white mb-4">Price Estimate</h4>

            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-[11px]">
                <span className="text-[#7F8FA3]">Base platform</span>
                <span className="text-slate-300">${basePrice}/mo</span>
              </div>
              {featuresPrice > 0 && (
                <div className="flex justify-between text-[11px]">
                  <span className="text-[#7F8FA3]">Features</span>
                  <span className="text-slate-300">+${featuresPrice}/mo</span>
                </div>
              )}
              {seatsPrice > 0 && (
                <div className="flex justify-between text-[11px]">
                  <span className="text-[#7F8FA3]">Team ({teamSeats} seats)</span>
                  <span className="text-slate-300">+${seatsPrice}/mo</span>
                </div>
              )}
              {creditsPrice > 0 && (
                <div className="flex justify-between text-[11px]">
                  <span className="text-[#7F8FA3]">Credits ({monthlyCredits.toLocaleString()})</span>
                  <span className="text-slate-300">+${creditsPrice}/mo</span>
                </div>
              )}
            </div>

            <div className="border-t border-white/[0.04] pt-3 mb-4">
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] text-[#A9B7C6]">
                  {isYearly ? 'Yearly' : 'Monthly'} total
                </span>
                <span className="text-2xl font-bold text-white">
                  ${isYearly ? yearlyTotal : monthlyTotal}
                  <span className="text-[11px] text-[#7F8FA3] font-normal">{isYearly ? '/yr' : '/mo'}</span>
                </span>
              </div>
              {isYearly && (
                <p className="text-[10px] text-[#6F8F7A]/50 mt-1 text-right">
                  Save ${Math.round(monthlyTotal * 12 - yearlyTotal)} vs monthly
                </p>
              )}
            </div>

            <Button className="w-full h-9 rounded-xl bg-[#7EA6BF]/[0.08] text-[#9CBBD1] border border-[#7EA6BF]/15 text-[11px] font-medium hover:bg-[#7EA6BF]/[0.12] transition-all">
              Request Enterprise Quote
            </Button>

            <p className="text-[9px] text-[#7F8FA3] text-center mt-2">
              Our team will contact you within 24h
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   Main Page
   ═══════════════════════════════════════════ */

export default function CreditsPage() {
  const [creditsRemaining] = useState(153);
  const creditsTotal = 300;
  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'plans' | 'packs' | 'usage' | 'custom'>('plans');
  const [isYearly, setIsYearly] = useState(false);
  const [customCredits, setCustomCredits] = useState(500);

  const usagePercent = Math.round((creditsTotal - creditsRemaining) / creditsTotal * 100);

  const tabs = [
    { id: 'plans' as const, label: 'Plans', icon: Crown },
    { id: 'packs' as const, label: 'Credit Packs', icon: Package },
    { id: 'usage' as const, label: 'Usage', icon: BarChart3 },
    { id: 'custom' as const, label: 'Custom', icon: Shield },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 flex flex-col">
      <Navigation />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

          {/* ═══ HEADER ═══ */}
          <motion.div {...fadeUp(0)} className="mb-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#A68A5B]/[0.08] border border-[#A68A5B]/15">
                <Coins className="h-5 w-5 text-[#A68A5B]" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-white tracking-tight">Credits &amp; Plans</h1>
                <p className="text-[12px] text-[#7F8FA3]">Advanced AI operations. Casual chat is always free.</p>
              </div>
            </div>
          </motion.div>

          {/* ═══ LIVE CREDITS CARD ═══ */}
          <motion.div {...fadeUp(0.05)} className="mb-8 p-5 sm:p-6 rounded-2xl border border-white/[0.04] bg-white/[0.01]">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-xl bg-[#A68A5B]/[0.06] border border-[#A68A5B]/10">
                  <CreditCard className="w-6 h-6 text-[#A68A5B]" />
                </div>
                <div>
                  <p className="text-[11px] text-[#7F8FA3] uppercase tracking-wider">Remaining Credits</p>
                  <div className="flex items-baseline gap-2">
                    <p className="text-3xl font-bold text-white tabular-nums">{creditsRemaining}</p>
                    <p className="text-[13px] text-[#7F8FA3]">/ {creditsTotal}</p>
                  </div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="flex-1 max-w-xs">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] text-[#7F8FA3]">{usagePercent}% used this period</span>
                  <span className="text-[10px] text-[#7F8FA3]">Resets in 12 days</span>
                </div>
                <div className="w-full h-2 bg-white/[0.03] rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-[#9CBBD1]/50"
                    initial={{ width: 0 }}
                    animate={{ width: `${usagePercent}%` }}
                    transition={{ duration: 1, ease: 'easeOut' }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#A68A5B]/[0.06] border border-[#A68A5B]/10">
                  <Crown className="w-3.5 h-3.5 text-[#A68A5B]" />
                  <span className="text-[11px] font-medium text-[#A68A5B]">Pro</span>
                </div>
              </div>
            </div>

            {/* Casual chat = free notice */}
            <div className="mt-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-[#6F8F7A]/[0.03] border border-[#6F8F7A]/8">
              <Zap className="w-3.5 h-3.5 text-[#6F8F7A]/60" />
              <p className="text-[11px] text-[#6F8F7A]/70">
                <span className="font-medium">Casual chat is free.</span> Credits only used for advanced operations like Deep Think, Research, Agents, and Trading.
              </p>
            </div>
          </motion.div>

          {/* ═══ TAB SWITCHER + MONTHLY/YEARLY TOGGLE ═══ */}
          <motion.div {...fadeUp(0.08)} className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex gap-1 p-0.5 rounded-xl bg-white/[0.02] border border-white/[0.03] w-fit">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-medium transition-all ${
                    activeTab === t.id ? 'bg-white/[0.06] text-white' : 'text-[#7F8FA3] hover:text-[#A9B7C6]'
                  }`}
                >
                  <t.icon className="w-3.5 h-3.5" /> {t.label}
                </button>
              ))}
            </div>

            {/* Monthly / Yearly toggle */}
            {activeTab === 'plans' && (
              <div className="flex items-center gap-2">
                <div className="flex gap-1 p-0.5 rounded-lg bg-white/[0.02] border border-white/[0.03]">
                  <button
                    onClick={() => setIsYearly(false)}
                    className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-all ${
                      !isYearly ? 'bg-white/[0.06] text-white' : 'text-[#7F8FA3] hover:text-[#A9B7C6]'
                    }`}
                  >
                    Monthly
                  </button>
                  <button
                    onClick={() => setIsYearly(true)}
                    className={`px-3 py-1.5 rounded-md text-[11px] font-medium transition-all flex items-center gap-1.5 ${
                      isYearly ? 'bg-white/[0.06] text-white' : 'text-[#7F8FA3] hover:text-[#A9B7C6]'
                    }`}
                  >
                    Yearly
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#6F8F7A]/[0.08] text-[#6F8F7A] font-medium">
                      Save 20%
                    </span>
                  </button>
                </div>
              </div>
            )}
          </motion.div>

          {/* ═══ TAB: PLANS ═══ */}
          {activeTab === 'plans' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
              {/* Free chat banner */}
              <div className="mb-4 p-3 rounded-xl border border-[#6F8F7A]/8 bg-[#6F8F7A]/[0.02] flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#6F8F7A]/[0.06] border border-[#6F8F7A]/10 shrink-0">
                  <Sparkles className="h-4 w-4 text-[#6F8F7A]/70" />
                </div>
                <div>
                  <p className="text-[12px] font-medium text-[#6F8F7A]/80">Casual chat is always free</p>
                  <p className="text-[10px] text-[#7F8FA3] mt-0.5">Credits are only used for advanced operations below.</p>
                </div>
              </div>

              {/* Credit cost breakdown */}
              <div className="mb-8 p-4 rounded-2xl border border-white/[0.03] bg-white/[0.01]">
                <h3 className="text-[12px] font-medium text-white mb-3 flex items-center gap-2">
                  <Coins className="w-3.5 h-3.5 text-[#7F8FA3]" /> Credit Cost Guide
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {CREDIT_COSTS.map((item) => (
                    <div key={item.name} className="flex items-center gap-2 p-2.5 rounded-lg bg-white/[0.02]">
                      <item.icon className={`w-3.5 h-3.5 ${item.color} shrink-0`} />
                      <div className="min-w-0">
                        <p className="text-[11px] text-slate-300 truncate">{item.name}</p>
                        <p className="text-[10px] text-[#7F8FA3]">{item.desc}</p>
                      </div>
                      <span className={`text-[11px] font-mono font-medium ${item.color} shrink-0 ml-auto`}>
                        {typeof item.cost === 'number' && item.cost === 0 ? 'Free' : item.cost}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Plan cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
                {PLANS.filter((p) => !p.enterprise).map((plan) => (
                  <PlanCard key={plan.id} plan={plan} isYearly={isYearly} />
                ))}
              </div>

              {/* Enterprise row */}
              <div className="p-5 rounded-2xl border border-[#7EA6BF]/10 bg-[#7EA6BF]/[0.02] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Shield className="w-4 h-4 text-[#9CBBD1]" />
                    <span className="text-[13px] font-medium text-white">Enterprise</span>
                    <span className="text-[10px] text-[#9CBBD1]/50 bg-[#7EA6BF]/[0.06] px-1.5 py-0.5 rounded">Custom</span>
                  </div>
                  <p className="text-[11px] text-[#7F8FA3]">Custom pricing for teams. Unlimited credits, dedicated infrastructure, SLA guarantee, private deployment.</p>
                </div>
                <Button
                  onClick={() => setActiveTab('custom')}
                  className="h-8 px-5 rounded-xl bg-[#7EA6BF]/[0.08] text-[#9CBBD1] border border-[#7EA6BF]/15 text-[11px] hover:bg-[#7EA6BF]/[0.12] shrink-0"
                >
                  Build Custom Plan
                </Button>
              </div>
            </motion.div>
          )}

          {/* ═══ TAB: CREDIT PACKS ═══ */}
          {activeTab === 'packs' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
              {/* Usage transparency card */}
              <div className="mb-6 p-4 rounded-2xl border border-[#7EA6BF]/8 bg-[#7EA6BF]/[0.02] flex items-start gap-3">
                <Zap className="w-4 h-4 text-[#9CBBD1]/60 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[11px] text-slate-300 mb-0.5">
                    <span className="font-medium">Simple chat is free.</span> Advanced AI features consume credits based on compute usage.
                  </p>
                  <p className="text-[10px] text-[#7F8FA3]">
                    Deep Think 1-2cr, Research 5-20cr, File Analysis 3-15cr, Trading 2-10cr, Agents 5-50cr. Credits are non-refundable.
                  </p>
                </div>
              </div>

              {/* Pricing rate banner */}
              <div className="mb-6 flex items-center justify-center gap-2 py-3 rounded-2xl border border-white/[0.03] bg-white/[0.01]">
                <Coins className="w-3.5 h-3.5 text-[#A68A5B]/50" />
                <span className="text-[11px] text-[#A9B7C6]">
                  Rate: <span className="text-[#A68A5B]/70 font-medium">$0.10 per credit</span> — Premium AI compute
                </span>
              </div>

              {/* ═── Quick Pack Cards ─══ */}
              <h3 className="text-[12px] font-medium text-white mb-3 flex items-center gap-2">
                <Package className="w-3.5 h-3.5 text-[#7F8FA3]" /> Quick Packs
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-8">
                {QUICK_PACKS.map((pack, i) => {
                  const price = formatPrice(pack.credits);
                  const isSelected = selectedPack === `q${pack.credits}`;
                  return (
                    <motion.button
                      key={pack.credits}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04, duration: 0.3 }}
                      whileHover={{ y: -3, scale: 1.02 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => setSelectedPack(`q${pack.credits}`)}
                      className={`relative p-4 rounded-2xl border text-center transition-all duration-200 ${
                        isSelected
                          ? 'border-[#A68A5B]/20 bg-[#A68A5B]/[0.03] shadow-[0_0_24px_rgba(166,138,91,0.06)]'
                          : 'border-white/[0.03] bg-white/[0.01] hover:border-white/[0.08]'
                      } ${pack.glow}`}
                    >
                      <p className={`text-lg font-bold text-white tabular-nums`}>{pack.credits}</p>
                      <p className="text-[9px] text-[#7F8FA3] mb-2">credits</p>
                      <p className={`text-[13px] font-semibold ${pack.color}`}>${price}</p>
                      {pack.credits >= 1000 && (
                        <span className="absolute -top-1.5 -right-1.5 text-[8px] font-semibold px-1.5 py-0.5 rounded-full bg-[#A68A5B]/[0.1] border border-[#A68A5B]/15 text-[#A68A5B] uppercase">
                          Bulk
                        </span>
                      )}
                    </motion.button>
                  );
                })}
              </div>

              {/* Selected quick pack CTA */}
              {selectedPack && selectedPack.startsWith('q') && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-8 p-4 rounded-2xl border border-[#A68A5B]/15 bg-[#A68A5B]/[0.02] flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-[#A68A5B]/[0.06] border border-[#A68A5B]/10">
                      <Coins className="w-4 h-4 text-[#A68A5B]" />
                    </div>
                    <div>
                      <p className="text-[12px] text-white font-medium">
                        {selectedPack.replace('q', '')} Credits
                      </p>
                      <p className="text-[11px] text-[#7F8FA3]">
                        ${formatPrice(Number(selectedPack.replace('q', '')))} at $0.10/cr
                      </p>
                    </div>
                  </div>
                  <Button className="h-8 px-5 rounded-xl bg-[#A68A5B]/[0.08] text-[#A68A5B] border border-[#A68A5B]/15 text-[11px] hover:bg-[#A68A5B]/[0.12]">
                    Purchase
                  </Button>
                </motion.div>
              )}

              {/* ═── Custom Credit Amount ─══ */}
              <div className="p-6 rounded-2xl border border-white/[0.04] bg-white/[0.01] relative overflow-hidden">
                {/* Subtle glow background */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-[#7EA6BF]/[0.015] rounded-full blur-3xl pointer-events-none" />

                <h3 className="text-[13px] font-medium text-white mb-1 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-[#9CBBD1]/60" /> Custom Amount
                </h3>
                <p className="text-[11px] text-[#7F8FA3] mb-6">Enter any amount. Price updates instantly.</p>

                {/* Input + Live Price */}
                <div className="flex flex-col sm:flex-row gap-4 mb-6">
                  {/* Credit Input */}
                  <div className="flex-1">
                    <label className="text-[10px] text-[#7F8FA3] uppercase tracking-wider mb-1.5 block">Credits</label>
                    <div className="flex items-center gap-2 p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] focus-within:border-[#7EA6BF]/20 transition-colors">
                      <Coins className="w-4 h-4 text-[#7F8FA3] shrink-0" />
                      <input
                        type="number"
                        min={1}
                        max={10000}
                        value={customCredits}
                        onChange={(e) => setCustomCredits(Math.max(1, Math.min(10000, Number(e.target.value) || 0)))}
                        className="flex-1 bg-transparent text-[18px] font-semibold text-white outline-none tabular-nums"
                      />
                      <span className="text-[11px] text-[#7F8FA3]">credits</span>
                    </div>
                  </div>

                  {/* Live Price Display */}
                  <div className="flex-1">
                    <label className="text-[10px] text-[#7F8FA3] uppercase tracking-wider mb-1.5 block">Total Price</label>
                    <motion.div
                      className="p-3 rounded-xl border border-[#7EA6BF]/10 bg-[#7EA6BF]/[0.02] flex items-center justify-between"
                      layout
                    >
                      <span className="text-[11px] text-[#7F8FA3]">{customCredits.toLocaleString()} x $0.10</span>
                      <motion.span
                        key={customCredits}
                        initial={{ scale: 1.1, color: '#9CBBD1' }}
                        animate={{ scale: 1, color: '#ffffff' }}
                        transition={{ duration: 0.2 }}
                        className="text-[18px] font-bold tabular-nums"
                      >
                        ${formatPrice(customCredits)}
                      </motion.span>
                    </motion.div>
                  </div>
                </div>

                {/* Slider */}
                <div className="mb-6">
                  <PremiumSlider
                    value={customCredits}
                    min={10}
                    max={5000}
                    step={10}
                    onChange={setCustomCredits}
                    showValue={false}
                    color="#9CBBD1"
                  />
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-[#7F8FA3]">10</span>
                    <span className="text-[10px] text-[#7F8FA3]">2,500</span>
                    <span className="text-[10px] text-[#7F8FA3]">5,000</span>
                  </div>
                </div>

                {/* Purchase CTA */}
                <Button className="w-full h-10 rounded-xl bg-[#7EA6BF]/[0.08] text-[#9CBBD1] border border-[#7EA6BF]/15 text-[12px] font-medium hover:bg-[#7EA6BF]/[0.12] transition-all">
                  Purchase {customCredits.toLocaleString()} Credits for ${formatPrice(customCredits)}
                </Button>
              </div>

              {/* ═── Reference Table ─══ */}
              <div className="mt-6 p-4 rounded-2xl border border-white/[0.03] bg-white/[0.01]">
                <h4 className="text-[11px] font-medium text-[#A9B7C6] uppercase tracking-wider mb-3">Reference Pricing</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { cr: 100, price: '$10.00' },
                    { cr: 500, price: '$50.00' },
                    { cr: 1000, price: '$100.00' },
                    { cr: 2000, price: '$200.00' },
                  ].map((ref) => (
                    <div key={ref.cr} className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02]">
                      <span className="text-[11px] text-[#A9B7C6]">{ref.cr.toLocaleString()} cr</span>
                      <span className="text-[11px] font-mono font-medium text-slate-300">{ref.price}</span>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* ═══ TAB: USAGE ═══ */}
          {activeTab === 'usage' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
              {/* Weekly chart */}
              <div className="p-5 rounded-2xl border border-white/[0.03] bg-white/[0.01] mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-[13px] font-medium text-white">This Week</h3>
                  <span className="text-[10px] text-[#7F8FA3]">Credits used</span>
                </div>
                <div className="flex items-end gap-2 h-28">
                  {USAGE_DATA.map((d, i) => {
                    const casualH = (d.casual / 100) * 100;
                    const advancedH = (d.advanced / 100) * 100;
                    return (
                      <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                        <div className="w-full flex gap-px h-20 items-end">
                          <motion.div
                            className="flex-1 rounded-t bg-[#6F8F7A]/20"
                            initial={{ height: 0 }}
                            animate={{ height: `${casualH}%` }}
                            transition={{ duration: 0.5, delay: i * 0.05 }}
                            title={`${d.casual} casual (free)`}
                          />
                          <motion.div
                            className="flex-1 rounded-t bg-[#9CBBD1]/30"
                            initial={{ height: 0 }}
                            animate={{ height: `${advancedH}%` }}
                            transition={{ duration: 0.5, delay: i * 0.05 + 0.1 }}
                            title={`${d.advanced} advanced (credits)`}
                          />
                        </div>
                        <span className="text-[9px] text-[#7F8FA3]">{d.day}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-4 mt-3">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-sm bg-[#6F8F7A]/30" />
                    <span className="text-[10px] text-[#7F8FA3]">Casual (free)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-sm bg-[#9CBBD1]/30" />
                    <span className="text-[10px] text-[#7F8FA3]">Advanced (credits)</span>
                  </div>
                </div>
              </div>

              {/* Usage breakdown */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 rounded-2xl border border-white/[0.03] bg-white/[0.01]">
                  <p className="text-[11px] text-[#7F8FA3] mb-1">Total Messages</p>
                  <p className="text-2xl font-bold text-white">1,247</p>
                  <p className="text-[10px] text-[#6F8F7A]/60 mt-1">
                    <ArrowUpRight className="w-3 h-3 inline" /> 340 casual (free)
                  </p>
                </div>
                <div className="p-4 rounded-2xl border border-white/[0.03] bg-white/[0.01]">
                  <p className="text-[11px] text-[#7F8FA3] mb-1">Credits Used</p>
                  <p className="text-2xl font-bold text-white">153</p>
                  <p className="text-[10px] text-[#9CBBD1]/60 mt-1">of 400 monthly</p>
                </div>
                <div className="p-4 rounded-2xl border border-white/[0.03] bg-white/[0.01]">
                  <p className="text-[11px] text-[#7F8FA3] mb-1">Rollover Credits</p>
                  <p className="text-2xl font-bold text-white">47</p>
                  <p className="text-[10px] text-[#9CBBD1]/60 mt-1">from last month</p>
                </div>
              </div>

              {/* Rollover info */}
              <div className="mt-6 p-4 rounded-2xl border border-[#7EA6BF]/10 bg-[#7EA6BF]/[0.02] flex items-start gap-3">
                <Clock className="w-4 h-4 text-[#9CBBD1]/60 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[12px] font-medium text-white mb-1">Credit Rollover</p>
                  <p className="text-[11px] text-[#7F8FA3]">
                    Unused credits roll over to next month (up to 50% of plan). Pro plan: up to 200 credits rollover. Ultra plan: up to 500 credits rollover. Free plan: no rollover.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {/* ═══ TAB: CUSTOM PLAN BUILDER ═══ */}
          {activeTab === 'custom' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
              <CustomPlanBuilder isYearly={isYearly} />
            </motion.div>
          )}

          {/* ═══ FOOTER NOTE ═══ */}
          <motion.div {...fadeUp(0.15)} className="mt-8 p-4 rounded-2xl border border-[#A68A5B]/10 bg-[#A68A5B]/[0.02] flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-[#A68A5B] shrink-0 mt-0.5" />
            <div>
              <p className="text-[11px] text-[#7F8FA3]">
                Payment processing coming soon. All features currently available during early access.
                Credit costs are estimated and may be adjusted. Casual chat will always remain free.
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
