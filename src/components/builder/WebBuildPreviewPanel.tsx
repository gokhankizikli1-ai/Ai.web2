import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import BrowserFrame from '@/components/builder/BrowserFrame';
import WebBuildPreviewDocument from '@/components/builder/WebBuildPreviewDocument';
import { useLanguageStore } from '@/stores/languageStore';
import { openPreviewInNewTab, currentReturnTo } from '@/lib/webBuildPreviewStash';
import type { WebBuildSectionItem } from '@/lib/webBuildPayload';
import type { WebBuildBrief } from '@/lib/webBuildApi';

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
  sectionItems, brief, slug, runId,
}: {
  sectionItems: WebBuildSectionItem[];
  brief: WebBuildBrief;
  slug?: string;
  runId?: string;
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

  if (items.length === 0) {
    return <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-8 text-center text-[12px] text-[#64748B]">{t('wbPreviewEmpty')}</div>;
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
      <div className="mb-3 flex flex-col items-end gap-2">
        <button
          onClick={() => {
            const opened = openPreviewInNewTab({ runId: runId || `preview-${Date.now().toString(36)}`, sectionItems: items, brief: safeBrief, slug: url, returnTo: currentReturnTo() });
            setOpenFailed(!opened);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#3B82F6]/30 bg-[#3B82F6]/[0.08] px-3 py-1.5 text-[12px] font-medium text-[#93C5FD] transition-colors hover:bg-[#3B82F6]/[0.14]"
        >
          <ExternalLink className="h-3.5 w-3.5" /> {t('wbOpenPreview')}
        </button>
        {openFailed && (
          <p className="max-w-sm text-right text-[11px] leading-relaxed text-[#F59E0B]">
            {lang === 'tr'
              ? 'Tarayıcı depolama alanı dolu olduğu için tam ekran önizleme açılamadı. Uygulama içi önizleme hâlâ kullanılabilir.'
              : 'Could not open full preview because browser storage is full. The in-app preview is still available.'}
          </p>
        )}
      </div>
      <BrowserFrame url={url} accentColor={ACCENT}>
        <div className="max-h-[70vh] overflow-y-auto scrollbar-thin">
          <PreviewErrorBoundary key={previewKey} fallback={previewFallback}>
            <WebBuildPreviewDocument sectionItems={items} brief={safeBrief} />
          </PreviewErrorBoundary>
        </div>
      </BrowserFrame>
      <p className="mt-2 text-[11px] text-[#64748B]">{t('wbPreviewCaption')}</p>
    </div>
  );
}
