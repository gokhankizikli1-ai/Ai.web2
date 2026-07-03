/**
 * Web Build API client — KorvixAI Web Build workspace.
 *
 * Unlike the old client-side-only preview, Web Build now POSTs the user's
 * idea to the SAME non-streaming `/chat` backend the rest of the app uses,
 * pinned to the dedicated `website_builder` AI mode. That mode returns a real
 * structured build package (Build Plan → Design Direction → Page Sections →
 * Generated Copy → Frontend Code → Next Steps) which we parse into sections
 * for the UI.
 *
 * Language: the resolved app locale is attached to every request (see
 * getRequestLocale) so the backend answer-language policy generates the whole
 * build — plan, copy, notes — in the user's selected language.
 *
 * Base URL resolution mirrors gameBuilderApi.ts / useChat.ts.
 */
import { getRequestLocale } from '@/lib/locale';
import { parseBuildSections, type BuildSection } from '@/lib/gameBuilderApi';

/** The canonical backend AI mode for this workspace. Must match the mode
 *  registered in backend/services/ai/mode_manager.py. */
export const WEBSITE_BUILDER_MODE = 'website_builder' as const;

const BUNDLED_BACKEND = 'https://worker-production-1345.up.railway.app';

function apiBase(): string {
  const envBase = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  return envBase ? envBase.replace(/\/+$/, '') : BUNDLED_BACKEND;
}

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
    return 'guest_anon';
  }
}

/** The canonical H2 sections a full Web Build reply should contain. */
export const WEB_BUILD_SECTIONS = [
  'Build Plan', 'Design Direction', 'Page Sections',
  'Generated Copy', 'Frontend Code', 'Next Steps',
] as const;

export interface WebBuildResult {
  reply: string;
  sections: BuildSection[];
  model: string;
  mode: string;
  requestId: string;
}

export class WebBuildError extends Error {
  readonly reason?: unknown;
  constructor(message: string, reason?: unknown) {
    super(message);
    this.name = 'WebBuildError';
    this.reason = reason;
  }
}

/**
 * Wrap the raw idea in the [WEB BUILD REQUEST] block the website_builder mode
 * knows how to read. For a section-level revision we pass the previous build
 * so the model can update ONE section and preserve the rest.
 */
export function buildWebBuildRequest(
  idea: string,
  opts?: { revise?: boolean; previousReply?: string },
): string {
  const lines: string[] = ['[WEB BUILD REQUEST]'];
  if (opts?.revise) {
    lines.push(
      'This is a REVISION of an existing website. Apply ONLY the change the user asks for',
      'and keep every other section exactly as it was. Re-output the full build with the',
      'targeted section(s) updated.',
    );
    if (opts.previousReply) {
      lines.push('', 'PREVIOUS BUILD (preserve unless the change touches it):', opts.previousReply);
    }
    lines.push('', `Requested change: ${idea}`);
  } else {
    lines.push(
      'Generate a real, buildable website package for the idea below. Understand the brief,',
      'detect the website type, and tailor the layout to it.',
      '',
      `Idea: ${idea}`,
    );
  }
  return lines.join('\n');
}

const norm = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Generate (or revise) a website build. Throws WebBuildError on network
 * failure, a non-2xx response, an empty reply, or — for a fresh build — a
 * structurally-invalid reply (a shortcut/one-liner with no build sections).
 * Revisions are validated leniently since they legitimately return a subset.
 */
export async function generateWebBuild(
  idea: string,
  opts?: { signal?: AbortSignal; revise?: boolean; previousReply?: string },
): Promise<WebBuildResult> {
  const trimmed = idea.trim();
  if (!trimmed) throw new WebBuildError('Describe the website you want before generating.');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const tok = localStorage.getItem('korvix_access_token');
    if (tok) headers['Authorization'] = `Bearer ${tok}`;
  } catch { /* ignore */ }

  let response: Response;
  try {
    response = await fetch(`${apiBase()}/chat`, {
      method: 'POST',
      headers,
      signal: opts?.signal,
      body: JSON.stringify({
        user_id: getUserId(),
        message: buildWebBuildRequest(trimmed, { revise: opts?.revise, previousReply: opts?.previousReply }),
        platform: 'web',
        mode: WEBSITE_BUILDER_MODE,
        // Language — resolved app locale so the build is generated in the
        // user's selected language (backend answer-language policy).
        ...getRequestLocale(trimmed),
      }),
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new WebBuildError('Generation cancelled.', err);
    }
    throw new WebBuildError('Could not reach the Korvix backend. Check your connection and try again.', err);
  }

  if (!response.ok) {
    throw new WebBuildError(`The backend returned an error (HTTP ${response.status}). Please try again.`);
  }

  let data: Record<string, unknown>;
  try {
    data = await response.json();
  } catch (err) {
    throw new WebBuildError('The backend sent an unreadable response.', err);
  }

  const reply = typeof data.reply === 'string' ? data.reply : '';
  if (!reply.trim()) throw new WebBuildError('The backend returned an empty result. Please try again.');

  const reportedMode = typeof data.mode === 'string' ? data.mode : '';
  const sections = parseBuildSections(reply);

  // Validation. A fresh build must be a real structured build (not a
  // style/settings shortcut one-liner). Require a few canonical sections.
  // Revisions can legitimately return a subset, so only require SOME sections.
  const present = new Set(sections.map((s) => norm(s.title)));
  if (!opts?.revise) {
    const required = ['Build Plan', 'Page Sections', 'Frontend Code'];
    const missing = required.filter((r) => !present.has(norm(r)));
    if (reportedMode && reportedMode !== WEBSITE_BUILDER_MODE) {
      // eslint-disable-next-line no-console
      console.warn(`[WebBuild] invalid reply — mode="${reportedMode}" (expected ${WEBSITE_BUILDER_MODE})`);
      throw new WebBuildError('Web Build did not return a valid result. Please try again.');
    }
    if (sections.length === 0 || missing.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[WebBuild] invalid reply — ${sections.length} section(s), missing [${missing.join(', ')}]`);
      throw new WebBuildError('Web Build did not return a valid result. Please try again.');
    }
  }

  return {
    reply,
    sections,
    model: typeof data.model === 'string' ? data.model : 'unknown',
    mode: reportedMode || WEBSITE_BUILDER_MODE,
    requestId: typeof data.request_id === 'string' ? data.request_id : '',
  };
}
