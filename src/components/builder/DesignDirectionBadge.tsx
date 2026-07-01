// DesignDirectionBadge — a small, premium chip that surfaces what Korvix
// understood about a build: the detected product category and (once
// answered) the locked design direction. Shared by Website Builder and App
// Builder so both surfaces show the same "Korvix is paying attention" cue.
import { Palette, Sparkles } from 'lucide-react';
import type { BuilderPalette } from './promptCategory';

interface DesignDirectionBadgeProps {
  categoryLabel: string;
  designSummary?: string | null;
  palette: BuilderPalette;
}

export default function DesignDirectionBadge({ categoryLabel, designSummary, palette }: DesignDirectionBadgeProps) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium backdrop-blur-xl"
      style={{ borderColor: palette.ring, background: `linear-gradient(90deg, ${palette.glow}, transparent)` }}
    >
      <Sparkles className="h-3 w-3 shrink-0" style={{ color: palette.accent }} />
      <span className="text-white/85">{categoryLabel}</span>
      {designSummary && (
        <>
          <span className="text-white/20">·</span>
          <Palette className="h-3 w-3 shrink-0 text-white/40" />
          <span className="text-white/50">{designSummary}</span>
        </>
      )}
    </div>
  );
}
