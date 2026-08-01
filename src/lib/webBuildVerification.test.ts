import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { guardVerificationRequired, VerificationRequiredError } from '@/lib/webBuildApi';

/**
 * Web Build must cancel the run and redirect to /verify-email when the backend
 * rejects an unverified account with 403 EMAIL_VERIFICATION_REQUIRED — and must
 * NOT interfere with any other response.
 */

function res(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    clone() { return this as unknown as Response; },
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.stubGlobal('window', {
    location: { hash: '#/chat' },
    dispatchEvent: vi.fn(),
  } as unknown as Window & typeof globalThis);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('guardVerificationRequired', () => {
  it('throws + redirects on 403 EMAIL_VERIFICATION_REQUIRED (top-level code)', async () => {
    await expect(
      guardVerificationRequired(res(403, { code: 'EMAIL_VERIFICATION_REQUIRED', reply: '' })),
    ).rejects.toBeInstanceOf(VerificationRequiredError);
    expect(window.location.hash).toContain('/verify-email');
  });

  it('throws + redirects on 403 with code in metadata (envelope shape)', async () => {
    await expect(
      guardVerificationRequired(res(403, { metadata: { code: 'EMAIL_VERIFICATION_REQUIRED' } })),
    ).rejects.toBeInstanceOf(VerificationRequiredError);
    expect(window.location.hash).toContain('/verify-email');
  });

  it('does nothing on a 200 response', async () => {
    await expect(guardVerificationRequired(res(200, { reply: 'ok' }))).resolves.toBeUndefined();
    expect(window.location.hash).toBe('#/chat');
  });

  it('does not treat a generic 403 (different code) as verification-required', async () => {
    await expect(
      guardVerificationRequired(res(403, { code: 'SOMETHING_ELSE' })),
    ).resolves.toBeUndefined();
    expect(window.location.hash).toBe('#/chat');
  });
});
