import { MessageSquare, Globe, Smartphone, Gamepad2, X } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { useOwnerMode } from '@/hooks/useOwnerMode';
import { type KorvixMode, KORVIX_MODES } from '@/lib/korvixMode';

/**
 * Korvix builder-home mode selection — a Kimi/ChatGPT-style tool picker for the
 * unified Chat home. Chips SELECT a mode as routing context; they never insert
 * text into the composer. The selected build mode (website/app/game) shows as a
 * small premium blue pill attached to the composer, with an X to clear it. Chat
 * is the neutral default and shows no pill.
 */
type Meta = { icon: typeof Globe; en: string; tr: string };

const META: Record<KorvixMode, Meta> = {
  chat:    { icon: MessageSquare, en: 'Chat',    tr: 'Sohbet' },
  website: { icon: Globe,         en: 'Website', tr: 'Web Sitesi' },
  app:     { icon: Smartphone,    en: 'App',     tr: 'Uygulama' },
  game:    { icon: Gamepad2,      en: 'Game',    tr: 'Oyun' },
};

export function korvixModeLabel(mode: KorvixMode, lang: string): string {
  return lang === 'tr' ? META[mode].tr : META[mode].en;
}

/* ── Chip row (empty home) ───────────────────────────────────────────── */
export function KorvixModeChips({
  selected, onSelect,
}: {
  selected: KorvixMode | null;
  onSelect: (mode: KorvixMode) => void;
}) {
  const { lang } = useLanguageStore();
  const { isOwner } = useOwnerMode();
  // Phase 14A — the unfinished Game surface is owner-only; drop its chip for normal users.
  const modes = KORVIX_MODES.filter((mode) => mode !== 'game' || isOwner);
  return (
    <div className="mb-2.5 flex flex-wrap items-center justify-center gap-1.5">
      {modes.map((mode) => {
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
                : 'border-white/[0.07] bg-white/[0.02] text-[#CBD5E1] hover:border-[#3B82F6]/25 hover:bg-[#3B82F6]/[0.06] hover:text-white'
            }`}
          >
            <Icon className="h-3.5 w-3.5 text-[#60A5FA]" />
            {korvixModeLabel(mode, lang)}
          </button>
        );
      })}
    </div>
  );
}

/* ── Selected-mode pill (attached to the composer) ───────────────────── */
export function KorvixModePill({
  mode, onRemove,
}: {
  mode: KorvixMode;
  onRemove: () => void;
}) {
  const { lang } = useLanguageStore();
  // Chat is the neutral/default mode — it never renders a pill, so the
  // composer stays clean when Chat is selected.
  if (mode === 'chat') return null;
  const { icon: Icon } = META[mode];
  return (
    <span
      className="inline-flex w-fit items-center gap-1.5 rounded-full border border-[#3B82F6]/35 bg-[#3B82F6]/[0.12] py-1 pl-2.5 pr-1.5 text-[11.5px] font-medium text-[#93C5FD]"
      style={{ boxShadow: '0 0 0 1px rgba(59,130,246,0.08), 0 0 10px rgba(59,130,246,0.14)' }}
    >
      <Icon className="h-3 w-3 text-[#60A5FA]" />
      {korvixModeLabel(mode, lang)}
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
