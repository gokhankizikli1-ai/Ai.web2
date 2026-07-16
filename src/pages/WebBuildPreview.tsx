import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, Lock } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { useOwnerMode } from '@/hooks/useOwnerMode';
import WebBuildPreviewDocument from '@/components/builder/WebBuildPreviewDocument';
import WebBuildModelNativePreview, { CandidateUnapprovedNotice, RuntimeDiagnosticsBlock } from '@/components/builder/WebBuildModelNativePreview';
import { readPreview, sanitizeReturnTo, requestPreviewForRun, subscribePreviewResponses, isUsablePreviewData, hasModelNativeEntryFiles, type WebBuildPreviewData } from '@/lib/webBuildPreviewStash';
import { deriveModelNativeCandidate, type ModelNativeCandidate, type ModelNativeRuntimeSnapshot } from '@/lib/webBuildRuntimePreview';
import { listWebBuildSessions, getWebBuildSession } from '@/lib/webBuildSession';
import { getProjects } from '@/stores/projectStore';
import type { WebBuildStep } from '@/lib/webBuildPayload';

/**
 * Standalone, openable preview of a generated Web Build
 * (/preview/web-build/:runId). Reads the build data stashed by "Open preview";
 * on a cold open (stash cleared) it falls back to a saved project whose Web
 * Build contains a step with this runId, so a saved project's preview keeps
 * working. Client-side only — no hosting yet, but a real openable URL that
 * renders the real generated page.
 */
/** A preview candidate is USABLE when it is a model-native project with entry files
 *  OR it has non-empty sections for the legacy renderer (Phase 12D gate). This lets
 *  the resolver skip an empty/stale stash and keep trying healthier fallbacks. */
const usablePreview = isUsablePreviewData;

/** Build preview data from a saved Web Build step. Phase 13A — AUTOMATIC cold restoration
 *  must honor FRONTEND ACCEPTANCE, not consumption alone: a model-native project is
 *  restored only when it is APPROVED for the user preview (acceptance approved /
 *  repaired-approved, or a legacy build with no acceptance artifact that already consumed
 *  model-native). An unapproved 'manual-review-required' / 'skipped' build restores the
 *  deterministic safe fallback. An unapproved candidate is NEVER auto-exposed here — it is
 *  reachable only through an explicit stashed owner-candidate handoff. Acceptance/source
 *  are read from the derived candidate (artifact-driven), never inferred from filenames. */
function stepToPreviewData(
  runId: string,
  wb: { sectionItems?: WebBuildPreviewData['sectionItems']; brief?: WebBuildPreviewData['brief']; prompt?: string; steps?: WebBuildStep[] },
): WebBuildPreviewData | null {
  const step = (wb.steps || []).find((s) => s.id === runId);
  if (!step) return null;
  const brief = wb.brief || {};
  const candidate = deriveModelNativeCandidate(step, step.files);
  if (candidate.approvedForUserPreview && candidate.source === 'consumed-model-native' && hasModelNativeEntryFiles(step.files)) {
    return { runId, sectionItems: wb.sectionItems || [], brief, slug: undefined, prompt: wb.prompt, files: step.files, previewSource: 'model-native-sandbox', previewMode: 'approved-model-native' };
  }
  const fallback: WebBuildPreviewData = { runId, sectionItems: wb.sectionItems || [], brief, slug: undefined, prompt: wb.prompt, previewMode: 'safe-fallback' };
  return usablePreview(fallback) ? fallback : null;
}

/** Fallback: a saved project whose Web Build contains this run/step id. Returns data
 *  ONLY when it is usable; a matched-but-empty build keeps scanning. */
function fromProject(runId: string): WebBuildPreviewData | null {
  for (const p of getProjects()) {
    if (p.webBuild) {
      const d = stepToPreviewData(runId, p.webBuild);
      if (d) return d;
    }
  }
  return null;
}

/** Fallback: a persisted Web Build session containing this run/step id. Same rule. */
function fromSession(runId: string): WebBuildPreviewData | null {
  for (const meta of listWebBuildSessions()) {
    const wb = getWebBuildSession(meta.id);
    if (wb) {
      const d = stepToPreviewData(runId, wb);
      if (d) return d;
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
  const { isOwner } = useOwnerMode();
  const { runId = '' } = useParams();
  const navigate = useNavigate();
  // Phase 13A — ephemeral runtime snapshot for an owner Candidate Preview (React state only).
  const [snapshot, setSnapshot] = useState<ModelNativeRuntimeSnapshot | null>(null);
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

  // Phase 13A — an owner-candidate handoff renders the UNAPPROVED generated project ONLY
  // for an owner; a non-owner falls back safely. 'approved-model-native' (and legacy
  // undefined-mode model-native stashes, i.e. pre-13A approved builds) render for everyone;
  // 'safe-fallback' never renders model-native. Owner status is read from useOwnerMode —
  // NEVER from a URL flag or a preview-authored localStorage field.
  const wantsModelNative = !!data && data.previewSource === 'model-native-sandbox' && hasModelNativeEntryFiles(data.files);
  const isOwnerCandidate = data?.previewMode === 'owner-candidate';
  const modelNative = wantsModelNative && (
    isOwnerCandidate ? isOwner
      : data?.previewMode === 'safe-fallback' ? false
        : true
  );
  // A display-only candidate for the owner Candidate Preview's warning + diagnostics. The
  // stash carries only the mode + files, so acceptance is the honest "unapproved" reason.
  const displayCandidate: ModelNativeCandidate | null = (modelNative && isOwnerCandidate && data)
    ? { available: true, source: 'consumed-model-native', files: data.files || [], acceptance: 'manual-review-required', approvedForUserPreview: false, reason: 'Explicit owner-candidate handoff.' }
    : null;

  if (!data || !isUsablePreviewData(data)) {
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

      {/* Phase 13A — an owner Candidate Preview carries the same unapproved-candidate
          warning + bounded runtime diagnostics as the embedded panel. */}
      {displayCandidate ? (
        <div className="mx-auto max-w-3xl px-4 pt-3">
          <CandidateUnapprovedNotice candidate={displayCandidate} />
        </div>
      ) : null}

      {/* Real generated page. A model-native project runs in the isolated Sandpack
          runtime and controls its OWN full-width layout (never the max-w-5xl frame);
          the legacy section renderer keeps the centered document frame. */}
      {modelNative
        ? (
          <>
            <WebBuildModelNativePreview
              files={data.files || []}
              mode="standalone"
              {...(displayCandidate ? { candidate: true, onRuntimeSnapshot: setSnapshot } : {})}
            />
            {displayCandidate ? (
              <div className="mx-auto max-w-3xl px-4 pb-4">
                <RuntimeDiagnosticsBlock snapshot={snapshot} candidate={displayCandidate} />
              </div>
            ) : null}
          </>
        )
        : (
          <div className="mx-auto max-w-5xl">
            <WebBuildPreviewDocument sectionItems={data.sectionItems} brief={data.brief} />
          </div>
        )}
    </div>
  );
}
