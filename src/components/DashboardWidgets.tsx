import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import {
  MessageSquare, Rocket, ShoppingBag, Brain, Code2, Bot,
  Sparkles, Zap, ArrowRight, Activity, BarChart3,
  TrendingUp, Flame, FileText, Wand2,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell } from 'recharts';
import WidgetCard from './WidgetCard';
import CircularGauge from './CircularGauge';

/* ═══════════════════════════════════════════
   WIDGET 1: Today's AI Suggestions
   ═══════════════════════════════════════════ */
export function SuggestionsWidget() {
  const navigate = useNavigate();
  const suggestions = [
    { icon: Brain, text: 'Analyze Tesla Q3 earnings report', path: '/chat', color: 'text-violet-400', bg: 'bg-violet-500/[0.06]' },
    { icon: Rocket, text: 'Validate your SaaS startup idea', path: '/startup', color: 'text-orange-400', bg: 'bg-orange-500/[0.06]' },
    { icon: ShoppingBag, text: 'Generate TikTok hooks for your product', path: '/tools/viral-content', color: 'text-emerald-400', bg: 'bg-emerald-500/[0.06]' },
    { icon: FileText, text: 'Build a landing page for your brand', path: '/tools/website-builder', color: 'text-blue-400', bg: 'bg-blue-500/[0.06]' },
  ];

  return (
    <WidgetCard title="AI Suggestions" icon={<Sparkles className="w-3.5 h-3.5" />} delay={0}>
      <div className="space-y-2">
        {suggestions.map((s, i) => (
          <motion.button
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.06 }}
            whileHover={{ x: 2 }}
            onClick={() => navigate(s.path)}
            className="flex items-center gap-3 w-full p-2.5 rounded-xl hover:bg-white/[0.02] transition-colors group text-left"
          >
            <div className={`p-1.5 rounded-lg ${s.bg}`}>
              <s.icon className={`w-3.5 h-3.5 ${s.color}`} />
            </div>
            <span className="text-[12px] text-slate-400 group-hover:text-slate-200 transition-colors flex-1">{s.text}</span>
            <ArrowRight className="w-3 h-3 text-slate-600 group-hover:text-cyan-400 transition-colors" />
          </motion.button>
        ))}
      </div>
    </WidgetCard>
  );
}

/* ═══════════════════════════════════════════
   WIDGET 2: Stats Row
   ═══════════════════════════════════════════ */
export function StatsRowWidget() {
  const stats = [
    { label: 'Conversations', value: '24', icon: MessageSquare, color: 'text-cyan-400', bg: 'bg-cyan-500/[0.06]' },
    { label: 'Agents Active', value: '3', icon: Bot, color: 'text-indigo-400', bg: 'bg-indigo-500/[0.06]' },
    { label: 'Signals Today', value: '12', icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-500/[0.06]' },
    { label: 'Research Tasks', value: '5', icon: Brain, color: 'text-violet-400', bg: 'bg-violet-500/[0.06]' },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((s, i) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05 }}
          className="p-4 rounded-2xl border border-white/[0.03] bg-white/[0.01] hover:border-white/[0.06] transition-all"
        >
          <div className={`p-1.5 rounded-lg ${s.bg} w-fit mb-2.5`}>
            <s.icon className={`w-3.5 h-3.5 ${s.color}`} />
          </div>
          <p className="text-xl font-semibold text-white">{s.value}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">{s.label}</p>
        </motion.div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════
   WIDGET 3: Quick Actions
   ═══════════════════════════════════════════ */
export function QuickActionsWidget() {
  const navigate = useNavigate();
  const actions = [
    { icon: MessageSquare, label: 'New Chat', desc: 'Start a conversation', path: '/chat', color: 'cyan' },
    { icon: Rocket, label: 'Startup Hub', desc: 'Validate & build ideas', path: '/startup', color: 'orange' },
    { icon: ShoppingBag, label: 'Ecommerce OS', desc: 'AI Shopify center', path: '/ecommerce', color: 'emerald' },
    { icon: Brain, label: 'Deep Research', desc: 'Multi-source research', path: '/chat', color: 'violet' },
    { icon: Bot, label: 'Agent Builder', desc: 'Create custom agents', path: '/agents/builder', color: 'indigo' },
    { icon: Code2, label: 'Code Mode', desc: 'Write, debug, refactor', path: '/chat', color: 'blue' },
  ];

  const COLOR_MAP: Record<string, string> = {
    cyan: 'hover:shadow-[0_0_20px_-4px_rgba(34,211,238,0.12)] hover:border-cyan-500/20',
    orange: 'hover:shadow-[0_0_20px_-4px_rgba(251,146,60,0.12)] hover:border-orange-500/20',
    emerald: 'hover:shadow-[0_0_20px_-4px_rgba(52,211,153,0.12)] hover:border-emerald-500/20',
    violet: 'hover:shadow-[0_0_20px_-4px_rgba(167,139,250,0.12)] hover:border-violet-500/20',
    indigo: 'hover:shadow-[0_0_20px_-4px_rgba(129,140,248,0.12)] hover:border-indigo-500/20',
    blue: 'hover:shadow-[0_0_20px_-4px_rgba(96,165,250,0.12)] hover:border-blue-500/20',
  };

  return (
    <WidgetCard title="Quick Launch" icon={<Zap className="w-3.5 h-3.5" />} delay={0.05}>
      <div className="grid grid-cols-2 gap-2.5">
        {actions.map((a) => (
          <motion.button
            key={a.label}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => navigate(a.path)}
            className={`flex flex-col items-start gap-1.5 p-3.5 rounded-xl border border-white/[0.03] bg-white/[0.01] transition-all ${COLOR_MAP[a.color]}`}
          >
            <a.icon className="w-4 h-4 text-slate-400" />
            <span className="text-[12px] font-medium text-white">{a.label}</span>
            <span className="text-[10px] text-slate-600">{a.desc}</span>
          </motion.button>
        ))}
      </div>
    </WidgetCard>
  );
}

/* ═══════════════════════════════════════════
   WIDGET 4: Recent Activity Timeline
   ═══════════════════════════════════════════ */
export function ActivityTimelineWidget() {
  const items = [
    { action: 'Deep Research completed', detail: 'NVDA Q3 Earnings Analysis', time: '2m ago', icon: Brain, color: 'text-violet-400' },
    { action: 'Trading signal detected', detail: 'AAPL Long — 87% confidence', time: '15m ago', icon: TrendingUp, color: 'text-emerald-400' },
    { action: 'New chat started', detail: 'System Architecture Discussion', time: '32m ago', icon: MessageSquare, color: 'text-cyan-400' },
    { action: 'Agent task finished', detail: 'Market Scanner — 2 signals', time: '1h ago', icon: Bot, color: 'text-indigo-400' },
    { action: 'Landing page generated', detail: 'Acme AI — conversion optimized', time: '2h ago', icon: FileText, color: 'text-blue-400' },
  ];

  return (
    <WidgetCard title="Recent Activity" icon={<Activity className="w-3.5 h-3.5" />} delay={0.1}>
      <div className="space-y-0">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-3 py-2.5 border-b border-white/[0.02] last:border-0">
            <div className="mt-0.5">
              <item.icon className={`w-3.5 h-3.5 ${item.color}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] text-slate-300">{item.action}</p>
              <p className="text-[11px] text-slate-600 truncate">{item.detail}</p>
            </div>
            <span className="text-[10px] text-slate-600 shrink-0">{item.time}</span>
          </div>
        ))}
      </div>
    </WidgetCard>
  );
}

/* ═══════════════════════════════════════════
   WIDGET 5: Active Agents
   ═══════════════════════════════════════════ */
export function ActiveAgentsWidget() {
  const agents = [
    { name: 'Startup Mentor', status: 'active', color: 'bg-orange-400', icon: Rocket },
    { name: 'Shopify Expert', status: 'idle', color: 'bg-emerald-400', icon: ShoppingBag },
    { name: 'Code Reviewer', status: 'active', color: 'bg-blue-400', icon: Code2 },
    { name: 'Research AI', status: 'idle', color: 'bg-violet-400', icon: Brain },
  ];

  return (
    <WidgetCard title="Active Agents" icon={<Bot className="w-3.5 h-3.5" />} delay={0.15}>
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {agents.map((a) => (
          <button
            key={a.name}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.03] hover:border-white/[0.06] hover:bg-white/[0.03] transition-all shrink-0"
          >
            <div className="relative">
              <a.icon className="w-4 h-4 text-slate-400" />
              <div className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${a.color} ${a.status === 'active' ? 'animate-pulse' : 'opacity-40'}`} />
            </div>
            <span className="text-[11px] text-slate-300 whitespace-nowrap">{a.name}</span>
          </button>
        ))}
      </div>
    </WidgetCard>
  );
}

/* ═══════════════════════════════════════════
   WIDGET 6: Workspace Activity Chart
   ═══════════════════════════════════════════ */
export function WorkspaceActivityWidget() {
  const data = [
    { name: 'Startup', value: 42, color: '#c084fc' },
    { name: 'Ecom', value: 28, color: '#34d399' },
    { name: 'Research', value: 18, color: '#a78bfa' },
    { name: 'Code', value: 35, color: '#60a5fa' },
    { name: 'Trading', value: 12, color: '#4ade80' },
    { name: 'Creative', value: 8, color: '#f472b6' },
  ];

  return (
    <WidgetCard title="Workspace Activity" icon={<BarChart3 className="w-3.5 h-3.5" />} delay={0.2}>
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barSize={24}>
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#52525b' }} axisLine={false} tickLine={false} />
            <YAxis hide />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.color} fillOpacity={0.6} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11px] text-slate-500 mt-2">Most active: <span className="text-purple-400">Startup Hub</span></p>
    </WidgetCard>
  );
}

/* ═══════════════════════════════════════════
   WIDGET 7: Trending Startup Ideas
   ═══════════════════════════════════════════ */
export function TrendingStartupsWidget() {
  const startups = [
    { name: 'AI Contract Intelligence', category: 'LegalTech', score: 94, trend: '+12%', color: '#c084fc' },
    { name: 'Carbon Intelligence Platform', category: 'ClimateTech', score: 89, trend: '+8%', color: '#34d399' },
    { name: 'Cross-Chain Liquidity Router', category: 'DeFi', score: 86, trend: '+15%', color: '#60a5fa' },
  ];

  return (
    <WidgetCard title="Trending Startups" icon={<Flame className="w-3.5 h-3.5 text-orange-400" />} delay={0.25}>
      <div className="space-y-3">
        {startups.map((s, i) => (
          <div key={i} className="flex items-center gap-3">
            <CircularGauge value={s.score} size={48} strokeWidth={4} color={s.color} />
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-white truncate">{s.name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-slate-500">{s.category}</span>
                <span className="text-[10px] text-emerald-400">{s.trend}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </WidgetCard>
  );
}

/* ═══════════════════════════════════════════
   WIDGET 8: Ecommerce Opportunities
   ═══════════════════════════════════════════ */
export function EcommerceOpportunitiesWidget() {
  const products = [
    { name: 'Smart Garden Hub', virality: 87, margin: '$42', competition: 'Low', color: 'text-emerald-400' },
    { name: 'LED Face Mask Pro', virality: 92, margin: '$68', competition: 'Medium', color: 'text-amber-400' },
  ];

  return (
    <WidgetCard title="Ecommerce Opportunities" icon={<ShoppingBag className="w-3.5 h-3.5 text-emerald-400" />} delay={0.3}>
      <div className="space-y-2.5">
        {products.map((p, i) => (
          <div key={i} className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.03]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[12px] font-medium text-white">{p.name}</span>
              <button className="text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors">Analyze</button>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-slate-500">
              <span>Virality: <span className="text-white">{p.virality}</span></span>
              <span>Margin: <span className="text-white">{p.margin}</span></span>
              <span>Comp: <span className={p.color}>{p.competition}</span></span>
            </div>
          </div>
        ))}
      </div>
    </WidgetCard>
  );
}

/* ═══════════════════════════════════════════
   WIDGET 9: Market Snapshot
   ═══════════════════════════════════════════ */
export function MarketSnapshotWidget() {
  return (
    <WidgetCard title="Market Snapshot" icon={<TrendingUp className="w-3.5 h-3.5 text-emerald-400" />} delay={0.35}>
      <div className="flex items-center gap-4 mb-3">
        <div>
          <p className="text-2xl font-semibold text-white">$187.42</p>
          <div className="flex items-center gap-1">
            <TrendingUp className="w-3 h-3 text-emerald-400" />
            <span className="text-[12px] text-emerald-400">+2.34%</span>
          </div>
        </div>
        <div className="flex-1 h-12 opacity-60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={[{ v: 30 }, { v: 45 }, { v: 35 }, { v: 50 }, { v: 42 }, { v: 55 }, { v: 48 }]} barSize={6}>
              <Bar dataKey="v" fill="#34d399" fillOpacity={0.5} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className="text-[11px] text-slate-500">AAPL — Trading data from simulated feed</p>
    </WidgetCard>
  );
}

/* ═══════════════════════════════════════════
   WIDGET 10: Quick Launch Input
   ═══════════════════════════════════════════ */
export function QuickLaunchWidget() {
  return (
    <WidgetCard title="What to Build?" icon={<Wand2 className="w-3.5 h-3.5" />} delay={0.4} noPadding>
      <div className="p-5 pt-0">
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Describe what you want to build..."
            className="flex-1 h-10 px-4 rounded-xl bg-white/[0.02] border border-white/[0.04] text-[13px] text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/20 focus:bg-white/[0.03] transition-all"
          />
          <button className="h-10 px-4 rounded-xl bg-cyan-500/[0.1] border border-cyan-500/15 text-cyan-400 hover:bg-cyan-500/[0.15] transition-colors">
            <Sparkles className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-2 mt-3 flex-wrap">
          {['Landing page', 'SaaS idea', 'Shopify product', 'Brand kit'].map((chip) => (
            <span key={chip} className="px-2.5 py-1 rounded-lg bg-white/[0.02] text-[10px] text-slate-500 border border-white/[0.03] hover:border-white/[0.06] cursor-pointer transition-colors">
              {chip}
            </span>
          ))}
        </div>
      </div>
    </WidgetCard>
  );
}

/* ═══════════════════════════════════════════
   WIDGET 11: Productivity Stats
   ═══════════════════════════════════════════ */
export function ProductivityStatsWidget() {
  const data = [
    { day: 'M', conversations: 12 },
    { day: 'T', conversations: 18 },
    { day: 'W', conversations: 8 },
    { day: 'T', conversations: 24 },
    { day: 'F', conversations: 15 },
    { day: 'S', conversations: 6 },
    { day: 'S', conversations: 9 },
  ];

  return (
    <WidgetCard title="Weekly Activity" icon={<BarChart3 className="w-3.5 h-3.5" />} delay={0.45}>
      <div className="h-28">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barSize={20}>
            <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#52525b' }} axisLine={false} tickLine={false} />
            <YAxis hide />
            <Bar dataKey="conversations" fill="#22d3ee" fillOpacity={0.4} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[11px] text-slate-500 mt-1">Peak: Thursday with 24 conversations</p>
    </WidgetCard>
  );
}

/* ═══════════════════════════════════════════
   WIDGET 12: Recent AI Generations
   ═══════════════════════════════════════════ */
export function RecentGenerationsWidget() {
  const generations = [
    { type: 'Landing Page', preview: 'Hero section with CTA for AI analytics SaaS...', time: '5m ago', color: 'text-blue-400', bg: 'bg-blue-500/[0.06]' },
    { type: 'TikTok Script', preview: 'Hook: "This $19 gadget saved me $400..."', time: '12m ago', color: 'text-rose-400', bg: 'bg-rose-500/[0.06]' },
    { type: 'Market Research', preview: 'TAM: $4.2B, SAM: $680M, SOM: $45M...', time: '1h ago', color: 'text-violet-400', bg: 'bg-violet-500/[0.06]' },
    { type: 'Brand Kit', preview: 'Name: "Nexora", Tagline: "Intelligence..."', time: '2h ago', color: 'text-pink-400', bg: 'bg-pink-500/[0.06]' },
  ];

  return (
    <WidgetCard title="AI Generations" icon={<Sparkles className="w-3.5 h-3.5 text-cyan-400" />} delay={0.5}>
      <div className="space-y-2">
        {generations.map((g, i) => (
          <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-xl hover:bg-white/[0.02] transition-colors cursor-pointer group">
            <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${g.bg} ${g.color} shrink-0 mt-0.5`}>{g.type}</span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-slate-400 truncate group-hover:text-slate-300 transition-colors">{g.preview}</p>
            </div>
            <span className="text-[10px] text-slate-600 shrink-0">{g.time}</span>
          </div>
        ))}
      </div>
    </WidgetCard>
  );
}
