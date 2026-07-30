/**
 * BillingReturn — the checkout return experience (PR #525, §4).
 *
 * Where the provider redirects the customer AFTER a hosted checkout. It is
 * strictly provider-neutral and grants NOTHING from the URL: query params only
 * hint at intent (?status=success|cancelled|...) and are NEVER trusted as
 * subscription truth. The page refreshes the AUTHORITATIVE backend account
 * snapshot (GET /v2/billing/me) and reflects only what the backend confirms.
 *
 * States shown:
 *   • activated   — backend confirms an entitling plan (the ONLY "success").
 *   • pending     — payment likely received, webhook not yet applied. We poll the
 *                   authoritative endpoint a bounded number of times, then show a
 *                   calm "being confirmed" message (never a fake success).
 *   • canceled    — the customer backed out (from the neutral status hint).
 *   • failed      — checkout reported a failure (from the neutral status hint).
 *   • not-synced  — returned but backend shows no change and hints are absent.
 *
 * No provider name, product id or amount is ever read here; no client-side grant.
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { motion } from 'framer-motion';
import { CheckCircle2, Clock, XCircle, AlertCircle, Loader2 } from 'lucide-react';
import { getMyBilling, type BillingAccount } from '@/lib/billingApi';

type ReturnState = 'checking' | 'activated' | 'pending' | 'canceled' | 'failed' | 'not-synced';

// Bounded polling — the webhook usually lands within a few seconds; we never
// spin forever and never invent a success if it doesn't arrive.
const MAX_POLLS = 5;
const POLL_INTERVAL_MS = 2500;

/** Normalize the (untrusted) provider status hint into a coarse intent. */
function hintFromParams(params: URLSearchParams): 'success' | 'canceled' | 'failed' | null {
  const raw = (params.get('status') || params.get('checkout') || params.get('result') || '').toLowerCase();
  if (!raw) return null;
  if (['success', 'succeeded', 'complete', 'completed', 'paid', 'active'].includes(raw)) return 'success';
  if (['cancel', 'canceled', 'cancelled', 'aborted'].includes(raw)) return 'canceled';
  if (['fail', 'failed', 'error', 'declined'].includes(raw)) return 'failed';
  return null;
}

export default function BillingReturn() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [state, setState] = useState<ReturnState>('checking');
  const [account, setAccount] = useState<BillingAccount | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    const hint = hintFromParams(params);

    // A definitive negative hint short-circuits polling — there is nothing to
    // confirm. (We still never grant anything; these are just terminal states.)
    if (hint === 'canceled') { setState('canceled'); return; }
    if (hint === 'failed') { setState('failed'); return; }

    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      if (cancelled.current) return;
      const snap = await getMyBilling();
      if (cancelled.current) return;
      if (snap) setAccount(snap);

      // The ONLY success signal: the backend granted an entitling plan.
      if (snap && snap.active) { setState('activated'); return; }

      polls += 1;
      if (polls < MAX_POLLS) {
        // Keep the calm pending state visible while the webhook catches up.
        setState(hint === 'success' ? 'pending' : 'checking');
        timer = setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }

      // Exhausted polling without a confirmed grant. Reflect honestly.
      setState(hint === 'success' ? 'pending' : 'not-synced');
    };

    void poll();
    return () => { cancelled.current = true; if (timer) clearTimeout(timer); };
  }, [params]);

  const view = VIEWS[state];

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-md rounded-2xl border border-white/[0.06] bg-white/[0.01] p-8 text-center"
      >
        <div className={`mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border ${view.iconWrap}`}>
          <view.Icon className={`h-7 w-7 ${view.iconColor} ${state === 'checking' ? 'animate-spin' : ''}`} />
        </div>

        <h1 className="text-xl font-semibold mb-2 tracking-tight">{view.title}</h1>
        <p className="text-[13px] text-slate-400 mb-6">{view.body}</p>

        {state === 'activated' && account?.plan && (
          <div className="mb-6 inline-flex items-center gap-2 rounded-lg border border-[#6F8F7A]/20 bg-[#6F8F7A]/[0.06] px-3 py-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-[#6F8F7A]" />
            <span className="text-[12px] font-medium text-[#8FB39C] capitalize">{account.plan} plan active</span>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            onClick={() => navigate('/chat')}
            className="w-full h-10 rounded-xl bg-white/[0.08] hover:bg-white/[0.12] border border-white/[0.08] text-[13px] font-medium transition-all"
          >
            Continue to KorvixAI
          </button>
          {(state === 'canceled' || state === 'failed' || state === 'not-synced') && (
            <button
              onClick={() => navigate('/pricing')}
              className="w-full h-10 rounded-xl border border-white/[0.06] text-slate-400 hover:text-white hover:bg-white/[0.03] text-[13px] font-medium transition-all"
            >
              Back to pricing
            </button>
          )}
        </div>

        {state === 'pending' && (
          <p className="mt-5 text-[11px] text-slate-600">
            You can safely leave this page — your plan will update automatically once confirmed.
          </p>
        )}
      </motion.div>
    </div>
  );
}

const VIEWS: Record<ReturnState, {
  Icon: typeof CheckCircle2;
  iconWrap: string;
  iconColor: string;
  title: string;
  body: string;
}> = {
  checking: {
    Icon: Loader2,
    iconWrap: 'border-white/[0.08] bg-white/[0.02]',
    iconColor: 'text-slate-300',
    title: 'Checking your subscription…',
    body: 'One moment while we confirm your account with our billing system.',
  },
  activated: {
    Icon: CheckCircle2,
    iconWrap: 'border-[#6F8F7A]/20 bg-[#6F8F7A]/[0.06]',
    iconColor: 'text-[#6F8F7A]',
    title: 'You’re all set',
    body: 'Your subscription is active. Thanks for upgrading — enjoy the full power of KorvixAI.',
  },
  pending: {
    Icon: Clock,
    iconWrap: 'border-[#A68A5B]/20 bg-[#A68A5B]/[0.06]',
    iconColor: 'text-[#C2A15A]',
    title: 'Payment received',
    body: 'Your subscription is being confirmed. This usually takes only a few moments.',
  },
  canceled: {
    Icon: XCircle,
    iconWrap: 'border-white/[0.08] bg-white/[0.02]',
    iconColor: 'text-slate-400',
    title: 'Checkout canceled',
    body: 'No charge was made. You can pick a plan again whenever you’re ready.',
  },
  failed: {
    Icon: AlertCircle,
    iconWrap: 'border-[#B45B5B]/20 bg-[#B45B5B]/[0.06]',
    iconColor: 'text-[#C98A8A]',
    title: 'Checkout didn’t complete',
    body: 'Something went wrong and your payment was not completed. Please try again.',
  },
  'not-synced': {
    Icon: Clock,
    iconWrap: 'border-white/[0.08] bg-white/[0.02]',
    iconColor: 'text-slate-400',
    title: 'Nothing to confirm yet',
    body: 'We didn’t find a recent subscription change on your account. If you just paid, it may still be processing.',
  },
};
