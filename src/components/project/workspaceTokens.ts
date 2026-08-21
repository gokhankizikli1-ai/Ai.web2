/**
 * The Project Workspace's shared surface language — tokens, tones and the one
 * time helper every row uses.
 *
 * Deliberately a plain module rather than part of `WorkspaceSurface.tsx`: a
 * file that exports both components and constants breaks React Fast Refresh,
 * and the lint rule that says so is right. Keeping them apart also makes the
 * boundary honest — this file decides how the workspace LOOKS, and nothing in
 * it can render or fetch anything.
 */
import { useCallback } from 'react';
import { relativeTime, relativeTimeKey } from '@/lib/projectWorkspace';

export type T = (key: string, params?: Record<string, string | number>) => string;

/* ── Surface tokens — the authenticated dark workspace language ───────────────
   The hierarchy is carried by TYPE and SPACE, not by chrome. `PANEL` is
   deliberately rare: it marks the one block on the page that is genuinely a
   distinct object (the Focus), plus the modal. Everything else is a heading, a
   row and a rule, which is what lets a scan find the important thing instead of
   meeting nine equal boxes. */
export const PANEL = 'rounded-2xl border border-white/[0.06] bg-white/[0.02]';
export const SECTION_TITLE =
  'flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/35';
export const HEADER_BTN =
  'inline-flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-[12px] text-white/65 hover:text-white hover:bg-white/[0.06] border border-white/[0.07] transition-all';
export const PRIMARY_BTN =
  'inline-flex items-center gap-1.5 rounded-lg px-3 h-8 text-[12px] font-medium text-[#BFDBFE] bg-[#3B82F6]/[0.14] border border-[#3B82F6]/30 hover:bg-[#3B82F6]/[0.22] transition-all';
export const SMALL_BTN =
  'inline-flex items-center gap-1 rounded-md border border-white/[0.07] px-2 h-6 text-[11px] text-white/50 hover:text-white hover:bg-white/[0.06] transition-all';
/** A low-chrome disclosure. No border, no background — it reads as a link until
 *  you reach for it, which is what keeps it off every row's critical path. */
export const QUIET_BTN =
  'inline-flex items-center gap-1 rounded-md px-1 h-6 text-[11px] text-white/40 hover:text-white/80 transition-colors';
export const EMPTY_TEXT = 'text-[12.5px] leading-relaxed text-white/35';
export const RULE = 'border-t border-white/[0.06]';

export const TONE_STYLE: Record<
  'critical' | 'warning' | 'info' | 'positive',
  { dot: string; text: string }
> = {
  critical: { dot: '#F87171', text: '#FCA5A5' },
  warning: { dot: '#FBBF24', text: '#FCD34D' },
  info: { dot: '#60A5FA', text: '#93C5FD' },
  positive: { dot: '#4ADE80', text: '#86EFAC' },
};

/** Relative time rendered through the locale dictionary (never hardcoded). */
export function useTimeAgo(t: T) {
  return useCallback((iso?: string | null): string => {
    const rel = relativeTime(iso);
    if (!rel) return '';
    return rel.unit === 'now'
      ? t(relativeTimeKey(rel))
      : t(relativeTimeKey(rel), { value: rel.value });
  }, [t]);
}

