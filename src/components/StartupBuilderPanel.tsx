import { useState, useEffect } from 'react';
import {
  Rocket, Target, AlertTriangle, ListChecks, Map, Info, ChevronRight, Sparkles,
} from 'lucide-react';

/**
 * Startup Builder — Phase 3 increment 3.
 *
 * A structured planning canvas. Every field is the user's OWN input
 * (persisted locally) — nothing about markets/competition is fabricated.
 * "Generate plan" routes a structured prompt into the normal chat.
 */
const LS_KEY = 'korvix.startup.v1';

interface StartupState {
  idea: string; customer: string; pain: string; solution: string;
  positioning: string; monetization: string; mvp: Record<string, boolean>;
}
const MVP_ITEMS = [
  'Core value flow works end-to-end',
  'A single primary user can sign up & use it',
  'One key success metric is instrumented',
  'Manual ops are acceptable (no premature automation)',
  'Landing page with a clear single CTA',
  'Feedback loop with ~5 target users',
];
const ROADMAP = [
  { phase: 'Validate', detail: 'Problem interviews; confirm the pain is real and urgent.' },
  { phase: 'Build MVP', detail: 'Smallest credible version of the core value flow.' },
  { phase: 'Private beta', detail: 'Hand-held onboarding for the first users; watch retention.' },
  { phase: 'Public launch', detail: 'One channel, one message, one clear CTA.' },
  { phase: 'Iterate', detail: 'Double down on what retains; cut the rest.' },
];
const DEFAULT: StartupState = {
  idea: '', customer: '', pain: '', solution: '', positioning: '', monetization: '',
  mvp: Object.fromEntries(MVP_ITEMS.map((m) => [m, false])),
};

function load(): StartupState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      return { ...DEFAULT, ...o, mvp: { ...DEFAULT.mvp, ...(o?.mvp || {}) } };
    }
  } catch { /* ignore */ }
  return DEFAULT;
}

function Area({ label, value, ph, onChange }: {
  label: string; value: string; ph: string; onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-[10px] text-slate-500 block mb-1">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        placeholder={ph}
        className="w-full px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[11px] text-slate-300 placeholder:text-slate-700 focus:outline-none focus:border-indigo-500/20 transition-all resize-none"
      />
    </div>
  );
}

export default function StartupBuilderPanel({ onRunPrompt }: { onRunPrompt?: (p: string) => void }) {
  const [s, setS] = useState<StartupState>(load);
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* ignore */ } }, [s]);
  const set = (patch: Partial<StartupState>) => setS((prev) => ({ ...prev, ...patch }));
  const toggleMvp = (k: string) => setS((prev) => ({ ...prev, mvp: { ...prev.mvp, [k]: !prev.mvp[k] } }));

  const fields: [keyof StartupState, string][] = [
    ['idea', 'Idea summary'], ['customer', 'Target customer'], ['pain', 'Pain point'],
    ['solution', 'Solution'], ['positioning', 'Market positioning'], ['monetization', 'Monetization model'],
  ];
  const missing = fields.filter(([k]) => !String(s[k]).trim()).map(([, label]) => label);
  const mvpDone = MVP_ITEMS.filter((m) => s.mvp[m]).length;

  const nextActions = missing.length
    ? [`Fill in: ${missing.join(', ')} to sharpen the plan.`,
       'Run 5 problem interviews before building.',
       'Define one success metric and instrument it.']
    : ['Run 5 problem interviews to validate the pain.',
       'Ship the MVP checklist items still open.',
       'Pick one acquisition channel and test it small.'];

  const summary = () => fields
    .map(([k, label]) => String(s[k]).trim() && `${label}: ${String(s[k]).trim()}`)
    .filter(Boolean).join('\n');
  const TAIL =
    '\n\nAct as a startup advisor: concise, structured, brutally honest. ' +
    'Do not fabricate market sizes, competitor figures, or traction — ' +
    'state where real research/validation is needed. Ask one clarifying question only if essential.';
  const route = (prompt: string) =>
    onRunPrompt?.(prompt + (summary() ? `\n\nMy canvas so far:\n${summary()}` : '') + TAIL);

  const btn = (label: string, prompt: string, Icon: typeof Sparkles) => (
    <button
      onClick={() => route(prompt)}
      className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[11px] text-slate-300 hover:border-indigo-500/20 hover:bg-indigo-500/[0.03] transition-all"
    >
      <span className="flex items-center gap-2"><Icon className="w-3.5 h-3.5 text-indigo-400/70" />{label}</span>
      <ChevronRight className="w-3.5 h-3.5 text-slate-600" />
    </button>
  );

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Rocket className="w-3.5 h-3.5 text-indigo-400" />
        <span className="text-[12px] font-medium text-slate-300">Startup builder</span>
      </div>

      {/* Canvas */}
      <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <Area label="Idea summary" value={s.idea} ph="One-line: what it is & for whom" onChange={(v) => set({ idea: v })} />
        <Area label="Target customer" value={s.customer} ph="Who specifically?" onChange={(v) => set({ customer: v })} />
        <Area label="Pain point" value={s.pain} ph="The urgent problem" onChange={(v) => set({ pain: v })} />
        <Area label="Solution" value={s.solution} ph="How you solve it" onChange={(v) => set({ solution: v })} />
        <Area label="Market positioning" value={s.positioning} ph="Vs alternatives / status quo" onChange={(v) => set({ positioning: v })} />
        <Area label="Monetization model" value={s.monetization} ph="How it makes money" onChange={(v) => set({ monetization: v })} />
      </div>

      {/* MVP checklist */}
      <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2"><ListChecks className="w-3.5 h-3.5 text-slate-500" /><span className="text-[12px] font-medium text-slate-300">MVP checklist</span></div>
          <span className="text-[10px] text-slate-500">{mvpDone}/{MVP_ITEMS.length}</span>
        </div>
        <div className="space-y-1.5">
          {MVP_ITEMS.map((m) => (
            <button key={m} onClick={() => toggleMvp(m)} className="w-full flex items-center gap-2 text-left text-[11px] group">
              <span className={`h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0 ${s.mvp[m] ? 'bg-indigo-500/40 border-indigo-500/40' : 'border-white/[0.1] group-hover:border-white/[0.2]'}`}>
                {s.mvp[m] && <span className="text-[8px] text-white">✓</span>}
              </span>
              <span className={s.mvp[m] ? 'text-slate-500 line-through' : 'text-slate-400'}>{m}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Launch roadmap (static template) */}
      <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-4">
        <div className="flex items-center gap-2 mb-2"><Map className="w-3.5 h-3.5 text-slate-500" /><span className="text-[12px] font-medium text-slate-300">Launch roadmap</span></div>
        <div className="space-y-1.5">
          {ROADMAP.map((r, i) => (
            <div key={r.phase} className="flex items-start gap-2.5">
              <span className="mt-0.5 h-4 w-4 rounded-full bg-indigo-500/[0.1] border border-indigo-500/20 text-[9px] text-indigo-400 flex items-center justify-center shrink-0">{i + 1}</span>
              <div><span className="text-[11px] font-medium text-slate-300">{r.phase}</span><p className="text-[10px] text-slate-600 leading-relaxed">{r.detail}</p></div>
            </div>
          ))}
        </div>
      </div>

      {/* Risks / next actions */}
      <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-4">
        <div className="flex items-center gap-2 mb-2"><AlertTriangle className="w-3.5 h-3.5 text-amber-400/70" /><span className="text-[12px] font-medium text-slate-300">Next actions</span></div>
        <ul className="space-y-1.5">
          {nextActions.map((a) => (
            <li key={a} className="flex items-start gap-2 text-[11px] text-slate-400 leading-relaxed">
              <span className="mt-1 h-1 w-1 rounded-full bg-slate-600 shrink-0" />{a}
            </li>
          ))}
        </ul>
      </div>

      {/* AI routing */}
      <div className="space-y-1.5">
        <p className="text-[9px] uppercase tracking-wide text-slate-600">Build with AI (routes to chat)</p>
        {btn('Generate full startup plan', 'Turn my canvas into a structured startup plan: sharpened positioning, GTM, MVP scope, launch roadmap, key risks, and the next 3 actions.', Rocket)}
        {btn('Pressure-test the idea', 'Pressure-test my startup idea: the riskiest assumption, why it might fail, and the cheapest experiment to de-risk it.', AlertTriangle)}
        {btn('Refine positioning', 'Refine my market positioning into one sharp statement and contrast it with the status-quo alternative.', Target)}
        {btn('Stress-test monetization', 'Stress-test my monetization model: pricing logic, willingness to pay, and 2 alternative models.', Sparkles)}
      </div>

      <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04]">
        <Info className="w-3.5 h-3.5 text-slate-600 shrink-0 mt-0.5" />
        <p className="text-[10px] text-slate-600 leading-relaxed">
          Planning canvas saved locally. No live market/competition data is connected —
          AI outputs are guidance, not validated research.
        </p>
      </div>
    </div>
  );
}
