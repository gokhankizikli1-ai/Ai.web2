import { useState } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShoppingCart, DollarSign, Search, Layers, Megaphone,
  Flame, Globe, Shield, Package, TrendingUp, Target,
  Zap, ArrowLeft, ArrowUpRight,
  Award, Users, ShoppingBag,
} from 'lucide-react';
import Navigation from '@/components/Navigation';

const COLOR_MAP: Record<string, { bg: string; border: string; icon: string; glow: string }> = {
  emerald: { bg: 'bg-emerald-500/[0.05]', border: 'border-emerald-500/10', icon: 'text-emerald-400', glow: 'hover:shadow-[0_0_20px_-4px_rgba(52,211,153,0.08)]' },
  cyan:    { bg: 'bg-cyan-500/[0.05]',    border: 'border-cyan-500/10',    icon: 'text-cyan-400',    glow: 'hover:shadow-[0_0_20px_-4px_rgba(34,211,238,0.08)]' },
  violet:  { bg: 'bg-violet-500/[0.05]',  border: 'border-violet-500/10',  icon: 'text-violet-400',  glow: 'hover:shadow-[0_0_20px_-4px_rgba(167,139,250,0.08)]' },
  amber:   { bg: 'bg-amber-500/[0.05]',   border: 'border-amber-500/10',   icon: 'text-amber-400',   glow: 'hover:shadow-[0_0_20px_-4px_rgba(251,191,36,0.08)]' },
  rose:    { bg: 'bg-rose-500/[0.05]',    border: 'border-rose-500/10',    icon: 'text-rose-400',    glow: 'hover:shadow-[0_0_20px_-4px_rgba(251,113,133,0.08)]' },
  blue:    { bg: 'bg-blue-500/[0.05]',    border: 'border-blue-500/10',    icon: 'text-blue-400',    glow: 'hover:shadow-[0_0_20px_-4px_rgba(96,165,250,0.08)]' },
  indigo:  { bg: 'bg-indigo-500/[0.05]',  border: 'border-indigo-500/10',  icon: 'text-indigo-400',  glow: 'hover:shadow-[0_0_20px_-4px_rgba(129,140,248,0.08)]' },
  pink:    { bg: 'bg-pink-500/[0.05]',    border: 'border-pink-500/10',    icon: 'text-pink-400',    glow: 'hover:shadow-[0_0_20px_-4px_rgba(244,114,182,0.08)]' },
  teal:    { bg: 'bg-teal-500/[0.05]',    border: 'border-teal-500/10',    icon: 'text-teal-400',    glow: 'hover:shadow-[0_0_20px_-4px_rgba(45,212,191,0.08)]' },
  orange:  { bg: 'bg-orange-500/[0.05]',  border: 'border-orange-500/10',  icon: 'text-orange-400',  glow: 'hover:shadow-[0_0_20px_-4px_rgba(251,146,60,0.08)]' },
};

const TOOLS = [
  { id: 'product', name: 'Product Research', icon: Search, color: 'emerald', desc: 'Find winning products with demand analysis.', badge: 'Popular', inputs: [{ label: 'Niche or product type', placeholder: 'Wireless earbuds' }] },
  { id: 'competitor', name: 'Competitor Spy', icon: Target, color: 'cyan', desc: 'Analyze competitor pricing and positioning.', badge: null, inputs: [{ label: 'Competitor URL or name', placeholder: 'https://competitor.com' }] },
  { id: 'listing', name: 'Listing Optimizer', icon: Layers, color: 'violet', desc: 'Write high-converting product descriptions.', badge: 'Popular', inputs: [{ label: 'Product info', placeholder: 'Organic protein powder, 2lb, vanilla', type: 'textarea' }] },
  { id: 'ad', name: 'Ad Creator', icon: Megaphone, color: 'amber', desc: 'Generate ad copy and visuals for any platform.', badge: null, inputs: [{ label: 'Product', placeholder: 'Smart fitness watch' }] },
  { id: 'margin', name: 'Margin Calculator', icon: DollarSign, color: 'rose', desc: 'Calculate profit margins and breakeven.', badge: null, inputs: [{ label: 'Product cost', placeholder: '15' }, { label: 'Selling price', placeholder: '49.99' }, { label: 'Shipping cost', placeholder: '5' }] },
  { id: 'email', name: 'Email Sequences', icon: ShoppingBag, color: 'blue', desc: 'Build cart abandonment and nurture flows.', badge: null, inputs: [{ label: 'Product/brand', placeholder: 'Korvix Premium Skincare' }] },
  { id: 'seo', name: 'Shopify SEO', icon: Globe, color: 'indigo', desc: 'Optimize store for search rankings.', badge: 'Popular', inputs: [{ label: 'Store URL', placeholder: 'https://yourstore.com' }] },
  { id: 'tiktok', name: 'TikTok Hooks', icon: Flame, color: 'pink', desc: 'Generate viral product hooks.', badge: 'New', inputs: [{ label: 'Product', placeholder: 'LED desk lamp' }] },
  { id: 'brand', name: 'Brand Builder', icon: Shield, color: 'teal', desc: 'Create brand identity, colors, voice.', badge: null, inputs: [{ label: 'Brand concept', placeholder: 'Sustainable activewear for Gen Z', type: 'textarea' }] },
  { id: 'pricing', name: 'Pricing AI', icon: Award, color: 'orange', desc: 'A/B pricing strategies and elasticity.', badge: null, inputs: [{ label: 'Product + current price', placeholder: 'We charge $29/mo for...', type: 'textarea' }] },
  { id: 'bundle', name: 'Bundle Creator', icon: Package, color: 'green', desc: 'Product bundles that increase AOV.', badge: null, inputs: [{ label: 'Your products', placeholder: 'Shampoo, Conditioner, Hair Mask', type: 'textarea' }] },
  { id: 'trends', name: 'Trend Finder', icon: TrendingUp, color: 'yellow', desc: 'Spot trending products before they peak.', badge: 'New', inputs: [{ label: 'Category or niche', placeholder: 'Pet accessories' }] },
];

export default function EcommerceOS() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  const activeTool = TOOLS.find((t) => t.id === selected);

  const handleSubmit = () => {
    const prompt = activeTool ? `${activeTool.name}: ${Object.values(formValues).join(' | ')}` : '';
    navigate('/chat', { state: { initialPrompt: prompt } });
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">
      <Navigation />

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

          {/* Header */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
            <div className="flex items-center gap-3 mb-4">
              <button onClick={() => navigate('/workspace')} className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
                <ArrowLeft className="h-3 w-3" /> Workspace
              </button>
            </div>
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/[0.08] border border-emerald-500/15">
                <ShoppingCart className="h-5 w-5 text-emerald-400/70" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-white tracking-tight">Ecommerce OS</h1>
                <p className="text-[12px] text-slate-500">From research to revenue</p>
              </div>
            </div>

            {/* Revenue bar */}
            <div className="flex flex-wrap items-center gap-3 sm:gap-4 mt-4">
              {[
                { icon: DollarSign, label: 'Revenue', value: '$24,680', color: 'text-emerald-400' },
                { icon: ShoppingCart, label: 'Orders', value: '1,247', color: 'text-cyan-400' },
                { icon: Users, label: 'Visitors', value: '8.4K', color: 'text-violet-400' },
                { icon: TrendingUp, label: 'Conversion', value: '3.2%', color: 'text-amber-400' },
                { icon: Award, label: 'AOV', value: '$47.20', color: 'text-rose-400' },
              ].map((s, i) => (
                <motion.div key={s.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.04 }}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.01] border border-white/[0.03]">
                  <s.icon className={`h-3 w-3 ${s.color}`} />
                  <span className="text-[12px] font-medium text-white">{s.value}</span>
                  <span className="text-[10px] text-slate-600">{s.label}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>

          <AnimatePresence mode="wait">
            {!selected ? (
              <motion.div key="grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
                {/* Tools Grid */}
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {TOOLS.map((tool, i) => {
                    const c = COLOR_MAP[tool.color] || COLOR_MAP.emerald;
                    return (
                      <motion.button key={tool.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03, duration: 0.35 }}
                        whileHover={{ scale: 1.01, y: -1 }} whileTap={{ scale: 0.99 }}
                        onClick={() => { setSelected(tool.id); setFormValues({}); }}
                        className={`text-left rounded-xl border border-white/[0.03] bg-white/[0.005] p-4 transition-all duration-200 hover:bg-white/[0.015] hover:border-white/[0.06] ${c.glow} group`}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${c.bg} ${c.border} border`}>
                            <tool.icon className={`h-4 w-4 ${c.icon}`} />
                          </div>
                          {tool.badge && (
                            <span className={`text-[9px] font-semibold px-1.5 py-[2px] rounded ${tool.badge === 'Popular' ? 'bg-amber-500/[0.08] text-amber-400/70' : 'bg-emerald-500/[0.08] text-emerald-400/70'}`}>
                              {tool.badge === 'Popular' && <Flame className="h-2.5 w-2.5 inline mr-0.5" />}
                              {tool.badge}
                            </span>
                          )}
                        </div>
                        <h3 className="text-[13px] font-medium text-white mb-1 group-hover:text-slate-200 transition-colors">{tool.name}</h3>
                        <p className="text-[11px] text-slate-600 leading-relaxed">{tool.desc}</p>
                        <div className="flex items-center gap-1 mt-2 text-slate-700 group-hover:text-slate-500 transition-colors">
                          <span className="text-[10px]">Launch</span>
                          <ArrowUpRight className="h-2.5 w-2.5" />
                        </div>
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>
            ) : (
              <motion.div key="tool" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
                <div className="flex items-center gap-3 mb-6">
                  <button onClick={() => setSelected(null)} className="flex items-center gap-1 text-[12px] text-slate-500 hover:text-white transition-colors">
                    <ArrowLeft className="h-3.5 w-3.5" /> Back
                  </button>
                </div>

                {activeTool && (
                  <>
                    <div className="flex items-center gap-3 mb-6">
                      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${(COLOR_MAP[activeTool.color] || COLOR_MAP.emerald).bg} ${(COLOR_MAP[activeTool.color] || COLOR_MAP.emerald).border} border`}>
                        <activeTool.icon className={`h-5 w-5 ${(COLOR_MAP[activeTool.color] || COLOR_MAP.emerald).icon}`} />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold text-white">{activeTool.name}</h2>
                        <p className="text-[12px] text-slate-500">{activeTool.desc}</p>
                      </div>
                    </div>

                    <div className="space-y-4 mb-6">
                      {activeTool.inputs.map((input, i) => (
                        <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
                          <label className="block text-[12px] text-slate-400 mb-1.5">{input.label}</label>
                          {(input as any).type === 'textarea' ? (
                            <textarea value={formValues[i] || ''} onChange={(e) => setFormValues((p) => ({ ...p, [i]: e.target.value }))} placeholder={input.placeholder} rows={4}
                              className="w-full rounded-xl bg-white/[0.015] border border-white/[0.04] p-3 text-[13px] text-white placeholder:text-slate-700 focus:border-cyan-500/20 focus:bg-white/[0.02] outline-none transition-all resize-none" />
                          ) : (
                            <input type="text" value={formValues[i] || ''} onChange={(e) => setFormValues((p) => ({ ...p, [i]: e.target.value }))} placeholder={input.placeholder}
                              className="w-full h-10 rounded-xl bg-white/[0.015] border border-white/[0.04] px-3 text-[13px] text-white placeholder:text-slate-700 focus:border-cyan-500/20 focus:bg-white/[0.02] outline-none transition-all" />
                          )}
                        </motion.div>
                      ))}
                    </div>

                    <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} onClick={handleSubmit}
                      className="w-full h-11 rounded-xl bg-white/[0.06] text-white border border-white/[0.08] text-[13px] hover:bg-white/[0.08] transition-all flex items-center justify-center gap-2"
                    >
                      <Zap className="h-4 w-4" /> Generate with AI
                    </motion.button>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
