/**
 * Web Build ACTIVITY MODEL (Phase 13H) — the first, deliberately small foundation for a
 * future unified Korvix agent-activity system.
 *
 * This is a LEAF module: pure, deterministic, serializable, network-free types + reducer
 * helpers that describe a TRUTHFUL activity timeline for a Web Build run. It replaces the
 * old timer-driven "Think" animation: every stage here is advanced ONLY by a real pipeline
 * boundary (via a `WebBuildActivityReporter`), never by a `setInterval`.
 *
 * Honesty boundaries this module encodes:
 *   • a stage is `completed` ONLY after its real code boundary returned;
 *   • the next stage is `active` immediately before its real operation begins;
 *   • conditional stages that did not run are `skipped`, never faked as `completed`;
 *   • at most ONE stage is `active` at a time;
 *   • detail rows carry ONLY bounded, safe values (counts / statuses / durations) — never
 *     prompts, generated source, provider/job ids, raw responses, secrets or hidden
 *     model reasoning. Callers must respect that; `boundDetailRows` clamps length only.
 *
 * The activity state is SESSION-LOCAL UI state. It is intentionally NOT persisted into the
 * saved Web Build payload in this phase.
 */

export type WebBuildActivityStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'skipped';
export type WebBuildActivityKind = 'build' | 'revision';
export type WebBuildActivityFinal = 'running' | 'completed' | 'failed';

export type WebBuildActivityDetailKind =
  | 'summary'
  | 'research'
  | 'plan'
  | 'background'
  | 'files'
  | 'validation'
  | 'review'
  | 'acceptance'
  | 'preview'
  | 'error';

export interface WebBuildActivityDetailRow {
  /** A stable DETAIL-label key (resolved bilingually by the timeline) or a literal label. */
  label: string;
  /** A bounded, safe value — a count, status token, ratio or duration. Never source/ids. */
  value: string;
}

export interface WebBuildActivityItem {
  /** Stable, deterministic stage id (also the title key). */
  id: string;
  titleKey: string;
  status: WebBuildActivityStatus;
  detailKind?: WebBuildActivityDetailKind;
  detailRows?: WebBuildActivityDetailRow[];
  startedAt?: number;
  completedAt?: number;
}

export interface WebBuildActivityState {
  version: 'web-build-activity-v1';
  kind: WebBuildActivityKind;
  items: WebBuildActivityItem[];
  final: WebBuildActivityFinal;
}

/** The bounded event a real pipeline boundary emits to advance the timeline. */
export interface WebBuildActivityUpdate {
  /** The stage id to advance (must match a known stage; unknown ids are ignored). */
  phase: string;
  status: WebBuildActivityStatus;
  detailKind?: WebBuildActivityDetailKind;
  detailRows?: WebBuildActivityDetailRow[];
}

/** Optional callback threaded into the real orchestration functions. UI telemetry only:
 *  it adds ZERO model calls and never changes generation/acceptance behaviour. Optional so
 *  every existing caller (WebsiteBuilder, ProjectWorkspace, saved-session restore) stays
 *  compatible without providing one. */
export type WebBuildActivityReporter = (update: WebBuildActivityUpdate) => void;

/* ── Stage definitions ─────────────────────────────────────────────────────────
 * Fresh build mirrors the real pipeline: research pre-pass → website_builder planning →
 * FrontendBuildSpecification → frontend_builder generation → validation → optional
 * structural repair → static quality review → optional quality repair → acceptance →
 * preview. Revision is intentionally NARROWER: the real revision path reruns NO research
 * or planning (exactly one model-native frontend_builder edit), so those stages are absent. */
interface StageDef { id: string; detailKind: WebBuildActivityDetailKind; }

const BUILD_STAGES: readonly StageDef[] = [
  { id: 'request-understanding', detailKind: 'summary' },
  { id: 'research', detailKind: 'research' },
  { id: 'planning', detailKind: 'plan' },
  { id: 'specification', detailKind: 'plan' },
  { id: 'frontend-generation', detailKind: 'background' },
  { id: 'frontend-validation', detailKind: 'validation' },
  { id: 'structural-repair', detailKind: 'files' },
  { id: 'quality-review', detailKind: 'review' },
  { id: 'quality-repair', detailKind: 'files' },
  { id: 'acceptance', detailKind: 'acceptance' },
  { id: 'preview', detailKind: 'preview' },
];

const REVISION_STAGES: readonly StageDef[] = [
  { id: 'revision-understanding', detailKind: 'summary' },
  { id: 'revision-generation', detailKind: 'background' },
  { id: 'revision-validation', detailKind: 'validation' },
  { id: 'revision-preservation', detailKind: 'files' },
  { id: 'revision-preview', detailKind: 'preview' },
];

/* ── Trilingual, bounded UI strings (kept LOCAL so this phase touches no i18n locale file).
 * Titles/labels are stable keys → { en, tr, de }; the timeline resolves them via the app lang
 * (en/tr/de — Phase 14C.2). German is real, never an English fallback. */
type L3 = { en: string; tr: string; de: string };

export const ACTIVITY_TITLES: Record<string, L3> = {
  'request-understanding': { en: 'Understanding your request', tr: 'İsteğin inceleniyor', de: 'Deine Anfrage wird verstanden' },
  research: { en: 'Researching the website direction', tr: 'Site yönü araştırılıyor', de: 'Website-Richtung wird recherchiert' },
  planning: { en: 'Creating the website strategy', tr: 'Site stratejisi oluşturuluyor', de: 'Website-Strategie wird erstellt' },
  specification: { en: 'Preparing the build specification', tr: 'Build planı hazırlanıyor', de: 'Build-Spezifikation wird vorbereitet' },
  'frontend-generation': { en: 'Generating the React project', tr: 'React projesi oluşturuluyor', de: 'React-Projekt wird generiert' },
  'frontend-validation': { en: 'Validating the generated files', tr: 'Oluşturulan dosyalar doğrulanıyor', de: 'Generierte Dateien werden geprüft' },
  'structural-repair': { en: 'Repairing the project structure', tr: 'Proje yapısı düzeltiliyor', de: 'Projektstruktur wird repariert' },
  'quality-review': { en: 'Reviewing design quality', tr: 'Tasarım kalitesi inceleniyor', de: 'Designqualität wird geprüft' },
  'quality-repair': { en: 'Applying quality improvements', tr: 'Kalite iyileştirmeleri uygulanıyor', de: 'Qualitätsverbesserungen werden angewendet' },
  acceptance: { en: 'Finalizing the candidate', tr: 'Candidate hazırlanıyor', de: 'Kandidat wird finalisiert' },
  preview: { en: 'Preparing the preview', tr: 'Önizleme hazırlanıyor', de: 'Vorschau wird vorbereitet' },
  'revision-understanding': { en: 'Understanding the requested change', tr: 'İstenen değişiklik inceleniyor', de: 'Gewünschte Änderung wird verstanden' },
  'revision-generation': { en: 'Updating the React project', tr: 'React projesi güncelleniyor', de: 'React-Projekt wird aktualisiert' },
  'revision-validation': { en: 'Validating the revised files', tr: 'Düzenlenen dosyalar doğrulanıyor', de: 'Überarbeitete Dateien werden geprüft' },
  'revision-preservation': { en: 'Preserving the working project', tr: 'Çalışan proje korunuyor', de: 'Funktionierendes Projekt wird bewahrt' },
  'revision-preview': { en: 'Preparing the updated preview', tr: 'Güncellenen önizleme hazırlanıyor', de: 'Aktualisierte Vorschau wird vorbereitet' },
};

export const ACTIVITY_STATUS_LABELS: Record<WebBuildActivityStatus, L3> = {
  waiting: { en: 'Waiting', tr: 'Bekliyor', de: 'Wartet' },
  active: { en: 'Working', tr: 'Çalışıyor', de: 'Arbeitet' },
  completed: { en: 'Completed', tr: 'Tamamlandı', de: 'Abgeschlossen' },
  skipped: { en: 'Skipped', tr: 'Atlandı', de: 'Übersprungen' },
  failed: { en: 'Failed', tr: 'Başarısız', de: 'Fehlgeschlagen' },
};

export const ACTIVITY_DETAIL_LABELS: Record<string, L3> = {
  sources: { en: 'Sources reviewed', tr: 'İncelenen kaynak', de: 'Geprüfte Quellen' },
  sections: { en: 'Planned sections', tr: 'Planlanan bölüm', de: 'Geplante Abschnitte' },
  language: { en: 'Website language', tr: 'Site dili', de: 'Website-Sprache' },
  requiredFiles: { en: 'Required files', tr: 'Gerekli dosya', de: 'Erforderliche Dateien' },
  specStatus: { en: 'Specification', tr: 'Spesifikasyon', de: 'Spezifikation' },
  transport: { en: 'Transport', tr: 'Aktarım', de: 'Übertragung' },
  waited: { en: 'Waited', tr: 'Bekleme süresi', de: 'Wartezeit' },
  outputBudget: { en: 'Output budget', tr: 'Çıktı bütçesi', de: 'Ausgabebudget' },
  files: { en: 'Files', tr: 'Dosyalar', de: 'Dateien' },
  chars: { en: 'Characters', tr: 'Karakter', de: 'Zeichen' },
  validation: { en: 'Validation', tr: 'Doğrulama', de: 'Validierung' },
  warnings: { en: 'Warnings', tr: 'Uyarılar', de: 'Warnungen' },
  errors: { en: 'Errors', tr: 'Hatalar', de: 'Fehler' },
  entryFiles: { en: 'Entry files', tr: 'Giriş dosyaları', de: 'Einstiegsdateien' },
  result: { en: 'Result', tr: 'Sonuç', de: 'Ergebnis' },
  score: { en: 'Score', tr: 'Puan', de: 'Bewertung' },
  issues: { en: 'Issues', tr: 'Sorunlar', de: 'Probleme' },
  candidate: { en: 'Candidate', tr: 'Candidate', de: 'Kandidat' },
  activeProject: { en: 'Active project', tr: 'Aktif proje', de: 'Aktives Projekt' },
  manualReview: { en: 'Manual review', tr: 'Manuel inceleme', de: 'Manuelle Prüfung' },
  changed: { en: 'Changed files', tr: 'Değişen dosya', de: 'Geänderte Dateien' },
  retained: { en: 'Retained files', tr: 'Korunan dosya', de: 'Beibehaltene Dateien' },
  preserved: { en: 'Source preserved', tr: 'Korunan kaynak', de: 'Quelle bewahrt' },
  scope: { en: 'Change scope', tr: 'Değişiklik kapsamı', de: 'Änderungsumfang' },
  note: { en: 'Note', tr: 'Not', de: 'Hinweis' },
};

/* ── Bounds ────────────────────────────────────────────────────────────────────── */
export const MAX_ACTIVITY_DETAIL_ROWS = 6;
const MAX_DETAIL_LABEL_CHARS = 40;
const MAX_DETAIL_VALUE_CHARS = 80;

const clamp = (s: string, n: number): string => {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Clamp + cap detail rows so untrusted/verbose values can never bloat the UI. */
export function boundDetailRows(rows?: WebBuildActivityDetailRow[]): WebBuildActivityDetailRow[] | undefined {
  if (!Array.isArray(rows) || rows.length === 0) return undefined;
  const out = rows
    .filter((r) => r && (r.label || r.value))
    .slice(0, MAX_ACTIVITY_DETAIL_ROWS)
    .map((r) => ({ label: clamp(String(r.label ?? ''), MAX_DETAIL_LABEL_CHARS), value: clamp(String(r.value ?? ''), MAX_DETAIL_VALUE_CHARS) }));
  return out.length ? out : undefined;
}

/* ── Initializers ──────────────────────────────────────────────────────────────── */
function initState(kind: WebBuildActivityKind, stages: readonly StageDef[]): WebBuildActivityState {
  const now = Date.now();
  const items: WebBuildActivityItem[] = stages.map((s, i) => ({
    id: s.id,
    titleKey: s.id,
    detailKind: s.detailKind,
    status: i === 0 ? 'active' : 'waiting',
    startedAt: i === 0 ? now : undefined,
  }));
  return { version: 'web-build-activity-v1', kind, items, final: 'running' };
}

/** The truthful FRESH-build timeline (first stage already active on creation). */
export function initBuildActivity(): WebBuildActivityState {
  return initState('build', BUILD_STAGES);
}

/** The truthful REVISION timeline — no research/planning stages by design. */
export function initRevisionActivity(): WebBuildActivityState {
  return initState('revision', REVISION_STAGES);
}

/* ── Reducer ───────────────────────────────────────────────────────────────────── */
/**
 * Apply ONE real-boundary event. Pure: returns a new state (or the same reference when the
 * event is a no-op). Rules:
 *   • terminal statuses (completed / failed / skipped) never revert — a duplicate/late event
 *     only merges fresh detail rows;
 *   • activating a stage enforces the at-most-one-active invariant (any other active stage is
 *     demoted to completed — forward progress means its real boundary already returned);
 *   • timestamps are set once (startedAt/completedAt), so repeated events stay idempotent.
 */
export function applyActivityUpdate(state: WebBuildActivityState, update: WebBuildActivityUpdate): WebBuildActivityState {
  const idx = state.items.findIndex((it) => it.id === update.phase);
  if (idx < 0) return state;
  const cur = state.items[idx];
  const now = Date.now();
  const isTerminal = (s: WebBuildActivityStatus) => s === 'completed' || s === 'failed' || s === 'skipped';
  const rows = boundDetailRows(update.detailRows) ?? cur.detailRows;
  const detailKind = update.detailKind ?? cur.detailKind;
  const detailChanged = rows !== cur.detailRows || detailKind !== cur.detailKind;

  let next: WebBuildActivityItem | null = null;
  switch (update.status) {
    case 'active':
      if (isTerminal(cur.status)) { next = detailChanged ? { ...cur, detailRows: rows, detailKind } : null; break; }
      next = { ...cur, status: 'active', startedAt: cur.startedAt ?? now, detailRows: rows, detailKind };
      break;
    case 'completed':
      if (cur.status === 'failed' || cur.status === 'skipped') { next = detailChanged ? { ...cur, detailRows: rows, detailKind } : null; break; }
      next = { ...cur, status: 'completed', startedAt: cur.startedAt ?? now, completedAt: cur.completedAt ?? now, detailRows: rows, detailKind };
      break;
    case 'failed':
      if (cur.status === 'completed' || cur.status === 'skipped') { next = detailChanged ? { ...cur, detailRows: rows, detailKind } : null; break; }
      next = { ...cur, status: 'failed', startedAt: cur.startedAt ?? now, completedAt: cur.completedAt ?? now, detailRows: rows, detailKind };
      break;
    case 'skipped':
      if (cur.status === 'waiting' || cur.status === 'active') next = { ...cur, status: 'skipped', completedAt: now, detailRows: rows, detailKind };
      else next = detailChanged ? { ...cur, detailRows: rows, detailKind } : null;
      break;
    case 'waiting':
    default:
      next = null;
      break;
  }
  if (!next) return state;

  const items = state.items.slice();
  items[idx] = next;
  if (next.status === 'active') {
    for (let i = 0; i < items.length; i += 1) {
      if (i !== idx && items[i].status === 'active') {
        items[i] = { ...items[i], status: 'completed', completedAt: items[i].completedAt ?? now };
      }
    }
  }
  return { ...state, items };
}

/** Mark the single active stage failed (used by the caller's catch). Sets final = failed. */
export function failActiveActivity(state: WebBuildActivityState): WebBuildActivityState {
  const now = Date.now();
  const items = state.items.map((it) =>
    it.status === 'active' ? { ...it, status: 'failed' as const, completedAt: it.completedAt ?? now } : it);
  return { ...state, items, final: 'failed' };
}

/** Finalize a successful run. Defensive: any lingering active stage becomes completed (the
 *  real terminal event normally already fired); waiting stages are left untouched. */
export function completeActivity(state: WebBuildActivityState): WebBuildActivityState {
  const now = Date.now();
  const items = state.items.map((it) =>
    it.status === 'active' ? { ...it, status: 'completed' as const, completedAt: it.completedAt ?? now } : it);
  return { ...state, items, final: 'completed' };
}

/** Count stages by status (for the compact completed summary header). */
export function countActivity(state: WebBuildActivityState): Record<WebBuildActivityStatus, number> {
  const out: Record<WebBuildActivityStatus, number> = { waiting: 0, active: 0, completed: 0, failed: 0, skipped: 0 };
  for (const it of state.items) out[it.status] += 1;
  return out;
}
