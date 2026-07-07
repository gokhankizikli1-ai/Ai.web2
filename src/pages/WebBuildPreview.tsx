import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, Lock } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import WebBuildPreviewDocument from '@/components/builder/WebBuildPreviewDocument';
import { readPreview, sanitizeReturnTo, requestPreviewForRun, subscribePreviewResponses, type WebBuildPreviewData } from '@/lib/webBuildPreviewStash';
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
/** A preview candidate is USABLE only when it actually has sections to render.
 *  This is the gate that lets the resolver skip an empty/stale stash and keep
 *  trying the healthier saved-session / project fallbacks. */
function usablePreview(d: WebBuildPreviewData | null): d is WebBuildPreviewData {
  return !!d && Array.isArray(d.sectionItems) && d.sectionItems.length > 0;
}

/** Fallback: a saved project whose Web Build contains this run/step id. Returns
 *  data ONLY when it is usable (non-empty sectionItems); a matched-but-empty
 *  build keeps scanning so it can never mask a usable source. */
function fromProject(runId: string): WebBuildPreviewData | null {
  for (const p of getProjects()) {
    const wb = p.webBuild;
    if (wb && (wb.steps || []).some((s) => s.id === runId)) {
      const candidate = { runId, sectionItems: wb.sectionItems || [], brief: wb.brief || {}, slug: undefined, prompt: wb.prompt };
      if (usablePreview(candidate)) return candidate;
    }
  }
  return null;
}

/** Fallback: a persisted Web Build session containing this run/step id. Same
 *  usable-data rule as fromProject. */
function fromSession(runId: string): WebBuildPreviewData | null {
  for (const meta of listWebBuildSessions()) {
    const wb = getWebBuildSession(meta.id);
    if (wb && (wb.steps || []).some((s) => s.id === runId)) {
      const candidate = { runId, sectionItems: wb.sectionItems || [], brief: wb.brief || {}, slug: undefined, prompt: wb.prompt };
      if (usablePreview(candidate)) return candidate;
    }
  }
  return null;
}

/** Resolve preview data from the on-device sources, taking the FIRST USABLE one
 *  (non-empty sectionItems). The old `readPreview || fromSession || fromProject`
 *  chain short-circuited on a truthy-but-EMPTY stash (readPreview returns an
 *  object whenever sectionItems is an array, even []), so a stale/empty stash
 *  masked a healthy saved session/project. Skipping unusable candidates fixes it. */
function resolveLocalPreview(runId: string): WebBuildPreviewData | null {
  for (const get of [() => readPreview(runId), () => fromSession(runId), () => fromProject(runId)]) {
    const d = get();
    if (usablePreview(d)) return d;
  }
  return null;
}

export default function WebBuildPreview() {
  const { t, lang } = useLanguageStore();
  const { runId = '' } = useParams();
  const navigate = useNavigate();
  // On-device resolution first (stash → saved session → saved project).
  const local = useMemo(() => resolveLocalPreview(runId), [runId]);
  const [data, setData] = useState<WebBuildPreviewData | null>(local);
  // When nothing is on device, the opener tab may be handing the payload over a
  // storage-free BroadcastChannel (used when localStorage was full). Wait briefly
  // for it instead of instantly showing the empty state.
  const [waiting, setWaiting] = useState<boolean>(!local && !!runId);

  useEffect(() => {
    if (data || !runId) return; // already have usable data, or nothing to ask for
    let settled = false;
    let unsubscribe = () => {};
    let retry: ReturnType<typeof setInterval> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (incoming: WebBuildPreviewData | null) => {
      if (settled) return;
      settled = true;
      if (incoming) setData(incoming);
      setWaiting(false);
      unsubscribe();
      if (retry !== undefined) clearInterval(retry);
      if (timer !== undefined) clearTimeout(timer);
    };
    // Listen for the opener tab's response, then ask it (repeatedly, to cover the
    // race where our request lands before the opener's responder is armed).
    unsubscribe = subscribePreviewResponses(runId, finish);
    requestPreviewForRun(runId);
    retry = setInterval(() => requestPreviewForRun(runId), 700);
    timer = setTimeout(() => finish(null), 10000); // give up → empty state
    return () => { settled = true; unsubscribe(); if (retry !== undefined) clearInterval(retry); if (timer !== undefined) clearTimeout(timer); };
  }, [runId, data]);

  // Return to where the preview was opened from. Prefer the structured restore
  // context (owning chat session + persisted Web Build session id) so Chat can
  // reopen the exact embedded conversation; else the stashed same-origin path;
  // else in-tab history; else '/chat' — never the old /tools/website-builder.
  function handleBack() {
    const wbRun = typeof data?.returnWebBuildRunId === 'string' ? data.returnWebBuildRunId.trim() : '';
    if (wbRun) {
      const chatSess = typeof data?.returnChatSessionId === 'string' ? data.returnChatSessionId.trim() : '';
      navigate(`/chat?webBuildRunId=${encodeURIComponent(wbRun)}&chatSessionId=${encodeURIComponent(chatSess)}`);
      return;
    }
    const rt = sanitizeReturnTo(data?.returnTo);
    if (rt) {
      navigate(rt.startsWith('#') ? rt.slice(1) || '/' : rt);
      return;
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/chat');
  }

  if (!data || data.sectionItems.length === 0) {
    // Still waiting for a BroadcastChannel handoff from the opener tab — show a
    // brief loading state instead of prematurely declaring the preview missing.
    if (waiting) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#0D1117] px-6 text-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-[#93C5FD]" aria-hidden />
          <p className="text-sm text-[#94A3B8]">{lang === 'tr' ? 'Önizleme yükleniyor…' : 'Loading preview…'}</p>
        </div>
      );
    }
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#0D1117] px-6 text-center">
        <p className="text-sm text-[#94A3B8]">{t('wbPreviewEmpty')}</p>
        <button type="button" onClick={handleBack} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-[13px] text-slate-200 hover:bg-white/[0.05]">
          <ArrowLeft className="h-3.5 w-3.5" /> {t('wbProjWebsiteBuild')}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0D1117]">
      {/* Minimal browser chrome */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-white/[0.06] bg-[#0D1117]/90 px-4 py-2 backdrop-blur">
        <button type="button" onClick={handleBack} className="flex items-center gap-1 text-[12px] text-[#94A3B8] hover:text-white" aria-label={t('wbProjWebsiteBuild')}>
          <ArrowLeft className="h-4 w-4" />
        </button>
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
