import { describe, it, expect } from 'vitest';
import {
  pendingDecision, confirmView, shouldRedirectAfterConfirm,
} from '@/pages/verifyEmailFlow';

/**
 * VerifyEmail routing decisions — proves the redirect-loop fix, no pending flash,
 * fail-closed-on-error, verified auto-redirect, and unauthenticated → login.
 */

const base = { isHydrating: false, isAuthenticated: true, loading: false, status: null as any, redirected: false };

describe('pendingDecision', () => {
  it('unverified authenticated user stays on the pending screen (no /chat bounce)', () => {
    // Reopening the app: authenticated, resolved, verified=false → pending, NOT redirect.
    expect(pendingDecision({ ...base, status: { verified: false } })).toBe('pending');
  });

  it('never flashes the pending panel while auth is hydrating', () => {
    expect(pendingDecision({ ...base, isHydrating: true, status: { verified: false } })).toBe('loading');
  });

  it('never flashes the pending panel while the status fetch is in flight', () => {
    expect(pendingDecision({ ...base, loading: true })).toBe('loading');
  });

  it('unauthenticated with no token → redirect to login', () => {
    expect(pendingDecision({ ...base, isAuthenticated: false })).toBe('redirect-login');
  });

  it('verified status → redirect to chat', () => {
    expect(pendingDecision({ ...base, status: { verified: true } })).toBe('redirect-chat');
  });

  it('status error (resolved but null) does NOT grant access — shows error, never verified', () => {
    const d = pendingDecision({ ...base, loading: false, status: null });
    expect(d).toBe('error');
    expect(d).not.toBe('redirect-chat');
  });

  it('while a redirect is in flight, stays on loading (no panel flash / double-nav)', () => {
    expect(pendingDecision({ ...base, redirected: true, status: { verified: false } })).toBe('loading');
  });
});

describe('confirmView / shouldRedirectAfterConfirm', () => {
  it('confirming shows the spinner', () => {
    expect(confirmView('confirming', true)).toBe('confirming');
  });

  it('verified + authenticated → auto-redirect into the app', () => {
    expect(confirmView('verified', true)).toBe('verified-redirect');
    expect(shouldRedirectAfterConfirm('verified', true)).toBe(true);
    expect(shouldRedirectAfterConfirm('already_verified', true)).toBe(true);
  });

  it('verified but NOT authenticated (link opened in a fresh browser) → sign-in, no redirect', () => {
    expect(confirmView('verified', false)).toBe('verified-signin');
    expect(shouldRedirectAfterConfirm('verified', false)).toBe(false);
  });

  it('expired / failed outcomes never auto-redirect into the app', () => {
    for (const p of ['expired', 'already_used', 'superseded', 'invalid', 'error'] as const) {
      expect(shouldRedirectAfterConfirm(p, true)).toBe(false);
    }
    expect(confirmView('expired', true)).toBe('expired');
    expect(confirmView('invalid', true)).toBe('failed');
  });
});
