/**
 * chatStream — the ONE client for Korvix's streaming chat endpoint.
 *
 * `POST /v2/chat/stream` is the authoritative AI path: it is where the backend
 * resolves the caller's identity, injects Memory Plane context AND the Project
 * Brain / Project Context block for a `project_id`, applies the answer-language
 * policy, and streams the reply as Server-Sent Events.
 *
 * This module owns the two things every caller of that endpoint needs and
 * nobody should own twice:
 *
 *   • the SSE frame reader (`readSSEFrames`) — buffering, CRLF/LF, multi-line
 *     `data:`, UTF-8 split across chunk boundaries;
 *   • the internal-marker scrub (`stripInternalMarkers`) — the last line of
 *     defence so an orchestration label can never render as answer prose.
 *
 * It exists because there is now a SECOND legitimate caller. `useChat` (the
 * Chat surface) had both of these inline; the Project Workspace's inline
 * "Ask Korvix" needs exactly the same wire handling for exactly the same
 * endpoint. Copying them would have created two parsers that drift — and a
 * scrub that is fixed in one place and not the other is a scrub that leaks.
 *
 * WHAT THIS IS NOT
 * ----------------
 *   • NOT a second AI endpoint. It is a reader for the existing one.
 *   • NOT a second prompt/context builder. Every caller sends `project_id` and
 *     the BACKEND assembles the context, owner-gated. Nothing here composes a
 *     system prompt, and nothing here decides what the model is told.
 *   • NOT conversation state. Whose turn it is, where it is stored and which
 *     thread it belongs to are the chat/sessions authorities' business.
 */
import { apiBase, authHeaders } from '@/lib/serverApi';

/** The streaming chat endpoint — resolved through the single API-base rule. */
export function chatStreamUrl(): string {
  return `${apiBase()}/v2/chat/stream`;
}

/**
 * Defence-in-depth scrub of internal orchestration markers from assistant text.
 *
 * The real fix is server-side (the injected tool-context blocks no longer carry
 * these markers, and the stream boundary strips them); this is the last line so
 * an internal label can never render in an answer even if a marker were split
 * across SSE deltas. Operates on the ACCUMULATED text so cross-delta splits are
 * caught. Never alters ordinary answer prose.
 */
const INTERNAL_MARKER_RE =
  /(?:═+|\[?INTERNAL (?:LIVE-SEARCH RESULTS|CAPABILITIES NOTE|NOTE —)[^\n]*|KORVIX (?:WEB SEARCH|TOOLS|BROWSER|GITHUB)[^\n]*|TOOL OUTPUT|TOOL_RESULT|FUNCTION RESULT|SEARCH CONTEXT|DO NOT REFUSE|TOOL ATTEMPTED, NO RESULTS|\[TOOL:[^\]]*\]?)/g;

export function stripInternalMarkers(text: string): string {
  if (!text || (!text.includes('═') && !/KORVIX|TOOL OUTPUT|TOOL_RESULT|INTERNAL (?:LIVE-SEARCH|CAPABILITIES|NOTE —)|SEARCH CONTEXT|FUNCTION RESULT/.test(text))) {
    return text;
  }
  return text.replace(INTERNAL_MARKER_RE, '');
}

export interface StreamFrame {
  event: string;
  data: string;
}

/**
 * Parse a fetch() response body as a stream of SSE frames.
 *
 * Robust to:
 *   - UTF-8 characters split across chunk boundaries (TextDecoder streaming)
 *   - Partial frames arriving in pieces (buffer until \n\n or \r\n\r\n)
 *   - CRLF or LF line endings
 *   - Multi-line `data:` (joined with \n per the SSE spec)
 *   - Comment lines starting with `:`
 *
 * Yields one {event, data} object per terminated SSE frame. The generator
 * completes when the upstream stream closes; the caller decides what to do if a
 * terminal `done` or `error` frame was never observed.
 */
export async function* readSSEFrames(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const parseFrame = (raw: string): StreamFrame | null => {
    let event = 'message';
    let data = '';
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        const part = line.slice(5).replace(/^ /, '');
        data = data ? `${data}\n${part}` : part;
      }
    }
    if (!data && event === 'message') return null;
    return { event, data };
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: RegExpMatchArray | null;
      while ((sep = buffer.match(/\r?\n\r?\n/))) {
        const idx = sep.index!;
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + sep[0].length);
        const parsed = parseFrame(frame);
        if (parsed) yield parsed;
      }
    }
    buffer += decoder.decode();
    const tail = parseFrame(buffer);
    if (tail) yield tail;
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

/** The auth + content-type headers every streaming request carries. Re-exported
 *  from the shared client so there is one rule about how we identify ourselves
 *  to the backend, and so a caller can never accidentally send an unauthenticated
 *  request that would silently degrade to a guest namespace. */
export { authHeaders };
