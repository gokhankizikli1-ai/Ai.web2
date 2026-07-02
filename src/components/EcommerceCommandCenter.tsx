import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ShoppingCart, Search, TrendingUp, Sparkles, BarChart3,
  Megaphone, Layout, ExternalLink, Lock, ChevronRight,
  Zap, Target, DollarSign, Package,
  Check,
  Smartphone, Share2, Palette, Type, FileText,
  Wand2, RefreshCw,
  Download, Play,
} from 'lucide-react';

/* ═══════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════ */

type ToolView = 'dashboard' | 'product-research' | 'store-builder' | 'shopify' | 'tiktok' | 'meta-ads' | 'pricing' | 'analytics';

interface ProductCard {
  name: string;
  category: string;
  trendScore: number;
  saturation: number;
  margin: number;
  viral: number;
  competitor: number;
  audience: number;
  verdict: 'Test' | 'Watch' | 'Avoid';
  price: string;
  description: string;
}

interface HookOutput {
  hook3s: string[];
  ugcScript: string;
  problemSolution: string;
  ctas: string[];
  structure: string[];
}

interface AdOutput {
  primaryTexts: string[];
  headlines: string[];
  descriptions: string[];
  ctas: string[];
  audiences: string[];
  creatives: string[];
}

/* ═══════════════════════════════════════════
   MOCK DATA
   ═══════════════════════════════════════════ */

const MOCK_PRODUCTS: ProductCard[] = [
  { name: 'Posture Corrector', category: 'Health', trendScore: 82, saturation: 65, margin: 45, viral: 70, competitor: 60, audience: 88, verdict: 'Test', price: '$24.99', description: 'Adjustable back brace for office workers and gamers' },
  { name: 'LED Makeup Mirror', category: 'Beauty', trendScore: 91, saturation: 35, margin: 62, viral: 85, competitor: 40, audience: 92, verdict: 'Test', price: '$34.99', description: 'Touch-screen vanity mirror with 3-color lighting' },
  { name: 'Pet Grooming Glove', category: 'Pets', trendScore: 76, saturation: 55, margin: 58, viral: 90, competitor: 50, audience: 85, verdict: 'Test', price: '$14.99', description: 'Deshedding brush glove for cats and dogs' },
  { name: 'Portable Blender', category: 'Kitchen', trendScore: 88, saturation: 72, margin: 38, viral: 78, competitor: 75, audience: 80, verdict: 'Watch', price: '$29.99', description: 'USB rechargeable mini blender for smoothies' },
  { name: 'Smart Garden Hub', category: 'Home', trendScore: 94, saturation: 20, margin: 55, viral: 72, competitor: 25, audience: 75, verdict: 'Test', price: '$49.99', description: ' Indoor hydroponic system with app control' },
  { name: 'Compression Socks', category: 'Health', trendScore: 68, saturation: 85, margin: 30, viral: 45, competitor: 90, audience: 70, verdict: 'Avoid', price: '$19.99', description: 'Graduated compression for athletes and travelers' },
];

const NICHE_OPTIONS = ['All Niches', 'Health', 'Beauty', 'Pets', 'Kitchen', 'Home', 'Fitness', 'Tech', 'Fashion'];

/* ═══════════════════════════════════════════
   SCORE BAR
   ═══════════════════════════════════════════ */

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[9px] text-[#858B99] w-16 shrink-0">{label}</span>
      <div className="flex-1 h-1 bg-white/[0.03] rounded-full overflow-hidden">
        <motion.div className={`h-full rounded-full ${color}`} initial={{ width: 0 }} animate={{ width: `${value}%` }} transition={{ duration: 0.6 }} />
      </div>
      <span className="text-[9px] text-white/50 w-6 text-right tabular-nums">{value}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════
   VERDICT BADGE
   ═══════════════════════════════════════════ */

function VerdictBadge({ verdict }: { verdict: 'Test' | 'Watch' | 'Avoid' }) {
  const config = {
    Test:   { bg: 'bg-[#4ADE80]/[0.08]', text: 'text-[#4ADE80]', border: 'border-[#4ADE80]/15', dot: 'bg-[#4ADE80]' },
    Watch:  { bg: 'bg-[#FACC15]/[0.08]', text: 'text-[#FACC15]', border: 'border-[#FACC15]/15', dot: 'bg-[#FACC15]' },
    Avoid:  { bg: 'bg-[#F87171]/[0.08]', text: 'text-[#F87171]', border: 'border-[#F87171]/15', dot: 'bg-[#F87171]' },
  };
  const c = config[verdict];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-semibold ${c.bg} ${c.text} border ${c.border}`}>
      <span className={`w-1 h-1 rounded-full ${c.dot}`} />
      {verdict}
    </span>
  );
}

/* ═══════════════════════════════════════════
   TOOL CARD
   ═══════════════════════════════════════════ */

function ToolCard({ icon: Icon, title, desc, color, onClick, badge }: {
  icon: React.ElementType; title: string; desc: string; color: string; onClick: () => void; badge?: string;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="group w-full text-left rounded-xl border border-white/[0.04] bg-white/[0.015] p-3.5 hover:border-white/[0.08] hover:bg-white/[0.025] transition-all duration-200"
    >
      <div className="flex items-start justify-between mb-2">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>
          <Icon className="h-4 w-4 text-white" />
        </div>
        {badge && (
          <span className="px-1.5 py-0.5 rounded text-[8px] font-medium bg-white/[0.04] text-[#858B99] border border-white/[0.04]">{badge}</span>
        )}
      </div>
      <h3 className="text-[12px] font-semibold text-white/90 mb-0.5">{title}</h3>
      <p className="text-[10px] text-[#858B99] leading-relaxed">{desc}</p>
      <div className="flex items-center gap-1 mt-2 text-[9px] text-[#A78BFA]/50 group-hover:text-[#A78BFA]/70 transition-colors">
        <span>Open</span>
        <ChevronRight className="h-3 w-3" />
      </div>
    </motion.button>
  );
}

/* ═══════════════════════════════════════════
   SECTION HEADER
   ═══════════════════════════════════════════ */

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-[14px] font-semibold text-white/90">{title}</h2>
      {subtitle && <p className="text-[10px] text-[#858B99] mt-0.5">{subtitle}</p>}
    </div>
  );
}

/* ═══════════════════════════════════════════
   BACK BUTTON
   ═══════════════════════════════════════════ */

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-[11px] text-[#858B99] hover:text-white/60 transition-colors mb-3">
      <ChevronRight className="h-3 w-3 rotate-180" />
      Back to Dashboard
    </button>
  );
}

/* ═══════════════════════════════════════════
   ═══ DASHBOARD ═══
   ═══════════════════════════════════════════ */

function Dashboard({ onTool }: { onTool: (t: ToolView) => void }) {
  return (
    <div className="space-y-5">
      {/* Header */}
      <SectionHeader title="Ecommerce Command Center" subtitle="AI-powered tools to research, build, and scale your store" />

      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Products Researched', value: '12', icon: Package, color: 'from-[#A78BFA]/20 to-[#A78BFA]/20' },
          { label: 'Hooks Generated', value: '48', icon: Sparkles, color: 'from-[#A78BFA]/20 to-[#A78BFA]/20' },
          { label: 'Ad Sets Created', value: '6', icon: Megaphone, color: 'from-[#FACC15]/20 to-[#FACC15]/20' },
          { label: 'Store Health', value: '--', icon: BarChart3, color: 'from-[#4ADE80]/20 to-[#A78BFA]/20' },
        ].map((s) => (
          <div key={s.label} className="p-3 rounded-xl border border-white/[0.03] bg-white/[0.01]">
            <div className="flex items-center gap-2 mb-1.5">
              <div className={`flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br ${s.color}`}>
                <s.icon className="h-2.5 w-2.5 text-white/70" />
              </div>
              <span className="text-[9px] text-[#858B99]">{s.label}</span>
            </div>
            <p className="text-[18px] font-semibold text-white/90 tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tools Grid */}
      <div>
        <SectionHeader title="Tools" subtitle="Select a tool to get started" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <ToolCard icon={Search} title="Product Research" desc="Find winning products with AI-powered trend analysis, saturation scores, and margin estimates." color="bg-gradient-to-br from-[#A78BFA] to-[#A78BFA]" onClick={() => onTool('product-research')} />
          <ToolCard icon={Layout} title="AI Store Builder" desc="Generate complete Shopify store sections — hero, product grid, reviews, FAQ, and trust badges." color="bg-gradient-to-br from-[#A78BFA] to-[#A78BFA]" onClick={() => onTool('store-builder')} />
          <ToolCard icon={ShoppingCart} title="Shopify Connect" desc="Connect your store, sync products, and manage everything from one dashboard." color="bg-gradient-to-br from-[#4ADE80] to-[#A78BFA]" onClick={() => onTool('shopify')} badge="Coming soon" />
          <ToolCard icon={Sparkles} title="TikTok Hooks" desc="Generate viral hooks, UGC scripts, and short-form video structures for any product." color="bg-gradient-to-br from-[#A78BFA] to-[#F87171]" onClick={() => onTool('tiktok')} />
          <ToolCard icon={Megaphone} title="Meta Ads Builder" desc="Create high-converting Facebook & Instagram ads with AI-generated copy and targeting." color="bg-gradient-to-br from-[#FACC15] to-[#FACC15]" onClick={() => onTool('meta-ads')} />
          <ToolCard icon={DollarSign} title="Pricing Optimizer" desc="Calculate optimal pricing, margins, break-even ROAS, and upsell suggestions." color="bg-gradient-to-br from-[#A78BFA] to-[#A78BFA]" onClick={() => onTool('pricing')} />
          <ToolCard icon={BarChart3} title="Store Analytics" desc="Track revenue, orders, conversion rate, AOV, ROAS, and CPA." color="bg-gradient-to-br from-[#4ADE80] to-[#4ADE80]" onClick={() => onTool('analytics')} badge="Connect Shopify" />
          <ToolCard icon={Target} title="Product Page Analyzer" desc="Analyze your product pages for conversion optimization and get AI recommendations." color="bg-gradient-to-br from-[#A78BFA] to-[#A78BFA]" onClick={() => onTool('product-research')} />
        </div>
      </div>

      {/* Multi-Agent Workflow */}
      <div>
        <SectionHeader title="Multi-Agent Ecommerce Workflow" subtitle="Your AI agents work together to build and scale your store" />
        <div className="p-4 rounded-xl border border-white/[0.04] bg-white/[0.01] space-y-3">
          {[
            { icon: Search, name: 'Product Research Agent', desc: 'Finds trending products with winning potential', color: 'from-[#A78BFA] to-[#A78BFA]', status: 'active' },
            { icon: Layout, name: 'Store Builder Agent', desc: 'Creates optimized store pages and sections', color: 'from-[#A78BFA] to-[#A78BFA]', status: 'active' },
            { icon: Sparkles, name: 'Ads Creator Agent', desc: 'Generates TikTok hooks and Meta ad campaigns', color: 'from-[#A78BFA] to-[#F87171]', status: 'standby' },
            { icon: DollarSign, name: 'Pricing Agent', desc: 'Optimizes margins, pricing, and upsell strategy', color: 'from-[#A78BFA] to-[#A78BFA]', status: 'standby' },
          ].map((agent, i) => (
            <div key={agent.name} className="flex items-center gap-3">
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${agent.color} shrink-0`}>
                <agent.icon className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium text-white/80">{agent.name}</span>
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-medium ${agent.status === 'active' ? 'bg-[#4ADE80]/[0.08] text-[#4ADE80]' : 'bg-slate-500/[0.06] text-[#B6BBC6]'}`}>
                    {agent.status === 'active' && <span className="w-1 h-1 rounded-full bg-[#4ADE80]" />}
                    {agent.status}
                  </span>
                </div>
                <p className="text-[10px] text-[#858B99]">{agent.desc}</p>
              </div>
              {i < 3 && <div className="hidden sm:block absolute left-5 translate-y-6 w-px h-3 bg-white/[0.04]" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   ═══ PRODUCT RESEARCH ═══
   ═══════════════════════════════════════════ */

function ProductResearch({ onBack }: { onBack: () => void }) {
  const [search, setSearch] = useState('');
  const [niche, setNiche] = useState('All Niches');
  const [selectedProduct, setSelectedProduct] = useState<ProductCard | null>(null);

  const filtered = useMemo(() => {
    let p = MOCK_PRODUCTS;
    if (niche !== 'All Niches') p = p.filter(x => x.category === niche);
    if (search) p = p.filter(x => x.name.toLowerCase().includes(search.toLowerCase()));
    return p;
  }, [search, niche]);

  return (
    <div>
      <BackButton onClick={onBack} />
      <SectionHeader title="Product Research" subtitle="AI-analyzed products with trend scores and recommendations" />

      {/* Search + Filter */}
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#858B99]" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products..."
            className="w-full h-8 pl-9 pr-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[12px] text-white placeholder:text-[#858B99] outline-none focus:border-white/[0.08]" />
        </div>
        <select value={niche} onChange={e => setNiche(e.target.value)}
          className="h-8 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[11px] text-white outline-none focus:border-white/[0.08]">
          {NICHE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {/* Product Grid */}
      <div className="grid grid-cols-1 gap-2.5">
        <AnimatePresence>
          {filtered.map((product) => (
            <motion.div
              key={product.name}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-3.5 cursor-pointer hover:border-white/[0.08] hover:bg-white/[0.025] transition-all"
              onClick={() => setSelectedProduct(selectedProduct?.name === product.name ? null : product)}
            >
              <div className="flex items-start justify-between mb-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.03] border border-white/[0.05]">
                    <Package className="h-4 w-4 text-[#B6BBC6]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-[13px] font-semibold text-white/90">{product.name}</h3>
                      <VerdictBadge verdict={product.verdict} />
                    </div>
                    <p className="text-[10px] text-[#858B99]">{product.category} · {product.price}</p>
                  </div>
                </div>
                <div className="text-right">
                  <div className="flex items-center gap-1">
                    <TrendingUp className="h-3 w-3 text-[#4ADE80]/60" />
                    <span className="text-[14px] font-semibold text-[#4ADE80]">{product.trendScore}</span>
                  </div>
                  <p className="text-[8px] text-[#858B99]">Trend Score</p>
                </div>
              </div>

              <p className="text-[11px] text-[#B6BBC6] mb-2.5">{product.description}</p>

              {/* Score Bars */}
              <div className="space-y-1.5 mb-2.5">
                <ScoreBar label="Saturation" value={product.saturation} color="bg-[#FACC15]" />
                <ScoreBar label="Est. Margin" value={product.margin} color="bg-[#4ADE80]" />
                <ScoreBar label="Viral Pot." value={product.viral} color="bg-[#A78BFA]" />
                <ScoreBar label="Competitor" value={product.competitor} color="bg-[#F87171]" />
                <ScoreBar label="Audience" value={product.audience} color="bg-[#A78BFA]" />
              </div>

              {/* Expanded */}
              <AnimatePresence>
                {selectedProduct?.name === product.name && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="pt-2.5 border-t border-white/[0.03] space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="p-2 rounded-lg bg-[#4ADE80]/[0.04] border border-[#4ADE80]/10 text-center">
                          <p className="text-[9px] text-[#4ADE80]/60">Est. Margin</p>
                          <p className="text-[13px] font-semibold text-[#4ADE80]">{product.margin}%</p>
                        </div>
                        <div className="p-2 rounded-lg bg-[#A78BFA]/[0.04] border border-[#A78BFA]/10 text-center">
                          <p className="text-[9px] text-[#A78BFA]/60">Sell Price</p>
                          <p className="text-[13px] font-semibold text-[#A78BFA]">{product.price}</p>
                        </div>
                        <div className="p-2 rounded-lg bg-[#A78BFA]/[0.04] border border-[#A78BFA]/10 text-center">
                          <p className="text-[9px] text-[#A78BFA]/60">Viral Score</p>
                          <p className="text-[13px] font-semibold text-[#A78BFA]">{product.viral}/100</p>
                        </div>
                      </div>
                      <p className="text-[10px] text-[#858B99]">
                        <Zap className="h-2.5 w-2.5 inline mr-1 text-[#FACC15]/50" />
                        AI Recommendation: {product.verdict === 'Test' ? 'Strong potential. Low saturation with high margin. Consider testing with a small ad budget.' : product.verdict === 'Watch' ? 'Moderate potential. High trend but watch saturation levels.' : 'High competition and low margins. Consider a different product or niche.'}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-8">
          <Search className="h-8 w-8 text-white/[0.05] mx-auto mb-2" />
          <p className="text-[12px] text-[#858B99]">No products found</p>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   ═══ TIKTOK HOOKS ═══
   ═══════════════════════════════════════════ */

function TikTokHooks({ onBack }: { onBack: () => void }) {
  const [product, setProduct] = useState('');
  const [audience, setAudience] = useState('');
  const [painPoint, setPainPoint] = useState('');
  const [tone, setTone] = useState('energetic');
  const [output, setOutput] = useState<HookOutput | null>(null);
  const [generating, setGenerating] = useState(false);

  const generate = () => {
    if (!product.trim()) return;
    setGenerating(true);
    setTimeout(() => {
      setOutput({
        hook3s: [
          `POV: You finally found a ${product} that actually works`,
          `Stop wasting money on ${product}s that break in a week`,
          `This ${product} changed my life and I need to tell you why`,
        ],
        ugcScript: `Hook (0-3s): Show the problem dramatically\nSetup (3-10s): "I tried 5 different ${product}s before finding this one..."\nReveal (10-20s): Show the product in action, transformation\nCTA (20-30s): "Link in bio — use code TIKTOK20 for 20% off"`,
        problemSolution: `Problem: ${painPoint || `Finding a reliable ${product}`}\nAgitation: "Most ${product}s are overpriced and break within weeks"\nSolution: "This ${product} is built differently — here's why..."`,
        ctas: [`Shop ${product} now — link in bio`, `Limited stock — grab yours today`, `Use code TIKTOK20 for 20% off`],
        structure: ['0-1s: Pattern interrupt (visual shock)', '1-3s: Hook statement', '3-8s: Relatable problem setup', '8-18s: Product reveal + demo', '18-25s: Social proof / results', '25-30s: Strong CTA'],
      });
      setGenerating(false);
    }, 1200);
  };

  const tones = ['energetic', 'calm', 'funny', 'dramatic', 'educational'];

  return (
    <div>
      <BackButton onClick={onBack} />
      <SectionHeader title="TikTok Hook Generator" subtitle="Create viral hooks and UGC scripts for your products" />

      {/* Inputs */}
      <div className="space-y-2.5 mb-4">
        <div>
          <label className="text-[10px] text-[#858B99] mb-1 block">Product Name</label>
          <input value={product} onChange={e => setProduct(e.target.value)} placeholder="e.g. posture corrector"
            className="w-full h-8 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[12px] text-white placeholder:text-[#858B99] outline-none focus:border-white/[0.08]" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-[#858B99] mb-1 block">Target Audience</label>
            <input value={audience} onChange={e => setAudience(e.target.value)} placeholder="e.g. office workers"
              className="w-full h-8 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[12px] text-white placeholder:text-[#858B99] outline-none focus:border-white/[0.08]" />
          </div>
          <div>
            <label className="text-[10px] text-[#858B99] mb-1 block">Pain Point</label>
            <input value={painPoint} onChange={e => setPainPoint(e.target.value)} placeholder="e.g. back pain"
              className="w-full h-8 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[12px] text-white placeholder:text-[#858B99] outline-none focus:border-white/[0.08]" />
          </div>
        </div>
        <div>
          <label className="text-[10px] text-[#858B99] mb-1 block">Tone</label>
          <div className="flex gap-1 flex-wrap">
            {tones.map(t => (
              <button key={t} onClick={() => setTone(t)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all ${tone === t ? 'bg-[#A78BFA]/[0.12] text-[#A78BFA] border border-[#A78BFA]/20' : 'text-[#858B99] border border-white/[0.04] hover:text-[#B6BBC6]'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={generate}
          disabled={!product.trim() || generating}
          className="w-full h-9 rounded-xl text-[12px] font-semibold text-white transition-all disabled:opacity-30 hover:brightness-110"
          style={{ background: 'linear-gradient(135deg, #A78BFA, #A78BFA)', boxShadow: '0 4px 16px rgba(139, 92, 246,0.15)' }}>
          {generating ? <RefreshCw className="h-4 w-4 animate-spin mx-auto" /> : <><Sparkles className="h-3.5 w-3.5 inline mr-1.5" />Generate Hooks</>}
        </button>
      </div>

      {/* Output */}
      <AnimatePresence>
        {output && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            {/* 3-Second Hooks */}
            <div className="p-3.5 rounded-xl border border-[#A78BFA]/10 bg-[#A78BFA]/[0.03]">
              <h4 className="text-[11px] font-semibold text-[#A78BFA]/80 mb-2 flex items-center gap-1.5">
                <Play className="h-3 w-3" /> 3-Second Hooks
              </h4>
              {output.hook3s.map((h, i) => (
                <div key={i} className="flex items-start gap-2 py-1.5 border-b border-white/[0.02] last:border-0">
                  <span className="text-[9px] text-[#A78BFA]/40 mt-0.5 shrink-0">{i + 1}</span>
                  <p className="text-[11px] text-white/70">{h}</p>
                </div>
              ))}
            </div>

            {/* UGC Script */}
            <div className="p-3.5 rounded-xl border border-white/[0.04] bg-white/[0.015]">
              <h4 className="text-[11px] font-semibold text-white/70 mb-2 flex items-center gap-1.5">
                <Smartphone className="h-3 w-3 text-[#A78BFA]" /> UGC Script
              </h4>
              <pre className="text-[10px] text-[#B6BBC6] leading-relaxed whitespace-pre-wrap">{output.ugcScript}</pre>
            </div>

            {/* Problem/Solution */}
            <div className="p-3.5 rounded-xl border border-white/[0.04] bg-white/[0.015]">
              <h4 className="text-[11px] font-semibold text-white/70 mb-2 flex items-center gap-1.5">
                <Target className="h-3 w-3 text-[#A78BFA]" /> Problem / Solution Angle
              </h4>
              <pre className="text-[10px] text-[#B6BBC6] leading-relaxed whitespace-pre-wrap">{output.problemSolution}</pre>
            </div>

            {/* CTAs */}
            <div className="p-3.5 rounded-xl border border-white/[0.04] bg-white/[0.015]">
              <h4 className="text-[11px] font-semibold text-white/70 mb-2 flex items-center gap-1.5">
                <Zap className="h-3 w-3 text-[#FACC15]" /> CTA Ideas
              </h4>
              {output.ctas.map((c, i) => (
                <p key={i} className="text-[10px] text-[#B6BBC6] py-0.5">{i + 1}. {c}</p>
              ))}
            </div>

            {/* Structure */}
            <div className="p-3.5 rounded-xl border border-white/[0.04] bg-white/[0.015]">
              <h4 className="text-[11px] font-semibold text-white/70 mb-2 flex items-center gap-1.5">
                <Share2 className="h-3 w-3 text-[#4ADE80]" /> Video Structure
              </h4>
              {output.structure.map((s, i) => (
                <p key={i} className="text-[10px] text-[#B6BBC6] py-0.5">{s}</p>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════════════════════════
   ═══ META ADS BUILDER ═══
   ═══════════════════════════════════════════ */

function MetaAdsBuilder({ onBack }: { onBack: () => void }) {
  const [product, setProduct] = useState('');
  const [audience, setAudience] = useState('');
  const [benefit, setBenefit] = useState('');
  const [output, setOutput] = useState<AdOutput | null>(null);
  const [generating, setGenerating] = useState(false);

  const generate = () => {
    if (!product.trim()) return;
    setGenerating(true);
    setTimeout(() => {
      setOutput({
        primaryTexts: [
          `Tired of ${audience || 'dealing with'} the same old problems? This ${product} is the upgrade you've been waiting for. ${benefit || 'See the difference'} in just 7 days — or your money back.`,
          `The ${product} that ${benefit || 'actually works'}. Over 10,000 ${audience || 'happy customers'} can't be wrong. Try it risk-free today.`,
        ],
        headlines: [
          `${product} — ${benefit || 'That Actually Works'}`,
          `Finally: A ${product} Worth Your Money`,
          `10,000+ ${audience || 'People'} Swear By This ${product}`,
        ],
        descriptions: [
          `Premium ${product} designed for ${audience || 'everyday use'}. Free shipping. 30-day guarantee.`,
          `The last ${product} you'll ever need to buy. ${benefit || 'Proven results'}. Shop now.`,
        ],
        ctas: ['Shop Now', 'Learn More', 'Get Yours'],
        audiences: [`${audience || 'General'} 18-45`, `Lookalike: Purchasers of ${product}`, `Interest: ${product} + related`],
        creatives: ['Carousel: Product shots + lifestyle', 'Video: 15s demo / transformation', 'Single image: Bold headline + product', 'Collection: Full catalog browse'],
      });
      setGenerating(false);
    }, 1200);
  };

  return (
    <div>
      <BackButton onClick={onBack} />
      <SectionHeader title="Meta Ads Builder" subtitle="Generate Facebook & Instagram ad campaigns with AI" />

      {/* Inputs */}
      <div className="space-y-2.5 mb-4">
        <div>
          <label className="text-[10px] text-[#858B99] mb-1 block">Product Name</label>
          <input value={product} onChange={e => setProduct(e.target.value)} placeholder="e.g. LED makeup mirror"
            className="w-full h-8 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[12px] text-white placeholder:text-[#858B99] outline-none focus:border-white/[0.08]" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-[#858B99] mb-1 block">Target Audience</label>
            <input value={audience} onChange={e => setAudience(e.target.value)} placeholder="e.g. women 25-40"
              className="w-full h-8 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[12px] text-white placeholder:text-[#858B99] outline-none focus:border-white/[0.08]" />
          </div>
          <div>
            <label className="text-[10px] text-[#858B99] mb-1 block">Key Benefit</label>
            <input value={benefit} onChange={e => setBenefit(e.target.value)} placeholder="e.g. flawless lighting"
              className="w-full h-8 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[12px] text-white placeholder:text-[#858B99] outline-none focus:border-white/[0.08]" />
          </div>
        </div>
        <button
          onClick={generate}
          disabled={!product.trim() || generating}
          className="w-full h-9 rounded-xl text-[12px] font-semibold text-white transition-all disabled:opacity-30 hover:brightness-110"
          style={{ background: 'linear-gradient(135deg, #FACC15, #FACC15)', boxShadow: '0 4px 16px rgba(194, 161, 90,0.15)' }}>
          {generating ? <RefreshCw className="h-4 w-4 animate-spin mx-auto" /> : <><Megaphone className="h-3.5 w-3.5 inline mr-1.5" />Generate Ad Campaign</>}
        </button>
      </div>

      {/* Output */}
      <AnimatePresence>
        {output && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
            {[
              { title: 'Primary Text', items: output.primaryTexts, icon: FileText as React.ElementType, color: 'text-[#FACC15]', border: 'border-[#FACC15]/10', bg: 'bg-[#FACC15]/[0.03]' },
              { title: 'Headlines', items: output.headlines, icon: Type as React.ElementType, color: 'text-[#A78BFA]', border: 'border-[#A78BFA]/10', bg: 'bg-[#A78BFA]/[0.03]' },
              { title: 'Descriptions', items: output.descriptions, icon: FileText as React.ElementType, color: 'text-[#A78BFA]', border: 'border-[#A78BFA]/10', bg: 'bg-[#A78BFA]/[0.03]' },
            ].map((section) => (
              <div key={section.title} className={`p-3.5 rounded-xl border ${section.border} ${section.bg}`}>
                <h4 className={`text-[11px] font-semibold ${section.color} mb-2 flex items-center gap-1.5`}>
                  <section.icon className="h-3 w-3" /> {section.title}
                </h4>
                {section.items.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 py-1.5 border-b border-white/[0.02] last:border-0">
                    <span className="text-[9px] text-white/20 mt-0.5 shrink-0">{String(i + 1).padStart(2, '0')}</span>
                    <p className="text-[11px] text-white/70">{item}</p>
                  </div>
                ))}
              </div>
            ))}

            {/* CTAs + Audiences + Creatives */}
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2.5 rounded-lg bg-white/[0.015] border border-white/[0.04]">
                <p className="text-[9px] text-[#858B99] mb-1">CTA Buttons</p>
                {output.ctas.map((c, i) => <p key={i} className="text-[10px] text-[#4ADE80]/80 py-0.5">{c}</p>)}
              </div>
              <div className="p-2.5 rounded-lg bg-white/[0.015] border border-white/[0.04]">
                <p className="text-[9px] text-[#858B99] mb-1">Audiences</p>
                {output.audiences.map((a, i) => <p key={i} className="text-[10px] text-[#A78BFA]/80 py-0.5">{a}</p>)}
              </div>
              <div className="p-2.5 rounded-lg bg-white/[0.015] border border-white/[0.04]">
                <p className="text-[9px] text-[#858B99] mb-1">Creative Formats</p>
                {output.creatives.map((c, i) => <p key={i} className="text-[10px] text-[#A78BFA]/80 py-0.5">{c}</p>)}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════════════════════════
   ═══ STORE BUILDER ═══
   ═══════════════════════════════════════════ */

function StoreBuilder({ onBack }: { onBack: () => void }) {
  const [prompt, setPrompt] = useState('');
  const [generated, setGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);

  const generate = () => {
    if (!prompt.trim()) return;
    setGenerating(true);
    setTimeout(() => { setGenerated(true); setGenerating(false); }, 1500);
  };

  const sections = [
    { name: 'Hero Section', desc: 'Full-width banner with headline, subheadline, and primary CTA' },
    { name: 'Product Grid', desc: '3-column responsive grid with hover effects and quick-add' },
    { name: 'Benefits Section', desc: '3-icon feature highlight with trust signals' },
    { name: 'Social Proof', desc: 'Customer reviews carousel with star ratings' },
    { name: 'FAQ Accordion', desc: '5 common questions with expandable answers' },
    { name: 'Trust Badges', desc: 'Free shipping, secure checkout, money-back guarantee' },
    { name: 'Final CTA', desc: 'Urgency-driven call-to-action with countdown timer' },
  ];

  return (
    <div>
      <BackButton onClick={onBack} />
      <SectionHeader title="AI Store Builder" subtitle="Describe your store and AI generates the complete layout" />

      {/* Input */}
      <div className="space-y-2.5 mb-4">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="e.g. Build me a premium Shopify store for fitness accessories targeting women 25-40"
          rows={3}
          className="w-full px-3 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04] text-[12px] text-white placeholder:text-[#858B99] outline-none focus:border-white/[0.08] resize-none"
        />
        <button
          onClick={generate}
          disabled={!prompt.trim() || generating}
          className="w-full h-9 rounded-xl text-[12px] font-semibold text-white transition-all disabled:opacity-30 hover:brightness-110"
          style={{ background: 'linear-gradient(135deg, #A78BFA, #8B5CF6)', boxShadow: '0 4px 16px rgba(139, 92, 246,0.15)' }}>
          {generating ? <RefreshCw className="h-4 w-4 animate-spin mx-auto" /> : <><Wand2 className="h-3.5 w-3.5 inline mr-1.5" />Generate Store</>}
        </button>
      </div>

      {/* Generated Preview */}
      <AnimatePresence>
        {generated && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            {/* Color Palette */}
            <div className="p-3.5 rounded-xl border border-white/[0.04] bg-white/[0.015]">
              <h4 className="text-[11px] font-semibold text-white/70 mb-2 flex items-center gap-1.5">
                <Palette className="h-3 w-3 text-[#A78BFA]" /> Color Palette
              </h4>
              <div className="flex gap-2">
                {['#1a1a2e', '#16213e', '#0f3460', '#e94560', '#f5f5f5'].map(c => (
                  <div key={c} className="flex items-center gap-1.5">
                    <div className="w-6 h-6 rounded-md border border-white/[0.1]" style={{ background: c }} />
                    <span className="text-[8px] text-[#858B99]">{c}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Typography */}
            <div className="p-3.5 rounded-xl border border-white/[0.04] bg-white/[0.015]">
              <h4 className="text-[11px] font-semibold text-white/70 mb-2 flex items-center gap-1.5">
                <Type className="h-3 w-3 text-[#A78BFA]" /> Typography
              </h4>
              <div className="space-y-1">
                <p className="text-[16px] font-bold text-white/90">Heading — Inter Bold</p>
                <p className="text-[12px] text-white/60">Body — Inter Regular</p>
                <p className="text-[10px] text-white/40 uppercase tracking-wider">Label — Inter Medium</p>
              </div>
            </div>

            {/* Sections */}
            <div className="p-3.5 rounded-xl border border-white/[0.04] bg-white/[0.015]">
              <h4 className="text-[11px] font-semibold text-white/70 mb-2.5 flex items-center gap-1.5">
                <Layout className="h-3 w-3 text-[#4ADE80]" /> Store Sections ({sections.length})
              </h4>
              <div className="space-y-1.5">
                {sections.map((s, i) => (
                  <div key={s.name} className="flex items-center gap-2.5 py-2 border-b border-white/[0.02] last:border-0">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#A78BFA]/[0.08] text-[9px] text-[#A78BFA] font-semibold shrink-0">{i + 1}</div>
                    <div>
                      <p className="text-[11px] font-medium text-white/80">{s.name}</p>
                      <p className="text-[9px] text-[#858B99]">{s.desc}</p>
                    </div>
                    <Check className="h-3 w-3 text-[#4ADE80]/50 ml-auto shrink-0" />
                  </div>
                ))}
              </div>
            </div>

            {/* Export */}
            <button
              disabled
              className="w-full h-9 rounded-xl text-[12px] font-medium text-white/30 border border-white/[0.04] bg-white/[0.02] cursor-not-allowed relative group"
            >
              <Lock className="h-3 w-3 inline mr-1.5" />
              Export to Shopify
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1 rounded-lg bg-[#161820] border border-white/[0.08] text-[9px] text-[#B6BBC6] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                Shopify integration coming soon
              </div>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════════════════════════
   ═══ SHOPIFY CONNECT ═══
   ═══════════════════════════════════════════ */

function ShopifyConnect({ onBack }: { onBack: () => void }) {
  return (
    <div>
      <BackButton onClick={onBack} />
      <SectionHeader title="Shopify Connect" subtitle="Connect your store to unlock live sync and analytics" />

      <div className="flex flex-col items-center text-center py-10">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#4ADE80]/[0.06] border border-[#4ADE80]/15 mb-4">
          <ShoppingCart className="h-7 w-7 text-[#4ADE80]/40" />
        </div>
        <h3 className="text-[15px] font-semibold text-white/70 mb-1.5">Not Connected</h3>
        <p className="text-[11px] text-[#858B99] max-w-xs mb-6">Connect your Shopify store to sync products, track analytics, and manage everything from KorvixAI.</p>

        <button
          disabled
          className="px-6 py-2.5 rounded-xl text-[12px] font-semibold text-white/30 border border-white/[0.04] bg-white/[0.02] cursor-not-allowed relative group mb-4"
        >
          <Lock className="h-3.5 w-3.5 inline mr-1.5" />
          Connect Shopify Store
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1 rounded-lg bg-[#161820] border border-white/[0.08] text-[9px] text-[#B6BBC6] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            Shopify integration coming soon
          </div>
        </button>

        <p className="text-[9px] text-slate-700">No store access required. OAuth2 secure connection.</p>
      </div>

      {/* Placeholder Features */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { icon: RefreshCw, label: 'Sync Products', desc: 'Auto-sync inventory' },
          { icon: Download, label: 'Import Products', desc: 'Bulk import from CSV' },
          { icon: ExternalLink, label: 'Publish Drafts', desc: 'Push changes live' },
          { icon: BarChart3, label: 'Store Health', desc: 'Performance score' },
        ].map(f => (
          <div key={f.label} className="p-3 rounded-xl border border-white/[0.02] bg-white/[0.01] opacity-40">
            <f.icon className="h-4 w-4 text-[#858B99] mb-1.5" />
            <p className="text-[11px] font-medium text-white/50">{f.label}</p>
            <p className="text-[9px] text-[#858B99]">{f.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   ═══ PRICING OPTIMIZER ═══
   ═══════════════════════════════════════════ */

function PricingOptimizer({ onBack }: { onBack: () => void }) {
  const [cost, setCost] = useState('10');
  const [shipping, setShipping] = useState('5');
  const [targetMargin, setTargetMargin] = useState('40');
  const [competitorPrice, setCompetitorPrice] = useState('29.99');

  const result = useMemo(() => {
    const c = parseFloat(cost) || 0;
    const s = parseFloat(shipping) || 0;
    const tm = parseFloat(targetMargin) || 0;
    const totalCost = c + s;
    const suggested = totalCost / (1 - tm / 100);
    const margin = suggested > 0 ? ((suggested - totalCost) / suggested) * 100 : 0;
    const profit = suggested - totalCost;
    const breakEven = profit > 0 ? (suggested / profit) : 0;

    return {
      suggested: suggested.toFixed(2),
      margin: margin.toFixed(1),
      profit: profit.toFixed(2),
      breakEven: breakEven.toFixed(1),
      upsell: (suggested * 1.35).toFixed(2),
    };
  }, [cost, shipping, targetMargin, competitorPrice]);

  return (
    <div>
      <BackButton onClick={onBack} />
      <SectionHeader title="Pricing Optimizer" subtitle="Calculate optimal pricing, margins, and profitability" />

      {/* Inputs */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div>
          <label className="text-[10px] text-[#858B99] mb-1 block">Product Cost ($)</label>
          <input type="number" value={cost} onChange={e => setCost(e.target.value)}
            className="w-full h-8 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[12px] text-white outline-none focus:border-white/[0.08]" />
        </div>
        <div>
          <label className="text-[10px] text-[#858B99] mb-1 block">Shipping Cost ($)</label>
          <input type="number" value={shipping} onChange={e => setShipping(e.target.value)}
            className="w-full h-8 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[12px] text-white outline-none focus:border-white/[0.08]" />
        </div>
        <div>
          <label className="text-[10px] text-[#858B99] mb-1 block">Target Margin (%)</label>
          <input type="number" value={targetMargin} onChange={e => setTargetMargin(e.target.value)}
            className="w-full h-8 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[12px] text-white outline-none focus:border-white/[0.08]" />
        </div>
        <div>
          <label className="text-[10px] text-[#858B99] mb-1 block">Competitor Price ($)</label>
          <input type="number" value={competitorPrice} onChange={e => setCompetitorPrice(e.target.value)}
            className="w-full h-8 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[12px] text-white outline-none focus:border-white/[0.08]" />
        </div>
      </div>

      {/* Results */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-3 rounded-xl border border-[#A78BFA]/10 bg-[#A78BFA]/[0.04]">
          <p className="text-[9px] text-[#A78BFA]/60 mb-1">Suggested Price</p>
          <p className="text-[18px] font-semibold text-[#A78BFA]">${result.suggested}</p>
        </div>
        <div className="p-3 rounded-xl border border-[#4ADE80]/10 bg-[#4ADE80]/[0.04]">
          <p className="text-[9px] text-[#4ADE80]/60 mb-1">Actual Margin</p>
          <p className="text-[18px] font-semibold text-[#4ADE80]">{result.margin}%</p>
        </div>
        <div className="p-3 rounded-xl border border-[#A78BFA]/10 bg-[#A78BFA]/[0.04]">
          <p className="text-[9px] text-[#A78BFA]/60 mb-1">Profit / Order</p>
          <p className="text-[18px] font-semibold text-[#A78BFA]">${result.profit}</p>
        </div>
        <div className="p-3 rounded-xl border border-[#FACC15]/10 bg-[#FACC15]/[0.04]">
          <p className="text-[9px] text-[#FACC15]/60 mb-1">Break-even ROAS</p>
          <p className="text-[18px] font-semibold text-[#FACC15]">{result.breakEven}x</p>
        </div>
      </div>

      {/* Upsell */}
      <div className="mt-3 p-3 rounded-xl border border-[#A78BFA]/10 bg-[#A78BFA]/[0.04]">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-[#A78BFA]" />
          <div>
            <p className="text-[10px] text-[#A78BFA]/60">Upsell Bundle Suggestion</p>
            <p className="text-[13px] font-semibold text-[#A78BFA]">${result.upsell} bundle price (+35% AOV)</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   ═══ STORE ANALYTICS ═══
   ═══════════════════════════════════════════ */

function StoreAnalytics({ onBack }: { onBack: () => void }) {
  return (
    <div>
      <BackButton onClick={onBack} />
      <SectionHeader title="Store Analytics" subtitle="Track your store performance in real-time" />

      {/* Locked State */}
      <div className="flex flex-col items-center text-center py-8 mb-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#4ADE80]/[0.06] border border-[#4ADE80]/15 mb-3">
          <BarChart3 className="h-6 w-6 text-[#4ADE80]/40" />
        </div>
        <h3 className="text-[14px] font-semibold text-white/70 mb-1">Connect Shopify to unlock</h3>
        <p className="text-[11px] text-[#858B99] max-w-xs">Link your store to see live revenue, orders, conversion rates, and more.</p>
      </div>

      {/* Mock Cards (dimmed) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {[
          { label: 'Revenue', value: '$--', sub: 'Last 30 days' },
          { label: 'Orders', value: '--', sub: 'Total orders' },
          { label: 'Conversion', value: '--%', sub: 'Store CVR' },
          { label: 'AOV', value: '$--', sub: 'Average order' },
          { label: 'ROAS', value: '--x', sub: 'Return on ad spend' },
          { label: 'CPA', value: '$--', sub: 'Cost per acquisition' },
        ].map(m => (
          <div key={m.label} className="p-3 rounded-xl border border-white/[0.02] bg-white/[0.01] opacity-40">
            <p className="text-[9px] text-[#858B99] mb-1">{m.label}</p>
            <p className="text-[16px] font-semibold text-white/50 tabular-nums">{m.value}</p>
            <p className="text-[8px] text-[#858B99]">{m.sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   ═══ MAIN EXPORT ═══
   ═══════════════════════════════════════════ */

export default function EcommerceCommandCenter() {
  const [view, setView] = useState<ToolView>('dashboard');

  return (
    <div className="h-full overflow-y-auto scrollbar-thin px-4 py-4">
      <AnimatePresence mode="wait">
        {view === 'dashboard' && (
          <motion.div key="dash" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Dashboard onTool={setView} />
          </motion.div>
        )}
        {view === 'product-research' && (
          <motion.div key="pr" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <ProductResearch onBack={() => setView('dashboard')} />
          </motion.div>
        )}
        {view === 'store-builder' && (
          <motion.div key="sb" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <StoreBuilder onBack={() => setView('dashboard')} />
          </motion.div>
        )}
        {view === 'shopify' && (
          <motion.div key="sp" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <ShopifyConnect onBack={() => setView('dashboard')} />
          </motion.div>
        )}
        {view === 'tiktok' && (
          <motion.div key="tt" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <TikTokHooks onBack={() => setView('dashboard')} />
          </motion.div>
        )}
        {view === 'meta-ads' && (
          <motion.div key="ma" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <MetaAdsBuilder onBack={() => setView('dashboard')} />
          </motion.div>
        )}
        {view === 'pricing' && (
          <motion.div key="po" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <PricingOptimizer onBack={() => setView('dashboard')} />
          </motion.div>
        )}
        {view === 'analytics' && (
          <motion.div key="sa" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <StoreAnalytics onBack={() => setView('dashboard')} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
