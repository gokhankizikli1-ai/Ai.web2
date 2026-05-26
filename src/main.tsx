import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import { AppProvider } from '@/contexts/AppContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import './index.css'
import App from './App.tsx'

/* ── OAuth redirect-back receiver — must run BEFORE HashRouter mounts ──
 *
 * Google's OAuth implicit flow redirects the browser back to the
 * configured redirect_uri (`${origin}/login`) with the result in the
 * URL fragment:
 *
 *   https://korvixai.com/login#id_token=eyJhb…&state=abc…
 *
 * Problem: this app uses <HashRouter>, which treats EVERYTHING after
 * the `#` as the route. So HashRouter sees the route as
 * `id_token=eyJhb…&state=abc…`, fails to match it, falls back to
 * `/` (landing page), and AuthPage never mounts. The hang the user
 * reported is exactly this — Google's redirect lands on a URL the
 * router can't decode, React renders the landing page, the
 * id_token is never consumed.
 *
 * Fix: synchronously, BEFORE React renders, detect OAuth-shaped
 * fragments. Stash the raw fragment in sessionStorage and rewrite
 * the URL via history.replaceState so HashRouter mounts /login.
 * AuthPage's existing redirect-callback effect reads sessionStorage
 * (preferred) or falls back to the live hash (for unusual cases
 * where this bootstrap was bypassed).
 *
 * Sentinel format the AuthPage consumer expects:
 *   sessionStorage["korvix_oauth_response"] = "<raw fragment string>"
 *
 * No PII / no secrets logged. id_token stays in sessionStorage only
 * long enough for AuthPage to read it (single shot, cleared on
 * consume), and is also valid for at most a few minutes server-side
 * per Google's defaults — even if a tab is closed mid-flow, the
 * token expires harmlessly.
 */
(function captureOauthFragment(): void {
  try {
    const raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    // Detect the OAuth-implicit-flow shape: success carries id_token=,
    // error path carries error=. Both can be anywhere in the fragment.
    if (!/(?:^|&)(?:id_token|error|access_token)=/.test(raw)) return;
    try { sessionStorage.setItem('korvix_oauth_response', raw); }
    catch { /* private-mode browsers: degrade gracefully — the
              fallback path in AuthPage reads window.location.hash
              directly */ }
    // Force HashRouter onto /login so AuthPage mounts. Use
    // history.replaceState so the browser doesn't add a navigation
    // entry — back-button stays clean.
    try { window.history.replaceState(null, '', window.location.pathname + '#/login'); }
    catch { /* ignore — replaceState only fails on very old browsers */ }
    /* eslint-disable no-console */
    console.log(
      '%c[korvixai-auth] OAuth fragment captured before HashRouter',
      'color:#22d3ee;font-weight:bold;',
      raw.length, 'chars',
    );
    /* eslint-enable no-console */
  } catch { /* ignore — never block app boot */ }
})();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <ThemeProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </ThemeProvider>
    </HashRouter>
  </StrictMode>,
)
