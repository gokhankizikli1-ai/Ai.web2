// BuilderProgressCard — the premium "generating" state shared by Website
// Builder and App Builder. Replaces the plain spinner + one line of text
// with a build-step checklist and a shimmering progress rail, so waiting
// for a result reads as "Korvix is actively working" rather than "the page
// is frozen." Purely presentational — callers still own the real phase
// label; this never fabricates backend progress.
import { Loader2 } from 'lucide-react';

interface BuilderProgressCardProps {
  label: string;
  steps?: string[];
  accent?: string;
  accent2?: string;
}

const DEFAULT_STEPS = [
  'Understanding the idea',
  'Locking the design direction',
  'Composing sections',
  'Rendering the premium preview',
];

export default function BuilderProgressCard({
  label, steps = DEFAULT_STEPS, accent = '#8B5CF6', accent2 = '#8B5CF6',
}: BuilderProgressCardProps) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.015] p-8">
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-70"
        style={{ background: `radial-gradient(60% 80% at 50% 0%, ${accent}22, transparent 70%)` }}
      />
      <div className="flex items-center gap-3 mb-6">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ background: `linear-gradient(135deg, ${accent}33, ${accent2}22)`, border: `1px solid ${accent}40` }}
        >
          <Loader2 className="h-4 w-4 animate-spin" style={{ color: accent }} />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-white truncate">{label}</p>
          <p className="text-[11px] text-[#858B99]">Korvix is building your preview</p>
        </div>
      </div>

      <div className="space-y-2.5">
        {steps.map((step, i) => (
          <div key={step} className="flex items-center gap-2.5">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full animate-pulse-soft"
              style={{ background: accent, animationDelay: `${i * 220}ms` }}
            />
            <span className="text-[12px] text-[#B6BBC6]">{step}</span>
          </div>
        ))}
      </div>

      <div className="mt-6 h-[3px] w-full overflow-hidden rounded-full bg-white/[0.04]">
        <div
          className="h-full w-1/3 rounded-full animate-shimmer"
          style={{
            background: `linear-gradient(90deg, transparent, ${accent}, ${accent2}, transparent)`,
            backgroundSize: '200% 100%',
          }}
        />
      </div>
    </div>
  );
}
