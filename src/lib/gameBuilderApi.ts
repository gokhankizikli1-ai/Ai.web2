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

export type GameEngine = 'auto' | 'roblox' | 'unreal';

export interface GameEngineMeta {
  id: GameEngine;
  /** Short label for the selector chip. */
  label: string;
  /** One-line description shown under the label. */
  tagline: string;
  /** The exact engine name the backend [GAME BUILD REQUEST] block carries —
   *  the game_developer system prompt branches on these strings. */
  backendName: 'Auto-detect' | 'Roblox Studio' | 'Unreal Engine 5';
  /** Primary language / stack line for the selector card. */
  stack: string;
}

export const GAME_ENGINES: Record<GameEngine, GameEngineMeta> = {
  auto: {
    id: 'auto',
    label: 'Auto-detect',
    tagline: 'Let Korvix pick the best-fit engine for your idea.',
    backendName: 'Auto-detect',
    stack: 'Roblox · Unreal',
  },
  roblox: {
    id: 'roblox',
    label: 'Roblox Studio',
    tagline: 'Luau scripts, services, Remotes, DataStores — server-authoritative.',
    backendName: 'Roblox Studio',
    stack: 'Luau',
  },
  unreal: {
    id: 'unreal',
    label: 'Unreal Engine 5',
    tagline: 'Blueprint / C++ architecture, GameMode, components, HUD.',
    backendName: 'Unreal Engine 5',
    stack: 'Blueprint · C++',
  },
};

export const ENGINE_ORDER: GameEngine[] = ['auto', 'roblox', 'unreal'];

/* ─── Example prompts (per engine) ────────────────────────────────────── */

export const EXAMPLE_PROMPTS: Record<GameEngine, string[]> = {
  auto: [
    'A co-op survival game where players gather resources, craft tools, and defend a base at night',
    'A fast arcade racer with drifting, boost pads, and a lap-time leaderboard',
    'A puzzle-platformer where the player rewinds time to solve rooms',
  ],
  roblox: [
    'Create a Roblox tycoon game with pets, rebirths, upgrades, and monetization',
    'Create a Roblox obby with checkpoints, a shop, and a coins-per-stage reward system',
    'Create a Roblox simulator where players collect orbs, sell them, and buy pets with server-side currency',
  ],
  unreal: [
    'Create a UE5 horror survival prototype with inventory, flashlight, AI enemy, and objective system',
    'Create a UE5 third-person action prototype with melee combat, health, and a lock-on camera',
    'Create a UE5 first-person parkour prototype with wall-running, checkpoints, and a timer HUD',
  ],
};

/* ─── Prompt wrapping ─────────────────────────────────────────────────── */

/**
 * Wrap the raw user idea in the [GAME BUILD REQUEST] context block the
 * `game_developer` mode is built to read. Carries the selected engine, the
 * desired output quality, and the honest delivery model so the backend
 * produces engine-specific, copy-ready output and never claims editor
 * automation.
 */
export function buildGameBuildRequest(engine: GameEngine, idea: string): string {
  const meta = GAME_ENGINES[engine];
  return [
    '[GAME BUILD REQUEST]',
    `Target engine: ${meta.backendName}`,
    'Output quality: production-grade, comprehensive, and copy/export-ready.',
    'Delivery model: KorvixAI generates engine-ready code, scripts, exact file/instance placement,',
    'and architecture ONLY. It has no live editor connection and must not claim it inserted anything',
    'into Roblox Studio or Unreal Engine 5.',
    engine === 'auto'
      ? 'Engine choice: auto-detect the best-fit engine from the idea and state the choice in one line at the top.'
      : `Engine choice: use ${meta.backendName} — follow that engine's full output contract.`,
    '',
    'User idea:',
    idea.trim(),
  ].join('\n');
}

/* ─── Request ─────────────────────────────────────────────────────────── */

export interface GameBuildResult {
  reply: string;
  engine: GameEngine;
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
        message: buildGameBuildRequest(engine, trimmed),
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
    model: typeof data.model === 'string' ? data.model : 'unknown',
    mode: typeof data.mode === 'string' ? data.mode : GAME_DEVELOPER_MODE,
    requestId: typeof data.request_id === 'string' ? data.request_id : '',
  };
}
