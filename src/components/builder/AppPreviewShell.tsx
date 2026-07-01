// AppPreviewShell — premium SaaS-style dashboard chrome wrapped around the
// real, backend-driven <PreviewResult/>. Adds a device frame, topbar,
// category-aware sidebar, generated module cards, key metrics and a
// workflow/activity panel derived from the user's idea, so the result area
// always looks like a real product workspace. The actual artifact
// (iframe/code/markdown/etc.) still renders exactly as PreviewResult
// decides, untouched, inside the artifact preview zone below the chrome.
import {
  LayoutDashboard, BarChart3, Users2, Settings2, Search, Bell,
  ArrowUpRight, ArrowDownRight, Sparkles, ChevronRight, FileCode2,
  ShoppingCart, Package, ShieldCheck, GraduationCap, MessageCircle,
  Layers, Building2, Crown, Wrench, Gauge, Activity,
} from 'lucide-react';
import BrowserFrame from './BrowserFrame';
import { appNameFromIdea, chromeFromIdea, type ChromeIcon } from './appPreviewData';
import { CATEGORY_LABELS, type BuilderPalette } from './promptCategory';
import type { OrchestratePhase } from '@/hooks/useOrchestrateResult';

const ICONS: Record<ChromeIcon, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard, chart: BarChart3, users: Users2, settings: Settings2,
  cart: ShoppingCart, package: Package, shield: ShieldCheck, graduation: GraduationCap,
  chat: MessageCircle, layers: Layers, building: Building2, crown: Crown,
  wrench: Wrench, gauge: Gauge, activity: Activity,
};

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

const TONE_DOT: Record<'positive' | 'neutral' | 'warning', string> = {
  positive: 'bg-emerald-400', neutral: 'bg-slate-500', warning: 'bg-amber-400',
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
  palette: BuilderPalette;
  /** Overrides the idea-derived app name — set once the user renames the app via the refine panel. */
  nameOverride?: string | null;
  children: React.ReactNode;
}

export default function AppPreviewShell({ idea, phase, palette, nameOverride, children }: AppPreviewShellProps) {
  const appName = (nameOverride || '').trim() || appNameFromIdea(idea);
  const chrome = chromeFromIdea(idea);
  const busy = phase === 'planning' || phase === 'running' || phase === 'rendering';
  const failed = phase === 'failed' || phase === 'error' || phase === 'cancelled' || phase === 'not_found';
  const status = STATUS_STYLE[phase];
  const grad = `linear-gradient(135deg, ${palette.accent}, ${palette.accent2})`;

  const artifactHeaderLabel = failed ? 'Artifact unavailable' : busy ? 'Generating artifact…' : 'Generated artifact';

  return (
    <BrowserFrame url={`app.korvixai.com/${appName.toLowerCase().replace(/\s+/g, '-')}`} accentColor={palette.accent}>
      <div className="flex text-white min-h-[70vh]" style={{ background: 'radial-gradient(120% 100% at 0% 0%, #14141f 0%, #0a0a0e 55%, #08080b 100%)' }}>
        {/* Sidebar — category-aware */}
        <div className="hidden sm:flex flex-col gap-1 w-16 md:w-52 py-5 px-2 md:px-3 border-r border-white/[0.05] shrink-0">
          <div className="flex items-center gap-2 px-1.5 mb-5 pb-4 border-b border-white/[0.05]">
            <div className="w-7 h-7 rounded-lg shrink-0" style={{ background: grad }} />
            <span className="hidden md:block text-[12px] font-semibold text-white truncate">{appName}</span>
          </div>
          {chrome.sidebar.map(({ label, icon }, i) => {
            const Icon = ICONS[icon];
            return (
              <div
                key={label}
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg border-l-2 transition-colors"
                style={i === 0
                  ? { background: 'rgba(255,255,255,0.06)', color: palette.accent, borderColor: palette.accent }
                  : { color: '#64748b', borderColor: 'transparent' }}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="hidden md:block text-[12px]">{label}</span>
              </div>
            );
          })}
          <div className="mt-auto pt-4 border-t border-white/[0.05] flex items-center gap-2 px-1.5">
            <div className="w-6 h-6 rounded-full shrink-0" style={{ background: grad, opacity: 0.7 }} />
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
                <span className="text-slate-400">{CATEGORY_LABELS[chrome.category]}</span>
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
              <div className="w-7 h-7 rounded-full" style={{ background: grad, opacity: 0.7 }} />
            </div>
          </div>

          {/* Key metrics */}
          <div className={`grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 transition-opacity ${failed ? 'opacity-50' : ''}`}>
            {chrome.stats.map((s, i) => {
              const Icon = ICONS[chrome.modules[i % chrome.modules.length].icon];
              return (
                <div key={s.label} className={`p-4 rounded-xl border border-white/[0.07] bg-gradient-to-br from-white/[0.04] to-white/[0.01] backdrop-blur-xl ${busy ? 'animate-pulse' : ''}`}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] text-slate-500">{s.label}</p>
                    <div className="w-6 h-6 rounded-md bg-white/[0.05] flex items-center justify-center">
                      <Icon className="w-3 h-3" style={{ color: palette.accent }} />
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

          {/* Generated module cards */}
          <div className={`grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6 transition-opacity ${failed ? 'opacity-50' : ''}`}>
            {chrome.modules.map((m) => {
              const Icon = ICONS[m.icon];
              return (
                <div key={m.label} className={`p-4 rounded-xl border border-white/[0.06] bg-white/[0.02] ${busy ? 'animate-pulse-soft' : ''}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 rounded-md border flex items-center justify-center shrink-0" style={{ background: `${palette.accent}1f`, borderColor: `${palette.accent}33` }}>
                      <Icon className="w-3 h-3" style={{ color: palette.accent }} />
                    </div>
                    <p className="text-[12px] font-medium text-white truncate">{m.label}</p>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed">{m.desc}</p>
                </div>
              );
            })}
          </div>

          {/* Primary CTA */}
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <p className="text-[12px] text-slate-500">Generated result for your idea</p>
            <button className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[11px] font-semibold" style={{ background: grad, color: palette.onAccent }}>
              <Sparkles className="w-3 h-3" /> Refine with AI
            </button>
          </div>

          {/* Artifact preview zone + workflow/activity panel */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className={`lg:col-span-2 rounded-2xl border overflow-hidden ${failed ? 'border-rose-500/15' : 'border-white/[0.07]'} bg-white/[0.015]`}>
              <div className="relative flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.05]">
                <FileCode2 className="w-3.5 h-3.5" style={{ color: failed ? '#fda4af' : palette.accent }} />
                <span className="text-[11px] font-medium text-slate-300">{artifactHeaderLabel}</span>
                {busy && (
                  <div className="absolute bottom-0 left-0 right-0 h-[2px] animate-pulse-soft" style={{ background: `linear-gradient(90deg, ${palette.accent}, ${palette.accent2}, ${palette.accent})` }} />
                )}
              </div>
              <div className="p-3.5 sm:p-5">
                {children}
              </div>
            </div>

            {/* Workflow / activity panel */}
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.015] overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.05]">
                <Activity className="w-3.5 h-3.5" style={{ color: palette.accent }} />
                <span className="text-[11px] font-medium text-slate-300">Workflow activity</span>
              </div>
              <div className="p-3.5 sm:p-4 space-y-3">
                {chrome.activity.map((a) => (
                  <div key={a.title} className="flex items-start gap-2.5">
                    <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${TONE_DOT[a.tone]}`} />
                    <div className="min-w-0">
                      <p className="text-[11px] text-slate-300 leading-snug">{a.title}</p>
                      <p className="text-[10px] text-slate-600 mt-0.5">{a.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </BrowserFrame>
  );
}
