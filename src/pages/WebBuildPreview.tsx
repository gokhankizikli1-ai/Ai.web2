import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Lock } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import WebBuildPreviewDocument from '@/components/builder/WebBuildPreviewDocument';
import { readPreview, type WebBuildPreviewData } from '@/lib/webBuildPreviewStash';
import { listWebBuildSessions, getWebBuildSession } from '@/lib/webBuildSession';
import { getProjects } from '@/stores/projectStore';

/**
 * Standalone, openable preview of a generated Web Build
 * (/preview/web-build/:runId). Reads the build data stashed by "Open preview";
 * on a cold open (stash cleared) it falls back to a saved project whose Web
 * Build contains a step with this runId, so a saved project's preview keeps
 * working. Client-side only — no hosting yet, but a real openable URL that
 * renders the real generated page.
 */
function fromProject(runId: string): WebBuildPreviewData | null {
  for (const p of getProjects()) {
    const wb = p.webBuild;
    if (wb && (wb.steps || []).some((s) => s.id === runId)) {
      return { runId, sectionItems: wb.sectionItems || [], brief: wb.brief || {}, slug: undefined, prompt: wb.prompt };
    }
  }
  return null;
}

/** Fallback: a persisted Web Build session containing this run/step id. */
function fromSession(runId: string): WebBuildPreviewData | null {
  for (const meta of listWebBuildSessions()) {
    const wb = getWebBuildSession(meta.id);
    if (wb && (wb.steps || []).some((s) => s.id === runId)) {
      return { runId, sectionItems: wb.sectionItems || [], brief: wb.brief || {}, slug: undefined, prompt: wb.prompt };
    }
  }
  return null;
}

export default function WebBuildPreview() {
  const { t } = useLanguageStore();
  const { runId = '' } = useParams();
  const data = useMemo(() => readPreview(runId) || fromSession(runId) || fromProject(runId), [runId]);

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
