/**
 * Tests — SCREENSHOT capture protocol (PR #521).
 *
 * The untrusted SCREENSHOT_RESULT sanitizer is the parent-side trust boundary for captured pixels:
 * it must accept only a well-formed, in-budget image data URL and normalize every blank / oversized
 * / malformed / mismatched capture to an honest `ok:false`. Pure + deterministic.
 */
import { describe, it, expect } from 'vitest';
import {
  sanitizeScreenshotResult, base64DataUrlByteLength, VE_SCREENSHOT_MAX_BYTES,
} from '@/lib/visualEditProtocol';

const webpUrl = (chars = 400) => `data:image/webp;base64,${'A'.repeat(chars)}`;

describe('base64DataUrlByteLength', () => {
  it('approximates decoded byte length', () => {
    expect(base64DataUrlByteLength(webpUrl(400))).toBe(300);          // 400*3/4
    expect(base64DataUrlByteLength('data:image/webp;base64,AAA=')).toBe(2);
    expect(base64DataUrlByteLength('nonsense')).toBe(0);
  });
});

describe('sanitizeScreenshotResult', () => {
  it('accepts a well-formed in-budget webp capture', () => {
    const r = sanitizeScreenshotResult({ runId: 'r1', ok: true, mimeType: 'image/webp', dataUrl: webpUrl(400) })!;
    expect(r.ok).toBe(true);
    expect(r.mimeType).toBe('image/webp');
    expect(r.byteLength).toBe(300);
    expect(r.dataUrl).toBe(webpUrl(400));
  });
  it('no runId → null (no usable identity)', () => {
    expect(sanitizeScreenshotResult({ ok: true, dataUrl: webpUrl() })).toBeNull();
  });
  it('ok:false passthrough stays ok:false (never fabricates an image)', () => {
    const r = sanitizeScreenshotResult({ runId: 'r1', ok: false, errorCode: 'rasterizer-unavailable' })!;
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('rasterizer-unavailable');
    expect(r.dataUrl).toBeUndefined();
  });
  it('blank capture → ok:false', () => {
    const r = sanitizeScreenshotResult({ runId: 'r1', ok: true, blank: true, dataUrl: webpUrl() })!;
    expect(r.ok).toBe(false);
    expect(r.blank).toBe(true);
  });
  it('malformed data URL → ok:false invalid-data-url', () => {
    const r = sanitizeScreenshotResult({ runId: 'r1', ok: true, dataUrl: 'not-a-data-url' })!;
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('invalid-data-url');
  });
  it('unsupported image type in the data URL → ok:false', () => {
    const r = sanitizeScreenshotResult({ runId: 'r1', ok: true, dataUrl: 'data:image/gif;base64,AAAA' })!;
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('invalid-data-url');
  });
  it('valid data URL but a mismatched mimeType field → ok:false unsupported-mime', () => {
    const r = sanitizeScreenshotResult({ runId: 'r1', ok: true, mimeType: 'image/gif', dataUrl: webpUrl() })!;
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('unsupported-mime');
  });
  it('oversized capture → ok:false too-large', () => {
    // 400 base64 chars → ~300 bytes; a 250-byte ceiling rejects it (length guard stays generous).
    const r = sanitizeScreenshotResult({ runId: 'r1', ok: true, dataUrl: webpUrl(400) }, 250)!;
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('too-large');
  });
  it('accepts a jpeg data URL and derives the mime', () => {
    const r = sanitizeScreenshotResult({ runId: 'r1', ok: true, dataUrl: `data:image/jpeg;base64,${'B'.repeat(200)}` })!;
    expect(r.ok).toBe(true);
    expect(r.mimeType).toBe('image/jpeg');
  });
  it('default ceiling is the shared VE_SCREENSHOT_MAX_BYTES', () => {
    expect(VE_SCREENSHOT_MAX_BYTES).toBeGreaterThan(0);
  });
});
