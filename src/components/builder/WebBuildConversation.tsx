import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles, Monitor, FolderTree, ArrowRight, X, Loader2,
} from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import WebBuildActivityCard from '@/components/builder/WebBuildActivityCard';
import WebBuildFileView from '@/components/builder/WebBuildFileView';
import WebBuildPreviewPanel from '@/components/builder/WebBuildPreviewPanel';
import type {
  WebBuildStep, WebBuildFile, WebBuildSectionItem, WebBuildActivityRow,
} from '@/lib/webBuildPayload';

/**
 * The Web Build conversation feed (Claude/Kimi style): user + assistant
 * messages, a collapsible Build activity card, and clickable Preview / All
 * files attachment cards that open a slide-in panel. Shared by the live Web
 * Build page and the saved-project view so both read identically.
 */
const ACCENT = '#60A5FA';

/* ── Attachment card ─────────────────────────────────────────────────── */
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

function AssistantMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg" style={{ background: `${ACCENT}1a`, border: `1px solid ${ACCENT}33` }}>
        <Sparkles className="h-3.5 w-3.5" style={{ color: ACCENT }} />
      </div>
      <div className="min-w-0 flex-1 space-y-2.5">{children}</div>
    </div>
  );
}

/* ── Assistant text composed from real summary data ──────────────────── */
function useAssistantLines() {
  const { t } = useLanguageStore();
  return (step: WebBuildStep): string[] => {
    const s = step.summary;
    if (step.kind === 'revision') {
      const changed = step.files.filter((f) => f.status !== 'unchanged').length;
      if (s.added || s.removed) return [t('wbMsgRevision', { count: changed || step.files.length, added: s.added, removed: s.removed })];
      return [t('wbMsgRevisionNoDiff')];
    }
    const lines = [s.type ? t('wbMsgDoneType', { type: s.type }) : t('wbMsgDone')];
    if (s.sectionNames.length) lines.push(t('wbMsgSectionsLine', { sections: s.sectionNames.join(', ') }));
    if (s.fileCount) lines.push(t('wbMsgFilesLine', { count: s.fileCount }));
    return lines;
  };
}

/* ── Conversation ────────────────────────────────────────────────────── */
interface WebBuildConversationProps {
  steps: WebBuildStep[];
  /** Latest file set + sections for the panels (current state). */
  files: WebBuildFile[];
  sectionItems: WebBuildSectionItem[];
  brief: { type?: string; audience?: string; goal?: string; style?: string };
  /** A build in progress to append at the bottom. */
  live?: { prompt: string; rows: WebBuildActivityRow[] } | null;
  /** Extra cards (e.g. Save to Project) appended after the last assistant msg. */
  extraCards?: ReactNode;
  slug?: string;
}

export default function WebBuildConversation({
  steps, files, sectionItems, brief, live, extraCards, slug,
}: WebBuildConversationProps) {
  const { t } = useLanguageStore();
  const lines = useAssistantLines();
  const [panel, setPanel] = useState<'preview' | 'files' | null>(null);
  const lastIdx = steps.length - 1;

  return (
    <div className="space-y-5">
      {steps.map((step, i) => {
        const isLast = i === lastIdx && !live;
        return (
          <div key={step.id} className="space-y-3">
            <UserMessage text={step.prompt} />
            <AssistantMessage>
              <div className="text-[13px] text-[#CBD5E1] leading-relaxed space-y-1">
                {lines(step).map((l, k) => <p key={k}>{l}</p>)}
              </div>
              <WebBuildActivityCard rows={step.activity} defaultOpen={false} />
              {/* Output cards only on the latest step (current state). */}
              {isLast && (
                <div className="flex flex-col gap-2 pt-0.5">
                  <AttachmentCard icon={Monitor} title={t('wbCardPreview')} subtitle={t('wbCardPreviewSub')} actionLabel={t('wbCardOpen')} tone="accent" onClick={() => setPanel('preview')} />
                  <AttachmentCard icon={FolderTree} title={t('wbCardAllFiles')} subtitle={t('wbCardAllFilesSub')} actionLabel={t('wbCardOpen')} onClick={() => setPanel('files')} />
                  {extraCards}
                </div>
              )}
            </AssistantMessage>
          </div>
        );
      })}

      {/* Live build in progress */}
      {live && (
        <div className="space-y-3">
          <UserMessage text={live.prompt} />
          <AssistantMessage>
            <div className="flex items-center gap-2 text-[13px] text-[#CBD5E1]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: ACCENT }} />
              {t('wbMsgIntro')}
            </div>
            <WebBuildActivityCard rows={live.rows} defaultOpen />
          </AssistantMessage>
        </div>
      )}

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
                ? <WebBuildPreviewPanel sectionItems={sectionItems} brief={brief} slug={slug} />
                : <WebBuildFileView files={files} />}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
