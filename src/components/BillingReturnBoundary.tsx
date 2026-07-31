import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Error boundary for the checkout return route.
 *
 * The return page is the first thing a customer sees after paying, reached via an
 * EXTERNAL redirect (a cold app boot). If a lazy chunk fails to load, or any
 * component in the subtree throws, React would otherwise unmount the whole tree
 * and leave a blank white page. This boundary catches that and shows a calm,
 * provider-neutral fallback instead — it NEVER claims the subscription is active
 * (no access is granted here) and it never surfaces error internals or any
 * token / URL / PII.
 *
 * Links use hash targets so the app's HashRouter handles them without another
 * full navigation.
 */
interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

export default class BillingReturnBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    // Log ONLY the error name — never the message/stack (could echo a URL/token),
    // never the component stack, never any response data.
    try {
      // eslint-disable-next-line no-console
      console.warn('[billing-return] render failed:', error?.name || 'Error');
    } catch { /* never let logging throw */ }
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-white/[0.06] bg-white/[0.01] p-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#A68A5B]/20 bg-[#A68A5B]/[0.06]">
            <span className="text-2xl" aria-hidden="true">✓</span>
          </div>
          <h1 className="text-xl font-semibold mb-2 tracking-tight">Payment received</h1>
          <p className="text-[13px] text-slate-400 mb-6">
            Thanks! If your payment went through, your subscription will be confirmed on your
            account shortly. You can safely continue — your plan updates automatically.
          </p>
          <div className="flex flex-col gap-2">
            <a
              href="#/chat"
              className="w-full h-10 flex items-center justify-center rounded-xl bg-white/[0.08] hover:bg-white/[0.12] border border-white/[0.08] text-[13px] font-medium transition-all"
            >
              Continue to KorvixAI
            </a>
            <a
              href="#/pricing"
              className="w-full h-10 flex items-center justify-center rounded-xl border border-white/[0.06] text-slate-400 hover:text-white hover:bg-white/[0.03] text-[13px] font-medium transition-all"
            >
              Back to pricing
            </a>
          </div>
        </div>
      </div>
    );
  }
}
