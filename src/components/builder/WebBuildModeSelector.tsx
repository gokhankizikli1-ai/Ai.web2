import { Globe, Smartphone, Gamepad2, FileText, ShoppingBag, X } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import {
  type BuilderMode, PRIMARY_MODES, SECONDARY_MODES,
} from '@/lib/builderMode';

/**
 * Web Build mode selection — a Kimi/ChatGPT-style "tool" picker. The chip row
 * (empty state) SELECTS a build mode as hidden context; it never inserts text
 * into the composer. The selected mode is shown as a small premium blue pill
 * attached to the composer, with an X to clear it. One primary mode at a time.
 */
type Meta = { icon: typeof Globe; en: string; tr: string };

const META: Record<BuilderMode, Meta> = {
  website:   { icon: Globe,      en: 'Website',      tr: 'Web Sitesi' },
  app:       { icon: Smartphone, en: 'App',          tr: 'Uygulama' },
  game:      { icon: Gamepad2,   en: 'Game',         tr: 'Oyun' },
  landing:   { icon: FileText,   en: 'Landing Page', tr: 'Açılış Sayfası' },
  ecommerce: { icon: ShoppingBag, en: 'Ecommerce',   tr: 'E-Ticaret' },
};

export function modeLabel(mode: BuilderMode, lang: string): string {
  const m = META[mode];
  return lang === 'tr' ? m.tr : m.en;
}

/* ── The chip row (empty state) ──────────────────────────────────────── */
export function WebBuildModeChips({
  selected, onSelect,
}: {
  selected: BuilderMode | null;
  onSelect: (mode: BuilderMode) => void;
}) {
  const { lang } = useLanguageStore();
  const chip = (mode: BuilderMode, secondary: boolean) => {
    const { icon: Icon } = META[mode];
    const active = selected === mode;
    return (
      <button
        key={mode}
        type="button"
        onClick={() => onSelect(mode)}
        aria-pressed={active}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] transition-colors ${
          active
            ? 'border-[#3B82F6]/40 bg-[#3B82F6]/[0.12] text-[#93C5FD]'
            : `border-white/[0.07] bg-white/[0.02] text-[#CBD5E1] hover:border-[#3B82F6]/25 hover:bg-[#3B82F6]/[0.06] hover:text-white ${secondary ? 'opacity-75' : ''}`
        }`}
      >
        <Icon className={`h-3.5 w-3.5 ${active ? 'text-[#60A5FA]' : 'text-[#60A5FA]'}`} />
        {modeLabel(mode, lang)}
      </button>
    );
  };
  return (
    <div className="mb-2.5 flex flex-wrap items-center justify-center gap-1.5">
      {PRIMARY_MODES.map((m) => chip(m, false))}
      <span className="mx-0.5 h-3.5 w-px bg-white/[0.08]" aria-hidden="true" />
      {SECONDARY_MODES.map((m) => chip(m, true))}
    </div>
  );
}

/* ── The selected-mode pill (attached to the composer) ───────────────── */
export function WebBuildModePill({
  mode, onRemove,
}: {
  mode: BuilderMode;
  onRemove: () => void;
}) {
  const { lang } = useLanguageStore();
  const { icon: Icon } = META[mode];
  return (
    <span
      className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[#3B82F6]/35 bg-[#3B82F6]/[0.12] py-1 pl-2.5 pr-1.5 text-[11.5px] font-medium text-[#93C5FD]"
      style={{ boxShadow: '0 0 0 1px rgba(59,130,246,0.08), 0 0 10px rgba(59,130,246,0.14)' }}
    >
      <Icon className="h-3 w-3 text-[#60A5FA]" />
      {modeLabel(mode, lang)}
      <button
        type="button"
        onClick={onRemove}
        aria-label="remove"
        className="flex h-4 w-4 items-center justify-center rounded-full text-[#93C5FD]/70 transition-colors hover:bg-[#3B82F6]/20 hover:text-white"
      >
        <X className="h-3 w-3" strokeWidth={2.5} />
      </button>
    </span>
  );
}
