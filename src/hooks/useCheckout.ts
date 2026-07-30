/**
 * useCheckout — the shared checkout CTA behaviour (PR #525).
 *
 * A single hook every pricing/upgrade CTA uses so loading, auth-gating, error
 * surfacing and the provider-agnostic redirect all behave identically. It sends
 * ONLY a Korvix plan selector to the provider-neutral backend seam; it knows
 * nothing about Lemon Squeezy or Polar.
 *
 * Behaviour:
 *   • Guests are routed to /signup (the app's existing sign-in redirect) with a
 *     `?next` back to the current pricing surface — never charged while signed out.
 *   • Authenticated callers get a POST /v2/billing/checkout, and on success the
 *     browser is redirected to the returned hosted checkout URL (a full-page
 *     navigation, so the provider owns the payment page).
 *   • Any failure sets a bounded, human-readable `error` and clears `loading`;
 *     no partial state, never a client-side "you're now subscribed".
 *
 * FEATURE FLAG: when `isCheckoutEnabled()` is false (default), `start()` does
 * nothing and `enabled` is false, so a CTA can fall back to its exact previous
 * behaviour. This keeps the PR non-breaking until VITE_ENABLE_CHECKOUT is set.
 */
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuthStore } from '@/stores/authStore';
import {
  createCheckout, isCheckoutEnabled, planSelector,
  BillingError, type BillingPlan, type BillingInterval,
} from '@/lib/billingApi';

interface StartOptions {
  /** Where to send guests / where to return after checkout (defaults to current path). */
  returnPath?: string;
}

export interface UseCheckout {
  /** True only when the frontend checkout flag is on. CTAs use this to decide
   *  whether to take over the click or keep their legacy navigation. */
  enabled: boolean;
  /** In-flight request state (the selector currently being processed, or null). */
  loading: boolean;
  /** The selector whose checkout is in flight (lets a grid disable just one card). */
  pendingSelector: string | null;
  /** Bounded, user-safe error message from the last attempt (or null). */
  error: string | null;
  /** Clear the current error. */
  clearError: () => void;
  /** Begin checkout for a plan + interval. No-op when the flag is off. */
  start: (plan: BillingPlan, interval?: BillingInterval, opts?: StartOptions) => Promise<void>;
  /** Begin checkout for a pre-built selector (e.g. from a variants endpoint). */
  startSelector: (selector: string, opts?: StartOptions) => Promise<void>;
}

export function useCheckout(): UseCheckout {
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [pendingSelector, setPendingSelector] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enabled = isCheckoutEnabled();

  const startSelector = useCallback(async (selector: string, opts?: StartOptions) => {
    if (!enabled) return; // flag off → CTA keeps its legacy behaviour
    setError(null);

    // Never start a paid flow for a signed-out visitor — route to sign up first.
    if (!isAuthenticated) {
      const back = opts?.returnPath || (typeof window !== 'undefined' ? window.location.pathname : '/pricing');
      navigate(`/signup?next=${encodeURIComponent(back)}`);
      return;
    }

    setPendingSelector(selector);
    try {
      const { url } = await createCheckout(selector);
      // Full-page navigation so the provider owns the hosted checkout page.
      if (typeof window !== 'undefined') window.location.assign(url);
    } catch (e) {
      if (e instanceof BillingError) {
        if (e.status === 401) {
          const back = opts?.returnPath || (typeof window !== 'undefined' ? window.location.pathname : '/pricing');
          navigate(`/signup?next=${encodeURIComponent(back)}`);
          return;
        }
        setError(
          e.status === 503
            ? 'Checkout is not available right now. Please try again later.'
            : e.message || 'Could not start checkout.',
        );
      } else {
        setError('Could not start checkout. Please try again.');
      }
    } finally {
      setPendingSelector(null);
    }
  }, [enabled, isAuthenticated, navigate]);

  const start = useCallback((plan: BillingPlan, interval: BillingInterval = 'monthly', opts?: StartOptions) => {
    return startSelector(planSelector(plan, interval), opts);
  }, [startSelector]);

  return {
    enabled,
    loading: pendingSelector !== null,
    pendingSelector,
    error,
    clearError: () => setError(null),
    start,
    startSelector,
  };
}
