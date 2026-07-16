import { Component, useEffect, useMemo, useRef, type ErrorInfo, type ReactNode } from 'react';
import { SandpackProvider, SandpackLayout, SandpackPreview, useSandpack, type SandpackFiles, type SandpackSetup } from '@codesandbox/sandpack-react';
import { useLanguageStore } from '@/stores/languageStore';
import type { WebBuildFile } from '@/lib/webBuildPayload';
import {
  VE_RUNTIME_SOURCE, VE_RUNTIME_VIRTUAL_PATH, VE_BOOT_VIRTUAL_PATH, buildVisualEditBootSource,
} from '@/lib/candidateVisualEditRuntimeSource';
import {
  boundRuntimeMessages, emptyRuntimeSnapshot, runtimeSnapshotKey,
  type ModelNativeCandidate, type ModelNativeRuntimePhase, type ModelNativeRuntimeSnapshot,
} from '@/lib/webBuildRuntimePreview';

/**
 * ISOLATED runtime Preview of the validated model-native React project (Phase 12D).
 *
 * The generated TSX/TS/CSS files are runtime DATA, not modules of this app, so they
 * are NEVER executed inside the Korvix React tree. They run only inside Sandpack's
 * sandboxed preview iframe. There is no eval / new Function / dangerouslySetInnerHTML
 * / document.write / dynamic <script> injection / Babel-or-Tailwind CDN / custom TSX
 * interpreter here, and no auth/profile/spec/raw-response is passed into the sandbox.
 *
 * The sandbox receives only: the validated files (read-only), two preview-only
 * Tailwind/PostCSS infrastructure files, and a bounded static dependency map pinned to
 * the repository's own version ranges. A structurally-valid project is NOT proof it
 * compiles — Sandpack's own compile/runtime error overlay stays visible so failures
 * are shown honestly rather than masked by the legacy renderer.
 */
export interface WebBuildModelNativePreviewProps {
  files: WebBuildFile[];
  mode?: 'embedded' | 'standalone';
  /** Phase 13A — receive bounded, ephemeral runtime snapshots observed via Sandpack's
   *  PUBLIC API. Providing this callback mounts the observer; omit it for a clean preview.
   *  Snapshots are React-state only: never persisted, never sent to a model/backend. */
  onRuntimeSnapshot?: (snapshot: ModelNativeRuntimeSnapshot) => void;
  /** Phase 13A — owner Candidate Preview flag. Presentational hint only (no behaviour). */
  candidate?: boolean;
  /** Phase 13A — reserved owner flag; the diagnostics UI lives outside this component. */
  showRuntimeDiagnostics?: boolean;
  /** Phase 14K.3 — inject the visual-edit runtime (editor infrastructure) into the
   *  sandbox so the parent can drive Visual Select over the `korvix.visual-edit.v1`
   *  bridge. VIRTUAL-file only: never added to payload.files / All Files / exports,
   *  and only enabled for the embedded Candidate Preview (not the standalone route). */
  visualEdit?: boolean;
}

/* Bounded static runtime dependency map — the packages Phase 12C accepts, pinned to
 * the repository's OWN version ranges (never "latest", never an undeclared package).
 * The host-only @codesandbox/sandpack-react is deliberately absent. */
const SANDBOX_DEPENDENCIES: Record<string, string> = {
  react: '^19.2.0',
  'react-dom': '^19.2.0',
  'framer-motion': '^12.38.0',
  'lucide-react': '^0.562.0',
  clsx: '^2.1.1',
  'tailwind-merge': '^3.4.0',
  recharts: '^2.15.4',
  'class-variance-authority': '^0.7.1',
  cmdk: '^1.1.1',
  'date-fns': '^4.1.0',
  'embla-carousel-react': '^8.6.0',
  'input-otp': '^1.4.2',
  'next-themes': '^0.4.6',
  'react-day-picker': '^9.13.0',
  'react-hook-form': '^7.70.0',
  'react-markdown': '^10.1.0',
  'react-resizable-panels': '^4.2.2',
  'react-router': '^7.6.1',
  'react-syntax-highlighter': '^16.1.1',
  'remark-gfm': '^4.0.1',
  sonner: '^2.0.7',
  vaul: '^1.1.2',
  zod: '^4.3.5',
  zustand: '^5.0.13',
  '@hookform/resolvers': '^5.2.2',
  '@radix-ui/react-accordion': '^1.2.12',
  '@radix-ui/react-alert-dialog': '^1.1.15',
  '@radix-ui/react-aspect-ratio': '^1.1.8',
  '@radix-ui/react-avatar': '^1.1.11',
  '@radix-ui/react-checkbox': '^1.3.3',
  '@radix-ui/react-collapsible': '^1.1.12',
  '@radix-ui/react-context-menu': '^2.2.16',
  '@radix-ui/react-dialog': '^1.1.15',
  '@radix-ui/react-dropdown-menu': '^2.1.16',
  '@radix-ui/react-hover-card': '^1.1.15',
  '@radix-ui/react-label': '^2.1.8',
  '@radix-ui/react-menubar': '^1.1.16',
  '@radix-ui/react-navigation-menu': '^1.2.14',
  '@radix-ui/react-popover': '^1.1.15',
  '@radix-ui/react-progress': '^1.1.8',
  '@radix-ui/react-radio-group': '^1.3.8',
  '@radix-ui/react-scroll-area': '^1.2.10',
  '@radix-ui/react-select': '^2.2.6',
  '@radix-ui/react-separator': '^1.1.8',
  '@radix-ui/react-slider': '^1.3.6',
  '@radix-ui/react-slot': '^1.2.4',
  '@radix-ui/react-switch': '^1.2.6',
  '@radix-ui/react-tabs': '^1.1.13',
  '@radix-ui/react-toggle': '^1.1.10',
  '@radix-ui/react-toggle-group': '^1.1.11',
  '@radix-ui/react-tooltip': '^1.2.8',
  // Preview-only build toolchain. Sandpack 2.20.0 does NOT install
  // customSetup.devDependencies inside the sandbox, so these must be RUNTIME
  // dependencies for the generated project's Tailwind directives + PostCSS pipeline
  // to be processed. Versions match the repository's own devDependency ranges;
  // Tailwind is compiled inside the sandbox via the config files below, never a CDN.
  tailwindcss: '^3.4.19',
  postcss: '^8.5.6',
  autoprefixer: '^10.4.23',
  typescript: '~5.9.3',
};

/* Preview-only infrastructure files. They are added ONLY to the Sandpack virtual
 * project — never to payload.files / All Files — and never overwrite a model path. */

/* Phase 12F.3 — STABLE Tailwind SEMANTIC-TOKEN contract for the Preview runtime.
 *
 * The generated project can only ship tsx/ts/css files (the validator rejects a .js
 * tailwind.config), and the Phase 12A spec labels its palette with SEMANTIC names
 * (background/foreground/text/muted/surface/border/primary/secondary/accent/…), so the
 * model naturally emits utilities like `bg-background`, `text-text`, `border-border`.
 * Tailwind's default palette has NO such colors, so with an empty `theme.extend` those
 * utilities silently produced nothing and the Preview rendered UNSTYLED native controls.
 *
 * Each token below maps to `hsl(var(--<token>, <fallback-channels>) / <alpha-value>)`:
 *   • if the generated styles.css defines the shadcn-style channel var, its theme WINS;
 *   • otherwise the coherent fallback (neutral shadcn "light") renders — never unstyled.
 * The `/ <alpha-value>` form keeps opacity modifiers (bg-muted/50, bg-primary/20) working.
 * These are compiled INSIDE the sandbox by the pinned tailwindcss dep — never a CDN.
 *
 * KEEP IN SYNC with webBuildFrontendValidation.ts SUPPORTED_SEMANTIC_TOKENS. */
const SEMANTIC_TOKEN_FALLBACKS: Record<string, string> = {
  background: '0 0% 100%',
  foreground: '222.2 84% 4.9%',
  text: '222.2 84% 4.9%',
  card: '0 0% 100%',
  'card-foreground': '222.2 84% 4.9%',
  popover: '0 0% 100%',
  'popover-foreground': '222.2 84% 4.9%',
  primary: '222.2 47.4% 11.2%',
  'primary-foreground': '210 40% 98%',
  secondary: '210 40% 96.1%',
  'secondary-foreground': '222.2 47.4% 11.2%',
  muted: '210 40% 96.1%',
  'muted-foreground': '215.4 16.3% 46.9%',
  accent: '210 40% 96.1%',
  'accent-foreground': '222.2 47.4% 11.2%',
  accent2: '199 89% 48%',
  destructive: '0 84.2% 60.2%',
  'destructive-foreground': '210 40% 98%',
  border: '214.3 31.8% 91.4%',
  input: '214.3 31.8% 91.4%',
  ring: '222.2 84% 4.9%',
  surface: '0 0% 100%',
  'surface-foreground': '222.2 84% 4.9%',
};

/** Build the nested Tailwind `colors` object literal: `foreground`/`primary-foreground`
 *  collapse into `{ primary: { DEFAULT, foreground } }`; standalone tokens stay flat. */
function buildSemanticColorsLiteral(): string {
  const colorExpr = (token: string): string =>
    `'hsl(var(--${token}, ${SEMANTIC_TOKEN_FALLBACKS[token]}) / <alpha-value>)'`;
  const flat: string[] = [];
  const nested = new Map<string, string[]>();
  for (const token of Object.keys(SEMANTIC_TOKEN_FALLBACKS)) {
    const dash = token.indexOf('-');
    if (dash > 0 && token.slice(dash + 1) === 'foreground') {
      const base = token.slice(0, dash);
      const entries = nested.get(base) || [];
      entries.push(`foreground: ${colorExpr(token)}`);
      nested.set(base, entries);
    } else {
      // A base that also has a *-foreground becomes a nested object with a DEFAULT.
      flat.push(token);
    }
  }
  const lines: string[] = [];
  for (const token of flat) {
    const fg = nested.get(token);
    if (fg && fg.length) {
      lines.push(`      '${token}': { DEFAULT: ${colorExpr(token)}, ${fg.join(', ')} },`);
      nested.delete(token);
    } else {
      lines.push(`      '${token}': ${colorExpr(token)},`);
    }
  }
  // Any *-foreground whose base was not a color token on its own (none today) stays flat.
  for (const [base, fg] of nested) {
    lines.push(`      '${base}': { ${fg.join(', ')} },`);
  }
  return lines.join('\n');
}

const TAILWIND_CONFIG_CODE = [
  'module.exports = {',
  "  content: ['./src/**/*.{js,jsx,ts,tsx}'],",
  '  theme: {',
  '    extend: {',
  '      colors: {',
  buildSemanticColorsLiteral(),
  '      },',
  '    },',
  '  },',
  '  plugins: [],',
  '};',
  '',
].join('\n');

const POSTCSS_CONFIG_CODE = [
  'module.exports = {',
  '  plugins: {',
  '    tailwindcss: {},',
  '    autoprefixer: {},',
  '  },',
  '};',
  '',
].join('\n');

/* ── Phase 13G — shared HOST-SIDE viewport contract ────────────────────────────
 *
 * These rules style ONLY Korvix's own Sandpack HOST wrapper chain — never the
 * generated iframe DOCUMENT (that stays byte-for-byte the model's own project and
 * owns its own scroll/positioning). They fix two host-shell defects that made the
 * candidate look "broken" independently of any generated CSS:
 *
 *   1. Vertical collapse / large empty areas — SandpackProvider renders a
 *      `.sp-wrapper` whose default height is `auto`. Our explicit 70vh / dvh
 *      container height therefore never reached SandpackLayout → the preview → the
 *      iframe, so the iframe collapsed to its content height. Re-establishing
 *      `height: 100%` down the wrapper chain lets the declared viewport propagate.
 *   2. "Thin vertical strip" width collapse — the wrapper chain is flex-based; a
 *      flex item without `min-width: 0` / `min-height: 0` cannot shrink below its
 *      content's intrinsic size, so at narrow device widths it collapsed instead of
 *      letting the iframe fill the frame. Adding those unblocks correct shrinking.
 *
 * Scoped under the unique `.korvix-mnp-viewport` class (never a global `.sp-*`
 * rule), with NO `!important`, so nothing here can leak into other Sandpack usages
 * or override the generated project's own layout decisions. Standalone height uses
 * the modern dynamic viewport unit `dvh` with a plain `vh` fallback declared first
 * (browsers that don't understand `dvh` keep the `vh` value), always reserving the
 * ~44px standalone Korvix chrome so the preview never exceeds the available height. */
const PREVIEW_VIEWPORT_STYLE = [
  '.korvix-mnp-viewport { position: relative; width: 100%; min-width: 0; box-sizing: border-box; overflow: hidden; }',
  '.korvix-mnp-embedded { height: 70vh; min-height: 560px; }',
  '.korvix-mnp-standalone { height: calc(100vh - 44px); height: calc(100dvh - 44px); min-height: 480px; }',
  '.korvix-mnp-viewport .sp-wrapper { width: 100%; height: 100%; min-width: 0; min-height: 0; }',
  '.korvix-mnp-viewport .sp-layout { width: 100%; height: 100%; min-width: 0; min-height: 0; border: none; border-radius: 0; }',
  '.korvix-mnp-viewport .sp-stack { width: 100%; height: 100%; min-width: 0; min-height: 0; }',
  '.korvix-mnp-viewport .sp-preview-container { width: 100%; height: 100%; min-width: 0; min-height: 0; flex: 1 1 0%; }',
  '.korvix-mnp-viewport .sp-preview-iframe { width: 100%; height: 100%; min-width: 0; min-height: 0; flex: 1 1 0%; border: 0; }',
].join('\n');

/**
 * Host viewport shell shared by BOTH the embedded panel and the standalone route so
 * the two surfaces resolve to the SAME sizing contract (only the height class differs:
 * a 70vh drawer vs. the standalone viewport below Korvix chrome). The host shell owns
 * the frame dimensions and clipping; the generated document keeps its own scroll inside
 * the iframe. `data-preview-viewport` is a real host-owned diagnostic — it reports the
 * host mode only and makes NO claim about the generated document's rendered layout.
 */
function PreviewViewportShell({ mode, candidate, children }: { mode: 'embedded' | 'standalone'; candidate?: boolean; children: ReactNode }) {
  return (
    <>
      <style>{PREVIEW_VIEWPORT_STYLE}</style>
      <div
        className={`korvix-mnp-viewport korvix-mnp-${mode}`}
        data-preview-viewport={mode}
        data-preview-candidate={candidate ? 'true' : 'false'}
      >
        {children}
      </div>
    </>
  );
}

/** Required entry files that must be present + non-empty before a sandbox can start. */
const REQUIRED_ENTRY_PATHS = ['src/main.tsx', 'src/App.tsx', 'src/styles.css'];

/** Normalize a payload path ('src/App.tsx') to a Sandpack virtual path ('/src/App.tsx'). */
function toVirtualPath(p: string): string {
  return p.startsWith('/') ? p : `/${p}`;
}

/**
 * Local error boundary around the Sandpack integration. If the Sandpack React
 * component itself throws while constructing the sandbox, the failure is contained
 * here with an honest message — we never fall back to the legacy section renderer
 * after claiming the model-native source is active. (Sandpack's OWN in-iframe
 * compile/runtime overlay handles generated-code errors and stays visible.)
 */
class SandpackErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (typeof console !== 'undefined') console.error('WebBuildModelNativePreview: Sandpack integration failed', error, info);
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

/* ── Phase 13A — public-API-only Sandpack runtime observer ─────────────────────
 * Rendered as a CHILD of SandpackProvider. It uses ONLY the public `useSandpack`
 * hook + its `listen(...)` bundler-message subscription and the public `sandpack.status`
 * string. It NEVER touches the iframe DOM, private internals, `postMessage` plumbing or
 * `console`, and it invents nothing: an error/warning is reported only when a supported
 * public message carries it. `running` is reported as "sandbox running" — NOT a compile
 * or visual pass. Snapshots are bounded and emitted only when they meaningfully change. */

/** A minimal, defensively-typed view of the public Sandpack bundler messages we read.
 *  We narrow on `type` and read documented fields; unknown shapes are ignored. */
interface RuntimeMessageLike {
  type?: string;
  status?: string;
  action?: string;
  title?: string;
  message?: string;
  /** Sandpack's historical (real) spelling for the compile-error flag on a `done` msg. */
  compilatonError?: boolean;
  compilationError?: boolean;
  log?: Array<{ method?: string; data?: unknown[] }>;
}

// Soft startup timeout (also the Candidate-health "timed out" fallback trigger, 14K.5).
// Deliberately generous so a slow COLD Sandpack install/transpile of a healthy project
// is not mistaken for a failure — only a genuinely stuck preview trips it.
const RUNTIME_SOFT_TIMEOUT_MS = 40000;

interface ObserverAccum {
  phase: ModelNativeRuntimePhase;
  publicStatus?: string;
  errorMessages: string[];
  warningMessages: string[];
  sawRuntimeSignal: boolean;
}

function toText(v: unknown): string {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

function RuntimeObserver({ onSnapshot }: { onSnapshot: (s: ModelNativeRuntimeSnapshot) => void }) {
  const { sandpack, listen } = useSandpack();
  const accRef = useRef<ObserverAccum>({ phase: 'not-started', errorMessages: [], warningMessages: [], sawRuntimeSignal: false });
  const lastKeyRef = useRef<string>('');

  const emit = useRef((reasonHint?: string) => {
    const acc = accRef.current;
    const messages = boundRuntimeMessages([...acc.errorMessages, ...acc.warningMessages]);
    const snapshot: ModelNativeRuntimeSnapshot = {
      ...emptyRuntimeSnapshot(),
      phase: acc.phase,
      publicStatus: acc.publicStatus,
      errorCount: acc.errorMessages.length,
      warningCount: acc.warningMessages.length,
      messages,
      sandboxRuntimeObserved: acc.sawRuntimeSignal,
      reason:
        reasonHint
        || (acc.phase === 'error' ? 'A bundler/runtime error was reported by the sandbox.'
          : acc.phase === 'timeout' ? 'No runtime signal was observed within the soft timeout (observation only).'
          : acc.phase === 'running' ? 'Sandbox reports running. Visual quality NOT evaluated; manual inspection still required.'
          : acc.phase === 'initializing' ? 'Sandbox is initializing (installing/transpiling).'
          : 'No runtime signal observed yet.'),
    };
    const key = runtimeSnapshotKey(snapshot);
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    onSnapshot(snapshot);
  }).current;

  // Subscribe to public bundler messages. `listen` is a documented public API.
  useEffect(() => {
    const push = (arr: string[], msg: string) => { if (msg && !arr.includes(msg) && arr.length < 12) arr.push(msg); };
    const stop = listen((raw) => {
      const m = raw as unknown as RuntimeMessageLike;
      const acc = accRef.current;
      switch (m.type) {
        case 'start':
          acc.phase = 'initializing';
          acc.errorMessages = [];
          acc.warningMessages = [];
          acc.sawRuntimeSignal = true;
          break;
        case 'status':
          acc.publicStatus = typeof m.status === 'string' ? m.status : acc.publicStatus;
          acc.sawRuntimeSignal = true;
          if (m.status === 'installing-dependencies' || m.status === 'transpiling') {
            if (acc.phase !== 'error') acc.phase = 'initializing';
          } else if (m.status === 'evaluating') {
            if (acc.phase !== 'error') acc.phase = 'running';
          }
          break;
        case 'done': {
          acc.sawRuntimeSignal = true;
          const compileError = m.compilatonError === true || m.compilationError === true;
          if (compileError) { acc.phase = 'error'; push(acc.errorMessages, 'Bundler reported a compile error.'); }
          else if (acc.phase !== 'error') acc.phase = 'running';
          break;
        }
        case 'action':
          if (m.action === 'show-error') {
            acc.phase = 'error';
            push(acc.errorMessages, toText(m.title || m.message || 'Sandbox reported an error.'));
          }
          break;
        case 'unhandled-rejection':
          acc.phase = 'error';
          push(acc.errorMessages, toText(m.message || 'Unhandled promise rejection in the sandbox.'));
          break;
        case 'timeout':
          if (acc.phase !== 'error') acc.phase = 'timeout';
          break;
        case 'console':
          if (Array.isArray(m.log)) {
            for (const entry of m.log) {
              if (!entry) continue;
              if (entry.method === 'error') push(acc.errorMessages, toText((entry.data || []).map(toText).join(' ')));
              else if (entry.method === 'warn') push(acc.warningMessages, toText((entry.data || []).map(toText).join(' ')));
            }
          }
          break;
        default:
          break;
      }
      emit();
    });
    return () => { try { stop(); } catch { /* ignore */ } };
  }, [listen, emit]);

  // Mirror the public status string + a coarse phase hint from `sandpack.status`. The
  // status is read as a plain string so this never depends on Sandpack's exact status union.
  const publicStatus = String(sandpack.status ?? '');
  useEffect(() => {
    const acc = accRef.current;
    acc.publicStatus = acc.publicStatus || (publicStatus || undefined);
    if ((publicStatus === 'initial' || publicStatus === 'running') && acc.phase === 'not-started') acc.phase = 'initializing';
    if ((publicStatus === 'running' || publicStatus === 'idle') && acc.sawRuntimeSignal && acc.phase === 'initializing') acc.phase = 'running';
    emit();
  }, [publicStatus, emit]);

  // Soft timeout: honestly report "no runtime signal observed within Ns" (our observation),
  // never a claim from Sandpack. Only fires while still not-started/initializing.
  useEffect(() => {
    const id = setTimeout(() => {
      const acc = accRef.current;
      if (acc.phase === 'not-started' || acc.phase === 'initializing') {
        acc.phase = 'timeout';
        emit();
      }
    }, RUNTIME_SOFT_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [emit]);

  return null;
}

export default function WebBuildModelNativePreview({ files, mode = 'embedded', onRuntimeSnapshot, candidate = false, showRuntimeDiagnostics = false, visualEdit = false }: WebBuildModelNativePreviewProps) {
  const { lang } = useLanguageStore();
  const list = useMemo(() => (Array.isArray(files) ? files.filter((f): f is WebBuildFile => !!f && typeof f.path === 'string' && typeof f.content === 'string') : []), [files]);

  // Precondition: the required entry files must exist and be non-empty. The Phase 12C
  // consumption gate should already guarantee this; if not, show an honest error
  // rather than silently switching to the legacy preview.
  const hasEntryFiles = useMemo(() => {
    const byPath = new Map(list.map((f) => [f.path, f]));
    return REQUIRED_ENTRY_PATHS.every((p) => {
      const f = byPath.get(p);
      return !!f && f.content.trim().length > 0;
    });
  }, [list]);

  // Read-only Sandpack virtual file map + preview-only infrastructure. Model content
  // is passed byte-for-byte; infra files never overwrite a model-native path.
  const virtualFiles = useMemo<SandpackFiles>(() => {
    const vf: SandpackFiles = {};
    for (const f of list) vf[toVirtualPath(f.path)] = { code: f.content, readOnly: true };
    if (!vf['/tailwind.config.js']) vf['/tailwind.config.js'] = { code: TAILWIND_CONFIG_CODE, readOnly: true, hidden: true };
    if (!vf['/postcss.config.js']) vf['/postcss.config.js'] = { code: POSTCSS_CONFIG_CODE, readOnly: true, hidden: true };
    // Phase 14K.3 — inject the visual-edit runtime + bootstrap ONLY into the Sandpack
    // virtual project (hidden, read-only). They never overwrite a model path and are
    // never added to payload.files / All Files / exports — editor infra, not content.
    if (visualEdit && vf['/src/main.tsx']) {
      vf[VE_RUNTIME_VIRTUAL_PATH] = { code: VE_RUNTIME_SOURCE, readOnly: true, hidden: true };
      vf[VE_BOOT_VIRTUAL_PATH] = { code: buildVisualEditBootSource('/src/main.tsx'), readOnly: true, hidden: true };
    }
    return vf;
  }, [list, visualEdit]);

  // With the runtime injected, the bootstrap becomes the entry (it imports the
  // runtime then the generated app). Without it, the generated entry is untouched.
  const entryPath = visualEdit && virtualFiles[VE_BOOT_VIRTUAL_PATH] ? VE_BOOT_VIRTUAL_PATH : '/src/main.tsx';
  const customSetup = useMemo<SandpackSetup>(() => ({
    entry: entryPath,
    dependencies: SANDBOX_DEPENDENCIES,
  }), [entryPath]);

  // Embedded: sized for the existing 70vh drawer. Standalone: fill the viewport below
  // the Korvix browser chrome. Both go through the shared PreviewViewportShell sizing
  // contract; the generated site controls its own full-width layout inside the iframe.
  const L = (en: string, tr: string) => (lang === 'tr' ? tr : en);

  // Phase 13A / 14K.5 — mount the public-API runtime observer whenever a caller passes
  // `onRuntimeSnapshot`. The panel uses it BOTH for owner diagnostics AND to detect
  // genuine Candidate render health (compile/runtime/timeout) so it can auto-fall back to
  // the Safe preview. The observer reads only Sandpack's PUBLIC API — no behaviour change.
  const wantObserver = !!onRuntimeSnapshot;

  if (!hasEntryFiles) {
    return (
      <PreviewViewportShell mode={mode} candidate={candidate}>
        <div className="flex h-full min-h-[240px] w-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
          <p className="text-[14px] font-semibold text-white">
            {L('Model-native preview could not start', 'Model-native önizleme başlatılamadı')}
          </p>
          <p className="mx-auto max-w-sm text-[12px] leading-relaxed text-[#94A3B8]">
            {L(
              'The generated project is missing a required entry file (src/main.tsx, src/App.tsx or src/styles.css). The validated files remain available in All Files.',
              'Oluşturulan projede gerekli bir giriş dosyası (src/main.tsx, src/App.tsx veya src/styles.css) eksik. Doğrulanmış dosyalar Tüm Dosyalar’da kullanılabilir.',
            )}
          </p>
        </div>
      </PreviewViewportShell>
    );
  }

  const boundaryFallback = (
    <PreviewViewportShell mode={mode} candidate={candidate}>
      <div className="flex h-full min-h-[240px] w-full flex-col items-center justify-center gap-2 px-6 py-12 text-center">
        <p className="text-[14px] font-semibold text-white">
          {L('Model-native preview could not start.', 'Model-native önizleme başlatılamadı.')}
        </p>
        <p className="mx-auto max-w-sm text-[12px] leading-relaxed text-[#94A3B8]">
          {L(
            'The validated files remain available in All Files.',
            'Doğrulanmış dosyalar Tüm Dosyalar’da kullanılabilir.',
          )}
        </p>
      </div>
    </PreviewViewportShell>
  );

  return (
    <SandpackErrorBoundary fallback={boundaryFallback}>
      <PreviewViewportShell mode={mode} candidate={candidate}>
        <SandpackProvider
          theme="dark"
          template="react-ts"
          files={virtualFiles}
          customSetup={customSetup}
        >
          {wantObserver && onRuntimeSnapshot ? <RuntimeObserver onSnapshot={onRuntimeSnapshot} /> : null}
          <SandpackLayout style={{ height: '100%', width: '100%', border: 'none', borderRadius: 0 }}>
            <SandpackPreview
              showNavigator={false}
              showOpenInCodeSandbox={false}
              showOpenNewtab={false}
              showRefreshButton
              showSandpackErrorOverlay
              style={{ height: '100%', width: '100%' }}
            />
          </SandpackLayout>
        </SandpackProvider>
      </PreviewViewportShell>
    </SandpackErrorBoundary>
  );
}

/* ── Phase 13A — shared owner-only presentational blocks (reused by the embedded panel
 * and the standalone route). Honest wording only: an unapproved candidate is never framed
 * as a finished/approved/production site, and no visual/screenshot claim is ever made. ── */

const ACCEPTANCE_LABEL: Record<string, [string, string]> = {
  approved: ['approved', 'onaylı'],
  'repaired-approved': ['repaired-approved', 'düzeltme sonrası onaylı'],
  'manual-review-required': ['manual review required', 'manuel inceleme gerekli'],
  skipped: ['skipped', 'atlandı'],
  unknown: ['unknown', 'bilinmiyor'],
};

/** The prominent "unapproved model-native candidate" warning shown above a candidate run. */
export function CandidateUnapprovedNotice({ candidate }: { candidate: ModelNativeCandidate }) {
  const { lang } = useLanguageStore();
  const L = (en: string, tr: string) => (lang === 'tr' ? tr : en);
  const acc = ACCEPTANCE_LABEL[candidate.acceptance] || ACCEPTANCE_LABEL.unknown;
  const srcLabel = candidate.source === 'consumed-model-native'
    ? L('consumed model-native', 'tüketilen model-native')
    : candidate.source === 'parsed-initial-candidate'
      ? L('parsed initial candidate', 'ayrıştırılmış ilk aday')
      : L('none', 'yok');
  return (
    <div className="mb-3 rounded-xl border border-[#A855F7]/30 bg-[#A855F7]/[0.08] px-3.5 py-2.5">
      <p className="text-[12px] font-semibold text-[#D8B4FE]">
        {L('Unapproved model-native candidate', 'Onaylanmamış model-native aday')}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-[#E5D4F7]">
        {L(
          'Unapproved model-native candidate. This is the actual generated React project running in the isolated sandbox. It did not receive final frontend approval and is shown only for owner inspection.',
          'Onaylanmamış model-native aday. Bu, izole çalışma ortamında çalışan gerçek üretilmiş React projesidir. Nihai ön yüz onayı almamıştır ve yalnızca owner incelemesi için gösterilmektedir.',
        )}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-[#C4B5D6]">
        <span>{L('Candidate source', 'Aday kaynağı')}: {srcLabel}</span>
        <span>{L('Frontend acceptance', 'Ön yüz kabulü')}: {L(acc[0], acc[1])}</span>
        <span>{L('Visual quality not evaluated', 'Görsel kalite değerlendirilmedi')}</span>
      </div>
    </div>
  );
}

const PHASE_TONE: Record<ModelNativeRuntimePhase, string> = {
  'not-started': '#64748B',
  initializing: '#94A3B8',
  running: '#86A08F',
  error: '#E0A35B',
  timeout: '#E0A35B',
  unknown: '#64748B',
};

/** The bounded owner runtime-diagnostics block, rendered OUTSIDE the iframe. */
export function RuntimeDiagnosticsBlock({ snapshot, candidate }: { snapshot: ModelNativeRuntimeSnapshot | null; candidate: ModelNativeCandidate }) {
  const { lang } = useLanguageStore();
  const L = (en: string, tr: string) => (lang === 'tr' ? tr : en);
  const s = snapshot || emptyRuntimeSnapshot();
  const acc = ACCEPTANCE_LABEL[candidate.acceptance] || ACCEPTANCE_LABEL.unknown;
  const phaseLabel: Record<ModelNativeRuntimePhase, [string, string]> = {
    'not-started': ['not started', 'başlamadı'],
    initializing: ['initializing', 'başlatılıyor'],
    running: ['sandbox running', 'çalışma ortamı çalışıyor'],
    error: ['runtime error observed', 'çalışma zamanı hatası gözlemlendi'],
    timeout: ['no runtime signal (timeout)', 'çalışma sinyali yok (zaman aşımı)'],
    unknown: ['unknown', 'bilinmiyor'],
  };
  const first = s.messages.slice(0, 3);
  const rest = s.messages.slice(3);
  const row = (k: string, v: string, tone?: string) => (
    <div className="flex gap-2">
      <span className="w-40 shrink-0 text-[#64748B]">{k}</span>
      <span className="min-w-0 break-words" style={{ color: tone || '#CBD5E1' }}>{v}</span>
    </div>
  );
  return (
    <div className="mt-2 rounded-lg border border-white/[0.08] bg-black/20 px-3 py-2 text-[11px] leading-relaxed">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[#64748B]">
        {L('Candidate runtime diagnostics (owner)', 'Aday çalışma tanılaması (owner)')}
      </div>
      {row(L('Candidate source', 'Aday kaynağı'), candidate.source)}
      {row(L('Frontend acceptance', 'Ön yüz kabulü'), L(acc[0], acc[1]))}
      {row(L('Sandbox state', 'Çalışma durumu'), `${L(phaseLabel[s.phase][0], phaseLabel[s.phase][1])}${s.publicStatus ? ` · ${s.publicStatus}` : ''}`, PHASE_TONE[s.phase])}
      {row(L('Observed runtime errors', 'Gözlemlenen çalışma hataları'), String(s.errorCount), s.errorCount ? '#E0A35B' : undefined)}
      {row(L('Observed runtime warnings', 'Gözlemlenen çalışma uyarıları'), String(s.warningCount))}
      {row(L('Visual quality observed', 'Görsel kalite gözlemi'), 'false')}
      {row(L('Screenshot observed', 'Ekran görüntüsü gözlemi'), 'false')}
      {first.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {first.map((m, i) => (
            <p key={i} className="break-words text-[10.5px] text-[#94A3B8]">• {m}</p>
          ))}
          {rest.length > 0 && (
            <details className="mt-0.5">
              <summary className="cursor-pointer text-[10.5px] text-[#64748B] hover:text-[#94A3B8]">
                {L(`+${rest.length} more message(s)`, `+${rest.length} mesaj daha`)}
              </summary>
              <div className="mt-0.5 space-y-0.5">
                {rest.map((m, i) => (
                  <p key={i} className="break-words text-[10.5px] text-[#94A3B8]">• {m}</p>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
      <p className="mt-1.5 text-[10px] text-[#64748B]">
        {L(
          'Runtime observation via Sandpack public API only. A running sandbox still requires manual visual inspection; no screenshot or visual-quality review was performed.',
          'Çalışma gözlemi yalnızca Sandpack genel API’si üzerindendir. Çalışan bir ortam yine de manuel görsel inceleme gerektirir; ekran görüntüsü veya görsel kalite incelemesi yapılmadı.',
        )}
      </p>
    </div>
  );
}
