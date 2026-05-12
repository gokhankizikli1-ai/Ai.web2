import { useState } from 'react';
import { useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutGrid, Rocket, ShoppingBag,
  TrendingUp, Brain, Bot, Code2, Sparkles, ArrowRight,
  Plus, Star, Clock,
  ChevronRight, Pin,
} from 'lucide-react';
import Navigation from '@/components/Navigation';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.45, ease: 'easeOut' as const },
});

const WORKSPACES = [
  {
    id: 'personal', name: 'Personal', description: 'Your default AI workspace',
    icon: Sparkles, color: 'cyan', path: '/chat',
    bg: 'bg-cyan-500/[0.06]', border: 'border-cyan-500/10', iconColor: 'text-cyan-400',
    stats: { chats: 24, agents: 3 }, pinned: true,
  },
  {
    id: 'startup', name: 'Startup Hub', description: 'Validate ideas, build MVPs, find PMF',
    icon: Rocket, color: 'orange', path: '/startup',
    bg: 'bg-orange-500/[0.06]', border: 'border-orange-500/10', iconColor: 'text-orange-400',
    stats: { tools: 12, projects: 5 }, pinned: true,
  },
  {
    id: 'ecommerce', name: 'Ecommerce OS', description: 'AI-powered Shopify command center',
    icon: ShoppingBag, color: 'emerald', path: '/ecommerce',
    bg: 'bg-emerald-500/[0.06]', border: 'border-emerald-500/10', iconColor: 'text-emerald-400',
    stats: { tools: 12, campaigns: 3 }, pinned: true,
  },
  {
    id: 'trading', name: 'Trading Desk', description: 'Real-time signals, charts, and analysis',
    icon: TrendingUp, color: 'green', path: '/chat?tab=trading',
    bg: 'bg-emerald-500/[0.06]', border: 'border-emerald-500/10', iconColor: 'text-emerald-400',
    stats: { signals: 12, watchlist: 8 }, pinned: false,
  },
  {
    id: 'research', name: 'Deep Research', description: 'Multi-source research and analysis',
    icon: Brain, color: 'violet', path: '/chat?tab=research',
    bg: 'bg-violet-500/[0.06]', border: 'border-violet-500/10', iconColor: 'text-violet-400',
    stats: { reports: 5, sources: 47 }, pinned: false,
  },
  {
    id: 'coding', name: 'Code Studio', description: 'Write, debug, review, and ship code',
    icon: Code2, color: 'blue', path: '/chat?tab=coding',
    bg: 'bg-blue-500/[0.06]', border: 'border-blue-500/10', iconColor: 'text-blue-400',
    stats: { files: 23, reviews: 7 }, pinned: false,
  },
  {
    id: 'agents', name: 'Agent Lab', description: 'Build and manage custom AI agents',
    icon: Bot, color: 'indigo', path: '/agents',
    bg: 'bg-indigo-500/[0.06]', border: 'border-indigo-500/10', iconColor: 'text-indigo-400',
    stats: { agents: 8, tasks: 34 }, pinned: false,
  },
];

const RECENT_ITEMS = [
  { title: 'NVDA Q3 Earnings Analysis', workspace: 'Deep Research', time: '2m ago', icon: Brain, color: 'text-violet-400' },
  { title: 'Landing Page Copy — Acme AI', workspace: 'Startup Hub', time: '1h ago', icon: Rocket, color: 'text-orange-400' },
  { title: 'Shopify Ad Campaign #3', workspace: 'Ecommerce OS', time: '3h ago', icon: ShoppingBag, color: 'text-emerald-400' },
  { title: 'AAPL Technical Analysis', workspace: 'Trading Desk', time: '5h ago', icon: TrendingUp, color: 'text-emerald-400' },
  { title: 'React Component Review', workspace: 'Code Studio', time: 'Yesterday', icon: Code2, color: 'text-blue-400' },
];

function WorkspaceCard({ ws }: { ws: typeof WORKSPACES[0] }) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);

  return (
    <motion.div
      whileHover={{ y: -2 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      onClick={() => navigate(ws.path)}
      className={`relative p-5 rounded-2xl border ${ws.border} ${ws.bg} cursor-pointer transition-all group`}
    >
      {ws.pinned && (
        <div className="absolute top-3 right-3">
          <Pin className="w-3 h-3 text-slate-600" />
        </div>
      )}

      <div className="flex items-start gap-3 mb-3">
        <div className="p-2.5 rounded-xl bg-white/[0.03]">
          <ws.icon className={`w-5 h-5 ${ws.iconColor}`} />
        </div>
        <div>
          <h3 className="text-[14px] font-medium text-white">{ws.name}</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">{ws.description}</p>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-3">
        {Object.entries(ws.stats).map(([key, val]) => (
          <span key={key} className="text-[10px] text-slate-500 px-1.5 py-0.5 rounded-md bg-white/[0.02]">
            {val} {key}
          </span>
        ))}
      </div>

      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-1 text-[11px] text-cyan-400"
          >
            Open workspace <ArrowRight className="w-3 h-3" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function WorkspacePage() {
  const [view, setView] = useState<'grid' | 'list'>('grid');

  const pinned = WORKSPACES.filter((w) => w.pinned);
  const others = WORKSPACES.filter((w) => !w.pinned);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 flex flex-col">
      <Navigation />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

          {/* Header */}
          <motion.div {...fadeUp(0)} className="flex items-center justify-between mb-8">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/[0.1] border border-indigo-500/15">
                  <LayoutGrid className="h-4 w-4 text-indigo-400" />
                </div>
                <h1 className="text-2xl font-semibold text-white tracking-tight">Workspace</h1>
              </div>
              <p className="text-[13px] text-slate-500 ml-11">Manage your workspaces and recent activity</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setView('grid')}
                className={`p-2 rounded-lg transition-colors ${view === 'grid' ? 'bg-white/[0.06] text-white' : 'text-slate-600 hover:text-slate-400'}`}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cyan-500/[0.1] border border-cyan-500/15 text-[12px] font-medium text-cyan-400 hover:bg-cyan-500/[0.15] transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> New
              </button>
            </div>
          </motion.div>

          {/* Quick Access — Pinned */}
          <motion.section {...fadeUp(0.05)} className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Star className="w-4 h-4 text-amber-400" />
              <h2 className="text-sm font-medium text-white">Pinned Workspaces</h2>
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
              <LayoutGrid className="w-4 h-4 text-slate-400" />
              <h2 className="text-sm font-medium text-white">All Workspaces</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {others.map((ws) => (
                <WorkspaceCard key={ws.id} ws={ws} />
              ))}
            </div>
          </motion.section>

          {/* Recent Activity */}
          <motion.section {...fadeUp(0.15)}>
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-slate-400" />
              <h2 className="text-sm font-medium text-white">Recent Activity</h2>
            </div>
            <div className="space-y-1">
              {RECENT_ITEMS.map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="flex items-center gap-3 p-3 rounded-xl border border-white/[0.02] bg-white/[0.01] hover:border-white/[0.06] hover:bg-white/[0.02] cursor-pointer transition-all group"
                >
                  <div className="p-2 rounded-lg bg-white/[0.03]">
                    <item.icon className={`w-4 h-4 ${item.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-[13px] font-medium text-white group-hover:text-cyan-300 transition-colors truncate">{item.title}</h3>
                    <p className="text-[11px] text-slate-500">{item.workspace}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-slate-600">{item.time}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-700 group-hover:text-cyan-400 transition-colors" />
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