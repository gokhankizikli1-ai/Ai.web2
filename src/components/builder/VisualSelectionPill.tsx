import { useRef } from 'react';
import { MousePointerSquareDashed, X, ImageIcon, Undo2, Upload, Check, Loader2, AlertTriangle } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { selectionLabel, type VisualSelection } from '@/lib/visualSelection';
import { UPLOAD_ACCEPT } from '@/lib/webBuildImageUpload';
import type { StockImageResult } from '@/lib/stockImages';

/**
 * VisualSelectionPill (14K.1 selection · 14K.2 stock actions · 14K.6 device upload).
 *
 * For a replaceable image it shows honest EXAMPLE-image editor language (the auto-
 * sourced photo is a Korvix example, not the user's own content), the "Search stock
 * photos" and "Upload from device" actions, and — while a device image previews in
 * place — a "Use this image / Cancel" confirm bar. The uploaded image is only
 * PERMANENTLY saved after the user confirms. All copy is localized via t().
 */
export default function VisualSelectionPill({
  selection, onClear, canReplaceImage = false, onSearchStock, applied = null, onCancelPreview,
  isExampleImage = false, onPickDeviceImage, uploading = false, uploadErrorText = null,
  uploadPending = false, onConfirmUpload, onCancelUpload, savedNote = false,
}: {
  selection: VisualSelection | null;
  onClear: () => void;
  canReplaceImage?: boolean;
  onSearchStock?: () => void;
  applied?: StockImageResult | null;
  onCancelPreview?: () => void;
  /* ── 14K.6 device upload ── */
  /** The selected image is an auto-sourced Korvix example photo. */
  isExampleImage?: boolean;
  /** The user picked a device image file (already validated by the browser input). */
  onPickDeviceImage?: (file: File) => void;
  uploading?: boolean;
  uploadErrorText?: string | null;
  /** A device image is previewing in place, awaiting the user's confirmation. */
  uploadPending?: boolean;
  onConfirmUpload?: () => void;
  onCancelUpload?: () => void;
  /** Show the transient "saved to project" confirmation. */
  savedNote?: boolean;
}) {
  const { t } = useLanguageStore();
  const fileRef = useRef<HTMLInputElement | null>(null);

  if (!selection) return <div aria-live="polite" className="min-h-0" />;

  const pickFile = () => fileRef.current?.click();
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the value so selecting the SAME file again still fires onChange.
    e.target.value = '';
    if (file && onPickDeviceImage) onPickDeviceImage(file);
  };

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

        {canReplaceImage && (
          <div className="mt-2 border-t border-white/[0.06] pt-2">
            {/* Hidden native file input — real <input type="file">, accessible name. */}
            <input
              ref={fileRef}
              type="file"
              accept={UPLOAD_ACCEPT}
              aria-label={t('imgUploadFromDevice')}
              className="sr-only"
              onChange={onFileChange}
            />

            {uploadPending ? (
              /* A device image is previewing in place — confirm or cancel. */
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 text-[11px] font-medium text-[#93C5FD]">{t('imgYourImage')}</p>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={onConfirmUpload}
                    className="inline-flex items-center gap-1 rounded-md border border-[#3B82F6]/40 bg-[#3B82F6]/[0.14] px-2.5 py-1 text-[11px] font-medium text-[#93C5FD] transition-colors hover:bg-[#3B82F6]/[0.2]"
                  >
                    <Check className="h-3 w-3" /> {t('imgUseThisImage')}
                  </button>
                  <button
                    type="button"
                    onClick={onCancelUpload}
                    className="inline-flex items-center gap-1 rounded-md border border-white/[0.1] px-2.5 py-1 text-[11px] text-[#CBD5E1] transition-colors hover:bg-white/[0.06]"
                  >
                    <Undo2 className="h-3 w-3" /> {t('stockCancel')}
                  </button>
                </div>
              </div>
            ) : applied ? (
              /* Existing stock temporary preview (unchanged — preview-only in this PR). */
              <div className="flex items-center gap-2.5">
                <img src={applied.thumbnailUrl} alt="" className="h-9 w-12 shrink-0 rounded-md border border-white/[0.08] object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium text-[#93C5FD]">
                    {t('stockPhotoBy')} {applied.photographerName} ·{' '}
                    {applied.provider === 'unsplash' ? t('stockProviderUnsplash') : t('stockProviderPexels')}
                  </p>
                  <p className="truncate text-[10.5px] text-[#7C8C9B]">{t('stockAppliedNote')}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button type="button" onClick={onSearchStock} className="rounded-md px-2 py-1 text-[10.5px] font-medium text-[#93C5FD] transition-colors hover:bg-white/[0.06]">
                    {t('stockReplaceImage')}
                  </button>
                  <button type="button" onClick={onCancelPreview} title={t('stockCancelPreview')} className="inline-flex items-center gap-1 rounded-md border border-white/[0.1] px-2 py-1 text-[10.5px] text-[#CBD5E1] transition-colors hover:bg-white/[0.06]">
                    <Undo2 className="h-3 w-3" /> {t('stockCancelPreview')}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Honest example-image treatment for an auto-sourced photo. */}
                {isExampleImage && (
                  <div className="mb-2">
                    <p className="text-[11px] font-medium text-[#DCE7F5]">{t('imgExampleImage')}</p>
                    <p className="text-[10.5px] leading-relaxed text-[#8FA6BA]">{t('imgExampleImageNote')}</p>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onSearchStock}
                    disabled={uploading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#3B82F6]/30 bg-[#3B82F6]/[0.1] px-2.5 py-1.5 text-[11.5px] font-medium text-[#93C5FD] transition-colors hover:bg-[#3B82F6]/[0.16] disabled:opacity-40"
                  >
                    <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" /> {t('stockSearchStock')}
                  </button>
                  <button
                    type="button"
                    onClick={pickFile}
                    disabled={uploading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-white/[0.04] px-2.5 py-1.5 text-[11.5px] font-medium text-[#CBD5E1] transition-colors hover:bg-white/[0.08] disabled:opacity-40"
                  >
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Upload className="h-3.5 w-3.5" aria-hidden="true" />}
                    {uploading ? t('imgUploading') : t('imgUploadFromDevice')}
                  </button>
                </div>
              </>
            )}

            {uploadErrorText && (
              <p role="alert" className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#F59E0B]">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" /> {uploadErrorText}
              </p>
            )}
            {savedNote && !uploadErrorText && (
              <p role="status" className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#4ADE80]">
                <Check className="h-3 w-3" aria-hidden="true" /> {t('imgSavedToProject')}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
