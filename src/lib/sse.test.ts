import { describe, it, expect } from 'vitest';
import { createSSEParser, parseFrameData, type SSEFrame } from '@/lib/sse';

function collect(): { frames: SSEFrame[]; push: (s: string) => void } {
  const frames: SSEFrame[] = [];
  const parser = createSSEParser((f) => frames.push(f));
  return { frames, push: parser.push };
}

describe('createSSEParser', () => {
  it('parses a single named frame', () => {
    const { frames, push } = collect();
    push('event: snapshot\ndata: {"a":1}\n\n');
    expect(frames).toEqual([{ event: 'snapshot', data: '{"a":1}' }]);
  });

  it('parses multiple frames in one chunk', () => {
    const { frames, push } = collect();
    push('event: snapshot\ndata: {"n":1}\n\nevent: done\ndata: {"status":"finished"}\n\n');
    expect(frames.map(f => f.event)).toEqual(['snapshot', 'done']);
    expect(parseFrameData<{ status: string }>(frames[1])!.status).toBe('finished');
  });

  it('buffers a partial frame across chunks', () => {
    const { frames, push } = collect();
    push('event: snap');
    push('shot\ndata: {"x":');
    expect(frames).toHaveLength(0);          // nothing complete yet
    push('42}\n\n');
    expect(frames).toEqual([{ event: 'snapshot', data: '{"x":42}' }]);
  });

  it('handles CRLF line endings', () => {
    const { frames, push } = collect();
    push('event: done\r\ndata: {"status":"completed"}\r\n\r\n');
    expect(frames[0].event).toBe('done');
    expect(parseFrameData<{ status: string }>(frames[0])!.status).toBe('completed');
  });

  it('defaults to "message" when no event field', () => {
    const { frames, push } = collect();
    push('data: hello\n\n');
    expect(frames[0]).toEqual({ event: 'message', data: 'hello' });
  });

  it('ignores comment / keepalive lines', () => {
    const { frames, push } = collect();
    push(': keepalive\n\n');
    push('event: snapshot\ndata: {}\n\n');
    expect(frames.map(f => f.event)).toEqual(['snapshot']);
  });

  it('concatenates multiple data lines', () => {
    const { frames, push } = collect();
    push('data: line1\ndata: line2\n\n');
    expect(frames[0].data).toBe('line1\nline2');
  });
});

describe('parseFrameData', () => {
  it('returns null for empty data', () => {
    expect(parseFrameData({ event: 'x', data: '' })).toBeNull();
  });
  it('returns null for invalid JSON (never throws)', () => {
    expect(parseFrameData({ event: 'x', data: 'not json' })).toBeNull();
  });
  it('parses valid JSON', () => {
    expect(parseFrameData<{ a: number }>({ event: 'x', data: '{"a":5}' })).toEqual({ a: 5 });
  });
});
