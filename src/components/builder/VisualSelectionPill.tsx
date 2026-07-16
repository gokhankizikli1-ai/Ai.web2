import { MousePointerSquareDashed, X } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { selectionLabel, type VisualSelection } from '@/lib/visualSelection';

/**
 * VisualSelectionPill (Phase 14K.1) — a compact, removable context card that
 * shows the currently selected preview element. It is READ-ONLY selection
 * context: it does not modify the composer, does not insert prompt text, does
 * not send a message, and does not invoke AI. It simply makes the selection
 * visible so the next phase can connect it to a scoped AI edit.
 *
 * A polite live region announces confirmed selection / clear only (never hover).
 * All fixed copy is localized via t().
 */
export default function VisualSelectionPill({
  selection, onClear,
}: {
  selection: VisualSelection | null;
  onClear: () => void;
}) {
  const { t } = useLanguageStore();

  return (
    <div aria-live="polite" className="min-h-0">
      {selection && (
        <div className="flex items-center gap-2.5 rounded-xl border border-[#3B82F6]/30 bg-[#3B82F6]/[0.08] px-3 py-2">
          <MousePointerSquareDashed aria-hidden="true" className="h-4 w-4 shrink-0 text-[#60A5FA]" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium text-[#DCE7F5]">
              <span className="sr-only">{t('vsSelectedElement')}: </span>
              {selectionLabel(selection, t)}
            </p>
            {(selection.textPreview || selection.tagName) && (
              <p className="truncate text-[11px] text-[#8FA6BA]">
                <span className="font-mono">{selection.tagName}</span>
                {selection.textPreview ? <span className="text-[#7C8C9B]"> · “{selection.textPreview}”</span> : null}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClear}
            aria-label={t('vsClear')}
            title={t('vsClear')}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[#93A3B5] transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3B82F6]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
