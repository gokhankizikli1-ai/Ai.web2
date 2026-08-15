/**
 * ConnectorSelect — the ONE dropdown used by every connector picker.
 *
 * WHY THIS EXISTS
 * ---------------
 * The connector pickers (GitHub account, GitHub repository, Vercel project, and
 * the page's own Korvix project selector) each rendered a raw `<select>`. A
 * native select cannot be styled beyond its box: the popup is drawn by the OS,
 * so it lands as a bright rectangular list on a near-black page and breaks the
 * Korvix surface. This replaces all of them with one soft, rounded, dark
 * control.
 *
 * BUILT ON WHAT IS ALREADY HERE
 * -----------------------------
 * This is a thin skin over `@/components/ui/select` (the existing shadcn/Radix
 * primitive already in the repo, backed by `@radix-ui/react-select`, already a
 * dependency). NO new component library and no new dependency is introduced —
 * this file only supplies Korvix dark-theme classes and a small
 * options-array API so a caller doesn't hand-roll `SelectItem` children.
 *
 * Radix gives the accessibility requirements for free, and they are exercised
 * by the primitive rather than reimplemented here:
 *   · full keyboard operation (Enter/Space to open, type-ahead to jump)
 *   · ArrowUp/ArrowDown/Home/End to move the highlighted option
 *   · Escape closes and returns focus to the trigger
 *   · correct `role="combobox"`/`listbox` semantics and `aria-expanded`
 *   · focus is trapped in the open panel and restored on close
 *
 * LAYOUT
 * ------
 * The trigger is a fixed-height flex row whose label cell is `min-w-0 truncate`,
 * so a long `owner/really-long-repository-name` ellipsizes instead of widening
 * the control — the selected value can never change the layout. The panel is
 * width-matched to the trigger via Radix's `--radix-select-trigger-width`, so
 * opening it causes no shift.
 *
 * BEHAVIOUR IS UNCHANGED
 * ----------------------
 * `value`/`onChange` carry the same string ids the native selects did, so the
 * selection authority, the API calls, and the disabled/loading states in the
 * connector cards are untouched.
 */
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

export interface ConnectorSelectOption {
  /** The value handed back to `onChange` — an id, never a display string. */
  value: string;
  /** Primary line. Falls back to `value` when a provider returns no name. */
  label: string;
  /** Optional dimmed suffix (framework, account type, "private", …). */
  hint?: string;
}

export interface ConnectorSelectProps {
  /** Currently selected option value. */
  value: string;
  onChange: (value: string) => void;
  options: ConnectorSelectOption[];
  /** Accessible name — these pickers have no visible <label>. */
  ariaLabel: string;
  /** Shown when nothing is selected yet. */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/* Soft, compact, dark — deliberately matching the connector cards' own
 * `rgba(255,255,255,0.03)` / `rgba(255,255,255,0.10)` surface treatment and the
 * `#3B82F6` focus accent used by the page's buttons. */
const TRIGGER_CLASS = [
  'w-full h-10 px-3 rounded-lg',
  'bg-white/[0.03] border border-white/10',
  'text-[13px] text-white',
  'hover:bg-white/[0.05] hover:border-white/[0.14]',
  'focus:outline-none focus-visible:ring-0',
  'focus:border-[#3B82F6]/40 data-[state=open]:border-[#3B82F6]/40',
  'data-[placeholder]:text-white/35',
  'disabled:opacity-50 disabled:cursor-not-allowed',
  'transition-colors',
  // The chevron is supplied by SelectTrigger; keep it dim and never shrinking.
  '[&_svg]:opacity-60 [&_svg]:shrink-0',
].join(' ');

const CONTENT_CLASS = [
  'rounded-xl border border-white/10 p-1',
  'bg-[#0d1117] text-white shadow-[0_16px_40px_-12px_rgba(0,0,0,0.8)]',
  'backdrop-blur-xl',
  // Long lists stay usable without the panel growing off-screen.
  'max-h-64',
  // Lock the panel to the trigger's width. The shared primitive only sets
  // `min-w-[--radix-select-trigger-width]`, which still lets a single long
  // option (a deep `owner/repository` path) widen the panel until it overhangs
  // the control. Pinning the width instead makes the options truncate — the
  // panel is a menu, not a place to read a full path.
  'w-[var(--radix-select-trigger-width)]',
  // The primitive's viewport carries `w-full` in popper mode; make sure it can
  // also shrink so the truncation below actually engages.
  '[&_[data-radix-select-viewport]]:min-w-0',
].join(' ');

const ITEM_CLASS = [
  'w-full min-w-0 rounded-lg py-2 pl-2.5 pr-8 text-[13px] text-white/80',
  // Radix wraps the label in its own <span> (SelectPrimitive.ItemText), which
  // sits between the flex row and our truncating label. Without `min-w-0` that
  // wrapper refuses to shrink, so a long option is HARD-CLIPPED by the panel
  // edge instead of ellipsizing. Letting it shrink restores the "…".
  '[&>span:last-child]:min-w-0 [&>span:last-child]:flex-1 [&>span:last-child]:overflow-hidden',
  // Radix moves DOM focus onto the highlighted item, so the browser would paint
  // its own focus ring on top of our highlight. Suppress it and use the tint.
  'outline-none focus:outline-none',
  'focus:bg-[#3B82F6]/[0.14] focus:text-white',
  'data-[state=checked]:text-white',
  'cursor-pointer',
].join(' ');

export default function ConnectorSelect({
  value, onChange, options, ariaLabel, placeholder = 'Select…',
  disabled = false, className = '',
}: ConnectorSelectProps) {
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        aria-label={ariaLabel}
        className={`${TRIGGER_CLASS} ${className}`}
      >
        {/* min-w-0 + truncate on the value cell is what keeps a long repo or
            project name from widening the trigger. */}
        <SelectValue placeholder={placeholder} className="min-w-0 truncate" />
      </SelectTrigger>
      {/* `position="popper"` anchors the panel under the trigger and exposes
          --radix-select-trigger-width, so the panel matches the control's width
          instead of resizing to its widest option (no layout jump). */}
      <SelectContent position="popper" align="start" sideOffset={6} className={CONTENT_CLASS}>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className={ITEM_CLASS}>
            {/* `w-full min-w-0` on the row + `min-w-0 truncate` on the label is
                the chain that ellipsizes a long option inside the width-locked
                panel. The hint never shrinks, so it stays readable. */}
            <span className="flex w-full min-w-0 items-baseline gap-1.5">
              <span className="min-w-0 truncate">{opt.label || opt.value}</span>
              {opt.hint && (
                <span className="shrink-0 text-[11.5px] text-white/35">{opt.hint}</span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
