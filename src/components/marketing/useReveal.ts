import { useEffect, useRef } from 'react';

/**
 * Section entrance reveal — the shared, cheap motion primitive for the public
 * pages.
 *
 * One IntersectionObserver per element, disconnected the moment the element has
 * been revealed once, adding a single class (`is-in`) that the marketing
 * stylesheet animates (opacity + a 14px rise). No animation library, no rAF
 * loop, no scroll listener, no layout thrash, and nothing to clean up per
 * frame — this is what keeps "subtle entrance choreography" from costing a
 * framework.
 *
 * Reduced motion: `.mkt-reveal` is defined as fully visible under
 * `prefers-reduced-motion: reduce`, so content is never gated behind an
 * animation. We still add the class (harmless) rather than branching in JS.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(options?: {
  /** Fraction of the element that must be visible before revealing. */
  threshold?: number;
  /** Optional stagger in ms, applied as a transition-delay. */
  delay?: number;
}) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (options?.delay) el.style.transitionDelay = `${options.delay}ms`;

    // No IntersectionObserver (very old browsers / jsdom): show immediately.
    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('is-in');
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          io.disconnect();
        }
      },
      { threshold: options?.threshold ?? 0.12, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [options?.threshold, options?.delay]);

  return ref;
}
