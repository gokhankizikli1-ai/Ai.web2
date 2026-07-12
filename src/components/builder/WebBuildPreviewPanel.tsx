import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import BrowserFrame from '@/components/builder/BrowserFrame';
import WebBuildPreviewDocument from '@/components/builder/WebBuildPreviewDocument';
import WebBuildModelNativePreview from '@/components/builder/WebBuildModelNativePreview';
import { useLanguageStore } from '@/stores/languageStore';
import { openPreviewInNewTab, currentReturnTo } from '@/lib/webBuildPreviewStash';
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
  sectionItems, brief, slug, runId, files, previewSource, blockedNeedsRegeneration, interactionContract, visualAssetPlan, visualSignaturePlan, motionComposer, imagePipeline,
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
  const url = slug || 'preview.korvix.build';
  // Set when "Open preview" could not write/verify the localStorage stash (full
  // storage) — we surface it inline instead of opening a broken standalone route.
  const [openFailed, setOpenFailed] = useState(false);

  // Never trust the inputs to be well-formed: an undefined/null section list or
  // brief must not crash the drawer. Treat sections as an array and the brief as
  // a safe object so the preview document always receives valid props.
  const items = Array.isArray(sectionItems) ? sectionItems.filter(Boolean) : [];
  const safeBrief = (brief || {}) as WebBuildBrief;

  // Phase 12D — choose EXACTLY one preview source. When the dedicated Frontend Builder
  // project was consumed, render its validated files in the isolated Sandpack runtime;
  // otherwise the deterministic section renderer. Never render both.
  const modelNativeFiles = Array.isArray(files) ? files.filter(Boolean) : [];
  const useModelNative = previewSource === 'model-native-sandbox' && modelNativeFiles.length > 0;

  // The Open Preview handoff carries the model-native files + source so the standalone
  // route opens the SAME project — it must not revert to the legacy renderer just
  // because it opened in another tab.
  const openPreview = () => {
    const opened = openPreviewInNewTab({
      runId: runId || `preview-${Date.now().toString(36)}`,
      sectionItems: items,
      brief: safeBrief,
      slug: url,
      returnTo: currentReturnTo(),
      ...(useModelNative ? { files: modelNativeFiles, previewSource: 'model-native-sandbox' as const } : {}),
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

  if (useModelNative) {
    // Isolated model-native runtime Preview inside the existing browser frame.
    return (
      <div>
        <div className="mb-3 flex flex-col items-end gap-2">
          <button
            onClick={openPreview}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#3B82F6]/30 bg-[#3B82F6]/[0.08] px-3 py-1.5 text-[12px] font-medium text-[#93C5FD] transition-colors hover:bg-[#3B82F6]/[0.14]"
          >
            <ExternalLink className="h-3.5 w-3.5" /> {t('wbOpenPreview')}
          </button>
          {openFailedNote}
        </div>
        <BrowserFrame url={url} accentColor={ACCENT}>
          <WebBuildModelNativePreview files={modelNativeFiles} mode="embedded" />
        </BrowserFrame>
        <p className="mt-2 text-[11px] text-[#64748B]">
          {lang === 'tr'
            ? 'Doğrulanmış model-native proje izole bir çalıştırma ortamında önizleniyor.'
            : 'The validated model-native project is previewed in an isolated runtime.'}
        </p>
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
      <div className="mb-3 flex flex-col items-end gap-2">
        <button
          onClick={openPreview}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#3B82F6]/30 bg-[#3B82F6]/[0.08] px-3 py-1.5 text-[12px] font-medium text-[#93C5FD] transition-colors hover:bg-[#3B82F6]/[0.14]"
        >
          <ExternalLink className="h-3.5 w-3.5" /> {t('wbOpenPreview')}
        </button>
        {openFailedNote}
      </div>
      <BrowserFrame url={url} accentColor={ACCENT}>
        <div className="max-h-[70vh] overflow-y-auto scrollbar-thin">
          <PreviewErrorBoundary key={previewKey} fallback={previewFallback}>
            <WebBuildPreviewDocument sectionItems={items} brief={safeBrief} interactionContract={interactionContract} visualAssetPlan={visualAssetPlan} visualSignaturePlan={visualSignaturePlan} motionComposer={motionComposer} imagePipeline={imagePipeline} />
          </PreviewErrorBoundary>
        </div>
      </BrowserFrame>
      <p className="mt-2 text-[11px] text-[#64748B]">{t('wbPreviewCaption')}</p>
    </div>
  );
}
