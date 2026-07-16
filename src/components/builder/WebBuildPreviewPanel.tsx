import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { ExternalLink, MousePointerSquareDashed, RefreshCw, Wrench } from 'lucide-react';
import BrowserFrame from '@/components/builder/BrowserFrame';
import WebBuildPreviewDocument from '@/components/builder/WebBuildPreviewDocument';
import WebBuildModelNativePreview, { CandidateUnapprovedNotice, RuntimeDiagnosticsBlock } from '@/components/builder/WebBuildModelNativePreview';
import VisualSelectSurface, { type VisualSelectHandle } from '@/components/builder/VisualSelectSurface';
import VisualSelectionPill from '@/components/builder/VisualSelectionPill';
import StockImagePicker from '@/components/builder/StockImagePicker';
import type { VisualSelection, VisualImageTarget } from '@/lib/visualSelection';
import { trackStockDownload, type StockImageResult } from '@/lib/stockImages';
import { useCandidateVisualEditBridge } from '@/hooks/useCandidateVisualEditBridge';
import { uploadDeviceImage, ImageUploadError, type UploadErrorCode } from '@/lib/webBuildImageUpload';
import type { ImageReplacementInput } from '@/lib/webBuildImageReplace';
import { useOwnerMode } from '@/hooks/useOwnerMode';
import { useLanguageStore } from '@/stores/languageStore';
import { openPreviewInNewTab, currentReturnTo } from '@/lib/webBuildPreviewStash';
import { resolvePreviewMode, candidateHasEntryFiles, type ModelNativeCandidate, type ModelNativeRuntimeSnapshot, type OwnerPreviewSelection, type WebBuildPreviewMode } from '@/lib/webBuildRuntimePreview';
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
  sectionItems, brief, slug, runId, files, previewSource, blockedNeedsRegeneration, candidate, interactionContract, visualAssetPlan, visualSignaturePlan, motionComposer, imagePipeline, onImageReplace,
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
  /** Phase 14K.6 — permanently replace a generated image in the authoritative
   *  project. The owner applies the change to its payload + persists it, then the
   *  updated files flow back down. Absent → device upload / permanent apply is off
   *  (the surface still supports stock search + temporary preview). */
  onImageReplace?: (input: ImageReplacementInput) => Promise<{ ok: boolean; error?: string }>;
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
  // Phase 14K.5 — Preview is Candidate-first with an AUTOMATIC Safe fallback. `retryKey`
  // remounts only the Candidate renderer (no regeneration); `ownerDebugSafe` is an
  // owner-only manual "view safe preview" debug switch (never shown to normal users).
  const [retryKey, setRetryKey] = useState(0);
  const [ownerDebugSafe, setOwnerDebugSafe] = useState(false);
  const candidateKey = `${runId || ''}|${candidate?.source || 'none'}|${candidate?.files?.length ?? 0}`;
  // A new build / candidate identity resets snapshot + retry + owner debug so a
  // failure or debug view in Build A can never leak into Build B.
  useEffect(() => {
    setOwnerSel(undefined); setRuntimeSnapshot(null); setRetryKey(0); setOwnerDebugSafe(false);
  }, [candidateKey]);

  const mode: WebBuildPreviewMode = candidate
    ? resolvePreviewMode(candidate, isOwner, ownerSel)
    : (previewSource === 'model-native-sandbox' && legacyFiles.length > 0 ? 'approved-model-native' : 'safe-fallback');
  const showModelNative = mode === 'approved-model-native' || mode === 'owner-candidate';
  const isCandidateMode = mode === 'owner-candidate';
  const candidateEligible = showModelNative && nativeFiles.length > 0;

  // ── Candidate Preview HEALTH — DISTINCT from Visual-Select bridge readiness. Health
  // comes ONLY from the isolated runtime's own signals (RuntimeObserver): a missing
  // renderable entry, a bundler/compile error, a fatal runtime error, or the startup
  // soft-timeout. The Visual-Select bridge starting/unavailable NEVER affects health,
  // so a Candidate site that renders fine while Select is still connecting is NOT
  // treated as failed — it never falls back merely because Select isn't ready.
  const candidateEntryOk = candidateHasEntryFiles(nativeFiles);
  const candidatePhase = runtimeSnapshot?.phase;
  const candidateFailed = candidateEligible && (!candidateEntryOk || candidatePhase === 'error' || candidatePhase === 'timeout');
  const candidateStarting = candidateEligible && !candidateFailed && candidatePhase !== 'running';
  // Show Safe: automatically on genuine failure, or when the owner manually asks (debug).
  const usingSafeFallback = candidateEligible && (candidateFailed || ownerDebugSafe);
  // The Candidate iframe is mounted (and its bridge active) ONLY when truly shown.
  const candidateActive = candidateEligible && !usingSafeFallback;
  const activePreview: 'candidate' | 'safe' = candidateActive ? 'candidate' : 'safe';

  // ── Visual Edit — UNIFIED selection state (Phase 14K.1 Safe Preview · 14K.3
  // Candidate Preview). One selection UI serves both preview implementations; the
  // `selectionSource` records which one currently owns the selection so every
  // action (search, preview, apply, cancel, clear) routes to the right impl. Hooks
  // live before any early return. A new build/mode clears BOTH systems so a target
  // never leaks across previews.
  type VisualSelectionSource = 'safe-preview' | 'candidate-preview';
  const [selectEnabled, setSelectEnabled] = useState(false);       // Safe Preview mode
  const [selection, setSelection] = useState<VisualSelection | null>(null);
  const [imageTarget, setImageTarget] = useState<VisualImageTarget | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [applied, setApplied] = useState<StockImageResult | null>(null);
  const [selectionSource, setSelectionSource] = useState<VisualSelectionSource | null>(null);
  const [imgErrorCode, setImgErrorCode] = useState<string | null>(null);
  // Phase 14K.6 — device upload state (an uploaded image previewing in place,
  // awaiting the user's confirm before it is PERMANENTLY saved to the project).
  const [uploading, setUploading] = useState(false);
  const [uploadErrorCode, setUploadErrorCode] = useState<UploadErrorCode | null>(null);
  const [uploadPending, setUploadPending] = useState<{ url: string; assetId: string; mimeType: string; width: number; height: number } | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const surfaceRef = useRef<VisualSelectHandle>(null);              // Safe Preview live DOM
  const candidateFrameRef = useRef<HTMLDivElement>(null);          // wraps the Candidate iframe
  const uploadAbortRef = useRef<AbortController | null>(null);

  const resetKey = `${runId || ''}|${url}|${items.map((s) => s?.id || '').join(',')}`;

  const resetUploadState = () => {
    uploadAbortRef.current?.abort();
    setUploading(false); setUploadErrorCode(null); setUploadPending(null); setSavedNote(false);
  };
  const resetSelectionState = () => {
    setSelection(null); setImageTarget(null); setApplied(null);
    setPickerOpen(false); setSelectionSource(null); setImgErrorCode(null);
    resetUploadState();
  };

  // Candidate Preview bridge — drives Visual Select inside the cross-origin Sandpack
  // iframe over the strict `korvix.visual-edit.v1` postMessage protocol.
  const bridge = useCandidateVisualEditBridge({
    active: candidateActive,
    containerRef: candidateFrameRef,
    // retryKey is included so a Retry (renderer remount) fully resets the bridge
    // (bound window, instance id, ready state) instead of relying on reload detection.
    resetKey: `${resetKey}|${mode}|${candidateKey}|${retryKey}`,
    onSelected: (sel, it) => {
      setSelectionSource('candidate-preview');
      setApplied(null); setPickerOpen(false); setImgErrorCode(null);
      setSelection(sel); setImageTarget(it);
    },
    onSelectionCleared: () => { resetSelectionState(); },
    onImageApplied: () => setImgErrorCode(null),
    onImageRestored: () => setImgErrorCode(null),
    onError: (code) => setImgErrorCode(code),
    onReload: () => { resetSelectionState(); },
  });

  // New build / revision clears Safe Preview mode + all selection state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setSelectEnabled(false); resetSelectionState(); }, [resetKey]);
  // Switching preview mode (Safe ↔ Candidate) clears stale overlays + temp image state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setSelectEnabled(false); resetSelectionState(); }, [mode]);
  // Switching between the Candidate renderer and the automatic/owner Safe fallback
  // (failure, retry, or owner debug) clears stale selection + temporary image state so
  // nothing leaks across the two preview implementations.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setSelectEnabled(false); resetSelectionState(); }, [candidateActive]);
  // Abort any in-flight upload if the panel unmounts.
  useEffect(() => () => { uploadAbortRef.current?.abort(); }, []);
  // Auto-dismiss the "saved to project" confirmation.
  useEffect(() => {
    if (!savedNote) return;
    const id = window.setTimeout(() => setSavedNote(false), 3500);
    return () => window.clearTimeout(id);
  }, [savedNote]);

  // A new / changed SAFE selection restores any live preview and resets image state,
  // then re-derives whether the new target is a replaceable photo.
  const handleSafeSelect = (sel: VisualSelection | null) => {
    surfaceRef.current?.restoreSelectedImage();
    setApplied(null); setPickerOpen(false); setImgErrorCode(null);
    setSelectionSource(sel ? 'safe-preview' : null);
    setSelection(sel);
    setImageTarget(sel ? (surfaceRef.current?.getSelectedImageTarget() ?? null) : null);
  };

  const clearSelection = () => {
    if (selectionSource === 'candidate-preview') bridge.clear();
    else { surfaceRef.current?.restoreSelectedImage(); surfaceRef.current?.clear(); }
    resetSelectionState();
  };

  // Preview a candidate photo live (temporary) in whichever preview owns the selection.
  const previewSelected = (r: StockImageResult | null) => {
    if (selectionSource === 'candidate-preview') {
      if (!r) { bridge.restoreImage(selection?.nodeId); return; }
      if (selection) bridge.previewImage(selection.nodeId, r);
      return;
    }
    const surf = surfaceRef.current;
    if (!surf) return;
    if (!r) { surf.restoreSelectedImage(); return; }
    const pre = new Image();
    const swap = () => surf.previewSelectedImage(r.previewUrl);
    pre.onload = swap;
    pre.onerror = swap; // still attempt; the browser shows its own honest fallback
    pre.src = r.previewUrl;
  };

  // Apply keeps the photo in THIS live preview only (never persisted) and fires the
  // provider's required usage event (Unsplash download tracking).
  const applyStock = (r: StockImageResult) => {
    if (selectionSource === 'candidate-preview') {
      if (selection) bridge.previewImage(selection.nodeId, r);
    } else {
      surfaceRef.current?.previewSelectedImage(r.previewUrl);
    }
    void trackStockDownload(r);
    setApplied(r);
    setPickerOpen(false);
  };

  // Closing the picker without applying: return to the last applied photo if one
  // exists, otherwise restore the exact original image.
  const closeStockPicker = () => {
    setPickerOpen(false);
    if (selectionSource === 'candidate-preview') {
      if (applied && selection) bridge.previewImage(selection.nodeId, applied);
      else bridge.restoreImage(selection?.nodeId);
      return;
    }
    const surf = surfaceRef.current;
    if (!surf) return;
    if (applied) surf.previewSelectedImage(applied.previewUrl);
    else surf.restoreSelectedImage();
  };

  // Undo an applied preview — back to the original image.
  const cancelApplied = () => {
    if (selectionSource === 'candidate-preview') bridge.restoreImage(selection?.nodeId);
    else surfaceRef.current?.restoreSelectedImage();
    setApplied(null);
  };

  // Retry the high-quality preview — remount ONLY the Candidate renderer (fresh Sandpack
  // + runtime observer + Visual-Select bridge). It NEVER regenerates the site, spends
  // tokens, calls the model, or mutates files; it just restarts the preview renderer and
  // clears stale selection / bridge / picker state.
  const retryCandidate = () => {
    setOwnerDebugSafe(false);
    setRuntimeSnapshot(null);   // health → starting
    setRetryKey((k) => k + 1);  // force a fresh Candidate mount
    setSelectEnabled(false);
    resetSelectionState();
  };

  // A short, safe suggested search query from the selected image's context.
  const suggestQuery = (target: VisualImageTarget | null): string => {
    const raw = (target?.altText || target?.selection.section || target?.selection.textPreview || '').trim();
    const cleaned = raw.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    return cleaned ? cleaned.split(' ').slice(0, 5).join(' ') : '';
  };

  // ── Device image upload (Phase 14K.6) ──────────────────────────────────────
  // Preview the uploaded image IN PLACE (candidate via the bridge's validated
  // https path; safe via the direct-DOM surface), awaiting an explicit confirm.
  const previewUploadedInPlace = (uploadedUrl: string) => {
    if (selectionSource === 'candidate-preview') {
      if (selection) bridge.previewUrl(selection.nodeId, uploadedUrl, 'user-upload');
    } else {
      surfaceRef.current?.previewSelectedImage(uploadedUrl);
    }
  };
  const restoreUploadInPlace = () => {
    if (selectionSource === 'candidate-preview') bridge.restoreImage(selection?.nodeId);
    else surfaceRef.current?.restoreSelectedImage();
  };

  const handlePickDeviceImage = async (file: File) => {
    if (uploading || !selection) return;
    setUploadErrorCode(null); setSavedNote(false); setUploading(true);
    const ctrl = new AbortController();
    uploadAbortRef.current = ctrl;
    try {
      const res = await uploadDeviceImage({ file, slotId: undefined, nodeId: selection.nodeId, signal: ctrl.signal });
      if (ctrl.signal.aborted) return;
      setUploadPending({ url: res.url, assetId: res.assetId, mimeType: res.mimeType, width: res.width, height: res.height });
      previewUploadedInPlace(res.url);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      restoreUploadInPlace();
      setUploadErrorCode(e instanceof ImageUploadError ? e.code : 'upload_failed');
    } finally {
      if (!ctrl.signal.aborted) setUploading(false);
    }
  };

  // Confirm — PERMANENTLY replace the image in the authoritative project. On success
  // the owner persists the new files + manifest; we remount the Candidate to load them.
  const confirmUpload = async () => {
    if (!uploadPending || !selection || !onImageReplace) return;
    const input: ImageReplacementInput = {
      nodeId: selection.nodeId,
      source: 'user-upload',
      url: uploadPending.url,
      oldUrl: imageTarget?.currentUrl,
      altText: imageTarget?.altText,
      uploadedAssetId: uploadPending.assetId,
      mimeType: uploadPending.mimeType,
      width: uploadPending.width,
      height: uploadPending.height,
    };
    const result = await onImageReplace(input);
    if (result.ok) {
      setUploadPending(null); setSavedNote(true);
      // Reload the authoritative files into the Candidate; drop the temp preview.
      if (selectionSource === 'candidate-preview') setRetryKey((k) => k + 1);
    } else {
      restoreUploadInPlace();
      setUploadPending(null);
      setUploadErrorCode('upload_failed');
    }
  };
  const cancelUpload = () => {
    restoreUploadInPlace();
    setUploadPending(null); setUploadErrorCode(null);
  };

  // Is the selected image one of Korvix's auto-sourced EXAMPLE photos? (provider CDN)
  const isExampleImage = !!imageTarget && /(^https:\/\/)(images\.pexels\.com|images\.unsplash\.com|plus\.unsplash\.com)\//i.test(imageTarget.currentUrl || '');
  const UPLOAD_ERROR_KEY: Record<UploadErrorCode, string> = {
    unsupported_format: 'imgErrUnsupported', too_large: 'imgErrTooLarge', too_small: 'imgErrTooSmall',
    bad_dimensions: 'imgErrDimensions', corrupt: 'imgErrCorrupt', storage_unavailable: 'imgErrStorage',
    upload_failed: 'imgErrUpload', network: 'imgErrUpload',
  };
  const uploadErrorText = uploadErrorCode ? t(UPLOAD_ERROR_KEY[uploadErrorCode]) : null;

  // Can the current selection's image be replaced? Candidate images must be
  // explicitly marked replaceable by the runtime; Safe images always can.
  const canReplaceImage = selectionSource === 'candidate-preview'
    ? !!imageTarget && imageTarget.canPreviewReplace === true
    : !!imageTarget;

  const IMG_ERROR_KEY: Record<string, string> = {
    not_replaceable: 'veImageNotReplaceable', image_load_failed: 'veImageNotReplaceable',
    invalid_url: 'veImageNotReplaceable', node_mismatch: 'veSelectedGone', selection_gone: 'veSelectedGone',
  };
  const imgErrorText = imgErrorCode ? t(IMG_ERROR_KEY[imgErrorCode] || 'veImageNotReplaceable') : '';

  // The shared selection UI (pill + stock picker), rendered by BOTH preview paths.
  const selectionUi = (
    <>
      {selection && (
        <div className="mt-2">
          <VisualSelectionPill
            selection={selection}
            onClear={clearSelection}
            canReplaceImage={canReplaceImage}
            onSearchStock={() => canReplaceImage && setPickerOpen(true)}
            applied={applied}
            onCancelPreview={cancelApplied}
            isExampleImage={isExampleImage}
            onPickDeviceImage={onImageReplace ? handlePickDeviceImage : undefined}
            uploading={uploading}
            uploadErrorText={uploadErrorText}
            uploadPending={!!uploadPending}
            onConfirmUpload={confirmUpload}
            onCancelUpload={cancelUpload}
            savedNote={savedNote}
          />
          {imgErrorText && <p className="mt-1 text-[11px] text-[#F59E0B]">{imgErrorText}</p>}
        </div>
      )}
      <StockImagePicker
        open={pickerOpen && canReplaceImage}
        initialQuery={suggestQuery(imageTarget)}
        onPreview={previewSelected}
        onApply={applyStock}
        onClose={closeStockPicker}
      />
    </>
  );

  // The Open Preview handoff carries EXACTLY the selected embedded mode + its files, so the
  // full-screen route can never silently switch renderers.
  const openPreview = () => {
    // Open EXACTLY the renderer currently active in-panel — the Candidate/model-native
    // project when it's healthy and shown, otherwise the safe representation honestly.
    const openCandidate = activePreview === 'candidate' && nativeFiles.length > 0;
    const opened = openPreviewInNewTab({
      runId: runId || `preview-${Date.now().toString(36)}`,
      sectionItems: items,
      brief: safeBrief,
      slug: url,
      returnTo: currentReturnTo(),
      previewMode: openCandidate ? mode : 'safe-fallback',
      ...(openCandidate
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

  // Single, honest "Preview" heading — the Candidate/model-native project is THE preview.
  // A polite status announces the starting state once (never technical jargon).
  const previewHeading = (
    <div className="flex items-center gap-2">
      <span className="text-[12px] font-semibold text-[#CBD5E1]">{t('previewHeading')}</span>
      {candidateStarting && !usingSafeFallback && (
        <span role="status" className="text-[10px] font-normal text-[#64748B]">· {t('previewStarting')}</span>
      )}
    </div>
  );

  // Owner-only DEBUG switch (never a normal-user tab): manually view the safe preview,
  // then return. Only offered from a healthy/starting Candidate so it can't be confused
  // with the automatic failure fallback. Component-local; never persisted.
  const ownerDebugToggle = (isOwner && candidateEligible && !candidateFailed) ? (
    <button
      type="button"
      onClick={() => setOwnerDebugSafe((v) => !v)}
      aria-pressed={ownerDebugSafe}
      title={ownerDebugSafe ? t('previewReturnToMain') : t('previewOpenSafeDebug')}
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-white/[0.03] px-2.5 py-1.5 text-[11px] font-medium text-[#94A3B8] transition-colors hover:bg-white/[0.06] hover:text-white"
    >
      <Wrench className="h-3 w-3" aria-hidden="true" />
      {ownerDebugSafe ? t('previewReturnToMain') : t('previewOpenSafeDebug')}
    </button>
  ) : null;

  // Automatic fallback notice (compact, restrained amber) — shown ONLY on a genuine
  // Candidate render failure, with a Retry that restarts just the renderer.
  const fallbackNotice = (candidateEligible && candidateFailed) ? (
    <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#F59E0B]/30 bg-[#F59E0B]/[0.08] px-3.5 py-2.5">
      <div className="min-w-0">
        <p className="text-[12px] font-semibold text-[#FBBF24]">{t('previewHighQualityUnavailable')}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-[#FCD9A6]">{t('previewSafeShown')}</p>
      </div>
      <button
        type="button"
        onClick={retryCandidate}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#F59E0B]/40 bg-[#F59E0B]/[0.12] px-3 py-1.5 text-[11.5px] font-medium text-[#FBBF24] transition-colors hover:bg-[#F59E0B]/[0.2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#F59E0B]"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> {t('previewRetry')}
      </button>
    </div>
  ) : null;

  // Owner manual-debug indicator (distinct from the failure notice above).
  const ownerDebugNote = (isOwner && candidateEligible && ownerDebugSafe && !candidateFailed) ? (
    <p className="mb-3 text-[11px] text-[#94A3B8]">{t('previewSafeDebugActive')}</p>
  ) : null;

  const openPreviewButton = (
    <button
      onClick={openPreview}
      className="inline-flex items-center gap-1.5 rounded-lg border border-[#3B82F6]/30 bg-[#3B82F6]/[0.08] px-3 py-1.5 text-[12px] font-medium text-[#93C5FD] transition-colors hover:bg-[#3B82F6]/[0.14]"
    >
      <ExternalLink className="h-3.5 w-3.5" /> {t('wbOpenPreview')}
    </button>
  );

  // Visual Edit — Select mode toggle for the SAFE Preview (direct-DOM). Real
  // <button>, aria-pressed, keyboard accessible. Disabled while the build is
  // unstable (needs regeneration).
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

  // Visual Edit — Select toggle for the CANDIDATE Preview (Phase 14K.3). Enabled
  // only once the in-iframe bridge runtime is READY; before that it shows a
  // truthful starting / unavailable state and never claims success.
  const candidateSelectButton = (
    <button
      type="button"
      onClick={() => (bridge.selectionEnabled ? bridge.disable() : bridge.enable())}
      aria-pressed={bridge.selectionEnabled}
      disabled={!bridge.bridgeReady}
      title={bridge.unavailable ? t('veUnavailable') : !bridge.bridgeReady ? t('veStarting') : (bridge.selectionEnabled ? t('vsExit') : t('vsSelectHint'))}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        bridge.selectionEnabled
          ? 'border-[#3B82F6]/60 bg-[#3B82F6]/[0.18] text-white'
          : 'border-[#3B82F6]/30 bg-[#3B82F6]/[0.06] text-[#93C5FD] hover:bg-[#3B82F6]/[0.12]'
      }`}
    >
      <MousePointerSquareDashed className="h-3.5 w-3.5" aria-hidden="true" /> {t('vsSelect')}
    </button>
  );

  // ── Shared Safe-Preview frame (direct-DOM). Used BOTH as the automatic fallback for a
  // failed Candidate and as the intended representation when there is no candidate. Same
  // Visual Select + stock-picker path as before; keyed so a build change remounts it. ──
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

  const previewKey = `${runId || ''}|${url}|${items.map((s) => s?.id || '').join(',')}`;
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

  const safePreviewFrame = (
    <BrowserFrame url={url} accentColor={ACCENT}>
      <VisualSelectSurface
        key={previewKey}
        ref={surfaceRef}
        enabled={selectEnabled}
        onSelect={handleSafeSelect}
        onExitMode={() => setSelectEnabled(false)}
      >
        <PreviewErrorBoundary key={previewKey} fallback={previewFallback}>
          <WebBuildPreviewDocument sectionItems={items} brief={safeBrief} interactionContract={interactionContract} visualAssetPlan={visualAssetPlan} visualSignaturePlan={visualSignaturePlan} motionComposer={motionComposer} imagePipeline={imagePipeline} />
        </PreviewErrorBoundary>
      </VisualSelectSurface>
    </BrowserFrame>
  );

  if (candidateEligible) {
    // Candidate is THE preview. When its isolated runtime genuinely fails (compile /
    // runtime / no entry / startup timeout) OR the owner opens the debug safe view, the
    // SAME panel automatically shows the Safe fallback — no tabs, no renderer switch UI.
    return (
      <div>
        {isCandidateMode && candidate && !usingSafeFallback ? <CandidateUnapprovedNotice candidate={candidate} /> : null}
        {fallbackNotice}
        {ownerDebugNote}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>{previewHeading}</div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              {ownerDebugToggle}
              {usingSafeFallback ? selectButton : candidateSelectButton}
              {openPreviewButton}
            </div>
            {openFailedNote}
          </div>
        </div>
        {usingSafeFallback ? (
          <>
            {safePreviewFrame}
            {selectionUi}
            <p className="mt-2 text-[11px] text-[#64748B]">{t('wbPreviewCaption')}</p>
          </>
        ) : (
          <>
            {/* Wrapper ref lets the bridge locate this Candidate Preview's iframe to
                validate the runtime's message source. Keyed by retryKey so Retry
                remounts ONLY the renderer (fresh Sandpack + observer + bridge). */}
            <div ref={candidateFrameRef}>
              <BrowserFrame url={url} accentColor={ACCENT}>
                <WebBuildModelNativePreview
                  key={`cand-${candidateKey}-${retryKey}`}
                  files={nativeFiles}
                  mode="embedded"
                  visualEdit
                  onRuntimeSnapshot={setRuntimeSnapshot}
                  {...(isCandidateMode ? { candidate: true, showRuntimeDiagnostics: isOwner } : {})}
                />
              </BrowserFrame>
            </div>
            {/* Shared selection UI (pill + stock picker) — Candidate Preview edits apply
                to THIS preview only; a reload may reset them (stated honestly). */}
            {selectionUi}
            {applied && (
              <p className="mt-1 text-[11px] text-[#64748B]">
                {lang === 'tr'
                  ? 'Bu önizlemeyi yenilemek geçici görseli sıfırlayabilir.'
                  : 'Reloading this preview may reset the temporary image.'}
              </p>
            )}
            {isCandidateMode && candidate ? (
              <RuntimeDiagnosticsBlock snapshot={runtimeSnapshot} candidate={candidate} />
            ) : null}
          </>
        )}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div>
        {blockedBanner}
        {previewHeading}
        <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-8 text-center text-[12px] text-[#64748B]">{t('wbPreviewEmpty')}</div>
      </div>
    );
  }

  // No candidate available/eligible — the Safe representation IS the preview (shown
  // simply as "Preview", no tabs). This is the intended representation, not a failure,
  // so no fallback notice here; `blockedBanner` already explains an unapproved build.
  return (
    <div>
      {blockedBanner}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>{previewHeading}</div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {selectButton}
            {openPreviewButton}
          </div>
          {openFailedNote}
        </div>
      </div>
      {safePreviewFrame}
      {/* Shared selection UI (pill + stock picker) — edits apply to THIS preview only. */}
      {selectionUi}
      <p className="mt-2 text-[11px] text-[#64748B]">{t('wbPreviewCaption')}</p>
    </div>
  );
}
