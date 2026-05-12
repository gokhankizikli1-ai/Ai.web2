import { useState } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShoppingBag, Search, Package, FileText, Sparkles,
  Camera, DollarSign, Tag,
  Mail, ChevronRight, ArrowRight, Zap, Flame,
  BarChart3,
} from 'lucide-react';
import Navigation from '@/components/Navigation';

const TOOLS = [
  { id: 'product-finder', name: 'Winning Product Finder', icon: Search, color: 'emerald', desc: 'Find trending, high-margin, low-competition products.', badge: 'Popular', inputs: [{ label: 'Niche or category', placeholder: 'Pet accessories, home fitness...', type: 'text' }] },
  { id: 'product-analyzer', name: 'Product Analyzer', icon: Package, color: 'cyan', desc: 'Analyze any product: demand, competition, profit margin.', badge: null, inputs: [{ label: 'Product name or URL', placeholder: 'Wireless earbuds, https://...', type: 'text' }] },
  { id: 'page-generator', name: 'Product Page Generator', icon: FileText, color: 'blue', desc: 'Generate full product page with title, description, and CTA.', badge: null, inputs: [{ label: 'Product name', placeholder: 'Premium Yoga Mat' }, { label: 'Key features', placeholder: 'Non-slip, eco-friendly, extra thick...', type: 'textarea' }] },
  { id: 'ad-copy', name: 'Ad Copy Generator', icon: Sparkles, color: 'violet', desc: 'Create Facebook, Google, TikTok ad copy with hooks.', badge: 'Popular', inputs: [{ label: 'Product name', placeholder: 'Smart Water Bottle' }, { label: 'Target audience', placeholder: 'Fitness enthusiasts aged 25-40', type: 'textarea' }] },
  { id: 'tiktok-hooks', name: 'TikTok Hook Generator', icon: Flame, color: 'rose', desc: 'Generate viral hooks, scripts, and CTAs for TikTok.', badge: 'New', inputs: [{ label: 'Product', placeholder: 'LED Face Mask' }, { label: 'Audience', placeholder: 'Skincare enthusiasts', type: 'textarea' }] },
  { id: 'shopify-seo', name: 'Shopify SEO Optimizer', icon: BarChart3, color: 'indigo', desc: 'Optimize titles, meta descriptions, and keywords.', badge: null, inputs: [{ label: 'Product page URL or content', placeholder: 'https://yourstore.com/products/...', type: 'textarea' }] },
  { id: 'competitor-store', name: 'Competitor Store Scanner', icon: Search, color: 'amber', desc: 'Analyze competitor stores: pricing, products, strategy.', badge: null, inputs: [{ label: 'Store URL', placeholder: 'https://competitor.com', type: 'text' }] },
  { id: 'image-prompts', name: 'AI Image Prompts', icon: Camera, color: 'pink', desc: 'Generate prompts for product photos, banners, and ads.', badge: null, inputs: [{ label: 'Product description', placeholder: 'Minimalist skincare serum, glass bottle...', type: 'textarea' }] },
  { id: 'pricing-optimizer', name: 'Pricing Optimizer', icon: DollarSign, color: 'green', desc: 'Find the best price point for maximum profit.', badge: null, inputs: [{ label: 'Product cost + target margin', placeholder: 'Cost: $5, Target margin: 60%', type: 'textarea' }] },
  { id: 'branding', name: 'Branding Assistant', icon: Tag, color: 'orange', desc: 'Create brand name, tagline, story, and identity.', badge: null, inputs: [{ label: 'What you sell + audience', placeholder: 'Eco-friendly water bottles for hikers', type: 'textarea' }] },
  { id: 'offer-builder', name: 'Offer Builder', icon: Zap, color: 'yellow', desc: 'Design bundles, upsells, and irresistible offers.', badge: null, inputs: [{ label: 'Your products', placeholder: 'Product A ($29), Product B ($49)...', type: 'textarea' }] },
  { id: 'email-campaign', name: 'Email Campaign Generator', icon: Mail, color: 'teal', desc: 'Generate welcome flows, abandoned cart, and promo emails.', badge: null, inputs: [{ label: 'Campaign type + product', placeholder: 'Abandoned cart for wireless earbuds', type: 'textarea' }] },
];

const COLOR_MAP: Record<string, { bg: string; border: string; icon: string; glow: string }> = {
  emerald: { bg: 'bg-emerald-500/[0.05]', border: 'border-emerald-500/10', icon: 'text-emerald-400/60', glow: 'hover:shadow-[0_0_20px_-4px_rgba(52,211,153,0.08)]' },
  cyan:    { bg: 'bg-cyan-500/[0.05]',    border: 'border-cyan-500/10',    icon: 'text-cyan-400/60',    glow: 'hover:shadow-[0_0_20px_-4px_rgba(34,211,238,0.08)]' },
  blue:    { bg: 'bg-blue-500/[0.05]',    border: 'border-blue-500/10',    icon: 'text-blue-400/60',    glow: 'hover:shadow-[0_0_20px_-4px_rgba(96,165,250,0.08)]' },
  violet:  { bg: 'bg-violet-500/[0.05]',  border: 'border-violet-500/10',  icon: 'text-violet-400/60',  glow: 'hover:shadow-[0_0_20px_-4px_rgba(167,139,250,0.08)]' },
  rose:    { bg: 'bg-rose-500/[0.05]',    border: 'border-rose-500/10',    icon: 'text-rose-400/60',    glow: 'hover:shadow-[0_0_20px_-4px_rgba(251,113,133,0.08)]' },
  indigo:  { bg: 'bg-indigo-500/[0.05]',  border: 'border-indigo-500/10',  icon: 'text-indigo-400/60',  glow: 'hover:shadow-[0_0_20px_-4px_rgba(129,140,248,0.08)]' },
  amber:   { bg: 'bg-amber-500/[0.05]',   border: 'border-amber-500/10',   icon: 'text-amber-400/60',   glow: 'hover:shadow-[0_0_20px_-4px_rgba(251,191,36,0.08)]' },
  pink:    { bg: 'bg-pink-500/[0.05]',    border: 'border-pink-500/10',    icon: 'text-pink-400/60',    glow: 'hover:shadow-[0_0_20px_-4px_rgba(244,114,182,0.08)]' },
  green:   { bg: 'bg-green-500/[0.05]',   border: 'border-green-500/10',   icon: 'text-green-400/60',   glow: 'hover:shadow-[0_0_20px_-4px_rgba(74,222,128,0.08)]' },
  orange:  { bg: 'bg-orange-500/[0.05]',  border: 'border-orange-500/10',  icon: 'text-orange-400/60',  glow: 'hover:shadow-[0_0_20px_-4px_rgba(251,146,60,0.08)]' },
  yellow:  { bg: 'bg-yellow-500/[0.05]',   border: 'border-yellow-500/10',   icon: 'text-yellow-400/60',   glow: 'hover:shadow-[0_0_20px_-4px_rgba(250,204,21,0.08)]' },
  teal:    { bg: 'bg-teal-500/[0.05]',    border: 'border-teal-500/10',    icon: 'text-teal-400/60',    glow: 'hover:shadow-[0_0_20px_-4px_rgba(45,212,191,0.08)]' },
};

export default function EcommerceOS() {
  const navigate = useNavigate();
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  const activeTool = TOOLS.find((t) => t.id === selectedTool);

  // Pre-fill the chat composer with the tool's form content so the user
  // lands in chat with a ready-to-send prompt, not a blank input.
  const handleGenerate = () => {
    const filled = Object.values(formValues).map((v) => v.trim()).filter(Boolean);
    if (!activeTool || filled.length === 0) {
      navigate('/chat');
      return;
    }
    const labels = (activeTool.inputs || []).map((i) => i.label);
    const lines  = filled.map((v, i) => labels[i] ? `${labels[i]}: ${v}` : v);
    const prompt = `[${activeTool.name}]\n${lines.join('\n')}`;
    navigate('/chat', { state: { prompt } });
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <Navigation />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-6 pb-12">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/[0.08] border border-emerald-500/15">
              <ShoppingBag className="h-5 w-5 text-emerald-400/70" />
            </div>
            <div>
              <h1 className="text-[22px] sm:text-[26px] font-semibold tracking-tight">Ecommerce OS</h1>
              <p className="text-[13px] text-slate-500">AI command center for Shopify dropshipping, product research, and scaling.</p>
            </div>
          </div>
        </motion.div>

        <AnimatePresence mode="wait">
          {!selectedTool && (
            <motion.div key="grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {TOOLS.map((tool, i) => {
                const c = COLOR_MAP[tool.color] || COLOR_MAP.emerald;
                return (
                  <motion.button key={tool.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04, duration: 0.35 }}
                    onClick={() => { setSelectedTool(tool.id); setFormValues({}); }}
                    className={`text-left rounded-xl border border-white/[0.03] bg-white/[0.005] p-4 transition-all duration-200 hover:bg-white/[0.01] hover:border-white/[0.06] ${c.glow} group`}>
                    <div className="flex items-start justify-between mb-3">
                      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${c.bg} border ${c.border}`}>
                        <tool.icon className={`h-4 w-4 ${c.icon}`} />
                      </div>
                      {tool.badge && <span className={`text-[9px] font-semibold px-1.5 py-[2px] rounded ${tool.badge === 'Popular' ? 'bg-emerald-500/[0.08] text-emerald-400/70' : 'bg-cyan-500/[0.08] text-cyan-400/70'}`}>{tool.badge === 'Popular' && <Flame className="h-2.5 w-2.5 inline mr-0.5" />}{tool.badge}</span>}
                    </div>
                    <h3 className="text-[13px] font-medium text-slate-300 group-hover:text-white transition-colors mb-1">{tool.name}</h3>
                    <p className="text-[11px] text-slate-600 leading-relaxed">{tool.desc}</p>
                    <div className="flex items-center gap-1 mt-3 text-[11px] text-slate-700 group-hover:text-emerald-400/60 transition-colors">Launch <ArrowRight className="h-3 w-3" /></div>
                  </motion.button>
                );
              })}
            </motion.div>
          )}

          {selectedTool && activeTool && (
            <motion.div key="detail" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.25 }} className="max-w-xl mx-auto">
              <button onClick={() => setSelectedTool(null)} className="text-[12px] text-slate-600 hover:text-slate-400 transition-colors mb-4 flex items-center gap-1"><ChevronRight className="h-3 w-3 rotate-180" /> Back</button>
              <div className="rounded-xl border border-white/[0.04] bg-white/[0.005] p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${COLOR_MAP[activeTool.color]?.bg || ''} border ${COLOR_MAP[activeTool.color]?.border || ''}`}>
                    <activeTool.icon className={`h-5 w-5 ${COLOR_MAP[activeTool.color]?.icon || ''}`} />
                  </div>
                  <div>
                    <h2 className="text-[16px] font-semibold text-white">{activeTool.name}</h2>
                    <p className="text-[12px] text-slate-500">{activeTool.desc}</p>
                  </div>
                </div>
                <div className="space-y-4">
                  {activeTool.inputs.map((input, i) => (
                    <div key={i}>
                      <label className="text-[12px] text-slate-400 mb-1.5 block">{input.label}</label>
                      {input.type === 'textarea' ? (
                        <textarea value={formValues[`input-${i}`] || ''} onChange={(e) => setFormValues((p) => ({ ...p, [`input-${i}`]: e.target.value }))} placeholder={input.placeholder} rows={4}
                          className="w-full rounded-lg bg-white/[0.02] border border-white/[0.05] px-3.5 py-2.5 text-[13px] text-white placeholder:text-slate-700 outline-none focus:border-emerald-500/20 resize-none transition-colors" />
                      ) : (
                        <input type="text" value={formValues[`input-${i}`] || ''} onChange={(e) => setFormValues((p) => ({ ...p, [`input-${i}`]: e.target.value }))} placeholder={input.placeholder}
                          className="w-full rounded-lg bg-white/[0.02] border border-white/[0.05] px-3.5 py-2.5 text-[13px] text-white placeholder:text-slate-700 outline-none focus:border-emerald-500/20 transition-colors" />
                      )}
                    </div>
                  ))}
                  <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} onClick={handleGenerate}
                    className="w-full h-10 rounded-lg bg-emerald-500/[0.08] hover:bg-emerald-500/[0.12] border border-emerald-500/15 text-emerald-400 text-[13px] font-medium transition-all flex items-center justify-center gap-2 mt-2">
                    <Sparkles className="h-4 w-4" /> Generate with AI
                  </motion.button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
