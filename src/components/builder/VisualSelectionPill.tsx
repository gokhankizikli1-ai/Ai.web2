import { MousePointerSquareDashed, X, ImageIcon, Undo2 } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { selectionLabel, type VisualSelection } from '@/lib/visualSelection';
import type { StockImageResult } from '@/lib/stockImages';

/**
 * VisualSelectionPill (Phase 14K.1 · image actions 14K.2) — a compact, removable
 * context card for the currently selected preview element.
 *
 * In 14K.1 this was read-only selection context. 14K.2 adds IMAGE actions when
 * the selection resolves to a genuine, replaceable photo: a "Search stock photos"
 * button, and — once a stock photo is applied — an honest "applied to this
 * preview only" note with attribution and a Cancel-preview control. It never
 * persists anything, never touches the composer/prompt, and never invokes AI.
 *
 * All fixed copy is localized via t().
 */
export default function VisualSelectionPill({
  selection, onClear, canReplaceImage = false, onSearchStock, applied = null, onCancelPreview,
}: {
  selection: VisualSelection | null;
  onClear: () => void;
  /** The selection resolves to a replaceable content image. */
  canReplaceImage?: boolean;
  /** Open the stock photo picker for the selected image. */
  onSearchStock?: () => void;
  /** A stock photo currently applied to THIS preview (temporary, not saved). */
  applied?: StockImageResult | null;
  /** Revert the applied preview back to the original image. */
  onCancelPreview?: () => void;
}) {
  const { t } = useLanguageStore();
  if (!selection) return <div aria-live="polite" className="min-h-0" />;

  return (
    <div aria-live="polite" className="min-h-0">
      <div className="rounded-xl border border-[#3B82F6]/30 bg-[#3B82F6]/[0.08] px-3 py-2">
        <div className="flex items-center gap-2.5">
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

        {/* Image actions — only when the selection is a genuine replaceable photo. */}
        {canReplaceImage && (
          <div className="mt-2 border-t border-white/[0.06] pt-2">
            {applied ? (
              <div className="flex items-center gap-2.5">
                <img
                  src={applied.thumbnailUrl}
                  alt=""
                  className="h-9 w-12 shrink-0 rounded-md border border-white/[0.08] object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium text-[#93C5FD]">
                    {t('stockPhotoBy')} {applied.photographerName} ·{' '}
                    {applied.provider === 'unsplash' ? t('stockProviderUnsplash') : t('stockProviderPexels')}
                  </p>
                  <p className="truncate text-[10.5px] text-[#7C8C9B]">{t('stockAppliedNote')}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={onSearchStock}
                    className="rounded-md px-2 py-1 text-[10.5px] font-medium text-[#93C5FD] transition-colors hover:bg-white/[0.06]"
                  >
                    {t('stockReplaceImage')}
                  </button>
                  <button
                    type="button"
                    onClick={onCancelPreview}
                    title={t('stockCancelPreview')}
                    className="inline-flex items-center gap-1 rounded-md border border-white/[0.1] px-2 py-1 text-[10.5px] text-[#CBD5E1] transition-colors hover:bg-white/[0.06]"
                  >
                    <Undo2 className="h-3 w-3" /> {t('stockCancelPreview')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={onSearchStock}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#3B82F6]/30 bg-[#3B82F6]/[0.1] px-2.5 py-1.5 text-[11.5px] font-medium text-[#93C5FD] transition-colors hover:bg-[#3B82F6]/[0.16]"
              >
                <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" /> {t('stockSearchStock')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
