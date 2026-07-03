import { useMemo } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Lock } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import WebBuildPreviewDocument from '@/components/builder/WebBuildPreviewDocument';
import { readPreview } from '@/lib/webBuildPreviewStash';

/**
 * Standalone, openable preview of a generated Web Build (route:
 * /preview/web-build). Reads the build data stashed in localStorage by the
 * "Open preview" action and renders the REAL generated page full-screen with a
 * minimal browser-style top bar. Client-side only — no deployment/hosting yet,
 * but it's a real openable URL rendering real generated content.
 */
export default function WebBuildPreview() {
  const { t } = useLanguageStore();
  const data = useMemo(() => readPreview(), []);

  if (!data || data.sectionItems.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#0D1117] px-6 text-center">
        <p className="text-sm text-[#94A3B8]">{t('wbPreviewEmpty')}</p>
        <Link to="/tools/website-builder" className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[13px] text-slate-200 hover:bg-white/[0.05]">
          <ArrowLeft className="h-3.5 w-3.5" /> {t('wbProjWebsiteBuild')}
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0D1117]">
      {/* Minimal browser chrome */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/[0.06] bg-[#0D1117]/90 px-4 py-2 backdrop-blur">
        <Link to="/tools/website-builder" className="flex items-center gap-1 text-[12px] text-[#94A3B8] hover:text-white" aria-label={t('wbProjWebsiteBuild')}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex flex-1 items-center justify-center">
          <div className="flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-black/30 px-3 py-1">
            <Lock className="h-2.5 w-2.5 text-[#94A3B8]" />
            <span className="text-[11px] text-[#94A3B8]">{data.slug || 'preview.korvix.build'}</span>
          </div>
        </div>
        <span className="w-4" />
      </div>

      {/* Real generated page */}
      <div className="mx-auto max-w-5xl">
        <WebBuildPreviewDocument sectionItems={data.sectionItems} brief={data.brief} />
      </div>
    </div>
  );
}
