import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, Minus, AlertCircle, ChevronDown } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import {
  ACTIVITY_TITLES, ACTIVITY_STATUS_LABELS, ACTIVITY_DETAIL_LABELS,
  countActivity,
  type WebBuildActivityState, type WebBuildActivityItem, type WebBuildActivityStatus,
} from '@/lib/webBuildActivity';

/**
 * Web Build ACTIVITY TIMELINE (Phase 13H) — a truthful, Kimi-inspired but Korvix-branded
 * expandable activity list. It is a PURE VIEW over `WebBuildActivityState`: it renders only
 * the stages/statuses/detail rows the real pipeline reported, and never advances anything
 * itself. A timer is used ONLY to tick the visible elapsed duration of the active stage
 * (never to advance a stage — that would be the old simulated behaviour this replaces).
 *
 * Honesty: a running sandbox / completed pipeline is NOT a rendered-visual pass, so a
 * completed build shows a small "visual quality not evaluated here" note. No chain-of-thought,
 * prompts, generated source, provider/job ids or secrets are ever displayed.
 */
export interface WebBuildActivityTimelineProps {
  state: WebBuildActivityState;
  /** Run start (ms) — the header elapsed clock for a live run. */
  startedAt: number;
  /** Run end (ms) — present once the run finished (summary variant). */
  endedAt?: number;
  /** `live` = expanded in-flight timeline; `summary` = compact, expandable completed/failed. */
  variant: 'live' | 'summary';
}

type Lang = 'en' | 'tr';

const pick = (m: { en: string; tr: string } | undefined, lang: Lang, fallback: string): string =>
  (m ? (lang === 'tr' ? m.tr : m.en) : fallback);

/** Format a bounded duration: "42s", "3m 18s". */
function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

/** The status marker for a single row — subdued, restrained, one marker per row. */
function StatusMarker({ status, reducedMotion }: { status: WebBuildActivityStatus; reducedMotion: boolean }) {
  if (status === 'completed') {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#86A08F]/15">
        <Check className="h-2.5 w-2.5 text-[#86A08F]" strokeWidth={3} />
      </span>
    );
  }
  if (status === 'active') {
    return (
      <span className="relative flex h-4 w-4 items-center justify-center">
        {!reducedMotion && <span className="absolute inline-flex h-3 w-3 animate-ping rounded-full bg-[#60A5FA] opacity-60" />}
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#60A5FA]" />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#E0A35B]/15">
        <AlertCircle className="h-2.5 w-2.5 text-[#E0A35B]" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === 'skipped') {
    return (
      <span className="flex h-4 w-4 items-center justify-center">
        <Minus className="h-2.5 w-2.5 text-[#475569]" strokeWidth={2.5} />
      </span>
    );
  }
  // waiting
  return (
    <span className="flex h-4 w-4 items-center justify-center">
      <span className="h-2 w-2 rounded-full border border-[#475569]" />
    </span>
  );
}

function Row({
  item, lang, now, isLastRow, open, onToggle, reducedMotion,
}: {
  item: WebBuildActivityItem; lang: Lang; now: number; isLastRow: boolean;
  open: boolean; onToggle: () => void; reducedMotion: boolean;
}) {
  const title = pick(ACTIVITY_TITLES[item.titleKey], lang, item.titleKey);
  const hasDetail = !!item.detailRows && item.detailRows.length > 0;
  const dim = item.status === 'waiting' || item.status === 'skipped';

  // Right-aligned meta: elapsed for the active row, duration for a finished timed row, else
  // the localized status label. Real timestamps only — never a fabricated metric.
  let meta = pick(ACTIVITY_STATUS_LABELS[item.status], lang, item.status);
  if (item.status === 'active' && item.startedAt) meta = formatDuration(now - item.startedAt);
  else if ((item.status === 'completed' || item.status === 'failed') && item.startedAt && item.completedAt) {
    meta = formatDuration(item.completedAt - item.startedAt);
  }

  const titleTone = item.status === 'active' ? 'text-slate-100'
    : item.status === 'failed' ? 'text-[#E0A35B]'
    : dim ? 'text-[#64748B]' : 'text-[#CBD5E1]';

  return (
    <div className="relative">
      {/* connecting line (skips the last row) */}
      {!isLastRow && <span className="absolute left-[7px] top-5 h-[calc(100%-8px)] w-px bg-white/[0.07]" aria-hidden />}
      <div className="flex items-center gap-2.5">
        <span className="relative z-[1] shrink-0">
          <StatusMarker status={item.status} reducedMotion={reducedMotion} />
        </span>
        {hasDetail ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="group flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 pr-1 text-left"
          >
            <span className={`min-w-0 flex-1 truncate text-[12.5px] ${titleTone}`}>{title}</span>
            <span className="shrink-0 text-[10.5px] tabular-nums text-[#64748B]">{meta}</span>
            <ChevronDown className={`h-3 w-3 shrink-0 text-[#64748B] transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2 py-0.5 pr-1">
            <span className={`min-w-0 flex-1 truncate text-[12.5px] ${titleTone}`}>{title}</span>
            <span className="shrink-0 text-[10.5px] tabular-nums text-[#64748B]">{meta}</span>
          </div>
        )}
      </div>

      <AnimatePresence initial={false}>
        {open && hasDetail && (
          <motion.div
            initial={reducedMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="ml-[26px] mt-1 mb-1 rounded-lg border border-white/[0.07] bg-black/20 px-2.5 py-1.5">
              {item.detailRows!.map((r, i) => (
                <div key={i} className="flex gap-2 text-[11px] leading-relaxed">
                  <span className="w-32 shrink-0 text-[#64748B]">{pick(ACTIVITY_DETAIL_LABELS[r.label], lang, r.label)}</span>
                  <span className="min-w-0 break-words text-[#CBD5E1]">{r.value}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function WebBuildActivityTimeline({ state, startedAt, endedAt, variant }: WebBuildActivityTimelineProps) {
  const { lang } = useLanguageStore();
  const reducedMotion = !!useReducedMotion();
  const L = (en: string, tr: string) => (lang === 'tr' ? tr : en);

  // Only ONE detail section open at a time. Live runs auto-open the active stage's details.
  const [openId, setOpenId] = useState<string | null>(null);
  // Summary variant collapses by default; live variant is always expanded.
  const [expanded, setExpanded] = useState<boolean>(variant === 'live');

  // Elapsed clock — ticks ONLY while a live run is in flight (never advances a stage).
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (variant !== 'live' || state.final !== 'running') return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [variant, state.final]);

  const counts = useMemo(() => countActivity(state), [state]);
  const isRevision = state.kind === 'revision';
  const totalMs = (endedAt ?? now) - startedAt;

  const headerTitle = state.final === 'running'
    ? (isRevision ? L('Applying your changes', 'Değişiklikleriniz uygulanıyor') : L('Building your website', 'Web siteniz oluşturuluyor'))
    : state.final === 'failed'
      ? (isRevision ? L('Change failed', 'Değişiklik başarısız') : L('Build failed', 'Oluşturma başarısız'))
      : (isRevision ? L('Changes applied', 'Değişiklikler uygulandı') : L('Website created', 'Web sitesi oluşturuldu'));

  const stagesLine = state.final === 'failed'
    ? L(`${counts.completed} of ${state.items.length} stages completed`, `${state.items.length} aşamadan ${counts.completed} tamamlandı`)
    : L(`${counts.completed} stages completed${counts.skipped ? ` · ${counts.skipped} skipped` : ''}`,
        `${counts.completed} aşama tamamlandı${counts.skipped ? ` · ${counts.skipped} atlandı` : ''}`);

  const headerToggleable = variant === 'summary';

  const HeaderMarker = () => {
    if (state.final === 'running') return <StatusMarker status="active" reducedMotion={reducedMotion} />;
    if (state.final === 'failed') return <StatusMarker status="failed" reducedMotion={reducedMotion} />;
    return <StatusMarker status="completed" reducedMotion={reducedMotion} />;
  };

  const header = (
    <div className="flex items-center gap-2.5">
      <span className="shrink-0"><HeaderMarker /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[12.5px] font-medium text-slate-100">{headerTitle}</span>
          <span className="shrink-0 text-[11px] tabular-nums text-[#64748B]">· {formatDuration(totalMs)}</span>
        </div>
        {variant === 'summary' && <div className="mt-0.5 text-[11px] text-[#64748B]">{stagesLine}</div>}
      </div>
      {headerToggleable && (
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[#64748B] transition-transform ${expanded ? 'rotate-180' : ''}`} />
      )}
    </div>
  );

  return (
    <div className="min-w-0 flex-1 rounded-xl border border-white/[0.07] bg-white/[0.015] px-3 py-2.5">
      {headerToggleable ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="w-full text-left"
        >
          {header}
        </button>
      ) : header}

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={reducedMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="mt-2.5 space-y-1.5">
              {state.items.map((item, i) => (
                <Row
                  key={item.id}
                  item={item}
                  lang={lang as Lang}
                  now={now}
                  isLastRow={i === state.items.length - 1}
                  open={openId === item.id}
                  onToggle={() => setOpenId((cur) => (cur === item.id ? null : item.id))}
                  reducedMotion={reducedMotion}
                />
              ))}
            </div>
            {/* Honesty footer — a completed pipeline is NOT a rendered-visual pass. */}
            {!isRevision && state.final !== 'running' && (
              <p className="mt-2.5 border-t border-white/[0.05] pt-2 text-[10.5px] leading-relaxed text-[#64748B]">
                {L(
                  'These stages reflect the real build pipeline. Visual quality is not evaluated here — open Preview to inspect the result.',
                  'Bu aşamalar gerçek build sürecini yansıtır. Görsel kalite burada değerlendirilmez — sonucu incelemek için Önizleme’yi aç.',
                )}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
