import { useNavigate } from 'react-router';
import { motion } from 'framer-motion';
import {
  LayoutGrid, Rocket, ShoppingBag,
  TrendingUp, Brain, Bot, Code2, Sparkles, ArrowRight,
  Plus, Star, Clock, Zap, Activity, ChevronRight, Pin,
} from 'lucide-react';
import type { WorkspaceTab } from '@/types';
import Navigation from '@/components/Navigation';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
});

const WORKSPACES = [
  {
    id: 'personal', name: 'Personal', description: 'Your default AI workspace',
    icon: Sparkles, color: 'cyan', tab: 'chat' as WorkspaceTab,
    bg: 'bg-[#3B82F6]/[0.06]', border: 'border-[#3B82F6]/10', iconColor: 'text-[#60A5FA]',
    glow: 'hover:shadow-[0_0_24px_-6px_rgba(59, 130, 246,0.1)]',
    stats: { chats: 24, agents: 3 }, pinned: true,
  },
  {
    id: 'startup', name: 'Startup Hub', description: 'Validate ideas, build MVPs, find PMF',
    icon: Rocket, color: 'orange', tab: 'startup' as WorkspaceTab,
    bg: 'bg-[#3B82F6]/[0.06]', border: 'border-[#3B82F6]/10', iconColor: 'text-[#60A5FA]',
    glow: 'hover:shadow-[0_0_24px_-6px_rgba(59, 130, 246,0.1)]',
    stats: { tools: 12, projects: 5 }, pinned: true,
  },
  {
    id: 'ecommerce', name: 'Ecommerce OS', description: 'AI-powered Shopify command center',
    icon: ShoppingBag, color: 'emerald', tab: 'business' as WorkspaceTab,
    bg: 'bg-[#3B82F6]/[0.06]', border: 'border-[#3B82F6]/10', iconColor: 'text-[#60A5FA]',
    glow: 'hover:shadow-[0_0_24px_-6px_rgba(59, 130, 246,0.1)]',
    stats: { tools: 12, campaigns: 3 }, pinned: true,
  },
  {
    id: 'trading', name: 'Trading Desk', description: 'Real-time signals, charts, and analysis',
    icon: TrendingUp, color: 'green', tab: 'trading' as WorkspaceTab,
    bg: 'bg-[#3B82F6]/[0.06]', border: 'border-[#3B82F6]/10', iconColor: 'text-[#60A5FA]',
    glow: 'hover:shadow-[0_0_24px_-6px_rgba(59, 130, 246,0.1)]',
    stats: { signals: 12, watchlist: 8 }, pinned: false,
  },
  {
    id: 'research', name: 'Deep Research', description: 'Multi-source research and analysis',
    icon: Brain, color: 'violet', tab: 'research' as WorkspaceTab,
    bg: 'bg-[#3B82F6]/[0.06]', border: 'border-[#3B82F6]/10', iconColor: 'text-[#60A5FA]',
    glow: 'hover:shadow-[0_0_24px_-6px_rgba(59, 130, 246,0.1)]',
    stats: { reports: 5, sources: 47 }, pinned: false,
  },
  {
    id: 'coding', name: 'Code Studio', description: 'Write, debug, review, and ship code',
    icon: Code2, color: 'blue', tab: 'coding' as WorkspaceTab,
    bg: 'bg-[#3B82F6]/[0.06]', border: 'border-[#3B82F6]/10', iconColor: 'text-[#60A5FA]',
    glow: 'hover:shadow-[0_0_24px_-6px_rgba(59, 130, 246,0.1)]',
    stats: { files: 23, reviews: 7 }, pinned: false,
  },
  {
    id: 'agents', name: 'Agent Lab', description: 'Build and manage custom AI agents',
    icon: Bot, color: 'indigo', tab: 'agents' as WorkspaceTab,
    bg: 'bg-[#3B82F6]/[0.06]', border: 'border-[#3B82F6]/10', iconColor: 'text-[#60A5FA]',
    glow: 'hover:shadow-[0_0_24px_-6px_rgba(59, 130, 246,0.1)]',
    stats: { agents: 8, tasks: 34 }, pinned: false,
  },
];

const RECENT_ITEMS = [
  { title: 'NVDA Q3 Earnings Analysis', workspace: 'Deep Research', time: '2m ago', icon: Brain, color: 'text-[#60A5FA]', bg: 'bg-[#3B82F6]/[0.06]' },
  { title: 'Landing Page Copy — Acme AI', workspace: 'Startup Hub', time: '1h ago', icon: Rocket, color: 'text-[#60A5FA]', bg: 'bg-[#3B82F6]/[0.06]' },
  { title: 'Shopify Ad Campaign #3', workspace: 'Ecommerce OS', time: '3h ago', icon: ShoppingBag, color: 'text-[#60A5FA]', bg: 'bg-[#3B82F6]/[0.06]' },
  { title: 'AAPL Technical Analysis', workspace: 'Trading Desk', time: '5h ago', icon: TrendingUp, color: 'text-[#60A5FA]', bg: 'bg-[#3B82F6]/[0.06]' },
  { title: 'React Component Review', workspace: 'Code Studio', time: 'Yesterday', icon: Code2, color: 'text-[#60A5FA]', bg: 'bg-[#3B82F6]/[0.06]' },
];

/* ─── Workspace Card ─── */
function WorkspaceCard({ ws }: { ws: typeof WORKSPACES[0] }) {
  const navigate = useNavigate();

  const handleClick = () => {
    // Navigate to /chat with tab param and dispatch workspace switch event
    const tab = ws.tab;
    navigate(`/chat?tab=${tab}`);
    // Dispatch event so ChatDashboard picks up the tab switch
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('korvix-switch-workspace', { detail: tab }));
    }, 50);
  };

  return (
    <motion.div
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.99 }}
      onClick={handleClick}
      className={`relative p-5 rounded-2xl border ${ws.border} ${ws.bg} bg-white/[0.01] backdrop-blur-sm cursor-pointer transition-all duration-300 hover:bg-white/[0.015] hover:border-white/[0.08] ${ws.glow} group`}
    >
      {/* Pinned badge */}
      {ws.pinned && (
        <div className="absolute top-3 right-3 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[#3B82F6]/[0.06] border border-[#3B82F6]/10">
          <Pin className="w-2.5 h-2.5 text-[#60A5FA]/60" />
          <span className="text-[9px] text-[#60A5FA]/60">Pinned</span>
        </div>
      )}

      {/* Icon + Title */}
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.04] group-hover:border-white/[0.08] transition-colors">
          <ws.icon className={`w-5 h-5 ${ws.iconColor}`} />
        </div>
        <div>
          <h3 className="text-[14px] font-medium text-white group-hover:text-slate-200 transition-colors">{ws.name}</h3>
          <p className="text-[11px] text-[#94A3B8] mt-0.5">{ws.description}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-2 mb-3">
        {Object.entries(ws.stats).map(([key, val]) => (
          <span key={key} className="text-[10px] text-[#CBD5E1] px-2 py-1 rounded-lg bg-white/[0.02] border border-white/[0.03] flex items-center gap-1">
            <span className="text-slate-300 font-medium">{val}</span> {key}
          </span>
        ))}
      </div>

      {/* Hover action */}
      <div className="flex items-center gap-1 text-[11px] text-[#94A3B8] group-hover:text-[#60A5FA]/70 transition-colors">
        Open workspace <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
      </div>
    </motion.div>
  );
}

/* ─── Stats Bar ─── */
function StatsBar() {
  const stats = [
    { icon: Zap, label: 'Active', value: '7', color: 'text-[#60A5FA]' },
    { icon: Activity, label: 'Running', value: '3', color: 'text-[#4ADE80]' },
    { icon: Star, label: 'Pinned', value: '3', color: 'text-[#60A5FA]' },
    { icon: Clock, label: 'This Week', value: '42', color: 'text-[#60A5FA]' },
  ];

  return (
    <div className="flex items-center gap-3 mb-8 overflow-x-auto scrollbar-thin">
      {stats.map((s, i) => (
        <motion.div
          key={s.label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 + i * 0.04, duration: 0.4 }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/[0.01] border border-white/[0.03] shrink-0"
        >
          <s.icon className={`w-3.5 h-3.5 ${s.color}`} />
          <span className="text-[13px] font-medium text-white">{s.value}</span>
          <span className="text-[10px] text-[#94A3B8]">{s.label}</span>
        </motion.div>
      ))}
    </div>
  );
}

/* ─── Main ─── */
export default function WorkspacePage() {
  const pinned = WORKSPACES.filter((w) => w.pinned);
  const others = WORKSPACES.filter((w) => !w.pinned);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 flex flex-col">
      <Navigation />

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

          {/* Header */}
          <motion.div {...fadeUp(0)} className="mb-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#3B82F6]/[0.08] border border-[#3B82F6]/15">
                  <LayoutGrid className="h-5 w-5 text-[#60A5FA]/70" />
                </div>
                <div>
                  <h1 className="text-2xl font-semibold text-white tracking-tight">Workspace</h1>
                  <p className="text-[12px] text-[#94A3B8]">Manage your AI workspaces</p>
                </div>
              </div>
              <button className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#3B82F6]/[0.08] border border-[#3B82F6]/15 text-[12px] text-[#60A5FA] hover:bg-[#3B82F6]/[0.12] transition-colors">
                <Plus className="w-3.5 h-3.5" /> New
              </button>
            </div>
          </motion.div>

          {/* Stats Bar */}
          <StatsBar />

          {/* Pinned Workspaces */}
          <motion.section {...fadeUp(0.05)} className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Star className="w-3.5 h-3.5 text-[#60A5FA]/60" />
              <h2 className="text-[13px] font-semibold text-white">Pinned Workspaces</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {pinned.map((ws) => (
                <WorkspaceCard key={ws.id} ws={ws} />
              ))}
            </div>
          </motion.section>

          {/* All Workspaces */}
          <motion.section {...fadeUp(0.1)} className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <LayoutGrid className="w-3.5 h-3.5 text-[#94A3B8]" />
              <h2 className="text-[13px] font-semibold text-white">All Workspaces</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {others.map((ws) => (
                <WorkspaceCard key={ws.id} ws={ws} />
              ))}
            </div>
          </motion.section>

          {/* Recent Activity */}
          <motion.section {...fadeUp(0.15)}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-[#94A3B8]" />
                <h2 className="text-[13px] font-semibold text-white">Recent Activity</h2>
              </div>
              <span className="text-[10px] text-[#94A3B8]">{RECENT_ITEMS.length} items</span>
            </div>
            <div className="space-y-1.5">
              {RECENT_ITEMS.map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="flex items-center gap-3 p-3.5 rounded-xl border border-white/[0.02] bg-white/[0.005] hover:border-white/[0.06] hover:bg-white/[0.015] cursor-pointer transition-all duration-200 group"
                >
                  <div className={`p-2 rounded-lg ${item.bg} border border-white/[0.03]`}>
                    <item.icon className={`w-4 h-4 ${item.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-[13px] font-medium text-white group-hover:text-[#60A5FA] transition-colors truncate">{item.title}</h3>
                    <p className="text-[11px] text-[#94A3B8]">{item.workspace}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-[#94A3B8]">{item.time}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-[#CBD5E1] group-hover:text-[#60A5FA]/60 transition-colors" />
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.section>
        </div>
      </div>
    </div>
  );
}
