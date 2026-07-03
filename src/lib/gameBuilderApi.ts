/**
 * Game Builder API client — KorvixAI Game Development workspace.
 *
 * The Game Development page POSTs the user's idea to the SAME non-streaming
 * `/chat` backend every other workspace uses, but pins the dedicated
 * `game_developer` AI mode. That mode's full senior-game-technical-director
 * persona lives server-side in backend/services/ai/mode_manager.py — this
 * client only has to (a) select the engine, (b) wrap the prompt in a
 * [GAME BUILD REQUEST] context block the mode knows how to read, and
 * (c) resolve the backend base URL the same way useChat.ts does.
 *
 * HONESTY: KorvixAI has NO live Roblox Studio / UE5 editor integration. The
 * backend generates copy/export-ready code + placement instructions only.
 * The wrapper block below states this explicitly so the model never claims it
 * inserted anything into an editor. Do not add a "connect editor" call here
 * until a real integration exists.
 *
 * Base URL resolution mirrors useChat.ts / startupMarketApi.ts: VITE_API_URL
 * when set on Vercel, otherwise the bundled Railway worker.
 */

/** The canonical backend AI mode for this workspace. Must match the mode
 *  registered in backend/services/ai/mode_manager.py. */
export const GAME_DEVELOPER_MODE = 'game_developer' as const;

const BUNDLED_BACKEND = 'https://worker-production-1345.up.railway.app';

function apiBase(): string {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  return envBase ? envBase.replace(/\/+$/, '') : BUNDLED_BACKEND;
}

/** Stable per-browser id, shared with useChat so usage/memory land under the
 *  same identity namespace. */
function getUserId(): string {
  const key = 'korvix_user_id';
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `${Math.random().toString(36).slice(2)}${Date.now()}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    // Private mode / storage disabled — a volatile id still lets the request go through.
    return 'guest_anon';
  }
}

/* ─── Engines ─────────────────────────────────────────────────────────── */

// Prompt-first builder: the user picks ONLY the target engine (two choices)
// and writes their idea naturally. Everything else — genre, camera, systems,
// multiplayer, save, monetization, build scope — is inferred by the backend
// `game_developer` mode from the prompt. There is intentionally no
// "Auto-detect" choice in the UI.
export type GameEngine = 'roblox' | 'unreal';

export interface GameEngineMeta {
  id: GameEngine;
  /** Short label for the selector pill. */
  label: string;
  /** The exact engine name the backend [GAME BUILD REQUEST] block carries —
   *  the game_developer system prompt branches on these strings. */
  backendName: 'Roblox Studio' | 'Unreal Engine 5';
  /** Primary language / stack line for the selector pill. */
  stack: string;
}

export const GAME_ENGINES: Record<GameEngine, GameEngineMeta> = {
  roblox: {
    id: 'roblox',
    label: 'Roblox Studio',
    backendName: 'Roblox Studio',
    stack: 'Luau',
  },
  unreal: {
    id: 'unreal',
    label: 'Unreal Engine 5',
    backendName: 'Unreal Engine 5',
    stack: 'Blueprint · C++',
  },
};

export const ENGINE_ORDER: GameEngine[] = ['roblox', 'unreal'];

/* ─── Build quality ───────────────────────────────────────────────────── */

// The ONE optional selector besides engine. Scales scope without any
// genre/camera/multiplayer/save/monetization form. The backendLabel must
// match a key in BUILD_QUALITY_TIERS (backend/services/ai/game_dev_modules.py).
export type BuildQuality = 'prototype' | 'mvp' | 'production';

export interface BuildQualityMeta {
  id: BuildQuality;
  label: string;
  backendLabel: 'Fast Prototype' | 'Polished MVP' | 'Production Style';
  blurb: string;
}

export const BUILD_QUALITIES: Record<BuildQuality, BuildQualityMeta> = {
  prototype: {
    id: 'prototype',
    label: 'Fast Prototype',
    backendLabel: 'Fast Prototype',
    blurb: 'Core mechanics only, minimal UI — the quickest path to playable.',
  },
  mvp: {
    id: 'mvp',
    label: 'Polished MVP',
    backendLabel: 'Polished MVP',
    blurb: 'Core mechanics, clean UI, feedback, save/checkpoint where useful.',
  },
  production: {
    id: 'production',
    label: 'Production Style',
    backendLabel: 'Production Style',
    blurb: 'Server validation, anti-exploit, config-first architecture, robust edge cases.',
  },
};

export const BUILD_QUALITY_ORDER: BuildQuality[] = ['prototype', 'mvp', 'production'];

/* ─── Example prompts (per engine) — kept short: 2 per engine ─────────── */

export const EXAMPLE_PROMPTS: Record<GameEngine, string[]> = {
  roblox: [
    'A Roblox tycoon with pets, rebirths, upgrades, and a server-side coin economy',
    'A Roblox first-person horror where you explore an abandoned school with a flashlight, an AI enemy, quests, checkpoints, and jumpscares',
  ],
  unreal: [
    'A UE5 third-person melee action prototype with a lock-on camera, health, enemy AI, and a basic HUD',
    'A UE5 first-person horror survival with inventory, flashlight, an AI enemy, and an objective system',
  ],
};

/* ─── Prompt wrapping ─────────────────────────────────────────────────── */

/**
 * Wrap the raw user idea in the [GAME BUILD REQUEST] context block the
 * `game_developer` mode is built to read. Prompt-first: it carries the
 * selected engine + the chosen build quality + the raw idea, and instructs
 * the backend to INFER every remaining design decision (genre, camera,
 * systems, multiplayer, save, monetization, build scope) from the prompt,
 * run its internal designer→UI→architect→code→QA→polish pipeline, and emit
 * the canonical structured sections. Also states the honest delivery model.
 */
export function buildGameBuildRequest(
  engine: GameEngine,
  quality: BuildQuality,
  idea: string,
): string {
  const meta = GAME_ENGINES[engine];
  const q = BUILD_QUALITIES[quality];
  return [
    '[GAME BUILD REQUEST]',
    `Target engine: ${meta.backendName}`,
    `Build quality: ${q.backendLabel}`,
    'Mode: prompt-first. Infer ALL missing design details from the user idea — genre, camera style, core loop,',
    'required systems, mechanics, UI screens, progression, whether multiplayer / save / monetization are needed,',
    'and build scope. Do not ask the user for more input; choose sensible defaults and state them.',
    'Build like a system: derive a game design plan, select the relevant mechanic modules and UI templates,',
    'produce the engine file tree + config-first code with exact placement, then run the QA/security and polish',
    'passes. Emit the canonical H2 sections (Overview, Detected Plan, Selected Modules, UI Templates, File Tree,',
    'Code Files, Setup Steps, Mechanic Quality Checklist, QA & Polish Pass, Testing Checklist, Upgrade Roadmap,',
    'Risks & Limitations) exactly and in order.',
    `Engine choice: use ${meta.backendName}. If the idea leans toward the other engine, adapt it to ${meta.backendName}`,
    'and note that briefly — do not fail or ask to switch.',
    'Delivery model: KorvixAI generates engine-ready code, scripts, exact file/instance placement, and architecture',
    'ONLY. It has no live editor connection and must not claim it inserted anything into Roblox Studio or UE5.',
    '',
    'User idea:',
    idea.trim(),
  ].join('\n');
}

/* ─── Result section parsing ──────────────────────────────────────────── */

export interface BuildSection {
  /** Section heading text (the `## Title`). */
  title: string;
  /** Raw markdown body for the section (may contain code fences, sub-headings). */
  body: string;
}

/**
 * Split the model's markdown reply into its canonical `## ` sections so the UI
 * can render tabs/cards instead of one wall of text.
 *
 * Robust by design: it splits on any level-2 ATX heading (ignoring `##` that
 * appears inside fenced code blocks), preserves document order, and folds any
 * preamble before the first heading into an "Overview" section. Returns an
 * empty array when the reply has no `## ` headings at all — the caller then
 * falls back to rendering the whole reply as-is.
 */
export function parseBuildSections(markdown: string): BuildSection[] {
  if (!markdown || !markdown.trim()) return [];

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const sections: BuildSection[] = [];
  let inFence = false;
  const preamble: string[] = [];
  let current: { title: string; body: string[] } | null = null;

  const flush = () => {
    if (current) {
      sections.push({ title: current.title.trim(), body: current.body.join('\n').trim() });
      current = null;
    }
  };

  for (const line of lines) {
    // Track fenced code blocks so a `##` comment inside code isn't treated as a heading.
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;

    const h2 = !inFence ? /^##\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (h2) {
      flush();
      current = { title: h2[1], body: [] };
      continue;
    }
    if (current) current.body.push(line);
    else preamble.push(line);
  }
  flush();

  if (sections.length === 0) return [];

  const lead = preamble.join('\n').trim();
  if (lead) {
    // Preamble before the first heading — attach to an existing Overview or prepend one.
    const overview = sections.find((s) => /^overview$/i.test(s.title));
    if (overview) overview.body = overview.body ? `${lead}\n\n${overview.body}` : lead;
    else sections.unshift({ title: 'Overview', body: lead });
  }
  return sections;
}

/* ─── Request ─────────────────────────────────────────────────────────── */

export interface GameBuildResult {
  reply: string;
  engine: GameEngine;
  quality: BuildQuality;
  model: string;
  mode: string;
  requestId: string;
}

export class GameBuildError extends Error {
  /** Underlying error (network failure, parse error) when one exists. */
  readonly reason?: unknown;

  constructor(message: string, reason?: unknown) {
    super(message);
    this.name = 'GameBuildError';
    this.reason = reason;
  }
}

/**
 * Generate a game development package for the given engine + idea.
 *
 * Throws GameBuildError on network failure or a non-2xx response so the page
 * can render an honest error state (with retry) instead of a fake result.
 */
export async function generateGameBuild(
  engine: GameEngine,
  quality: BuildQuality,
  idea: string,
  signal?: AbortSignal,
): Promise<GameBuildResult> {
  const trimmed = idea.trim();
  if (!trimmed) {
    throw new GameBuildError('Describe your game idea before generating.');
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const tok = localStorage.getItem('korvix_access_token');
    if (tok) headers['Authorization'] = `Bearer ${tok}`;
  } catch {
    /* ignore — localStorage may be disabled */
  }

  let response: Response;
  try {
    response = await fetch(`${apiBase()}/chat`, {
      method: 'POST',
      headers,
      signal,
      body: JSON.stringify({
        user_id: getUserId(),
        message: buildGameBuildRequest(engine, quality, trimmed),
        platform: 'web',
        mode: GAME_DEVELOPER_MODE,
      }),
    });
  } catch (err) {
    // Network / CORS / abort.
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new GameBuildError('Generation cancelled.', err);
    }
    throw new GameBuildError(
      'Could not reach the Korvix backend. Check your connection and try again.',
      err,
    );
  }

  if (!response.ok) {
    throw new GameBuildError(
      `The backend returned an error (HTTP ${response.status}). Please try again.`,
    );
  }

  let data: Record<string, unknown>;
  try {
    data = await response.json();
  } catch (err) {
    throw new GameBuildError('The backend sent an unreadable response.', err);
  }

  const reply = typeof data.reply === 'string' ? data.reply : '';
  if (!reply.trim()) {
    throw new GameBuildError('The backend returned an empty result. Please try again.');
  }

  return {
    reply,
    engine,
    quality,
    model: typeof data.model === 'string' ? data.model : 'unknown',
    mode: typeof data.mode === 'string' ? data.mode : GAME_DEVELOPER_MODE,
    requestId: typeof data.request_id === 'string' ? data.request_id : '',
  };
}
