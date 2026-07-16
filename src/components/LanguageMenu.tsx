import { Globe, Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu';
import { useLanguageStore, LANGUAGES, type LangMode } from '@/stores/languageStore';

/**
 * Public language control (Phase 14J.3).
 *
 * The language store already supports and persists `auto | en | tr | de` under
 * `korvix-language` and resolves `auto` from the device locale. The public
 * Navbar simply never exposed a control — so the effective language (e.g.
 * German on a German device) was invisible and unchangeable from `/`. This adds
 * a visible, accessible control that goes ONLY through the store's `setMode`
 * (persistence, `auto` resolution, and English fallback all stay in the store —
 * no second store, no direct localStorage writes, no overriding a legitimate
 * persisted choice).
 *
 * The trigger shows the currently EFFECTIVE language code (EN/TR/DE) so the
 * active language is always visible; the menu shows which MODE is selected
 * (Auto vs an explicit language) with an accessible radio group.
 */

/** Options: Auto (device) + every fully-supported language, by endonym. */
function useOptions(): { value: LangMode; label: string }[] {
  const { t } = useLanguageStore();
  return [
    { value: 'auto', label: t('langAuto') },
    ...LANGUAGES.map((l) => ({ value: l.code as LangMode, label: l.label })),
  ];
}

/** Desktop: compact globe + effective code, opening an accessible radio menu. */
export function LanguageMenu({ surface = 'light' }: { surface?: 'light' | 'dark' }) {
  const { mode, lang, setMode, t } = useLanguageStore();
  const options = useOptions();
  const isDark = surface === 'dark';
  const trigger = isDark
    ? 'text-slate-200 hover:text-white border-white/15 hover:bg-white/10'
    : 'text-slate-600 hover:text-slate-900 border-slate-200 hover:bg-slate-100/60';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('langMenuLabel')}
        className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#3B82F6]/50 ${trigger}`}
      >
        <Globe aria-hidden="true" className="h-3.5 w-3.5" />
        <span>{lang.toUpperCase()}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[168px]">
        <DropdownMenuLabel>{t('language')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setMode(v as LangMode)}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value} className="text-[13px]">
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Mobile: an inline, clearly-labeled language section for the existing Navbar
 * Sheet (no second modal). Real buttons with an accessible selected state
 * (`aria-pressed` + a check, not color alone).
 */
export function LanguageOptionsList({ onSelect }: { onSelect?: () => void }) {
  const { mode, setMode, t } = useLanguageStore();
  const options = useOptions();
  return (
    <div role="group" aria-label={t('langMenuLabel')}>
      <div className="mb-1 flex items-center gap-2 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Globe aria-hidden="true" className="h-3.5 w-3.5" />
        {t('language')}
      </div>
      {options.map((o) => {
        const active = mode === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => { setMode(o.value); onSelect?.(); }}
            className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              active ? 'text-slate-900 bg-slate-100' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/60'
            }`}
          >
            {o.label}
            {active && <Check aria-hidden="true" className="h-4 w-4 text-[#3B82F6]" />}
          </button>
        );
      })}
    </div>
  );
}
