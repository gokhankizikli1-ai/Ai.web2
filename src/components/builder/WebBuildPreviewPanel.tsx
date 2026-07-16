import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { ExternalLink, MousePointerSquareDashed } from 'lucide-react';
import BrowserFrame from '@/components/builder/BrowserFrame';
import WebBuildPreviewDocument from '@/components/builder/WebBuildPreviewDocument';
import WebBuildModelNativePreview, { CandidateUnapprovedNotice, RuntimeDiagnosticsBlock } from '@/components/builder/WebBuildModelNativePreview';
import VisualSelectSurface, { type VisualSelectHandle } from '@/components/builder/VisualSelectSurface';
import VisualSelectionPill from '@/components/builder/VisualSelectionPill';
import StockImagePicker from '@/components/builder/StockImagePicker';
import type { VisualSelection, VisualImageTarget } from '@/lib/visualSelection';
import { trackStockDownload, type StockImageResult } from '@/lib/stockImages';
import { useOwnerMode } from '@/hooks/useOwnerMode';
import { useLanguageStore } from '@/stores/languageStore';
import { openPreviewInNewTab, currentReturnTo } from '@/lib/webBuildPreviewStash';
import { resolvePreviewMode, type ModelNativeCandidate, type ModelNativeRuntimeSnapshot, type OwnerPreviewSelection, type WebBuildPreviewMode } from '@/lib/webBuildRuntimePreview';
import type { WebBuildSectionItem, WebBuildFile } from '@/lib/webBuildPayload';
import type { WebBuildBrief } from '@/lib/webBuildApi';
import type { InteractionContract } from '@/lib/webBuildInteractionContract';
import type { VisualAssetPlan, VisualSignaturePlan, MotionComposerArtifact, ImagePipelineArtifact, FrontendBuilderPreviewSource } from '@/lib/webBuildAgents';

/**
 * The in-app preview drawer. Renders the REAL generated page (headline, copy,
 * CTA, cards, testimonials, appointment form, footer) from the section copy —
 * not a grey skeleton — inside a browser frame, plus an "Open preview" button
 * that opens the same page full-screen at /preview/web-build in a new tab.
 */
const ACCENT = '#60A5FA';

/**
 * Local error isolation for the preview document ONLY. If the rendered preview
 * throws (an invalid page model, an unexpected browser global, etc.) this keeps
 * the failure contained inside the drawer's browser frame — the surrounding
 * Web Build conversation, chat result and workspace stay mounted and visible.
 * Without this boundary a render throw would unwind to the nearest ancestor
 * boundary and blank the whole chat workspace.
 */
class PreviewErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the failure local to the drawer; never let it reach the workspace.
    if (typeof console !== 'undefined') console.error('WebBuildPreview render failed', error, info);
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

export default function WebBuildPreviewPanel({
  sectionItems, brief, slug, runId, files, previewSource, blockedNeedsRegeneration, candidate, interactionContract, visualAssetPlan, visualSignaturePlan, motionComposer, imagePipeline,
}: {
  sectionItems: WebBuildSectionItem[];
  brief: WebBuildBrief;
  slug?: string;
  runId?: string;
  /** Phase 12D — the consumed model-native file set (present when the dedicated
   *  Frontend Builder project became the active project). Optional → legacy builds. */
  files?: WebBuildFile[];
  /** Phase 12D — which renderer drives the Preview: the isolated Sandpack runtime for
   *  the model-native project, or the deterministic legacy section renderer. */
  previewSource?: FrontendBuilderPreviewSource;
  /** Phase 12F.3 — the frontend build could not be approved (acceptance
   *  'manual-review-required'). The user-facing Preview shows the deterministic safe
   *  fallback plus an explicit "Build needs regeneration" notice; the unapproved
   *  model-native files remain reachable in All Files. Optional → old builds unaffected. */
  blockedNeedsRegeneration?: boolean;
  /** Phase 13A — the derived model-native candidate (consumed or parsed-initial). Drives
   *  the three explicit Preview modes and the owner Candidate/Safe selector. Optional →
   *  old builds fall back to the legacy previewSource path. */
  candidate?: ModelNativeCandidate;
  /** Phase 2 — the strategy's Interaction Contract (optional). Passed straight to
   *  the preview document so its actions become real in-app behaviour. */
  interactionContract?: InteractionContract;
  /** Phase 5 Visual Asset Plan (data only) — passed to the preview so its premium
   *  visual layer can render concept-specific CSS/SVG. Optional. */
  visualAssetPlan?: VisualAssetPlan;
  /** Phase 9E-1 Visual Signature Plan (data only) — drives the preview's
   *  concept-specific signature visuals (chat-flow rail, integration orbit, …). */
  visualSignaturePlan?: VisualSignaturePlan;
  /** Phase 10B Motion Composer plan (data only) — subtle CSS motion layers the
   *  preview renders (reduced-motion safe; no video). Optional. */
  motionComposer?: MotionComposerArtifact;
  /** Phase 10C Image Pipeline plan (data only) — honest image placeholders the
   *  preview renders (manual-upload / provider-ready / illustrative). Optional. */
  imagePipeline?: ImagePipelineArtifact;
}) {
  const { t, lang } = useLanguageStore();
  const { isOwner } = useOwnerMode();
  const url = slug || 'preview.korvix.build';
  // Set when "Open preview" could not write/verify the localStorage stash (full
  // storage) — we surface it inline instead of opening a broken standalone route.
  const [openFailed, setOpenFailed] = useState(false);

  // Never trust the inputs to be well-formed: an undefined/null section list or
  // brief must not crash the drawer. Treat sections as an array and the brief as
  // a safe object so the preview document always receives valid props.
  const items = Array.isArray(sectionItems) ? sectionItems.filter(Boolean) : [];
  const safeBrief = (brief || {}) as WebBuildBrief;

  // Phase 13A — the model-native candidate + three explicit Preview modes. The candidate's
  // files drive the isolated Sandpack runtime; the mode decides whether a normal user sees
  // the approved model-native site, an owner sees the unapproved candidate, or everyone
  // sees the deterministic safe fallback. Never rewrites acceptance/payload/files.
  const legacyFiles = Array.isArray(files) ? files.filter(Boolean) : [];
  const candidateAvailable = !!candidate?.available;
  const nativeFiles = candidate?.files?.length ? candidate.files : legacyFiles;

  // Owner's local Candidate/Safe choice (UI state only). Reset when the run/candidate
  // changes so a previous selection never leaks onto a different build.
  const [ownerSel, setOwnerSel] = useState<OwnerPreviewSelection | undefined>(undefined);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<ModelNativeRuntimeSnapshot | null>(null);
  const candidateKey = `${runId || ''}|${candidate?.source || 'none'}|${candidate?.files?.length ?? 0}`;
  useEffect(() => { setOwnerSel(undefined); setRuntimeSnapshot(null); }, [candidateKey]);

  // ── Visual Edit (Phase 14K.1) — selection foundation for the safe-fallback
  // preview only. Hooks live here (before any early return) to respect the rules
  // of hooks. A new build / revision (resetKey) clears mode + selection so a
  // target from one build never lingers into another.
  const [selectEnabled, setSelectEnabled] = useState(false);
  const [selection, setSelection] = useState<VisualSelection | null>(null);
  // Phase 14K.2 — image target + stock picker + temporary applied preview.
  const [imageTarget, setImageTarget] = useState<VisualImageTarget | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [applied, setApplied] = useState<StockImageResult | null>(null);
  const surfaceRef = useRef<VisualSelectHandle>(null);
  const resetKey = `${runId || ''}|${url}|${items.map((s) => s?.id || '').join(',')}`;
  useEffect(() => {
    setSelectEnabled(false); setSelection(null);
    setImageTarget(null); setPickerOpen(false); setApplied(null);
  }, [resetKey]);

  // A new / changed selection restores any live preview and resets image state,
  // then re-derives whether the new target is a replaceable photo.
  const handleSelect = (sel: VisualSelection | null) => {
    surfaceRef.current?.restoreSelectedImage();
    setApplied(null);
    setPickerOpen(false);
    setSelection(sel);
    setImageTarget(sel ? (surfaceRef.current?.getSelectedImageTarget() ?? null) : null);
  };

  const clearSelection = () => {
    surfaceRef.current?.restoreSelectedImage();
    setApplied(null); setImageTarget(null); setPickerOpen(false); setSelection(null);
    surfaceRef.current?.clear();
  };

  // Preview a candidate photo live (temporary). Preload first to avoid a flash of
  // a broken image, then swap the selected image's source in place.
  const previewCandidate = (r: StockImageResult | null) => {
    const surf = surfaceRef.current;
    if (!surf) return;
    if (!r) { surf.restoreSelectedImage(); return; }
    const pre = new Image();
    const swap = () => surf.previewSelectedImage(r.previewUrl);
    pre.onload = swap;
    pre.onerror = swap; // still attempt; the browser shows its own honest fallback
    pre.src = r.previewUrl;
  };

  // Apply keeps the photo in THIS live preview only (never persisted) and fires
  // the provider's required usage event (Unsplash download tracking).
  const applyCandidate = (r: StockImageResult) => {
    surfaceRef.current?.previewSelectedImage(r.previewUrl);
    void trackStockDownload(r);
    setApplied(r);
    setPickerOpen(false);
  };

  // Closing the picker without applying: return to the last applied photo if one
  // exists, otherwise restore the exact original image.
  const closePicker = () => {
    setPickerOpen(false);
    const surf = surfaceRef.current;
    if (!surf) return;
    if (applied) surf.previewSelectedImage(applied.previewUrl);
    else surf.restoreSelectedImage();
  };

  // Undo an applied preview — back to the original image.
  const cancelApplied = () => {
    surfaceRef.current?.restoreSelectedImage();
    setApplied(null);
  };

  // A short, safe suggested search query from the selected image's context.
  const suggestQuery = (target: VisualImageTarget | null): string => {
    const raw = (target?.altText || target?.selection.section || target?.selection.textPreview || '').trim();
    const cleaned = raw.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    return cleaned ? cleaned.split(' ').slice(0, 5).join(' ') : '';
  };

  const mode: WebBuildPreviewMode = candidate
    ? resolvePreviewMode(candidate, isOwner, ownerSel)
    : (previewSource === 'model-native-sandbox' && legacyFiles.length > 0 ? 'approved-model-native' : 'safe-fallback');
  const showModelNative = mode === 'approved-model-native' || mode === 'owner-candidate';
  const isCandidateMode = mode === 'owner-candidate';

  // The Open Preview handoff carries EXACTLY the selected embedded mode + its files, so the
  // full-screen route can never silently switch renderers.
  const openPreview = () => {
    const opened = openPreviewInNewTab({
      runId: runId || `preview-${Date.now().toString(36)}`,
      sectionItems: items,
      brief: safeBrief,
      slug: url,
      returnTo: currentReturnTo(),
      previewMode: mode,
      ...(showModelNative && nativeFiles.length > 0
        ? { files: nativeFiles, previewSource: 'model-native-sandbox' as const }
        : {}),
    });
    setOpenFailed(!opened);
  };

  const openFailedNote = openFailed && (
    <p className="max-w-sm text-right text-[11px] leading-relaxed text-[#F59E0B]">
      {lang === 'tr'
        ? 'Tarayıcı depolama alanı dolu olduğu için tam ekran önizleme açılamadı. Uygulama içi önizleme hâlâ kullanılabilir.'
        : 'Could not open full preview because browser storage is full. The in-app preview is still available.'}
    </p>
  );

  // Owner-only segmented selector: Candidate Preview | Safe Preview. Hidden for normal
  // users and when no candidate exists. Selecting a mode is component-local UI state only.
  const ownerSelector = (isOwner && candidateAvailable) ? (
    <div className="mb-3 inline-flex rounded-lg border border-white/[0.1] bg-white/[0.03] p-0.5 text-[11px]">
      <button
        onClick={() => setOwnerSel('model-native')}
        className={`rounded-md px-2.5 py-1 font-medium transition-colors ${mode !== 'safe-fallback' ? 'bg-[#A855F7]/20 text-[#D8B4FE]' : 'text-[#94A3B8] hover:text-white'}`}
      >
        {lang === 'tr' ? 'Aday Önizleme' : 'Candidate Preview'}
      </button>
      <button
        onClick={() => setOwnerSel('safe')}
        className={`rounded-md px-2.5 py-1 font-medium transition-colors ${mode === 'safe-fallback' ? 'bg-white/[0.1] text-white' : 'text-[#94A3B8] hover:text-white'}`}
      >
        {lang === 'tr' ? 'Güvenli Önizleme' : 'Safe Preview'}
      </button>
    </div>
  ) : null;

  const openPreviewButton = (
    <button
      onClick={openPreview}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[#3B82F6]/30 bg-[#3B82F6]/[0.08] px-3 py-1.5 text-[12px] font-medium text-[#93C5FD] transition-colors hover:bg-[#3B82F6]/[0.14]"
    >
      <ExternalLink className="h-3.5 w-3.5" /> {t('wbOpenPreview')}
    </button>
  );

  // Visual Edit — Select mode toggle. Real <button>, aria-pressed, keyboard
  // accessible. Disabled while the build is unstable (needs regeneration). Only
  // rendered on the safe-fallback (direct-DOM) preview path below — the
  // model-native Sandpack iframe is cross-origin and unsupported here.
  const selectButton = (
    <button
      type="button"
      onClick={() => setSelectEnabled((v) => !v)}
      aria-pressed={selectEnabled}
      disabled={!!blockedNeedsRegeneration}
      title={blockedNeedsRegeneration ? t('vsPreviewNotReady') : (selectEnabled ? t('vsExit') : t('vsSelectHint'))}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        selectEnabled
          ? 'border-[#3B82F6]/60 bg-[#3B82F6]/[0.18] text-white'
          : 'border-[#3B82F6]/30 bg-[#3B82F6]/[0.06] text-[#93C5FD] hover:bg-[#3B82F6]/[0.12]'
      }`}
    >
      <MousePointerSquareDashed className="h-3.5 w-3.5" aria-hidden="true" /> {t('vsSelect')}
    </button>
  );

  if (showModelNative && nativeFiles.length > 0) {
    // Isolated model-native runtime Preview inside the existing browser frame. In
    // owner-candidate mode the actual UNAPPROVED generated project runs, framed by an
    // explicit warning + bounded runtime diagnostics. Approved mode stays clean.
    return (
      <div>
        {isCandidateMode && candidate ? <CandidateUnapprovedNotice candidate={candidate} /> : null}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>{ownerSelector}</div>
          <div className="flex flex-col items-end gap-2">
            {openPreviewButton}
            {openFailedNote}
          </div>
        </div>
        <BrowserFrame url={url} accentColor={ACCENT}>
          <WebBuildModelNativePreview
            files={nativeFiles}
            mode="embedded"
            {...(isCandidateMode ? { candidate: true, showRuntimeDiagnostics: isOwner, onRuntimeSnapshot: setRuntimeSnapshot } : {})}
          />
        </BrowserFrame>
        {isCandidateMode && candidate ? (
          <RuntimeDiagnosticsBlock snapshot={runtimeSnapshot} candidate={candidate} />
        ) : (
          <p className="mt-2 text-[11px] text-[#64748B]">
            {lang === 'tr'
              ? 'Doğrulanmış model-native proje izole bir çalıştırma ortamında önizleniyor.'
              : 'The validated model-native project is previewed in an isolated runtime.'}
          </p>
        )}
      </div>
    );
  }

  // Phase 12F.3 — explicit "Build needs regeneration" notice shown when the frontend build
  // could not be approved. Honest: the shown preview is a safe fallback, not the finished site.
  const blockedBanner = blockedNeedsRegeneration ? (
    <div className="mb-3 rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/[0.08] px-3.5 py-2.5">
      <p className="text-[12px] font-semibold text-[#FBBF24]">
        {lang === 'tr' ? 'Yapı yeniden oluşturulmalı' : 'Build needs regeneration'}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-[#FCD9A6]">
        {lang === 'tr'
          ? 'Oluşturulan ön yüz projesi kalite incelemesini geçemedi; onaylanmamış proje bitmiş bir site olarak gösterilmiyor. Aşağıdaki güvenli önizleme geçicidir. Onaylanmamış dosyalar Tüm Dosyalar’dan incelenebilir.'
          : 'The generated frontend project did not pass quality review, so the unapproved project is not shown as a finished site. The safe preview below is a fallback. The unapproved files remain inspectable in All Files.'}
      </p>
    </div>
  ) : null;

  if (items.length === 0) {
    return (
      <div>
        {blockedBanner}
        {ownerSelector}
        <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-8 text-center text-[12px] text-[#64748B]">{t('wbPreviewEmpty')}</div>
      </div>
    );
  }

  // Stable signature for the current preview instance. Keying the boundary by it
  // forces a remount (and clears any stuck error state) whenever the preview
  // input actually changes — so a fixed/changed build is never permanently
  // hidden behind a boundary that caught an earlier, unrelated failure.
  const previewKey = `${runId || ''}|${url}|${items.map((s) => s?.id || '').join(',')}`;

  // Compact, honest fallback shown INSIDE the browser frame if the preview
  // document cannot render. No fake claims — real section names only, and a
  // reminder that All Files is still reachable from the conversation.
  const firstNames = items.map((s) => s?.name).filter(Boolean).slice(0, 3) as string[];
  const previewFallback = (
    <div className="px-6 py-12 text-center">
      <p className="text-[14px] font-semibold text-white">
        {lang === 'tr' ? 'Önizleme oluşturulamadı' : 'Preview could not render'}
      </p>
      <p className="mx-auto mt-2 max-w-sm text-[12px] leading-relaxed text-[#94A3B8]">
        {lang === 'tr'
          ? 'Bu önizleme görüntülenirken bir sorun oluştu. Oluşturulan sonucunuz etkilenmedi.'
          : 'Something went wrong rendering this preview. Your generated result is unaffected.'}
      </p>
      {firstNames.length > 0 && (
        <div className="mx-auto mt-4 flex max-w-sm flex-wrap justify-center gap-2">
          {firstNames.map((n, i) => (
            <span key={i} className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[11px] text-[#94A3B8]">{n}</span>
          ))}
        </div>
      )}
      <p className="mt-4 text-[11px] text-[#64748B]">
        {lang === 'tr'
          ? 'Tüm Dosyalar sohbetten hâlâ açılabilir.'
          : 'All Files is still available from the conversation.'}
      </p>
    </div>
  );

  return (
    <div>
      {blockedBanner}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>{ownerSelector}</div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {selectButton}
            {openPreviewButton}
          </div>
          {openFailedNote}
        </div>
      </div>
      <BrowserFrame url={url} accentColor={ACCENT}>
        <VisualSelectSurface
          key={previewKey}
          ref={surfaceRef}
          enabled={selectEnabled}
          onSelect={handleSelect}
          onExitMode={() => setSelectEnabled(false)}
        >
          <PreviewErrorBoundary key={previewKey} fallback={previewFallback}>
            <WebBuildPreviewDocument sectionItems={items} brief={safeBrief} interactionContract={interactionContract} visualAssetPlan={visualAssetPlan} visualSignaturePlan={visualSignaturePlan} motionComposer={motionComposer} imagePipeline={imagePipeline} />
          </PreviewErrorBoundary>
        </VisualSelectSurface>
      </BrowserFrame>
      {/* Selection context — read-only. Does NOT touch the composer / prompt /
          AI in this PR; the next phase connects it to a scoped edit. */}
      {selection && (
        <div className="mt-2">
          <VisualSelectionPill
            selection={selection}
            onClear={clearSelection}
            canReplaceImage={!!imageTarget}
            onSearchStock={() => imageTarget && setPickerOpen(true)}
            applied={applied}
            onCancelPreview={cancelApplied}
          />
        </div>
      )}
      <p className="mt-2 text-[11px] text-[#64748B]">{t('wbPreviewCaption')}</p>

      {/* Stock photo picker (Phase 14K.2) — real Pexels/Unsplash search; applies
          to THIS preview only (never persisted). */}
      <StockImagePicker
        open={pickerOpen && !!imageTarget}
        initialQuery={suggestQuery(imageTarget)}
        onPreview={previewCandidate}
        onApply={applyCandidate}
        onClose={closePicker}
      />
    </div>
  );
}
