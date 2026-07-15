import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, AlertCircle, ChevronDown } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import type { Language } from '@/stores/languageStore';
import {
  ACTIVITY_TITLES, ACTIVITY_DETAIL_LABELS,
  type WebBuildActivityState, type WebBuildActivityItem,
} from '@/lib/webBuildActivity';

/**
 * Web Build ACTIVITY WORKSTREAM (Phase 13H.1) — a CONVERSATIONAL, Claude/Kimi-style agent
 * narration that lives inside the assistant's normal chat response. It is a PURE VIEW over
 * the Phase 13H `WebBuildActivityState` (real reporter events remain authoritative): it never
 * advances a stage, never reveals a stage before its real event, and never shows untouched
 * future ("waiting") stages. A timer is used ONLY to tick the visible elapsed duration of the
 * single active stage — never to advance a stage.
 *
 * There is deliberately no dashboard card, no status column and no checklist of future work.
 * No chain-of-thought, prompts, generated source, provider/job ids or secrets are ever shown.
 */
export interface WebBuildActivityTimelineProps {
  state: WebBuildActivityState;
  /** Run start (ms) — the active-stage elapsed clock for a live run. */
  startedAt: number;
  /** Run end (ms) — present once the run finished (summary variant). */
  endedAt?: number;
  /** `live` = the in-flight conversational lines; `summary` = one natural ending line. */
  variant: 'live' | 'summary';
  /** User-requested stop → neutral "stopped" presentation (never "failed"). */
  stopped?: boolean;
}

/** en/tr/de string triple — mirrors the shape in `@/lib/webBuildActivity`. */
type L3 = { en: string; tr: string; de: string };

/** Resolve an L3 triple for the effective language, English-backed (never a
 *  silent German→English or German→Turkish route). Phase 14C.2. */
const pick = (m: L3 | undefined, lang: Language, fallback: string): string =>
  (m ? (m[lang] ?? m.en) : fallback);

/* Completed lines read like a FINISHED action ("Request understood"); the progressive/active
 * forms ("Understanding your request") live in ACTIVITY_TITLES. Kept LOCAL so this phase does
 * not touch the shared i18n locale files. Falls back to the active title if absent. en/tr/de. */
const DONE_TITLES: Record<string, L3> = {
  'request-understanding': { en: 'Request understood', tr: 'İstek incelendi', de: 'Anfrage verstanden' },
  research: { en: 'Website direction researched', tr: 'Site yönü araştırıldı', de: 'Website-Richtung recherchiert' },
  planning: { en: 'Website strategy created', tr: 'Site stratejisi oluşturuldu', de: 'Website-Strategie erstellt' },
  specification: { en: 'Build specification prepared', tr: 'Build planı hazırlandı', de: 'Build-Spezifikation vorbereitet' },
  'frontend-generation': { en: 'React project generated', tr: 'React projesi oluşturuldu', de: 'React-Projekt generiert' },
  'frontend-validation': { en: 'Generated files validated', tr: 'Dosyalar doğrulandı', de: 'Generierte Dateien geprüft' },
  'structural-repair': { en: 'Project structure repaired', tr: 'Proje yapısı düzeltildi', de: 'Projektstruktur repariert' },
  'quality-review': { en: 'Design quality reviewed', tr: 'Tasarım kalitesi incelendi', de: 'Designqualität geprüft' },
  'quality-repair': { en: 'Quality improvements applied', tr: 'Kalite iyileştirmeleri uygulandı', de: 'Qualitätsverbesserungen angewendet' },
  acceptance: { en: 'Candidate finalized', tr: 'Candidate hazırlandı', de: 'Kandidat finalisiert' },
  preview: { en: 'Preview prepared', tr: 'Önizleme hazırlandı', de: 'Vorschau vorbereitet' },
  'revision-understanding': { en: 'Change understood', tr: 'Değişiklik incelendi', de: 'Änderung verstanden' },
  'revision-generation': { en: 'React project updated', tr: 'React projesi güncellendi', de: 'React-Projekt aktualisiert' },
  'revision-validation': { en: 'Revised files validated', tr: 'Düzenlenen dosyalar doğrulandı', de: 'Überarbeitete Dateien geprüft' },
  'revision-preservation': { en: 'Working project preserved', tr: 'Çalışan proje korundu', de: 'Funktionierendes Projekt bewahrt' },
  'revision-preview': { en: 'Updated preview prepared', tr: 'Güncellenen önizleme hazırlandı', de: 'Aktualisierte Vorschau vorbereitet' },
};

/** Format a bounded duration, localized: "3m 18s" / "3 dk 18 sn" / "3 Min 18 Sek". */
function formatDuration(ms: number, lang: Language): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const shortUnit = lang === 'tr' ? ' sn' : lang === 'de' ? ' Sek' : 's';
  if (total < 60) return `${total}${shortUnit}`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (lang === 'tr') return `${m} dk ${s} sn`;
  if (lang === 'de') return `${m} Min ${s} Sek`;
  return `${m}m ${s}s`;
}

/** Small, restrained status marker (no bordered badge, no dashboard column). */
function Marker({ kind, reducedMotion }: { kind: 'active' | 'completed' | 'failed' | 'neutral'; reducedMotion: boolean }) {
  if (kind === 'completed') return <Check className="h-3.5 w-3.5 text-[#86A08F]/90" strokeWidth={2.75} aria-hidden />;
  if (kind === 'failed') return <AlertCircle className="h-3.5 w-3.5 text-[#E0A35B]" strokeWidth={2.5} aria-hidden />;
  if (kind === 'active') {
    return (
      <span className="relative flex h-3.5 w-3.5 items-center justify-center" aria-hidden>
        {!reducedMotion && <span className="absolute inline-flex h-3 w-3 animate-ping rounded-full bg-[#60A5FA] opacity-60" />}
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#60A5FA]" />
      </span>
    );
  }
  // neutral (an active stage interrupted by a user stop — no pulse, muted)
  return (
    <span className="flex h-3.5 w-3.5 items-center justify-center" aria-hidden>
      <span className="h-1.5 w-1.5 rounded-full bg-[#64748B]" />
    </span>
  );
}

/** One conversational activity line: a marker + a state-aware sentence, with an optional
 *  inline (indented, card-less) detail expansion. */
function Line({
  item, lang, now, open, onToggle, reducedMotion, neutral, animate,
}: {
  item: WebBuildActivityItem; lang: Language; now: number;
  open: boolean; onToggle: () => void; reducedMotion: boolean; neutral: boolean; animate: boolean;
}) {
  const isActive = item.status === 'active' && !neutral;
  const isCompleted = item.status === 'completed';
  const isFailed = item.status === 'failed';
  const markerKind = isCompleted ? 'completed' : isFailed ? 'failed' : isActive ? 'active' : 'neutral';

  const activeTitle = pick(ACTIVITY_TITLES[item.titleKey], lang, item.titleKey);
  const title = isCompleted
    ? pick(DONE_TITLES[item.id], lang, activeTitle)
    : isActive
      ? `${activeTitle}…`
      : activeTitle;

  const titleTone = isActive ? 'text-slate-200'
    : isFailed ? 'text-[#E0A35B]'
    : 'text-[#94A3B8]';

  const hasDetail = !!item.detailRows && item.detailRows.length > 0;

  return (
    <motion.div
      initial={animate && !reducedMotion ? { opacity: 0, y: 3 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
    >
      <div className="flex items-start gap-2">
        <span className="mt-[3px] shrink-0"><Marker kind={markerKind} reducedMotion={reducedMotion} /></span>
        <div className="min-w-0 flex-1">
          {hasDetail ? (
            <button type="button" onClick={onToggle} aria-expanded={open} className="text-left">
              <span className={`text-[13px] leading-snug ${titleTone}`}>{title}</span>
              <ChevronDown className={`ml-1 inline h-3 w-3 text-[#64748B] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
            </button>
          ) : (
            <span className={`text-[13px] leading-snug ${titleTone}`}>{title}</span>
          )}

          {/* Elapsed lives beneath the ACTIVE sentence only — a real per-stage clock. */}
          {isActive && item.startedAt && (
            <div className="mt-0.5 text-[11px] tabular-nums text-[#64748B]">{formatDuration(now - item.startedAt, lang)}</div>
          )}

          <AnimatePresence initial={false}>
            {open && hasDetail && (
              <motion.div
                initial={reducedMotion ? false : { height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <div className="mt-1 space-y-0.5 border-l border-white/[0.08] pl-2.5">
                  {item.detailRows!.map((r, i) => (
                    <div key={i} className="flex gap-1.5 text-[11.5px] leading-relaxed">
                      <span className="text-[#64748B]">{pick(ACTIVITY_DETAIL_LABELS[r.label], lang, r.label)}:</span>
                      <span className="min-w-0 break-words text-[#94A3B8]">{r.value}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

export default function WebBuildActivityTimeline({ state, startedAt, endedAt, variant, stopped = false }: WebBuildActivityTimelineProps) {
  const { lang } = useLanguageStore();
  const reducedMotion = !!useReducedMotion();
  const L = (en: string, tr: string, de: string) => (lang === 'tr' ? tr : lang === 'de' ? de : en);

  const [openId, setOpenId] = useState<string | null>(null);
  // A live run shows its reached lines inline. A finished run collapses to one natural ending
  // line; a genuine FAILURE opens by default so the failed step stays visible.
  const [expanded, setExpanded] = useState<boolean>(
    variant === 'live' || (variant === 'summary' && state.final === 'failed' && !stopped),
  );

  // Elapsed clock — ticks ONLY while a live run is in flight (never advances a stage).
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (variant !== 'live' || state.final !== 'running' || stopped) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [variant, state.final, stopped]);

  // Only REACHED stages are ever rendered — active / completed / failed. Untouched `waiting`
  // stages and internal `skipped` conditionals stay invisible (no checklist of future work).
  const reached = useMemo(
    () => state.items.filter((it) => it.status === 'active' || it.status === 'completed' || it.status === 'failed'),
    [state.items],
  );

  const renderLines = (neutral: boolean) => (
    <div className="space-y-1.5">
      <AnimatePresence initial={false}>
        {reached.map((item) => (
          <Line
            key={item.id}
            item={item}
            lang={lang}
            now={now}
            open={openId === item.id}
            onToggle={() => setOpenId((cur) => (cur === item.id ? null : item.id))}
            reducedMotion={reducedMotion}
            neutral={neutral}
            animate={variant === 'live'}
          />
        ))}
      </AnimatePresence>
    </div>
  );

  // LIVE — the conversational workstream, reached lines fully visible.
  if (variant === 'live') {
    return <div className="min-w-0 flex-1">{renderLines(false)}</div>;
  }

  // SUMMARY — one natural ending line; click to reveal the reached conversational lines.
  const isRevision = state.kind === 'revision';
  const summaryText = stopped
    ? L('Generation stopped', 'Oluşturma durduruldu', 'Generierung gestoppt')
    : state.final === 'failed'
      ? (isRevision ? L('Change failed', 'Değişiklik başarısız', 'Änderung fehlgeschlagen') : L('Build failed', 'Oluşturma başarısız', 'Build fehlgeschlagen'))
      : (isRevision ? L('Changes applied', 'Değişiklikler uygulandı', 'Änderungen angewendet') : L('Website created', 'Web sitesi oluşturuldu', 'Website erstellt'));
  const summaryMarker: 'completed' | 'failed' | 'neutral' = stopped ? 'neutral' : state.final === 'failed' ? 'failed' : 'completed';
  const summaryTone = stopped ? 'text-[#94A3B8]' : state.final === 'failed' ? 'text-[#E0A35B]' : 'text-slate-200';
  const showDuration = !stopped && state.final === 'completed';

  return (
    <div className="min-w-0 flex-1">
      <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="flex items-center gap-2 text-left">
        <span className="shrink-0"><Marker kind={summaryMarker} reducedMotion={reducedMotion} /></span>
        <span className={`text-[13px] font-medium leading-snug ${summaryTone}`}>{summaryText}</span>
        {showDuration && <span className="text-[11px] tabular-nums text-[#64748B]">· {formatDuration((endedAt ?? now) - startedAt, lang)}</span>}
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[#64748B] transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={reducedMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="mt-2">{renderLines(stopped)}</div>
            {/* Quiet honesty line — a completed pipeline is not a rendered-visual pass. */}
            {!isRevision && !stopped && state.final === 'completed' && (
              <p className="mt-2 text-[10.5px] leading-relaxed text-[#64748B]">
                {L('Visual quality is not evaluated here — open Preview to inspect the result.',
                  'Görsel kalite burada değerlendirilmez — sonucu görmek için Önizleme’yi aç.',
                  'Die visuelle Qualität wird hier nicht bewertet — öffne die Vorschau, um das Ergebnis zu prüfen.')}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
