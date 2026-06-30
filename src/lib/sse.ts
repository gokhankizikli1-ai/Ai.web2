// sse — Sprint 1.8 — a tiny, PURE Server-Sent-Events frame parser.
//
// The orchestrator run stream (GET /v2/orchestrator/runs/{id}/stream) is
// consumed via fetch() + ReadableStream (NOT EventSource — that can't attach
// the Authorization header the route requires). This module turns the raw
// streamed text into typed {event, data} frames. It is framework-free and
// fully unit-testable: feed it chunks, get callbacks.
//
// SSE wire format (per frame, blank line terminated):
//   event: snapshot
//   data: {"...": ...}
//   <blank line>

export interface SSEFrame {
  event: string;            // the `event:` field, or 'message' if absent
  data:  string;            // the concatenated `data:` lines
}

/**
 * Create a stateful chunk parser. Call `push(chunk)` with each decoded text
 * chunk as it arrives; complete frames are delivered to `onFrame`. Partial
 * frames are buffered until their terminating blank line arrives.
 */
export function createSSEParser(onFrame: (frame: SSEFrame) => void): {
  push: (chunk: string) => void;
  reset: () => void;
} {
  let buffer = '';

  function flushBlock(block: string) {
    if (!block.trim()) return;
    let event = 'message';
    const dataLines: string[] = [];
    for (const rawLine of block.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (!line || line.startsWith(':')) continue;   // comment / keepalive
      const idx = line.indexOf(':');
      const field = idx === -1 ? line : line.slice(0, idx);
      // Per spec a single leading space after the colon is stripped.
      let value = idx === -1 ? '' : line.slice(idx + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') event = value;
      else if (field === 'data') dataLines.push(value);
      // id / retry fields are ignored (the stream doesn't use them).
    }
    if (dataLines.length === 0) return;
    onFrame({ event, data: dataLines.join('\n') });
  }

  return {
    push(chunk: string) {
      buffer += chunk;
      // Frames are separated by a blank line (\n\n). Process every complete
      // frame, keep the trailing partial in the buffer.
      let sep: number;
      // Normalise CRLF blank-line separators to LF for splitting.
      while ((sep = indexOfFrameBoundary(buffer)) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^(\r?\n){2}/, '');
        flushBlock(block);
      }
    },
    reset() { buffer = ''; },
  };
}

// Index of the first frame boundary (a blank line) in the buffer, or -1.
function indexOfFrameBoundary(buf: string): number {
  const lf = buf.indexOf('\n\n');
  const crlf = buf.indexOf('\r\n\r\n');
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

/** Safely JSON-parse a frame's data; returns null on empty/invalid. */
export function parseFrameData<T = unknown>(frame: SSEFrame): T | null {
  if (!frame.data) return null;
  try { return JSON.parse(frame.data) as T; } catch { return null; }
}
