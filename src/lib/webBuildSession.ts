/**
 * Web Build SESSION persistence.
 *
 * A Web Build run must survive leaving the page and a browser refresh, so the
 * source of truth is not transient component state — every build/revision is
 * written to localStorage here (keyed by a stable session id = the first step
 * id). The builder restores the active session on mount, can reopen any past
 * session by id (e.g. from the sidebar), and exposes a titled list for history.
 *
 * We also mirror each session into the shared chat-session store (see
 * webBuildChatSession) so it shows up in the left sidebar like a normal chat.
 */
import type { WebBuildPayload } from '@/lib/webBuildPayload';
import { inferWebsiteBrief, type IndustryKey } from '@/lib/webBuildBrief';
import { hasExplicitChatIntent } from '@/lib/webBuildProductIntent';
import { scopedKey } from '@/lib/userScope';

// Per-user scoped keys (never global) — isolate Web Build data per account.
const sessionsKey = () => scopedKey('webbuild', 'sessions');
const activeKey = () => scopedKey('webbuild', 'active');
// A SEPARATE, small, serializable pointer describing an in-flight run. It exists
// only so a browser refresh (which kills the in-memory fetch) can honestly report
// an interrupted run instead of a blank page. It NEVER holds an AbortController or
// any live handle — just enough metadata to restore the prompt + base and retry.
const pendingKey = () => scopedKey('webbuild', 'pending');

// One-time cleanup: the previous release used GLOBAL keys shared across all
// accounts. Discard that leaked cache so it can never surface for any user.
(function purgeLegacyGlobalKeys() {
  try {
    localStorage.removeItem('korvix_webbuild_sessions');
    localStorage.removeItem('korvix_webbuild_active');
  } catch { /* ignore */ }
})();

export interface WebBuildSessionMeta {
  id: string;
  title: string;
  updatedAt: string;
}

interface StoredSession {
  id: string;
  title: string;
  updatedAt: string;
  payload: WebBuildPayload;
}

type SessionMap = Record<string, StoredSession>;

const L = (lang: string, en: string, tr: string) => (lang === 'tr' ? tr : en);

/** A short, language-matched title for a Web Build (Part 7). NOTE: the ai_saas entry is
 *  the truthful GENERIC AI/SaaS title — a chatbot title is used ONLY when the prompt shows
 *  explicit conversational-chat intent (see deriveWebBuildTitle). A generic non-chat AI/SaaS
 *  product must never be titled "chatbot". */
const TITLE: Record<IndustryKey, [string, string]> = {
  landscaping: ['Landscaping Site', 'Peyzaj Mimarı Sitesi'],
  ai_saas: ['AI SaaS Site', 'AI SaaS Sitesi'],
  furniture: ['Furniture Store Site', 'Mobilya Mağazası Sitesi'],
  automotive: ['Car Dealer Site', 'Araba Galerisi Sitesi'],
  fitness: ['Fitness Coaching Landing', 'Fitness Koçluğu Landing'],
  restaurant: ['Restaurant Site', 'Restoran Sitesi'],
  portfolio: ['Portfolio Site', 'Portfolyo Sitesi'],
  agency: ['Agency Site', 'Ajans Sitesi'],
  ecommerce: ['Online Store', 'Online Mağaza'],
  local_service: ['Service Site', 'Hizmet Sitesi'],
  generic: ['Web Build', 'Web Build'],
};

export function deriveWebBuildTitle(prompt: string, lang = 'en'): string {
  try {
    const industry = inferWebsiteBrief(prompt || '', lang).industry;
    // Phase 12F.3 — a chatbot title is truthful ONLY for an explicit conversational-chat
    // request. A generic AI/SaaS product (compliance workflow, dashboard, calculator,
    // platform, automation, …) must never be titled "chatbot". The product-intent authority
    // requires STRONG conversational evidence, so bare "AI"/"SaaS"/"assistant" stays generic.
    if (industry === 'ai_saas' && hasExplicitChatIntent(prompt || '')) {
      return L(lang, 'AI Chatbot Landing', 'AI Chatbot Sitesi') || 'Web Build';
    }
    const [en, tr] = TITLE[industry] || TITLE.generic;
    return L(lang, en, tr) || 'Web Build';
  } catch {
    return 'Web Build';
  }
}

/** Stable session id for a payload (first step id, else the createdAt stamp). */
export function sessionIdOf(payload: WebBuildPayload): string {
  return payload.steps?.[0]?.id || `wb-${payload.createdAt || ''}`;
}

function readMap(): SessionMap {
  try {
    const raw = localStorage.getItem(sessionsKey());
    const map = raw ? (JSON.parse(raw) as SessionMap) : {};
    return map && typeof map === 'object' ? map : {};
  } catch {
    return {};
  }
}

/**
 * How many full session payloads we retain in localStorage. Each payload is LARGE (all generated
 * files + every quality/contract artifact), and they all share ONE key; without a bound the blob
 * grows until it exceeds the browser's ~5MB quota, at which point `localStorage.setItem` throws
 * QuotaExceededError. Historically that error was swallowed silently, so the (large) payload write
 * failed while the (tiny) sidebar title row still persisted — the "title survives, content gone"
 * bug on reopen. We keep the newest N and evict older builds first. Older builds' sidebar rows may
 * remain (their reopen shows the existing bounded "no saved data" notice), but the CURRENT and
 * recent builds ALWAYS persist across reload.
 */
const MAX_STORED_SESSIONS = 8;

/** Session ids oldest → newest (by updatedAt; stable for equal stamps). */
function idsOldestFirst(map: SessionMap): string[] {
  return Object.values(map)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0))
    .map((s) => s.id);
}

/**
 * Persist the session map within the localStorage quota. `keepId` is the session that MUST
 * survive (the one just written) — it is never evicted. Strategy: cap to the newest
 * MAX_STORED_SESSIONS, then on any write failure (quota / serialization) evict the OLDEST other
 * session and retry until it fits or only `keepId` remains. Returns true iff the map (including
 * `keepId`) was actually stored. A failed `setItem` is atomic — the previously stored value is
 * left intact — so a false return never corrupts the existing store.
 */
function persistMap(map: SessionMap, keepId: string): boolean {
  let working: SessionMap = { ...map };
  // Bound the retained set to the newest N up front (never dropping keepId).
  {
    const ordered = idsOldestFirst(working);
    for (const victim of ordered) {
      if (Object.keys(working).length <= MAX_STORED_SESSIONS) break;
      if (victim === keepId) continue;
      const { [victim]: _drop, ...rest } = working;
      working = rest;
    }
  }
  for (;;) {
    try {
      localStorage.setItem(sessionsKey(), JSON.stringify(working));
      return true;
    } catch {
      // Quota (or serialization) — evict the oldest non-keep session and retry.
      const victim = idsOldestFirst(working).find((id) => id !== keepId);
      if (!victim) return false; // only keepId remains and it still does not fit
      const { [victim]: _drop, ...rest } = working;
      working = rest;
    }
  }
}

/**
 * Persist (create or update) a session from a payload; marks it active on success.
 * Returns the session id, or '' when the payload could NOT be stored (invalid id, or it still did
 * not fit after evicting every other session). A '' return means "not persisted" — callers must
 * not then create a sidebar companion that would dangle with no restorable content.
 */
export function saveWebBuildSession(payload: WebBuildPayload, lang = 'en'): string {
  const id = sessionIdOf(payload);
  if (!id) return '';
  const map = readMap();
  const title = map[id]?.title || deriveWebBuildTitle(payload.prompt, lang);
  map[id] = { id, title, updatedAt: new Date().toISOString(), payload };
  if (!persistMap(map, id)) return ''; // could not store the payload — do not claim a saved session
  setActiveWebBuildSession(id);
  return id;
}

export function getWebBuildSession(id: string): WebBuildPayload | null {
  return readMap()[id]?.payload || null;
}

export function setActiveWebBuildSession(id: string): void {
  try { localStorage.setItem(activeKey(), id); } catch { /* ignore */ }
}

export function getActiveWebBuildSessionId(): string | null {
  try { return localStorage.getItem(activeKey()); } catch { return null; }
}

/** Clear the active pointer (used when starting a brand-new build). */
export function clearActiveWebBuildSession(): void {
  try { localStorage.removeItem(activeKey()); } catch { /* ignore */ }
}

export function getActiveWebBuildSession(): WebBuildPayload | null {
  const id = getActiveWebBuildSessionId();
  return id ? getWebBuildSession(id) : null;
}

/** Titled list of sessions, newest first (for a history list). */
export function listWebBuildSessions(): WebBuildSessionMeta[] {
  return Object.values(readMap())
    .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/* ── Pending (in-flight) run metadata ─────────────────────────────────────────
 * Serializable, optional and version-tolerant. Written when a build/revision
 * starts and cleared the moment it settles. Its ONLY consumer is the refresh
 * recovery path: a full reload wipes the in-memory operation, so this lets the
 * builder restore the prompt (and the revision's base payload) and offer Retry —
 * without ever pretending the interrupted run finished. Scoped per identity, so
 * one account can never observe another's pending run. */
export interface PendingWebBuildRunMeta {
  /** Schema version — future readers tolerate/skip unknown shapes. */
  v: 1;
  prompt: string;
  kind: 'build' | 'revision';
  /** For a revision, the base session id to restore so the project isn't lost. */
  basePayloadId: string | null;
  startedAt: string;
}

export function savePendingWebBuildRun(meta: Omit<PendingWebBuildRunMeta, 'v'>): void {
  try {
    const record: PendingWebBuildRunMeta = { v: 1, ...meta };
    localStorage.setItem(pendingKey(), JSON.stringify(record));
  } catch { /* quota — a missing pending pointer only costs the retry affordance */ }
}

export function getPendingWebBuildRun(): PendingWebBuildRunMeta | null {
  try {
    const raw = localStorage.getItem(pendingKey());
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingWebBuildRunMeta>;
    // Version-tolerant: only accept the shape we understand; ignore anything else.
    if (!parsed || parsed.v !== 1 || typeof parsed.prompt !== 'string' || !parsed.prompt) return null;
    const kind = parsed.kind === 'revision' ? 'revision' : 'build';
    return {
      v: 1,
      prompt: parsed.prompt,
      kind,
      basePayloadId: typeof parsed.basePayloadId === 'string' ? parsed.basePayloadId : null,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
    };
  } catch {
    return null;
  }
}

export function clearPendingWebBuildRun(): void {
  try { localStorage.removeItem(pendingKey()); } catch { /* ignore */ }
}
