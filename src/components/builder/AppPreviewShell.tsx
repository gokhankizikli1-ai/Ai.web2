// AppPreviewShell — premium SaaS-style dashboard chrome wrapped around the
// real, backend-driven <PreviewResult/>. Adds a device frame, topbar,
// sidebar and mock stat cards derived from the user's idea so the result
// area always looks like a real product surface — the actual artifact
// (iframe/code/markdown/etc.) still renders exactly as PreviewResult decides,
// untouched, inside the content panel below the mock chrome.
import {
  LayoutDashboard, BarChart3, Users2, Settings2, Search, Bell,
  ArrowUpRight, ArrowDownRight, Sparkles, ChevronRight, FileCode2,
  Wallet, TrendingUp,
} from 'lucide-react';
import BrowserFrame from './BrowserFrame';
import { appNameFromIdea, mockStatsFromIdea } from './appPreviewData';
import type { OrchestratePhase } from '@/hooks/useOrchestrateResult';

const SIDEBAR_ITEMS = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Analytics', icon: BarChart3 },
  { label: 'Customers', icon: Users2 },
  { label: 'Settings', icon: Settings2 },
];

const STAT_ICONS = [Users2, Wallet, TrendingUp];

const STATUS_STYLE: Record<OrchestratePhase, { dot: string; text: string; label: string }> = {
  idle:       { dot: 'bg-slate-600', text: 'text-slate-500', label: 'Idle' },
  planning:   { dot: 'bg-indigo-400 animate-pulse', text: 'text-indigo-300', label: 'Planning' },
  running:    { dot: 'bg-indigo-400 animate-pulse', text: 'text-indigo-300', label: 'Running' },
  rendering:  { dot: 'bg-indigo-400 animate-pulse', text: 'text-indigo-300', label: 'Rendering' },
  completed:  { dot: 'bg-emerald-400', text: 'text-emerald-300', label: 'Live' },
  failed:     { dot: 'bg-rose-400', text: 'text-rose-300', label: 'Failed' },
  cancelled:  { dot: 'bg-slate-500', text: 'text-slate-400', label: 'Cancelled' },
  not_found:  { dot: 'bg-slate-500', text: 'text-slate-400', label: 'Not found' },
  disabled:   { dot: 'bg-amber-400', text: 'text-amber-300', label: 'Unavailable' },
  error:      { dot: 'bg-rose-400', text: 'text-rose-300', label: 'Error' },
};

// Deterministic mini sparkline bars (purely decorative) derived from a stat's
// own delta digits, so each card gets a distinct but stable bar pattern.
function sparkline(seed: string): number[] {
  const digits = seed.replace(/\D/g, '') || '345678';
  return Array.from({ length: 8 }, (_, i) => {
    const d = Number(digits[i % digits.length]) || 4;
    return 22 + d * 6;
  });
}

interface AppPreviewShellProps {
  idea: string;
  phase: OrchestratePhase;
  children: React.ReactNode;
}

export default function AppPreviewShell({ idea, phase, children }: AppPreviewShellProps) {
  const appName = appNameFromIdea(idea);
  const stats = mockStatsFromIdea(idea);
  const busy = phase === 'planning' || phase === 'running' || phase === 'rendering';
  const status = STATUS_STYLE[phase];

  return (
    <BrowserFrame url={`app.korvixai.com/${appName.toLowerCase().replace(/\s+/g, '-')}`} accent="indigo">
      <div className="flex text-white min-h-[70vh]" style={{ background: 'radial-gradient(120% 100% at 0% 0%, #14141f 0%, #0a0a0e 55%, #08080b 100%)' }}>
        {/* Sidebar */}
        <div className="hidden sm:flex flex-col gap-1 w-16 md:w-52 py-5 px-2 md:px-3 border-r border-white/[0.05] shrink-0">
          <div className="flex items-center gap-2 px-1.5 mb-5 pb-4 border-b border-white/[0.05]">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400 shrink-0" />
            <span className="hidden md:block text-[12px] font-semibold text-white truncate">{appName}</span>
          </div>
          {SIDEBAR_ITEMS.map(({ label, icon: Icon }, i) => (
            <div
              key={label}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg border-l-2 transition-colors ${
                i === 0 ? 'bg-white/[0.06] text-indigo-300 border-indigo-400' : 'text-slate-500 border-transparent'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="hidden md:block text-[12px]">{label}</span>
            </div>
          ))}
          <div className="mt-auto pt-4 border-t border-white/[0.05] flex items-center gap-2 px-1.5">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-400/60 to-cyan-400/60 shrink-0" />
            <span className="hidden md:block text-[11px] text-slate-500 truncate">Workspace owner</span>
          </div>
        </div>

        {/* Main */}
        <div className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">
          {/* Topbar */}
          <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
            <div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-600 mb-1">
                <span>{appName}</span>
                <ChevronRight className="w-3 h-3" />
                <span className="text-slate-400">Overview</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                <span className={`text-[11px] ${status.text}`}>{status.label}</span>
              </div>
            </div>
            <div className="hidden md:flex items-center gap-2 flex-1 max-w-xs">
              <div className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                <Search className="w-3 h-3 text-slate-600" />
                <span className="text-[11px] text-slate-600">Search…</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="p-1.5 rounded-lg bg-white/[0.03] border border-white/[0.05]">
                <Bell className="w-3.5 h-3.5 text-slate-500" />
              </div>
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400/60 to-cyan-400/60" />
            </div>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            {stats.map((s, i) => {
              const Icon = STAT_ICONS[i % STAT_ICONS.length];
              return (
                <div key={s.label} className={`p-4 rounded-xl border border-white/[0.07] bg-gradient-to-br from-white/[0.04] to-white/[0.01] backdrop-blur-xl ${busy ? 'animate-pulse' : ''}`}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] text-slate-500">{s.label}</p>
                    <div className="w-6 h-6 rounded-md bg-white/[0.05] flex items-center justify-center">
                      <Icon className="w-3 h-3 text-indigo-300" />
                    </div>
                  </div>
                  <div className="flex items-end justify-between gap-2 mb-3">
                    <span className="text-xl font-semibold text-white">{s.value}</span>
                    <span className={`flex items-center gap-0.5 text-[10px] ${s.positive ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {s.positive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {s.delta}
                    </span>
                  </div>
                  <div className="flex items-end gap-0.5 h-8">
                    {sparkline(s.value + s.delta).map((h, j) => (
                      <div
                        key={j}
                        className={`flex-1 rounded-sm ${s.positive ? 'bg-emerald-400/30' : 'bg-rose-400/30'}`}
                        style={{ height: `${h}%` }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Primary CTA */}
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <p className="text-[12px] text-slate-500">Generated result for your idea</p>
            <button className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-cyan-400 text-black text-[11px] font-semibold">
              <Sparkles className="w-3 h-3" /> Refine with AI
            </button>
          </div>

          {/* Real backend-driven content */}
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.015] overflow-hidden">
            <div className="relative flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.05]">
              <FileCode2 className="w-3.5 h-3.5 text-indigo-300" />
              <span className="text-[11px] font-medium text-slate-300">Generated artifact</span>
              {busy && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-gradient-to-r from-indigo-500 via-cyan-400 to-indigo-500 animate-pulse-soft" />
              )}
            </div>
            <div className="p-3.5 sm:p-5">
              {children}
            </div>
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}
