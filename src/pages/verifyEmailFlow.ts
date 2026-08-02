/**
 * Pure routing/decision logic for the VerifyEmail page. Extracted so the exact
 * branching (which prevents the redirect loop, the pending-panel flash, and the
 * fail-open-on-error bug) is unit-testable in the repo's node test environment
 * and is the SINGLE source of truth the component renders from.
 */
import type { ConfirmStatus } from '@/lib/verificationApi';

export type ConfirmPhase = 'confirming' | ConfirmStatus;

/** What the CONFIRM-mode UI should show for a given token outcome + auth state. */
export type ConfirmView =
  | 'confirming'
  | 'verified-redirect'   // authenticated + verified → auto-enter the app
  | 'verified-signin'     // verified but no session → prompt sign-in
  | 'expired'
  | 'failed';             // already_used | superseded | invalid | error

export function confirmView(phase: ConfirmPhase, isAuthenticated: boolean): ConfirmView {
  if (phase === 'confirming') return 'confirming';
  if (phase === 'verified' || phase === 'already_verified') {
    return isAuthenticated ? 'verified-redirect' : 'verified-signin';
  }
  if (phase === 'expired') return 'expired';
  return 'failed';
}

/** Whether a confirm outcome should auto-refresh the user + redirect to /chat. */
export function shouldRedirectAfterConfirm(phase: ConfirmPhase, isAuthenticated: boolean): boolean {
  return confirmView(phase, isAuthenticated) === 'verified-redirect';
}

/** The PENDING-mode (no token) decision. Order matters: we never resolve the
 *  "unverified" panel until auth AND the status fetch have settled, and a status
 *  error is NEVER treated as verified. */
export type PendingDecision =
  | 'loading'          // auth/status unresolved (or a redirect is in flight) — no panel flash
  | 'redirect-login'   // no authenticated session → /login
  | 'redirect-chat'    // verified → /chat (after refreshing the user)
  | 'error'            // authenticated + resolved but status unavailable (transient) — retry/sign-out
  | 'pending';         // authenticated + resolved + unverified → the real pending screen

export interface PendingInput {
  isHydrating: boolean;
  isAuthenticated: boolean;
  loading: boolean;                       // verification-status fetch unresolved
  status: { verified: boolean } | null;   // null once resolved ⇒ API error
  redirected: boolean;                    // a navigation already fired this mount
}

export function pendingDecision(s: PendingInput): PendingDecision {
  if (s.isHydrating) return 'loading';          // wait for auth to resolve first
  if (!s.isAuthenticated) return 'redirect-login';
  if (s.redirected) return 'loading';           // a redirect is already underway
  if (s.loading) return 'loading';              // status fetch still in flight
  if (s.status === null) return 'error';        // resolved but no status ⇒ failure (NOT verified)
  if (s.status.verified) return 'redirect-chat';
  return 'pending';
}
