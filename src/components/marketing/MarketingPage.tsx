import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { X } from 'lucide-react';
import Navbar from '@/sections/Navbar';
import Footer from '@/sections/Footer';
import { useLanguageStore } from '@/stores/languageStore';
import { applyDocumentMeta } from '@/lib/documentMeta';

/**
 * The shared shell every PUBLIC surface renders inside.
 *
 * It owns the four things that were previously re-implemented (or missing) on
 * every marketing page:
 *
 *  1. The design-token scope (`.mkt`) + the single marketing stylesheet import.
 *  2. The fixed header + an exactly-matching spacer, so no page hard-codes a
 *     `pt-28`-style guess that breaks when the header height changes.
 *  3. Document title / description per route (see `@/lib/documentMeta`).
 *  4. Navigation ergonomics the app was missing: scroll-to-top on a new route,
 *     and scroll-to-anchor for `path#anchor` links — including on a COLD direct
 *     load. Under HashRouter, react-router parses `/product#chat` into pathname
 *     `/product` + hash `#chat`, so in-page links are real router links; nothing
 *     writes `location.hash` directly (which would be read as a route and blank
 *     the page — the bug the old landing's `href="#how"` link had).
 */

const ANNOUNCE_KEY = 'korvix_mkt_announcement_dismissed_v1';

function AnnouncementBar({ onDismiss }: { onDismiss: () => void }) {
  const { t } = useLanguageStore();
  return (
    <div className="mkt-announce">
      <div className="mkt-wrap mkt-announce-row">
        <Link to="/product#connectors" className="mkt-announce-text">
          <span className="mkt-announce-tag">{t('announceTag')}</span>
          <span className="truncate">{t('announceSlack')}</span>
        </Link>
        <button
          type="button"
          onClick={onDismiss}
          className="mkt-announce-x"
          aria-label={t('announceDismiss')}
        >
          <X aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Read the dismissal flag without ever throwing (private-mode browsers). */
function announcementDismissed(): boolean {
  try {
    return localStorage.getItem(ANNOUNCE_KEY) === '1';
  } catch {
    return false;
  }
}

export default function MarketingPage({
  title,
  description,
  announcement = false,
  children,
}: {
  /** Page title (site name is appended). Omit on the homepage. */
  title?: string;
  description?: string;
  /** Show the announcement strip (landing only — keeps it from becoming an ad). */
  announcement?: boolean;
  children: ReactNode;
}) {
  const location = useLocation();
  const { t } = useLanguageStore();
  const [showAnnounce, setShowAnnounce] = useState(() => announcement && !announcementDismissed());

  useEffect(() => {
    applyDocumentMeta(title, description);
    return () => applyDocumentMeta();
  }, [title, description]);

  // Scroll behaviour for public routes: an anchor wins, otherwise a new route
  // starts at the top (react-router does not restore or reset scroll itself).
  useEffect(() => {
    const id = location.hash ? decodeURIComponent(location.hash.slice(1)) : '';
    if (!id) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      return;
    }
    // One frame later: the target section may mount in the same commit.
    const raf = window.requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (!el) return;
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      // Move keyboard focus with the viewport so the next Tab continues from
      // the section the visitor just jumped to.
      const prev = el.getAttribute('tabindex');
      if (prev === null) el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
      if (prev === null) el.removeAttribute('tabindex');
    });
    return () => window.cancelAnimationFrame(raf);
  }, [location.pathname, location.hash]);

  const dismiss = () => {
    setShowAnnounce(false);
    try { localStorage.setItem(ANNOUNCE_KEY, '1'); } catch { /* non-fatal */ }
  };

  const skipToContent = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Never let the browser write `#main` into the URL — HashRouter reads the
    // hash as the route.
    e.preventDefault();
    const main = document.getElementById('mkt-main');
    if (!main) return;
    main.focus({ preventScroll: false });
    main.scrollIntoView({ block: 'start' });
  };

  return (
    <div className={`mkt${showAnnounce ? ' has-announce' : ''}`}>
      <a href="#mkt-main" className="mkt-skip" onClick={skipToContent}>
        {t('skipToContent')}
      </a>

      <Navbar announcement={showAnnounce ? <AnnouncementBar onDismiss={dismiss} /> : null} />
      <div className="mkt-headroom" aria-hidden="true" />

      <main id="mkt-main" tabIndex={-1} className="outline-none">
        {children}
      </main>

      <Footer />
    </div>
  );
}
