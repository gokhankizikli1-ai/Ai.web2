// AppPreviewShell — premium SaaS-style dashboard chrome wrapped around the
// real, backend-driven <PreviewResult/>. Adds a device frame, topbar,
// sidebar and mock stat cards derived from the user's idea so the result
// area always looks like a real product surface — the actual artifact
// (iframe/code/markdown/etc.) still renders exactly as PreviewResult decides,
// untouched, inside the content panel below the mock chrome.
import {
  LayoutDashboard, BarChart3, Users2, Settings2, Search, Bell,
  ArrowUpRight, ArrowDownRight, Sparkles,
} from 'lucide-react';
import BrowserFrame from './BrowserFrame';
import { appNameFromIdea, mockStatsFromIdea } from './appPreviewData';
import type { OrchestratePhase } from '@/hooks/useOrchestrateResult';

const SIDEBAR_ICONS = [LayoutDashboard, BarChart3, Users2, Settings2];

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
      <div className="flex text-white" style={{ background: 'radial-gradient(120% 100% at 0% 0%, #14141f 0%, #0a0a0e 55%, #08080b 100%)' }}>
        {/* Sidebar */}
        <div className="hidden sm:flex flex-col items-center gap-4 w-14 py-5 border-r border-white/[0.05] shrink-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400 mb-2" />
          {SIDEBAR_ICONS.map((Icon, i) => (
            <div key={i} className={`p-2 rounded-lg ${i === 0 ? 'bg-white/[0.06] text-indigo-300' : 'text-slate-600'}`}>
              <Icon className="w-4 h-4" />
            </div>
          ))}
        </div>

        {/* Main */}
        <div className="flex-1 min-w-0 p-4 sm:p-6">
          {/* Topbar */}
          <div className="flex items-center justify-between gap-3 mb-6">
            <div>
              <h2 className="text-[15px] font-semibold text-white leading-tight">{appName}</h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                <span className={`text-[10px] ${status.text}`}>{status.label}</span>
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
            {stats.map((s) => (
              <div key={s.label} className={`p-3.5 rounded-xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-xl ${busy ? 'animate-pulse' : ''}`}>
                <p className="text-[10px] text-slate-500 mb-1">{s.label}</p>
                <div className="flex items-end justify-between gap-2">
                  <span className="text-lg font-semibold text-white">{s.value}</span>
                  <span className={`flex items-center gap-0.5 text-[10px] ${s.positive ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {s.positive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                    {s.delta}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Primary CTA */}
          <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
            <p className="text-[11px] text-slate-500">Generated result for your idea</p>
            <button className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-indigo-500 to-cyan-400 text-black text-[11px] font-semibold">
              <Sparkles className="w-3 h-3" /> Refine with AI
            </button>
          </div>

          {/* Real backend-driven content */}
          <div className="rounded-2xl border border-white/[0.06] bg-black/20 p-1">
            {children}
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}
