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

export default function WebBuildPreviewPanel({
  sectionItems, brief, slug, runId,
}: {
  sectionItems: WebBuildSectionItem[];
  brief: WebBuildBrief;
  slug?: string;
  runId?: string;
}) {
  const { t } = useLanguageStore();
  const url = slug || 'preview.korvix.build';

  if (sectionItems.length === 0) {
    return <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-8 text-center text-[12px] text-[#64748B]">{t('wbPreviewEmpty')}</div>;
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button
          onClick={() => openPreviewInNewTab({ runId: runId || `preview-${Date.now().toString(36)}`, sectionItems, brief, slug: url, returnTo: currentReturnTo() })}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#3B82F6]/30 bg-[#3B82F6]/[0.08] px-3 py-1.5 text-[12px] font-medium text-[#93C5FD] transition-colors hover:bg-[#3B82F6]/[0.14]"
        >
          <ExternalLink className="h-3.5 w-3.5" /> {t('wbOpenPreview')}
        </button>
      </div>
      <BrowserFrame url={url} accentColor={ACCENT}>
        <div className="max-h-[70vh] overflow-y-auto scrollbar-thin">
          <WebBuildPreviewDocument sectionItems={sectionItems} brief={brief} />
        </div>
      </BrowserFrame>
      <p className="mt-2 text-[11px] text-[#64748B]">{t('wbPreviewCaption')}</p>
    </div>
  );
}
