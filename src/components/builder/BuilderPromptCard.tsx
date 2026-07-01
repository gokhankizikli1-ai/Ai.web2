// BuilderPromptCard — the shared "describe your idea" input row used by
// both Website Builder and App Builder. Centralizes the input + generate
// button + example-prompt chips so both surfaces share one premium look and
// one interaction pattern, instead of two near-identical hand-rolled forms.
import { Loader2, Wand2 } from 'lucide-react';

interface BuilderPromptCardProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  ctaLabel: string;
  busy: boolean;
  busyLabel?: string;
  accent: string;
  accent2?: string;
  examples?: string[];
  onExampleSelect?: (example: string) => void;
}

export default function BuilderPromptCard({
  value, onChange, onSubmit, placeholder, ctaLabel, busy, busyLabel,
  accent, accent2, examples = [], onExampleSelect,
}: BuilderPromptCardProps) {
  return (
    <div
      className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3 sm:p-3.5 backdrop-blur-xl"
      style={{ boxShadow: `0 0 0 1px rgba(255,255,255,0.02), 0 20px 50px -30px ${accent}55` }}
    >
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 h-12 px-4 rounded-xl bg-black/20 border border-white/[0.05] text-[14px] text-slate-200 placeholder:text-slate-600 focus:outline-none transition-all"
          style={{ borderColor: value ? `${accent}30` : undefined }}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        />
        <button
          onClick={onSubmit}
          disabled={busy || !value.trim()}
          className="h-12 px-5 sm:px-6 rounded-xl font-semibold text-[13px] flex items-center gap-2 shrink-0 transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110"
          style={{
            background: `linear-gradient(135deg, ${accent}, ${accent2 || accent})`,
            color: '#05060a',
          }}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
          <span className="hidden sm:inline">{busy ? (busyLabel || ctaLabel) : ctaLabel}</span>
        </button>
      </div>

      {examples.length > 0 && (
        <div className="flex gap-1.5 mt-2.5 flex-wrap px-0.5">
          {examples.map((ex) => (
            <button
              key={ex}
              onClick={() => onExampleSelect?.(ex)}
              className="px-2.5 py-1 rounded-lg bg-white/[0.02] border border-white/[0.04] text-[11px] text-slate-500 hover:text-slate-300 hover:border-white/[0.08] transition-all"
            >
              {ex}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
