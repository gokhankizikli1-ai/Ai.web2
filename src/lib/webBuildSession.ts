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
import { scopedKey } from '@/lib/userScope';

// Per-user scoped keys (never global) — isolate Web Build data per account.
const sessionsKey = () => scopedKey('webbuild', 'sessions');
const activeKey = () => scopedKey('webbuild', 'active');

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

/** A short, language-matched title for a Web Build (Part 7). */
const TITLE: Record<IndustryKey, [string, string]> = {
  landscaping: ['Landscaping Site', 'Peyzaj Mimarı Sitesi'],
  ai_saas: ['AI Chatbot Landing', 'AI Chatbot Landing'],
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

function writeMap(map: SessionMap): void {
  try { localStorage.setItem(sessionsKey(), JSON.stringify(map)); } catch { /* quota */ }
}

/** Persist (create or update) a session from a payload; marks it active. */
export function saveWebBuildSession(payload: WebBuildPayload, lang = 'en'): string {
  const id = sessionIdOf(payload);
  if (!id) return '';
  const map = readMap();
  const title = map[id]?.title || deriveWebBuildTitle(payload.prompt, lang);
  map[id] = { id, title, updatedAt: new Date().toISOString(), payload };
  writeMap(map);
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
