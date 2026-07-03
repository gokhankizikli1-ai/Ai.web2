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
  /** True when the reply parsed but was incomplete (fallback/partial output
   *  is being shown rather than throwing the whole result away). */
  partial: boolean;
}

/** Extracted brief fields for the Overview tab (best-effort, from Build Plan). */
export interface WebBuildBrief {
  type?: string; audience?: string; goal?: string; style?: string;
}

/** Pull the labeled brief lines out of the Build Plan / Design Direction. */
export function extractBrief(sections: BuildSection[]): WebBuildBrief {
  const plan = sections.find((s) => /build\s*plan/i.test(s.title));
  const design = sections.find((s) => /design\s*direction/i.test(s.title));
  const body = `${plan?.body || ''}\n${design?.body || ''}`;
  const grab = (re: RegExp): string | undefined => {
    const m = body.match(re);
    return m ? m[1].split(/\n/)[0].replace(/^[\s:–-]+/, '').trim() : undefined;
  };
  return {
    type: grab(/(?:website\s*type|type)\s*[:\-–]\s*(.+)/i),
    audience: grab(/(?:audience|target\s*audience)\s*[:\-–]\s*(.+)/i),
    goal: grab(/(?:goal|conversion\s*goal)\s*[:\-–]\s*(.+)/i),
    style: grab(/(?:tone|style|mood|design\s*style)\s*[:\-–]\s*(.+)/i),
  };
}

/** Best-effort file list from the Frontend Code section's `### <path>` heads. */
export function extractFiles(sections: BuildSection[]): string[] {
  const code = sections.find((s) => /frontend\s*code|code/i.test(s.title));
  if (!code) return [];
  const files = [...code.body.matchAll(/^###\s+(.+?)\s*$/gm)].map((m) => m[1].trim());
  return Array.from(new Set(files)).slice(0, 24);
}

/** Where a Web Build failed — drives the friendly, specific error message. */
export type WebBuildErrorKind =
  | 'empty_prompt' | 'network' | 'http' | 'unreadable'
  | 'empty' | 'invalid' | 'timeout' | 'cancelled';

export class WebBuildError extends Error {
  readonly kind: WebBuildErrorKind;
  readonly reason?: unknown;
  constructor(kind: WebBuildErrorKind, message: string, reason?: unknown) {
    super(message);
    this.name = 'WebBuildError';
    this.kind = kind;
    this.reason = reason;
  }
}

/** The i18n key for the friendly user-facing message per error kind. */
export function webBuildErrorKeyFor(kind: WebBuildErrorKind): string {
  switch (kind) {
    case 'network': return 'wbErrNetwork';
    case 'timeout': return 'wbErrTimeout';
    case 'empty':   return 'wbErrEmpty';
    default:        return 'wbErrGeneric';
  }
}

const BUILD_TIMEOUT_MS = 90_000;

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
 * Generate (or revise) a website build. Throws WebBuildError (with a `kind`)
 * only when there is genuinely nothing usable: network failure, HTTP error,
 * timeout, an empty reply, or a shortcut/one-liner with no build content.
 *
 * TOLERANT PARSING: a reply that parsed but is missing some canonical sections
 * is NOT thrown away — it's returned with `partial: true` so the UI can render
 * what came back. A reply with substantial prose but no `##` sections becomes
 * a single fallback "Overview" section rather than an error. This keeps
 * partial output visible instead of failing the whole flow.
 */
export async function generateWebBuild(
  idea: string,
  opts?: { signal?: AbortSignal; revise?: boolean; previousReply?: string },
): Promise<WebBuildResult> {
  const trimmed = idea.trim();
  if (!trimmed) throw new WebBuildError('empty_prompt', 'Describe the website you want before generating.');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const tok = localStorage.getItem('korvix_access_token');
    if (tok) headers['Authorization'] = `Bearer ${tok}`;
  } catch { /* ignore */ }

  // Own timeout, combined with the caller's abort signal.
  const timer = new AbortController();
  const timeoutId = setTimeout(() => timer.abort(), BUILD_TIMEOUT_MS);
  let timedOut = false;
  const onTimeout = () => { timedOut = true; };
  timer.signal.addEventListener('abort', onTimeout);
  if (opts?.signal) {
    if (opts.signal.aborted) timer.abort();
    else opts.signal.addEventListener('abort', () => timer.abort(), { once: true });
  }

  let response: Response;
  try {
    response = await fetch(`${apiBase()}/chat`, {
      method: 'POST',
      headers,
      signal: timer.signal,
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
      if (timedOut) throw new WebBuildError('timeout', 'The build timed out.', err);
      throw new WebBuildError('cancelled', 'Generation cancelled.', err);
    }
    throw new WebBuildError('network', 'Could not reach the Korvix backend.', err);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new WebBuildError('http', `The backend returned HTTP ${response.status}.`);
  }

  let data: Record<string, unknown>;
  try {
    data = await response.json();
  } catch (err) {
    throw new WebBuildError('unreadable', 'The backend sent an unreadable response.', err);
  }

  const reply = typeof data.reply === 'string' ? data.reply : '';
  if (!reply.trim()) throw new WebBuildError('empty', 'The backend returned an empty result.');

  const reportedMode = typeof data.mode === 'string' ? data.mode : '';
  let sections = parseBuildSections(reply);
  const present = new Set(sections.map((s) => norm(s.title)));

  // A different reported mode means the request was routed to the wrong
  // handler (e.g. a style/settings shortcut) — that IS a hard failure.
  if (reportedMode && reportedMode !== WEBSITE_BUILDER_MODE && !opts?.revise) {
    // eslint-disable-next-line no-console
    console.warn(`[WebBuild] wrong mode="${reportedMode}" (expected ${WEBSITE_BUILDER_MODE})`);
    throw new WebBuildError('invalid', `Routed to "${reportedMode}", not the website builder.`);
  }

  let partial = false;

  if (sections.length === 0) {
    // No `##` headings. If it's a tiny one-liner it's a shortcut/garbage →
    // fail. If it's substantial prose, keep it as a fallback Overview.
    if (reply.trim().length < 40) {
      // eslint-disable-next-line no-console
      console.warn(`[WebBuild] unusable one-liner reply: ${JSON.stringify(reply.slice(0, 80))}`);
      throw new WebBuildError('invalid', 'The reply had no build sections.');
    }
    // eslint-disable-next-line no-console
    console.warn('[WebBuild] no sections parsed — showing raw reply as a fallback Overview.');
    sections = [{ title: 'Overview', body: reply.trim() }];
    partial = true;
  } else if (!opts?.revise) {
    // Fresh build should ideally have these; if some are missing we still
    // show what we got and flag it partial (don't throw the rest away).
    const required = ['Build Plan', 'Page Sections', 'Frontend Code'];
    const missing = required.filter((r) => !present.has(norm(r)));
    if (missing.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(`[WebBuild] partial build — ${sections.length} section(s), missing [${missing.join(', ')}]`);
      partial = true;
    }
  }

  return {
    reply,
    sections,
    partial,
    model: typeof data.model === 'string' ? data.model : 'unknown',
    mode: reportedMode || WEBSITE_BUILDER_MODE,
    requestId: typeof data.request_id === 'string' ? data.request_id : '',
  };
}
