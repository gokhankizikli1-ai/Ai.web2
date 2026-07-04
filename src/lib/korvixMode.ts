/**
 * Korvix builder-home mode — the tool/context a user picks on the unified Chat
 * home (Kimi/ChatGPT-style). It is a routing context, never inserted into the
 * composer text.
 *
 *   chat     → stays in normal Chat (default)
 *   website  → routes to Web Build with the prompt
 *   app      → routes to Web Build with mode=app context (app builder reuses the
 *              web pipeline for now; the label is preserved for a future one)
 *   game     → routes to Game Build with the prompt
 */
export type KorvixMode = 'chat' | 'website' | 'app' | 'game';

/** The four home modes shown as chips, in order. */
export const KORVIX_MODES: KorvixMode[] = ['chat', 'website', 'app', 'game'];

/* ── Lightweight intent detection (used only when no mode is selected) ──── */

/** A unicode-aware matcher: `stem` variants match a word + any letter suffix
 *  (Turkish agglutination: "uygulama" → "uygulaması"); `word` variants must be
 *  a whole word (avoids "app" matching "apple"). Multi-word phrases match with
 *  flexible whitespace. */
function makeRe(stems: string[], words: string[]): RegExp {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
  const parts: string[] = [];
  for (const s of stems) parts.push(s.includes(' ') ? esc(s) : `${esc(s)}\\p{L}*`);
  for (const w of words) parts.push(`${esc(w)}(?![\\p{L}])`);
  return new RegExp(`(?<![\\p{L}])(?:${parts.join('|')})`, 'iu');
}

// Strong signals — route on their own.
const GAME_RE = makeRe(
  ['oyun', 'roblox', 'minecraft', 'unity', 'unreal', 'görev', 'düşman', 'envanter', 'leaderboard', 'coin ui'],
  ['game', 'games', 'quest', 'enemy', 'npc', 'hud'],
);
const APP_RE = makeRe(
  ['uygulama', 'mobil uygulama', 'mobile app', 'application', 'prototip', 'prototype', 'saas', 'dashboard'],
  ['app'],
);
const WEB_RE = makeRe(
  ['web sitesi', 'websitesi', 'landing page', 'açılış sayfası', 'ecommerce', 'e-ticaret', 'eticaret', 'online mağaza', 'mağaza', 'portföy', 'vitrin'],
  ['website', 'landing', 'portfolio'],
);
// Weak website words — route only alongside a build verb.
const WEAK_WEB_RE = makeRe([], ['site', 'web', 'store', 'shop']);
const BUILD_VERB_RE = makeRe(
  ['oluştur', 'tasarla', 'hazırla', 'geliştir'],
  ['yap', 'yapar', 'kur', 'build', 'make', 'create', 'generate', 'design'],
);

/**
 * Infer the builder mode from a free-text prompt. Conservative by design:
 * anything without a clear website/app/game signal stays `chat`, so normal
 * questions ("NVIDIA kaç dolar?") are never force-routed to a builder.
 */
export function detectBuilderIntent(text: string): KorvixMode {
  const t = text.trim();
  if (!t) return 'chat';
  if (GAME_RE.test(t)) return 'game';
  if (APP_RE.test(t)) return 'app';
  if (WEB_RE.test(t)) return 'website';
  if (WEAK_WEB_RE.test(t) && BUILD_VERB_RE.test(t)) return 'website';
  return 'chat';
}
