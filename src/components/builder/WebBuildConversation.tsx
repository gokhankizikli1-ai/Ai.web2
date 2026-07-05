import { useState, useMemo, useEffect, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Monitor, FolderTree, ArrowRight, X } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { useOwnerMode } from '@/hooks/useOwnerMode';
import KorvixAvatar from '@/components/builder/KorvixAvatar';
import WebBuildFileView from '@/components/builder/WebBuildFileView';
import WebBuildPreviewPanel from '@/components/builder/WebBuildPreviewPanel';
import WebBuildAgentRun from '@/components/builder/WebBuildAgentRun';
import { stepToEvents, eventsToRows, liveRows } from '@/lib/webBuildRun';
import type {
  WebBuildStep, WebBuildFile, WebBuildSectionItem,
} from '@/lib/webBuildPayload';
import type { WebBuildResearch } from '@/lib/webBuildApi';

/**
 * The Web Build conversation — a Kimi/Claude-style agent run per turn: the
 * assistant writes short natural messages, compact action blocks appear as real
 * operations, file changes render as clickable tool rows, and Preview / All
 * files / Save to Project artifact cards close the run. Shared by the live Web
 * Build page and the saved-project view. No checklist / table / tick waterfall.
 */

/* ── Live run shown WHILE the backend call is in flight (Thinking runs) ─ */
function LivePhases({ prompt, kind }: { prompt: string; kind: 'build' | 'revision' }) {
  const rows = useMemo(() => liveRows(kind), [kind]);
  return (
    <div className="space-y-3">
      <UserMessage text={prompt} />
      <AssistantMessage active>
        <WebBuildAgentRun rows={rows} animate={false} onOpenFile={() => {}} />
      </AssistantMessage>
    </div>
  );
}

/* ── Attachment / artifact card ──────────────────────────────────────── */
function AttachmentCard({
  icon: Icon, title, subtitle, actionLabel, onClick, tone = 'default',
}: {
  icon: typeof Monitor; title: string; subtitle: string;
  actionLabel: string; onClick?: () => void; tone?: 'default' | 'accent' | 'success';
}) {
  const border = tone === 'success' ? 'border-[#4ADE80]/25' : tone === 'accent' ? 'border-[#3B82F6]/25' : 'border-white/[0.08]';
  const iconBg = tone === 'success' ? 'bg-[#4ADE80]/[0.1]' : `bg-[#3B82F6]/[0.1]`;
  const iconColor = tone === 'success' ? 'text-[#86A08F]' : 'text-[#60A5FA]';
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`group w-full max-w-sm flex items-center gap-3 rounded-xl border ${border} bg-white/[0.02] px-3 py-2.5 text-left hover:bg-white/[0.04] transition-colors disabled:cursor-default`}
    >
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
        <Icon className={`h-4 w-4 ${iconColor}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-slate-100 truncate">{title}</div>
        <div className="text-[11px] text-[#94A3B8] truncate">{subtitle}</div>
      </div>
      {onClick && (
        <span className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-white/[0.08] px-2 py-1 text-[11px] text-[#CBD5E1] group-hover:border-white/[0.15] transition-colors">
          {actionLabel} <ArrowRight className="h-3 w-3" />
        </span>
      )}
    </button>
  );
}

/* ── Message bubbles ─────────────────────────────────────────────────── */
function UserMessage({ text }: { text: string }) {
  const { t } = useLanguageStore();
  return (
    <div className="flex flex-col items-end">
      <span className="text-[10px] text-[#64748B] mb-1 mr-1">{t('wbFeedYou')}</span>
      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-white/[0.05] border border-white/[0.06] px-3.5 py-2 text-[13px] text-slate-100 leading-relaxed">
        {text}
      </div>
    </div>
  );
}

function AssistantMessage({ children, active = false }: { children: ReactNode; active?: boolean }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-[3px]">
        <KorvixAvatar size={15} active={active} />
      </div>
      <div className="min-w-0 flex-1 space-y-2.5">{children}</div>
    </div>
  );
}

/* ── Owner/admin-only research debug (subtle, collapsible) ────────────── */
/** Renders the honest research diagnostics for a build step — status, provider,
 *  attempted providers, counts, fallback reason, real source URLs. Owner/admin
 *  only, so it never clutters the normal user's polished feed. Never invents
 *  data: it reflects exactly what the backend reported. */
function ResearchDebug({ research }: { research?: WebBuildResearch }) {
  const { isOwner } = useOwnerMode();
  if (!isOwner || !research) return null;
  const rows: Array<[string, string]> = [
    ['Status', research.status],
    ['did_research', String(research.didResearch)],
  ];
  if (research.provider) rows.push(['Provider', research.provider]);
  if (research.attemptedProviders?.length) rows.push(['Attempted', research.attemptedProviders.join(', ')]);
  if (typeof research.queryCount === 'number') rows.push(['Queries', String(research.queryCount)]);
  if (typeof research.sourceCount === 'number') rows.push(['Sources', String(research.sourceCount)]);
  if (research.fallbackReason) rows.push(['Fallback reason', research.fallbackReason]);
  return (
    <details className="mt-1 rounded-lg border border-white/[0.07] bg-white/[0.015] px-2.5 py-1.5 text-[11px] text-[#94A3B8]">
      <summary className="cursor-pointer select-none text-[10.5px] uppercase tracking-wide text-[#64748B] hover:text-[#94A3B8]">
        Research debug · owner
      </summary>
      <div className="mt-1.5 space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <span className="w-28 shrink-0 text-[#64748B]">{k}</span>
            <span className="min-w-0 break-words text-[#CBD5E1]">{v}</span>
          </div>
        ))}
        {research.sources?.length ? (
          <div className="pt-1">
            <span className="text-[#64748B]">Source URLs</span>
            <ul className="mt-0.5 space-y-0.5">
              {research.sources.map((s) => (
                <li key={s.url} className="truncate">
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[#60A5FA] hover:underline">
                    {s.url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}

/* ── One finished build/revision turn (agent run) ────────────────────── */
function RunTurn({
  step, brief, animate, onOpenFile, children,
}: {
  step: WebBuildStep;
  brief: { type?: string; audience?: string; goal?: string; style?: string };
  animate: boolean;
  onOpenFile: (path?: string) => void;
  children?: ReactNode;
}) {
  const rows = useMemo(() => eventsToRows(stepToEvents(step, brief)), [step, brief]);
  // Hold the artifact cards until the run has fully finished revealing — the
  // build must look complete before Preview / All files / Save appear. History
  // (non-animated) steps are complete immediately.
  const [runComplete, setRunComplete] = useState(!animate);
  useEffect(() => { if (!animate) setRunComplete(true); }, [animate]);
  return (
    <div className="space-y-3">
      <UserMessage text={step.prompt} />
      <AssistantMessage>
        <WebBuildAgentRun rows={rows} animate={animate} onOpenFile={onOpenFile} onComplete={() => setRunComplete(true)} />
        {runComplete && <ResearchDebug research={step.research} />}
        {runComplete && children}
      </AssistantMessage>
    </div>
  );
}

/* ── Conversation ────────────────────────────────────────────────────── */
interface WebBuildConversationProps {
  steps: WebBuildStep[];
  /** Latest file set + sections for the panels (current state). */
  files: WebBuildFile[];
  sectionItems: WebBuildSectionItem[];
  brief: { type?: string; audience?: string; goal?: string; style?: string };
  /** A build in progress to append at the bottom (phases run during the call). */
  live?: { prompt: string; kind?: 'build' | 'revision' } | null;
  /** Extra cards (e.g. Save to Project) appended after the last assistant msg. */
  extraCards?: ReactNode;
  slug?: string;
  /** The newest step id — its run plays the sequential live reveal. */
  animateStepId?: string;
  /** Stable id for the preview route (/preview/web-build/:runId). */
  runId?: string;
}

export default function WebBuildConversation({
  steps, files, sectionItems, brief, live, extraCards, slug, animateStepId, runId,
}: WebBuildConversationProps) {
  const { t } = useLanguageStore();
  const [panel, setPanel] = useState<'preview' | 'files' | null>(null);
  const [filePath, setFilePath] = useState<string | undefined>(undefined);
  const lastIdx = steps.length - 1;
  const openFile = (path?: string) => { setFilePath(path); setPanel('files'); };

  return (
    <div className="space-y-5">
      {steps.map((step, i) => {
        const isLast = i === lastIdx && !live;
        return (
          <RunTurn
            key={step.id}
            step={step}
            brief={brief}
            animate={step.id === animateStepId}
            onOpenFile={openFile}
          >
            {isLast && (
              <div className="flex flex-col gap-2 pt-0.5">
                <AttachmentCard icon={Monitor} title={t('wbCardPreview')} subtitle={t('wbCardPreviewSub')} actionLabel={t('wbCardOpen')} tone="accent" onClick={() => setPanel('preview')} />
                <AttachmentCard icon={FolderTree} title={t('wbCardAllFiles')} subtitle={t('wbCardAllFilesSub')} actionLabel={t('wbCardOpen')} onClick={() => openFile(undefined)} />
                {extraCards}
              </div>
            )}
          </RunTurn>
        );
      })}

      {live && <LivePhases prompt={live.prompt} kind={live.kind || 'build'} />}

      {/* Slide-in panel (Preview / All files) */}
      <AnimatePresence>
        {panel && (
          <motion.div
            className="fixed inset-0 z-[60] flex justify-end"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/50" onClick={() => setPanel(null)} />
            <motion.div
              initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }}
              transition={{ type: 'spring', duration: 0.35, bounce: 0.1 }}
              className="relative w-full max-w-2xl h-full overflow-y-auto scrollbar-thin bg-[#0D1117] border-l border-white/[0.08] p-4 sm:p-5"
            >
              <div className="flex items-center justify-between mb-4">
                <span className="text-[13px] font-semibold text-white">
                  {panel === 'preview' ? t('wbCardPreview') : t('wbCardAllFiles')}
                </span>
                <button onClick={() => setPanel(null)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[#94A3B8] hover:text-white hover:bg-white/[0.05] transition-colors" aria-label={t('wbClosePanel')}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              {panel === 'preview'
                ? <WebBuildPreviewPanel sectionItems={sectionItems} brief={brief} slug={slug} runId={runId} />
                : <WebBuildFileView files={files} initialPath={filePath} />}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
