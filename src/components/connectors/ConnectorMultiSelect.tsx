/**
 * ConnectorMultiSelect — the soft multi-pick list used by connector pickers that
 * bind MORE THAN ONE provider resource to a Korvix project.
 *
 * WHY THIS EXISTS
 * ---------------
 * `ConnectorSelect` is the ONE dropdown for single-choice pickers (a GitHub
 * repo, a Vercel project). Slack is the first connector where a project binds
 * several resources at once — a handful of channels — and a dropdown cannot
 * express "these four, not those two hundred" or show why a row is unavailable.
 * Rather than bend the single-select primitive out of shape, this is the same
 * visual language expressed as a bounded checklist.
 *
 * BUILT ON WHAT IS ALREADY HERE
 * -----------------------------
 * No new dependency and no new component library: plain buttons carrying the
 * exact surface treatment the connector cards already use
 * (`rgba(255,255,255,0.03)` fill, `rgba(255,255,255,0.10)` border, `#3B82F6`
 * accent), matching `ConnectorSelect`'s trigger.
 *
 * ACCESSIBILITY
 * -------------
 * Each row is a real `<button role="checkbox">` with `aria-checked`, so it is
 * reachable and toggleable by keyboard with no custom key handling, and the
 * group carries `role="group"` + `aria-label`. An option that cannot be chosen
 * is a genuinely `disabled` button with its reason rendered as visible text —
 * never a silently inert row.
 *
 * BOUNDED BY THE SERVER, ECHOED BY THE UI
 * ---------------------------------------
 * `max` is the server-enforced cap (the backend REFUSES an over-long selection
 * rather than silently truncating it). The control blocks further selection at
 * the cap and says so, so the user is never surprised by a rejection.
 */
import { Check, Lock } from 'lucide-react';

export interface ConnectorMultiSelectOption {
  /** The value handed back in `onChange` — an id, never a display string. */
  value: string;
  /** Primary line. Falls back to `value` when a provider returns no name. */
  label: string;
  /** Optional dimmed suffix ("private", framework, …). */
  hint?: string;
  /** When true the row cannot be selected. */
  disabled?: boolean;
  /** Visible explanation shown on a disabled row — never a silent no-op. */
  disabledReason?: string;
}

export interface ConnectorMultiSelectProps {
  options: ConnectorMultiSelectOption[];
  /** Currently selected values. */
  selected: string[];
  onChange: (next: string[]) => void;
  /** Accessible name — these pickers have no visible <label>. */
  ariaLabel: string;
  /** Server-enforced maximum number of selections. */
  max: number;
  disabled?: boolean;
}

const ROW = [
  'w-full flex items-center gap-2.5 px-3 h-10 rounded-lg text-left',
  'text-[13px] transition-colors',
  'focus:outline-none focus-visible:ring-1 focus-visible:ring-[#3B82F6]/40',
].join(' ');

const BOX = 'h-4 w-4 shrink-0 rounded-[5px] border flex items-center justify-center transition-colors';

export default function ConnectorMultiSelect({
  options, selected, onChange, ariaLabel, max, disabled = false,
}: ConnectorMultiSelectProps) {
  const chosen = new Set(selected);
  const atCap = chosen.size >= max;

  const toggle = (value: string) => {
    if (chosen.has(value)) onChange(selected.filter((v) => v !== value));
    else if (!atCap) onChange([...selected, value]);
  };

  return (
    <div className="space-y-1.5">
      <div
        role="group"
        aria-label={ariaLabel}
        className="max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.02] p-1"
      >
        {options.length === 0 && (
          <div className="px-3 py-3 text-[12.5px] text-white/35">Nothing to choose yet.</div>
        )}
        {options.map((opt) => {
          const isChosen = chosen.has(opt.value);
          // A row is blocked either because the provider says so, or because the
          // server-enforced cap is already reached (deselecting is always allowed).
          const blocked = disabled || !!opt.disabled || (atCap && !isChosen);
          return (
            <button
              key={opt.value}
              type="button"
              role="checkbox"
              aria-checked={isChosen}
              disabled={blocked}
              onClick={() => toggle(opt.value)}
              className={`${ROW} ${
                isChosen ? 'bg-[#3B82F6]/[0.12] text-white'
                  : blocked ? 'text-white/25 cursor-not-allowed'
                    : 'text-white/75 hover:bg-white/[0.05] hover:text-white'
              }`}
            >
              <span
                className={BOX}
                style={{
                  borderColor: isChosen ? 'rgba(59,130,246,0.55)' : 'rgba(255,255,255,0.16)',
                  background: isChosen ? 'rgba(59,130,246,0.28)' : 'transparent',
                }}
              >
                {isChosen && <Check className="h-3 w-3" />}
              </span>
              <span className="min-w-0 flex-1 truncate">{opt.label || opt.value}</span>
              {opt.hint && (
                <span className="shrink-0 inline-flex items-center gap-1 text-[11.5px] text-white/35">
                  {opt.hint === 'private' && <Lock className="h-3 w-3" />}
                  {opt.hint}
                </span>
              )}
              {opt.disabled && opt.disabledReason && (
                <span className="shrink-0 text-[11px] text-white/30">{opt.disabledReason}</span>
              )}
            </button>
          );
        })}
      </div>
      <div className="text-[11.5px] text-white/30">
        {selected.length} of {max} selected
        {atCap && <span className="text-white/45"> · limit reached</span>}
      </div>
    </div>
  );
}
