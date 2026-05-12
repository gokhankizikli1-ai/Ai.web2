import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Clock, Play, Pause, Plus,
  TrendingUp, ShoppingBag, Search, FileText,
  BarChart3, AlertCircle,
} from 'lucide-react';
import Navigation from '@/components/Navigation';

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { delay, duration: 0.45, ease: 'easeOut' as const },
});

const AUTOMATIONS = [
  {
    id: '1', name: 'Daily Startup Trend Report', icon: TrendingUp, color: 'text-purple-400', bg: 'bg-purple-500/[0.06]',
    schedule: 'Daily at 8:00 AM', frequency: 'Daily', status: 'active' as const,
    lastRun: 'Today, 8:00 AM', nextRun: 'Tomorrow, 8:00 AM',
  },
  {
    id: '2', name: 'Weekly Shopify Store Audit', icon: ShoppingBag, color: 'text-emerald-400', bg: 'bg-emerald-500/[0.06]',
    schedule: 'Mondays at 9:00 AM', frequency: 'Weekly', status: 'active' as const,
    lastRun: 'Yesterday', nextRun: 'Next Monday',
  },
  {
    id: '3', name: 'Competitor Ad Monitoring', icon: Search, color: 'text-blue-400', bg: 'bg-blue-500/[0.06]',
    schedule: 'Every 6 hours', frequency: '6h', status: 'paused' as const,
    lastRun: '3 days ago', nextRun: 'Paused',
  },
  {
    id: '4', name: 'Product Trend Scanner', icon: BarChart3, color: 'text-amber-400', bg: 'bg-amber-500/[0.06]',
    schedule: 'Daily at 10:00 AM', frequency: 'Daily', status: 'active' as const,
    lastRun: 'Today, 10:00 AM', nextRun: 'Tomorrow, 10:00 AM',
  },
  {
    id: '5', name: 'Research Digest', icon: FileText, color: 'text-violet-400', bg: 'bg-violet-500/[0.06]',
    schedule: 'Fridays at 5:00 PM', frequency: 'Weekly', status: 'active' as const,
    lastRun: 'Last Friday', nextRun: 'This Friday',
  },
  {
    id: '6', name: 'Trading Market Summary', icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-500/[0.06]',
    schedule: 'Daily at 4:30 PM', frequency: 'Daily', status: 'paused' as const,
    lastRun: '1 week ago', nextRun: 'Paused',
  },
];

export default function Automations() {
  const [items, setItems] = useState(AUTOMATIONS);

  const toggleStatus = (id: string) => {
    setItems(items.map((item) =>
      item.id === id ? { ...item, status: item.status === 'active' ? 'paused' as const : 'active' as const } : item
    ));
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 flex flex-col">
      <Navigation />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">

          <motion.div {...fadeUp(0)} className="flex items-center justify-between mb-8">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/[0.1] border border-cyan-500/15">
                  <Clock className="h-4 w-4 text-cyan-400" />
                </div>
                <h1 className="text-2xl font-semibold text-white tracking-tight">Automations</h1>
              </div>
              <p className="text-[13px] text-slate-500 ml-11">Schedule recurring AI tasks and reports</p>
            </div>
            <button className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cyan-500/[0.1] border border-cyan-500/15 text-cyan-400 text-[12px] font-medium hover:bg-cyan-500/[0.15] transition-colors">
              <Plus className="w-3.5 h-3.5" /> Create
            </button>
          </motion.div>

          {/* Stats */}
          <motion.div {...fadeUp(0.05)} className="grid grid-cols-3 gap-3 mb-6">
            <div className="p-4 rounded-xl border border-white/[0.03] bg-white/[0.01] text-center">
              <p className="text-xl font-semibold text-emerald-400">{items.filter((i) => i.status === 'active').length}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Active</p>
            </div>
            <div className="p-4 rounded-xl border border-white/[0.03] bg-white/[0.01] text-center">
              <p className="text-xl font-semibold text-amber-400">{items.filter((i) => i.status === 'paused').length}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Paused</p>
            </div>
            <div className="p-4 rounded-xl border border-white/[0.03] bg-white/[0.01] text-center">
              <p className="text-xl font-semibold text-white">{items.length}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Total</p>
            </div>
          </motion.div>

          {/* Automation List */}
          <div className="space-y-2">
            {items.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className="p-4 rounded-xl border border-white/[0.03] bg-white/[0.01] hover:border-white/[0.06] transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${item.bg}`}>
                    <item.icon className={`w-4 h-4 ${item.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[13px] font-medium text-white">{item.name}</h3>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                        item.status === 'active' ? 'bg-emerald-500/[0.08] text-emerald-400' : 'bg-amber-500/[0.08] text-amber-400'
                      }`}>
                        {item.status === 'active' ? 'Active' : 'Paused'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px] text-slate-500">{item.schedule}</span>
                      <span className="text-[10px] text-slate-600">Last: {item.lastRun}</span>
                      <span className="text-[10px] text-slate-600">Next: {item.nextRun}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => toggleStatus(item.id)}
                    className={`p-2 rounded-lg transition-colors ${
                      item.status === 'active'
                        ? 'text-emerald-400 hover:bg-emerald-500/[0.08]'
                        : 'text-amber-400 hover:bg-amber-500/[0.08]'
                    }`}
                  >
                    {item.status === 'active' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Placeholder */}
          <motion.div {...fadeUp(0.3)} className="mt-6 p-4 rounded-2xl border border-cyan-500/10 bg-cyan-500/[0.02] text-center">
            <AlertCircle className="w-5 h-5 text-cyan-400 mx-auto mb-2" />
            <p className="text-[11px] text-slate-500">Automations run when backend is connected. Currently showing simulated schedules.</p>
          </motion.div>

        </div>
      </div>
    </div>
  );
}
