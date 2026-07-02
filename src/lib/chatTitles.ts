/**
 * Deterministic chat session titles — no session should sit as
 * "New Chat" after a real flow started it. Titles are local-only and
 * never include API/provider names.
 */
import type { WorkspaceTab } from '@/types';

const MAX_TITLE_CHARS = 36;

/** Trim, collapse whitespace, strip wrapping/long punctuation, clamp. */
export function cleanTitle(raw: string, prefix = ''): string {
  let topic = (raw || '')
    .replace(/["'`""'']/g, '')
    .replace(/[|•·→\-–—]{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // trailing punctuation reads badly in a sidebar
    .replace(/[.,;:!?\-–—]+$/, '');
  const budget = MAX_TITLE_CHARS - prefix.length;
  if (topic.length > budget) {
    topic = topic.slice(0, budget - 1).trimEnd() + '…';
  }
  return topic ? `${prefix}${topic}` : '';
}

// Lightweight research-ask detection for titling ONLY (the backend has
// its own authoritative intent detector for actually running research).
const RESEARCH_TRIGGERS = [
  'research', 'look up', 'look this up', 'search the web', 'find current',
  'latest', 'news about', 'with sources',
  'araştır', 'arastir', 'internetten bak', 'webden bak', 'güncel', 'guncel',
  'son gelişmeler', 'son gelismeler', 'kaynak göster', 'kaynak goster',
];

/** Lightweight check used for UI hints (typing-indicator labels, titles).
 * The backend has its own authoritative detector for running research. */
export function looksLikeResearchAsk(text: string): boolean {
  const lower = (text || '').toLowerCase();
  return RESEARCH_TRIGGERS.some((t) => lower.includes(t));
}

/** Strip the trigger phrase so "research Tesla latest" → "Tesla latest". */
function stripTriggers(text: string): string {
  let out = text;
  for (const t of RESEARCH_TRIGGERS) {
    out = out.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Derive a session title from the first message of a conversation.
 * Returns null when no specialized pattern applies — callers keep the
 * existing default behavior in that case.
 */
export function deriveSessionTitle(message: string, tab: WorkspaceTab): string | null {
  const trimmed = (message || '').trim();
  if (!trimmed) return null;
  const firstLine = trimmed.split('\n', 1)[0];

  // Startup Radar → Advisor handoff opens with "Market: <niche>".
  const market = /^market\s*:\s*(.+)$/i.exec(firstLine)?.[1];
  if (market) return cleanTitle(market, 'Startup: ') || 'Startup research';

  // Radar → Builder handoff opens with the build instruction and carries
  // a "Market: <niche>" line further down.
  if (/^build a landing page and mvp concept/i.test(firstLine)) {
    const m = /(?:^|\n)market\s*:\s*(.+)/i.exec(trimmed)?.[1];
    return (m && cleanTitle(m, 'Builder: ')) || 'Builder: MVP concept';
  }

  // Startup workspace conversations.
  if (tab === 'startup') {
    return cleanTitle(firstLine, 'Startup: ') || 'Startup research';
  }

  // Plain-chat research asks → "Research: <topic>".
  const lower = firstLine.toLowerCase();
  if (RESEARCH_TRIGGERS.some((t) => lower.includes(t))) {
    const topic = stripTriggers(firstLine);
    return cleanTitle(topic, 'Research: ') || 'Market research';
  }

  return null;
}
