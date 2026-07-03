import { useMemo, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  LayoutGrid, ListTree, Palette, PenLine, Code2, Monitor,
  Activity as ActivityIcon, Copy, Check, FileCode,
} from 'lucide-react';
import MarkdownMessage from '@/components/MarkdownMessage';
import BrowserFrame from '@/components/builder/BrowserFrame';
import WebBuildActivityTable from '@/components/builder/WebBuildActivityTable';
import { useLanguageStore } from '@/stores/languageStore';
import type { WebBuildView } from '@/lib/webBuildPayload';

/**
 * Shared read-only Web Build output — the tabbed view of a build (Overview /
 * Sections / Design / Copy / Code / Preview / Activity). Fed by a normalized
 * WebBuildView so BOTH the live Web Build page and a saved project render the
 * SAME thing from the SAME data. A tab only appears when it has content; empty
 * tabs show a helpful explanation, never a blank panel. Hosts can append their
 * own tabs (e.g. a Save tab) via `extraTabs`.
 */
const ACCENT = '#60A5FA';

const bodyOf = (view: WebBuildView, re: RegExp) => view.sections.find((s) => re.test(s.title))?.body || '';

export interface ExtraTab {
  id: string;
  label: string;
  icon?: typeof LayoutGrid;
  content: ReactNode;
}

interface WebBuildOutputProps {
  view: WebBuildView;
  extraTabs?: ExtraTab[];
  initialTab?: string;
  slug?: string;
}

function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="rounded-xl border border-dashed border-white/[0.08] px-4 py-8 text-center">
      <p className="text-[12px] text-[#64748B]">{msg}</p>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const { t } = useLanguageStore();
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* ignore */ } }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] px-2.5 py-1 text-[11px] text-slate-200 hover:bg-white/[0.06] transition-colors"
    >
      {copied ? <Check className="h-3 w-3" style={{ color: ACCENT }} /> : <Copy className="h-3 w-3" />}
      {copied ? t('copied') : t('copy')}
    </button>
  );
}

export default function WebBuildOutput({ view, extraTabs = [], initialTab, slug }: WebBuildOutputProps) {
  const { t } = useLanguageStore();

  const design = bodyOf(view, /design\s*direction/i);
  const copy = bodyOf(view, /generated\s*copy/i);
  const code = bodyOf(view, /frontend\s*code|code\s*files/i);
  const plan = bodyOf(view, /build\s*plan/i);
  const hasBrief = Boolean(view.brief.type || view.brief.audience || view.brief.goal || view.brief.style);

  const tabs = useMemo(() => {
    const base = [
      { id: 'overview', label: t('wbTabOverview'), icon: LayoutGrid },
      { id: 'sections', label: t('wbTabSections'), icon: ListTree },
      { id: 'design',   label: t('wbTabDesign'),   icon: Palette },
      { id: 'copy',     label: t('wbTabCopy'),      icon: PenLine },
      { id: 'code',     label: t('wbTabCode'),      icon: Code2 },
      { id: 'preview',  label: t('wbTabPreview'),   icon: Monitor },
      { id: 'activity', label: t('wbTabActivity'),  icon: ActivityIcon },
    ];
    return [...base, ...extraTabs.map((e) => ({ id: e.id, label: e.label, icon: e.icon || LayoutGrid }))];
  }, [t, extraTabs]);

  const [active, setActive] = useState(initialTab || 'overview');
  const extra = extraTabs.find((e) => e.id === active);

  const briefRow = (labelKey: string, value?: string) =>
    value ? (
      <div className="flex items-start gap-3 py-1.5">
        <span className="w-28 shrink-0 text-[11px] text-[#64748B]">{t(labelKey)}</span>
        <span className="text-[12px] text-slate-200">{value}</span>
      </div>
    ) : null;

  return (
    <div>
      {/* Tab bar */}
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none border-b border-white/[0.06] mb-4 pb-px">
        {tabs.map((tab) => {
          const on = active === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={`relative flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 text-[12px] font-medium transition-colors ${
                on ? 'text-white' : 'text-[#94A3B8] hover:text-[#CBD5E1]'
              }`}
            >
              <tab.icon className="h-3 w-3" />
              {tab.label}
              {on && (
                <motion.span layoutId="wbOutTab" className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full" style={{ background: ACCENT }} transition={{ type: 'spring', duration: 0.4, bounce: 0.15 }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Panels */}
      {extra ? (
        extra.content
      ) : active === 'overview' ? (
        hasBrief || plan ? (
          <div className="rounded-xl border border-white/[0.05] bg-white/[0.01] p-4">
            {briefRow('wbOverviewType', view.brief.type)}
            {briefRow('wbOverviewAudience', view.brief.audience)}
            {briefRow('wbOverviewGoal', view.brief.goal)}
            {briefRow('wbOverviewStyle', view.brief.style)}
            {!hasBrief && plan && <MarkdownMessage content={plan} />}
          </div>
        ) : <EmptyState msg={t('wbEmptyOverview')} />
      ) : active === 'sections' ? (
        view.sectionItems.length > 0 ? (
          <div className="space-y-2">
            {view.sectionItems.map((s) => (
              <div key={s.id} className="rounded-xl border border-white/[0.05] bg-white/[0.01] p-3">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[12.5px] font-medium text-slate-100">{s.name}</span>
                  {s.component && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-[#64748B]">
                      <FileCode className="h-3 w-3" />{s.component}
                    </span>
                  )}
                </div>
                {s.purpose && <p className="text-[11.5px] text-[#94A3B8] leading-snug">{s.purpose}</p>}
                {s.copyPreview && <p className="mt-1.5 text-[11.5px] text-[#CBD5E1] leading-snug border-l-2 border-white/[0.08] pl-2">{s.copyPreview}</p>}
              </div>
            ))}
          </div>
        ) : <EmptyState msg={t('wbEmptySections')} />
      ) : active === 'design' ? (
        design ? <MarkdownMessage content={design} /> : <EmptyState msg={t('wbEmptyDesign')} />
      ) : active === 'copy' ? (
        copy ? <MarkdownMessage content={copy} /> : <EmptyState msg={t('wbEmptyCopy')} />
      ) : active === 'code' ? (
        code || view.files.length ? (
          <div className="space-y-3">
            {view.files.length > 0 && (
              <div className="rounded-xl border border-white/[0.05] bg-white/[0.01] p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold text-[#94A3B8] uppercase tracking-wider">{t('wbFilesTitle')}</span>
                  {code && <CopyButton text={code} />}
                </div>
                <ul className="space-y-1">
                  {view.files.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-[12px] text-[#CBD5E1] font-mono">
                      <FileCode className="h-3 w-3 text-[#64748B] shrink-0" />{f}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {code ? <MarkdownMessage content={code} /> : <EmptyState msg={t('wbEmptyCode')} />}
          </div>
        ) : <EmptyState msg={t('wbEmptyCode')} />
      ) : active === 'preview' ? (
        copy || view.sectionItems.length ? (
          <div>
            <BrowserFrame url={slug || 'preview.korvix.build'} accentColor={ACCENT}>
              <div className="p-5 space-y-4">
                {/* Hero sketch */}
                <div className="rounded-xl border border-white/[0.06] bg-gradient-to-b from-white/[0.03] to-transparent p-5 text-center">
                  <div className="mx-auto h-2 w-24 rounded bg-white/[0.12] mb-2.5" />
                  <div className="mx-auto h-1.5 w-40 rounded bg-white/[0.06] mb-3" />
                  <div className="mx-auto h-6 w-28 rounded-lg" style={{ background: `${ACCENT}33` }} />
                </div>
                {/* Section cards */}
                <div className="grid grid-cols-2 gap-2.5">
                  {view.sectionItems.slice(0, 6).map((s) => (
                    <div key={s.id} className="rounded-lg border border-white/[0.05] bg-white/[0.01] p-2.5">
                      <div className="text-[11px] font-medium text-slate-200 mb-1">{s.name}</div>
                      <div className="h-1 w-full rounded bg-white/[0.06] mb-1" />
                      <div className="h-1 w-2/3 rounded bg-white/[0.04]" />
                    </div>
                  ))}
                </div>
              </div>
            </BrowserFrame>
            <p className="mt-2 text-[11px] text-[#64748B]">{t('wbPreviewCaption')}</p>
          </div>
        ) : <EmptyState msg={t('wbEmptyPreview')} />
      ) : active === 'activity' ? (
        view.activity.length > 0
          ? <WebBuildActivityTable rows={view.activity} />
          : <EmptyState msg={t('wbEmptyActivity')} />
      ) : null}
    </div>
  );
}
